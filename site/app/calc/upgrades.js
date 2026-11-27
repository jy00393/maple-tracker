// Cubes, potential lines, EXP and Sol Erda maths. Pure functions over data/upgrades.json.

// ---------- cubes ----------
// Tiers: 1 Rare, 2 Epic, 3 Unique, 4 Legendary. tierUp[0] is Rare -> Epic. Each cube is an independent try.
export function cubePlan(cube, fromTier, toTier) {
  const start = Math.max(1, Math.min(4, Math.floor(Number(fromTier) || 0)));
  toTier = Math.max(1, Math.min(4, Math.floor(Number(toTier) || 0)));
  const legs = [];
  let expected = 0;
  for (let t = start; t < toTier; t++) {
    const p = cube.tierUp[t - 1];
    legs.push({ from: t, to: t + 1, p, expected: 1 / p, n90: Math.ceil(Math.log(0.1) / Math.log(1 - p)) });
    expected += 1 / p;
  }
  // 90% bound for the whole path: smallest n with P(sum of the geometric legs <= n) >= 0.9, by dynamic programming.
  // The same sum gives the cubes needed to be 50%, 75%, 90% and 95% sure.
  const sure = { 50: 0, 75: 0, 90: 0, 95: 0 };
  if (legs.length) {
    const L = legs.length;
    // state[i] = chance of being on leg i after n cubes; state[L] = reached the target tier.
    let state = Array.from({ length: L + 1 }, (_, i) => (i === 0 ? 1 : 0));
    let n = 0;
    while (state[L] < 0.95 && n < 20000) {
      const next = new Array(L + 1).fill(0);
      next[L] = state[L];
      for (let i = 0; i < L; i++) {
        next[i] += state[i] * (1 - legs[i].p);
        next[i + 1] += state[i] * legs[i].p;
      }
      state = next;
      n++;
      for (const q of [50, 75, 90, 95]) if (!sure[q] && state[L] >= q / 100) sure[q] = n;
    }
    for (const q of [50, 75, 90, 95]) if (!sure[q]) sure[q] = n;
  }
  const n90 = sure[90];
  return { legs, expected, cost: expected * cube.price, n90, cost90: n90 * cube.price, sure };
}

// ---------- potential lines ----------
const MAIN = ['STR', 'DEX', 'INT', 'LUK'];

// A character's main stat setting: one of the four stats, 'HP' (Demon Avenger) or 'XENON' (STR, DEX and LUK).
export const MAIN_STAT_CHOICES = [['STR', 'STR'], ['DEX', 'DEX'], ['INT', 'INT'], ['LUK', 'LUK'], ['HP', 'Max HP (Demon Avenger)'], ['XENON', 'STR + DEX + LUK (Xenon)']];
export function mainStatLabel(mainStat) {
  return mainStat === 'HP' ? 'Max HP' : mainStat === 'XENON' ? 'STR+DEX+LUK' : mainStat || 'STR';
}
// Does a line for `stat` count as main stat for this character?
export function isMainStat(stat, mainStat) {
  if (mainStat === 'XENON') return stat === 'STR' || stat === 'DEX' || stat === 'LUK';
  return stat === (mainStat || 'STR');
}
// A class's main stat from data/classes.json (classStats = its "mainStat" map), matched without regard to case.
// Without the map only the two special classes are known.
export function mainStatForClass(cls, classStats) {
  const c = String(cls || '').trim().toLowerCase();
  if (classStats) {
    for (const [name, stat] of Object.entries(classStats)) if (name.toLowerCase() === c) return stat;
    return null;
  }
  return c === 'demon avenger' ? 'HP' : c === 'xenon' ? 'XENON' : null;
}
// What picking a class does to the main stat: a special class sets its own; leaving a special class whose stat
// was set that way goes back to STR; otherwise the player's choice is left alone. Returns {} or { mainStat }.
// Picking a known class sets its main stat. Typing a name the list doesn't know leaves the choice alone, except that
// leaving a special class whose stat was set that way goes back to STR. Returns {} or { mainStat }.
export function mainStatOnClassChange(oldCls, newCls, mainStat, classStats) {
  const known = mainStatForClass(newCls, classStats);
  if (known) return { mainStat: known };
  if ((mainStat === 'HP' || mainStat === 'XENON') && mainStatForClass(oldCls, classStats) === mainStat) return { mainStat: 'STR' };
  return {};
}
// The damage estimate only knows the standard formula.
export function damageEstimateSupported(mainStat) {
  return mainStat !== 'HP' && mainStat !== 'XENON';
}
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
  opts.push('hp', 'other'); // 'offstat' ("Other stat %") is no longer offered: the four stats are listed by name. Saved lines still show.
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
// Magicians use Magic ATT; everyone else uses (Weapon) ATT.
export function attackLine(mainStat) {
  return mainStat === 'INT' ? 'matt' : 'att';
}
// Does a stat line raise this character's main stat? One rule for the gear score and the stat totals:
// a main-stat line counts when it is for the character's stat (a line saved without a stat was entered for it),
// Max HP % counts only for a Max HP character, and All Stats % for everyone else (it does not raise HP).
export function countsAsMain(line, mainStat = 'STR') {
  if (!line) return false;
  if (line.type === 'main') return !line.stat || isMainStat(line.stat, mainStat);
  if (line.type === 'hp') return mainStat === 'HP';
  if (line.type === 'allstat') return mainStat !== 'HP';
  return false;
}
export function lineKind(slot, line, mainStat = 'STR') {
  if (!line || !line.type) return 'none';
  if (line.type === 'meso' || line.type === 'drop') return 'farm';
  if (line.type === 'main' || line.type === 'allstat' || line.type === 'hp') return countsAsMain(line, mainStat) ? 'damage' : 'other';
  if (DAMAGE.has(line.type)) return 'damage';
  if ((line.type === 'dmg' || line.type === attackLine(mainStat)) && ['weapon', 'secondary', 'emblem'].includes(slot.type)) return 'damage';
  return 'other';
}

