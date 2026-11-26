import { DAY, dayKey, periodKey, weekStart } from '../time.js';

// Crystal week runs Thursday 00:00 UTC to Wednesday 23:59 UTC (weekly bosses reset Thursday).
export function crystalWeekStart(t) {
  return weekStart(t, 4);
}

export function worldKey(char) {
  return `${char.region || 'na'}:${char.challenger ? 'challenger-' : ''}${char.world || 'heroic'}`;
}

export function worldLabel(char) {
  const region = (char.region || 'na').toUpperCase();
  const world = char.world === 'interactive' ? 'Interactive' : 'Heroic';
  return `${region} ${char.challenger ? 'Challenger-' : ''}${world}`;
}

export function crystalValue(boss, char, bossData, party = 1) {
  if (!boss || boss.noCrystal || char.quanah) return 0;
  const mult = char.world === 'interactive' ? 1 : bossData.heroicMultiplier || 5;
  return Math.floor((boss.price * mult) / Math.max(1, Math.min(6, party || 1)));
}

export function clearKey(boss, now, day = now) {
  if (boss.reset === 'daily') return periodKey('daily', day);
  if (boss.reset === 'monthly') return periodKey('monthly', now);
  return periodKey('thu', now);
}

// Difficulties of one boss with the same reset share one clear (bosses.json `sharedClear`): Easy and Normal Zakum
// are one daily clear, Chaos Zakum is its own weekly one.
export function shareKey(boss) {
  return `${boss.boss}|${boss.reset}`;
}

// A monthly crystal counts once a month; as part of a weekly plan it is worth its average share of a week.
const MONTH_SHARE = (7 * 12) / 365.25;

// One line per picked boss with this week's planned and cleared crystal counts.
// `earned` lists the crystals the line earned this crystal week, one value per clear. A clear ticked on a
// difficulty that is not picked (the pick moved to another difficulty after the clear) is credited to the picked
// line of that boss, at the crystal of the difficulty that was cleared.
export function characterLines(char, bossState, bossData, bossById, now) {
  const picks = (bossState && bossState.picks) || {};
  const clears = (bossState && bossState.clears) || {};
  const start = crystalWeekStart(now);
  const lines = [];
  // The better crystal, then the id so every device agrees.
  const better = (va, a, vb, b) => va - vb || (a.id < b.id ? 1 : -1);
  for (const [bossId, pick] of Object.entries(picks)) {
    const boss = bossById[bossId];
    if (!boss) continue;
    const others = (bossData.bosses || []).filter((o) => o.id !== bossId && shareKey(o) === shareKey(boss));
    const pickedValue = (b) => crystalValue(b, char, bossData, picks[b.id].party);
    // Of the picked difficulties of this boss, the one that is planned.
    const top = [boss, ...others.filter((o) => picks[o.id])].sort((x, y) => better(pickedValue(y), y, pickedValue(x), x))[0];
    // A difficulty that is not picked has no party size of its own: it is valued at the planned pick's.
    const valueOf = (b) => crystalValue(b, char, bossData, (picks[b.id] || picks[top.id]).party);
    const value = valueOf(boss);
    const group = [boss, ...others];
    // The difficulty whose tick counts for a period: the best crystal when several are ticked (two devices, or
    // ticks from before the difficulties were tied together).
    const winner = (key) => group.filter((o) => clears[o.id] && clears[o.id][key]).sort((x, y) => better(valueOf(y), y, valueOf(x), x))[0] || null;
    // What this line earns from a period's tick: its own winning tick, or, on the planned line, the tick of a
    // difficulty that is not picked. null when the period's clear (if any) belongs to another line.
    const claim = (key) => {
      const w = winner(key);
      if (!w) return null;
      if (w.id === bossId) return { value, mark: clears[bossId][key] };
      if (!picks[w.id] && top.id === bossId) return { value: valueOf(w), mark: clears[w.id][key] };
      return null;
    };
    const nowKey = clearKey(boss, now);
    const wNow = winner(nowKey);
    const ownNow = Boolean(wNow && wNow.id === bossId);
    const extra = { shared: others.map((o) => o.id), doneAs: wNow && !ownNow ? wNow.difficulty : null, spare: top.id === bossId ? null : top.difficulty };
    const earned = [];
    const base = { bossId, boss, value, party: pick.party || 1 };
    if (boss.reset === 'daily') {
      for (let i = 0; i < 7; i++) {
        const c = claim(periodKey('daily', start + i * DAY));
        if (c) earned.push(c.value);
      }
      lines.push({ ...base, kind: 'daily', planned: extra.spare ? 0 : 7, cleared: earned.length, clearedNow: ownNow, earned, ...extra });
    } else if (boss.reset === 'monthly') {
      // The month's mark holds the time it was ticked; it is earned in that crystal week only. Marks saved before
      // that (true) carry no time and are counted in the current week.
      const cur = claim(nowKey);
      if (cur && (typeof cur.mark !== 'number' || crystalWeekStart(cur.mark) === start)) earned.push(cur.value);
      // A crystal week can start in the previous month (Thu 26 Nov to Wed 2 Dec): that month's clear counts too,
      // as a crystal of its own (the monthly limit resets on the 1st).
      const prevKey = periodKey('monthly', start);
      const prev = prevKey !== nowKey ? claim(prevKey) : null;
      if (prev && typeof prev.mark === 'number' && crystalWeekStart(prev.mark) === start) earned.push(prev.value);
      lines.push({ ...base, kind: 'monthly', planned: extra.spare ? 0 : 1, plannedShare: MONTH_SHARE, cleared: earned.length, clearedNow: ownNow, earned, ...extra });
    } else {
      const c = claim(nowKey);
      if (c) earned.push(c.value);
      lines.push({ ...base, kind: boss.reset, planned: 1, cleared: earned.length, clearedNow: ownNow, earned, ...extra });
    }
  }
  return lines.sort((a, b) => b.value - a.value);
}

