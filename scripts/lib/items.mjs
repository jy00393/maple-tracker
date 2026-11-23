// Builds the Gear tab's item list from maplestory.io (a community API over the game's data files).
// Unofficial and may lag behind the live game by a patch or two, so the list records which version it came from.

export const WZ_URL = 'https://maplestory.io/api/wz';
export const ITEMS_URL = (version, minLevel) =>
  `https://maplestory.io/api/GMS/${version}/item?overallCategoryFilter=Equip&minLevelFilter=${minLevel}&count=20000`;
export const MIN_LEVEL = 100;

// Newest GMS data version the API says is ready, as a string ("270"), or null.
export function latestGmsVersion(wzList) {
  const versions = (Array.isArray(wzList) ? wzList : [])
    .filter((w) => w && w.region === 'GMS' && w.isReady && /^\d+$/.test(String(w.mapleVersionId)))
    .map((w) => Number(w.mapleVersionId));
  return versions.length ? String(Math.max(...versions)) : null;
}

// Equipment slot from the item id (the game groups ids in blocks of 10,000 per equipment type).
const BLOCKS = {
  100: 'hat', 101: 'face', 102: 'eye', 103: 'earrings', 104: 'top', 105: 'top', 106: 'bottom', 107: 'shoes', 108: 'gloves',
  109: 'secondary', 110: 'cape', 111: 'ring', 112: 'pendant', 113: 'belt', 115: 'shoulder', 116: 'pocket', 118: 'badge',
  135: 'secondary', 167: 'heart'
};
export function slotOfItem(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  if (n >= 1190000 && n < 1190500) return 'emblem';
  const block = Math.floor(n / 10000);
  if (BLOCKS[block]) return BLOCKS[block];
  if (block >= 121 && block <= 159) return 'weapon';
  return null;
}

// Raw API rows -> compact rows [id, name, level, slot], one per name and slot, sorted by level then name.
export function buildItems(raw) {
  const seen = new Set();
  const out = [];
  for (const it of Array.isArray(raw) ? raw : []) {
    if (!it || it.isCash) continue;
    const name = typeof it.name === 'string' ? it.name.replace(/\s+/g, ' ').trim() : '';
    const level = Number(it.requiredLevel);
    const slot = slotOfItem(it.id);
    if (!name || name.length > 80 || !slot || !Number.isFinite(level) || level < 1 || level > 300) continue;
    const key = `${slot}|${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([Number(it.id), name, level, slot]);
  }
  return out.sort((a, b) => b[2] - a[2] || a[1].localeCompare(b[1]));
}

// One row per line keeps the file small and its diffs readable.
export function serialiseItems(doc) {
  const { items, ...head } = doc;
  const rows = items.map((r) => JSON.stringify(r)).join(',\n');
  return `${JSON.stringify(head, null, 1).replace(/\n}$/, '')},\n "items": [\n${rows}\n]\n}\n`;
}
