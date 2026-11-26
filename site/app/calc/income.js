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
      // `open`: the days this week that can still be cleared: today while it has no clear, and the days after
      // it. A day that passed without a clear cannot be made up (one clear a day), so it is not open.
      const today = Math.floor((now - start) / DAY);
      let open = 0;
      for (let i = 0; i < 7; i++) {
        const key = periodKey('daily', start + i * DAY);
        const c = claim(key);
        if (c) earned.push(c.value);
        else if (i >= today && !winner(key)) open++;
      }
      lines.push({ ...base, kind: 'daily', planned: extra.spare ? 0 : 7, open: extra.spare ? 0 : open, cleared: earned.length, clearedNow: ownNow, earned, ...extra });
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

// Crystals cleared this crystal week on a boss that has no difficulty picked any more (the pick was removed after
// the clear, by hand or by "Use this list"). The crystal was earned, so it stays in this week's totals until the
// reset. One entry per boss: { boss, kind, earned: [value per clear] }. With the pick gone the party size is not
// known, so each is valued as a solo clear. When several difficulties are ticked for one period the best counts.
export function unpickedClears(char, bossState, bossData, bossById, now) {
  const picks = (bossState && bossState.picks) || {};
  const clears = (bossState && bossState.clears) || {};
  const start = crystalWeekStart(now);
  const picked = new Set(Object.keys(picks).filter((id) => bossById[id]).map((id) => shareKey(bossById[id])));
  const groups = new Map();
  for (const id of Object.keys(clears)) {
    const boss = bossById[id];
    if (!boss || !clears[id] || typeof clears[id] !== 'object' || picked.has(shareKey(boss))) continue;
    if (!groups.has(shareKey(boss))) groups.set(shareKey(boss), []);
    groups.get(shareKey(boss)).push(boss);
  }
  const valueOf = (b) => crystalValue(b, char, bossData, 1);
  // The same order as a picked boss: the better crystal, then the id so every device agrees.
  const best = (list) => [...list].sort((x, y) => valueOf(y) - valueOf(x) || (x.id < y.id ? 1 : -1))[0] || null;
  const out = [];
  for (const group of groups.values()) {
    const reset = group[0].reset;
    const winner = (key) => best(group.filter((o) => clears[o.id][key]));
    const won = [];
    if (reset === 'daily') {
      for (let i = 0; i < 7; i++) won.push(winner(periodKey('daily', start + i * DAY)));
    } else if (reset === 'monthly') {
      // The same rule as a picked monthly boss: the mark's time decides the week; an old mark (true) counts now.
      const nowKey = periodKey('monthly', now);
      const prevKey = periodKey('monthly', start);
      const cur = winner(nowKey);
      const curMark = cur && clears[cur.id][nowKey];
      if (cur && (typeof curMark !== 'number' || crystalWeekStart(curMark) === start)) won.push(cur);
      const prev = prevKey !== nowKey ? winner(prevKey) : null;
      const prevMark = prev && clears[prev.id][prevKey];
      if (prev && typeof prevMark === 'number' && crystalWeekStart(prevMark) === start) won.push(prev);
    } else {
      won.push(winner(periodKey('thu', now)));
    }
    const hits = won.filter((b) => b && valueOf(b) > 0);
    if (!hits.length) continue;
    // Listed under the best difficulty that was cleared.
    out.push({ boss: best(hits), kind: reset, earned: hits.map(valueOf) });
  }
  return out.sort((a, b) => valueOf(b.boss) - valueOf(a.boss) || (a.boss.id < b.boss.id ? -1 : 1));
}

// What the weekly bosses still open would add before the Thursday reset, by the rule the totals use: only the
// `cap` best weekly crystals sell, so an open boss counts when it would be one of them, at what it adds (its
// crystal less the cheaper cleared one it pushes out). `extraEarned`: crystals earned outside the lines
// (unpickedClears). The value equals this week's target less earned for weekly bosses.
export function weeklyOpen(lines, cap = Infinity, extraEarned = []) {
  const limit = cap > 0 ? cap : Infinity;
  const weekly = (lines || []).filter((l) => l.kind === 'weekly' && l.value > 0);
  const earnedOf = (l) => (Array.isArray(l.earned) ? l.earned : l.cleared ? [l.value] : []);
  const earned = [...weekly.flatMap(earnedOf), ...(extraEarned || [])].filter((v) => v > 0).sort((a, b) => b - a).slice(0, limit);
  const open = weekly.filter((l) => !l.cleared && !l.clearedNow && !l.doneAs && !l.spare);
  // An earned crystal goes before an open one of the same value: swapping them adds nothing.
  const best = [...earned.map((value) => ({ value, open: 0 })), ...open.map((l) => ({ value: l.value, open: 1 }))]
    .sort((a, b) => b.value - a.value || a.open - b.open).slice(0, limit);
  const sum = (list) => list.reduce((a, v) => a + v, 0);
  return { count: best.filter((u) => u.open).length, value: sum(best.map((u) => u.value)) - sum(earned) };
}

// How many more crystals a line can add this crystal week, on the same basis as `earned`. A daily boss counts
// the days still open (`open`): a day that passed uncleared has left the week's target. A monthly crystal
// counts in full while it can still be cleared this month, and not at all once it was cleared in an earlier week
// (the weekly plan, `planned`, spreads it over the month instead).
function openUnits(l) {
  if (l.spare) return 0;
  if (l.kind === 'daily') return Number.isFinite(l.open) ? Math.max(0, l.open) : Math.max(0, l.planned - l.cleared);
  return l.clearedNow || l.doneAs ? 0 : 1;
}

