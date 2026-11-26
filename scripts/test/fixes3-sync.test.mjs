// Third round of fixes, sync and saving:
// - a device still on the version before (a tab or phone not reloaded since the update) syncing with an updated one;
// - goal order after a sync;
// - "Clear all data" with a second tab open;
// - hand-made copies that name "__proto__".
// Nothing here talks to GitHub, and no test depends on today's date or on another test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

const mem = installFakeBrowser();
// Real listener lists, so tests can deliver the 'storage' events a browser would.
const handlers = {};
const listenOn = (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); };
globalThis.window.addEventListener = listenOn;
globalThis.document.addEventListener = listenOn;
const KEY = 'maple-tracker:v1';
const BACKUPS = 'maple-tracker:backups';

// The merge of the version before this one (see the note at the top of that file), and the current one.
const before = await import('./lib/merge-before.mjs');
const merge = await import('../../site/app/calc/merge.js');
const { mergeStates, sameEntries, sameStamps, stampEdit, units } = merge;
// `store` is the copy the pages use (tab A); a second copy of the module stands for a second tab.
const last = () => handlers.storage[handlers.storage.length - 1];
const store = await import('../../site/app/store.js');
const toA = last();
const tabB = await import('../../site/app/store.js?tab=fixes3-B');
const toB = last();
const { html, render } = await import('../../site/vendor/htm-preact.mjs');
const { IncomeKeeper } = await import('../../site/app/pages/bosses.js');
const { SettingsPage } = await import('../../site/app/pages/settings.js');

const realNow = Date.now;
after(() => { Date.now = realNow; });

function rng(seed) { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }
const NOW = 1e12;
const WEEK = 'thu:2026-11-26';

// ---------- devices ----------
// A device on the version before: its store stamped every changed unit (one per character and part) with the
// time of the edit, and its sync merged with the merge kept in lib/merge-before.mjs.
const OLD = {
  kind: 'old',
  edit(prev, t, fn) {
    const next = structuredClone(prev);
    fn(next);
    next.stamps = { ...prev.stamps };
    for (const p of before.changedPaths(prev, next)) next.stamps[p] = t;
    next.updatedAt = t;
    return next;
  },
  merge: (dev, gist) => before.mergeStates(dev, gist, NOW)
};
// A device on this version: the same two steps store.update and sync.js take.
const NEW = {
  kind: 'new',
  edit(prev, t, fn) {
    const next = structuredClone(prev);
    fn(next);
    stampEdit(next.stamps, prev, next, t);
    next.updatedAt = Math.max(t, (prev.updatedAt || 0) + 1);
    return next;
  },
  merge: (dev, gist) => mergeStates(dev, gist, NOW)
};
// One round trip with the gist, as sync.js does it: merge, keep the result, write it back.
function syncAll(devs, gist, order) {
  for (const i of order) { devs[i].state = devs[i].v.merge(devs[i].state, gist); gist = structuredClone(devs[i].state); }
  return gist;
}

// A tracker as the version before saved it: one stamp per character and part.
const T0 = 1_000_000;
function savedBefore() {
  const s = {
    v: 1, characters: [{ id: 'main', name: 'Main', level: 264 }], activeId: 'main',
    checklist: { items: {}, resets: {}, flags: {}, history: {}, owner: null, ownerSet: true },
    bosses: { main: { picks: { 'cygnus-normal': { party: 1 }, 'zakum-chaos': { party: 1 }, 'lucid-hard': { party: 1 } }, clears: { 'lucid-hard': { [WEEK]: true } } } },
    symbols: { main: { cernium: { level: 7 }, arcus: { level: 2 } } }, liberation: {}, ibp: {},
    erda: { main: { template: 'hexa', levels: { origin: 3 }, steps: {} } },
    gear: { main: { preset: 'mid', slots: { hat: { tier: 3, stars: 17 }, gloves: { tier: 2, stars: 10 } }, history: [] } },
    level: { main: { log: [{ t: 1000, level: 264, pct: 10 }, { t: 2000, level: 264, pct: 20 }] } },
    pitch: {}, shops: {}, champions: { slots: [], raid: {} },
    mesos: { held: 1e9, goals: [] }, incomeHistory: {}, ui: { hiddenEvents: {}, seasonDone: {} },
    stamps: {}, updatedAt: T0
  };
  for (const p of before.units(s).keys()) s.stamps[p] = T0;
  return s;
}
const pair = (pcV, phoneV) => { const s = savedBefore(); return { devs: [{ v: pcV, state: structuredClone(s) }, { v: phoneV, state: structuredClone(s) }], gist: structuredClone(s) }; };
const ROUNDS = [0, 1, 0, 1, 0];

