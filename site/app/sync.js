// Optional sync between devices through a secret GitHub Gist. The token and gist id stay in this browser only
// (never in exported backups). The two copies are merged part by part; for each part the newer edit wins.
import { getState, replaceState, subscribe } from './store.js';
import { futureStamps, mergeStates, sameEntries, sameStamps } from './calc/merge.js';

const KEY = 'maple-tracker:sync';
const FILE = 'maple-tracker.json';
const API = 'https://api.github.com';
const listeners = new Set();
let status = { state: 'off', message: 'Not connected', at: 0 };
let started = false;
let applying = false;
let timer = null;

// While the page is on screen it also looks at the gist on a timer, so ticks made on the other device show up
// without switching tabs. One small request each time, far inside GitHub's limit (5,000 an hour with a token).
// After failures in a row the wait doubles, up to an hour; when GitHub says to wait (a rate limit), nothing is
// sent by itself before the time it gives.
export const POLL_MS = 5 * 60000;
const POLL_MAX = 60 * 60000;
const POLL_CHECK = 60000;
let lastRun = 0; // when the last round trip with the gist started
let fails = 0; // failed round trips in a row
let holdUntil = 0; // GitHub asked for no requests before this time

// What GitHub's answer says about waiting: "Retry-After" seconds, or the reset time of a used-up rate limit.
function noteLimit(res) {
  const h = res && res.headers && typeof res.headers.get === 'function' ? res.headers : null;
  if (!h || (res.status !== 403 && res.status !== 429)) return;
  const after = Number(h.get('retry-after'));
  const reset = Number(h.get('x-ratelimit-reset'));
  let until = 0;
  if (Number.isFinite(after) && after > 0) until = Date.now() + after * 1000;
  else if (h.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset) && reset > 0) until = reset * 1000;
  // Never trusted beyond a day: a wrong header must not switch the timer off for good.
  if (until > Date.now()) holdUntil = Math.min(until, Date.now() + 86400000);
}

const onScreen = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
const online = () => typeof navigator === 'undefined' || !navigator || navigator.onLine !== false;

// Whether a check started by the page itself (not by a button) may go out now.
function autoAllowed(now) {
  return Boolean(syncConfig()) && onScreen() && online() && now >= holdUntil;
}

// The timed check: only on screen, online and connected, and only when nothing has talked to the gist for a
// while (any other sync, such as the one after a tick, counts and moves the next check back).
export function pollDue(now = Date.now()) {
  return autoAllowed(now) && now - lastRun >= Math.min(POLL_MAX, POLL_MS * 2 ** Math.min(fails, 8));
}

export function syncConfig() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

function saveConfig(c) {
  if (c) localStorage.setItem(KEY, JSON.stringify(c));
  else localStorage.removeItem(KEY);
}

function setStatus(state, message) {
  status = { state, message, at: Date.now() };
  listeners.forEach((fn) => fn(status));
}

export function syncStatus() {
  return status;
}

export function onSyncStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const OFFLINE = 'Could not reach GitHub. Check your connection.';
const GIST_GONE = 'The sync gist was not found on GitHub. Disconnect and connect again.';

