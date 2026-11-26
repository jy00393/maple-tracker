// Second round of fixes, sync and saving: finer sync units per character, clocks that are behind or ahead,
// unreadable synced copies, two tabs sharing one browser, safety copies, and the status shown in the top bar.
// Nothing here talks to GitHub: fetch is a stand-in and the "token" is a made-up word.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

const mem = installFakeBrowser();
// Real listener lists, so tests can deliver the events a browser would (storage, pagehide, visibilitychange).
const handlers = {};
const listenOn = (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); };
globalThis.window.addEventListener = listenOn;
globalThis.document.addEventListener = listenOn;
// Storage that can be made to run out of room.
let full = () => false;
const plain = globalThis.localStorage;
globalThis.localStorage = { getItem: plain.getItem, removeItem: plain.removeItem, setItem: (k, v) => { if (full(k, String(v))) throw new Error('QuotaExceededError'); plain.setItem(k, v); } };
const KEY = 'maple-tracker:v1';
const BACKUPS = 'maple-tracker:backups';
const SYNC = 'maple-tracker:sync';
const DAY = 86400000;

const merge = await import('../../site/app/calc/merge.js');
const { mergeStates, changedPaths, units, sameEntries, sameStamps } = merge;
// Two more copies of the store stand for two tabs of one browser; each registers its own listeners.
const count = (type) => (handlers[type] || []).length;
const tabA = await import('../../site/app/store.js?tab=A');
const toA = (handlers.storage || [])[count('storage') - 1];
const tabB = await import('../../site/app/store.js?tab=B');
const toB = count('storage') > 1 ? handlers.storage[count('storage') - 1] : undefined;
const store = await import('../../site/app/store.js');
const sync = await import('../../site/app/sync.js');
const { appStatus } = await import('../../site/app/calc/status.js');
const { applySetup } = await import('../../site/app/calc/setup.js');
const { html, render } = await import('../../site/vendor/htm-preact.mjs');
const { SettingsPage } = await import('../../site/app/pages/settings.js');

const realNow = Date.now;
after(() => { Date.now = realNow; });

// An edit stamped the way store.update stamps it.
function edit(prev, t, fn) {
  const next = structuredClone(prev);
  fn(next);
  next.stamps = { ...prev.stamps };
  const paths = (merge.editedPaths || changedPaths)(prev, next);
  for (const p of paths) next.stamps[p] = merge.stampOf ? Math.max(t, merge.stampOf(prev.stamps, p, t) + 1) : t;
  next.updatedAt = Math.max(t, (prev.updatedAt || 0) + 1);
  return next;
}
const blank = () => ({ v: 1, characters: [{ id: 'c1', name: 'A' }], checklist: { items: {}, resets: {}, flags: {}, history: {}, owner: null, ownerSet: true }, bosses: {}, symbols: {}, liberation: {}, ibp: {}, erda: {}, gear: {}, level: {}, pitch: {}, shops: {}, champions: { slots: [], raid: {} }, mesos: { held: 0, goals: [] }, incomeHistory: {}, ui: { hiddenEvents: {}, seasonDone: {} }, stamps: {}, updatedAt: 1 });
const bossesOf = (s) => { const b = (s.bosses.c1 = s.bosses.c1 || {}); b.picks = b.picks || {}; b.clears = b.clears || {}; return b; };
const gearOf = (s) => { const g = (s.gear.c1 = s.gear.c1 || {}); g.slots = g.slots || {}; return g; };
const levelOf = (s) => { const l = (s.level.c1 = s.level.c1 || {}); l.log = l.log || []; return l; };
const WEEK = 'thu:2026-11-26';
// One round trip with the gist, as sync.js does it: merge, keep the result, write it back.
const syncWith = (dev, gist, now = 1e12) => { const m = mergeStates(dev, gist, now); return [m, structuredClone(m)]; };

// ---------- 2, 31, 58: per-character parts merge entry by entry ----------
test('31: boss ticks made on two devices are all kept, even when one device never pulled first', () => {
  let gist = edit(blank(), 10, (s) => { const b = bossesOf(s); b.picks['lotus-hard'] = { party: 1 }; b.picks['damien-hard'] = { party: 1 }; b.picks['will-hard'] = { party: 1 }; });
  let pc = structuredClone(gist);
  let phone = structuredClone(gist);
  pc = edit(pc, 100, (s) => { bossesOf(s).clears['lotus-hard'] = { [WEEK]: true }; });
  [pc, gist] = syncWith(pc, gist);
  [phone, gist] = syncWith(phone, gist);
  phone = edit(phone, 200, (s) => { bossesOf(s).clears['damien-hard'] = { [WEEK]: true }; });
  [phone, gist] = syncWith(phone, gist);
  // The PC tab stayed open and never pulled before its next tick.
  pc = edit(pc, 300, (s) => { bossesOf(s).clears['will-hard'] = { [WEEK]: true }; });
  [pc, gist] = syncWith(pc, gist);
  [phone, gist] = syncWith(phone, gist);
  for (const dev of [pc, phone, gist]) assert.deepEqual(Object.keys(dev.bosses.c1.clears).sort(), ['damien-hard', 'lotus-hard', 'will-hard']);
  assert.ok(sameEntries(pc, phone));
});

