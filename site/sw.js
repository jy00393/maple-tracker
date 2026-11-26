// Offline support: network first (so updates show straight away), cached copy when there's no connection.
const CACHE = 'maple-tracker-v4';
const NOSW = /[?&]nosw(?:[=&]|$)/;
const SHELL = ['./', './index.html', './styles.css', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

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
    try {
      // GitHub Pages lets browsers keep files for 10 minutes. Ask the server each time for our own files,
      // so a new version shows on the next load.
      // If that request is refused for any reason, fall back to the plain one.
      // The cached copy is chosen file by file: when one request of a page load fails right after an update,
      // that file can be an older version than the rest. index.html shows a "reload" message if the app then
      // fails to start.
      const res = fonts ? await fetch(req) : await fetch(req, { cache: 'no-cache' }).catch(() => fetch(req));
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }
      // A server error (GitHub Pages mid-deploy, a 503) is worse than the last good copy, when there is one.
      const hit = await caches.match(req, { ignoreSearch: url.origin === self.location.origin });
      if (hit) return hit;
      if (req.mode === 'navigate') { const shell = await caches.match('./index.html'); if (shell) return shell; }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: url.origin === self.location.origin });
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw err;
    }
  })());
});
