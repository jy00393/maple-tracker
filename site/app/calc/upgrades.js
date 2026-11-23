// Cubes, potential lines, EXP and Sol Erda maths. Pure functions over data/upgrades.json.

// ---------- cubes ----------
// Tiers: 1 Rare, 2 Epic, 3 Unique, 4 Legendary. tierUp[0] is Rare -> Epic. Each cube is an independent try.
export function cubePlan(cube, fromTier, toTier) {
  const start = Math.max(1, fromTier || 0);
  const legs = [];
  let expected = 0;
  for (let t = start; t < toTier; t++) {
    const p = cube.tierUp[t - 1];
    legs.push({ from: t, to: t + 1, p, expected: 1 / p, n90: Math.ceil(Math.log(0.1) / Math.log(1 - p)) });
    expected += 1 / p;
  }
  // 90% bound for the whole path: smallest n with P(sum of the geometric legs <= n) >= 0.9, by dynamic programming.
  let n90 = 0;
  if (legs.length) {
    const L = legs.length;
    // state[i] = chance of being on leg i after n cubes; state[L] = reached the target tier.
    let state = Array.from({ length: L + 1 }, (_, i) => (i === 0 ? 1 : 0));
    let n = 0;
    while (state[L] < 0.9 && n < 20000) {
      const next = new Array(L + 1).fill(0);
      next[L] = state[L];
      for (let i = 0; i < L; i++) {
        next[i] += state[i] * (1 - legs[i].p);
        next[i + 1] += state[i] * legs[i].p;
      }
      state = next;
      n++;
    }
    n90 = n;
  }
  return { legs, expected, cost: expected * cube.price, n90, cost90: n90 * cube.price };
}

// ---------- potential lines ----------
const MAIN = ['STR', 'DEX', 'INT', 'LUK'];
export const LINE_TYPES = {
  main: { label: (ms) => `${ms} %`, unit: '%' },
  allstat: { label: () => 'All Stats %', unit: '%' },
  hp: { label: () => 'Max HP %', unit: '%' },
  att: { label: () => 'ATT %', unit: '%' },
  matt: { label: () => 'Magic ATT %', unit: '%' },
  boss: { label: () => 'Boss Damage %', unit: '%' },
  ied: { label: () => 'Ignore Enemy DEF %', unit: '%' },
  dmg: { label: () => 'Damage %', unit: '%' },
  critdmg: { label: () => 'Critical Damage %', unit: '%' },
  cdr: { label: () => 'Skill Cooldown', unit: 's' },
  meso: { label: () => 'Meso Obtained %', unit: '%' },
  drop: { label: () => 'Item Drop Rate %', unit: '%' },
  offstat: { label: () => 'Other stat %', unit: '%' },
  other: { label: () => 'Other line', unit: '' }
};

const MESO_DROP_SLOTS = new Set(['face', 'eye', 'earrings', 'pendant1', 'pendant2', 'ring1', 'ring2', 'ring3', 'ring4']);
const NO_POTENTIAL = new Set(['pocket', 'badge']);

export function hasPotential(slot) {
  return !NO_POTENTIAL.has(slot.id) && !slot.noPot;
}

// Line types the slot can roll at this tier (GMS). Damage lines first, then farming lines, then the rest.
export function lineOptions(slot, tier) {
  if (!hasPotential(slot) || !tier) return [];
  const t = slot.type;
  const opts = ['main', 'allstat'];
  if (['weapon', 'secondary', 'emblem'].includes(t)) {
    opts.length = 0;
    opts.push('att', 'main');
    if (t !== 'emblem' && tier >= 3) opts.push('boss');
    if (tier >= 3) opts.push('ied');
    opts.push('dmg', 'matt');
  }
  if (slot.id === 'gloves' && tier >= 4) opts.push('critdmg');
  if (t === 'hat' && tier >= 4) opts.push('cdr');
  if (MESO_DROP_SLOTS.has(slot.id) && tier >= 4) opts.push('meso', 'drop');
  opts.push('hp', 'offstat', 'other');
  return opts;
}

export function bandValues(up, itemLevel) {
  let row = up.potential.statByBand[0][1];
  for (const [lvl, vals] of up.potential.statByBand) if ((itemLevel || 160) >= lvl) row = vals;
  return row;
}

// Typical prime value for a line type; the player can overwrite it.
export function defaultValue(up, type, tier, itemLevel) {
  const row = bandValues(up, itemLevel);
  const main = row[tier - 1] || 0;
  switch (type) {
    case 'main': case 'att': case 'matt': case 'hp': case 'dmg': case 'offstat': return main;
    case 'allstat': return Math.max(1, main - (tier >= 3 ? 3 : tier === 2 ? 2 : 1));
    case 'boss': return tier >= 4 ? 40 : 30;
    case 'ied': return tier >= 4 ? 40 : 30;
    case 'critdmg': return 8;
    case 'cdr': return 2;
    case 'meso': case 'drop': return 20;
    default: return 0;
  }
}