test('2: a tick on one device and a pick change on the other are both kept; an untick still wins; a shared tick moves', () => {
  const base = edit(blank(), 10, (s) => { const b = bossesOf(s); b.picks['lotus-hard'] = { party: 1 }; b.picks['damien-hard'] = { party: 1 }; b.clears['damien-hard'] = { [WEEK]: true }; });
  const a = edit(base, 100, (s) => { bossesOf(s).clears['lotus-hard'] = { [WEEK]: true }; });
  const b = edit(base, 200, (s) => { const x = bossesOf(s); x.picks['lucid-hard'] = { party: 2 }; delete x.picks['damien-hard']; delete x.clears['damien-hard'][WEEK]; });
  for (const m of [mergeStates(a, b, 1e12), mergeStates(b, a, 1e12)]) {
    assert.deepEqual(Object.keys(m.bosses.c1.picks).sort(), ['lotus-hard', 'lucid-hard']);
    assert.equal(m.bosses.c1.clears['lotus-hard'][WEEK], true, 'the tick from device A');
    assert.ok(!m.bosses.c1.clears['damien-hard'] || !m.bosses.c1.clears['damien-hard'][WEEK], 'the newer untick from device B');
  }
  // toggleClear moves a shared tick: off one difficulty, on the other. The other device's tick elsewhere stays.
  const moved = edit(a, 300, (s) => { const x = bossesOf(s); delete x.clears['lotus-hard'][WEEK]; x.clears['lotus-extreme'] = { [WEEK]: true }; });
  const other = edit(a, 250, (s) => { bossesOf(s).clears['will-hard'] = { [WEEK]: true }; });
  const m = mergeStates(other, moved, 1e12);
  assert.ok(!m.bosses.c1.clears['lotus-hard'][WEEK]);
  assert.equal(m.bosses.c1.clears['lotus-extreme'][WEEK], true);
  assert.equal(m.bosses.c1.clears['will-hard'][WEEK], true);
});

test('31, 58: gear slots, symbols, liberation, 6th job levels, Item Burning and level readings merge entry by entry', () => {
  const base = edit(blank(), 10, (s) => {
    gearOf(s).slots.top = { tier: 1 };
    s.gear.c1.preset = 'mid';
    s.symbols.c1 = { cernium: { level: 7, have: 0 } };
    s.liberation.c1 = { genesis: { stage: 1, traces: 300, picks: {} } };
    s.erda.c1 = { template: 'hexa', levels: { origin: 1 }, steps: {} };
    s.ibp.c1 = { done: { s1: true }, crests: 2 };
    levelOf(s).log.push({ t: 1000, level: 264, pct: 10 });
  });
  const phone = edit(base, 100, (s) => {
    s.gear.c1.slots.hat = { tier: 3, stars: 17 };
    s.gear.c1.stats = { main: 40000 };
    s.symbols.c1.cernium.level = 8;
    s.liberation.c1.genesis.traces = 350;
    s.erda.c1.levels.mastery1 = 4;
    s.ibp.c1.done.s2 = true;
    s.level.c1.log.push({ t: 2000, level: 264, pct: 40 });
  });
  const pc = edit(base, 200, (s) => {
    s.gear.c1.slots.ring1 = { tier: 4 };
    s.gear.c1.preset = 'high';
    s.symbols.c1.arcus = { level: 1, have: 15 };
    s.liberation.c1.destiny = { stage: 0, traces: 0, picks: {} };
    s.erda.c1.levels.origin = 2;
    s.ibp.c1.crests = 5;
    s.level.c1.log.push({ t: 3000, level: 264, pct: 45 });
  });
  const results = [mergeStates(phone, pc, 1e12), mergeStates(pc, phone, 1e12)];
  for (const m of results) {
    assert.deepEqual(Object.keys(m.gear.c1.slots).sort(), ['hat', 'ring1', 'top']);
    assert.equal(m.gear.c1.preset, 'high');
    assert.deepEqual(m.gear.c1.stats, { main: 40000 });
    assert.equal(m.symbols.c1.cernium.level, 8);
    assert.equal(m.symbols.c1.arcus.have, 15);
    assert.equal(m.liberation.c1.genesis.traces, 350);
    assert.ok(m.liberation.c1.destiny);
    assert.deepEqual(m.erda.c1.levels, { origin: 2, mastery1: 4 });
    assert.equal(m.erda.c1.template, 'hexa');
    assert.deepEqual(m.ibp.c1.done, { s1: true, s2: true });
    assert.equal(m.ibp.c1.crests, 5);
    assert.deepEqual(m.level.c1.log.map((r) => r.pct), [10, 40, 45], 'both new readings, oldest first');
  }
  assert.ok(sameEntries(results[0], results[1]));
  // Deleting a reading on one device still wins over the older copy that has it.
  const removed = edit(results[0], 400, (s) => { s.level.c1.log = s.level.c1.log.filter((r) => r.t !== 2000); });
  assert.deepEqual(mergeStates(results[1], removed, 1e12).level.c1.log.map((r) => r.t), [1000, 3000]);
  assert.deepEqual(mergeStates(removed, results[1], 1e12).level.c1.log.map((r) => r.t), [1000, 3000]);
});

test('31: copies stamped per character by the earlier version still merge, and nothing is lost', () => {
  // Saved by the version before: one stamp per character and part.
  const old = blank();
  bossesOf(old).picks['lotus-hard'] = { party: 1 };
  old.bosses.c1.clears['lotus-hard'] = { [WEEK]: true };
  gearOf(old).slots.top = { tier: 2 };
  levelOf(old).log.push({ t: 1000, level: 264, pct: 10 });
  old.stamps = { 'characters/c1': 50, 'bosses/c1': 50, 'gear/c1': 50, 'level/c1': 50 };
  old.updatedAt = 50;
  // Device A (now on this version) adds entries; device B still holds the old copy untouched.
  const a = edit(old, 100, (s) => { s.bosses.c1.clears['will-hard'] = { [WEEK]: true }; s.gear.c1.slots.hat = { tier: 3 }; s.level.c1.log.push({ t: 2000, level: 264, pct: 20 }); });
  assert.equal(a.stamps['bosses/c1'], 50, 'the old whole-character stamp is never moved');
  const b = edit(old, 200, (s) => { delete s.gear.c1.slots.top; s.bosses.c1.clears['damien-hard'] = { [WEEK]: true }; });
  for (const m of [mergeStates(a, b, 1e12), mergeStates(b, a, 1e12)]) {
    assert.deepEqual(Object.keys(m.bosses.c1.clears).sort(), ['damien-hard', 'lotus-hard', 'will-hard']);
    assert.deepEqual(Object.keys(m.gear.c1.slots), ['hat'], 'the removal on B beats the old stamp; the slot added on A stays');
    assert.equal(m.level.c1.log.length, 2);
  }
  // A whole part removed by the earlier version (a marker with no data) still removes older entries.
  const wiped = { ...structuredClone(old), gear: {}, stamps: { ...old.stamps, 'gear/c1': 300 }, updatedAt: 300 };
  assert.ok(!mergeStates(old, wiped, 1e12).gear.c1, 'older entries go');
  // A copy with no stamps at all is dated by its updatedAt, entry by entry.
  const bare = structuredClone(old);
  delete bare.stamps;
  assert.equal(merge.seedStamps(bare)['gear/c1/slots/top'], 50);
});