// ---------- 18: the updated device's own edits survive a device still on the version before ----------
test('18: an edit on the updated device is not undone by a device still on the version before', () => {
  for (const order of [ROUNDS, [1, 0, 1, 0, 1]]) {
    // The PC (updated) sets the hat to 22 stars; a minute later the phone (not updated) unticks Hard Lucid.
    let w = pair(NEW, OLD);
    w.devs[0].state = NEW.edit(w.devs[0].state, T0 + 60000, (s) => { s.gear.main.slots.hat.stars = 22; });
    w.devs[1].state = OLD.edit(w.devs[1].state, T0 + 120000, (s) => { delete s.bosses.main.clears['lucid-hard'][WEEK]; });
    w.gist = syncAll(w.devs, w.gist, order);
    for (const d of w.devs) {
      assert.equal(d.state.gear.main.slots.hat.stars, 22, `the hat edit is kept on the ${d.v.kind} device`);
      assert.equal(d.state.bosses.main.clears['lucid-hard'][WEEK], undefined, 'and so is the untick');
    }
    // The PC sets a symbol level; the phone ticks a checklist item later.
    w = pair(NEW, OLD);
    w.devs[0].state = NEW.edit(w.devs[0].state, T0 + 60000, (s) => { s.symbols.main.cernium.level = 3; });
    w.devs[1].state = OLD.edit(w.devs[1].state, T0 + 120000, (s) => { s.checklist.items['main|d-ursus'] = { p: 'daily:2026-11-26', d: 1 }; });
    w.gist = syncAll(w.devs, w.gist, order);
    for (const d of w.devs) {
      assert.equal(d.state.symbols.main.cernium.level, 3);
      assert.ok(d.state.checklist.items['main|d-ursus']);
    }
  }
});

test('18: every edit moves the stamp the version before reads, and no other entry looks newer for it', () => {
  const s = savedBefore();
  const edited = NEW.edit(s, T0 + 60000, (x) => { x.gear.main.slots.hat.stars = 22; });
  assert.equal(edited.stamps['gear/main'], T0 + 60000, 'the whole-part stamp moved');
  assert.equal(edited.stamps['gear/main/slots/hat'], T0 + 60000);
  assert.equal(edited.stamps['gear/main/slots/gloves'], T0, 'the other slot keeps its own, older time');
  assert.equal(edited.stamps['bosses/main'], T0, 'parts that were not edited are left alone');
  // So a slot the other (updated) device changed in between is not overwritten by this device's older copy of it.
  const other = NEW.edit(s, T0 + 30000, (x) => { x.gear.main.slots.gloves.stars = 15; });
  for (const m of [mergeStates(edited, other, NOW), mergeStates(other, edited, NOW)]) {
    assert.equal(m.gear.main.slots.hat.stars, 22);
    assert.equal(m.gear.main.slots.gloves.stars, 15);
    // The result is neither side's gear as it was, so the stamp moves past both: a device on the version
    // before, holding either side, takes the merged gear.
    assert.ok(m.stamps['gear/main'] > T0 + 60000);
    for (const stale of [edited, other]) assert.equal(before.mergeStates(stale, m, NOW).gear.main.slots.gloves.stars, 15);
  }
  // A slow clock still moves it forward.
  const slow = NEW.edit(edited, T0, (x) => { x.gear.main.slots.gloves.stars = 11; });
  assert.ok(slow.stamps['gear/main'] > edited.stamps['gear/main']);
});

// ---------- 19: edits and removals made on the version before reach the updated device ----------
test('19: removals and edits made on a device still on the version before are kept on both devices', () => {
  for (const first of [[1, 0, 1], [0, 1, 0]]) {
    for (const order of [ROUNDS, [1, 0, 1, 0, 1]]) {
      // Both sync once first: the updated PC rewrites the gist with finer stamps, and the phone stores them.
      let w = pair(NEW, OLD);
      w.gist = syncAll(w.devs, w.gist, first);
      w.devs[1].state = OLD.edit(w.devs[1].state, T0 + 60000, (s) => {
        delete s.bosses.main.picks['cygnus-normal'];
        delete s.gear.main.slots.gloves;
        s.level.main.log = s.level.main.log.filter((r) => r.t !== 1000);
      });
      w.gist = syncAll(w.devs, w.gist, order);
      for (const d of w.devs) {
        assert.deepEqual(Object.keys(d.state.bosses.main.picks).sort(), ['lucid-hard', 'zakum-chaos'], `${d.v.kind}: the boss stays removed`);
        assert.deepEqual(Object.keys(d.state.gear.main.slots), ['hat'], `${d.v.kind}: the slot stays removed`);
        assert.deepEqual(d.state.level.main.log.map((r) => r.t), [2000], `${d.v.kind}: the reading stays removed`);
      }
      // The phone lowers the hat; then the PC changes the meso total.
      w = pair(NEW, OLD);
      w.gist = syncAll(w.devs, w.gist, first);
      w.devs[1].state = OLD.edit(w.devs[1].state, T0 + 60000, (s) => { s.gear.main.slots.hat.stars = 12; });
      w.devs[0].state = NEW.edit(w.devs[0].state, T0 + 120000, (s) => { s.mesos.held = 7e9; });
      w.gist = syncAll(w.devs, w.gist, order);
      for (const d of w.devs) {
        assert.equal(d.state.gear.main.slots.hat.stars, 12, `${d.v.kind}: the phone's hat edit is kept`);
        assert.equal(d.state.mesos.held, 7e9);
      }
    }
  }
});

