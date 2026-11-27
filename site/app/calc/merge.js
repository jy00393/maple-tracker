// Sync merge. Saved state is split into small units (one checklist tick, one character, one character's gear,
// the meso planner…). Every unit carries the time it last changed (state.stamps), and merging two copies keeps
// the newer side of each unit, so a tick on the phone no longer wipes a gear edit made on the PC.
const PER_CHILD = new Set(['incomeHistory']);
// Per-character parts are split by entry, so a boss ticked on the phone and another ticked on the PC are both
// kept (each was one whole unit per character before):
//   bosses/<charId>/picks/<bossId>      one boss on the weekly list
//   bosses/<charId>/clears/<bossId>     one boss's ticks
//   gear/<charId>/slots/<slot>          one equipment slot (also stats/<key> and history/<day>)
//   level/<charId>/log/<time>           one level reading
//   erda/<charId>/levels|steps|costs/<id>, ibp/<charId>/done/<stage>
//   symbols/<charId>/<area>, liberation/<charId>/<weapon>
//   <part>/<charId>/@                   whatever else that character's part holds (gear target, template...)
//
// Two versions can share one gist for a while: a tab or phone that has not reloaded since an update still runs
// the version before. That version knows one unit and one stamp per character and part (<part>/<charId>), and
// the newer stamp wins the whole part. So this version keeps writing that stamp alongside the finer ones:
//   <part>/<charId>            the newest change anywhere in that character's part. Moved by every edit, and by
//                              a merge whose result is neither side's part as it was (so the earlier version
//                              takes the merged part instead of keeping a stale one).
//   <part>/<charId>/@fine      the value this version last gave that stamp. The earlier version moves the part
//                              stamp when it edits, but not this mark and not the finer stamps. That is how its
//                              edits are recognised: a part stamp newer than everything under it means the
//                              whole part was saved by the earlier version at that time (see stampReader).
// A copy with no mark yet (saved by the earlier version) uses the part stamp for every entry that has no stamp
// of its own. Once the mark is there, every entry that is present has its own stamp.
const SPLIT = {
  bosses: { maps: ['picks', 'clears'] },
  gear: { maps: ['slots', 'stats'], lists: { history: 'd' } },
  level: { lists: { log: 't' } },
  erda: { maps: ['levels', 'steps', 'costs'] },
  ibp: { maps: ['done'] },
  symbols: { entries: true },
  liberation: { entries: true }
};
// "@" never comes out of encodeURIComponent, so these cannot collide with an id.
const REST = '@';
const FINE = '@fine';
// Goal order, for the same reason. The earlier version stamps mesos/goalOrder for every change to the list
// (a goal added, removed or moved) and the newer stamp wins. This version does the same, and also notes:
//   mesos/goalMoved       when goals last swapped places (adding or removing a goal is not a reorder)
//   mesos/goalOrderSeen   the value this version last gave mesos/goalOrder (an order stamp newer than this was
//                         set by the earlier version, and may have been a reorder)
const GOAL_ORDER = 'mesos/goalOrder';
const GOAL_MOVED = 'mesos/goalMoved';
const GOAL_SEEN = 'mesos/goalOrderSeen';
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
// "cleared" belongs to one browser's storage (see store.js) and is never part of the entries.
// "asOf" (see liveAsOf) is change-time bookkeeping like the stamps: not an entry, merged on its own.
const SKIP = new Set(['v', 'updatedAt', 'stamps', 'activeId', 'cleared', 'asOf']);
// The same goes for which tab of a page is showing, for the news read marker the Events page sets itself, and
// for Checklist's "Show notes" switch (a phone and a desktop each keep their own).
const LOCAL_UI = new Set(['mesosView', 'progressView', 'eventsView', 'shopId', 'lastSeenNews', 'showNotes']);
const UI_MAPS = new Set(['seasonDone', 'hiddenEvents']);
// Typed figures (symbols held, traces) carry the day they were typed as `at`. Figures saved before that are
// dated by each device on its own first load (store.js), with no change time moved. So two copies can hold the
// same entry with the same change time and a different day, or one with a day and one without. The earlier day
// then stands and a dated entry beats an undated one, on every device alike: without this the undated copy could
// win the tie and be dated afresh at every sync.
const TYPED = new Set(['symbols', 'liberation']);
const typedDay = (v) => (typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : Infinity);
const sameButDay = (x, y) => isObj(x) && isObj(y) && canon({ ...x, at: 0 }) === canon({ ...y, at: 0 });
// Per-character parts: when a character is gone after a merge, so is its data.
const PER_CHAR = ['bosses', 'symbols', 'liberation', 'ibp', 'erda', 'gear', 'level', 'pitch'];
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const DAY = 86400000;
const enc = (s) => encodeURIComponent(String(s));
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
// Keys such as "__proto__" or "constructor" would read or write the shared Object prototype: never used as ids.
const safe = (k) => !(k in Object.prototype);
const keysOf = (o) => Object.keys(o).filter(safe);
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const listId = (v) => (typeof v === 'string' && v !== '') || (typeof v === 'number' && Number.isFinite(v));
// How one field of a character's part is split: 'entry' and 'map'/'list' entries are units of their own,
// everything else travels together as the rest ("@").
function fieldKind(part, k, v) {
  const spec = SPLIT[part];
  if (spec.entries) return isObj(v) ? 'entry' : 'rest';
  if (spec.maps && spec.maps.includes(k) && isObj(v)) return 'map';
  if (spec.lists && own(spec.lists, k) && Array.isArray(v)) return 'list';
  return 'rest';
}