test('31: deleting a character still takes its split parts along, and a kept character brings them back', () => {
  const base = edit(blank(), 10, (s) => { s.characters.push({ id: 'c2', name: 'B' }); s.gear.c2 = { slots: { hat: { tier: 1 } } }; s.bosses.c2 = { picks: { 'lotus-hard': { party: 1 } }, clears: {} }; });
  const deleted = edit(base, 100, (s) => { s.characters = s.characters.filter((c) => c.id !== 'c2'); delete s.gear.c2; delete s.bosses.c2; });
  // The other device edits one of c2's gear slots later, but not the character itself: the delete stands.
  const slotEdit = edit(base, 200, (s) => { s.gear.c2.slots.ring1 = { tier: 2 }; });
  for (const m of [mergeStates(deleted, slotEdit, 1e12), mergeStates(slotEdit, deleted, 1e12)]) {
    assert.deepEqual(m.characters.map((c) => c.id), ['c1']);
    assert.ok(!('c2' in m.gear) && !('c2' in m.bosses));
  }
  // The other device renames the character later: it is kept, with all of its parts.
  const renamed = edit(base, 300, (s) => { s.characters[1].name = 'Renamed'; });
  for (const m of [mergeStates(deleted, renamed, 1e12), mergeStates(renamed, deleted, 1e12)]) {
    assert.equal(m.characters.find((c) => c.id === 'c2').name, 'Renamed');
    assert.equal(m.gear.c2.slots.hat.tier, 1);
    assert.ok(m.bosses.c2.picks['lotus-hard']);
  }
});

