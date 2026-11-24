// Legion Champions: account-wide, saved as { slots: [{ name, rank }], raid: { 'YYYY-MM': score } }.
// rank is an index into data/champions.json ranks (0 = C ... 5 = SSS).
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export function cleanChampions(raw, maxSlots = 6) {
  const src = isObj(raw) ? raw : {};
  const slots = Array.from(Array.isArray(src.slots) ? src.slots : []).slice(0, maxSlots).map((s) => {
    const o = isObj(s) ? s : {};
    const rank = Number.isInteger(o.rank) && o.rank >= 0 && o.rank <= 5 ? o.rank : 0;
    return { ...o, name: typeof o.name === 'string' ? o.name.slice(0, 40) : '', rank };
  });
  const raid = {};
  for (const [k, v] of Object.entries(isObj(src.raid) ? src.raid : {})) {
    if (/^\d{4}-\d{2}$/.test(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e18) raid[k] = v;
  }
  return { ...src, slots, raid };
}

// The month a Champion Raid score belongs to (the raid is monthly, on server time).
export function raidMonth(now) {
  return new Date(now).toISOString().slice(0, 7);
}

export function championSummary(ch, saved) {
  const state = cleanChampions(saved, ch.maxSlots);
  const rankIndex = (id) => ch.ranks.findIndex((r) => r.id === id);
  const filled = state.slots.map((s, i) => ({ ...s, i })).filter((s) => s.name.trim());
  // A slot opens when enough Champions are registered and every one of them holds the rank asked for.
  let open = 0;
  for (const rule of ch.slots.slice(0, ch.maxSlots)) {
    if (!rule.need) { open = rule.slot; continue; }
    // "All N Champions reach rank X": the Champions in the first N slots.
    const firstN = state.slots.slice(0, rule.need.champions);
    const enough = firstN.length === rule.need.champions && firstN.every((s) => s.name.trim() && s.rank >= rankIndex(rule.need.rank));
    if (!enough) break;
    open = rule.slot;
  }
  const nextRule = ch.slots.find((r) => r.slot === open + 1 && r.slot <= ch.maxSlots) || null;
  const slots = [];
  for (let i = 0; i < ch.maxSlots; i++) {
    const s = state.slots[i] || { name: '', rank: 0 };
    const next = ch.ranks[s.rank + 1] || null;
    slots.push({ i, name: s.name, rank: s.rank, rankId: ch.ranks[s.rank].id, open: i < open, next: s.name.trim() && next ? next : null });
  }
  // Insignia: every rank a Champion has passed, added up over all Champions.
  const insignia = { allStats: 0, hp: 0, att: 0, boss: 0, critDmg: 0, ied: 0 };
  for (const s of filled) {
    if (s.i >= open) continue;
    for (let r = 1; r <= s.rank; r++) for (const [k, v] of Object.entries(ch.ranks[r].insignia || {})) insignia[k] += v;
  }
  return { slots, open, registered: filled.filter((s) => s.i < open).length, nextRule, insignia };
}

export function insigniaLabel(b) {
  const parts = [];
  if (b.allStats) parts.push(`All Stats +${b.allStats}`);
  if (b.hp) parts.push(`Max HP/MP +${b.hp.toLocaleString('en-US')}`);
  if (b.att) parts.push(`ATT +${b.att}`);
  if (b.boss) parts.push(`Boss Damage +${b.boss}%`);
  if (b.critDmg) parts.push(`Crit Damage +${b.critDmg}%`);
  if (b.ied) parts.push(`IED +${b.ied}%`);
  return parts.join(' · ');
}