// path -> value for every unit in a state.
export function units(state) {
  const out = new Map();
  if (!isObj(state)) return out;
  for (const key of Object.keys(state)) {
    if (SKIP.has(key) || !safe(key)) continue;
    const val = state[key];
    if (key === 'characters') {
      // One unit per character, so a character added on one device never replaces the other device's list.
      if (Array.isArray(val)) for (const c of val) if (c && c.id) out.set(`characters/${c.id}`, c);
    } else if (own(SPLIT, key)) {
      if (!isObj(val)) continue;
      for (const c of keysOf(val)) {
        const h = val[c];
        if (!isObj(h)) continue;
        const base = `${key}/${enc(c)}`;
        const rest = {};
        for (const k of keysOf(h)) {
          const kind = fieldKind(key, k, h[k]);
          if (kind === 'entry') out.set(`${base}/${enc(k)}`, h[k]);
          else if (kind === 'map') for (const id of keysOf(h[k])) out.set(`${base}/${enc(k)}/${enc(id)}`, h[k][id]);
          else if (kind === 'list') {
            const f = SPLIT[key].lists[k];
            for (const e of h[k]) if (isObj(e) && listId(e[f])) out.set(`${base}/${enc(k)}/${enc(e[f])}`, e);
          } else rest[k] = h[k];
        }
        out.set(`${base}/${REST}`, rest);
      }
    } else if (PER_CHILD.has(key)) {
      if (isObj(val)) for (const child of keysOf(val)) out.set(`${key}/${child}`, val[child]);
    } else if (key === 'ui' || key === 'mesos') {
      if (!isObj(val)) continue;
      for (const k of keysOf(val)) {
        if (key === 'ui' && LOCAL_UI.has(k)) continue;
        if (key === 'ui' && UI_MAPS.has(k) && isObj(val[k])) {
          for (const id of keysOf(val[k])) out.set(`ui/${k}/${enc(id)}`, val[k][id]);
        } else if (key === 'mesos' && k === 'goals' && Array.isArray(val[k])) {
          // One unit per goal, plus their order, so goals added on two devices are both kept.
          const goals = val[k].filter((g) => isObj(g) && typeof g.id === 'string' && g.id);
          for (const g of goals) out.set(`mesos/goals/${enc(g.id)}`, g);
          out.set(GOAL_ORDER, goals.map((g) => g.id));
        } else out.set(`${key}/${k}`, val[k]);
      }
    } else if (key === 'pitch') {
      if (!isObj(val)) continue;
      for (const c of keysOf(val)) {
        const drops = isObj(val[c]) && Array.isArray(val[c].drops) ? val[c].drops : [];
        for (const d of drops) if (isObj(d) && typeof d.id === 'string' && d.id) out.set(`pitch/${enc(c)}/${enc(d.id)}`, d);
      }
    } else if (key === 'shops') {
      if (!isObj(val)) continue;
      for (const id of keysOf(val)) {
        const s = val[id];
        if (!isObj(s)) continue;
        for (const f of ['have', 'claims']) if (s[f]) out.set(`shops/${enc(id)}/${f}`, s[f]);
        if (isObj(s.want)) for (const item of keysOf(s.want)) out.set(`shops/${enc(id)}/want/${enc(item)}`, s.want[item]);
      }
    } else if (key === 'champions') {
      if (!isObj(val)) continue;
      if (Array.isArray(val.slots)) val.slots.forEach((s, i) => { if (usedSlot(s)) out.set(`champions/slot/${i}`, s); });
      if (isObj(val.raid)) for (const m of keysOf(val.raid)) out.set(`champions/raid/${m}`, val.raid[m]);
    } else if (key === 'checklist') {
      if (!isObj(val)) continue;
      for (const part of keysOf(val)) {
        if (CHECKLIST_PARTS.has(part)) {
          if (isObj(val[part])) for (const child of keysOf(val[part])) out.set(`checklist/${part}/${child}`, val[part][child]);
        } else out.set(`checklist/${part}`, val[part]);
      }
    } else out.set(key, val);
  }
  return out;
}

