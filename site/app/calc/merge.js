// Sync merge. Saved state is split into small units (one checklist tick, one character, one character's gear,
// the meso planner…). Every unit carries the time it last changed (state.stamps), and merging two copies keeps
// the newer side of each unit, so a tick on the phone no longer wipes a gear edit made on the PC.
const PER_CHILD = new Set(['bosses', 'symbols', 'liberation', 'ibp', 'erda', 'gear', 'level', 'incomeHistory']);
const CHECKLIST_PARTS = new Set(['items', 'resets', 'flags', 'history']);
const SKIP = new Set(['v', 'updatedAt', 'stamps']);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const DAY = 86400000;

// path -> value for every unit in a state.
export function units(state) {
  const out = new Map();
  if (!isObj(state)) return out;
  for (const key of Object.keys(state)) {
    if (SKIP.has(key)) continue;
    const val = state[key];
    if (key === 'characters') {
      // One unit per character, so a character added on one device never replaces the other device's list.
      if (Array.isArray(val)) for (const c of val) if (c && c.id) out.set(`characters/${c.id}`, c);
    } else if (PER_CHILD.has(key)) {
      if (isObj(val)) for (const child of Object.keys(val)) out.set(`${key}/${child}`, val[child]);
    } else if (key === 'checklist') {
      if (!isObj(val)) continue;
      for (const part of Object.keys(val)) {
        if (CHECKLIST_PARTS.has(part)) {
          if (isObj(val[part])) for (const child of Object.keys(val[part])) out.set(`checklist/${part}/${child}`, val[part][child]);
        } else out.set(`checklist/${part}`, val[part]);
      }
    } else out.set(key, val);
  }
  return out;
}

function setUnit(state, path, value) {
  const segs = path.split('/');
  const rest = segs.slice(1).join('/');
  if (segs[0] === 'characters' && segs.length > 1) {
    if (!Array.isArray(state.characters)) state.characters = [];
    const i = state.characters.findIndex((c) => c && c.id === rest);
    if (value === undefined) { if (i >= 0) state.characters.splice(i, 1); }
    else if (i >= 0) state.characters[i] = structuredClone(value);
    else state.characters.push(structuredClone(value));
    return;
  }
  let holder = state;
  let key = path;
  if (segs[0] === 'checklist' && segs.length > 1) {
    if (!isObj(state.checklist)) state.checklist = {};
    if (CHECKLIST_PARTS.has(segs[1]) && segs.length > 2) {
      if (!isObj(state.checklist[segs[1]])) state.checklist[segs[1]] = {};
      holder = state.checklist[segs[1]];
      key = segs.slice(2).join('/');
    } else {
      holder = state.checklist;
      key = rest;
    }
  } else if (PER_CHILD.has(segs[0]) && segs.length > 1) {
    if (!isObj(state[segs[0]])) state[segs[0]] = {};
    holder = state[segs[0]];
    key = rest;
  }
  if (value === undefined) delete holder[key];
  else holder[key] = structuredClone(value);
}

// Paths whose value differs between two states (added, changed or removed).
export function changedPaths(prev, next) {
  const a = units(prev);
  const b = units(next);
  const out = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    if (JSON.stringify(a.get(path)) !== JSON.stringify(b.get(path))) out.push(path);
  }
  return out;
}

// Copies saved before stamps existed get one stamp per unit, dated by the copy's own updatedAt.
export function seedStamps(state) {
  if (isObj(state.stamps)) return state.stamps;
  const at = state.updatedAt || 1;
  const stamps = {};
  for (const path of units(state).keys()) stamps[path] = at;
  return stamps;
}

// A unit's stamp. Characters were first stamped as one list ("characters"), so that stamp stands in for a
// character that has none of its own yet. A stamp more than a day in the future (a badly wrong clock, or a
// doctored copy) is not trusted at all: it counts as never changed, so it cannot overwrite or remove anything.
function stampOf(stamps, path, now) {
  let t = stamps[path];
  if (t === undefined && path.startsWith('characters/')) t = stamps.characters;
  t = Number(t) || 0;
  return t > now + DAY ? 0 : t;
}

export function mergeStates(a, b, now = Date.now()) {
  const sa = seedStamps(a);
  const sb = seedStamps(b);
  const ua = units(a);
  const ub = units(b);
  const bNewerOverall = (b.updatedAt || 0) > (a.updatedAt || 0);
  const out = structuredClone(a);
  const stamps = {};
  const paths = new Set([...ua.keys(), ...ub.keys(), ...Object.keys(sa), ...Object.keys(sb)]);
  paths.delete('characters');
  for (const path of paths) {
    const ta = stampOf(sa, path, now);
    const tb = stampOf(sb, path, now);
    let takeB;
    if (tb !== ta) takeB = tb > ta;
    // Same age: a unit only one side has is kept (a removal needs a strictly newer stamp); otherwise the newer copy wins.
    else if (ua.has(path) !== ub.has(path)) takeB = ub.has(path);
    else takeB = bNewerOverall;
    if (takeB) setUnit(out, path, ub.get(path));
    const t = Math.max(ta, tb);
    if (t) stamps[path] = t;
  }
  out.stamps = stamps;
  out.updatedAt = Math.min(Math.max(a.updatedAt || 0, b.updatedAt || 0), now + DAY);
  return out;
}

// True when two copies hold the same entries (stamps and key order aside).
export function sameEntries(a, b) {
  return changedPaths(a, b).length === 0;
}

// True when two copies carry the same change times, including the markers left by removals.
export function sameStamps(a, b) {
  const sa = seedStamps(a);
  const sb = seedStamps(b);
  const keys = new Set([...Object.keys(sa), ...Object.keys(sb)]);
  for (const k of keys) if ((sa[k] || 0) !== (sb[k] || 0)) return false;
  return true;
}
