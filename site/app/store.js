import { useEffect, useReducer } from '../vendor/htm-preact.mjs';

// Everything you enter lives in this browser (localStorage). Export a backup from Settings to move it.
const KEY = 'maple-tracker:v1';
const listeners = new Set();
let storageOk = true;

export function blankState() {
  return {
    v: 1,
    characters: [],
    activeId: null,
    checklist: { items: {}, resets: {}, flags: {}, history: {} },
    bosses: {},
    symbols: {},
    liberation: {},
    ibp: {},
    erda: {},
    gear: {},
    level: {},
    mesos: { held: 0, goals: [], ursus: null, ursusRuns: 1, farmPerHour: null, farmHours: null, other: null },
    incomeHistory: {},
    ui: { hideClassic: true, lastSeenNews: 0, eventsView: 'timeline' },
    updatedAt: 0
  };
}

function normalise(raw) {
  const base = blankState();
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base, ...raw };
  for (const key of ['checklist', 'ui', 'mesos']) out[key] = { ...base[key], ...(raw[key] || {}) };
  if (!Array.isArray(out.mesos.goals)) out.mesos.goals = [];
  for (const key of ['bosses', 'symbols', 'liberation', 'ibp', 'erda', 'gear', 'level', 'incomeHistory']) {
    out[key] = raw[key] && typeof raw[key] === 'object' ? raw[key] : {};
  }
  out.checklist.items = out.checklist.items || {};
  out.checklist.resets = out.checklist.resets || {};
  out.checklist.flags = out.checklist.flags || {};
  out.checklist.history = out.checklist.history || {};
  out.characters = Array.isArray(raw.characters) ? raw.characters.filter((c) => c && c.id) : [];
  if (!out.characters.some((c) => c.id === out.activeId)) out.activeId = out.characters[0]?.id ?? null;
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
  next.updatedAt = Date.now();
  state = next;
  save();
  listeners.forEach((fn) => fn(state));
}

// keepTime: used by sync so a pulled copy keeps its own timestamp.
export function replaceState(raw, keepTime = false) {
  state = normalise(raw);
  if (!keepTime || !state.updatedAt) state.updatedAt = Date.now();
  save();
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useStore() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => subscribe(() => force()), []);
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