function setUnit(state, path, value) {
  const segs = path.split('/');
  // No part of a path may name something every object inherits ("__proto__", "constructor"...): placing it could
  // read or write the shared Object prototype. Such a path only comes from a hand-made copy; the app's own ids
  // never look like that (calc/sanitise.js drops them when a copy is loaded).
  if (segs.some((s) => !safe(s) || !safe(dec(s)))) return;
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
    if (!isObj(own(state.pitch, charId))) {
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
    if (!isObj(own(state.shops, shopId))) {
      if (value === undefined) return;
      state.shops[shopId] = { have: 0, claims: 0, want: {} };
    }
    const s = state.shops[shopId];
    if (segs[2] === 'want') {
      if (segs.length < 4) return;
      if (!isObj(s.want)) s.want = {};
      const item = dec(segs.slice(3).join('/'));
      if (!safe(item)) return;
      if (value === undefined) delete s.want[item];
      else s.want[item] = value;
    } else if (segs[2] === 'have' || segs[2] === 'claims') s[segs[2]] = value === undefined ? 0 : value;
    return;
  }
  if (own(SPLIT, segs[0])) {
    if (segs.length < 3) return; // the whole-character stamp: nothing to place
    const part = segs[0];
    const spec = SPLIT[part];
    const charId = dec(segs[1]);
    if (!safe(charId)) return;
    if (!isObj(state[part])) state[part] = {};
    let h = own(state[part], charId);
    if (!isObj(h)) {
      if (value === undefined) return;
      h = state[part][charId] = {};
    }
    if (segs.length === 3 && segs[2] === REST) {
      for (const k of Object.keys(h)) if (fieldKind(part, k, h[k]) === 'rest') delete h[k];
      // (A name still present here holds entries of its own: those are never replaced wholesale.)
      if (isObj(value)) for (const k of keysOf(value)) if (!Object.hasOwn(h, k)) h[k] = structuredClone(value[k]);
      return;
    }
    if (segs.length === 3 && segs[2] === FINE) return; // a mark, not an entry
    const k = dec(segs[2]);
    if (!safe(k)) return;
    if (segs.length === 3) {
      if (!spec.entries) return;
      if (value === undefined) delete h[k];
      else h[k] = structuredClone(value);
      return;
    }
    const id = dec(segs.slice(3).join('/'));
    const f = spec.lists && own(spec.lists, k);
    if (f) {
      if (!Array.isArray(h[k])) {
        if (value === undefined) return;
        h[k] = [];
      }
      const i = h[k].findIndex((e) => isObj(e) && String(e[f]) === id);
      if (value === undefined) { if (i >= 0) h[k].splice(i, 1); }
      else if (i >= 0) h[k][i] = structuredClone(value);
      else {
        // Readings and daily points are kept oldest first, as the pages save them.
        h[k].push(structuredClone(value));
        const at = (e) => (isObj(e) ? e[f] : undefined);
        h[k].sort((x, y) => (at(x) < at(y) ? -1 : at(x) > at(y) ? 1 : 0));
      }
      return;
    }
    if (!(spec.maps && spec.maps.includes(k)) || !safe(id)) return;
    if (!isObj(h[k])) {
      if (value === undefined) return;
      h[k] = {};
    }
    if (value === undefined) delete h[k][id];
    else h[k][id] = structuredClone(value);
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
  if (!safe(key)) return;
  if (value === undefined) delete holder[key];
  else holder[key] = structuredClone(value);
}

function diffUnits(a, b) {
  const out = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    if (JSON.stringify(a.get(path)) !== JSON.stringify(b.get(path))) out.push(path);
  }
  return out;
}

