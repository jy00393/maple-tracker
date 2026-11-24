// Gear stat totals beyond potential lines: bonus stats (flames) typed in per slot.
// A flame is { main, sub, att, allstat, boss, dmg }: flat main stat, flat secondary stat, flat ATT (or Magic ATT), All Stats %, Boss Damage %,
// Damage %. Every field is optional and entered by hand from the item tooltip.
export const FLAME_FIELDS = [
  ['main', 'Main stat', ''],
  ['sub', 'Secondary stat', ''],
  ['att', 'ATT', ''],
  ['allstat', 'All Stats', '%'],
  ['boss', 'Boss Damage', '%'],
  ['dmg', 'Damage', '%']
];

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

export function cleanFlame(flame) {
  const out = {};
  for (const [key] of FLAME_FIELDS) if (num(flame && flame[key])) out[key] = num(flame[key]);
  return Object.keys(out).length ? out : null;
}

export function flameLabel(flame, mainStat = 'STR') {
  const f = cleanFlame(flame);
  if (!f) return '';
  const parts = [];
  if (f.main) parts.push(`${mainStat} +${f.main}`);
  if (f.sub) parts.push(`Secondary +${f.sub}`);
  if (f.att) parts.push(`ATT +${f.att}`);
  if (f.allstat) parts.push(`All Stats +${f.allstat}%`);
  if (f.boss) parts.push(`Boss +${f.boss}%`);
  if (f.dmg) parts.push(`Damage +${f.dmg}%`);
  return parts.join(' · ');
}

// Sum over equipped (non-empty) slots.
export function flameTotals(slots, gearState) {
  const out = { main: 0, sub: 0, att: 0, allstat: 0, boss: 0, dmg: 0, items: 0 };
  for (const slot of slots || []) {
    const e = ((gearState && gearState.slots) || {})[slot.id];
    if (!e || !e.tier) continue;
    const f = cleanFlame(e.flame);
    if (!f) continue;
    out.items++;
    for (const [key] of FLAME_FIELDS) out[key] += f[key] || 0;
  }
  return out;
}

// ---------- Star Force stats (data/gearstats.json, MapleStory Wiki) ----------
function column(levels, itemLevel) {
  let c = -1;
  levels.forEach((min, i) => { if (itemLevel >= min) c = i; });
  return c;
}

// Stats an item has gained from its stars: { stat, att, partial }. "stat" is the class stat (main and secondary
// each get it). partial is true when part of it is unknown: weapon ATT at stars 1 to 15 depends on the weapon's
// base ATT, and items under Lv. 128 are not in the table.
export function starStats(sf, slot, itemLevel, stars, fromStar = 0) {
  const out = { stat: 0, att: 0, partial: false };
  const n = Math.max(0, Math.floor(stars || 0));
  if (!sf || !slot || !slot.sf || n === 0) return out;
  const isWeapon = slot.type === 'weapon';
  const table = isWeapon ? sf.weapon : sf.armor;
  const col = column(sf.levels, itemLevel);
  if (col < 0) return { ...out, partial: true };
  for (let s = Math.max(0, Math.floor(fromStar || 0)) + 1; s <= n; s++) {
    const statRow = table.stat[s - 1];
    const attRow = table.att[s - 1];
    const stat = statRow ? statRow[Math.min(col, statRow.length - 1)] : null;
    if (stat === null || stat === undefined) out.partial = true;
    else out.stat += stat;
    if (isWeapon && attRow === null) out.partial = true; // stars 1 to 15 on a weapon: needs base ATT
    else {
      const att = attRow ? attRow[Math.min(col, attRow.length - 1)] : null;
      if (att === null || att === undefined) out.partial = true;
      else out.att += att;
    }
    if (!isWeapon && slot.id === 'gloves' && sf.gloveAtt[s - 1]) out.att += sf.gloveAtt[s - 1][Math.min(col, sf.gloveAtt[s - 1].length - 1)] || 0;
  }
  return out;
}

export function starDelta(sf, slot, itemLevel, from, to) {
  // Only the stars being added matter, so a weapon going from 17 to 22 stars is fully known.
  return starStats(sf, slot, itemLevel, to, from);
}