test('19: an edit on the version before and a later edit to another entry on the updated device are both kept', () => {
  // (Between two devices on the version before, the later edit replaced the whole part.)
  const w = pair(NEW, OLD);
  w.devs[1].state = OLD.edit(w.devs[1].state, T0 + 60000, (s) => { s.gear.main.slots.gloves.stars = 14; });
  w.devs[0].state = NEW.edit(w.devs[0].state, T0 + 120000, (s) => { s.gear.main.slots.hat.stars = 22; });
  w.gist = syncAll(w.devs, w.gist, [1, 0, 1, 0]);
  for (const d of w.devs) assert.deepEqual([d.state.gear.main.slots.hat.stars, d.state.gear.main.slots.gloves.stars], [22, 14]);
});

// ---------- 18, 19: random runs with a mix of versions ----------
const BOSS = ['lotus-hard', 'damien-hard', 'will-hard', 'lucid-hard'];
const SLOT = ['hat', 'top', 'ring1', 'belt'];
const AREA = ['cernium', 'arcus', 'odium'];
let uid = 0;
const part = (s, key, make) => (s[key].main = s[key].main || make());
const bossesOf = (s) => { const b = part(s, 'bosses', () => ({})); b.picks = b.picks || {}; b.clears = b.clears || {}; return b; };
const gearOf = (s) => { const g = part(s, 'gear', () => ({})); g.slots = g.slots || {}; return g; };
const levelOf = (s) => { const l = part(s, 'level', () => ({})); l.log = l.log || []; return l; };
// Each returns [what it set, the value, the character's part it belongs to (null: not a per-character part)].
const EDITS = [
  (s, n) => { const b = bossesOf(s); const id = BOSS[n % 4]; b.clears[id] = { ...(b.clears[id] || {}), [WEEK]: true }; return [`clear:${id}`, true, 'bosses']; },
  (s, n) => { const b = bossesOf(s); const id = BOSS[n % 4]; if (b.clears[id]) delete b.clears[id][WEEK]; return [`clear:${id}`, undefined, 'bosses']; },
  (s, n) => { const id = BOSS[n % 4]; bossesOf(s).picks[id] = { party: 1 + (n % 6) }; return [`pick:${id}`, 1 + (n % 6), 'bosses']; },
  (s, n) => { const id = BOSS[n % 4]; delete bossesOf(s).picks[id]; return [`pick:${id}`, undefined, 'bosses']; },
  (s, n) => { const id = SLOT[n % 4]; gearOf(s).slots[id] = { tier: n % 5, stars: n % 23 }; return [`slot:${id}`, `${n % 5}/${n % 23}`, 'gear']; },
  (s, n) => { const id = SLOT[n % 4]; delete gearOf(s).slots[id]; return [`slot:${id}`, undefined, 'gear']; },
  (s, n) => { gearOf(s).preset = ['low', 'mid', 'high'][n % 3]; return ['preset', s.gear.main.preset, 'gear']; },
  (s, n) => { const id = AREA[n % 3]; part(s, 'symbols', () => ({}))[id] = { level: n % 20 }; return [`sym:${id}`, n % 20, 'symbols']; },
  (s, n) => { const t = 5000 + ++uid; levelOf(s).log.push({ t, level: 264, pct: n % 100 }); return [`log:${t}`, true, 'level']; },
  (s, n) => { const l = levelOf(s); if (!l.log.length) return ['none']; const t = l.log[n % l.log.length].t; l.log = l.log.filter((r) => r.t !== t); return [`log:${t}`, undefined, 'level']; },
  (s, n) => { const e = part(s, 'erda', () => ({})); e.levels = { ...(e.levels || {}), [`n${n % 3}`]: n % 30 }; return [`erda:n${n % 3}`, n % 30, 'erda']; },
  (s, n) => { s.mesos.held = n; return ['held', n, null]; },
  (s, n) => { const k = `main|d-${n % 5}`; s.checklist.items[k] = { p: 'x', d: n }; return [`tick:${k}`, n, null]; },
  (s, n) => { const id = `g${++uid}`; s.mesos.goals.push({ id, name: id, cost: n }); return [`goal:${id}`, true, null]; },
  (s, n) => { const g = s.mesos.goals; if (g.length > 1) { const i = n % (g.length - 1); [g[i], g[i + 1]] = [g[i + 1], g[i]]; } return ['none']; },
  (s, n) => { const g = s.mesos.goals; if (!g.length) return ['none']; const [gone] = g.splice(n % g.length, 1); return [`goal:${gone.id}`, undefined, null]; },
  // A second character comes, changes and goes (as the Characters page does it); only checked for agreement.
  (s, n) => { if (!s.characters.some((c) => c.id === 'alt')) { s.characters.push({ id: 'alt', name: 'Alt', level: 200 }); s.gear.alt = { preset: 'mid', slots: { hat: { tier: 1, stars: n % 23 } }, history: [] }; } return ['none']; },
  (s, n) => { if (s.characters.some((c) => c.id === 'alt')) { (s.gear.alt = s.gear.alt || { slots: {} }).slots[SLOT[n % 4]] = { tier: 2, stars: n % 23 }; (s.bosses.alt = s.bosses.alt || { picks: {}, clears: {} }).picks[BOSS[n % 4]] = { party: 1 }; } return ['none']; },
  (s, n) => { if (n % 3 === 0) { s.characters = s.characters.filter((c) => c.id !== 'alt'); for (const k of ['bosses', 'symbols', 'liberation', 'ibp', 'erda', 'gear', 'level', 'pitch']) delete s[k].alt; } return ['none']; },
  (s, n) => { s.characters[0].name = `Main ${n}`; return ['name', s.characters[0].name, null]; }
];
function read(s, key) {
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const b = s.bosses.main || {};
  const g = s.gear.main || {};
  if (key === 'preset') return g.preset;
  if (key === 'held') return s.mesos.held;
  if (key === 'name') return s.characters[0].name;
  if (kind === 'clear') return (b.clears && b.clears[id] && b.clears[id][WEEK]) || undefined;
  if (kind === 'pick') return b.picks && b.picks[id] ? b.picks[id].party : undefined;
  if (kind === 'slot') return g.slots && g.slots[id] ? `${g.slots[id].tier}/${g.slots[id].stars}` : undefined;
  if (kind === 'sym') return s.symbols.main && s.symbols.main[id] ? s.symbols.main[id].level : undefined;
  if (kind === 'log') return (s.level.main && (s.level.main.log || []).some((r) => String(r.t) === id)) || undefined;
  if (kind === 'erda') return s.erda.main && s.erda.main.levels ? s.erda.main.levels[id] : undefined;
  if (kind === 'tick') return s.checklist.items[id] && s.checklist.items[id].d;
  if (kind === 'goal') return s.mesos.goals.some((x) => x.id === id) || undefined;
  return undefined;
}

