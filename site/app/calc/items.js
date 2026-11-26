// Item list lookups for the Gear tab. Rows are [id, name, level, slot] from data/items.json.

// Gear slot id ("ring3", "pendant1", "top") -> the item list's slot key.
export function itemSlotKey(slotId) {
  return String(slotId || '').replace(/\d+$/, '');
}

// Items for a slot whose name contains every word typed; names that start with the text come first, then higher level.
export function searchItems(items, slotKey, query, limit = 8) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const text = words.join(' ');
  const hits = [];
  for (const row of items || []) {
    if (row[3] !== slotKey) continue;
    const name = row[1].toLowerCase();
    if (!words.every((w) => name.includes(w))) continue;
    hits.push({ row, rank: name === text ? 0 : name.startsWith(text) ? 1 : 2 });
  }
  hits.sort((a, b) => a.rank - b.rank || b.row[2] - a.row[2] || a.row[1].localeCompare(b.row[1]));
  return hits.slice(0, limit).map((h) => ({ id: h.row[0], name: h.row[1], level: h.row[2] }));
}

export function iconUrl(version, itemId) {
  if (!version || !itemId) return null;
  return `https://maplestory.io/api/GMS/${encodeURIComponent(version)}/item/${encodeURIComponent(itemId)}/icon`;
}

// The list item whose name is exactly the typed text (case and outer spaces ignored), or null. When two items
// share a name, the higher-level one, as the suggestions list them.
export function exactItem(items, slotKey, name) {
  const text = String(name || '').trim().toLowerCase();
  if (!text) return null;
  const hit = searchItems(items, slotKey, text, 1)[0];
  return hit && hit.name.toLowerCase() === text ? hit : null;
}

// Is this list item an overall (worn on Top, fills Bottom too)? rule = gear.json "overall": an item id range.
export function isOverall(rule, itemId) {
  const id = Number(itemId);
  return Boolean(rule && Number.isFinite(id) && id >= rule.idFrom && id <= rule.idTo);
}

// Which rung of the slot's tier ladder an item name belongs to, from keyword hints in gear.json. 0 = no hint.
// A keyword is one piece of text, or a list of pieces that must all be in the name ("Superior Engraved Gollux Belt").
export function tierFromName(name, tierNames, hints) {
  const n = String(name || '').toLowerCase();
  for (const [keyword, rung] of hints || []) {
    const words = Array.isArray(keyword) ? keyword : [keyword];
    if (!words.length || !words.every((w) => n.includes(String(w).toLowerCase()))) continue;
    if (!rung) return 0; // a lookalike name: no guess
    const i = (tierNames || []).findIndex((t) => t && t.toLowerCase().includes(String(rung).toLowerCase()));
    if (i >= 0) return i + 1;
  }
  return 0;
}
