import { html, useEffect, useReducer, useRef } from '../vendor/htm-preact.mjs';
import { getState, update } from './store.js';
import { changesBetween, revertChanges } from './calc/undo.js';

// The Undo bar: after a tick, an untick, a bulk tick, "Use this list", "Got one" or a delete, a bar at the bottom
// says what changed and offers Undo for about 6 seconds. One at a time: a new action replaces the bar.
//
// `undoable(label, fn)` runs fn (which saves through update(), once or several times) and keeps what it changed.
// Undo is a new update() that puts back only those values, and only where they still hold what the action left
// (see calc/undo.js), so an edit that arrived meanwhile by sync is kept and every sync stamp stays right.

// How long the bar stays, in ms. Tests may lengthen it so nothing depends on how fast they run.
export const undoTimes = { ms: 6000 };

let current = null; // { id, label, changes, at } or { id, label, result } after an undo
let seq = 0;
let depth = 0;
let timer = null;
let paused = false;
const listeners = new Set();
const tell = () => listeners.forEach((fn) => { try { fn(current); } catch { /* one listener must not stop the rest */ } });

function hideLater() {
  clearTimeout(timer);
  timer = null;
  if (paused || !current) return;
  const id = current.id;
  timer = setTimeout(() => { if (current && current.id === id) { current = null; tell(); } }, undoTimes.ms);
}

export function undoable(label, fn) {
  // A step inside a bigger action (a bulk tick runs many) is part of that action's one bar.
  if (depth > 0) return fn();
  const before = getState();
  depth++;
  let out;
  try { out = fn(); } finally { depth--; }
  const changes = changesBetween(before, getState());
  if (changes.length) {
    current = { id: ++seq, label: typeof label === 'function' ? label() : label, changes };
    tell();
    hideLater();
  }
  return out;
}

// Puts back what the action on the bar changed. Returns { undone, skipped }, or null when there is nothing.
export function undoLast() {
  if (!current || !current.changes) return null;
  const { changes, label } = current;
  let result = { undone: 0, skipped: 0 };
  update((s) => { result = revertChanges(s, changes); });
  current = { id: ++seq, label, result };
  tell();
  hideLater();
  return result;
}

export function dismissUndo() {
  clearTimeout(timer);
  timer = null;
  current = null;
  tell();
}

// For tests and the bar: what the bar shows now.
export function undoNow() {
  return current;
}

export function useUndo() {
  const [, force] = useReducer((x) => x + 1, 0);
  const drawn = current;
  useEffect(() => {
    if (current !== drawn) force();
    listeners.add(force);
    return () => listeners.delete(force);
  }, []);
  return current;
}

// Mounted once (main.js). role=status, so a screen reader hears what changed; it never takes the focus, so
// ticking on keeps working. While the pointer or the focus is on it, it stays.
export function UndoBar() {
  const cur = useUndo();
  const box = useRef(null);
  if (!cur) return null;
  const hold = () => { paused = true; clearTimeout(timer); timer = null; };
  const go = () => { paused = false; hideLater(); };
  const leave = (e) => { if (!box.current || !e || !box.current.contains || !box.current.contains(e.relatedTarget)) go(); };
  const after = cur.result
    ? cur.result.skipped && !cur.result.undone ? `Not undone: ${lower(cur.label)} was changed again since.`
      : cur.result.skipped ? `Undone in part: some of it was changed again since.` : `Undone: ${lower(cur.label)}.`
    : null;
  return html`<div class="undo-bar" role="status" aria-live="polite" ref=${box}
      onMouseEnter=${hold} onMouseLeave=${go} onFocusIn=${hold} onFocusOut=${leave}>
    <span class="undo-text">${after || cur.label}</span>
    ${after ? null : html`<button type="button" class="undo-btn" onClick=${() => undoLast()}>Undo</button>`}
    <button type="button" class="undo-x" aria-label="Close this message" onClick=${() => { paused = false; dismissUndo(); }}>×</button>
  </div>`;
}

const lower = (s) => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