// Three devices, random edits to one character's parts, random syncs. Afterwards all devices agree and the newest
// edit to every entry has survived (so an entry added on one device is never dropped by another device's edit).
function rng(seed) { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }
const BOSS = ['lotus-hard', 'damien-hard', 'will-hard', 'lucid-hard'];
const SLOT = ['hat', 'top', 'ring1', 'belt'];
const AREA = ['cernium', 'arcus', 'odium'];
let uid = 0;
const EDITS = [
  (s, n) => { const b = bossesOf(s); const id = BOSS[n % 4]; b.clears[id] = { ...(b.clears[id] || {}), [WEEK]: true }; return [`clear:${id}`, true]; },
  (s, n) => { const b = bossesOf(s); const id = BOSS[n % 4]; if (b.clears[id]) delete b.clears[id][WEEK]; return [`clear:${id}`, undefined]; },
  (s, n) => { const id = BOSS[n % 4]; bossesOf(s).picks[id] = { party: 1 + (n % 6) }; return [`pick:${id}`, 1 + (n % 6)]; },
  (s, n) => { const id = BOSS[n % 4]; delete bossesOf(s).picks[id]; return [`pick:${id}`, undefined]; },
  (s, n) => { const id = SLOT[n % 4]; gearOf(s).slots[id] = { tier: n % 5, stars: n % 23 }; return [`slot:${id}`, `${n % 5}/${n % 23}`]; },
  (s, n) => { gearOf(s).preset = ['low', 'mid', 'high'][n % 3]; return ['preset', s.gear.c1.preset]; },
  (s, n) => { const id = AREA[n % 3]; (s.symbols.c1 = s.symbols.c1 || {})[id] = { level: n % 20 }; return [`sym:${id}`, n % 20]; },
  (s, n) => { const t = 5000 + ++uid; levelOf(s).log.push({ t, level: 264, pct: n % 100 }); return [`log:${t}`, true]; },
  (s, n) => { const l = levelOf(s); if (!l.log.length) return ['none', undefined]; const t = l.log[n % l.log.length].t; l.log = l.log.filter((r) => r.t !== t); return [`log:${t}`, undefined]; },
  (s, n) => { const e = (s.erda.c1 = s.erda.c1 || {}); e.levels = { ...(e.levels || {}), [`n${n % 3}`]: n % 30 }; return [`erda:n${n % 3}`, n % 30]; },
  (s, n) => { const id = `g${++uid}`; s.mesos.goals.push({ id, name: id, cost: n }); return [`goal:${id}`, true]; },
  (s, n) => { const g = s.mesos.goals; if (g.length > 1) { const i = n % (g.length - 1); [g[i], g[i + 1]] = [g[i + 1], g[i]]; } return ['none', undefined]; },
  (s, n) => { const g = s.mesos.goals; if (!g.length) return ['none', undefined]; const [gone] = g.splice(n % g.length, 1); return [`goal:${gone.id}`, undefined]; }
];
function read(s, key) {
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const b = s.bosses.c1 || {};
  const g = s.gear.c1 || {};
  if (key === 'preset') return g.preset;
  if (kind === 'clear') return (b.clears && b.clears[id] && b.clears[id][WEEK]) || undefined;
  if (kind === 'pick') return b.picks && b.picks[id] ? b.picks[id].party : undefined;
  if (kind === 'slot') return g.slots && g.slots[id] ? `${g.slots[id].tier}/${g.slots[id].stars}` : undefined;
  if (kind === 'sym') return s.symbols.c1 && s.symbols.c1[id] ? s.symbols.c1[id].level : undefined;
  if (kind === 'log') return (s.level.c1 && (s.level.c1.log || []).some((r) => String(r.t) === id)) || undefined;
  if (kind === 'erda') return s.erda.c1 && s.erda.c1.levels ? s.erda.c1.levels[id] : undefined;
  if (kind === 'goal') return s.mesos.goals.some((x) => x.id === id) || undefined;
  return undefined;
}
function randomRuns(start, runs) {
  const failures = [];
  for (let seed = 1; seed <= runs && failures.length < 10; seed++) {
    const r = rng(seed * 7919);
    let gist = start();
    const dev = [structuredClone(gist), structuredClone(gist), structuredClone(gist)];
    const newest = new Map();
    let t = 1000;
    for (let step = 0; step < 18; step++) {
      const i = Math.floor(r() * 3);
      if (r() < 0.65) {
        t += 1 + Math.floor(r() * 5);
        const fn = EDITS[Math.floor(r() * EDITS.length)];
        const n = Math.floor(r() * 1000);
        let change;
        const before = dev[i];
        dev[i] = edit(dev[i], t, (s) => { change = fn(s, n); });
        if (change[0] !== 'none' && changedPaths(before, dev[i]).length) newest.set(change[0], change[1]);
      } else [dev[i], gist] = syncWith(dev[i], gist);
    }
    for (let round = 0; round < 3; round++) for (let i = 0; i < 3; i++) [dev[i], gist] = syncWith(dev[i], gist);
    for (let i = 1; i < 3; i++) if (!sameEntries(dev[0], dev[i])) failures.push(`seed ${seed}: device ${i} differs from device 0`);
    if (!sameEntries(mergeStates(dev[0], gist, 1e12), dev[0])) failures.push(`seed ${seed}: another sync still changes something`);
    for (const [key, value] of newest) if (read(dev[0], key) !== value) failures.push(`seed ${seed}: ${key} is ${read(dev[0], key)}, the newest edit set ${value}`);
    const ids = dev[0].mesos.goals.map((g) => g.id);
    if (new Set(ids).size !== ids.length) failures.push(`seed ${seed}: a goal is listed twice`);
    const log = ((dev[0].level.c1 || {}).log || []).map((x) => x.t);
    if (log.some((x, i) => i && x < log[i - 1])) failures.push(`seed ${seed}: level readings out of order`);
  }
  return failures;
}
test('31: three devices editing one character converge and keep the newest edit of every entry (random runs)', () => {
  const runs = Number(process.env.SYNC_RUNS) || 600;
  // Every device already holds the character's (empty) parts, as devices that have synced once do.
  const started = () => { const s = blank(); s.bosses.c1 = { picks: {}, clears: {} }; s.gear.c1 = { preset: 'mid', slots: {}, history: [] }; s.level.c1 = { log: [] }; s.symbols.c1 = {}; s.erda.c1 = { template: 'hexa', levels: {}, steps: {} }; return s; };
  assert.deepEqual(randomRuns(started, runs), []);
  // The same, starting from a copy that only carries the earlier version's per-character stamps.
  const legacy = () => {
    const s = blank();
    const b = bossesOf(s);
    for (const id of BOSS) { b.picks[id] = { party: 1 }; b.clears[id] = { [WEEK]: true }; }
    for (const id of SLOT) gearOf(s).slots[id] = { tier: 1, stars: 1 };
    s.symbols.c1 = { cernium: { level: 3 } };
    levelOf(s).log.push({ t: 100, level: 264, pct: 1 }, { t: 200, level: 264, pct: 2 });
    s.erda.c1 = { template: 'hexa', levels: {}, steps: {} };
    s.stamps = { 'characters/c1': 500, 'bosses/c1': 500, 'gear/c1': 500, 'symbols/c1': 500, 'level/c1': 500, 'erda/c1': 500, mesos: 500, ui: 500 };
    s.updatedAt = 500;
    return s;
  };
  assert.deepEqual(randomRuns(legacy, runs), []);
});

// ---------- 37: a goal added on one device does not undo a reorder made on another ----------
test('37: adding or removing a goal is not a reorder', () => {
  const base = edit(blank(), 10, (s) => { s.mesos.goals = [{ id: 'arcane', name: 'Arcane', cost: 1 }, { id: 'eternal', name: 'Eternal', cost: 2 }, { id: 'ring', name: 'Ring', cost: 3 }]; });
  const pc = edit(base, 100, (s) => { const g = s.mesos.goals; [g[0], g[2]] = [g[2], g[0]]; });
  const phone = edit(base, 160, (s) => { s.mesos.goals.push({ id: 'new', name: 'New', cost: 4 }); });
  assert.equal(phone.stamps['mesos/goalOrder'], base.stamps['mesos/goalOrder'], 'an added goal leaves the order stamp alone');
  for (const m of [mergeStates(pc, phone, 1e12), mergeStates(phone, pc, 1e12)]) assert.deepEqual(m.mesos.goals.map((g) => g.id), ['ring', 'eternal', 'arcane', 'new']);
  // Removing a goal after the other device's reorder keeps that order too.
  const removed = edit(base, 170, (s) => { s.mesos.goals.splice(1, 1); });
  for (const m of [mergeStates(pc, removed, 1e12), mergeStates(removed, pc, 1e12)]) assert.deepEqual(m.mesos.goals.map((g) => g.id), ['ring', 'arcane']);
  // A real reorder made later still wins.
  const later = edit(base, 300, (s) => { const g = s.mesos.goals; [g[0], g[1]] = [g[1], g[0]]; });
  assert.deepEqual(mergeStates(pc, later, 1e12).mesos.goals.map((g) => g.id), ['eternal', 'arcane', 'ring']);
});