// Paths whose value differs between two states (added, changed or removed).
export function changedPaths(prev, next) {
  return diffUnits(units(prev), units(next));
}

// True when goals that are in both lists swapped places. (Adding or removing a goal changes the list, but it is
// not a reorder.)
function goalsMoved(a, b) {
  const x = Array.isArray(a) ? a : [];
  const y = Array.isArray(b) ? b : [];
  return JSON.stringify(x.filter((id) => y.includes(id))) !== JSON.stringify(y.filter((id) => x.includes(id)));
}

// The entries an edit changed. The goal order is derived from the goal list, so adding or removing a goal changes
// its value; it only counts as edited when goals that were there before and after swapped places. (Otherwise a
// goal added on one device would undo a reorder made on another.)
export function editedPaths(prev, next) {
  const a = units(prev);
  const b = units(next);
  const paths = diffUnits(a, b);
  if (!paths.includes(GOAL_ORDER)) return paths;
  return goalsMoved(a.get(GOAL_ORDER), b.get(GOAL_ORDER)) ? paths : paths.filter((p) => p !== GOAL_ORDER);
}

// True when a copy carries change times more than a day ahead of this device's clock: some device's clock is
// wrong. The merge ignores such times, so that device's newest changes do not arrive until the clock is right.
export function futureStamps(state, now = Date.now()) {
  if (!isObj(state)) return false;
  if (Number(state.updatedAt) > now + DAY) return true;
  return isObj(state.stamps) && Object.values(state.stamps).some((t) => Number(t) > now + DAY);
}

// Copies saved before stamps existed get one stamp per unit, dated by the copy's own updatedAt. Each character's
// part also gets the stamp the earlier version reads (see the top of this file).
export function seedStamps(state) {
  if (isObj(state.stamps)) return state.stamps;
  const at = state.updatedAt || 1;
  const stamps = {};
  for (const path of units(state).keys()) {
    stamps[path] = at;
    const p = splitKey(path);
    if (p && !p.char.includes('/')) stamps[`${p.part}/${p.char}`] = at;
  }
  return stamps;
}

// True when a path holds data of character `id` (its gear, bosses, drops, ticks...).
function ownedBy(path, id) {
  const segs = path.split('/');
  if (PER_CHAR.includes(segs[0]) && segs[0] !== 'pitch') return dec(segs[1] || '') === id || segs.slice(1).join('/') === id;
  if (segs[0] === 'pitch') return dec(segs[1] || '') === id;
  if (segs[0] === 'checklist' && (segs[1] === 'items' || segs[1] === 'flags')) return segs.slice(2).join('/').startsWith(`${id}|`);
  return false;
}