// ---------- set effects ----------
// named: every item name that some set lists explicitly. Such an item belongs to that set only, so a loose
// prefix ("Royal ", "Genesis ") never pulls "Royal Black Metal Shoulder" or "Genesis Badge" into another set.
function inSet(set, name, named) {
  const m = set.match || {};
  if (m.names) return m.names.includes(name);
  if (named.has(name)) return false;
  if (m.prefixes && m.prefixes.some((p) => name.startsWith(p))) return true;
  if (m.all && m.all.every((w) => name.includes(w))) return true;
  return false;
}

// Sets recognised from the item names picked on each slot: [{ id, name, count, total, bonus, nextAt }]
// bonus sums every step at or below the pieces worn; IED multiplies. Each slot counts once.
export function detectSets(setsData, slots, gearState) {
  const out = [];
  const named = new Set(((setsData && setsData.list) || []).flatMap((s) => (s.match && s.match.names) || []));
  for (const set of (setsData && setsData.list) || []) {
    let count = 0;
    for (const slot of slots || []) {
      const e = ((gearState && gearState.slots) || {})[slot.id];
      if (e && e.tier && e.note && inSet(set, String(e.note).trim(), named)) count++;
    }
    if (!count) continue;
    const bonus = { allStats: 0, att: 0, boss: 0, ied: 0, critDmg: 0 };
    let keep = 1;
    let nextAt = null;
    for (const n of Object.keys(set.steps).map(Number).sort((a, b) => a - b)) {
      if (n > count) { nextAt = nextAt ?? n; continue; }
      const step = set.steps[n];
      bonus.allStats += step.allStats || 0;
      bonus.att += step.att || 0;
      bonus.boss += step.boss || 0;
      bonus.critDmg += step.critDmg || 0;
      if (step.ied) keep *= 1 - step.ied / 100;
    }
    bonus.ied = Math.round((1 - keep) * 1000) / 10;
    out.push({ id: set.id, name: set.name, count: Math.min(count, set.total), worn: count, total: set.total, bonus, nextAt });
  }
  return out;
}

export function setBonusLabel(b) {
  const parts = [];
  if (b.allStats) parts.push(`All Stats +${b.allStats}`);
  if (b.att) parts.push(`ATT +${b.att}`);
  if (b.boss) parts.push(`Boss +${b.boss}%`);
  if (b.ied) parts.push(`IED ${b.ied}%`);
  if (b.critDmg) parts.push(`Crit Damage +${b.critDmg}%`);
  return parts.join(' · ');
}

// ---------- damage estimate ----------
// How much a flat gain of class stat and ATT raises damage, as a fraction, from the wiki's damage formula:
// damage is proportional to (4 x main stat + secondary stat) x ATT, where a flat stat gain is multiplied by
// (1 + stat %) and a flat ATT gain by (1 + ATT %).
// stats = { main, sub, att, mainPct, attPct }: the totals from your in-game stat window. null when not usable.
export function damageGain(stats, gain) {
  const s = stats || {};
  const main = Number(s.main), sub = Number(s.sub) || 0, att = Number(s.att);
  if (!(main > 0) || !(att > 0)) return null;
  // gain.stat raises main and secondary stat alike (Star Force); gain.main raises the main stat only (flames).
  const dMain = ((gain.stat || 0) + (gain.main || 0)) * (1 + (Number(s.mainPct) || 0) / 100);
  const dSub = gain.stat || 0; // secondary stat % is not asked for, so its gain is counted flat (a slight underestimate)
  const dAtt = (gain.att || 0) * (1 + (Number(s.attPct) || 0) / 100);
  const before = (4 * main + sub) * att;
  const after = (4 * (main + dMain) + sub + dSub) * (att + dAtt);
  return after / before - 1;
}

export const STAT_FIELDS = [
  ['main', 'Main stat (total)', 'e.g. 45000'],
  ['sub', 'Secondary stat (total)', 'e.g. 6000'],
  ['att', 'Attack Power (total)', 'e.g. 5200'],
  ['mainPct', 'Main stat %', 'e.g. 380'],
  ['attPct', 'Attack Power %', 'e.g. 90']
];
