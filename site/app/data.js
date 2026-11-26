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
  potential: 'data/potential.json',
  gearStats: 'data/gearstats.json',
  events: 'data/events.json',
  news: 'data/news.json',
  nexonCharacters: 'data/characters.json',
  meta: 'data/meta.json',
  tables: 'data/tables.json',
  season: 'data/season.json',
  pitched: 'data/pitched.json',
  shops: 'data/shops.json',
  flames: 'data/flames.json',
  champions: 'data/champions.json',
  expSources: 'data/expsources.json',
  upcoming: 'data/upcoming.json',
  bossCp: 'data/bosscp.json',
  classes: 'data/classes.json'
};
const OPTIONAL = new Set(['meta', 'events', 'news', 'nexonCharacters', 'tables', 'season']);
// The files the 6-hourly job rewrites. An open page reads these again (refreshData); the rest only change with a
// new version of the site.
const LIVE = ['events', 'news', 'nexonCharacters', 'shops'];

async function getJson(path, opts = {}) {
  const res = await fetch(path, { cache: 'no-cache', ...opts });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export async function loadData(base = '') {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, path]) => {
      try {
        return [key, await getJson(base + path)];
      } catch (err) {
        if (OPTIONAL.has(key)) return [key, null];
        throw err;
      }
    })
  );
  // refresh: how the last read of the job's files went, and when (see nexonAge in calc/status.js).
  return finish({ ...Object.fromEntries(entries), refresh: { failed: false, at: Date.now() } });
}

function finish(data) {
  data.events = data.events || { events: [] };
  data.events.events = dedupeEvents(data.events.events);
  data.events.sunny = Array.isArray(data.events.sunny) ? data.events.sunny : [];
  data.news = data.news || { items: [] };
  data.nexonCharacters = data.nexonCharacters || { characters: [] };
  data.bossById = Object.fromEntries(data.bosses.bosses.map((b) => [b.id, b]));
  return data;
}

// Reads the job's files again for a page that stays open. Always returns a new data object and never throws:
// - meta.json has the same checkedAt as before: nothing else is fetched, the data stays as it is;
// - it changed: the job's files are fetched, and swapped in only when every one of them arrived;
// - anything failed (offline, a server error, a half-read file): the old data stays, marked `refresh.failed`.
export async function refreshData(data, base = '', online = true) {
  const keep = (failed) => ({ ...data, refresh: { failed, at: Date.now() } });
  if (!online) return keep(true);
  // A request that hangs (a connection that went quiet) is given up after 30 s, so the next check can run.
  const opts = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(30000) } : {};
  try {
    const meta = await getJson(base + FILES.meta, opts);
    if (!meta || typeof meta.checkedAt !== 'string') return keep(true);
    if (data.meta && data.meta.checkedAt === meta.checkedAt) return keep(false);
    const got = await Promise.all(LIVE.map(async (key) => [key, await getJson(base + FILES[key], opts)]));
    if (got.some(([, v]) => !v || typeof v !== 'object')) return keep(true);
    return finish({ ...data, ...Object.fromEntries(got), meta, refresh: { failed: false, at: Date.now() } });
  } catch {
    return keep(true);
  }
}

export const REFRESH_EVERY = 3600000; // about hourly while the page is on screen
export const REFRESH_GAP = 900000; // never more often than every 15 minutes

// Keeps an open page's Nexon data current: re-reads when the tab comes back to the front (or the connection
// returns) and about hourly while it is on screen; never while hidden, never more often than every 15 minutes.
// get(): the data on screen; set(next): show the new one. Returns a function that stops it.
export const RETRY_GAP = 60000;

export function watchData({ get, set, base = '', doc = globalThis.document, win = globalThis.window, nav = globalThis.navigator }) {
  let last = (get().refresh && get().refresh.at) || Date.now();
  let busy = false;
  let stopped = false;
  const visible = () => !doc || doc.visibilityState !== 'hidden';
  // A failed or skipped attempt does not count as a check: it is tried again after a minute, and at once when
  // the connection or the tab comes back.
  let tried = 0;
  const check = async (gap) => {
    if (busy || stopped || !visible() || Date.now() - last < gap || Date.now() - tried < RETRY_GAP) return;
    busy = true;
    const before = last;
    last = Date.now();
    try {
      const next = await refreshData(get(), base, !(nav && nav.onLine === false));
      if (next && next.refresh && next.refresh.failed) { last = before; tried = Date.now(); }
      if (!stopped) set(next);
    } catch { last = before; tried = Date.now(); } finally { busy = false; }
  };
  const onBack = () => { tried = 0; check(REFRESH_GAP); };
  const id = setInterval(() => { check(REFRESH_EVERY); }, 60000);
  if (id && typeof id.unref === 'function') id.unref();
  if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onBack);
  if (win && typeof win.addEventListener === 'function') win.addEventListener('online', onBack);
  return () => {
    stopped = true;
    clearInterval(id);
    if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onBack);
    if (win && typeof win.removeEventListener === 'function') win.removeEventListener('online', onBack);
  };
}
