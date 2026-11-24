// Flame (Bonus Stats) maths for armour and accessories. Every number comes from data/flames.json.
// A flame picks distinct lines with equal chance, and each line rolls its own tier. The flame score is
// main stat + ATT x weight + All Stats % x weight + secondary stat x weight.
const STATS = ['STR', 'DEX', 'INT', 'LUK'];
export const SECONDARY_DEFAULT = { STR: 'DEX', DEX: 'STR', INT: 'LUK', LUK: 'DEX' };

// Value for an item level from a [[fromLevel, value], ...] table.
export function bandValue(bands, level) {
  let out = 0;
  for (const [from, value] of bands || []) if ((Number(level) || 0) >= from) out = value;
  return out;
}

// No sourced flame score for Max HP (Demon Avenger) characters.
export function flamesSupported(mainStat) {
  return mainStat !== 'HP';
}

export function flameWeights(fl, custom) {
  const out = { ...fl.weights };
  for (const k of Object.keys(out)) {
    const v = Number(custom && custom[k]);
    if (Number.isFinite(v) && v >= 0 && v <= 100) out[k] = v;
  }
  return out;
}

// Points one stat is worth: 1 for a main stat, the secondary weight for the secondary stat, else 0.
function statWeight(stat, mainStat, secondary, weights) {
  if (mainStat === 'XENON') return ['STR', 'DEX', 'LUK'].includes(stat) ? 1 : 0;
  if (stat === mainStat) return 1;
  return stat === secondary ? weights.secondary : 0;
}

// Score per tier for every line the item can roll: [{ id, per }].
export function flameLines(fl, { level, mainStat = 'STR', secondary, weights }) {
  const w = weights || fl.weights;
  const sec = STATS.includes(secondary) ? secondary : SECONDARY_DEFAULT[mainStat];
  const single = bandValue(fl.single, level);
  const double = bandValue(fl.double, level);
  const attLine = mainStat === 'INT' ? 'MATT' : 'ATT';
  const out = [];
  for (const id of fl.armourLines) {
    if (fl.minLevel[id] !== undefined && (Number(level) || 0) < fl.minLevel[id]) continue;
    let per = 0;
    if (STATS.includes(id)) per = single * statWeight(id, mainStat, sec, w);
    else if (id.includes('+')) per = double * id.split('+').reduce((a, s) => a + statWeight(s, mainStat, sec, w), 0);
    else if (id === attLine) per = w.att;
    else if (id === 'ALLSTAT') per = w.allstat;
    out.push({ id, per });
  }
  return out;
}

const key = (score) => Math.round(score * 100);
function choose(n, k) {
  let out = 1;
  for (let i = 1; i <= k; i++) out = (out * (n - k + i)) / i;
  return out;
}

// Exact chance of every flame score from one flame: [[score, chance], ...], lowest score first.
// opts: { level, mainStat, secondary, type (id in fl.types), advantaged, weights }.
export function scoreDist(fl, opts) {
  const type = fl.types.find((t) => t.id === opts.type) || fl.types[0];
  const shift = opts.advantaged ? fl.advantageShift : 0;
  const tiers = type.odds.map((p, i) => [i + 1 + shift, p]).filter(([, p]) => p > 0);
  const lines = flameLines(fl, opts);
  const counts = opts.advantaged ? [0, 0, 0, 1] : fl.lineCount;
  const maxLines = Math.min(counts.length, lines.length);
  // sets[j]: score -> total weight over every way to pick j lines (each way weighted by its tier odds).
  const sets = Array.from({ length: maxLines + 1 }, () => new Map());
  sets[0].set(0, 1);
  for (const line of lines) {
    for (let j = maxLines - 1; j >= 0; j--) {
      for (const [score, weight] of sets[j]) {
        for (const [tier, p] of tiers) {
          const k = score + key(line.per * tier);
          sets[j + 1].set(k, (sets[j + 1].get(k) || 0) + weight * p);
        }
      }
    }
  }
  const total = new Map();
  let used = 0;
  for (let j = 1; j <= maxLines; j++) used += counts[j - 1] || 0;
  for (let j = 1; j <= maxLines; j++) {
    const share = (counts[j - 1] || 0) / (used || 1);
    if (!share) continue;
    const ways = choose(lines.length, j);
    for (const [score, weight] of sets[j]) total.set(score, (total.get(score) || 0) + (share * weight) / ways);
  }
  return [...total.entries()].map(([k, p]) => [k / 100, p]).sort((a, b) => a[0] - b[0]);
}

export function chanceAtLeast(dist, target) {
  const t = key(Number(target) || 0);
  let p = 0;
  for (const [score, chance] of dist) if (key(score) >= t) p += chance;
  return Math.min(1, p);
}

// Flames needed when each one succeeds with chance p: the average, and how many to be 50/75/90/95% sure.
export function flamesNeeded(p) {
  if (!(p > 0)) return null;
  const sure = (q) => (p >= 1 ? 1 : Math.max(1, Math.ceil(Math.log(1 - q) / Math.log(1 - p))));
  return { chance: p, expected: 1 / p, p50: sure(0.5), p75: sure(0.75), p90: sure(0.9), p95: sure(0.95) };
}

export function chanceWithin(p, flames) {
  if (!(p > 0) || !(flames > 0)) return 0;
  return 1 - Math.pow(1 - p, flames);
}

// Score of a flame typed into Gear ({ main, att, allstat }). Secondary stat is not typed in, so it is not counted.
export function flameScore(flame, weights) {
  const f = flame || {};
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return Math.round((n(f.main) + n(f.att) * weights.att + n(f.allstat) * weights.allstat) * 100) / 100;
}

export function bestScore(dist) {
  return dist.length ? dist[dist.length - 1][0] : 0;
}
