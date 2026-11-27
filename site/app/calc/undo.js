// Undo for one action, worked out from the saved state before and after it. No DOM.
//
// An undo is never a rollback of the whole state: it is a new edit that puts back only the values the action
// changed, and only where they still hold what the action left. A value changed since (by sync, another tab or
// another edit) is left alone. Because it is an ordinary edit, every part it touches gets a fresh sync stamp.

// Bookkeeping, not entries: never compared, never put back.
const SKIP = new Set(['v', 'updatedAt', 'stamps', 'asOf', 'cleared']);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Keys every object inherits ("__proto__", "constructor") are never walked or written.
const safe = (k) => !(k in Object.prototype);

export function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
}

const copy = (v) => (v === undefined ? undefined : structuredClone(v));

// Every value that differs between two states, as { path, was, now } (undefined = not there). Objects are walked
// key by key; arrays and plain values are compared whole.
export function changesBetween(before, after) {
  const out = [];
  const walk = (a, b, path) => {
    const keys = new Set([...(isObj(a) ? Object.keys(a) : []), ...(isObj(b) ? Object.keys(b) : [])]);
    for (const k of keys) {
      if (!safe(k) || (path.length === 0 && SKIP.has(k))) continue;
      const x = isObj(a) && Object.hasOwn(a, k) ? a[k] : undefined;
      const y = isObj(b) && Object.hasOwn(b, k) ? b[k] : undefined;
      if (isObj(x) && isObj(y)) walk(x, y, [...path, k]);
      else if (!same(x, y)) out.push({ path: [...path, k], was: copy(x), now: copy(y) });
    }
  };
  if (isObj(before) && isObj(after)) walk(before, after, []);
  return out;
}

function getAt(s, path) {
  let v = s;
  for (const k of path) {
    if (!isObj(v) || !Object.hasOwn(v, k)) return undefined;
    v = v[k];
  }
  return v;
}

function setAt(s, path, value) {
  let o = s;
  for (const k of path.slice(0, -1)) {
    if (!isObj(o[k])) o[k] = {};
    o = o[k];
  }
  const last = path[path.length - 1];
  if (value === undefined) delete o[last];
  else o[last] = copy(value);
}

// Puts back, inside `s` (a state being edited), each change that still holds the value the action left.
// Returns { undone, skipped }: how many values were put back, and how many had changed since and were kept.
export function revertChanges(s, changes) {
  let undone = 0;
  let skipped = 0;
  for (const c of changes) {
    if (!c.path.length || c.path.some((k) => !safe(k)) || SKIP.has(c.path[0])) continue;
    if (!same(getAt(s, c.path), c.now)) { skipped++; continue; }
    setAt(s, c.path, c.was);
    undone++;
  }
  return { undone, skipped };
}
