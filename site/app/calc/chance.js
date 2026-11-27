// "What do my mesos buy": the chance to reach a target with a given budget, read from the same distributions as
// the "To be this sure" tables on Mesos (Star Force runs, cube tier-ups, flame rolls). Pure maths, no DOM.
import { starPlan, starCosts } from './starforce.js';
import { sunnyDays } from './sunny.js';

// The Star Force spread is simulated: these match the calculator's table, so both read the same runs.
export const SF_RUNS = 2500;
export const SF_SEED = 7;
// Above this many expected attempts the runs are not simulated (the calculator skips its table too).
export const SF_MAX_ATTEMPTS = 2000;

const budgetOf = (b) => (typeof b === 'number' && Number.isFinite(b) && b > 0 ? b : 0);

// Share of the sorted costs at or below the budget.
export function chanceFromCosts(costs, budget) {
  if (!costs || !costs.length) return 1;
  const b = budgetOf(budget);
  let lo = 0;
  let hi = costs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (costs[mid] <= b) lo = mid + 1;
    else hi = mid;
  }
  return lo / costs.length;
}

// Star Force: { kind: 'done' } (nothing to do), { kind: 'far' } (too many attempts to simulate, or a run never
// finished), or { kind: 'chance', chance, runs }.
export function starChance(sf, itemLevel, from, to, opts, replaceCost, budget) {
  const plan = starPlan(sf, itemLevel, from, to, opts, replaceCost || 0);
  if (!(plan.attempts > 0)) return { kind: 'done' };
  if (plan.attempts > SF_MAX_ATTEMPTS) return { kind: 'far' };
  const costs = starCosts(sf, itemLevel, from, to, opts, replaceCost || 0, SF_RUNS, SF_SEED);
  if (costs === null) return { kind: 'far' };
  return { kind: 'chance', chance: chanceFromCosts(costs, budget), runs: costs.length, simulated: true };
}

// Chance that `n` cubes are enough to climb from `fromTier` to `toTier` (each tier-up is its own geometric wait).
// Exact: the chance of standing on each tier is carried forward one cube at a time.
export function cubesEnough(cube, fromTier, toTier, n) {
  const start = Math.max(1, Math.min(4, Math.floor(Number(fromTier) || 0)));
  const end = Math.max(1, Math.min(4, Math.floor(Number(toTier) || 0)));
  if (start >= end) return 1;
  const ps = [];
  for (let t = start; t < end; t++) ps.push(cube.tierUp[t - 1]);
  if (!ps.every((p) => p > 0)) return 0;
  const L = ps.length;
  const cubes = Math.max(0, Math.floor(Number(n) || 0));
  let state = Array.from({ length: L + 1 }, (_, i) => (i === 0 ? 1 : 0));
  for (let k = 0; k < cubes; k++) {
    // Close enough to certain that more cubes cannot change a whole percent.
    if (state[L] > 1 - 1e-12) break;
    const next = new Array(L + 1).fill(0);
    next[L] = state[L];
    for (let i = 0; i < L; i++) {
      next[i] += state[i] * (1 - ps[i]);
      next[i + 1] += state[i] * ps[i];
    }
    state = next;
  }
  // Never quite certain while a tier-up can fail (rounding can make the sum read exactly 1).
  return Math.min(ps.every((p) => p >= 1) ? 1 : ALMOST, state[L]);
}
const ALMOST = 1 - Number.EPSILON;

// Cubes: how many the budget buys at the cube's price, and the exact chance they are enough.
export function cubeChance(cube, fromTier, toTier, budget) {
  if (!(cube.price > 0)) return { kind: 'noprice' };
  const cubes = Math.floor(budgetOf(budget) / cube.price);
  return { kind: 'chance', cubes, chance: cubesEnough(cube, fromTier, toTier, cubes), simulated: false };
}

// Flames: `perFlame` is the exact chance one flame reaches the target (chanceAtLeast of scoreDist).
export function flameChance(perFlame, price, budget) {
  if (!(price > 0)) return { kind: 'noprice' };
  if (!(perFlame > 0)) return { kind: 'never' };
  const flames = Math.floor(budgetOf(budget) / price);
  const chance = flames > 0 ? (perFlame >= 1 ? 1 : Math.min(ALMOST, 1 - Math.pow(1 - perFlame, flames))) : 0;
  return { kind: 'chance', flames, chance, simulated: false };
}

// Whole percent. A simulated 0 or 100 is a count of runs, not a certainty, so it reads "under 1%" / "over 99%";
// an exact 0 or 1 is shown as it is. Anything that rounds to 0 or 100 without being it reads the same way.
export function fmtChance(p, simulated = false) {
  if (!(p >= 0)) return '—';
  if (p <= 0) return simulated ? 'under 1%' : '0%';
  if (p >= 1) return simulated ? 'over 99%' : '100%';
  const r = Math.round(p * 100);
  if (r <= 0) return 'under 1%';
  if (r >= 100) return 'over 99%';
  return `${r}%`;
}

const DISCOUNT = /off Star Force/i;
const LESS_BOOM = /(reduced|less|lower)[^.]*destruction|destruction[^.]*(reduced|less|lower)/i;

// The Star Force terms of the next Sunny Sunday that has any (from events.json `sunny`, read from Nexon's notes):
// - now / wait: { day, discount, lessBoom } as announced;
// - none: Sundays are announced but none has a Star Force perk (through = last announced Sunday);
// - unknown: no schedule loaded.
export function sunnyTerms(sunny, now) {
  const days = sunnyDays(sunny, now);
  if (!days.length) return { kind: 'unknown' };
  const day = days.find((d) => d.perks.some((p) => DISCOUNT.test(p) || LESS_BOOM.test(p)));
  if (!day) return { kind: 'none', through: days[days.length - 1].start };
  return { kind: day.active ? 'now' : 'wait', day, discount: day.perks.some((p) => DISCOUNT.test(p)), lessBoom: day.perks.some((p) => LESS_BOOM.test(p)) };
}

// The calculator's own settings with a Sunny Sunday's perks added. `terms` without perks (none / unknown) uses
// the usual pair from upgrades.json (30% off and 30% less destruction), for an "if one comes" figure.
export function sunnyOpts(opts, terms) {
  const known = terms && (terms.kind === 'now' || terms.kind === 'wait');
  return { ...opts, discount: Boolean(opts.discount) || (known ? terms.discount : true), lessBoom: Boolean(opts.lessBoom) || (known ? terms.lessBoom : true) };
}

// Mesos for the chance: the figure typed for this calculation, else the planner's "mesos you have now".
export function budgetFor(state) {
  const own = state && state.ui && state.ui.budget ? state.ui.budget.mesos : null;
  if (typeof own === 'number' && Number.isFinite(own) && own >= 0) return { mesos: own, own: true };
  const held = state && state.mesos ? state.mesos.held : 0;
  return { mesos: typeof held === 'number' && Number.isFinite(held) && held > 0 ? held : 0, own: false };
}
