// What to upgrade next: expected cost per gear slot, and the options ranked by gear score gained per meso.
import { gearSummary, slotProgress } from './progress.js';
import { starPlan, maxStarsFor } from './starforce.js';
import { cubePlan, hasPotential } from './upgrades.js';
import { DAY } from '../time.js';
import { plural } from './plural.js';
import { starDelta, damageGain, cleanFlame } from './gearstats.js';
import { scoreDist, flameScore, flameWeights, flamesSupported } from './flames.js';

const POT = ['None', 'Rare', 'Epic', 'Unique', 'Legendary'];

export function itemLevel(slot, entry) {
  if (entry.ilvl) return entry.ilvl;
  return slot.type === 'ring' && (entry.tier || 0) <= 1 ? 120 : 160;
}

// The Star Force and cube tables with the cube tier-up odds the player typed in on Mesos > Cubes (state.mesos.
// cubeRates), so every page uses the same estimate.
export function withCubeRates(up, rates) {
  if (!rates || typeof rates !== 'object') return up;
  const types = { ...up.cubes.types };
  for (const [id, r] of Object.entries(rates)) if (types[id] && Array.isArray(r) && r.length === 3) types[id] = { ...types[id], tierUp: r };
  return { ...up, cubes: { ...up.cubes, types } };
}

// Expected cost to bring a slot to its target: Star Force (normal day and Sunny Sunday) and cube tier-ups (Bright
// and Glowing). capped = the item's star limit is below the target, so stars alone can never meet it.
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
    if ((target.stars || 0) > max) out.capped = { max, target: target.stars };
  }
  if (hasPotential(slot) && (target.pot || 0) > (entry.pot || 0)) {
    out.cube = { from: entry.pot || 0, to: target.pot, bright: cubePlan(up.cubes.types.bright, entry.pot || 1, target.pot), glowing: cubePlan(up.cubes.types.glowing, entry.pot || 1, target.pot) };
  }
  return out;
}

// Every meso upgrade that moves a permanent item toward its target, best value first.
// gain = share of the overall gear score it adds (the tracker's own scoring, not a damage number).
// With gearStats (data/gearstats.json) and the character's own stats, Star Force options also get
// dmg: the estimated damage gain as a fraction, and dmgPartial when part of the gain is unknown.
export function upgradeOptions(gearData, gearState, up, gearStats, stats, flameCtx) {
  const sum = gearSummary(gearData, gearState, (flameCtx && flameCtx.mainStat) || 'STR');
  const totalWeight = sum.totalWeight || 1;
  // An item below its slot's target tier is one to replace: no mesos go into it, flames included (the same rule
  // as slotOutlook's "replace"). A Bottom covered by an overall is not worn at all.
  const skip = new Set(sum.slots.filter((r) => r.covered || (r.entry.tier && r.entry.tier < (r.target.tier || 0))).map((r) => r.slot.id));
  const out = (flameCtx && flameCtx.fl ? flameOptions(gearData, gearState, flameCtx.fl, flameCtx.mainStat, stats, flameCtx.weights) : []).filter((o) => !skip.has(o.slotId));
  for (const r of sum.gaps) {
    if (r.entry.temporary || !r.entry.tier) continue;
    const o = slotOutlook(r.slot, r.entry, r.target, up);
    if (o.replace) continue;
    const tierNames = gearData.slotTypes[r.slot.type].filter(Boolean);
    const gainOf = (patch) => (r.slot.weight * (slotProgress({ ...r.entry, ...patch }, r.target, tierNames).pct - r.pct)) / totalWeight;
    if (o.sf) {
      const opt = { slotId: r.slot.id, kind: 'sf', label: `${r.slot.name}: ${o.sf.from} → ${o.sf.to} ${plural(o.sf.to, 'star')}`, cost: o.sf.plain.cost, sunnyCost: o.sf.sunny.cost, booms: o.sf.plain.booms, gain: gainOf({ stars: o.sf.to }) };
      if (gearStats && gearStats.starforce) {
        const d = starDelta(gearStats.starforce, r.slot, itemLevel(r.slot, r.entry), o.sf.from, o.sf.to);
        const dmg = damageGain(stats, d);
        opt.sfGain = d;
        if (dmg !== null && dmg > 0) { opt.dmg = dmg; opt.dmgPartial = d.partial; }
      }
      out.push(opt);
    }
    if (o.cube) {
      // A pure tier-up is priced with whichever cube gets there for less, as Mesos > Cubes recommends. The plan
      // starts at Rare (an item with no potential needs a potential scroll first), so the label does too.
      const cube = o.cube.glowing.cost < o.cube.bright.cost ? 'glowing' : 'bright';
      const plan = o.cube[cube];
      out.push({ slotId: r.slot.id, kind: 'cube', cube, cubeName: up.cubes.types[cube].name, needsScroll: !o.cube.from, label: `${r.slot.name}: potential ${POT[Math.max(1, o.cube.from)]} → ${POT[o.cube.to]} with ${up.cubes.types[cube].name}s`, cost: plan.cost, cost90: plan.cost90, gain: gainOf({ pot: o.cube.to }) });
    }
  }
  return out
    .filter((x) => x.cost > 0 && (x.gain > 0 || x.dmg > 0))
    .map((x) => ({ ...x, value: x.gain / x.cost }))
    .sort((a, b) => b.value - a.value);
}

