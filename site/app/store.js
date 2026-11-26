import { useEffect, useReducer } from '../vendor/htm-preact.mjs';
import { mergeStates, sameEntries, sameStamps, seedStamps, stampEdit, units } from './calc/merge.js';
import { addBackup } from './calc/backups.js';
import { hasSharedTicks } from './calc/checklist.js';
import { dayKey } from './time.js';
import { sanitiseState } from './calc/sanitise.js';
import { dateTyped } from './calc/progress.js';

// Everything you enter lives in this browser (localStorage). Export a backup from Settings to move it.
const KEY = 'maple-tracker:v1';
const listeners = new Set();
let storageOk = true;
// The stored text this tab last read or wrote. When storage holds something else, another tab has saved since.
let lastWritten = null;
// When "Clear all data" was last pressed in this browser (0: never). It is saved next to the entries as "cleared"
// and is not one of them: it never goes into a backup, an export or the synced copy. A stored copy with a later
// time replaces whatever a tab holds; one with an earlier time was saved before the clearing and is ignored.
// That holds however many changes either tab has made since (see takeStored).
let clearedAt = 0;
// True when loading dated a typed figure that had no date (see normalise): the copy is then saved once.
let datedOnLoad = false;
const clearedOf = (raw) => (raw && typeof raw === 'object' && typeof raw.cleared === 'number' && Number.isFinite(raw.cleared) && raw.cleared > 0 ? raw.cleared : 0);

export function blankState() {
  return {
    v: 1,
    characters: [],
    activeId: null,
    checklist: { items: {}, resets: {}, flags: {}, history: {}, owner: null, ownerSet: false },
    bosses: {},
    // symbols[charId][areaId] = { level, have, daily?, weekly?, at }; liberation[charId][weapon] = { stage, traces,
    // picks, pass?, at }. `at` is when the figures were last typed; it starts out missing and normalise() fills it.
    symbols: {},
    liberation: {},
    ibp: {},
    erda: {},
    gear: {},
    level: {},
    pitch: {},
    shops: {},
    champions: { slots: [], raid: {} },
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
  delete out.cleared; // belongs to this browser's storage, not to the entries (see clearedAt)
  // Ticks used to be one shared list. The first time this version loads, whatever was ticked is credited to the
  // character that was active, so that day's and week's ticks are not lost (see calc/checklist.js).
  // This is decided once (ownerSet): after that the owner only changes when its character is deleted.
  if (!out.checklist.ownerSet && out.characters.length) {
    if (!out.checklist.owner && hasSharedTicks(out.checklist)) out.checklist.owner = out.activeId;
    out.checklist.ownerSet = true;
  }
  if (out.checklist.owner && !out.characters.some((c) => c.id === out.checklist.owner)) out.checklist.owner = null;
  // Symbol counts and traces saved before they carried the day they were typed are dated now, so their dates
  // count from the day this version first loads them. No change time moves: for sync nothing was edited, and two
  // devices that dated the same entry differently settle on one of the two dates.
  if (dateTyped(out, Date.now())) datedOnLoad = true;
  // Copies saved before sync merged part by part have no stamps: date every part by the copy's own updatedAt.
  out.stamps = { ...seedStamps(out) };
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    lastWritten = raw;
    const parsed = raw ? JSON.parse(raw) : null;
    clearedAt = clearedOf(parsed);
    return normalise(parsed);
  } catch {
    storageOk = false;
    return blankState();
  }
}

let state = load();
let saveTimer = null;
// Keeps the dates given on load, so the next visit does not date the same figures again.
if (datedOnLoad) save();

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
// Returns false when that copy is gone; otherwise { kept }: whether what was there before could be saved as a
// "before restore" copy (it cannot when the browser is out of room).
export function restoreBackup(at) {
  const b = readBackups().find((x) => x.at === at);
  if (!b) return false;
  const kept = snapshotNow('before restore');
  replaceState(structuredClone(b.state));
  return { kept };
}
// The automatic copy is taken once per game day: when the page loads, and before the first change of a new day
// in a tab that stayed open. One try a day, so a full browser never slows every edit.
let snapDay = null;
function dailySnapshot() {
  const d = dayKey(Date.now());
  if (d === snapDay) return;
  snapDay = d;
  try { snapshotNow(); } catch { /* a failed safety copy must never stop the app */ }
}
dailySnapshot();

// A copy cleared by the version before this one: no change times at all, and no "cleared" time either.
const isReset = (s) => !s.updatedAt && Object.keys(s.stamps || {}).length === 0;