// Devices of the given versions make random edits and sync in random order, several rounds over. Afterwards:
// - every device holds the same entries, goals in the same order, and further syncs change nothing;
// - the newest edit to every entry is there. One exception, which is how the version before works and cannot be
//   changed from here: it treats a character's part (all gear, all boss picks...) as one unit, so when two
//   DIFFERENT devices edit the SAME part of the SAME character before syncing and one of them is on the version
//   before, the later of the two edits takes the whole part. Between updated devices nothing is excepted.
// Edits are at least a second apart, as a person's are (two edits in the same millisecond are not modelled).
function mixedRuns(versions, runs, seedBase) {
  const failures = [];
  for (let seed = 1; seed <= runs && failures.length < 10; seed++) {
    const r = rng(seed * 7919 + seedBase);
    let gist = savedBefore();
    const devs = versions.map((v) => ({ v, state: structuredClone(gist) }));
    const log = []; // every edit: { t, dev, key, value, part }
    let t = T0;
    for (let step = 0; step < 24; step++) {
      const i = Math.floor(r() * devs.length);
      if (r() < 0.6) {
        t += 1000 + Math.floor(r() * 5000);
        const fn = EDITS[Math.floor(r() * EDITS.length)];
        const n = Math.floor(r() * 1000);
        let change;
        const was = devs[i].state;
        devs[i].state = devs[i].v.edit(was, t, (s) => { change = fn(s, n); });
        if (change[0] !== 'none' && !sameEntries(was, devs[i].state)) log.push({ t, dev: i, key: change[0], value: change[1], part: change[2] });
      } else gist = syncAll(devs, gist, [i]);
    }
    const all = devs.map((_, i) => i);
    for (let round = 0; round < 4; round++) gist = syncAll(devs, gist, all);
    const tag = `seed ${seed} [${versions.map((v) => v.kind).join(', ')}]`;
    for (let i = 1; i < devs.length; i++) if (!sameEntries(devs[0].state, devs[i].state)) failures.push(`${tag}: device ${i} differs from device 0`);
    const order = (s) => s.mesos.goals.map((g) => g.id).join(',');
    for (let i = 1; i < devs.length; i++) if (order(devs[0].state) !== order(devs[i].state)) failures.push(`${tag}: goal order differs on device ${i}`);
    // Settled: one more round leaves every device and the gist as they are (change times included).
    const settled = JSON.stringify(gist);
    const held = devs.map((d) => JSON.stringify(d.state));
    gist = syncAll(devs, gist, all);
    if (!sameEntries(JSON.parse(settled), gist) || !sameStamps(JSON.parse(settled), gist)) failures.push(`${tag}: another round of syncs still rewrites the gist`);
    devs.forEach((d, i) => { if (!sameEntries(JSON.parse(held[i]), d.state)) failures.push(`${tag}: another round still changes device ${i}`); });
    const newest = new Map();
    for (const e of log) newest.set(e.key, e);
    for (const e of newest.values()) {
      const got = read(devs[0].state, e.key);
      if (got === e.value) continue;
      const excused = e.part && log.some((x) => x.t > e.t && x.part === e.part && x.dev !== e.dev && (versions[x.dev].kind === 'old' || versions[e.dev].kind === 'old'));
      if (!excused) failures.push(`${tag}: ${e.key} is ${got}, the newest edit (device ${e.dev}, ${versions[e.dev].kind}) set ${e.value}`);
    }
    const ids = devs[0].state.mesos.goals.map((g) => g.id);
    if (new Set(ids).size !== ids.length) failures.push(`${tag}: a goal is listed twice`);
    const readings = ((devs[0].state.level.main || {}).log || []).map((x) => x.t);
    if (readings.some((x, i) => i && x < readings[i - 1])) failures.push(`${tag}: level readings out of order`);
  }
  return failures;
}