// ---------- 38: a fresh device's first character does not claim another device's old ticks ----------
test('38: first-run setup only claims the old shared ticks when the device has some', () => {
  const fresh = applySetup(blank(), { name: 'Phone', level: 200 }, [], 'ph1', 1000);
  fresh.characters = fresh.characters.filter((c) => c.id !== 'c1');
  const phoneBase = { ...blank(), characters: [] };
  const phone = edit(phoneBase, 900, (s) => { applySetup(s, { name: 'Phone', level: 200 }, [], 'ph1', 900); });
  assert.equal(phone.checklist.owner, null);
  assert.equal(phone.checklist.ownerSet, true);
  // The PC's first-version save: unprefixed ticks and unlocks, credited to "main" when it first loaded.
  const pc = { ...blank(), characters: [{ id: 'main', name: 'Main' }], updatedAt: 500 };
  pc.checklist = { items: { 'arcane-daily': { p: 'daily:2026-11-20', d: 1 } }, resets: {}, flags: { arcus: true }, history: {}, owner: 'main', ownerSet: true };
  delete pc.stamps;
  for (const m of [mergeStates(pc, phone, 1e12), mergeStates(phone, pc, 1e12)]) {
    assert.equal(m.checklist.owner, 'main', 'the old ticks stay with the character they were credited to');
    assert.deepEqual(m.characters.map((c) => c.id).sort(), ['main', 'ph1']);
  }
  // Ticks made before any character existed still go to the first character.
  const early = { ...blank(), characters: [] };
  early.checklist.items['d-ursus'] = { p: 'daily:2026-11-26', d: 1 };
  assert.equal(applySetup(early, { name: 'First', level: 10 }, [], 'f1', 1000).checklist.owner, 'f1');
});

// ---------- 25: two tabs of one browser ----------
test('25: two open tabs merge what each saved instead of overwriting each other', async () => {
  assert.ok(typeof toA === 'function' && typeof toB === 'function', 'each tab listens for the other tab’s saves');
  const stored = () => JSON.parse(mem.get(KEY));
  tabA.replaceState({ v: 1, characters: [{ id: 'main', name: 'Main', level: 264 }], mesos: { held: 3200000000, goals: [] }, updatedAt: 5 });
  tabA.flush();
  toB({ key: KEY, newValue: mem.get(KEY) });
  assert.equal(tabB.getState().mesos.held, 3200000000, 'tab B shows what tab A saved');
  // Tab A saves two changes; tab B (which has not heard of them) then saves an unrelated setting.
  tabA.update((s) => { s.mesos.held = 111; s.checklist.items['main|d-monsterpark'] = { p: 'daily:2026-11-26', d: 1 }; });
  tabA.flush();
  let redraws = 0;
  const off = tabB.subscribe(() => { redraws++; });
  tabB.update((s) => { s.ui.todaySales = true; });
  tabB.flush();
  assert.equal(stored().mesos.held, 111, 'tab A’s meso total survives tab B’s save');
  assert.ok(stored().checklist.items['main|d-monsterpark'], 'and so does its tick');
  assert.equal(stored().ui.todaySales, true);
  assert.equal(tabB.getState().mesos.held, 111, 'tab B now shows it too');
  assert.ok(redraws >= 2, 'and redraws for it');
  off();
  // Tab A hears about tab B's save, takes the setting, and has nothing to write back.
  const text = mem.get(KEY);
  toA({ key: KEY, newValue: text });
  assert.equal(tabA.getState().ui.todaySales, true);
  await tick(320);
  assert.equal(mem.get(KEY), text, 'no write-back loop between the tabs');
  // Each tab keeps its own character on screen.
  tabA.update((s) => { s.characters.push({ id: 'alt', name: 'Alt', level: 200 }); s.activeId = 'alt'; });
  tabA.flush();
  toB({ key: KEY, newValue: mem.get(KEY) });
  assert.deepEqual(tabB.getState().characters.map((c) => c.id), ['main', 'alt']);
  assert.equal(tabB.getState().activeId, 'main');
});

test('25: "Clear all data" in one tab clears the other tab too, and nothing comes back', () => {
  tabA.resetState();
  tabA.flush();
  toB({ key: KEY, newValue: mem.get(KEY) });
  assert.equal(tabB.getState().characters.length, 0);
  tabB.update((s) => { s.mesos.held = 5; });
  tabB.flush();
  assert.deepEqual(JSON.parse(mem.get(KEY)).characters, []);
  // Even when the other tab never heard about the clearing before its next save.
  toA({ key: KEY, newValue: mem.get(KEY) });
  tabA.update((s) => { s.characters.push({ id: 'main', name: 'Main', level: 264 }); });
  tabA.flush();
  toB({ key: KEY, newValue: mem.get(KEY) });
  assert.equal(tabB.getState().characters.length, 1);
  tabA.resetState();
  tabA.flush();
  tabB.update((s) => { s.mesos.held = 9; });
  tabB.flush();
  assert.deepEqual(JSON.parse(mem.get(KEY)).characters, []);
  assert.equal(tabB.getState().characters.length, 0);
  // Leave storage clean for the tests below.
  tabB.resetState();
  tabB.flush();
  toA({ key: KEY, newValue: mem.get(KEY) });
});

// From here on the tests use the page's own store. It starts from what storage holds now.
function startOver(state) {
  Date.now = realNow;
  full = () => false;
  mem.delete(BACKUPS);
  store.resetState();
  if (state) store.replaceState(state);
  store.flush();
}

// ---------- 29: the last change is written when the page is hidden or closed ----------
test('29: a pending save is written at once when the page is hidden or closed', () => {
  startOver({ v: 1, characters: [{ id: 'c1', name: 'A', level: 264 }], updatedAt: 5 });
  store.update((s) => { s.mesos.held = 222; });
  assert.notEqual(JSON.parse(mem.get(KEY)).mesos.held, 222, 'not written yet (the save waits a moment)');
  assert.ok(count('pagehide') > 0, 'the store listens for the page closing');
  for (const fn of handlers.pagehide) fn({});
  assert.equal(JSON.parse(mem.get(KEY)).mesos.held, 222);
  store.update((s) => { s.mesos.held = 333; });
  globalThis.document.visibilityState = 'hidden';
  for (const fn of handlers.visibilitychange || []) fn({});
  globalThis.document.visibilityState = 'visible';
  assert.equal(JSON.parse(mem.get(KEY)).mesos.held, 333);
});

