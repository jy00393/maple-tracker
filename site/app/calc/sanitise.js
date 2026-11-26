// Makes any saved state safe to use: every part has the shape the pages expect, whatever was in storage, in an
// imported backup file or in a synced copy. Valid data passes through unchanged; only values of the wrong kind
// are dropped or reset. Unknown extra fields are kept, so a newer version's data survives an older one.
import { cleanDrops } from './pitched.js';
import { cleanChampions } from './champions.js';

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const obj = (v) => (isObj(v) ? v : {});
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const bool = (v) => v === true;
// A finite number inside [min, max], otherwise the fallback.
const num = (v, fallback = null, min = -Infinity, max = Infinity) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback);
// Keeps only entries whose value is an object, each passed through `fix`.
// Keys such as "__proto__", "constructor" or "toString" would read or change what every object inherits, so
// they are never kept as ids. (The app's own ids never look like that; only a hand-made file can hold one.)
const safeKey = (k) => !(k in Object.prototype);
function mapOf(v, fix = (x) => x) {
  const out = {};
  for (const [k, x] of Object.entries(obj(v))) if (isObj(x) && safeKey(k)) out[k] = fix(x);
  return out;
}
// Removes a numeric field that holds something unusable (so pages fall back to their own default).
function numField(o, key, min, max) {
  if (key in o && num(o[key], null, min, max) === null) delete o[key];
}

function character(c) {
  const out = { ...c, id: c.id, name: str(c.name), cls: str(c.cls), level: num(c.level, null, 1, 300) };
  out.region = c.region === 'eu' ? 'eu' : 'na';
  out.world = c.world === 'interactive' ? 'interactive' : 'heroic';
  out.mainStat = ['STR', 'DEX', 'INT', 'LUK', 'HP', 'XENON'].includes(c.mainStat) ? c.mainStat : 'STR';
  for (const k of ['challenger', 'quanah', 'beyondBurning']) out[k] = bool(c[k]);
  // Combat Power from the Character Info window, when typed in.
  if ('cp' in out) { const cp = num(c.cp, null, 1, 1e15); if (cp === null) delete out.cp; else out.cp = Math.floor(cp); }
  return out;
}

function gearSlot(e) {
  const out = { ...e };
  numField(out, 'tier', 0, 9);
  numField(out, 'stars', 0, 30);
  numField(out, 'pot', 0, 4);
  numField(out, 'bpot', 0, 4);
  numField(out, 'lines', 0, 3);
  numField(out, 'ilvl', 0, 300);
  // These are whole numbers in the game; a typed decimal is rounded down.
  for (const k of ['tier', 'stars', 'pot', 'bpot', 'lines', 'ilvl']) if (k in out) out[k] = Math.floor(out[k]);
  if ('itemId' in out && num(out.itemId, null, 1) === null) { delete out.itemId; delete out.iconVer; }
  if ('iconVer' in out && typeof out.iconVer !== 'string') delete out.iconVer;
  if ('note' in out && typeof out.note !== 'string') delete out.note;
  if ('potLines' in out) {
    // Array.from fills any holes, so every entry is a real object afterwards.
    out.potLines = Array.from(Array.isArray(out.potLines) ? out.potLines : []).slice(0, 3).map((l) => {
      if (!isObj(l) || typeof l.type !== 'string') return { type: '' };
      const line = { ...l };
      if (num(line.value, null) === null) delete line.value;
      if ('text' in line && typeof line.text !== 'string') delete line.text;
      if ('stat' in line && typeof line.stat !== 'string') delete line.stat;
      return line;
    });
  }
  if ('flame' in out) {
    const f = {};
    for (const [k, v] of Object.entries(obj(out.flame))) if (num(v, null, 0, 99999) !== null && v > 0) f[k] = v;
    if (Object.keys(f).length) out.flame = f; else delete out.flame;
  }
  if ('target' in out) {
    const t = {};
    for (const [k, v] of Object.entries(obj(out.target))) if (num(v, null, 0, 30) !== null) t[k] = Math.floor(v);
    out.target = t;
  }
  if ('temporary' in out) out.temporary = bool(out.temporary);
  return out;
}