test('18, 19: devices on this version and the one before converge and lose nothing over many rounds (random runs)', () => {
  const runs = Math.max(60, Math.round((Number(process.env.SYNC_RUNS) || 600) / 6));
  const mixes = [[NEW, OLD], [OLD, NEW], [NEW, NEW, OLD], [NEW, OLD, OLD], [NEW, NEW], [NEW, NEW, NEW]];
  mixes.forEach((versions, i) => assert.deepEqual(mixedRuns(versions, runs, i * 101), []));
});

// ---------- 23: goal order ----------
const goalNames = (s) => s.mesos.goals.map((g) => g.name);
test('23: goals added on one device keep their order after a sync, on every device', () => {
  const base = NEW.edit({ ...savedBefore(), stamps: {} }, T0, (s) => { s.mesos.held = 1; });
  // Ids as the app makes them: random, so sorting by id would shuffle the list.
  let pc = base;
  [['zz9', 'First'], ['mm5', 'Second'], ['aa1', 'Third']].forEach(([id, name], i) => { pc = NEW.edit(pc, T0 + 1000 * (i + 1), (s) => { s.mesos.goals.push({ id, name, cost: 1 }); }); });
  assert.deepEqual(goalNames(pc), ['First', 'Second', 'Third']);
  // The phone made any later edit, so its copy is the newer one overall.
  for (const V of [NEW, OLD]) {
    const phone = V.edit(base, T0 + 9000, (s) => { s.checklist.items['main|d-ursus'] = { p: 'daily:2026-11-26', d: 1 }; });
    for (const m of [mergeStates(pc, phone, NOW), mergeStates(phone, pc, NOW)]) assert.deepEqual(goalNames(m), ['First', 'Second', 'Third']);
    // Through the gist, several rounds, both orders: the same list on both devices.
    for (const order of [ROUNDS, [1, 0, 1, 0, 1]]) {
      const devs = [{ v: NEW, state: pc }, { v: V, state: phone }];
      syncAll(devs, structuredClone(base), order);
      for (const d of devs) assert.deepEqual(goalNames(d.state), ['First', 'Second', 'Third'], `phone on the ${V.kind} version, ${d.v.kind} device`);
    }
  }
  // Goals added on both devices: one device's follow the other's, each group in its own order, the same everywhere.
  const phone = [['kk3', 'Fourth'], ['bb2', 'Fifth']].reduce((s, [id, name], i) => NEW.edit(s, T0 + 20000 + i * 1000, (x) => { x.mesos.goals.push({ id, name, cost: 1 }); }), base);
  const both = [mergeStates(pc, phone, NOW), mergeStates(phone, pc, NOW)].map(goalNames);
  assert.deepEqual(both[0], both[1]);
  assert.deepEqual(both[0], ['Fourth', 'Fifth', 'First', 'Second', 'Third']);
});

test('23: the order stamp alone (copies whose adds left it untouched) still keeps the adding device\'s order', () => {
  // Stamped the way the build under test before this fix did: an added goal did not move mesos/goalOrder.
  const plain = (prev, t, fn) => {
    const next = structuredClone(prev);
    fn(next);
    next.stamps = { ...prev.stamps };
    for (const p of merge.editedPaths(prev, next)) next.stamps[p] = t;
    next.updatedAt = t;
    return next;
  };
  const base = plain({ ...savedBefore(), stamps: {} }, T0, (s) => { s.mesos.held = 1; });
  let pc = base;
  [['zz9', 'First'], ['mm5', 'Second'], ['aa1', 'Third']].forEach(([id, name], i) => { pc = plain(pc, T0 + 1000 * (i + 1), (s) => { s.mesos.goals.push({ id, name, cost: 1 }); }); });
  const phone = plain(base, T0 + 9000, (s) => { s.mesos.held = 5; });
  for (const m of [mergeStates(pc, phone, NOW), mergeStates(phone, pc, NOW)]) assert.deepEqual(goalNames(m), ['First', 'Second', 'Third']);
});

test('23, 37: a reorder is not undone by a goal added later on another device, whichever version that device runs', () => {
  const start = NEW.edit({ ...savedBefore(), stamps: {} }, T0, (s) => { s.mesos.goals = [{ id: 'arcane', name: 'Arcane' }, { id: 'eternal', name: 'Eternal' }, { id: 'ring', name: 'Ring' }]; });
  const pc = NEW.edit(start, T0 + 1000, (s) => { const g = s.mesos.goals; [g[0], g[2]] = [g[2], g[0]]; });
  const phone = NEW.edit(start, T0 + 5000, (s) => { s.mesos.goals.push({ id: 'new', name: 'New' }); });
  for (const m of [mergeStates(pc, phone, NOW), mergeStates(phone, pc, NOW)]) assert.deepEqual(goalNames(m), ['Ring', 'Eternal', 'Arcane', 'New']);
  // A device on the version before stamps the order when it adds a goal; it has synced with the updated PC
  // before, so the PC can tell its stamp apart and the reorder stands. The phone then takes the merged list.
  const devs = [{ v: NEW, state: start }, { v: OLD, state: start }];
  let gist = syncAll(devs, structuredClone(start), [0, 1]);
  devs[0].state = NEW.edit(devs[0].state, T0 + 1000, (s) => { const g = s.mesos.goals; [g[0], g[2]] = [g[2], g[0]]; });
  devs[1].state = OLD.edit(devs[1].state, T0 + 5000, (s) => { s.mesos.goals.push({ id: 'new', name: 'New' }); });
  // (A reorder made on the version before is a change to the same stamp, so there the later change wins.)
  gist = syncAll(devs, gist, [0, 1, 0, 1]);
  assert.deepEqual(goalNames(devs[0].state), goalNames(devs[1].state));
  assert.equal(devs[0].state.mesos.goals.length, 4);
  // A later real reorder still wins over an earlier one.
  const later = NEW.edit(start, T0 + 9000, (s) => { const g = s.mesos.goals; [g[0], g[1]] = [g[1], g[0]]; });
  for (const m of [mergeStates(pc, later, NOW), mergeStates(later, pc, NOW)]) assert.deepEqual(goalNames(m), ['Eternal', 'Arcane', 'Ring']);
});