// A stamp more than a day in the future (a badly wrong clock, or a doctored copy) is not trusted at all: it
// counts as never changed, so it cannot overwrite or remove anything.
const trusted = (t, now) => { const n = Number(t) || 0; return n > now + DAY ? 0 : n; };

// For a stamp key or unit path inside a per-character part: which part and character it belongs to.
// `prefix` is what every finer path of that part starts with; `aux` is true for the part stamp and the mark.
function splitKey(path) {
  const i = path.indexOf('/');
  if (i < 0) return null;
  const part = path.slice(0, i);
  if (!own(SPLIT, part)) return null;
  const j = path.indexOf('/', i + 1);
  // "<part>/<charId>": the earlier version's stamp, written with the id as it is.
  if (j < 0) { const char = path.slice(i + 1); return { part, char, prefix: `${part}/${enc(char)}`, aux: true }; }
  const seg = path.slice(i + 1, j);
  return { part, char: dec(seg), prefix: `${part}/${seg}`, aux: path.slice(j + 1) === FINE };
}

// Reads the change time of any unit from one copy's stamps: read(path).
//
// Per-character parts (see the top of this file):
// - Part stamp newer than every stamp under it: the earlier version saved the whole part at that time, so every
//   entry of the part, present or removed, counts as changed then.
// - No mark yet: an entry without a stamp of its own uses the part stamp.
// - Otherwise each entry has its own stamp, and one without a stamp was never changed here.
// read.part(prefix) is the newest change anywhere in "<part>/<charId>".
//
// Characters were first stamped as one list ("characters"), so that stamp stands in for a character that has
// none of its own yet; the same goes for the other parts that became finer over time.
export function stampReader(stamps, now = Date.now()) {
  const st = isObj(stamps) ? stamps : {};
  // prefix -> newest trusted stamp under it (the mark included)
  const under = new Map();
  for (const k of Object.keys(st)) {
    const p = splitKey(k);
    if (!p || (p.aux && !k.endsWith(`/${FINE}`))) continue;
    const t = trusted(st[k], now);
    if (t > (under.get(p.prefix) || 0)) under.set(p.prefix, t);
  }
  const whole = (p) => trusted(st[`${p.part}/${p.char}`] ?? st[p.prefix], now);
  const read = (path) => {
    let t = st[path];
    const p = splitKey(path);
    if (p) {
      if (p.aux) return trusted(t, now);
      const c = whole(p);
      if (c > (under.get(p.prefix) || 0)) return c;
      if (t === undefined && !trusted(st[`${p.prefix}/${FINE}`], now)) return c;
      return trusted(t, now);
    }
    if (t === undefined && path.startsWith('characters/')) t = st.characters;
    // Drops, shop picks and Champions were first stamped as larger parts; those stamps stand in the same way.
    if (t === undefined && (path.startsWith('pitch/') || path.startsWith('shops/'))) t = st[path.split('/').slice(0, 2).join('/')];
    if (t === undefined && path.startsWith('champions/')) t = st.champions;
    // Settings and the meso planner were each one part before.
    if (t === undefined && path.startsWith('ui/')) t = st.ui;
    if (t === undefined && path.startsWith('mesos/goals/')) t = st['mesos/goals'];
    if (t === undefined && path.startsWith('mesos/')) t = st.mesos;
    return trusted(t, now);
  };
  read.part = (prefix) => {
    const p = splitKey(`${prefix}/${REST}`);
    return p ? Math.max(whole(p), under.get(prefix) || 0) : 0;
  };
  // When goals last swapped places, as far as this copy knows. An order stamp this version has not accounted
  // for was set by the earlier version, which stamps adds and reorders alike: it counts as a reorder.
  read.goalsMoved = () => {
    const g = read(GOAL_ORDER);
    return g > trusted(st[GOAL_SEEN], now) ? g : trusted(st[GOAL_MOVED], now);
  };
  return read;
}

