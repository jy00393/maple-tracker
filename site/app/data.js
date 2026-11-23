import { dedupeEvents } from './calc/events.js';
// Loads the static game data and the files the GitHub Action refreshes from Nexon.
const FILES = {
  bosses: 'data/bosses.json',
  symbols: 'data/symbols.json',
  liberation: 'data/liberation.json',
  ibp: 'data/ibp.json',
  checklist: 'data/checklist.json',
  gear: 'data/gear.json',
  erda: 'data/erda.json',
  upgrades: 'data/upgrades.json',
  events: 'data/events.json',
  news: 'data/news.json',
  nexonCharacters: 'data/characters.json',
  meta: 'data/meta.json',
  tables: 'data/tables.json'
};
const OPTIONAL = new Set(['meta', 'events', 'news', 'nexonCharacters', 'tables']);

export async function loadData(base = '') {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, path]) => {
      try {
        const res = await fetch(base + path, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
        return [key, await res.json()];
      } catch (err) {
        if (OPTIONAL.has(key)) return [key, null];
        throw err;
      }
    })
  );
  const data = Object.fromEntries(entries);
  data.events = data.events || { events: [] };
  data.events.events = dedupeEvents(data.events.events);
  data.news = data.news || { items: [] };
  data.nexonCharacters = data.nexonCharacters || { characters: [] };
  data.bossById = Object.fromEntries(data.bosses.bosses.map((b) => [b.id, b]));
  return data;
}