// ---------- 10: one safety copy per game day, also in a tab that stays open ----------
test('10: a tab left open takes a safety copy before the first change of each new day', () => {
  startOver();
  const day0 = Date.parse('2027-03-01T03:00:00Z');
  Date.now = () => day0;
  store.update((s) => { s.characters.push({ id: 'c1', name: 'A', level: 264 }); });
  for (let d = 1; d <= 3; d++) {
    Date.now = () => day0 + d * DAY;
    store.update((s) => { s.characters[0].level = 264 + d; });
    store.update((s) => { s.mesos.held = d; });
  }
  const copies = store.listBackups().filter((b) => !b.label);
  assert.deepEqual(copies.map((b) => b.d), ['2027-03-04', '2027-03-03', '2027-03-02'], 'one copy per day, newest first');
  assert.deepEqual(copies.map((b) => b.state.characters[0].level), [266, 265, 264], 'each holds the entries as they were before that day’s first change');
  Date.now = realNow;
});

// ---------- 30: an out-of-room browser is not reported as "copy kept" ----------
test('30: when the safety copy cannot be written, restore says so', () => {
  startOver({ v: 1, characters: [{ id: 'c1', name: 'A', level: 264 }], updatedAt: 5 });
  assert.equal(store.snapshotNow('first'), true);
  const at = store.listBackups()[0].at;
  store.update((s) => { s.characters[0].level = 270; });
  full = (k) => k === BACKUPS;
  assert.equal(store.snapshotNow('second'), false);
  assert.deepEqual(store.restoreBackup(at), { kept: false });
  assert.equal(store.getState().characters[0].level, 264, 'the restore itself still happens');
  full = () => false;
  store.update((s) => { s.characters[0].level = 271; });
  assert.deepEqual(store.restoreBackup(at), { kept: true });
  assert.equal(store.restoreBackup(123), false);
});

