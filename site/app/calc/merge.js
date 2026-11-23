// Sync merge. Saved state is split into small units (one checklist tick, one character's gear, the meso planner…).
// Every unit carries the time it last changed (state.stamps), and merging two copies keeps the newer side of each
// unit, so a tick on the phone no longer wipes a gear edit made on the PC.
const PER_CHILD = new Set(['bosses', 'symbols', 'liberation', 'ibp', 'erda', 'gear', 'level', 'incomeHistory']);
const CHECKLIST_PARTS = new Set(['items', 'resets', 'flags', 'history']);
const SKIP = new Set(['v', 'updatedAt', 'stamps']);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// path -> value for every unit in a state.
export function units(state) {
  const out = new Map();
  if (!isObj(state)) return out;
  for (const key of Object.keys(state)) {
    if (SKIP.has(key)) continue;
    const val = state[key];
    if (PER_CHILD.has(key)) {
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

function locate(state, path) {
  const segs = path.split('/');
  if (segs[0] === 'checklist' && segs.length > 1) {
    if (!isObj(state.checklist)) state.checklist = {};
    if (CHECKLIST_PARTS.has(segs[1]) && segs.length > 2) {
      if (!isObj(state.checklist[segs[1]])) state.checklist[segs[1]] = {};
      return [state.checklist[segs[1]], segs.slice(2).join('/')];
    }
    return [state.checklist, segs.slice(1).join('/')];
  }
  if (PER_CHILD.has(segs[0]) && segs.length > 1) {
    if (!isObj(state[segs[0]])) state[segs[0]] = {};
    return [state[segs[0]], segs.slice(1).join('/')];
  }
  return [state, path];
}

function setUnit(state, path, value) {
  const [holder, key] = locate(state, path);
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

export function mergeStates(a, b) {
  const sa = seedStamps(a);
  const sb = seedStamps(b);
  const ua = units(a);
  const ub = units(b);
  const bNewerOverall = (b.updatedAt || 0) > (a.updatedAt || 0);
  const out = structuredClone(a);
  const stamps = {};
  for (const path of new Set([...ua.keys(), ...ub.keys(), ...Object.keys(sa), ...Object.keys(sb)])) {
    const ta = sa[path] || 0;
    const tb = sb[path] || 0;
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
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
  return out;
}

// True when two copies hold the same entries (stamps and key order aside).
export function sameEntries(a, b) {
  return changedPaths(a, b).length === 0;
}
