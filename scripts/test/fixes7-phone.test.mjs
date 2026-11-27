// Seventh round, phone, offline and storage: the offline worker stores every file at install and falls back to its
// copy on a stalled connection (#40, #41); phone CSS (#42-#45); home-screen icons (#46); a refused save shown on
// every page, the browser asked to keep the entries, and the last tick before leaving sent at once (#29-#31).
// Nothing here talks to GitHub: fetch is a stand-in and the "token" is a made-up word. No test waits on a clock:
// timers in the worker are fired by hand, and pages are read once a condition holds.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';
import { precacheList, precacheBlock, readBlock, moduleGraph } from '../lib/precache.mjs';
import { readPng } from '../lib/png.mjs';

const SITE = fileURLToPath(new URL('../../site/', import.meta.url));
const siteFile = (p) => SITE + p;
const KEY = 'maple-tracker:v1';
const BACKUPS = 'maple-tracker:backups';
const SYNC = 'maple-tracker:sync';
const UNSENT = 'maple-tracker:sync-unsent';

const mem = installFakeBrowser();
// Real listener lists, so tests can deliver the events a browser would.
const handlers = {};
const listenOn = (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); };
const fire = (type, ev = {}) => { for (const fn of handlers[type] || []) fn(ev); };
globalThis.window.addEventListener = listenOn;
globalThis.window.scrollTo = () => {};
globalThis.document.addEventListener = listenOn;
// Storage that can be made to refuse writes.
let refuse = () => false;
const plain = globalThis.localStorage;
globalThis.localStorage = { getItem: plain.getItem, removeItem: plain.removeItem, setItem: (k, v) => { if (refuse(k, String(v))) throw new Error('QuotaExceededError'); plain.setItem(k, v); } };

const store = await import('../../site/app/store.js');
const sync = await import('../../site/app/sync.js');
const persist = await import('../../site/app/persist.js');
const { appStatus } = await import('../../site/app/calc/status.js');
const { html, render } = await import('../../site/vendor/htm-preact.mjs');
const { StorageWarning } = await import('../../site/app/pages/storage.js');

const mounted = new Set();
after(() => { for (const el of mounted) render(null, el); });
async function until(check, what, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return true; await tick(10); }
  assert.ok(check(), `waited for ${what}`);
  return true;
}
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