// ---------- 53 (and 30): Settings shows the copy made by Clear all data straight away ----------
const dataFile = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../site/data/${name}.json`, import.meta.url)), 'utf8'));
const DATA = { bosses: dataFile('bosses'), symbols: dataFile('symbols'), liberation: dataFile('liberation'), ibp: dataFile('ibp'), upgrades: dataFile('upgrades'), potential: dataFile('potential'), gearStats: dataFile('gearstats'), season: dataFile('season'), tables: dataFile('tables'), meta: { checkedAt: new Date().toISOString(), ok: true, errors: [] }, news: { items: [] } };
const mounted = [];
after(() => { for (const el of mounted) render(null, el); });
async function showSettings() {
  const el = new FakeNode('div');
  mounted.push(el);
  const App = () => html`<${SettingsPage} data=${DATA} state=${store.useStore()} />`;
  render(html`<${App} />`, el);
  await tick(5);
  return el;
}
const button = (el, re) => el.find((n) => n.localName === 'button' && re.test(n.text));
const cardText = (el, title) => { const c = el.findAll((n) => (n.attrs.class || '').split(' ').includes('card') && n.text.trim().startsWith(title))[0]; return c ? c.text : ''; };

test('53: after "Clear all data" the safety-copies card lists the "before clearing" copy at once', async () => {
  startOver({ v: 1, characters: [{ id: 'c1', name: 'A', level: 264 }], updatedAt: 5 });
  const el = await showSettings();
  assert.match(cardText(el, 'Daily safety copies'), /none yet/);
  button(el, /^Clear all data/).fire('click');
  await tick(5);
  button(el, /Yes, clear everything/).fire('click');
  await tick(20);
  assert.equal(store.getState().characters.length, 0);
  const card = cardText(el, 'Daily safety copies');
  assert.match(card, /before clearing/);
  assert.match(card, /1 kept/);
  assert.ok(el.findAll((n) => n.localName === 'button' && /^Restore/.test(n.text)).length === 1, 'with a Restore button');
  assert.match(el.text, /A copy from just before is under Daily safety copies/);
});

test('30: clearing with no room for the safety copy says that no copy was kept', async () => {
  startOver({ v: 1, characters: [{ id: 'c1', name: 'A', level: 264 }], updatedAt: 5 });
  const el = await showSettings();
  full = (k) => k === BACKUPS;
  button(el, /^Clear all data/).fire('click');
  await tick(5);
  button(el, /Yes, clear everything/).fire('click');
  await tick(20);
  full = () => false;
  assert.match(el.text, /no safety copy was kept/);
  assert.doesNotMatch(el.text, /A copy from just before/);
});

// ---------- 28: ids that collide with built-in object members ----------
test('28: a loaded copy cannot smuggle in "__proto__" or "constructor" as an id', () => {
  startOver();
  const evil = JSON.parse('{"v":1,"updatedAt":5,"activeId":"__proto__","characters":[{"id":"__proto__","name":"P","level":264},{"id":"constructor","name":"C","level":10},{"id":"ok","name":"Ok","level":200}],"gear":{"__proto__":{"a":{"slots":{"hat":{"stars":22}}}},"ok":{"slots":{"top":{"stars":1}}}},"bosses":{"constructor":{"picks":{"x":{"party":1}},"clears":{}}},"checklist":{"items":{"__proto__":{"a|d-ursus":{"p":"daily:2026-11-26","d":1}}}}}');
  store.replaceState(evil);
  const s = store.getState();
  assert.deepEqual(s.characters.map((c) => c.id), ['ok']);
  assert.equal(s.activeId, 'ok');
  assert.equal(Object.getPrototypeOf(s.gear), Object.prototype);
  assert.equal(Object.getPrototypeOf(s.checklist.items), Object.prototype);
  assert.equal(s.gear.a, undefined, 'nothing hides in a prototype');
  assert.equal(s.checklist.items['a|d-ursus'], undefined);
  assert.deepEqual(Object.keys(s.bosses), []);
  // charSlice makes an own entry instead of finding an inherited member.
  const probe = { bosses: {} };
  const made = store.charSlice(probe, 'bosses', 'constructor', () => ({ picks: {}, clears: {} }));
  made.picks.x = 1;
  assert.ok(Object.hasOwn(probe.bosses, 'constructor'));
  // A synced copy is merged before it is cleaned: that must not touch Object.prototype either.
  const remote = JSON.parse('{"v":1,"updatedAt":9,"characters":[{"id":"ok","name":"Ok"}],"gear":{"__proto__":{"slots":{"hat":{"stars":22}},"polluted":true},"constructor":{"slots":{"hat":{"stars":1}}}},"symbols":{"ok":{"__proto__":{"level":3}}}}');
  const merged = mergeStates(structuredClone(s), remote);
  assert.equal(({}).slots, undefined);
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).level, undefined);
  assert.equal(Object.getPrototypeOf(merged.gear), Object.prototype);
  assert.deepEqual(Object.keys(Object.prototype), []);
});

// ---------- 33: a device whose clock is behind ----------
test('33: an edit made on a slow clock is not undone by the next sync', () => {
  startOver({ v: 1, characters: [{ id: 'c1', name: 'A', level: 264 }], updatedAt: 5 });
  const ahead = realNow() + 120000; // the other device's clock is two minutes ahead of this one
  const pc = edit(structuredClone(store.getState()), ahead, (s) => { s.mesos.held = 1000; s.checklist.items['c1|ursus'] = { p: 'daily:2026-11-26', d: 1 }; });
  const pcUnticked = edit(pc, ahead + 1000, (s) => { delete s.checklist.items['c1|ursus']; });
  store.replaceState(mergeStates(store.getState(), pcUnticked), true);
  assert.equal(store.getState().mesos.held, 1000);
  // Thirty real seconds later, on this device's slow clock, still "before" the other device's edits.
  store.update((s) => { s.mesos.held = 2500; s.checklist.items['c1|ursus'] = { p: 'daily:2026-11-26', d: 1 }; });
  const mine = store.getState();
  assert.ok(mine.stamps['mesos/held'] > pcUnticked.stamps['mesos/held'], 'a stamp never goes backwards');
  for (const m of [mergeStates(mine, pcUnticked), mergeStates(pcUnticked, mine)]) {
    assert.equal(m.mesos.held, 2500);
    assert.ok(m.checklist.items['c1|ursus'], 'the re-made tick is kept');
  }
  // An import on the slow clock is not undone either.
  store.replaceState({ v: 1, characters: [{ id: 'c1', name: 'A', level: 264 }], mesos: { held: 7, goals: [] }, updatedAt: 5 });
  assert.equal(mergeStates(store.getState(), pcUnticked).mesos.held, 7);
  // A stamp that is far in the future (a badly wrong clock) is not built on.
  const far = realNow() + 30 * DAY;
  store.replaceState({ ...structuredClone(store.getState()), stamps: { ...store.getState().stamps, 'mesos/held': far } }, true);
  store.update((s) => { s.mesos.held = 8; });
  assert.ok(store.getState().stamps['mesos/held'] < realNow() + DAY);
});

// ---------- 74: the status pill ----------
test('74: a saved token with no finished sync is not shown as "All synced"; a clock warning shows', () => {
  const base = { syncOn: true, meta: { checkedAt: '2026-11-26T00:00:00Z', ok: true, errors: [] }, news: [], tablesChecked: '2026-11-23T00:00:00Z', now: Date.parse('2026-11-26T02:00:00Z') };
  const off = appStatus({ ...base, sync: { state: 'off', message: 'Not connected' } });
  assert.notEqual(off.level, 'ok');
  assert.notEqual(off.label, 'All synced');
  assert.notEqual(appStatus({ ...base, sync: undefined }).label, 'All synced');
  assert.equal(appStatus({ ...base, sync: { state: 'ok', message: 'Up to date' } }).label, 'All synced');
  const warn = appStatus({ ...base, sync: { state: 'warn', message: 'The clock on one of your devices is more than a day off.' } });
  assert.equal(warn.level, 'warn');
  assert.match(warn.parts.find((p) => p.key === 'sync').text, /clock/);
  assert.equal(appStatus({ ...base, syncOn: false, sync: { state: 'off' } }).label, 'Data fresh · sync off');
});

// ---------- sync.js against a stand-in for GitHub ----------
const FILE = 'maple-tracker.json';
let calls = [];
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body), text: async () => body });
// `gist` answers the API request for the gist; `raw` answers the download link of a long file.
function github({ gist, raw }) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url: String(url), method, body: opts.body });
    if (String(url).startsWith('https://raw.test/')) return raw();
    if (method === 'PATCH') return reply(200, '{}');
    return gist();
  };
}
const gistWith = (file) => () => reply(200, JSON.stringify({ id: 'g1', files: { [FILE]: file } }));
const connectFake = () => mem.set(SYNC, JSON.stringify({ token: 'not-a-real-token', gistId: 'g1' }));
const patches = () => calls.filter((c) => c.method === 'PATCH');
after(() => { sync.disconnect(); });

test('35, 36: a synced copy that cannot be used is never overwritten, and the message is plain English', async () => {
  startOver({ v: 1, characters: [{ id: 'phone', name: 'PhoneOnly', level: 200 }], updatedAt: 5 });
  connectFake();
  const good = JSON.stringify({ v: 1, characters: [{ id: 'main', name: 'Main', level: 264 }], mesos: { held: 5, goals: [] }, updatedAt: 3 });
  const cases = [
    ['an empty file', { gist: gistWith({ content: '' }) }, /empty/],
    ['null', { gist: gistWith({ content: 'null' }) }, /could not be read/],
    ['a list', { gist: gistWith({ content: '[]' }) }, /could not be read/],
    ['a copy from a newer version', { gist: gistWith({ content: good.replace('"v":1', '"v":2') }) }, /newer version/],
    ['a copy with a text version', { gist: gistWith({ content: good.replace('"v":1', '"v":"1"') }) }, /could not be read/],
    ['damaged text', { gist: gistWith({ content: good.slice(0, 40) }) }, /could not be read/],
    ['a long file whose download fails', { gist: gistWith({ content: good.slice(0, 40), truncated: true, raw_url: 'https://raw.test/x' }), raw: () => reply(404, '404: Not Found') }, /could not be downloaded/],
    ['a long file whose download is empty', { gist: gistWith({ content: good.slice(0, 40), truncated: true, raw_url: 'https://raw.test/x' }), raw: () => reply(200, '') }, /empty/],
    ['a long file with no download link', { gist: gistWith({ content: good.slice(0, 40), truncated: true }) }, /could not be downloaded/],
    ['a sign-in page instead of GitHub', { gist: () => reply(200, '<html>login</html>') }, /could not be read/],
    ['no connection', { gist: () => { throw new TypeError('Failed to fetch'); } }, /Could not reach GitHub/],
    ['a deleted gist', { gist: () => reply(404, '{}') }, /not found/],
    ['a server error', { gist: () => reply(500, '{}') }, /GitHub answered 500/]
  ];
  for (const [name, world, expected] of cases) {
    github(world);
    await assert.rejects(sync.syncNow(), (e) => { assert.match(e.message, expected, name); return true; }, name);
    const st = sync.syncStatus();
    assert.equal(st.state, 'error', name);
    assert.doesNotMatch(st.message, /JSON|Unexpected|Unterminated|Failed to fetch|position \d/, `${name}: no parser text`);
    assert.equal(patches().length, 0, `${name}: the gist is left alone`);
    assert.deepEqual(store.getState().characters.map((c) => c.id), ['phone'], `${name}: this device is left alone`);
  }
  // A long file that downloads fine is read from the link, and merged.
  github({ gist: gistWith({ content: good.slice(0, 40), truncated: true, raw_url: 'https://raw.test/x' }), raw: () => reply(200, good) });
  await sync.syncNow();
  assert.deepEqual(store.getState().characters.map((c) => c.id).sort(), ['main', 'phone']);
  assert.equal(patches().length, 1);
  // A gist with no copy yet (a bare {}) is seeded with this device's entries.
  github({ gist: gistWith({ content: '{}' }) });
  await sync.syncNow();
  assert.equal(patches().length, 1);
  assert.equal(sync.syncStatus().state, 'ok');
  sync.disconnect();
});

test('34: a device clock more than a day ahead is reported instead of "Saved to your gist"', async () => {
  assert.equal(typeof merge.futureStamps, 'function');
  const now = realNow();
  assert.equal(merge.futureStamps({ updatedAt: now, stamps: { a: now + 3600000 } }, now), false, 'an hour ahead is fine');
  assert.equal(merge.futureStamps({ updatedAt: now, stamps: { a: now + 3 * DAY } }, now), true);
  assert.equal(merge.futureStamps({ updatedAt: now + 3 * DAY, stamps: {} }, now), true);
  startOver({ v: 1, characters: [{ id: 'c1', name: 'A', level: 264 }], mesos: { held: 100, goals: [] }, updatedAt: 5 });
  connectFake();
  // The PC's clock is three days ahead: its copy carries change times this device cannot trust.
  const pc = edit(structuredClone(store.getState()), now + 3 * DAY, (s) => { s.mesos.held = 200; });
  github({ gist: gistWith({ content: JSON.stringify(pc) }) });
  await sync.syncNow();
  const st = sync.syncStatus();
  assert.equal(st.state, 'warn');
  assert.match(st.message, /clock/);
  assert.equal(store.getState().mesos.held, 100, 'the untrusted change is still ignored');
  assert.equal(appStatus({ syncOn: true, sync: st, meta: DATA.meta, news: [], tablesChecked: '2026-11-23T00:00:00Z', now }).level, 'warn');
  sync.disconnect();
});

test('74: the status is "Syncing…" from the first moment, and a page that starts listening late still shows a failure', async () => {
  startOver({ v: 1, characters: [{ id: 'c1', name: 'A', level: 264 }], updatedAt: 5 });
  sync.disconnect();
  connectFake();
  // The device is offline: the request fails at once, before the page's effects have run.
  github({ gist: () => { throw new TypeError('Failed to fetch'); } });
  const el = await showSettings();
  sync.startSync();
  assert.equal(sync.syncStatus().state, 'busy', 'never "not connected" while a token is saved');
  await tick(400);
  assert.equal(sync.syncStatus().state, 'error');
  assert.match(cardText(el, 'Status'), /Device sync failed: Could not reach GitHub/);
  assert.doesNotMatch(cardText(el, 'Status'), /Devices in sync/);
  // Sync connected or disconnected in another tab: this tab follows.
  const onSyncKey = (handlers.storage || []).slice(2);
  mem.delete(SYNC);
  for (const fn of onSyncKey) fn({ key: SYNC, newValue: null });
  assert.equal(sync.syncStatus().state, 'off');
  github({ gist: gistWith({ content: JSON.stringify(store.getState()) }) });
  connectFake();
  for (const fn of onSyncKey) fn({ key: SYNC, newValue: mem.get(SYNC) });
  assert.equal(sync.syncStatus().state, 'busy');
  await tick(50);
  assert.equal(sync.syncStatus().state, 'ok');
  sync.disconnect();
});