// ---------- 4: "__proto__" in a hand-made copy ----------
test('4: a synced or stored copy naming "__proto__" under drops, shops or anywhere else cannot change Object.prototype', (t) => {
  const local = () => ({ v: 1, characters: [{ id: 'main', name: 'Main' }], pitch: {}, shops: {}, stamps: {}, updatedAt: 5 });
  const copies = [
    '{"v":1,"characters":[{"id":"main","name":"Main"}],"pitch":{"__proto__":{"drops":[{"id":"d1","item":"x","d":"2026-11-01"}]}},"shops":{"__proto__":{"have":5,"claims":1,"want":{"a":2}}},"stamps":{},"updatedAt":9}',
    '{"v":1,"characters":[{"id":"main","name":"Main"}],"pitch":{},"shops":{},"stamps":{"pitch/__proto__/x":10,"shops/__proto__/have":10,"shops/__proto__/want/a":10},"updatedAt":9}',
    '{"v":1,"characters":[{"id":"main","name":"Main"}],"pitch":{},"shops":{"s1":{"have":1,"claims":0,"want":{"__proto__":3}}},"stamps":{"shops/s1/want/__proto__":10,"shops/constructor/claims":10,"pitch/constructor/x":10},"updatedAt":9}',
    '{"v":1,"characters":[{"id":"__proto__","name":"P"},{"id":"main","name":"Main"}],"ui":{"__proto__":{"x":1},"hiddenEvents":{"__proto__":true}},"mesos":{"__proto__":{"held":3}},"incomeHistory":{"__proto__":{"earned":1,"planned":1}},"checklist":{"items":{"__proto__":{"p":"x","d":1}},"__proto__":{"y":1}},"champions":{"raid":{"__proto__":{"z":1}}},"__proto__":{"w":1},"stamps":{"ui/__proto__":10,"__proto__/x":10,"characters/__proto__":10,"incomeHistory/__proto__":10,"checklist/items/__proto__":10},"updatedAt":9}'
  ];
  const NAMES = ['drops', 'have', 'claims', 'want', 'a', 'x', 'y', 'z', 'w', 'held', 'earned', 'p'];
  const leaked = () => NAMES.filter((k) => k in {});
  // (If this ever fails, whatever leaked is taken out again, so no other test is affected.)
  t.after(() => { for (const k of NAMES) delete Object.prototype[k]; });
  for (const text of copies) {
    for (const m of [mergeStates(local(), JSON.parse(text), NOW), mergeStates(JSON.parse(text), local(), NOW)]) {
      assert.deepEqual(leaked(), [], text.slice(0, 80));
      assert.deepEqual(Object.keys(Object.prototype), []);
      for (const k of ['pitch', 'shops', 'ui', 'mesos', 'checklist', 'incomeHistory']) if (m[k] && typeof m[k] === 'object') assert.equal(Object.getPrototypeOf(m[k]), Object.prototype, `${k} keeps a plain prototype`);
      assert.equal(Object.getPrototypeOf(m), Object.prototype);
    }
    // The same copy arriving from another tab's save.
    store.resetState();
    store.replaceState(local());
    store.flush();
    toA({ key: KEY, newValue: text });
    assert.deepEqual(leaked(), []);
    assert.deepEqual(Object.keys(Object.prototype), []);
  }
  // Honest ids still work.
  const ok = mergeStates(local(), JSON.parse('{"v":1,"characters":[{"id":"main","name":"Main"}],"pitch":{"main":{"drops":[{"id":"d1","item":"x","d":"2026-11-01"}]}},"shops":{"s1":{"have":5,"claims":1,"want":{"a":2}}},"stamps":{},"updatedAt":9}'), NOW);
  assert.equal(ok.pitch.main.drops.length, 1);
  assert.deepEqual(ok.shops.s1, { have: 5, claims: 1, want: { a: 2 } });
});

