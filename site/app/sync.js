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
  try {
    res = await fetch(API + path, {
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
  } catch {
    throw new Error(OFFLINE);
  }
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

async function writeRemote(c) {
  await gh(`/gists/${c.gistId}`, c.token, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(getState()) } } }) }, GIST_GONE);
}

// One round trip: read the gist, merge it with this device part by part (calc/merge.js), then save whichever
// side was missing something. Nothing is overwritten wholesale, so two devices can both have new entries.
async function syncOnce() {
  const c = syncConfig();
  if (!c) return;
  setStatus('busy', 'Syncing…');
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
export function syncNow() {
  // A failure is recorded in the shared status, so the top-bar pill never sticks on "Syncing…".
  const run = queue.then(syncOnce).catch((e) => { setStatus('error', e.message); throw e; });
  queue = run.catch(() => {});
  return run;
}
export const pull = syncNow;
export const push = syncNow;

function listen() {
  if (started) return;
  started = true;
  subscribe(() => {
    if (applying || !syncConfig()) return;
    clearTimeout(timer);
    timer = setTimeout(() => push().catch((e) => setStatus('error', e.message)), 4000);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && syncConfig()) pull().catch((e) => setStatus('error', e.message));
  });
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
  setStatus('off', 'Not connected');
}

export function startSync() {
  if (!syncConfig()) return;
  listen();
  // Shown at once, so the status is never "not connected" while a token is saved.
  setStatus('busy', 'Syncing…');
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