// Another tab (or the installed app) saved `raw` since this tab last read storage. Its entries are merged in part
// by part, like a synced copy, so neither tab overwrites the other. Clearing is the exception, because merging
// would bring the cleared data back:
// - a copy cleared more recently than this tab is taken as it is, with whatever was entered after the clearing;
// - a copy from before this tab's clearing is ignored (this tab's copy replaces it).
// Returns { changed, ahead }: whether this tab's entries changed, and whether this tab holds something the
// stored copy lacks.
function takeStored(raw) {
  let other;
  let cleared;
  try {
    const parsed = JSON.parse(raw);
    // A copy saved by the version before this one carries no "cleared" time at all.
    cleared = parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'cleared') ? clearedOf(parsed) : null;
    other = normalise(parsed);
  } catch { return { changed: false, ahead: true }; }
  if (cleared !== null && cleared < clearedAt) return { changed: false, ahead: true };
  const before = state;
  const adopt = cleared !== null ? cleared > clearedAt : isReset(other);
  if (cleared !== null) clearedAt = cleared;
  const next = adopt ? other : normalise(mergeStates(state, other));
  const changed = !(sameEntries(next, before) && sameStamps(next, before));
  if (changed) state = next;
  return { changed, ahead: !(sameEntries(state, other) && sameStamps(state, other)) };
}

function writeNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  let changed = false;
  try {
    const stored = localStorage.getItem(KEY);
    // (After "Clear all data" in this tab, what another tab saved before that is ignored: see takeStored.)
    if (typeof stored === 'string' && stored !== lastWritten) changed = takeStored(stored).changed;
    const text = JSON.stringify({ ...state, cleared: clearedAt });
    localStorage.setItem(KEY, text);
    lastWritten = text;
    storageOk = true;
  } catch {
    storageOk = false;
  }
  if (changed) listeners.forEach((fn) => fn(state));
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 250);
}

// Writes a pending change at once. Called when the page is hidden or closed, so the last tick is never lost.
export function flush() {
  if (saveTimer !== null) writeNow();
}

function onStorage(e) {
  if (!e || e.key !== KEY || typeof e.newValue !== 'string' || e.newValue === lastWritten) return;
  const { changed, ahead } = takeStored(e.newValue);
  if (ahead) save();
  else lastWritten = e.newValue;
  if (changed) listeners.forEach((fn) => fn(state));
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', onStorage);
  window.addEventListener('pagehide', flush);
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

export function getState() {
  return state;
}

export function isStorageOk() {
  return storageOk;
}

// Every changed part gets its own time (stampEdit in calc/merge.js). (Moving the old whole-part "ui"/"mesos"
// stamp as well was tried and dropped: it made entries added on another device, which have no stamp of their
// own here, look older than any later edit, so the merge deleted them. A character's parts do move their
// whole-part stamp, after giving every entry its own: a device still on the version before reads only that one.)
// A stamp never goes backwards: on a device whose clock is behind, an edit to something another device changed
// "later" still gets the newer time, so the next sync does not undo it. (A time more than a day ahead counts as
// never changed, so a badly wrong stamp is not built on.)
const laterThan = (updatedAt, now) => Math.max(now, (updatedAt > now + 86400000 ? 0 : updatedAt || 0) + 1);

export function update(mutator) {
  dailySnapshot();
  const next = structuredClone(state);
  mutator(next);
  const now = Date.now();
  stampEdit(next.stamps, state, next, now);
  next.updatedAt = laterThan(state.updatedAt, now);
  state = next;
  save();
  listeners.forEach((fn) => fn(state));
}

// keepTime: used by sync so a merged copy keeps its own timestamps.
export function replaceState(raw, keepTime = false) {
  dailySnapshot();
  const before = state;
  state = normalise(raw);
  if (!keepTime || !state.updatedAt) {
    // An import or a reset replaces everything, so every part (kept, changed or removed) is stamped now.
    const now = Date.now();
    state.stamps = stampEdit({}, before, state, now, new Set([...units(before).keys(), ...units(state).keys()]));
    state.updatedAt = laterThan(before.updatedAt, now);
  }
  save();
  listeners.forEach((fn) => fn(state));
}

// "Clear all data": a fresh start with no change times at all. Stamping every removed part as changed now (as
// replaceState does for an import) would make those removals newer than everything in the synced copy, so
// reconnecting Sync would delete the data on every other device. With no stamps, a reconnect downloads it.
// The empty copy is written at once, with the time of the clearing, so other open tabs take it as it is and
// nothing saved before it (by this tab or another) can come back. Whatever this tab records a moment later is
// an ordinary change on top of the cleared copy.
export function resetState() {
  state = normalise(blankState());
  state.stamps = {};
  state.updatedAt = 0;
  // Later than any clearing another tab has saved, even one this tab has not heard of yet.
  let known = clearedAt;
  try { known = Math.max(known, clearedOf(JSON.parse(localStorage.getItem(KEY) || 'null'))); } catch { /* unreadable: this tab's own time stands */ }
  clearedAt = Math.max(Date.now(), known + 1);
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    const text = JSON.stringify({ ...state, cleared: clearedAt });
    localStorage.setItem(KEY, text);
    lastWritten = text;
    storageOk = true;
  } catch {
    storageOk = false;
  }
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
  // Own entries only: an id such as "constructor" must never find something inherited.
  if (!Object.hasOwn(s[key], charId) || !s[key][charId]) s[key][charId] = make();
  return s[key][charId];
}

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}