// One unit's change time (see stampReader).
export function stampOf(stamps, path, now) {
  return stampReader(stamps, now)(path);
}

// Stamps an edit: `stamps` (the edited copy's own change times) gets a new time for every path in `paths`.
// A stamp never goes backwards: on a device whose clock is behind, an edit to something another device changed
// "later" still gets the newer time, so the next sync does not undo it.
// For a character's part this also moves the part stamp the earlier version reads, and first gives every other
// entry of that part its own stamp, so none of them looks as new as this edit.
export function stampEdit(stamps, prev, next, now = Date.now(), paths = null) {
  const pu = units(prev);
  const nu = units(next);
  let list = paths;
  if (!list) {
    list = diffUnits(pu, nu);
    if (list.includes(GOAL_ORDER) && !goalsMoved(pu.get(GOAL_ORDER), nu.get(GOAL_ORDER))) list = list.filter((p) => p !== GOAL_ORDER);
  }
  const edited = new Set(list);
  const before = isObj(prev.stamps) ? prev.stamps : {};
  const read = stampReader(before, now);
  const later = (t) => Math.max(now, t + 1);
  const touched = new Map();
  for (const path of edited) {
    if (path === GOAL_MOVED || path === GOAL_SEEN) continue;
    const p = splitKey(path);
    if (p && p.aux) continue;
    stamps[path] = later(read(path));
    if (p) touched.set(p.prefix, p);
  }
  if (touched.size) {
    for (const k of new Set([...pu.keys(), ...Object.keys(before)])) {
      const p = splitKey(k);
      if (!p || p.aux || edited.has(k) || !touched.has(p.prefix)) continue;
      const t = read(k);
      if (t) stamps[k] = t;
    }
    for (const [prefix, p] of touched) {
      if (p.char.includes('/')) continue; // the earlier version's stamp for such an id cannot be told from a finer one
      const t = later(read.part(prefix));
      stamps[`${p.part}/${p.char}`] = t;
      stamps[`${prefix}/${FINE}`] = t;
    }
  }
  // The goal list: the order stamp moves for every change to it, as the earlier version expects.
  const a = pu.get(GOAL_ORDER);
  const b = nu.get(GOAL_ORDER);
  if (edited.has(GOAL_ORDER) || JSON.stringify(a) !== JSON.stringify(b)) {
    const moved = read.goalsMoved();
    const t = later(read(GOAL_ORDER));
    stamps[GOAL_ORDER] = t;
    stamps[GOAL_SEEN] = t;
    if (edited.has(GOAL_ORDER)) stamps[GOAL_MOVED] = t;
    else if (moved) stamps[GOAL_MOVED] = moved;
  }
  return stamps;
}

// JSON with object keys in a fixed order, so two copies of the same entries always compare equal.
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
// "<part>/<charId>" prefix -> one string for everything that character's part holds.
function partTexts(u) {
  const lists = new Map();
  for (const [path, v] of u) {
    const p = splitKey(path);
    if (!p) continue;
    if (!lists.has(p.prefix)) lists.set(p.prefix, []);
    lists.get(p.prefix).push(`${path}=${canon(v)}`);
  }
  const out = new Map();
  for (const [k, l] of lists) out.set(k, l.sort().join('\n'));
  return out;
}

