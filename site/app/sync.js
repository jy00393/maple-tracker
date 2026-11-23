// Optional sync between devices through a secret GitHub Gist. The token and gist id stay in this browser only
// (never in exported backups). Newest copy wins, judged by the state's updatedAt.
import { getState, replaceState, subscribe } from './store.js';

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

export async function push() {
  const c = syncConfig();
  if (!c) return;
  setStatus('busy', 'Saving to your gist…');
  await gh(`/gists/${c.gistId}`, c.token, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(getState()) } } }) });
  setStatus('ok', 'Saved to your gist');
}

export async function pull() {
  const c = syncConfig();
  if (!c) return;
  setStatus('busy', 'Checking your gist…');
  const gist = await gh(`/gists/${c.gistId}`, c.token);
  const f = gist.files && gist.files[FILE];
  if (!f) throw new Error('The sync gist no longer has its data file.');
  const text = f.truncated && f.raw_url ? await (await fetch(f.raw_url)).text() : f.content;
  const remote = JSON.parse(text || '{}');
  const local = getState();
  if ((remote.updatedAt || 0) > (local.updatedAt || 0)) {
    applying = true;
    replaceState(remote, true);
    applying = false;
    setStatus('ok', 'Loaded newer entries from your other device');
  } else if ((local.updatedAt || 0) > (remote.updatedAt || 0)) {
    await push();
  } else {
    setStatus('ok', 'Up to date');
  }
}

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