// ---------- 3, 16, 5: "Clear all data" with a second tab open ----------
const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const DATA = { bosses: load('bosses'), symbols: load('symbols'), liberation: load('liberation'), ibp: load('ibp'), checklist: load('checklist'), gear: load('gear'), erda: load('erda'), upgrades: load('upgrades'), potential: load('potential'), gearStats: load('gearstats'), tables: load('tables'), season: load('season'), bossCp: load('bosscp'), classes: load('classes'), events: { events: [], sunny: [] }, news: { items: [] }, nexonCharacters: { characters: [] }, meta: null };
DATA.bossById = Object.fromEntries(DATA.bosses.bosses.map((b) => [b.id, b]));
const stored = () => JSON.parse(mem.get(KEY));
const TRACKER = () => ({ v: 1, characters: [{ id: 'main', name: 'Main', level: 264, world: 'heroic', region: 'na' }], activeId: 'main', bosses: { main: { picks: { 'lucid-hard': { party: 1 }, 'lotus-hard': { party: 1 } }, clears: {} } }, mesos: { held: 3200000000, goals: [] }, updatedAt: 5 });
// Both tabs start from the same saved tracker, with nothing pending.
function bothTabs(state = TRACKER()) {
  Date.now = realNow;
  mem.delete(BACKUPS);
  store.resetState();
  store.replaceState(state);
  store.flush();
  toB({ key: KEY, newValue: mem.get(KEY) });
  tabB.flush();
  toA({ key: KEY, newValue: mem.get(KEY) });
  store.flush();
  assert.equal(tabB.getState().characters.length, state.characters.length);
}
const mounted = [];
after(() => { for (const el of mounted) render(null, el); });

test('3, 16: "Clear all data" with a second tab open stays cleared, with the app-wide income recorder running', async () => {
  bothTabs();
  // Tab A draws what main.js always draws: the income recorder, and here the Settings page.
  const el = new FakeNode('div');
  mounted.push(el);
  const App = () => { const state = store.useStore(); return html`<${IncomeKeeper} data=${DATA} state=${state} /><${SettingsPage} data=${DATA} state=${state} />`; };
  render(html`<${App} />`, el);
  await tick(320);
  toB({ key: KEY, newValue: mem.get(KEY) });
  assert.ok(Object.keys(store.getState().incomeHistory).length > 0, 'the recorder has saved this week');
  const button = (re) => el.find((n) => n.localName === 'button' && re.test(n.text.trim()));
  button(/^Clear all data/).fire('click');
  await tick(5);
  button(/^Yes, clear everything/).fire('click');
  assert.deepEqual(stored().characters, [], 'the empty copy is written at once');
  // Redraw, effects (the recorder may save an empty week), and the save delay.
  await tick(400);
  toB({ key: KEY, newValue: mem.get(KEY) });
  await tick(400);
  toA({ key: KEY, newValue: mem.get(KEY) });
  await tick(400);
  assert.equal(store.getState().characters.length, 0, 'tab A stays cleared');
  assert.equal(tabB.getState().characters.length, 0, 'tab B is cleared too');
  assert.deepEqual(stored().characters, []);
  assert.equal(stored().mesos.held, 0);
  assert.match(el.text, /Everything was cleared/);
  render(null, el);
});

test('3: a change made right after clearing does not bring the cleared entries back in another tab', () => {
  for (const hearsFirst of [true, false]) {
    bothTabs();
    store.resetState();
    const cleared = mem.get(KEY);
    // Anything at all is changed in the cleared tab before the other tab has caught up.
    store.update((s) => { s.incomeHistory['2026-11-26'] = { earned: 0, planned: 0 }; });
    store.flush();
    if (hearsFirst) toB({ key: KEY, newValue: cleared });
    // Tab B had a change of its own waiting, and saves.
    tabB.update((s) => { s.ui.todaySales = true; });
    tabB.flush();
    toB({ key: KEY, newValue: mem.get(KEY) });
    toA({ key: KEY, newValue: mem.get(KEY) });
    store.flush();
    tabB.flush();
    for (const s of [store.getState(), tabB.getState(), stored()]) {
      assert.deepEqual(s.characters, []);
      assert.equal(s.mesos.held, 0);
      assert.ok(s.incomeHistory['2026-11-26'], 'what was entered after the clearing is kept');
    }
  }
});

test('5: a save from before the clearing that arrives late is ignored, and the next edit is kept', () => {
  bothTabs();
  // Tab B has a change waiting; tab A is cleared; B's save lands first, then both hear of each other late.
  tabB.update((s) => { s.mesos.held = 5; });
  const fromB = JSON.stringify({ ...tabB.getState(), cleared: 0 });
  store.resetState();
  const fromA = mem.get(KEY);
  toA({ key: KEY, newValue: fromB }); // the out-of-date full copy
  assert.equal(store.getState().characters.length, 0, 'the cleared tab does not show the old entries again');
  toB({ key: KEY, newValue: fromA });
  assert.equal(tabB.getState().characters.length, 0);
  tabB.flush();
  store.flush();
  assert.deepEqual(stored().characters, []);
  // The cleared tab's next edit is saved and reaches the other tab.
  store.update((s) => { s.characters.push({ id: 'new', name: 'New', level: 200 }); });
  store.flush();
  toB({ key: KEY, newValue: mem.get(KEY) });
  assert.deepEqual(stored().characters.map((c) => c.id), ['new']);
  assert.deepEqual(tabB.getState().characters.map((c) => c.id), ['new']);
  assert.deepEqual(store.getState().characters.map((c) => c.id), ['new']);
  // The same when the other tab's write really did land in storage just before the clearing was written.
  bothTabs();
  tabB.update((s) => { s.mesos.held = 6; });
  tabB.flush();
  const late = mem.get(KEY);
  store.resetState();
  toA({ key: KEY, newValue: late });
  toB({ key: KEY, newValue: mem.get(KEY) });
  store.flush();
  tabB.flush();
  for (const s of [store.getState(), tabB.getState(), stored()]) assert.deepEqual(s.characters, []);
});