export function mergeStates(a, b, now = Date.now()) {
  const sa = seedStamps(a);
  const sb = seedStamps(b);
  const ra = stampReader(sa, now);
  const rb = stampReader(sb, now);
  const ua = units(a);
  const ub = units(b);
  const bNewerOverall = (b.updatedAt || 0) > (a.updatedAt || 0);
  const out = structuredClone(a);
  const stamps = {};
  let goalOrder = null;
  let otherOrder = null;
  const emptied = [];
  const prefixes = new Map();
  const paths = new Set([...ua.keys(), ...ub.keys(), ...Object.keys(sa), ...Object.keys(sb)]);
  paths.delete('characters');
  paths.delete('activeId'); // stamped by earlier versions; no longer merged
  paths.delete(GOAL_MOVED);
  paths.delete(GOAL_SEEN);
  for (const path of paths) {
    const p = splitKey(path);
    if (p) {
      prefixes.set(p.prefix, p);
      if (p.aux) continue; // the part stamp and its mark are worked out at the end
    }
    const ta = ra(path);
    const tb = rb(path);
    let takeB;
    // The goal order goes to the side that reordered last; adding or removing a goal comes second.
    if (path === GOAL_ORDER && ra.goalsMoved() !== rb.goalsMoved()) takeB = rb.goalsMoved() > ra.goalsMoved();
    else if (tb !== ta) takeB = tb > ta;
    // Same age: a unit only one side has is kept (a removal needs a strictly newer stamp); otherwise the newer copy wins.
    else if (ua.has(path) !== ub.has(path)) takeB = ub.has(path);
    // The same typed figures, dated differently by two devices: the earlier day stands (see TYPED).
    else if (p && TYPED.has(p.part) && sameButDay(ua.get(path), ub.get(path))) takeB = typedDay(ub.get(path)) < typedDay(ua.get(path));
    // Otherwise the newer copy wins; a full tie is broken by the values themselves, so both devices pick the same.
    else if ((b.updatedAt || 0) !== (a.updatedAt || 0)) takeB = bNewerOverall;
    else takeB = JSON.stringify(ub.get(path)) > JSON.stringify(ua.get(path));
    if (takeB) setUnit(out, path, ub.get(path));
    if (path === GOAL_ORDER) {
      goalOrder = takeB ? ub.get(path) : ua.get(path);
      otherOrder = takeB ? ua.get(path) : ub.get(path);
    }
    if (path.endsWith(`/${REST}`) && !(takeB ? ub : ua).has(path)) emptied.push(path);
    const t = Math.max(ta, tb);
    if (t) stamps[path] = t;
  }
  // Goals are put in the winning order once every goal is in place. Goals it doesn't name (added on the other
  // device) follow in the order that device had them, so a list that was only added to keeps its order and both
  // devices end up with the same list.
  if (isObj(out.mesos) && Array.isArray(out.mesos.goals)) {
    const ranks = (order) => new Map((Array.isArray(order) ? order : []).map((id, n) => [id, n]));
    const first = ranks(goalOrder);
    const second = ranks(otherOrder);
    const at = (rank, g) => (rank.has(g.id) ? rank.get(g.id) : Infinity);
    out.mesos.goals.sort((x, y) => {
      if (at(first, x) !== at(first, y)) return at(first, x) - at(first, y);
      if (at(second, x) !== at(second, y)) return at(second, x) - at(second, y);
      return String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0;
    });
  }
  // A character's part that was removed on the winning side goes, unless the other side added entries to it since.
  for (const path of emptied) {
    const [part, c] = path.split('/');
    if (!own(SPLIT, part) || !isObj(out[part])) continue;
    const charId = dec(c);
    const h = own(out[part], charId);
    if (isObj(h) && units({ [part]: { [charId]: h } }).size <= 1 && Object.keys(h).every((k) => fieldKind(part, k, h[k]) !== 'rest')) delete out[part][charId];
  }
  // A character owns its data.
  const ids = new Set((Array.isArray(out.characters) ? out.characters : []).filter((c) => c && c.id).map((c) => c.id));
  // Kept although one side had deleted it (the other side edited the character itself later): all of its data
  // comes from the side that still has it, dated with the character's own time so it is not deleted again.
  for (const id of ids) {
    const p = `characters/${id}`;
    if (ua.has(p) === ub.has(p)) continue;
    const [src, read] = ub.has(p) ? [ub, rb] : [ua, ra];
    // Only a real removal on the other side lifts the parts (a side that never had the character, such as a new
    // device, keeps each part's own time, which "as of" dates read).
    const t = (ub.has(p) ? ra(p) : rb(p)) ? Math.max(ra(p), rb(p)) : 0;
    for (const [path, value] of src) {
      if (!ownedBy(path, id)) continue;
      setUnit(out, path, value);
      stamps[path] = Math.max(stamps[path] || 0, t, read(path));
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
  const uo = units(out);
  // The stamps the earlier version reads. They keep the newest time either side had, and move one step past it
  // when the result is not what the side holding that time has: a device on the earlier version, which only
  // compares these stamps, then takes the merged result instead of keeping its own.
  if (prefixes.size) {
    const [pa, pb, po] = [partTexts(ua), partTexts(ub), partTexts(uo)];
    const newest = new Map();
    for (const k of Object.keys(stamps)) {
      const p = splitKey(k);
      if (p && stamps[k] > (newest.get(p.prefix) || 0)) newest.set(p.prefix, stamps[k]);
    }
    for (const [prefix, p] of prefixes) {
      const ca = ra.part(prefix);
      const cb = rb.part(prefix);
      let t = Math.max(ca, cb);
      if (t && ids.has(p.char)) {
        const text = po.get(prefix) || '';
        if ((ca === t && (pa.get(prefix) || '') !== text) || (cb === t && (pb.get(prefix) || '') !== text)) t += 1;
      }
      t = Math.max(t, newest.get(prefix) || 0);
      if (!t || p.char.includes('/')) continue;
      stamps[`${p.part}/${p.char}`] = t;
      stamps[`${prefix}/${FINE}`] = t;
    }
  }
  {
    const ga = ra(GOAL_ORDER);
    const gb = rb(GOAL_ORDER);
    let t = Math.max(ga, gb);
    if (t) {
      const text = JSON.stringify(uo.get(GOAL_ORDER) || []);
      const differs = (u) => JSON.stringify(u.get(GOAL_ORDER) || []) !== text;
      if ((ga === t && differs(ua)) || (gb === t && differs(ub))) t += 1;
      stamps[GOAL_ORDER] = t;
      stamps[GOAL_SEEN] = t;
      const moved = Math.max(ra.goalsMoved(), rb.goalsMoved());
      if (moved) stamps[GOAL_MOVED] = moved;
    }
  }
  out.stamps = stamps;
  out.updatedAt = Math.min(Math.max(a.updatedAt || 0, b.updatedAt || 0), now + DAY);
  // Either side's "as of" times, kept where they still describe the merged stamp (see liveAsOf).
  out.asOf = liveAsOf([a.asOf, b.asOf], stamps, now);
  return out;
}

// state.asOf: { [path]: { t, s } }. An import or a restore stamps every part as changed now, so the import wins
// over other devices (store.js replaceState); `t` keeps when the figure at `path` was really last changed, and
// `s` the stamp the import gave it. The entry stands only while the part's stamp is still `s`: any later edit,
// confirmation or winning change from another device moves the stamp, and the entry is then dropped. So there is
// at most one entry per part, and only for parts changed by nothing but an import since.
// `lists`: one or more asOf maps (two when merging); returns the entries that still stand.
export function liveAsOf(lists, stamps, now = Date.now()) {
  const out = {};
  const read = stampReader(stamps, now);
  for (const m of Array.isArray(lists) ? lists : [lists]) {
    if (!isObj(m)) continue;
    for (const path of keysOf(m)) {
      const e = m[path];
      if (!isObj(e) || !(e.t > 0) || !(e.s > 0) || e.t >= e.s || read(path) !== e.s) continue;
      // Two devices that hold the same import agree; a different time for the same stamp: the earlier stands.
      if (!Object.hasOwn(out, path) || e.t < out[path].t) out[path] = { t: e.t, s: e.s };
    }
  }
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