// ---- #40: the pre-cache list ------------------------------------------------------------------------------------
test('#40 sw.js pre-caches every module reached from main.js, every data file the app fetches, and the shell', () => {
  const sw = readFileSync(siteFile('sw.js'), 'utf8');
  const block = readBlock(sw);
  assert.ok(block, 'sw.js has the pre-cache markers');
  assert.equal(block, precacheBlock(precacheList(SITE)), 'sw.js is up to date: run node scripts/precache.mjs');
  assert.equal(readBlock(sw.replace(/\r?\n/g, '\r\n')), block, 'a Windows checkout (\\r\\n line ends) reads the same');
  const list = precacheList(SITE);
  // Every module file of the app is in the list (an unreachable file would be dead code: say so here).
  const walk = (dir) => readdirSync(SITE + dir).flatMap((n) => (statSync(SITE + dir + '/' + n).isDirectory() ? walk(dir + '/' + n) : [dir + '/' + n]));
  for (const f of walk('app').filter((f) => f.endsWith('.js'))) assert.ok(list.includes('./' + f), `${f} is pre-cached`);
  assert.ok(list.includes('./vendor/htm-preact.mjs'));
  // Every data file data.js loads, and Gear's item list (fetched only when Gear opens: stored at install too).
  const dataJs = readFileSync(siteFile('app/data.js'), 'utf8');
  for (const m of dataJs.matchAll(/'(data\/[a-z]+\.json)'/g)) assert.ok(list.includes('./' + m[1]), `${m[1]} is pre-cached`);
  assert.ok(list.includes('./data/items.json'));
  assert.ok(!list.includes('./data/posts.json'), 'the job\'s post cache is never read by the site');
  for (const p of ['./', './index.html', './styles.css', './manifest.webmanifest', './icons/apple-touch-icon.png', './icons/icon-maskable-192.png']) assert.ok(list.includes(p), p);
  // Every listed file exists, except meta.json, which only the Nexon job writes (git-ignored).
  for (const p of list) if (p !== './' && p !== './data/meta.json') assert.ok(existsSync(siteFile(p.slice(2))), `${p} exists`);
  assert.deepEqual(moduleGraph(SITE).filter((p) => !p.startsWith('app/') && !p.startsWith('vendor/')), []);
  assert.doesNotMatch(sw, /maple-tracker-v4'/, 'the cache name moved on, so installed copies install again');
});

// ---- the worker, run with stand-ins -------------------------------------------------------------------------------
const ORIGIN = 'https://x.test';
const BASE = ORIGIN + '/maple-tracker/';
function loadWorker({ answer, pages = {} }) {
  const listeners = {};
  const stores = new Map();
  // Stored copies are matched without the query (ignoreSearch) and, as in a browser, without the #part.
  const abs = (r) => { const u = new URL(typeof r === 'string' ? r : r.url, BASE + 'sw.js'); u.search = ''; u.hash = ''; return u.href; };
  const bucket = (n) => { if (!stores.has(n)) stores.set(n, new Map()); return stores.get(n); };
  const timers = [];
  const ctx = {
    URL,
    Request: class { constructor(u, o = {}) { this.url = new URL(u, BASE + 'sw.js').href; this.cache = o.cache; this.method = 'GET'; this.mode = 'cors'; } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    self: {
      location: { origin: ORIGIN, href: BASE + 'sw.js' },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting() {},
      clients: { get: async (id) => pages[id] || null, claim: async () => {} }
    },
    caches: {
      open: async (n) => { const m = bucket(n); return { put: async (r, v) => { m.set(abs(r), v); }, match: async (r) => m.get(abs(r)) }; },
      match: async (r) => { for (const m of stores.values()) if (m.has(abs(r))) return m.get(abs(r)); return undefined; },
      keys: async () => [...stores.keys()],
      delete: async (n) => stores.delete(n)
    },
    fetch: (req) => answer(typeof req === 'string' ? req : req.url)
  };
  vm.runInNewContext(readFileSync(siteFile('sw.js'), 'utf8'), ctx);
  const cacheName = /const CACHE = '([^']+)'/.exec(readFileSync(siteFile('sw.js'), 'utf8'))[1];
  const install = async () => { const waits = []; listeners.install({ waitUntil: (p) => waits.push(p) }); await Promise.all(waits); };
  const activate = async () => { const waits = []; listeners.activate({ waitUntil: (p) => waits.push(p) }); await Promise.all(waits); };
  // Starts a request; returns { reply (a promise), waits (what the worker asked to finish later) }.
  const get = (path, { clientId = '', resultingClientId = '', mode = 'cors' } = {}) => {
    let reply;
    const waits = [];
    listeners.fetch({ request: { method: 'GET', url: new URL(path, BASE).href, mode }, clientId, resultingClientId, respondWith: (p) => { reply = p; }, waitUntil: (p) => waits.push(p) });
    return { reply, waits };
  };
  const fireTimers = (ms) => { for (const t of timers) if (t.live && t.ms === ms) { t.live = false; t.fn(); } };
  const hasTimer = (ms) => timers.some((t) => t.live && t.ms === ms);
  return { install, activate, get, stores, bucket, cacheName, abs, fireTimers, hasTimer };
}
const res = (tag, ok = true) => ({ ok, status: ok ? 200 : 503, type: 'basic', tag, clone() { return this; } });
const settle = async (p) => { let out = 'pending'; p.then((v) => { out = v; }, (e) => { out = e; }); for (let i = 0; i < 20; i++) await tick(0); return out; };

