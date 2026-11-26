// Sync merge. Saved state is split into small units (one checklist tick, one character, one character's gear,
// the meso planner…). Every unit carries the time it last changed (state.stamps), and merging two copies keeps
// the newer side of each unit, so a tick on the phone no longer wipes a gear edit made on the PC.
const PER_CHILD = new Set(['bosses', 'symbols', 'liberation', 'ibp', 'erda', 'gear', 'level', 'incomeHistory']);
// Finer parts, so two devices never overwrite each other's entries:
//   pitch/<charId>/<dropId>             one logged drop
//   shops/<shopId>/have | claims        one number
//   shops/<shopId>/want/<itemId>        one pick
//   champions/slot/<index>              one Champion
//   champions/raid/<YYYY-MM>            one month's score
//   ui/<key>, mesos/<key>               one setting (ui/seasonDone/<id> and ui/hiddenEvents/<id>: one entry)
// Ids inside a path are URI-encoded, so an id containing "/" cannot be split wrongly.
const blankSlot = () => ({ name: '', rank: 0 });
const usedSlot = (s) => isObj(s) && Boolean((typeof s.name === 'string' && s.name.trim()) || s.rank);
const CHECKLIST_PARTS = new Set(['items', 'resets', 'flags', 'history']);
// activeId (which character is on screen) is each device's own choice, so it is neither stamped nor merged.
const SKIP = new Set(['v', 'updatedAt', 'stamps', 'activeId']);
// The same goes for which tab of a page is showing, and for the news read marker the Events page sets itself.
const LOCAL_UI = new Set(['mesosView', 'progressView', 'eventsView', 'shopId', 'lastSeenNews']);
const UI_MAPS = new Set(['seasonDone', 'hiddenEvents']);
// Per-character parts: when a character is gone after a merge, so is its data.
const PER_CHAR = ['bosses', 'symbols', 'liberation', 'ibp', 'erda', 'gear', 'level', 'pitch'];
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const DAY = 86400000;
const enc = (s) => encodeURIComponent(String(s));
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

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
    } else if (key === 'ui' || key === 'mesos') {
      if (!isObj(val)) continue;
      for (const k of Object.keys(val)) {
        if (key === 'ui' && LOCAL_UI.has(k)) continue;
        if (key === 'ui' && UI_MAPS.has(k) && isObj(val[k])) {
          for (const id of Object.keys(val[k])) out.set(`ui/${k}/${enc(id)}`, val[k][id]);
        } else if (key === 'mesos' && k === 'goals' && Array.isArray(val[k])) {
          // One unit per goal, plus their order, so goals added on two devices are both kept.
          const goals = val[k].filter((g) => isObj(g) && typeof g.id === 'string' && g.id);
          for (const g of goals) out.set(`mesos/goals/${enc(g.id)}`, g);
          out.set('mesos/goalOrder', goals.map((g) => g.id));
        } else out.set(`${key}/${k}`, val[k]);
      }
    } else if (key === 'pitch') {
      if (!isObj(val)) continue;
      for (const c of Object.keys(val)) {
        const drops = isObj(val[c]) && Array.isArray(val[c].drops) ? val[c].drops : [];
        for (const d of drops) if (isObj(d) && typeof d.id === 'string' && d.id) out.set(`pitch/${enc(c)}/${enc(d.id)}`, d);
      }
    } else if (key === 'shops') {
      if (!isObj(val)) continue;
      for (const id of Object.keys(val)) {
        const s = val[id];
        if (!isObj(s)) continue;
        for (const f of ['have', 'claims']) if (s[f]) out.set(`shops/${enc(id)}/${f}`, s[f]);
        if (isObj(s.want)) for (const item of Object.keys(s.want)) out.set(`shops/${enc(id)}/want/${enc(item)}`, s.want[item]);
      }
    } else if (key === 'champions') {
      if (!isObj(val)) continue;
      if (Array.isArray(val.slots)) val.slots.forEach((s, i) => { if (usedSlot(s)) out.set(`champions/slot/${i}`, s); });
      if (isObj(val.raid)) for (const m of Object.keys(val.raid)) out.set(`champions/raid/${m}`, val.raid[m]);
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
  if (segs[0] === 'ui' || segs[0] === 'mesos') {
    if (segs.length < 2) return; // an older whole-part stamp: nothing to place
    if (!isObj(state[segs[0]])) state[segs[0]] = {};
    const holder = state[segs[0]];
    if (segs[0] === 'ui' && UI_MAPS.has(segs[1]) && segs.length > 2) {
      if (!isObj(holder[segs[1]])) holder[segs[1]] = {};
      const id = dec(segs.slice(2).join('/'));
      if (value === undefined) delete holder[segs[1]][id];
      else holder[segs[1]][id] = structuredClone(value);
      return;
    }
    if (segs[0] === 'ui' && LOCAL_UI.has(segs[1])) return;
    if (segs[0] === 'mesos' && segs[1] === 'goals') {
      if (segs.length < 3) return;
      if (!Array.isArray(holder.goals)) holder.goals = [];
      const id = dec(segs.slice(2).join('/'));
      const i = holder.goals.findIndex((g) => g && g.id === id);
      if (value === undefined) { if (i >= 0) holder.goals.splice(i, 1); }
      else if (i >= 0) holder.goals[i] = structuredClone(value);
      else holder.goals.push(structuredClone(value));
      return;
    }
    if (segs[0] === 'mesos' && segs[1] === 'goalOrder') {
      // Goals follow the saved order; any not in it (added elsewhere) keep their place at the end.
      if (!Array.isArray(value) || !Array.isArray(holder.goals)) return;
      const rank = new Map(value.map((id, n) => [id, n]));
      holder.goals.sort((x, y) => (rank.has(x.id) ? rank.get(x.id) : 1e9) - (rank.has(y.id) ? rank.get(y.id) : 1e9));
      return;
    }
    if (value === undefined) delete holder[segs[1]];
    else holder[segs[1]] = structuredClone(value);
    return;
  }
  if (segs[0] === 'pitch') {
    if (segs.length < 3) return; // an older whole-character stamp: nothing to place
    const charId = dec(segs[1]);
    const id = dec(segs.slice(2).join('/'));
    if (!isObj(state.pitch)) state.pitch = {};
    if (!isObj(state.pitch[charId])) {
      if (value === undefined) return;
      state.pitch[charId] = { drops: [] };
    }
    const p = state.pitch[charId];
    if (!Array.isArray(p.drops)) p.drops = [];
    const i = p.drops.findIndex((d) => d && d.id === id);
    if (value === undefined) { if (i >= 0) p.drops.splice(i, 1); }
    else if (i >= 0) p.drops[i] = structuredClone(value);
    else p.drops.push(structuredClone(value));
    return;
  }
  if (segs[0] === 'shops') {
    if (segs.length < 3) return;
    const shopId = dec(segs[1]);
    if (!isObj(state.shops)) state.shops = {};
    if (!isObj(state.shops[shopId])) {
      if (value === undefined) return;
      state.shops[shopId] = { have: 0, claims: 0, want: {} };
    }
    const s = state.shops[shopId];
    if (segs[2] === 'want') {
      if (segs.length < 4) return;
      if (!isObj(s.want)) s.want = {};
      const item = dec(segs.slice(3).join('/'));
      if (value === undefined) delete s.want[item];
      else s.want[item] = value;
    } else if (segs[2] === 'have' || segs[2] === 'claims') s[segs[2]] = value === undefined ? 0 : value;
    return;
  }
  if (segs[0] === 'champions') {
    if (segs.length < 3) return;
    if (!isObj(state.champions)) state.champions = { slots: [], raid: {} };
    const c = state.champions;
    if (segs[1] === 'raid') {
      if (!isObj(c.raid)) c.raid = {};
      if (value === undefined) delete c.raid[segs[2]];
      else c.raid[segs[2]] = value;
    } else if (segs[1] === 'slot') {
      const i = Number(segs[2]);
      if (!Number.isInteger(i) || i < 0 || i > 20) return;
      if (!Array.isArray(c.slots)) c.slots = [];
      while (c.slots.length <= i) c.slots.push(blankSlot());
      c.slots[i] = value === undefined ? blankSlot() : structuredClone(value);
      while (c.slots.length && !usedSlot(c.slots[c.slots.length - 1])) c.slots.pop();
    }
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

// True when a path holds data of character `id` (its gear, bosses, drops, ticks...).
function ownedBy(path, id) {
  const segs = path.split('/');
  if (PER_CHAR.includes(segs[0]) && segs[0] !== 'pitch') return segs.slice(1).join('/') === id;
  if (segs[0] === 'pitch') return dec(segs[1] || '') === id;
  if (segs[0] === 'checklist' && (segs[1] === 'items' || segs[1] === 'flags')) return segs.slice(2).join('/').startsWith(`${id}|`);
  return false;
}

// A unit's stamp. Characters were first stamped as one list ("characters"), so that stamp stands in for a
// character that has none of its own yet. A stamp more than a day in the future (a badly wrong clock, or a
// doctored copy) is not trusted at all: it counts as never changed, so it cannot overwrite or remove anything.
function stampOf(stamps, path, now) {
  let t = stamps[path];
  if (t === undefined && path.startsWith('characters/')) t = stamps.characters;
  // Drops, shop picks and Champions were first stamped as larger parts; those stamps stand in the same way.
  if (t === undefined && (path.startsWith('pitch/') || path.startsWith('shops/'))) t = stamps[path.split('/').slice(0, 2).join('/')];
  if (t === undefined && path.startsWith('champions/')) t = stamps.champions;
  // Settings and the meso planner were each one part before.
  if (t === undefined && path.startsWith('ui/')) t = stamps.ui;
  if (t === undefined && path.startsWith('mesos/goals/')) t = stamps['mesos/goals'];
  if (t === undefined && path.startsWith('mesos/')) t = stamps.mesos;
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
  let goalOrder = null;
  const paths = new Set([...ua.keys(), ...ub.keys(), ...Object.keys(sa), ...Object.keys(sb)]);
  paths.delete('characters');
  paths.delete('activeId'); // stamped by earlier versions; no longer merged
  for (const path of paths) {
    const ta = stampOf(sa, path, now);
    const tb = stampOf(sb, path, now);
    let takeB;
    if (tb !== ta) takeB = tb > ta;
    // Same age: a unit only one side has is kept (a removal needs a strictly newer stamp); otherwise the newer copy wins.
    else if (ua.has(path) !== ub.has(path)) takeB = ub.has(path);
    // Otherwise the newer copy wins; a full tie is broken by the values themselves, so both devices pick the same.
    else if ((b.updatedAt || 0) !== (a.updatedAt || 0)) takeB = bNewerOverall;
    else takeB = JSON.stringify(ub.get(path)) > JSON.stringify(ua.get(path));
    if (takeB) setUnit(out, path, ub.get(path));
    if (path === 'mesos/goalOrder') goalOrder = takeB ? ub.get(path) : ua.get(path);
    const t = Math.max(ta, tb);
    if (t) stamps[path] = t;
  }
  // Goals are put in the winning order once every goal is in place; goals it doesn't name (added on another device)
  // follow in id order, so both devices end up with the same list.
  if (isObj(out.mesos) && Array.isArray(out.mesos.goals)) {
    const rank = new Map((Array.isArray(goalOrder) ? goalOrder : []).map((id, n) => [id, n]));
    out.mesos.goals.sort((x, y) => {
      const rx = rank.has(x.id) ? rank.get(x.id) : Infinity;
      const ry = rank.has(y.id) ? rank.get(y.id) : Infinity;
      return rx !== ry ? rx - ry : String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0;
    });
  }
  // A character owns its data.
  const ids = new Set((Array.isArray(out.characters) ? out.characters : []).filter((c) => c && c.id).map((c) => c.id));
  // Kept although one side had deleted it (the other side edited the character itself later): all of its data
  // comes from the side that still has it, dated with the character's own time so it is not deleted again.
  for (const id of ids) {
    const p = `characters/${id}`;
    if (ua.has(p) === ub.has(p)) continue;
    const [src, srcStamps] = ub.has(p) ? [ub, sb] : [ua, sa];
    const t = Math.max(stampOf(sa, p, now), stampOf(sb, p, now));
    for (const [path, value] of src) {
      if (!ownedBy(path, id)) continue;
      setUnit(out, path, value);
      stamps[path] = Math.max(stamps[path] || 0, t, stampOf(srcStamps, path, now));
    }
  }
  // Left out by the merge (deleted on a device): a newer edit to one of its parts on another device must not
  // bring back that part on its own.
  for (const key of PER_CHAR) if (isObj(out[key])) for (const id of Object.keys(out[key])) if (!ids.has(id)) delete out[key][id];
  if (isObj(out.checklist)) {
    for (const part of ['items', 'flags']) {
      const m = out.checklist[part];
      if (isObj(m)) for (const k of Object.keys(m)) { const bar = k.indexOf('|'); if (bar > 0 && !ids.has(k.slice(0, bar))) delete m[k]; }
    }
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
