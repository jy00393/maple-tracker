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

// A monthly crystal counts once a month; as part of a weekly plan it is worth its average share of a week.
const MONTH_SHARE = (7 * 12) / 365.25;

// One line per picked boss with this week's planned and cleared crystal counts.
export function characterLines(char, bossState, bossData, bossById, now) {
  const picks = (bossState && bossState.picks) || {};
  const clears = (bossState && bossState.clears) || {};
  const start = crystalWeekStart(now);
  const lines = [];
  for (const [bossId, pick] of Object.entries(picks)) {
    const boss = bossById[bossId];
    if (!boss) continue;
    const value = crystalValue(boss, char, bossData, pick.party);
    const marks = clears[bossId] || {};
    if (boss.reset === 'daily') {
      let cleared = 0;
      for (let i = 0; i < 7; i++) if (marks[periodKey('daily', start + i * DAY)]) cleared++;
      const today = Boolean(marks[periodKey('daily', now)]);
      lines.push({ bossId, boss, kind: 'daily', value, planned: 7, cleared, clearedNow: today, party: pick.party || 1 });
    } else if (boss.reset === 'monthly') {
      // The month's mark holds the time it was ticked; it is earned in that crystal week only. Marks saved before
      // that (true) carry no time and are counted in the current week.
      const mark = marks[clearKey(boss, now)];
      // A crystal week can start in the previous month (Thu 26 Nov to Wed 2 Dec): that month's clear counts too.
      const prev = marks[periodKey('monthly', start)];
      const inWeek = (Boolean(mark) && (typeof mark !== 'number' || crystalWeekStart(mark) === start))
        || (typeof prev === 'number' && crystalWeekStart(prev) === start);
      lines.push({ bossId, boss, kind: 'monthly', value, planned: 1, plannedShare: MONTH_SHARE, cleared: inWeek ? 1 : 0, clearedNow: Boolean(mark), party: pick.party || 1 });
    } else {
      const key = clearKey(boss, now);
      const done = Boolean(marks[key]);
      lines.push({ bossId, boss, kind: boss.reset, value, planned: 1, cleared: done ? 1 : 0, clearedNow: done, party: pick.party || 1 });
    }
  }
  return lines.sort((a, b) => b.value - a.value);
}

// Applies the 14-per-character weekly cap and the per-world weekly cap.
export function computeIncome(characters, state, bossData, bossById, now) {
  const perChar = {};
  const worlds = {};
  const capChar = bossData.limits.weeklyPerCharacter;
  const capWorld = bossData.limits.perWorldPerWeek;
  for (const char of characters) {
    const lines = characterLines(char, state.bosses[char.id], bossData, bossById, now);
    const weekly = lines.filter((l) => l.kind === 'weekly' && l.value > 0);
    const plannedWeekly = weekly.slice(0, capChar);
    const clearedWeekly = weekly.filter((l) => l.cleared).slice(0, capChar);
    const units = { planned: [], earned: [] };
    for (const l of plannedWeekly) units.planned.push({ value: l.value, char: char.id });
    for (const l of clearedWeekly) units.earned.push({ value: l.value, char: char.id });
    for (const l of lines) {
      if (l.value <= 0 || l.kind === 'weekly') continue;
      for (let i = 0; i < l.planned; i++) units.planned.push({ value: l.value * (l.plannedShare || 1), char: char.id });
      for (let i = 0; i < l.cleared; i++) units.earned.push({ value: l.value, char: char.id });
    }
    perChar[char.id] = {
      lines,
      weeklyPicked: weekly.length,
      weeklyCleared: weekly.filter((l) => l.cleared).length,
      overCap: Math.max(0, weekly.length - capChar),
      units,
      earned: 0,
      planned: 0
    };
    const wk = worldKey(char);
    worlds[wk] = worlds[wk] || { key: wk, label: worldLabel(char), planned: [], earned: [] };
    worlds[wk].planned.push(...units.planned);
    worlds[wk].earned.push(...units.earned);
  }
  for (const w of Object.values(worlds)) {
    for (const kind of ['planned', 'earned']) {
      const kept = w[kind].sort((a, b) => b.value - a.value).slice(0, capWorld);
      w[kind + 'Count'] = kept.length;
      w[kind + 'Total'] = kept.reduce((sum, u) => sum + u.value, 0);
      w[kind + 'Dropped'] = Math.max(0, w[kind].length - capWorld);
      for (const u of kept) perChar[u.char][kind] += u.value;
    }
    delete w.planned;
    delete w.earned;
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