// Useful lines on a slot: damage lines, plus meso/drop lines on accessories (they're there on purpose).
export function usefulLines(slot, entry, mainStat = 'STR') {
  if (!Array.isArray(entry.potLines)) return entry.lines || 0;
  return entry.potLines.filter((l) => ['damage', 'farm'].includes(lineKind(slot, l, mainStat))).length;
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
      if (countsAsMain(l, mainStat)) out.main += v;
      else if (l.type === 'boss') out.boss += v;
      else if (l.type === 'meso') out.meso += v;
      else if (l.type === 'drop') out.drop += v;
      else if (l.type === attackLine(mainStat)) out.att += v;
      else if (l.type === 'critdmg') out.critdmg += v;
      else if (l.type === 'cdr') out.cdr += v;
      else if (l.type === 'ied') iedKeep *= 1 - v / 100;
      const kind = lineKind(slot, l, mainStat);
      if (kind === 'damage') out.damageLines++;
      if (kind === 'farm') out.farmLines++;
    }
  }
  out.ied = Math.round((1 - iedKeep) * 1000) / 10;
  return out;
}

export function lineLabel(line, mainStat = 'STR') {
  if (!line || !line.type) return '';
  // Lines picked from the real tables carry the game's own wording.
  if (line.text) return line.text;
  const t = LINE_TYPES[line.type] || LINE_TYPES.other;
  if (line.type === 'other') return line.text || 'Other line';
  if (line.type === 'cdr') return `Cooldown -${line.value || 0}s`;
  const name = line.type === 'main' || (line.type === 'offstat' && line.stat) ? `${line.stat || mainStat} %` : t.label(mainStat);
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
  // Levels are whole numbers; a decimal is rounded down so it can never point between two rows of the table.
  for (let l = Math.max(1, Math.floor(Number(from) || 0)); l < to && l - 1 < perLevel.length; l++) {
    sol += perLevel[l - 1][0];
    frag += perLevel[l - 1][1];
  }
  return { sol, frag };
}

// The most Sol Erda a character of `level` can hold, from a [[fromLevel, cap], ...] table (upgrades.json
// erda.holdCap). Null below the first row, for an unknown level, or without a table.
export function solErdaCap(level, table) {
  if (!Number.isFinite(level) || !Array.isArray(table)) return null;
  let cap = null;
  for (const row of table) {
    if (Array.isArray(row) && Number.isFinite(row[0]) && Number.isFinite(row[1]) && level >= row[0]) cap = row[1];
  }
  return cap;
}