const DAMAGE = new Set(['main', 'allstat', 'boss', 'ied', 'critdmg', 'cdr']);
const WSE_DAMAGE = new Set(['att', 'dmg']);
export function lineKind(slot, line) {
  if (!line || !line.type) return 'none';
  if (line.type === 'meso' || line.type === 'drop') return 'farm';
  if (DAMAGE.has(line.type)) return 'damage';
  if (WSE_DAMAGE.has(line.type) && ['weapon', 'secondary', 'emblem'].includes(slot.type)) return 'damage';
  return 'other';
}

// Useful lines on a slot: damage lines, plus meso/drop lines on accessories (they're there on purpose).
export function usefulLines(slot, entry) {
  if (!Array.isArray(entry.potLines)) return entry.lines || 0;
  return entry.potLines.filter((l) => ['damage', 'farm'].includes(lineKind(slot, l))).length;
}

// Totals across all gear: main stat % (incl. All Stats), boss, meso, drop, IED combined multiplicatively.
export function lineTotals(slots, gearState, mainStat = 'STR') {
  const out = { main: 0, boss: 0, meso: 0, drop: 0, att: 0, critdmg: 0, cdr: 0, ied: 0, damageLines: 0, farmLines: 0 };
  let iedKeep = 1;
  for (const slot of slots) {
    const e = (gearState.slots || {})[slot.id];
    if (!e || !Array.isArray(e.potLines) || !e.tier) continue;
    for (const l of e.potLines) {
      const v = Number(l.value) || 0;
      if (l.type === 'main' && (l.stat || 'STR') === mainStat) out.main += v;
      else if (l.type === 'allstat') out.main += v;
      else if (l.type === 'boss') out.boss += v;
      else if (l.type === 'meso') out.meso += v;
      else if (l.type === 'drop') out.drop += v;
      else if (l.type === 'att') out.att += v;
      else if (l.type === 'critdmg') out.critdmg += v;
      else if (l.type === 'cdr') out.cdr += v;
      else if (l.type === 'ied') iedKeep *= 1 - v / 100;
      const kind = lineKind(slot, l);
      if (kind === 'damage') out.damageLines++;
      if (kind === 'farm') out.farmLines++;
    }
  }
  out.ied = Math.round((1 - iedKeep) * 1000) / 10;
  return out;
}

export function lineLabel(line, mainStat = 'STR') {
  if (!line || !line.type) return '';
  const t = LINE_TYPES[line.type] || LINE_TYPES.other;
  if (line.type === 'other') return line.text || 'Other line';
  if (line.type === 'cdr') return `Cooldown -${line.value || 0}s`;
  const name = line.type === 'main' ? `${line.stat || mainStat} %` : t.label(mainStat);
  return `${name.replace(' %', '')} +${line.value || 0}${t.unit}`;
}

export { MAIN as MAIN_STATS };

// ---------- EXP ----------
export function expToNext(exp, level) {
  const i = level - exp.from;
  return i >= 0 && i < exp.toNext.length ? exp.toNext[i] : null;
}

function step(level, beyond) {
  let l = level + 1;
  if (beyond && l < 280) l += 1;
  return l;
}

// EXP still needed from (level, fraction into it) to reach `target`. Beyond Burning makes every other level free below 280.
export function expToReach(exp, level, frac, target, beyond) {
  let total = 0;
  let l = level;
  let f = Math.max(0, Math.min(1, frac || 0));
  while (l < target) {
    const need = expToNext(exp, l);
    if (need == null) return Infinity;
    total += need * (1 - f);
    f = 0;
    l = step(l, beyond);
  }
  return total;
}

// EXP earned between two readings {level, frac}. Falls back to the plain path if the levels don't fit Beyond Burning.
export function expBetween(exp, a, b, beyond) {
  if (b.level < a.level || (b.level === a.level && b.frac < a.frac)) return null;
  const at = (l) => expToNext(exp, l);
  if (a.level === b.level) return at(a.level) == null ? null : (b.frac - a.frac) * at(a.level);
  if (at(a.level) == null) return null;
  let total = (1 - a.frac) * at(a.level);
  let l = step(a.level, beyond);
  while (l < b.level) {
    if (at(l) == null) return null;
    total += at(l);
    l = step(l, beyond);
  }
  if (l !== b.level) return beyond ? expBetween(exp, a, b, false) : null;
  return at(b.level) == null ? null : total + b.frac * at(b.level);
}

// readings: [{t, level, frac}] oldest first. Rate from the last `days` of readings.
export function expRate(exp, readings, beyond, days = 14, now = Date.now()) {
  const pts = readings.filter((r) => r && Number.isFinite(r.t) && now - r.t <= days * 86400000).sort((x, y) => x.t - y.t);
  if (pts.length < 2) return null;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const spanDays = (b.t - a.t) / 86400000;
  if (spanDays < 0.25) return null;
  const gained = expBetween(exp, a, b, beyond);
  if (gained == null || gained <= 0) return null;
  return { perDay: gained / spanDays, spanDays, from: a, to: b };
}

// ---------- Sol Erda ----------
// Cost of taking a node from level `from` to `to` with a per-level table ([[sol, frag], ...] for 1->2 ... 29->30).
export function erdaCost(perLevel, from, to) {
  let sol = 0;
  let frag = 0;
  for (let l = Math.max(1, from); l < to && l - 1 < perLevel.length; l++) {
    sol += perLevel[l - 1][0];
    frag += perLevel[l - 1][1];
  }
  return { sol, frag };
}