test('#40 after one install the app opens offline: every file comes from the stored copy', async () => {
  const list = precacheList(SITE);
  const asked = [];
  // One file is missing on the server (a local copy has no meta.json): the rest are stored all the same.
  const w = loadWorker({ answer: async (url) => { asked.push(url); return url.endsWith('/data/meta.json') ? res('404', false) : res('v1 ' + url); } });
  await w.install();
  const held = w.bucket(w.cacheName);
  for (const p of list) if (p !== './data/meta.json') assert.ok(held.has(w.abs(p)), `${p} stored at install`);
  assert.equal(new Set(asked).size, list.length, 'each file asked for once');
  // Offline: the network refuses everything; the page, main.js and a data file still answer.
  const off = loadWorker({ answer: async () => { throw new TypeError('Failed to fetch'); } });
  for (const [k, v] of held) off.bucket(off.cacheName).set(k, v);
  for (const p of ['./app/main.js', './data/bosses.json', './data/items.json', './vendor/htm-preact.mjs']) {
    const r = await off.get(p).reply;
    assert.equal(r.tag, 'v1 ' + w.abs(p), p);
  }
  const page = await off.get(BASE + '#today', { mode: 'navigate' }).reply;
  assert.equal(page.tag, 'v1 ' + BASE);
});

test('#40 an install that cannot reach a file keeps the copy an older version stored; old stores of this app only are removed', async () => {
  const w = loadWorker({ answer: async (url) => (url.endsWith('/app/ui.js') ? Promise.reject(new TypeError('offline')) : res('new ' + url)) });
  w.bucket('maple-tracker-v4').set(w.abs('./app/ui.js'), res('old ui'));
  w.bucket('another-site-cache').set(ORIGIN + '/other/', res('theirs'));
  await w.install();
  assert.equal(w.bucket(w.cacheName).get(w.abs('./app/ui.js')).tag, 'old ui');
  await w.activate();
  assert.deepEqual([...w.stores.keys()].sort(), ['another-site-cache', w.cacheName].sort());
});

// ---- #41: a stalled connection --------------------------------------------------------------------------------
test('#41 a request that hangs gets the stored copy after the wait, and the late answer still updates the store', async () => {
  let release;
  const hanging = new Promise((r) => { release = r; });
  const w = loadWorker({ answer: () => hanging });
  const key = w.abs('./app/main.js');
  w.bucket(w.cacheName).set(key, res('stored main'));
  const { reply, waits } = w.get('./app/main.js', { clientId: 'p1' });
  assert.equal(await settle(reply), 'pending', 'still waiting for the network before the time is up');
  await until(() => w.hasTimer(4000), 'the worker to start its timer');
  w.fireTimers(4000);
  assert.equal((await reply).tag, 'stored main');
  assert.equal(waits.length, 1, 'the network request is kept alive');
  release(res('fresh main'));
  await waits[0];
  await until(() => w.bucket(w.cacheName).get(key).tag === 'fresh main', 'the late answer to be stored');
});

test('#41 after one slow file, the rest of that page comes from the store at once (no old/new mix); with nothing stored it waits', async () => {
  const pending = [];
  const w = loadWorker({ answer: () => new Promise((r) => pending.push(r)) });
  for (const p of ['./', './app/main.js', './app/ui.js']) w.bucket(w.cacheName).set(w.abs(p), res('stored ' + p));
  const nav = w.get(BASE, { mode: 'navigate', resultingClientId: 'p2' });
  await until(() => w.hasTimer(4000), 'the timer');
  w.fireTimers(4000);
  assert.equal((await nav.reply).tag, 'stored ./');
  // The page's next file: no wait at all, even though the network has not answered.
  const next = w.get('./app/ui.js', { clientId: 'p2' });
  assert.equal((await settle(next.reply)).tag, 'stored ./app/ui.js');
  // Another page is not affected: it waits for the network as usual.
  const other = w.get('./app/main.js', { clientId: 'p3' });
  assert.equal(await settle(other.reply), 'pending');
  // Nothing stored: no timer cuts it short; the network answer is used whenever it comes.
  const fresh = w.get('./app/new-file.js', { clientId: 'p4' });
  assert.equal(await settle(fresh.reply), 'pending');
  for (const r of pending) r(res('net'));
  assert.equal((await fresh.reply).tag, 'net');
  assert.equal((await other.reply).tag, 'net', 'a quick answer beats the stored copy');
});

