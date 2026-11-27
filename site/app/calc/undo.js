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

// How far a change is followed into the state: the same units sync keeps apart (calc/merge.js units()), so an Undo
// never puts back one field of a record that sync replaced whole (a checklist tick is { p, t, d }: half of it
// put back would be a tick that never existed). 'walk' = an object whose keys are units or hold units; 'whole' =
// one unit, compared and put back whole; { list: field } = a list whose entries are units, matched by that field.
// The fields of a character's "rest" (merge.js "@": gear target, template...) are each compared on their own.
const SPLIT = {
  bosses: { maps: ['picks', 'clears'] },
  gear: { maps: ['slots', 'stats'], lists: { history: 'd' } },
  level: { lists: { log: 't' } },
  erda: { maps: ['levels', 'steps', 'costs'] },
  ibp: { maps: ['done'] },
  challenger: { maps: ['done'] },
  symbols: { entries: true },
  liberation: { entries: true }
};
const WALKED = new Set(['pitch', 'shops', 'season', 'champions', 'checklist', 'ui', 'mesos', 'incomeHistory']);
const CHECKLIST_PARTS = new Set(['items', 'resets', 'flags', 'history']);
const UI_MAPS = new Set(['seasonDone', 'hiddenEvents']);
export function shapeAt(path) {
  const [p, x, k] = path;
  const split = Object.hasOwn(SPLIT, p) ? SPLIT[p] : null;
  if (path.length === 1) return p === 'characters' ? { list: 'id' } : split || WALKED.has(p) ? 'walk' : 'whole';
  if (path.length === 2) {
    if (split || p === 'pitch' || p === 'shops') return 'walk';
    if (p === 'champions') return x === 'raid' ? 'walk' : 'whole';
    if (p === 'checklist') return CHECKLIST_PARTS.has(x) ? 'walk' : 'whole';
    if (p === 'ui') return UI_MAPS.has(x) ? 'walk' : 'whole';
    if (p === 'mesos') return x === 'goals' ? { list: 'id' } : 'whole';
    return 'whole';
  }
  if (path.length === 3) {
    if (split) {
      if (split.maps && split.maps.includes(k)) return 'walk';
      if (split.lists && Object.hasOwn(split.lists, k)) return { list: split.lists[k] };
      return 'whole';
    }
    if (p === 'pitch') return k === 'drops' ? { list: 'id' } : 'whole';
    if (p === 'shops') return k === 'want' ? 'walk' : 'whole';
  }
  return 'whole';
}

// A list's entries by their key field, or null when an entry has no usable key or two share one (then the list
// is one value).
function keyed(list, field) {
  if (!Array.isArray(list)) return null;
  const out = new Map();
  for (const e of list) {
    const id = isObj(e) ? e[field] : undefined;
    if (!((typeof id === 'string' && id !== '') || (typeof id === 'number' && Number.isFinite(id))) || out.has(id)) return null;
    out.set(id, e);
  }
  return out;
}

// Every unit that differs between two states, as { path, was, now, list? } (undefined = not there; `list`: the key
// field when was and now are lists put back entry by entry).
export function changesBetween(before, after) {
  const out = [];
  const walk = (a, b, path) => {
    const keys = new Set([...(isObj(a) ? Object.keys(a) : []), ...(isObj(b) ? Object.keys(b) : [])]);
    for (const k of keys) {
      if (!safe(k) || (path.length === 0 && SKIP.has(k))) continue;
      const x = isObj(a) && Object.hasOwn(a, k) ? a[k] : undefined;
      const y = isObj(b) && Object.hasOwn(b, k) ? b[k] : undefined;
      const at = [...path, k];
      const shape = shapeAt(at);
      if (shape === 'walk' && isObj(x) && isObj(y)) walk(x, y, at);
      else if (!same(x, y)) {
        const list = isObj(shape) && keyed(x, shape.list) && keyed(y, shape.list) ? shape.list : undefined;
        out.push(list ? { path: at, was: copy(x), now: copy(y), list } : { path: at, was: copy(x), now: copy(y) });
      }
    }
  };
  if (isObj(before) && isObj(after)) walk(before, after, []);
  return out;
}

