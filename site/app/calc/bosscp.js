// Which bosses a character's Combat Power is enough for, from data/bosscp.json (the game's solo entry minimums).
import { crystalValue } from './income.js';

export function minCpFor(cpData, boss) {
  const v = cpData && cpData.minCp ? cpData.minCp[boss.id] : undefined;
  return typeof v === 'number' && v > 0 ? v : null;
}

// A safety margin from the data file's list (1 when the saved one is not on it).
export function marginOf(cpData, margin) {
  const known = (cpData && cpData.margins ? cpData.margins : []).map(([m]) => m);
  return known.includes(margin) ? margin : 1;
}

// 'yes' | 'no' | 'unknown' (no figure for this boss) | 'nocp' (no Combat Power entered).
export function reach(cpData, boss, cp, margin = 1) {
  const need = minCpFor(cpData, boss);
  if (need === null) return 'unknown';
  if (!(cp > 0)) return 'nocp';
  return cp >= need * margin ? 'yes' : 'no';
}

// The weekly crystal bosses worth running at this Combat Power: for each boss, the best-paying difficulty within
// reach, then the best `cap` of those by crystal value. Bosses with no figure are never suggested.
export function suggestBosses(bossesData, cpData, cp, margin, char) {
  if (!(cp > 0)) return { ids: [], total: 0, list: [], beyond: 0 };
  const cap = bossesData.limits.weeklyPerCharacter;
  const best = new Map();
  let beyond = 0;
  for (const b of bossesData.bosses) {
    if (b.reset !== 'weekly' || b.noCrystal) continue;
    const r = reach(cpData, b, cp, margin);
    if (r === 'no') beyond++;
    if (r !== 'yes') continue;
    const value = crystalValue(b, char, bossesData, 1);
    const cur = best.get(b.boss);
    if (!cur || value > cur.value) best.set(b.boss, { boss: b, value });
  }
  const list = [...best.values()].sort((a, b) => b.value - a.value).slice(0, cap);
  return { ids: list.map((x) => x.boss.id), total: list.reduce((a, x) => a + x.value, 0), list, beyond };
}

// Picked bosses that ask for more Combat Power than the character has (solo picks only: party minimums are not listed).
export function picksOutOfReach(bossesData, cpData, picks, cp, margin = 1) {
  if (!(cp > 0)) return [];
  return bossesData.bosses.filter((b) => picks && picks[b.id] && (picks[b.id].party || 1) === 1 && reach(cpData, b, cp, margin) === 'no');
}

// "45M" style, for a need or a Combat Power.
export function fmtCp(n) {
  if (!(n > 0)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}