// ---- #42-#45: phone CSS -------------------------------------------------------------------------------------------
const CSS = readFileSync(siteFile('styles.css'), 'utf8');
// [{ media, selector, body, at }] for every rule, with the max-width of the media block around it (Infinity outside).
function rules(css) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  let depth = 0; let media = Infinity; let start = 0;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '{') {
      const head = clean.slice(start, i).trim();
      if (head.startsWith('@media')) { const m = /max-width:\s*(\d+)px/.exec(head); media = m ? Number(m[1]) : Infinity; depth++; start = i + 1; continue; }
      const end = clean.indexOf('}', i);
      out.push({ media: depth ? media : Infinity, selector: head, body: clean.slice(i + 1, end), at: i });
      i = end; start = end + 1;
    } else if (clean[i] === '}') { depth = Math.max(0, depth - 1); if (!depth) media = Infinity; start = i + 1; }
  }
  return out;
}
const RULES = rules(CSS);
const sel = (r) => r.selector.split(',').map((s) => s.trim());
const px = (body, prop) => { const m = new RegExp(`(?:^|;|\\s)${prop}:\\s*([\\d.]+)px`).exec(body); return m ? Number(m[1]) : NaN; };

test('#43 on phones every text box, number box and dropdown is 16px, later than (and as specific as) any smaller rule', () => {
  const phone = RULES.filter((r) => r.media <= 760 && px(r.body, 'font-size') >= 16 && sel(r).includes('input'));
  assert.equal(phone.length, 1, 'one phone rule for form fields');
  const big = phone[0];
  for (const s of ['input', 'select', 'textarea', '.input', '.select', '.input.sm', '.select.sm', '.char-pick select']) assert.ok(sel(big).includes(s), `${s} is 16px on phones`);
  // Every rule that gives a field (or its parent .char-pick / .field) a smaller size comes before it.
  const small = RULES.filter((r) => px(r.body, 'font-size') < 16 && sel(r).some((s) => /(^|[\s.])(input|select|textarea)\b|\.char-pick$|\.input|\.select/.test(s)));
  for (const r of small) assert.ok(r.at < big.at, `"${r.selector}" comes before the phone rule`);
});

test('#45 the daily counter − / + are at least 36px on phones; the modal uses dvh with a vh fallback', () => {
  const base = RULES.find((r) => r.selector === '.iconbtn');
  const counter = RULES.find((r) => r.media <= 900 && sel(r).includes('.counter .iconbtn'));
  assert.ok(counter && counter.at > base.at);
  assert.ok(px(counter.body, 'width') >= 36 && px(counter.body, 'height') >= 36);
  const modal = RULES.find((r) => r.selector === '.modal');
  const vh = modal.body.indexOf('calc(100vh - 32px)');
  const dvh = modal.body.indexOf('calc(100dvh - 32px)');
  assert.ok(vh >= 0 && dvh > vh, 'dvh after the vh fallback');
});

test('#44 the header, page and bottom bar keep clear of the notch and status bar of an installed iPhone app', () => {
  const html5 = readFileSync(siteFile('index.html'), 'utf8');
  assert.match(html5, /viewport-fit=cover/);
  const top = RULES.find((r) => r.selector === '.topbar-inner' && r.media === Infinity);
  assert.match(top.body, /padding:\s*calc\(12px \+ env\(safe-area-inset-top/);
  assert.match(top.body, /safe-area-inset-left/);
  assert.match(top.body, /safe-area-inset-right/);
  const nav = RULES.find((r) => r.selector === '.bottomnav' && r.media <= 760);
  for (const side of ['left', 'right', 'bottom']) assert.match(nav.body, new RegExp(`safe-area-inset-${side}`));
  // No later phone rule puts the top padding back to a plain number.
  for (const r of RULES.filter((x) => x.at > top.at && sel(x).includes('.topbar-inner'))) assert.doesNotMatch(r.body, /padding(-top)?:\s*\d/);
});

test('#42 on phones the reset clocks wrap instead of scrolling off screen; the Thursday boss reset is second', () => {
  const phone = RULES.filter((r) => r.media <= 560 && sel(r).includes('.clocks'));
  assert.ok(phone.length >= 1);
  for (const r of phone) { assert.doesNotMatch(r.body, /nowrap/); assert.doesNotMatch(r.body, /overflow-x:\s*auto/); }
  assert.ok(RULES.some((r) => r.media <= 560 && sel(r).includes('.clocks .utc') && /display:\s*none/.test(r.body)));
  const main = readFileSync(siteFile('app/main.js'), 'utf8');
  const order = ['Daily', 'Thu bosses', 'Wed', 'Mon'].map((w) => main.indexOf(`<span>${w} <b>`));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), 'Daily, Thu bosses, Wed, Mon');
});

