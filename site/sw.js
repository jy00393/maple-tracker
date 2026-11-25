// Offline support: network first (so updates show straight away), cached copy when there's no connection.
const CACHE = 'maple-tracker-v4';
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
  event.respondWith((async () => {
    try {
      // GitHub Pages lets browsers keep files for 10 minutes. Ask the server each time for our own files,
      // so a new version shows on the next load and old and new files never mix.
      // If that request is refused for any reason, fall back to the plain one.
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