// Flame rerolls worth ranking: for every permanent armour or accessory with a flame typed in, the cost of
// rerolling with mesos until the flame score beats the current one, and the score that gains on average.
// A flame score point counts as one main stat. Needs the character's stats; without them nothing is returned,
// because flames are not part of the gear score.
export function flameOptions(gearData, gearState, fl, mainStat = 'STR', stats, customWeights) {
  if (!flamesSupported(mainStat) || !gearState || !gearState.slots) return [];
  const weights = flameWeights(fl, customWeights);
  const reset = fl.types.find((t) => t.price > 0);
  if (!reset) return [];
  const out = [];
  for (const slot of gearData.slots) {
    const entry = gearState.slots[slot.id];
    if (!entry || !entry.tier || entry.temporary || slot.id === 'weapon' || fl.noFlameSlots.includes(slot.id) || !cleanFlame(entry.flame)) continue;
    const now = flameScore(entry.flame, weights);
    const dist = scoreDist(fl, { level: itemLevel(slot, entry), mainStat, type: reset.id, advantaged: entry.flameAdv !== false, weights });
    let chance = 0;
    let extra = 0;
    // "Better" means at least one whole point higher, the same target the Flame calculator sets for this item.
    const goal = Math.floor(now) + 1;
    for (const [score, p] of dist) if (score >= goal) { chance += p; extra += p * (score - now); }
    if (!(chance > 0)) continue;
    const gainScore = extra / chance;
    const dmg = damageGain(stats, { main: gainScore });
    if (!(dmg > 0)) continue;
    out.push({ slotId: slot.id, kind: 'flame', label: `${slot.name}: reroll the flame (score ${Math.round(now)} now)`, cost: reset.price / chance, cost90: reset.price * Math.ceil(Math.log(0.1) / Math.log(1 - Math.min(chance, 0.999999))),
      flames: 1 / chance, chance, flameNow: now, flameGain: gainScore, gain: 0, dmg });
  }
  return out;
}

// The single best option. When damage estimates exist (your stats are entered), Star Force options are ranked by
// damage per meso; potential tier-ups have no fixed damage value (it depends on the lines you roll), so they are
// only suggested when no Star Force option has an estimate.
export function bestUpgrade(options) {
  const withDmg = (options || []).filter((o) => o.dmg > 0 && Number.isFinite(o.cost) && o.cost > 0);
  if (withDmg.length) return { ...withDmg.slice().sort((a, b) => b.dmg / b.cost - a.dmg / a.cost)[0], by: 'damage' };
  return options && options.length ? { ...options[0], by: 'score' } : null;
}

// When `cost` is covered by mesos held plus weekly income. null = never at this income.
export function affordableAt(cost, held, weekly, now) {
  const short = cost - (held || 0);
  if (short <= 0) return now;
  if (!(weekly > 0)) return null;
  const at = now + (short / weekly) * 7 * DAY;
  // More than a hundred years away: Infinity, so the page can say "not in reach" rather than "add your income".
  return at - now <= 100 * 365.25 * DAY ? at : Infinity;
}