test('3: the time of the clearing stays in this browser: not in the entries, a safety copy or what is synced', () => {
  bothTabs();
  store.snapshotNow('before clearing');
  store.resetState();
  assert.ok(stored().cleared > 0, 'saved next to the entries');
  assert.ok(!('cleared' in store.getState()), 'but not one of them (exports and the synced copy are made from these)');
  assert.ok(!('cleared' in tabB.getState()));
  for (const b of store.listBackups()) assert.ok(!('cleared' in b.state));
  assert.ok(!units({ ...store.getState(), cleared: 5 }).has('cleared'), 'and never merged from a synced copy');
  // Restoring the copy from before brings the entries back in both tabs: a restore is not a clearing.
  const at = store.listBackups().find((b) => b.label === 'before clearing').at;
  assert.ok(store.restoreBackup(at));
  store.flush();
  toB({ key: KEY, newValue: mem.get(KEY) });
  assert.deepEqual(tabB.getState().characters.map((c) => c.id), ['main']);
  assert.equal(stored().mesos.held, 3200000000);
  // A second clearing, in the other tab this time, is newer than the first.
  tabB.resetState();
  toA({ key: KEY, newValue: mem.get(KEY) });
  assert.equal(store.getState().characters.length, 0);
});

test('3: a copy saved by the version before (no clearing time) is still merged, and its own clearing is still taken', () => {
  bothTabs();
  // A tab on the version before saves its whole copy, with one more tick.
  const theirs = structuredClone(store.getState());
  theirs.checklist.items['main|d-ursus'] = { p: 'daily:2026-11-26', d: 1 };
  theirs.stamps['checklist/items/main|d-ursus'] = theirs.updatedAt + 5;
  theirs.updatedAt += 5;
  toA({ key: KEY, newValue: JSON.stringify(theirs) });
  assert.ok(store.getState().checklist.items['main|d-ursus']);
  assert.equal(store.getState().characters.length, 1);
  // It clears: an empty copy with no change times.
  toA({ key: KEY, newValue: JSON.stringify({ ...structuredClone(theirs), characters: [], bosses: {}, checklist: { items: {}, resets: {}, flags: {}, history: {} }, mesos: { held: 0, goals: [] }, stamps: {}, updatedAt: 0 }) });
  assert.equal(store.getState().characters.length, 0);
});

// ---------- the real store writes what both versions read ----------
test('18, 19: the store stamps edits so that both versions merge them (store.update, import, sync adoption)', () => {
  Date.now = realNow;
  store.resetState();
  store.replaceState(savedBefore(), true);
  assert.equal(store.getState().stamps['gear/main'], T0, 'a copy from the version before loads with its stamps as they were');
  const phone = structuredClone(store.getState());
  store.update((s) => { s.gear.main.slots.hat.stars = 22; });
  const st = store.getState().stamps;
  assert.ok(st['gear/main'] > T0 && st['gear/main'] === st['gear/main/slots/hat'] && st['gear/main/@fine'] === st['gear/main']);
  assert.equal(st['gear/main/slots/gloves'], T0);
  // The version before takes the whole gear part by that stamp.
  assert.equal(before.mergeStates(phone, structuredClone(store.getState()), Date.now()).gear.main.slots.hat.stars, 22);
  // An edit made there afterwards (it moves only gear/main) comes back, removal included.
  const theirs = OLD.edit(before.mergeStates(phone, structuredClone(store.getState()), Date.now()), Date.now() + 5, (s) => { delete s.gear.main.slots.gloves; s.gear.main.slots.hat.stars = 21; });
  store.replaceState(mergeStates(store.getState(), theirs), true);
  assert.deepEqual(store.getState().gear.main.slots, { hat: { tier: 3, stars: 21 } });
  // Goals: every change to the list moves the order stamp (the version before reads only that one).
  const g0 = store.getState().stamps['mesos/goalOrder'];
  store.update((s) => { s.mesos.goals.push({ id: 'zz', name: 'First', cost: 1 }); });
  assert.ok(store.getState().stamps['mesos/goalOrder'] > g0);
  // An import stamps every part, old stamp and marks included.
  store.replaceState({ v: 1, characters: [{ id: 'main', name: 'Main', level: 264 }], gear: { main: { slots: { hat: { stars: 1 } } } }, updatedAt: 5 });
  const imp = store.getState().stamps;
  assert.ok(imp['gear/main'] >= imp['gear/main/slots/hat'] && imp['gear/main/slots/hat'] > st['gear/main']);
  assert.equal(imp['gear/main/@fine'], imp['gear/main']);
  assert.equal(before.mergeStates(theirs, structuredClone(store.getState()), Date.now() + 10).gear.main.slots.hat.stars, 1, 'the version before takes the imported gear');
  store.resetState();
});
