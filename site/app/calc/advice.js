// What to upgrade next: expected cost per gear slot, and the options ranked by gear score gained per meso.
import { gearSummary, slotProgress } from './progress.js';
import { starPlan, maxStarsFor } from './starforce.js';
import { cubePlan, hasPotential } from './upgrades.js';
import { DAY } from '../time.js';

const POT = ['None', 'Rare', 'Epic', 'Unique', 'Legendary'];

export function itemLevel(slot, entry) {
  if (entry.ilvl) return entry.ilvl;
  return slot.type === 'ring' && (entry.tier || 0) <= 1 ? 120 : 160;
}

// Expected cost to bring a slot to its target: Star Force (normal day and Sunny Sunday) and Bright Cube tier-ups.
export function slotOutlook(slot, entry, target, up) {
  const out = { temporary: Boolean(entry.temporary) };
  if (!entry.tier || out.temporary) return out;
  if (entry.tier < (target.tier || 0)) {
    out.replace = true;
    return out;
  }
  const lvl = itemLevel(slot, entry);
  if (slot.sf) {
    const max = maxStarsFor(up.starforce, lvl);
    const to = Math.min(target.stars || 0, max);
    const from = entry.stars || 0;
    if (to > from) {
      out.sf = { from, to, max, plain: starPlan(up.starforce, lvl, from, to, {}), sunny: starPlan(up.starforce, lvl, from, to, { discount: true, lessBoom: true }) };
    }
  }
  if (hasPotential(slot) && (target.pot || 0) > (entry.pot || 0)) {
    out.cube = { from: entry.pot || 0, to: target.pot, bright: cubePlan(up.cubes.types.bright, entry.pot || 1, target.pot), glowing: cubePlan(up.cubes.types.glowing, entry.pot || 1, target.pot) };
  }
  return out;
}

// Every meso upgrade that moves a permanent item toward its target, best value first.
// gain = share of the overall gear score it adds (the tracker's own scoring, not a damage number).
export function upgradeOptions(gearData, gearState, up) {
  const sum = gearSummary(gearData, gearState);
  const totalWeight = sum.slots.reduce((a, s) => a + s.slot.weight, 0) || 1;
  const out = [];
  for (const r of sum.gaps) {
    if (r.entry.temporary || !r.entry.tier) continue;
    const o = slotOutlook(r.slot, r.entry, r.target, up);
    if (o.replace) continue;
    const tierNames = gearData.slotTypes[r.slot.type].filter(Boolean);
    const gainOf = (patch) => (r.slot.weight * (slotProgress({ ...r.entry, ...patch }, r.target, tierNames).pct - r.pct)) / totalWeight;
    if (o.sf) {
      out.push({ slotId: r.slot.id, kind: 'sf', label: `${r.slot.name}: ${o.sf.from} → ${o.sf.to} stars`, cost: o.sf.plain.cost, sunnyCost: o.sf.sunny.cost, booms: o.sf.plain.booms, gain: gainOf({ stars: o.sf.to }) });
    }
    if (o.cube) {
      out.push({ slotId: r.slot.id, kind: 'cube', label: `${r.slot.name}: potential ${POT[o.cube.from]} → ${POT[o.cube.to]}`, cost: o.cube.bright.cost, cost90: o.cube.bright.cost90, gain: gainOf({ pot: o.cube.to }) });
    }
  }
  return out
    .filter((x) => x.cost > 0 && x.gain > 0)
    .map((x) => ({ ...x, value: x.gain / x.cost }))
    .sort((a, b) => b.value - a.value);
}

// When `cost` is covered by mesos held plus weekly income. null = never at this income.
export function affordableAt(cost, held, weekly, now) {
  const short = cost - (held || 0);
  if (short <= 0) return now;
  if (!(weekly > 0)) return null;
  return now + (short / weekly) * 7 * DAY;
}
