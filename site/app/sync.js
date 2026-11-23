// Optional sync between devices through a secret GitHub Gist. The token and gist id stay in this browser only
// (never in exported backups). The two copies are merged part by part; for each part the newer edit wins.
import { getState, replaceState, subscribe } from './store.js';
import { mergeStates, sameEntries } from './calc/merge.js';

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

async function gh(path, token, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  if (res.status === 401) throw new Error('GitHub rejected the token (401). Check it has the gist scope and hasn’t expired.');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function readRemote(c) {
  const gist = await gh(`/gists/${c.gistId}`, c.token);
  const f = gist.files && gist.files[FILE];
  if (!f) throw new Error('The sync gist no longer has its data file.');
  const text = f.truncated && f.raw_url ? await (await fetch(f.raw_url)).text() : f.content;
  const remote = JSON.parse(text || '{}');
  return remote && typeof remote === 'object' && remote.v === 1 ? remote : null;
}

async function writeRemote(c) {
  await gh(`/gists/${c.gistId}`, c.token, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(getState()) } } }) });
}

// One round trip: read the gist, merge it with this device part by part (calc/merge.js), then save whichever
// side was missing something. Nothing is overwritten wholesale, so two devices can both have new entries.
async function syncOnce() {
  const c = syncConfig();
  if (!c) return;
  setStatus('busy', 'Syncing…');
  const remote = await readRemote(c);
  const local = getState();
  if (!remote) {
    await writeRemote(c);
    setStatus('ok', 'Saved to your gist');
    return;
  }
  const merged = mergeStates(local, remote);
  const gotNew = !sameEntries(merged, local);
  if (gotNew) {
    applying = true;
    try { replaceState(merged, true); } finally { applying = false; }
  }
  const sentNew = !sameEntries(merged, remote);
  if (sentNew) await writeRemote(c);
  setStatus('ok', gotNew && sentNew ? 'Merged entries from both devices' : gotNew ? 'Loaded newer entries from your other device' : sentNew ? 'Saved to your gist' : 'Up to date');
}

// Runs are queued so a save and a check never overlap.
let queue = Promise.resolve();
export function syncNow() {
  const run = queue.then(syncOnce);
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
export async function connect(token) {
  const t = String(token || '').trim();
  if (!t) throw new Error('Paste a token first.');
  setStatus('busy', 'Connecting…');
  const gists = await gh('/gists?per_page=100', t);
  let gist = gists.find((g) => g.files && g.files[FILE]);
  if (!gist) {
    gist = await gh('/gists', t, { method: 'POST', body: JSON.stringify({ description: 'Maple Tracker sync (your entries)', public: false, files: { [FILE]: { content: JSON.stringify(getState()) } } }) });
  }
  saveConfig({ token: t, gistId: gist.id });
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

export function disconnect() {
  saveConfig(null);
  clearTimeout(timer);
  setStatus('off', 'Not connected');
}

export function startSync() {
  if (!syncConfig()) return;
  listen();
  pull().catch((e) => setStatus('error', e.message));
}