// Puts back a list change entry by entry: an entry the action removed comes back (where it was), one it added goes,
// one it changed gets its old value, each only while it still holds what the action left. An entry another device
// added or changed meanwhile is kept. Returns { undone, skipped }, or null when the list there is not one to match.
function revertList(s, c) {
  const cur = getAt(s, c.path);
  const was = keyed(c.was, c.list);
  const now = keyed(c.now, c.list);
  const have = keyed(cur === undefined ? [] : cur, c.list);
  if (!was || !now || !have) return null;
  const f = c.list;
  let list = Array.isArray(cur) ? cur.slice() : [];
  let undone = 0;
  let skipped = 0;
  const ids = new Set([...was.keys(), ...now.keys()]);
  for (const id of ids) {
    const w = was.get(id);
    const n = now.get(id);
    if (same(w, n)) continue;
    const h = have.get(id);
    if (!same(h, n)) { skipped++; continue; }
    undone++;
    if (w === undefined) { list = list.filter((e) => !(isObj(e) && e[f] === id)); continue; }
    if (h !== undefined) { list = list.map((e) => (isObj(e) && e[f] === id ? copy(w) : e)); continue; }
    // Back where it was: before the first entry that followed it then and is still here, else after the last one
    // that came before it, else at its old place.
    const old = c.was;
    const i = old.findIndex((e) => e[f] === id);
    const find = (j) => list.findIndex((e) => isObj(e) && e[f] === old[j][f]);
    let at = -1;
    for (let j = i + 1; j < old.length && at < 0; j++) at = find(j);
    for (let j = i - 1; j >= 0 && at < 0; j--) { const k = find(j); if (k >= 0) at = k + 1; }
    if (at < 0) at = Math.min(i, list.length);
    list.splice(at, 0, copy(w));
  }
  // Only a change of order (the same entries moved): put the old order back while the list is still in the new one.
  if (!undone && !skipped) {
    const order = (l) => l.map((e) => e[f]).join('\u0000');
    if (order(c.was) !== order(c.now)) {
      if (Array.isArray(cur) && order(cur) === order(c.now)) {
        list = c.was.map((e) => copy(e));
        undone++;
      } else skipped++;
    }
  }
  if (undone) setAt(s, c.path, list.length || cur !== undefined ? list : undefined);
  return { undone, skipped };
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

// Records the pages write after an action (the streak day in checklist.history, the crystal week in
// incomeHistory) are worked out for the current day or week only. An Undo pressed after the reset would leave the
// earlier period counting what was undone, so the entry for the action's period is put back to what it was before
// the action. `then`/`nowKeys`: { day, week } keys at the action and at the Undo; `prior`: { hist, inc } before the
// action. Only for parts the action changed (ticks for the streak, boss clears for the income). Returns how many
// entries were put back.
export function revertPeriods(s, changes, then, nowKeys, prior) {
  if (!then || !nowKeys || !prior) return 0;
  const touched = (part) => changes.some((c) => c.path[0] === part && !(part === 'checklist' && c.path[1] === 'history'));
  let n = 0;
  const put = (parent, key, was) => {
    const cur = parent && Object.hasOwn(parent, key) ? parent[key] : undefined;
    if (same(cur, was)) return;
    if (was === undefined) delete parent[key];
    else parent[key] = copy(was);
    n++;
  };
  if (then.day !== nowKeys.day && touched('checklist') && isObj(s.checklist) && isObj(s.checklist.history)) put(s.checklist.history, then.day, prior.hist);
  if (then.week !== nowKeys.week && touched('bosses') && isObj(s.incomeHistory)) put(s.incomeHistory, then.week, prior.inc);
  return n;
}

// Puts back, inside `s` (a state being edited), each change that still holds the value the action left.
// Returns { undone, skipped }: how many values were put back, and how many had changed since and were kept.
export function revertChanges(s, changes) {
  let undone = 0;
  let skipped = 0;
  for (const c of changes) {
    if (!c.path.length || c.path.some((k) => !safe(k)) || SKIP.has(c.path[0])) continue;
    const r = c.list ? revertList(s, c) : null;
    if (r) { undone += r.undone; skipped += r.skipped; continue; }
    if (!same(getAt(s, c.path), c.now)) { skipped++; continue; }
    setAt(s, c.path, c.was);
    undone++;
  }
  return { undone, skipped };
}
