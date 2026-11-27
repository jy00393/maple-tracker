// Offline support: network first (so updates show straight away), cached copy when there's no connection or the
// connection is too slow to answer.
const CACHE = 'maple-tracker-v5';
const NOSW = /[?&]nosw(?:[=&]|$)/;
// How long a request may take before the stored copy is used instead (only when there is one). The network
// answer still updates the stored copy when it comes.
const WAIT_MS = 4000;
// After one request of a page has fallen back to the stored copy, the rest of that page's files come from the
// stored copies too for this long, so one page load does not mix old and new files on a slow connection.
const SLOW_FOR_MS = 30000;

// Every file the app needs, stored when the worker is installed, so the app opens offline after one visit.
// precache:start (written by scripts/precache.mjs; do not edit by hand)
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './app/calc/advice.js',
  './app/calc/asof.js',
  './app/calc/backups.js',
  './app/calc/bosscp.js',
  './app/calc/challenger.js',
  './app/calc/champions.js',
  './app/calc/checklist.js',
  './app/calc/events.js',
  './app/calc/expsources.js',
  './app/calc/flames.js',
  './app/calc/gearstats.js',
  './app/calc/income.js',
  './app/calc/items.js',
  './app/calc/merge.js',
  './app/calc/pitched.js',
  './app/calc/plural.js',
  './app/calc/potential.js',
  './app/calc/progress.js',
  './app/calc/qr.js',
  './app/calc/reminders.js',
  './app/calc/rewards.js',
  './app/calc/sanitise.js',
  './app/calc/season.js',
  './app/calc/setup.js',
  './app/calc/shops.js',
  './app/calc/starforce.js',
  './app/calc/status.js',
  './app/calc/sunny.js',
  './app/calc/upcoming.js',
  './app/calc/upgrades.js',
  './app/calc/world.js',
  './app/data.js',
  './app/main.js',
  './app/offline.js',
  './app/pages/bosscp.js',
  './app/pages/bosses.js',
  './app/pages/challenger.js',
  './app/pages/champions.js',
  './app/pages/characters.js',
  './app/pages/checklist.js',
  './app/pages/events.js',
  './app/pages/expsources.js',
  './app/pages/flames.js',
  './app/pages/gear.js',
  './app/pages/level.js',
  './app/pages/mesos.js',
  './app/pages/pitched.js',
  './app/pages/progress.js',
  './app/pages/session.js',
  './app/pages/settings.js',
  './app/pages/setup.js',
  './app/pages/shops.js',
  './app/pages/storage.js',
  './app/pages/timeline.js',
  './app/pages/today.js',
  './app/persist.js',
  './app/store.js',
  './app/sync.js',
  './app/time.js',
  './app/ui.js',
  './vendor/htm-preact.mjs',
  './data/bosscp.json',
  './data/bosses.json',
  './data/bounty.json',
  './data/challenger.json',
  './data/champions.json',
  './data/characters.json',
  './data/checklist.json',
  './data/classes.json',
  './data/erda.json',
  './data/events.json',
  './data/expsources.json',
  './data/flames.json',
  './data/gear.json',
  './data/gearstats.json',
  './data/ibp.json',
  './data/items.json',
  './data/liberation.json',
  './data/meta.json',
  './data/news.json',
  './data/pitched.json',
  './data/potential.json',
  './data/season.json',
  './data/shops.json',
  './data/symbols.json',
  './data/tables.json',
  './data/upcoming.json',
  './data/upgrades.json'
];
// precache:end

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precache().catch(() => {}));
});

// File by file, so one missing file (meta.json on a local copy) does not lose the rest. A file that cannot be
// fetched keeps the copy an earlier version stored, if there is one.
async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(PRECACHE.map(async (path) => {
    try {
      const res = await within(fetch(new Request(path, { cache: 'no-cache' })), 20000);
      if (res && res.ok) { await cache.put(path, res); return; }
    } catch (err) { /* offline or too slow: try the older copy below */ }
    try {
      const old = await caches.match(path, { ignoreSearch: true });
      if (old) await cache.put(path, old);
    } catch (err) { /* nothing stored before */ }
  }));
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Only this app's older stores: other sites on the same github.io address keep theirs.
    for (const key of await caches.keys()) if (key !== CACHE && String(key).startsWith('maple-tracker-')) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Resolves with the promise's answer, or rejects with 'slow' after ms. (Where there is no timer, just waits.)
