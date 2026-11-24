// Pitched and Brilliant boss drops, logged per character as { drops: [{ id, item, d: 'YYYY-MM-DD' }] }.
// A real calendar day written as YYYY-MM-DD (2026-02-31 and 2026-13-45 are not).
export function isDay(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(d + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}

export function cleanDrops(list) {
  return Array.from(Array.isArray(list) ? list : [])
    .filter((x) => x && typeof x === 'object' && typeof x.item === 'string' && x.item && isDay(x.d))
    .map((x, i) => ({ ...x, id: typeof x.id === 'string' && x.id ? x.id : `drop${i}` }));
}

// Per set: every item with its drops (oldest first), plus how many different items you own.
export function pitchedSummary(pitched, saved) {
  const drops = cleanDrops(saved && saved.drops).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const sets = (pitched.sets || []).map((set) => {
    const items = set.items.map((item) => ({ item, drops: drops.filter((x) => x.item === item.id) }));
    return { id: set.id, name: set.name, items, owned: items.filter((r) => r.drops.length).length, total: items.length };
  });
  const known = new Set(sets.flatMap((s) => s.items.map((r) => r.item.id)));
  const counted = drops.filter((x) => known.has(x.item));
  return { sets, count: counted.length, latest: counted.length ? counted[counted.length - 1] : null };
}

// Today's date in Korea, as YYYY-MM-DD (the app shows KST everywhere).
export function kstDay(now) {
  return new Date(now + 9 * 3600000).toISOString().slice(0, 10);
}