function gearOf(g) {
  const out = { ...g, preset: str(g.preset, 'mid'), slots: mapOf(g.slots, gearSlot) };
  out.history = Array.from(Array.isArray(g.history) ? g.history : []).filter((h) => isObj(h) && /^\d{4}-\d{2}-\d{2}$/.test(str(h.d)) && num(h.pct, null, 0, 1) !== null);
  if ('stats' in out) {
    const s = {};
    for (const [k, v] of Object.entries(obj(out.stats))) if (num(v, null, 0, 1e9) !== null) s[k] = v;
    out.stats = s;
  }
  return out;
}

function bossesOf(b) {
  const picks = mapOf(b.picks, (p) => ({ ...p, party: num(p.party, 1, 1, 6) }));
  const clears = mapOf(b.clears);
  return { ...b, picks, clears };
}

function liberationOf(l) {
  return mapOf(l, (w) => {
    const out = { ...w, picks: obj(w.picks) };
    numField(out, 'stage', 0, 99);
    numField(out, 'traces', 0, 1e7);
    return out;
  });
}

function symbolsOf(s) {
  return mapOf(s, (a) => {
    const out = { ...a };
    numField(out, 'level', 0, 99);
    numField(out, 'have', 0, 1e6);
    numField(out, 'daily', 0, 1e4);
    numField(out, 'weekly', 0, 1e5);
    return out;
  });
}

function erdaOf(e) {
  const levels = {};
  for (const [k, v] of Object.entries(obj(e.levels))) if (num(v, null, 0, 99) !== null) levels[k] = v;
  const out = { ...e, levels, steps: obj(e.steps) };
  if ('template' in out && typeof out.template !== 'string') delete out.template;
  if ('costs' in out && !isObj(out.costs)) delete out.costs;
  return out;
}

function levelOf(l) {
  const log = Array.from(Array.isArray(l.log) ? l.log : []).filter((r) => isObj(r) && num(r.t, null, 0) !== null && num(r.level, null, 1, 300) !== null)
    .map((r) => ({ ...r, pct: num(r.pct, 0, 0, 100) }));
  return { ...l, log };
}

// Whole numbers of items or coins, keyed by item id.
function counts(v, max) {
  const out = {};
  for (const [k, x] of Object.entries(obj(v))) if (num(x, null, 1, max) !== null) out[k] = Math.floor(x);
  return out;
}

// Saved calculator settings. Anything out of range is dropped, so the page falls back to its own default.
function calcOf(v, fields) {
  if (!isObj(v)) return undefined;
  const out = {};
  for (const [k, kind, a, b] of fields) {
    if (!(k in v)) continue;
    const x = v[k];
    if (kind === 'int') { if (num(x, null, a, b) !== null) out[k] = Math.floor(x); }
    else if (kind === 'num') { if (num(x, null, a, b) !== null) out[k] = x; }
    else if (kind === 'bool') out[k] = x === true;
    else if (kind === 'enum') { if (a.includes(x)) out[k] = x; }
    else if (kind === 'str') { if (typeof x === 'string' && x.length <= 60) out[k] = x; }
    else if (kind === 'weights') { if (isObj(x)) { const w = {}; for (const [wk, wv] of Object.entries(x)) if (num(wv, null, 0, 100) !== null) w[wk] = wv; out[k] = w; } }
    else if (kind === 'intOrNull') { if (x === null) out[k] = null; else if (num(x, null, a, b) !== null) out[k] = Math.floor(x); }
  }
  return out;
}
const SF_CALC = [['level', 'int', 0, 300], ['from', 'int', 0, 30], ['to', 'int', 0, 30], ['discount', 'bool'], ['lessBoom', 'bool'], ['safeguard', 'bool'], ['mvp', 'enum', ['none', 'silver', 'gold', 'diamond']], ['spare', 'num', 0, 1e15]];
const CUBE_CALC = [['from', 'enum', [1, 2, 3]], ['to', 'enum', [2, 3, 4]]];
const FLAME_CALC = [['slot', 'str'], ['level', 'int', 0, 300], ['adv', 'bool'], ['type', 'str'], ['target', 'num', 0, 99999], ['have', 'intOrNull', 0, 1e7], ['weights', 'weights'], ['secondary', 'enum', ['STR', 'DEX', 'INT', 'LUK', null]]];

function shopOf(s) {
  return { ...s, have: num(s.have, 0, 0, 1e9), claims: num(s.claims, 0, 0, 1e4), want: counts(s.want, 1e5) };
}

