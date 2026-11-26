// GMS Star Force maths (v.272): rates and cost per attempt, expected cost to a target, and how often a run booms.
// Rates are the wiki base table with the old Star Catch bonus folded in (x1.05 success; fail and destroy rescaled).

export function maxStarsFor(sf, itemLevel) {
  let max = 0;
  for (const [lvl, m] of sf.maxStars) if (itemLevel >= lvl) max = m;
  return max;
}

export function restoreStar(sf, star) {
  for (const [a, b, to] of sf.restore) if (star >= a && star <= b) return to;
  return 12;
}

export function baseCost(sf, itemLevel, star) {
  const L = Math.floor(itemLevel / 10) * 10;
  const f = star < 10 ? (star + 1) / 25 : Math.pow(star + 1, 2.7) / (sf.costDivisors[String(star)] || sf.defaultDivisor);
  return Math.round((1000 + Math.round(L ** 3 * f)) / 100) * 100;
}

// opts: { discount: Sunny 30% off, lessBoom: Sunny 30% less destruction, safeguard, mvp: 'none'|'silver'|'gold'|'diamond' }
export function attempt(sf, itemLevel, star, opts = {}) {
  const s0 = sf.baseSuccess[star] / 100;
  const d0 = sf.baseDestroy[star] / 100;
  const s = Math.min(1, s0 * sf.starCatchMultiplier);
  const scale = s0 < 1 ? (1 - s) / (1 - s0) : 0;
  let d = d0 * scale;
  let f = (1 - s0 - d0) * scale;
  if (opts.lessBoom && star <= sf.sunny.destroyUpToStar) {
    const cut = d * (1 - sf.sunny.destroyMultiplier);
    d -= cut;
    f += cut;
  }
  const guard = Boolean(opts.safeguard) && star >= sf.safeguard.from && star <= sf.safeguard.to;
  if (guard) {
    f += d;
    d = 0;
  }
  const base = baseCost(sf, itemLevel, star);
  let mult = 1;
  if (opts.discount) mult *= sf.sunny.costMultiplier;
  const mvp = sf.mvp[opts.mvp || 'none'] || 0;
  if (mvp && star <= sf.mvp.upToStar) mult *= 1 - mvp;
  const cost = Math.round(base * mult + (guard ? base * sf.safeguard.extraCostMultiplier : 0));
  return { star, success: s, fail: f, destroy: d, cost, base, guard };
}

function table(sf, itemLevel, from, to, opts) {
  const at = {};
  let lo = from;
  // A boom can land below `from`, and booms there can land lower still, so widen until stable.
  for (let changed = true; changed; ) {
    changed = false;
    for (let s = lo; s < to; s++) {
      if (!at[s]) at[s] = attempt(sf, itemLevel, s, opts);
      if (at[s].destroy > 0 && restoreStar(sf, s) < lo) {
        lo = restoreStar(sf, s);
        changed = true;
      }
    }
  }
  return { at, lo };
}

// Expected mesos, booms and attempts from `from` to `to` stars. A boom restores the trace (see restore table)
// and adds `replaceCost` (the spare item, if you have to buy one).
export function starPlan(sf, itemLevel, from, to, opts = {}, replaceCost = 0) {
  // Stars are whole numbers; anything else (a typed 2.5, an empty box) is rounded down.
  from = Math.max(0, Math.floor(Number(from) || 0));
  to = Math.max(0, Math.floor(Number(to) || 0));
  const max = maxStarsFor(sf, itemLevel);
  const target = Math.min(to, max);
  if (from >= target) return { from, to: target, max, cost: 0, booms: 0, attempts: 0, noBoom: 1, steps: [] };
  const { at, lo } = table(sf, itemLevel, from, target, opts);
  // Solved exactly. For each star s below the target (a failed try stays put, so only success and boom move):
  //   (success + destroy) x[s] - success x[s+1] - destroy x[restore(s)] = what one move costs
  // for x = mesos, booms and attempts at once, with x[target] = 0. At most 31 unknowns, so plain Gaussian
  // elimination is instant and, unlike repeated sweeps, never stops short near 30 stars.
  const n = target - lo;
  const M = Array.from({ length: n }, () => new Array(n + 3).fill(0));
  for (let s = lo; s < target; s++) {
    const a = at[s];
    const row = M[s - lo];
    const go = a.success + a.destroy;
    row[s - lo] += go;
    if (s + 1 < target) row[s + 1 - lo] -= a.success;
    if (a.destroy > 0) row[restoreStar(sf, s) - lo] -= a.destroy;
    row[n] = a.cost + a.destroy * replaceCost;
    row[n + 1] = a.destroy;
    row[n + 2] = 1;
  }
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c];
    for (let k = c; k < n + 3; k++) M[c][k] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c || M[r][c] === 0) continue;
      const f = M[r][c];
      for (let k = c; k < n + 3; k++) M[r][k] -= f * M[c][k];
    }
  }
  const E = {}, B = {}, A = {};
  for (let s = lo; s < target; s++) { E[s] = M[s - lo][n]; B[s] = M[s - lo][n + 1]; A[s] = M[s - lo][n + 2]; }
  const steps = [];
  let noBoom = 1;
  for (let s = from; s < target; s++) {
    steps.push(at[s]);
    noBoom *= at[s].success / (at[s].success + at[s].destroy);
  }
  return { from, to: target, max, cost: E[from], booms: B[from], attempts: A[from], noBoom, steps };
}

function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Spread of outcomes from simulated runs: median, 75th, 90th and 95th percentile cost.
export function starSpread(sf, itemLevel, from, to, opts = {}, replaceCost = 0, runs = 3000, seed = 7) {
  from = Math.max(0, Math.floor(Number(from) || 0));
  to = Math.max(0, Math.floor(Number(to) || 0));
  const target = Math.min(to, maxStarsFor(sf, itemLevel));
  if (from >= target) return { p50: 0, p75: 0, p90: 0, p95: 0 };
  const { at } = table(sf, itemLevel, from, target, opts);
  const rand = rng(seed);
  const costs = [];
  for (let i = 0; i < runs; i++) {
    let star = from;
    let cost = 0;
    for (let n = 0; star < target && n < 60000; n++) {
      const a = at[star];
      cost += a.cost;
      const x = rand();
      if (x < a.success) star++;
      else if (x < a.success + a.destroy) {
        cost += replaceCost;
        star = restoreStar(sf, star);
      }
    }
    // A run that never got there has no cost to report: the whole spread is unknown.
    if (star < target) return null;
    costs.push(cost);
  }
  costs.sort((a, b) => a - b);
  const q = (p) => costs[Math.min(costs.length - 1, Math.floor(p * costs.length))];
  return { p50: q(0.5), p75: q(0.75), p90: q(0.9), p95: q(0.95) };
}