function within(promise, ms) {
  if (typeof setTimeout !== 'function') return promise;
  let id;
  const late = new Promise((resolve, reject) => { id = setTimeout(() => reject(new Error('slow')), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(id));
}

const slowPages = new Map(); // page id -> when one of its requests fell back to the stored copy
// Page id -> when its page itself came from the network. Such a page waits for the network for every file (with
// the stored copy only when a request fails outright), so a slow file does not swap in an older stored copy
// next to new ones. A failed request can still do that; index.html then says to reload.
const freshPages = new Map();
function isFresh(id) {
  const at = id ? freshPages.get(id) : 0;
  if (!at) return false;
  if (Date.now() - at < SLOW_FOR_MS) return true;
  freshPages.delete(id);
  return false;
}
function isSlow(id) {
  const at = id ? slowPages.get(id) : 0;
  if (!at) return false;
  if (Date.now() - at < SLOW_FOR_MS) return true;
  slowPages.delete(id);
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const fonts = /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== self.location.origin && !fonts) return;
  // ?nosw switches the worker off for that page: its own address goes straight to the network here, and so do
  // the files it asks for (below). The page also removes this worker (app/offline.js).
  if (NOSW.test(url.search)) return;
  event.respondWith((async () => {
    let off = false;
    try {
      const page = event.clientId ? await self.clients.get(event.clientId) : null;
      off = Boolean(page && NOSW.test(new URL(page.url).search));
    } catch (err) { /* the page can't be looked up: treat it as a normal one */ }
    if (off) return fetch(req);
    const good = (res) => Boolean(res && (res.ok || res.type === 'opaque'));
    // GitHub Pages lets browsers keep files for 10 minutes. Ask the server each time for our own files,
    // so a new version shows on the next load. If that request is refused for any reason, fall back to the
    // plain one. A good answer replaces the stored copy.
    const net = (fonts ? fetch(req) : fetch(req, { cache: 'no-cache' }).catch(() => fetch(req))).then((res) => {
      if (good(res)) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    });
    const keepGoing = () => { const rest = net.catch(() => {}); if (typeof event.waitUntil === 'function') event.waitUntil(rest); };
    // The page asking (for the page itself: the page it is about to become).
    const pageId = event.clientId || event.resultingClientId || '';
    let hit;
    try { hit = await caches.match(req, { ignoreSearch: url.origin === self.location.origin }); } catch (err) { hit = undefined; }
    if (hit) {
      // A page whose earlier file already came from the stored copy takes the rest from there too.
      if (isSlow(pageId)) { keepGoing(); return hit; }
      // A page that came from the network takes its files from there too, however slow.
      if (req.mode !== 'navigate' && isFresh(pageId)) {
        try { const res = await net; return good(res) ? res : hit; } catch (err) { return hit; }
      }
      try {
        const res = await within(net, WAIT_MS);
        // A server error (GitHub Pages mid-deploy, a 503) is worse than the last good copy.
        if (good(res) && req.mode === 'navigate' && pageId) freshPages.set(pageId, Date.now());
        return good(res) ? res : hit;
      } catch (err) {
        // No connection, or one too slow to answer: the stored copy now; a late answer is stored when it comes.
        if (err && err.message === 'slow') {
          if (pageId) slowPages.set(pageId, Date.now());
          keepGoing();
        }
        return hit;
      }
    }
    // Nothing stored: wait for the network as long as it takes.
    // The stored copy is chosen file by file: when one request of a page load fails right after an update,
    // that file can be an older version than the rest. index.html shows a "reload" message if the app then
    // fails to start.
    try {
      const res = await net;
      if (good(res) && req.mode === 'navigate' && pageId) freshPages.set(pageId, Date.now());
      if (good(res)) return res;
      if (req.mode === 'navigate') { const shell = await caches.match('./index.html'); if (shell) return shell; }
      return res;
    } catch (err) {
      if (req.mode === 'navigate') { const shell = await caches.match('./index.html'); if (shell) return shell; }
      throw err;
    }
  })());
});