// ---- #46: icons ----------------------------------------------------------------------------------------------------
test('#46 a 180px opaque apple-touch-icon and a maskable icon for Android, both linked', () => {
  const page = readFileSync(siteFile('index.html'), 'utf8');
  assert.match(page, /<link rel="apple-touch-icon" sizes="180x180" href="icons\/apple-touch-icon.png">/);
  assert.match(page, /<meta name="mobile-web-app-capable" content="yes">/);
  const apple = readPng(readFileSync(siteFile('icons/apple-touch-icon.png')));
  assert.deepEqual([apple.width, apple.height, apple.channels], [180, 180, 3], 'opaque RGB, so iOS adds no black corners');
  const manifest = JSON.parse(readFileSync(siteFile('manifest.webmanifest'), 'utf8'));
  const maskable = manifest.icons.filter((i) => i.purpose === 'maskable');
  assert.ok(maskable.length >= 1);
  for (const i of manifest.icons) {
    const img = readPng(readFileSync(siteFile(i.src)));
    assert.equal(`${img.width}x${img.height}`, i.sizes, i.src);
    if (i.purpose === 'maskable') assert.equal(img.channels, 3, `${i.src} is opaque`);
  }
});

// ---- #29: a refused save --------------------------------------------------------------------------------------------
test('#29 when the browser is out of room, the safety copies give way so the entries are still saved', () => {
  try {
    const copies = [1, 2, 3].map((n) => ({ at: n, state: { pad: 'x'.repeat(50) } }));
    mem.set(BACKUPS, JSON.stringify(copies));
    // Room for the entries only once at most one copy is left.
    refuse = (k) => k === KEY && JSON.parse(mem.get(BACKUPS) || '[]').length > 1;
    store.update((s) => { s.ui.bossMargin = 2; });
    store.flush();
    assert.equal(JSON.parse(mem.get(KEY)).ui.bossMargin, 2);
    assert.equal(JSON.parse(mem.get(BACKUPS)).length, 1, 'the newest copy is kept');
    assert.equal(store.isStorageOk(), true);
    // No room while any copy is there: the copies go, the entries stay.
    mem.set(BACKUPS, JSON.stringify(copies));
    refuse = (k) => k === KEY && mem.has(BACKUPS);
    store.update((s) => { s.ui.bossMargin = 3; });
    store.flush();
    assert.equal(JSON.parse(mem.get(KEY)).ui.bossMargin, 3);
    assert.equal(mem.has(BACKUPS), false);
    assert.equal(store.isStorageOk(), true);
  } finally {
    refuse = () => false;
  }
});

