// Real potential lines per equipment group and tier, from data/potential.json (see its source note).
// A saved line is { pid, prime, text, type, stat?, value }: pid points at the data, text is what the game shows,
// and type/value feed the totals and "useful line" counts in upgrades.js.

export function groupOf(pot, slotId) {
  return pot.slotGroup[String(slotId || '').replace(/\d+$/, '')] || null;
}

// Value of a line on an item of this level; null when the line has no level-scaled value.
export function lineValue(line, itemLevel) {
  const bands = line[1];
  if (!bands) return null;
  let v = null;
  for (const [min, val] of bands) if (itemLevel >= min) v = val;
  return v;
}

export function lineAvailable(line, itemLevel) {
  if (line[2] && itemLevel < line[2]) return false;
  return !line[1] || lineValue(line, itemLevel) !== null;
}

export function lineText(line, itemLevel) {
  const v = lineValue(line, itemLevel);
  return v === null ? line[0] : line[0].replace('{v}', String(v));
}

import { isMainStat } from './upgrades.js';

// What a line means for the tracker's totals. Lines the totals don't use are 'other'.
export function classify(line, itemLevel) {
  const t = line[0];
  const v = lineValue(line, itemLevel);
  let m;
  if ((m = /^(STR|DEX|INT|LUK) \+\{v\}%$/.exec(t))) return { type: 'main', stat: m[1], value: v };
  if (t === 'All Stats +{v}%') return { type: 'allstat', value: v };
  if (t === 'MaxHP +{v}%') return { type: 'hp', value: v };
  if (t === 'Weapon ATT +{v}%') return { type: 'att', value: v };
  if (t === 'Magic ATT +{v}%') return { type: 'matt', value: v };
  if (t === 'Damage +{v}%') return { type: 'dmg', value: v };
  if (t === 'Critical Damage +{v}%') return { type: 'critdmg', value: v };
  if (t === 'Mesos Obtained +{v}%') return { type: 'meso', value: v };
  if (t === 'Item Drop Rate +{v}%') return { type: 'drop', value: v };
  if ((m = /^Damage to Boss Monsters \+(\d+)%$/.exec(t))) return { type: 'boss', value: Number(m[1]) };
  if ((m = /^Ignore (\d+)% of Monster's DEF when attacking$/.exec(t))) return { type: 'ied', value: Number(m[1]) };
  if ((m = /^Skill Cooldown -(\d+) seconds?$/.exec(t))) return { type: 'cdr', value: Number(m[1]) };
  return { type: 'other', value: v };
}

const USEFUL = new Set(['main', 'allstat', 'att', 'matt', 'dmg', 'boss', 'ied', 'critdmg', 'cdr', 'meso', 'drop']);

// Choices for one line of an item: prime lines of its tier, then non-prime lines (the tier below's pool).
// Each is { pid, prime, text, useful }, with lines the item level can't roll left out and useful lines first.
export function lineChoices(pot, slotId, tier, itemLevel, mainStat) {
  const group = groupOf(pot, slotId);
  const pools = group && pot.pools[group];
  if (!pools || !(tier >= 1 && tier <= 4)) return [];
  const build = (poolIndex, prime) => (pools[poolIndex] || [])
    .filter((pid) => pot.lines[pid] && lineAvailable(pot.lines[pid], itemLevel))
    .map((pid) => {
      const c = classify(pot.lines[pid], itemLevel);
      // With the character's main stat known, the other three stat lines are not useful ones.
      const useful = mainStat === 'HP'
        ? c.type === 'hp' || (USEFUL.has(c.type) && c.type !== 'main' && c.type !== 'allstat')
        : USEFUL.has(c.type) && (c.type !== 'main' || !mainStat || isMainStat(c.stat, mainStat));
      return { pid, prime, text: lineText(pot.lines[pid], itemLevel), useful };
    })
    .sort((a, b) => Number(b.useful) - Number(a.useful));
  return [...build(tier, true), ...build(tier - 1, false)];
}

// The saved form of a choice.
export function makeLine(pot, choice, itemLevel, mainStat) {
  const c = classify(pot.lines[choice.pid], itemLevel);
  // A stat line for a stat other than the character's is saved as 'offstat', which no total or score counts.
  let type = c.type;
  let stat = c.stat;
  if (mainStat === 'HP') {
    // Demon Avenger: Max HP % is the main-stat line; the four stats and All Stats are not.
    if (c.type === 'hp') { type = 'main'; stat = 'HP'; } else if (c.type === 'main' || c.type === 'allstat') type = 'offstat';
  } else if (c.type === 'main' && mainStat && !isMainStat(c.stat, mainStat)) type = 'offstat';
  const out = { pid: choice.pid, prime: choice.prime, text: choice.text, type, value: c.value };
  if (stat) out.stat = stat;
  return out;
}

// After the item level or tier changes: refresh each data-backed line's text and value. Lines saved before the
// real tables existed (no pid) are kept as they are. A line the item can no longer have is dropped, unless
// keepMissing is set: the level box saves on every keystroke, so a half-typed level must never delete a line.
export function refreshLines(pot, slotId, tier, itemLevel, potLines, opts = {}) {
  const choices = lineChoices(pot, slotId, tier, itemLevel, opts.mainStat);
  return (potLines || []).map((l) => {
    if (!l || !l.type) return { type: '' };
    if (l.pid === undefined || l.pid === null) return l;
    const hit = choices.find((c) => c.pid === l.pid && c.prime === Boolean(l.prime)) || choices.find((c) => c.pid === l.pid);
    if (hit) return makeLine(pot, hit, itemLevel, opts.mainStat);
    return opts.keepMissing ? l : { type: '' };
  });
}

// After a character's main stat changes: every table-backed line on its gear is classified again under the new
// rule (a STR line stops being a main-stat line for a Demon Avenger, and so on). Changes gearState in place.
export function reclassifyLines(data, gearState, mainStat) {
  if (!gearState || !gearState.slots) return;
  for (const slot of data.gear.slots) {
    const e = gearState.slots[slot.id];
    if (!e || !Array.isArray(e.potLines) || !e.pot) continue;
    const level = e.ilvl || (slot.type === 'ring' && (e.tier || 0) <= 1 ? 120 : 160);
    e.potLines = refreshLines(data.potential, slot.id, e.pot, level, e.potLines, { mainStat, keepMissing: true });
  }
}