// How many more crystals a line can add this crystal week, on the same basis as `earned`. A monthly crystal
// counts in full while it can still be cleared this month, and not at all once it was cleared in an earlier week
// (the weekly plan, `planned`, spreads it over the month instead).
function openUnits(l) {
  if (l.spare) return 0;
  if (l.kind === 'daily') return Math.max(0, l.planned - l.cleared);
  return l.clearedNow || l.doneAs ? 0 : 1;
}

// Applies the 14-per-character weekly cap and the per-world weekly cap.
// planned: the plan for an average week (a monthly crystal at its weekly share): income a week, goal dates.
// earned: crystals cleared this crystal week. target: earned plus what is still open this week, so "earned of
// target" compares like with like.
export function computeIncome(characters, state, bossData, bossById, now) {
  const perChar = {};
  const worlds = {};
  const capChar = bossData.limits.weeklyPerCharacter;
  const capWorld = bossData.limits.perWorldPerWeek;
  const KINDS = ['planned', 'earned', 'target'];
  const desc = (a, b) => b - a;
  for (const char of characters) {
    const lines = characterLines(char, state.bosses[char.id], bossData, bossById, now);
    const weekly = lines.filter((l) => l.kind === 'weekly' && l.value > 0);
    // A second difficulty picked for the same clear is not planned income.
    const wanted = weekly.filter((l) => !l.spare);
    const plannedWeekly = wanted.slice(0, capChar);
    const earnedWeekly = weekly.flatMap((l) => l.earned).sort(desc).slice(0, capChar);
    const targetWeekly = weekly.flatMap((l) => [...l.earned, ...Array(openUnits(l)).fill(l.value)]).sort(desc).slice(0, capChar);
    const units = { planned: [], earned: [], target: [] };
    const add = (kind, value) => { if (value > 0) units[kind].push({ value, char: char.id }); };
    for (const l of plannedWeekly) add('planned', l.value);
    for (const v of earnedWeekly) add('earned', v);
    for (const v of targetWeekly) add('target', v);
    for (const l of lines) {
      if (l.value <= 0 || l.kind === 'weekly') continue;
      for (let i = 0; i < l.planned; i++) add('planned', l.value * (l.plannedShare || 1));
      for (const v of l.earned) { add('earned', v); add('target', v); }
      for (let i = 0; i < openUnits(l); i++) add('target', l.value);
    }
    perChar[char.id] = {
      lines,
      weeklyPicked: wanted.length,
      weeklyCleared: weekly.filter((l) => l.cleared).length,
      overCap: Math.max(0, wanted.length - capChar),
      units,
      earned: 0,
      planned: 0,
      target: 0
    };
    const wk = worldKey(char);
    worlds[wk] = worlds[wk] || { key: wk, label: worldLabel(char), planned: [], earned: [], target: [] };
    for (const kind of KINDS) worlds[wk][kind].push(...units[kind]);
  }
  for (const w of Object.values(worlds)) {
    for (const kind of KINDS) {
      const kept = w[kind].sort((a, b) => b.value - a.value).slice(0, capWorld);
      w[kind + 'Count'] = kept.length;
      w[kind + 'Total'] = kept.reduce((sum, u) => sum + u.value, 0);
      w[kind + 'Dropped'] = Math.max(0, w[kind].length - capWorld);
      for (const u of kept) perChar[u.char][kind] += u.value;
    }
    for (const kind of KINDS) delete w[kind];
  }
  return { perChar, worlds: Object.values(worlds) };
}

function trimZeros(s) {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function fmtMesos(n) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  // The unit is picked after rounding, so 999,999 reads 1M, not 1000K.
  if (abs >= 999.5e6) return trimZeros((n / 1e9).toFixed(abs >= 1e11 ? 0 : 2)) + 'B';
  if (abs >= 999.5e3) return trimZeros((n / 1e6).toFixed(abs >= 1e8 ? 0 : 2)) + 'M';
  if (abs >= 999.5) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}

export function todayKey(now) {
  return dayKey(now);
}