// Applies the 14-per-character weekly cap and the per-world weekly cap.
// planned: the plan for an average week (a monthly crystal at its weekly share): income a week, goal dates.
// earned: crystals cleared this crystal week. target: earned plus what is still open this week, so "earned of
// target" compares like with like. Crystals cleared on a boss that is no longer picked (unpickedClears) are in
// earned and target, never in planned or in `lines`; perChar.unpicked lists them.
// A character's target is never below what it earned: when a world is over its cap, the crystals a character has
// already earned keep their places in the target before anyone's open ones.
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
    const unpicked = unpickedClears(char, state.bosses[char.id], bossData, bossById, now);
    const loose = unpicked.filter((u) => u.kind === 'weekly').flatMap((u) => u.earned);
    const earnedWeekly = [...weekly.flatMap((l) => l.earned), ...loose].sort(desc).slice(0, capChar);
    const targetWeekly = [...weekly.flatMap((l) => [...l.earned, ...Array(openUnits(l)).fill(l.value)]), ...loose].sort(desc).slice(0, capChar);
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
    for (const u of unpicked) {
      if (u.kind === 'weekly') continue;
      for (const v of u.earned) { add('earned', v); add('target', v); }
    }
    perChar[char.id] = {
      lines,
      weeklyPicked: wanted.length,
      weeklyCleared: weekly.filter((l) => l.cleared).length + loose.length,
      // Bosses cleared this week that are no longer picked. The weekly ones still take a place under the cap.
      unpicked,
      weeklyUnpicked: loose.length,
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
  const byValue = (a, b) => b.value - a.value;
  for (const w of Object.values(worlds)) {
    // How many of each character's earned crystals fit under the world cap.
    const held = {};
    for (const u of [...w.earned].sort(byValue).slice(0, capWorld)) held[u.char] = (held[u.char] || 0) + 1;
    // In the target, that many of the character's best crystals go first. They are worth at least the earned
    // ones (the target holds every earned crystal or a better one), so target >= earned for every character.
    const seen = {};
    for (const u of [...w.target].sort(byValue)) {
      seen[u.char] = (seen[u.char] || 0) + 1;
      u.held = seen[u.char] <= (held[u.char] || 0) ? 1 : 0;
    }
    for (const kind of KINDS) {
      const kept = w[kind].sort(kind === 'target' ? (a, b) => b.held - a.held || byValue(a, b) : byValue).slice(0, capWorld);
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

// ---- one record per boss clear: what other pages read from the Bosses ticks ----

// Why a character cannot enter a boss, from the boss's own entry fields in bosses.json (`only`, `minLevel`):
// 'challenger' (a Challenger World boss, the character is not in it), 'level' (below `minLevel`), or null.
// `who` is { challenger, level }; an unknown level never locks.
export function entryBlock(boss, who) {
  if (!boss) return null;
  const w = who || {};
  if (boss.only === 'challenger' && !w.challenger) return 'challenger';
  if (boss.minLevel && Number.isFinite(w.level) && w.level < boss.minLevel) return 'level';
  return null;
}

// The words for an entry rule, for a small note beside the boss.
export function entryBlockText(boss, block) {
  return block === 'challenger' ? 'Challenger World only' : block === 'level' ? `From Lv. ${boss.minLevel}` : '';
}

// The picked bosses of one reset ('daily', 'weekly', 'monthly'), one row per shared clear (a second difficulty
// picked for the same clear is left out): { bossId, boss, line, on }. `on` = cleared for the current period, on
// any difficulty. `lines` are characterLines().
export function bossRows(lines, reset) {
  return (lines || []).filter((l) => l.kind === reset && !l.spare).map((l) => ({ bossId: l.bossId, boss: l.boss, line: l, on: Boolean(l.clearedNow || l.doneAs) }));
}

// The clear of one boss, named by the ids of its difficulties (`ids`), for the current period: the difficulty
// whose box a tick goes to (the one ticked now, else the picked one, else the first id) and whether a mark is
// there. `bossState` is state.bosses[charId]. Returns null when none of the ids is a boss.
export function bossClear(ids, bossState, bossById, now) {
  const list = (ids || []).map((id) => bossById[id]).filter(Boolean);
  if (!list.length) return null;
  const picks = (bossState && bossState.picks) || {};
  const clears = (bossState && bossState.clears) || {};
  const marked = list.filter((b) => clears[b.id] && typeof clears[b.id] === 'object' && clears[b.id][clearKey(b, now)]);
  const boss = marked[0] || list.find((b) => picks[b.id]) || list[0];
  return { boss, on: marked.length > 0, shared: list.filter((b) => b.id !== boss.id).map((b) => b.id) };
}

// Which resets a list of boss lines follows, in plain words for a heading: one reset is named with its time,
// a mixed list names each kind.
export function bossResetHint(lines) {
  const kinds = ['daily', 'weekly', 'monthly'].filter((k) => (lines || []).some((l) => l.kind === k));
  const words = { daily: ['daily reset 09:00 KST', 'daily ones 09:00 KST'], weekly: ['weekly reset Thu 09:00 KST', 'weekly ones Thu 09:00 KST'], monthly: ['monthly reset on the 1st, 09:00 KST', 'monthly ones on the 1st'] };
  if (!kinds.length) return '';
  if (kinds.length === 1) return words[kinds[0]][0];
  return `resets: ${kinds.map((k) => words[k][1]).join(' · ')}`;
}