test('#29 a refused save shows on the page in use and in the status pill, and goes away once saving works again', async () => {
  const el = new FakeNode('div');
  mounted.add(el);
  const heard = [];
  const off = store.onStorageStatus((ok) => heard.push(ok));
  try {
    render(html`<${StorageWarning} />`, el);
    await tick(5);
    assert.equal(squash(el.text), '');
    refuse = (k) => k === KEY;
    store.update((s) => { s.ui.bossMargin = 1.5; });
    store.flush();
    assert.equal(store.isStorageOk(), false);
    assert.deepEqual(heard, [false]);
    await until(() => /aren't being saved/.test(el.text), 'the warning');
    assert.match(squash(el.text), /lost when you close this tab/);
    assert.match(squash(el.text), /Export a backup/);
    const base = { syncOn: false, sync: { state: 'off' }, meta: { checkedAt: new Date(1e12).toISOString(), ok: true, errors: [] }, news: [], tablesChecked: '2026-11-23', now: 1e12 };
    const st = appStatus({ ...base, storageOk: false });
    assert.deepEqual([st.level, st.label], ['error', 'Not saving']);
    refuse = () => false;
    store.update((s) => { s.ui.bossMargin = 1; });
    store.flush();
    assert.deepEqual(heard, [false, true]);
    await until(() => squash(el.text) === '', 'the warning to go');
  } finally {
    refuse = () => false;
    off();
    render(null, el);
    mounted.delete(el);
  }
});

// ---- #30: asking the browser to keep the entries ------------------------------------------------------------------
test('#30 the browser is asked once to keep the entries; Settings says what it answered', async () => {
  mem.delete('maple-tracker:persist');
  let asks = 0;
  let granted = false;
  const nav = { storage: { persisted: async () => granted, persist: async () => { asks++; return false; } } };
  assert.equal(await persist.askToKeepOnce(nav, 1), 'refused');
  assert.equal(await persist.askToKeepOnce(nav, 2), 'asked before');
  assert.equal(asks, 1, 'never asked twice');
  granted = true;
  assert.equal(await persist.askToKeepOnce(nav, 3), 'kept');
  assert.equal(await persist.storageKept(nav), true);
  assert.equal(await persist.askToKeepOnce({}, 4), 'unsupported');
  assert.equal(await persist.storageKept({}), null);
  mem.delete('maple-tracker:persist');
  assert.equal(await persist.askToKeepOnce({ storage: { persist: async () => true } }, 5), 'kept');

  const base = { syncOn: false, sync: { state: 'off' }, meta: { checkedAt: new Date(1e12).toISOString(), ok: true, errors: [] }, news: [], tablesChecked: '2026-11-23', now: 1e12 };
  const part = (o) => appStatus({ ...base, ...o }).parts.find((p) => p.key === 'storage');
  assert.equal(part({}), undefined, 'the pill says nothing unless saving fails');
  assert.match(part({ storageKept: true }).text, /agreed to keep/);
  assert.match(part({ storageKept: false }).text, /may remove them/);
  assert.match(part({ storageKept: false }).text, /only copy/);
  assert.match(part({ storageKept: null, syncOn: true, sync: { state: 'ok' } }).text, /Sync keeps a copy/);
  assert.equal(appStatus({ ...base, storageKept: false }).label, 'Data fresh · sync off', 'not a warning');
});

// ---- #31: the last tick before leaving ------------------------------------------------------------------------------
test('#31 a change made just before the page is hidden is sent at once, small enough to outlive the page', async () => {
  const calls = [];
  let remote = '{}';
  let online = true;
  globalThis.fetch = async (url, o = {}) => {
    calls.push({ url: String(url), method: o.method || 'GET', keepalive: Boolean(o.keepalive) });
    if (!online) throw new TypeError('Failed to fetch');
    if (o.method === 'PATCH') remote = JSON.parse(o.body).files['maple-tracker.json'].content;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'g1', files: { 'maple-tracker.json': { content: remote } } }) };
  };
  mem.set(SYNC, JSON.stringify({ token: 'not-a-token', gistId: 'g1' }));
  mem.delete(UNSENT);
  try {
    sync.startSync();
    await until(() => sync.syncStatus().state === 'ok', 'the first sync');
    calls.length = 0;
    store.update((s) => { s.ui.bossMargin = 2; });
    globalThis.document.visibilityState = 'hidden';
    fire('visibilitychange');
    fire('pagehide');
    await until(() => calls.some((c) => c.method === 'PATCH'), 'the upload');
    const patch = calls.find((c) => c.method === 'PATCH');
    assert.equal(patch.keepalive, true, 'a small upload may finish after the page closes');
    assert.equal(JSON.parse(remote).ui.bossMargin, 2);
    await until(() => !mem.has(UNSENT), 'the note to be cleared once sent');
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 1, 'sent once, not again for pagehide');

    // No connection while leaving: the change is noted and the next open says it is sending it.
    globalThis.document.visibilityState = 'visible';
    online = false;
    store.update((s) => { s.ui.bossMargin = 3; });
    globalThis.document.visibilityState = 'hidden';
    fire('visibilitychange');
    await until(() => sync.syncStatus().state === 'error', 'the failed upload');
    assert.ok(mem.has(UNSENT));
    online = true;
    globalThis.document.visibilityState = 'visible';
    sync.startSync();
    assert.match(sync.syncStatus().message, /just before leaving/);
    await until(() => sync.syncStatus().state === 'ok', 'the catch-up sync');
    assert.equal(JSON.parse(remote).ui.bossMargin, 3);
    await until(() => !mem.has(UNSENT), 'the note to be cleared');
    // Hidden with nothing waiting: nothing is sent.
    calls.length = 0;
    globalThis.document.visibilityState = 'hidden';
    fire('visibilitychange');
    await tick(20);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.document.visibilityState = 'visible';
    sync.disconnect();
    mem.delete(SYNC);
    mem.delete(UNSENT);
  }
});

