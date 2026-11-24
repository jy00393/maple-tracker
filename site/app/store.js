import { useEffect, useReducer } from '../vendor/htm-preact.mjs';
import { changedPaths, seedStamps, units } from './calc/merge.js';
import { addBackup } from './calc/backups.js';
import { sanitiseState } from './calc/sanitise.js';

// Everything you enter lives in this browser (localStorage). Export a backup from Settings to move it.
const KEY = 'maple-tracker:v1';
const listeners = new Set();
let storageOk = true;

export function blankState() {
  return {
    v: 1,
    characters: [],
    activeId: null,
    checklist: { items: {}, resets: {}, flags: {}, history: {}, owner: null, ownerSet: false },
    bosses: {},
    symbols: {},
    liberation: {},
    ibp: {},
    erda: {},
    gear: {},
    level: {},
    pitch: {},
    shops: {},
    mesos: { held: 0, goals: [], ursus: null, ursusRuns: 1, farmPerHour: null, farmHours: null, other: null },
    incomeHistory: {},
    ui: { hideClassic: true, lastSeenNews: 0, eventsView: 'timeline', todaySales: false, hiddenEvents: {}, seasonDone: {} },
    // When each part last changed, so sync can merge two devices part by part (see calc/merge.js).
    stamps: {},
    updatedAt: 0
  };
}

function normalise(raw) {
  const base = blankState();
  if (!raw || typeof raw !== 'object') return base;
  // Whatever was stored, imported or synced is first brought into the shape the pages expect (calc/sanitise.js).
  const out = sanitiseState(raw, base);
  // Ticks used to be one shared list. The first time this version loads, whatever was ticked is credited to the
  // character that was active, so that day's and week's ticks are not lost (see calc/checklist.js).
  // This is decided once (ownerSet): after that the owner only changes when its character is deleted.
  if (!out.checklist.ownerSet && out.characters.length) {
    if (!out.checklist.owner && Object.keys(out.checklist.items).some((k) => !k.includes('|'))) out.checklist.owner = out.activeId;
    out.checklist.ownerSet = true;
  }
  if (out.checklist.owner && !out.characters.some((c) => c.id === out.checklist.owner)) out.checklist.owner = null;
  // Copies saved before sync merged part by part have no stamps: date every part by the copy's own updatedAt.
  out.stamps = { ...seedStamps(out) };
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return normalise(raw ? JSON.parse(raw) : null);
  } catch {
    storageOk = false;
    return blankState();
  }
}

let state = load();
let saveTimer = null;

// Safety copies: one snapshot per game day, kept in this browser only (see calc/backups.js). Never synced.
const BACKUPS_KEY = 'maple-tracker:backups';
function readBackups() {
  try { return addBackup(JSON.parse(localStorage.getItem(BACKUPS_KEY) || '[]'), null, Date.now()); } catch { return []; }
}
function writeBackups(list) {
  try { localStorage.setItem(BACKUPS_KEY, JSON.stringify(list)); return true; } catch { return false; }
}
export function listBackups() {
  return readBackups().slice().reverse();
}
export function snapshotNow(label = null) {
  const next = addBackup(readBackups(), state, Date.now(), label);
  // If the browser is out of room, keep fewer copies rather than none.
  return writeBackups(next) || writeBackups(next.slice(-3)) || writeBackups(next.slice(-1));
}
export function restoreBackup(at) {
  const b = readBackups().find((x) => x.at === at);
  if (!b) return false;
  snapshotNow('before restore');
  replaceState(structuredClone(b.state));
  return true;
}
try { snapshotNow(); } catch { /* a failed safety copy must never stop the app */ }

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOk = true;
    } catch {
      storageOk = false;
    }
  }, 250);
}

export function getState() {
  return state;
}

export function isStorageOk() {
  return storageOk;
}

export function update(mutator) {
  const next = structuredClone(state);
  mutator(next);
  const now = Date.now();
  for (const path of changedPaths(state, next)) next.stamps[path] = now;
  next.updatedAt = now;
  state = next;
  save();
  listeners.forEach((fn) => fn(state));
}

// keepTime: used by sync so a merged copy keeps its own timestamps.
export function replaceState(raw, keepTime = false) {
  const before = state;
  state = normalise(raw);
  if (!keepTime || !state.updatedAt) {
    // An import or a reset replaces everything, so every part (kept, changed or removed) is stamped now.
    const now = Date.now();
    state.stamps = {};
    for (const path of new Set([...units(before).keys(), ...units(state).keys()])) state.stamps[path] = now;
    state.updatedAt = now;
  }
  save();
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useStore() {
  const [, force] = useReducer((x) => x + 1, 0);
  // The page starts listening a moment after it first draws. If something was saved in that gap, draw again.
  const drawn = state;
  useEffect(() => {
    if (state !== drawn) force();
    return subscribe(() => force());
  }, []);
  return state;
}

export function activeCharacter(s = state) {
  return s.characters.find((c) => c.id === s.activeId) || null;
}

// Per-character sub-state, created on first use.
export function charSlice(s, key, charId, make) {
  if (!s[key][charId]) s[key][charId] = make();
  return s[key][charId];
}

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}