// `missing`: what to say when GitHub answers 404 for this request.
async function gh(path, token, opts = {}, missing = null) {
  let res;
  const send = (o) => fetch(API + path, {
    ...o,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(o.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  try {
    // A browser that refuses a "keepalive" request (some do for this kind of request) gets the plain one.
    res = await (opts.keepalive ? send(opts).catch(() => send({ ...opts, keepalive: false })) : send(opts));
  } catch {
    throw new Error(OFFLINE);
  }
  noteLimit(res);
  if (res.status === 401) throw new Error('GitHub rejected the token (401). Check it has the gist scope and hasn’t expired.');
  if (res.status === 404 && missing) throw new Error(missing);
  if (!res.ok) throw new Error(`GitHub answered ${res.status}. Try again later.`);
  if (res.status === 204) return null;
  // A sign-in page from a hotel or café network answers 200 with something that is not GitHub's reply.
  try { return await res.json(); } catch { throw new Error('GitHub sent an answer that could not be read. Check your connection.'); }
}

// The synced copy, or null when the gist holds no copy yet (a bare {}). A copy that is there but cannot be used
// (empty, cut off, damaged, or saved by a newer version) is an error: it must never be overwritten by this device.
async function readRemote(c) {
  const gist = await gh(`/gists/${c.gistId}`, c.token, {}, GIST_GONE);
  const f = gist && gist.files && gist.files[FILE];
  if (!f) throw new Error('The sync gist no longer has its data file.');
  let text = f.content;
  if (f.truncated) {
    // GitHub cuts long files short and gives a link to the whole file.
    const failed = 'The synced copy could not be downloaded. Try again.';
    if (!f.raw_url) throw new Error(failed);
    let res;
    try { res = await fetch(f.raw_url); } catch { throw new Error(failed); }
    if (!res.ok) throw new Error(failed);
    try { text = await res.text(); } catch { throw new Error(failed); }
  }
  const unreadable = 'The synced copy could not be read. Nothing was changed.';
  if (typeof text !== 'string' || !text.trim()) throw new Error('The synced copy is empty. Nothing was changed.');
  let remote;
  try { remote = JSON.parse(text); } catch { throw new Error(unreadable); }
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) throw new Error(unreadable);
  if (remote.v === 1) return remote;
  if (Object.keys(remote).length === 0) return null;
  if (typeof remote.v === 'number' && remote.v > 1) throw new Error('The synced copy was saved by a newer version of Maple Tracker. Reload this page, then sync again.');
  throw new Error(unreadable);
}

// A browser lets a request outlive the page only when it is small (the Fetch standard caps "keepalive" bodies at
// 64 KiB, shared by all such requests of the page). Kept a little under that.
export const KEEPALIVE_MAX = 60000;
async function writeRemote(c) {
  const body = JSON.stringify({ files: { [FILE]: { content: JSON.stringify(getState()) } } });
  // While the page is being left, a small upload is marked to finish even if the page closes; a larger one goes
  // out as usual and may be cut off (then it is sent on the next open: see sendBeforeLeaving).
  const keepalive = !onScreen() && new TextEncoder().encode(body).length <= KEEPALIVE_MAX;
  await gh(`/gists/${c.gistId}`, c.token, { method: 'PATCH', body, ...(keepalive ? { keepalive: true } : {}) }, GIST_GONE);
}

// One round trip: read the gist, merge it with this device part by part (calc/merge.js), then save whichever
// side was missing something. Nothing is overwritten wholesale, so two devices can both have new entries.
// quiet: a timed check; the status only changes when it finds something to say.
async function syncOnce(quiet = false) {
  const c = syncConfig();
  if (!c) return;
  lastRun = Date.now();
  if (!quiet) setStatus('busy', 'Syncing…');
  const remote = await readRemote(c);
  // Disconnected (or "Clear all data" pressed) while the gist was being read: nothing is merged or written.
  const still = () => { const now = syncConfig(); return Boolean(now) && now.gistId === c.gistId; };
  if (!still()) return;
  const local = getState();
  if (!remote) {
    await writeRemote(c);
    setStatus('ok', 'Saved to your gist');
    return;
  }
  // Change times more than a day ahead mean a device's clock is wrong. The merge ignores them (see calc/merge.js),
  // so the devices cannot agree until the clock is fixed: say so instead of reporting success.
  const skewed = futureStamps(remote) || futureStamps(local);
  const merged = mergeStates(local, remote);
  const gotNew = !sameEntries(merged, local);
  // Also adopt the merged change times when only those differ, so removal markers are never lost on the way through.
  if (gotNew || !sameStamps(merged, local)) {
    applying = true;
    try { replaceState(merged, true); } finally { applying = false; }
  }
  const sentNew = !sameEntries(merged, remote);
  if (!still()) return;
  if (sentNew || !sameStamps(merged, remote)) await writeRemote(c);
  if (skewed) {
    setStatus('warn', 'The clock on one of your devices is more than a day off, so its newest changes are ignored. Check the date and time on each device.');
    return;
  }
  setStatus('ok', gotNew && sentNew ? 'Merged entries from both devices' : gotNew ? 'Loaded newer entries from your other device' : sentNew ? 'Saved to your gist' : 'Up to date');
}

// Runs are queued so a save and a check never overlap.
let queue = Promise.resolve();
export function syncNow(quiet = false) {
  // A failure is recorded in the shared status, so the top-bar pill never sticks on "Syncing…".
  let startedAt = 0;
  const run = queue.then(() => { startedAt = Date.now(); return syncOnce(quiet === true); }).then((r) => {
    fails = 0;
    // A change noted as unsent before this round trip began is in the gist now.
    const unsent = unsentSince();
    if (unsent && unsent <= startedAt && syncConfig()) noteUnsent(false);
    return r;
  }, (e) => { fails++; setStatus('error', e.message); throw e; });
  queue = run.catch(() => {});
  return run;
}
export const pull = () => syncNow();
export const push = () => syncNow();

// A sync the page starts by itself, on a timer or when the connection returns. Held back while GitHub asked to
// wait, while offline and while hidden.
function auto(quiet = false) {
  if (!autoAllowed(Date.now())) return;
  syncNow(quiet).catch(() => {});
}

// A change made in the last seconds before the page is hidden or closed (tick, then lock the phone) is sent at
// once instead of after the usual short wait, which a phone may never let happen. Best effort: the upload is a read
// then a write, and the browser may stop the page before both are done. So the change is also noted here; the next
// open of the tracker syncs first thing anyway (startSync) and says it is sending it.
const UNSENT = 'maple-tracker:sync-unsent';
function noteUnsent(on) {
  try { if (on) localStorage.setItem(UNSENT, String(Date.now())); else localStorage.removeItem(UNSENT); } catch { /* no storage: nothing to note */ }
}
export function unsentSince() {
  try { const v = Number(localStorage.getItem(UNSENT)); return Number.isFinite(v) && v > 0 ? v : 0; } catch { return 0; }
}
function sendBeforeLeaving() {
  if (timer === null || !syncConfig()) return;
  clearTimeout(timer);
  timer = null;
  noteUnsent(true);
  if (Date.now() < holdUntil) return; // GitHub asked to wait: the next open sends it
  push().catch((e) => setStatus('error', e.message));
}

function listen() {
  if (started) return;
  started = true;
  subscribe(() => {
    if (applying || !syncConfig()) return;
    clearTimeout(timer);
    // (While GitHub asked to wait, nothing is sent; the timed check sends it once the wait is over.)
    timer = setTimeout(() => { timer = null; if (Date.now() >= holdUntil) push().catch((e) => setStatus('error', e.message)); }, 4000);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { sendBeforeLeaving(); return; }
    if (document.visibilityState === 'visible' && syncConfig() && Date.now() >= holdUntil) pull().catch((e) => setStatus('error', e.message));
  });
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('pagehide', sendBeforeLeaving);
  // Back online: catch up at once instead of waiting for the next timed check.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('online', () => auto());
  // The timer only looks at the clock once a minute; a request goes out when pollDue says so.
  const id = setInterval(() => { if (pollDue()) auto(true); }, POLL_CHECK);
  // (Outside a browser, in the tests, the timer must not keep the process alive.)
  if (id && typeof id.unref === 'function') id.unref();
}

// Finds the existing sync gist for this token, or makes a secret one with the current entries.
// GitHub does not let a web page read a token's expiry, so the date is typed in by hand (optional).
export function setTokenExpiry(date) {
  const c = syncConfig();
  if (!c) return;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : null;
  saveConfig({ ...c, expires: d });
  status = { ...status }; // a new object, so every listener re-renders
  listeners.forEach((fn) => fn(status));
}

export async function connect(token, expires) {
  const t = String(token || '').trim();
  if (!t) throw new Error('Paste a token first.');
  setStatus('busy', 'Connecting…');
  try {
    const gists = await gh('/gists?per_page=100', t);
    let gist = gists.find((g) => g.files && g.files[FILE]);
    if (!gist) {
      gist = await gh('/gists', t, { method: 'POST', body: JSON.stringify({ description: 'Maple Tracker sync (your entries)', public: false, files: { [FILE]: { content: JSON.stringify(getState()) } } }) });
    }
    saveConfig({ token: t, gistId: gist.id, expires: /^\d{4}-\d{2}-\d{2}$/.test(String(expires || '')) ? String(expires) : null });
  } catch (e) {
    setStatus(syncConfig() ? 'error' : 'off', e.message);
    throw e;
  }
  listen();
  await pull();
}

// Pairing: the PC shows a QR code of this link; the phone opens it and connects with the same token.
// The token sits in the part after '#', which browsers never send to a server.
export function pairLink() {
  const c = syncConfig();
  if (!c) return null;
  return `${location.origin}${location.pathname}#pair=${encodeURIComponent(c.token)}`;
}

export function tokenFromHash(hash) {
  const m = /^#pair=(.+)$/.exec(String(hash || ''));
  if (!m) return null;
  try { return decodeURIComponent(m[1]).trim() || null; } catch { return null; }
}

// A pairing link never connects by itself: the token waits here until the person confirms on the Settings page.
// (Otherwise any link someone sends could attach this device to their gist.)
let pendingToken = null;
const pendingListeners = new Set();
export function setPendingPair(token) { pendingToken = token || null; pendingListeners.forEach((fn) => fn(pendingToken)); }
export function pendingPair() { return pendingToken; }
// Settings listens, so a pairing link that arrives while it is already open shows its question too.
export function onPendingPair(fn) { pendingListeners.add(fn); return () => pendingListeners.delete(fn); }

export function disconnect() {
  saveConfig(null);
  clearTimeout(timer);
  timer = null;
  noteUnsent(false);
  setStatus('off', 'Not connected');
}

export function startSync() {
  if (!syncConfig()) return;
  listen();
  // Shown at once, so the status is never "not connected" while a token is saved.
  setStatus('busy', unsentSince() ? 'Sending the change you made just before leaving…' : 'Syncing…');
  pull().catch((e) => setStatus('error', e.message));
}

// Sync was connected or disconnected in another tab: this tab follows.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (!e || e.key !== KEY) return;
    if (syncConfig()) startSync();
    else { clearTimeout(timer); setStatus('off', 'Not connected'); }
  });
}