export function sanitiseState(raw, base) {
  if (!isObj(raw)) return base;
  const out = { ...base, ...raw, v: 1 };

  const seen = new Set();
  out.characters = Array.from(Array.isArray(raw.characters) ? raw.characters : [])
    .filter((c) => isObj(c) && typeof c.id === 'string' && c.id && safeKey(c.id) && !seen.has(c.id) && seen.add(c.id))
    .map(character);
  out.activeId = out.characters.some((c) => c.id === raw.activeId) ? raw.activeId : out.characters[0]?.id ?? null;

  const cl = obj(raw.checklist);
  const resets = {};
  for (const [k, v] of Object.entries(obj(cl.resets))) if (typeof v === 'string') resets[k] = v;
  out.checklist = {
    ...base.checklist, ...cl,
    items: mapOf(cl.items, (r) => ({ ...r, p: str(r.p) })),
    resets,
    flags: obj(cl.flags),
    history: mapOf(cl.history, (h) => ({ ...h, done: num(h.done, 0, 0, 999), total: num(h.total, 0, 0, 999) })),
    owner: typeof cl.owner === 'string' ? cl.owner : null,
    ownerSet: cl.ownerSet === true
  };

  const ui = obj(raw.ui);
  out.ui = { ...base.ui, ...ui, hideClassic: ui.hideClassic !== false, todaySales: bool(ui.todaySales), lastSeenNews: num(ui.lastSeenNews, 0, 0), eventsView: str(ui.eventsView, 'timeline'), hiddenEvents: obj(ui.hiddenEvents), seasonDone: obj(ui.seasonDone) };
  if ('sessionMins' in out.ui && ![30, 60, 90].includes(out.ui.sessionMins)) delete out.ui.sessionMins;
  for (const [k, fields] of [['sfCalc', SF_CALC], ['cubeCalc', CUBE_CALC], ['flameCalc', FLAME_CALC]]) {
    if (!(k in out.ui)) continue;
    const c = calcOf(out.ui[k], fields);
    if (c) out.ui[k] = c; else delete out.ui[k];
  }
  if ('bossMargin' in out.ui && ![1, 1.5, 2, 3].includes(out.ui.bossMargin)) delete out.ui.bossMargin;

  const m = obj(raw.mesos);
  out.mesos = { ...base.mesos, ...m, held: num(m.held, 0, 0, 1e15), ursusRuns: num(m.ursusRuns, 1, 0, 3) };
  for (const k of ['ursus', 'farmPerHour', 'farmHours', 'other']) out.mesos[k] = num(m[k], null, 0, 1e15);
  if ('cubeRates' in out.mesos) {
    // Hand-typed tier-up odds: three chances per cube between 0.1% and 100%, or the entry is dropped.
    const rates = {};
    for (const [k, v] of Object.entries(obj(out.mesos.cubeRates))) if (Array.isArray(v) && v.length === 3 && v.every((p) => num(p, null, 0.001, 1) !== null)) rates[k] = v;
    if (Object.keys(rates).length) out.mesos.cubeRates = rates; else delete out.mesos.cubeRates;
  }
  out.mesos.goals = Array.from(Array.isArray(m.goals) ? m.goals : []).filter(isObj).map((g, i) => ({ ...g, id: str(g.id) || `goal${i}`, name: str(g.name, 'Goal'), cost: num(g.cost, 0, 0, 1e15) }));

  out.bosses = mapOf(raw.bosses, bossesOf);
  out.symbols = mapOf(raw.symbols, symbolsOf);
  out.liberation = mapOf(raw.liberation, liberationOf);
  out.ibp = mapOf(raw.ibp);
  out.erda = mapOf(raw.erda, erdaOf);
  out.gear = mapOf(raw.gear, gearOf);
  out.level = mapOf(raw.level, levelOf);
  out.pitch = mapOf(raw.pitch, (p) => ({ ...p, drops: cleanDrops(p.drops) }));
  out.shops = mapOf(raw.shops, shopOf);
  out.champions = cleanChampions(raw.champions);
  out.incomeHistory = mapOf(raw.incomeHistory, (h) => ({ ...h, earned: num(h.earned, 0, 0), planned: num(h.planned, 0, 0) }));

  out.updatedAt = num(raw.updatedAt, 0, 0);
  if (isObj(raw.stamps)) {
    out.stamps = {};
    for (const [k, v] of Object.entries(raw.stamps)) if (num(v, null, 0) !== null) out.stamps[k] = v;
  } else delete out.stamps;
  return out;
}