// ---- the whole app for three players --------------------------------------------------------------------------------
test('the app renders the header clocks, the storage line and the iPhone note for a Challenger main, a non-Challenger alt and a new player', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const name = String(url).split('data/')[1];
    const file = siteFile(`data/${name}`);
    if (!name || !existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
    const text = readFileSync(file, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  };
  const root = new FakeNode('div');
  globalThis.document.getElementById = () => root;
  globalThis.history = { replaceState() {} };
  globalThis.location.hash = '#today';
  const BAD = /undefined|NaN|\[object/;
  try {
    await import('../../site/app/main.js');
    mounted.add(root);
    await until(() => root.find((n) => n.attrs.class === 'clocks'), 'the app to start');
    const pills = root.find((n) => n.attrs.class === 'clocks').childNodes.filter((n) => n.nodeType === 1).map((n) => squash(n.text));
    assert.match(pills[0], /UTC · \d\d:\d\d KST$/);
    assert.deepEqual(pills.slice(1).map((p) => p.split(' ').slice(0, p.startsWith('Thu') ? 2 : 1).join(' ')), ['Daily', 'Thu bosses', 'Wed', 'Mon']);
    assert.ok(root.find((n) => n.attrs.class === 'utc'), 'the UTC half can be hidden on phones');
    const players = {
      main: [{ id: 'main', name: 'Main', cls: 'Erel Light', level: 264, region: 'na', world: 'heroic', challenger: true, mainStat: 'STR', beyondBurning: true }],
      alt: [{ id: 'alt', name: 'Alt', cls: 'Hero', level: 210, region: 'na', world: 'heroic', challenger: false, mainStat: 'STR' }],
      fresh: []
    };
    // The page follows the address once its effect has subscribed (effects can run late).
    await until(() => (handlers.hashchange || []).length > 0, 'the router to listen');
    for (const [who, characters] of Object.entries(players)) {
      store.replaceState({ ...store.blankState(), characters, activeId: characters[0] ? characters[0].id : null });
      for (const route of ['today', 'settings']) {
        globalThis.location.hash = '#' + route;
        fire('hashchange');
        const want = route === 'settings' ? /Saving in this browser/ : characters.length ? /Do today/ : /Add your character/;
        await until(() => want.test(root.text) && (!characters.length || root.text.includes(characters[0].name)), `${who} ${route}`);
        const text = squash(root.text);
        assert.doesNotMatch(text, BAD, `${who} ${route}`);
        if (route === 'settings') {
          assert.match(text, /home-screen app keeps its own saved entries/);
          assert.match(text, /can't say whether it keeps them/);
        }
        assert.doesNotMatch(text, /aren't being saved/, 'no warning while saving works');
      }
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
