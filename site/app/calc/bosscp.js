// Which bosses a character's Combat Power is enough for, from data/bosscp.json (the game's solo entry minimums).
import { crystalValue, shareKey } from './income.js';

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
// reach, then the best of those by crystal value, up to the crystals that sell. Bosses with no figure are never
// suggested. `keep` lists picks that stay as they are (party runs, bosses with no figure; a `party` field gives
// the party size): their bosses are not suggested again, and each one takes a place in the cap only when its
// crystal is among the best that sell, the way the week's income counts them.
export function suggestBosses(bossesData, cpData, cp, margin, char, keep = []) {
  if (!(cp > 0)) return { ids: [], total: 0, list: [], beyond: 0 };
  const taken = new Set(keep.map((b) => b.boss));
  // Ranked by what the crystal is worth even for a character who can't sell it (Quanah), so the list still
  // picks the hardest difficulty within reach; the total then shows what is really earned.
  const rankAs = { ...(char || {}), quanah: false };
  // Two kept difficulties of one boss share one clear: only the better crystal takes a place.
  const keptBest = new Map();
  for (const b of keep) {
    if (b.reset !== 'weekly' || b.noCrystal) continue;
    const v = crystalValue(b, rankAs, bossesData, b.party || 1);
    if (v > (keptBest.get(shareKey(b)) || 0)) keptBest.set(shareKey(b), v);
  }
  const keptRanks = [...keptBest.values()];
  const cap = bossesData.limits.weeklyPerCharacter;
  const best = new Map();
  let beyond = 0;
  for (const b of bossesData.bosses) {
    if (b.reset !== 'weekly' || b.noCrystal || taken.has(b.boss)) continue;
    const r = reach(cpData, b, cp, margin);
    if (r === 'no') beyond++;
    if (r !== 'yes') continue;
    const rank = crystalValue(b, rankAs, bossesData, 1);
    const cur = best.get(b.boss);
    if (!cur || rank > cur.rank) best.set(b.boss, { boss: b, rank, value: crystalValue(b, char || {}, bossesData, 1) });
  }
  // The best crystals that sell, kept picks and suggestions together; the suggestions among them are the list.
  const pool = [...[...best.values()].map((x) => ({ x, rank: x.rank })), ...keptRanks.map((rank) => ({ x: null, rank }))]
    .sort((a, b) => b.rank - a.rank).slice(0, cap);
  const list = pool.filter((p) => p.x).map((p) => p.x);
  // reachable: bosses within reach at all, so the page can tell "none within reach" from "kept picks fill it".
  return { ids: list.map((x) => x.boss.id), total: list.reduce((a, x) => a + x.value, 0), list, beyond, reachable: best.size };
}

// Picked bosses that ask for more Combat Power than the character has (solo picks only: party minimums are not listed).
export function picksOutOfReach(bossesData, cpData, picks, cp, margin = 1) {
  if (!(cp > 0)) return [];
  return bossesData.bosses.filter((b) => picks && picks[b.id] && (picks[b.id].party || 1) === 1 && reach(cpData, b, cp, margin) === 'no');
}

// "45M" style, for a need or a Combat Power.
export function fmtCp(n) {
  if (!(n > 0)) return '—';
  // The unit is picked after rounding, so 999,999 reads 1M, not 1000K.
  if (n >= 999.5e6) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (n >= 999.5e3) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 999.5) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}
