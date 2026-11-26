// Three devices make random edits and sync in random order, stamping exactly as the store does (every changed
// part gets the time of the edit). Afterwards every device must hold the same entries, and the newest edit to
// each thing must have survived. Seeded, so a failure can be reproduced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStates, changedPaths, units, sameEntries } from '../../site/app/calc/merge.js';

function rng(seed) { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }
const blank = () => ({ v: 1, characters: [{ id: 'c1', name: 'A' }], checklist: { items: {}, resets: {}, flags: {}, history: {} }, bosses: {}, symbols: {}, liberation: {}, ibp: {}, erda: {}, gear: { c1: { slots: {} } }, level: {}, pitch: {}, shops: {}, champions: { slots: [], raid: {} }, mesos: { held: 0, goals: [] }, incomeHistory: {}, ui: { hiddenEvents: {}, seasonDone: {} }, stamps: {}, updatedAt: 1 });

function edit(prev, t, fn) {
  const next = structuredClone(prev);
  fn(next);
  next.stamps = { ...prev.stamps };
  for (const p of changedPaths(prev, next)) next.stamps[p] = t;
  next.updatedAt = t;
  return next;
}

// New goals and drops get unique ids, as the app's random ids are.
let uid = 0;
// Random edits: each returns [thing it changed, value it set] so the newest one can be checked afterwards.
const EDITS = [
  (s, r, n) => { s.mesos.held = n; return ['mesos/held', n]; },
  (s, r, n) => { s.ui.bossMargin = [1, 1.5, 2, 3][n % 4]; return ['ui/bossMargin', s.ui.bossMargin]; },
  (s, r, n) => { const id = `g${++uid}`; s.mesos.goals.push({ id, name: id, cost: n }); return [`goal:${id}`, true]; },
  (s, r, n) => { const id = `e${n % 7}`; s.ui.hiddenEvents[id] = true; return [`hidden:${id}`, true]; },
  (s, r, n) => { const k = `c1|d-${n % 5}`; s.checklist.items[k] = { p: 'x', d: n }; return [`tick:${k}`, n]; },
  (s, r, n) => { s.gear.c1.slots.hat = { tier: 1 + (n % 4) }; return ['hat', s.gear.c1.slots.hat.tier]; },
  (s, r, n) => { const id = `d${++uid}`; (s.pitch.c1 = s.pitch.c1 || { drops: [] }).drops.push({ id, item: 'berserked', d: '2026-11-01' }); return [`drop:${id}`, true]; }
];
const read = (s, key) => {
  if (key === 'mesos/held') return s.mesos.held;
  if (key === 'ui/bossMargin') return s.ui.bossMargin;
  if (key === 'hat') return s.gear.c1 && s.gear.c1.slots.hat && s.gear.c1.slots.hat.tier;
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (kind === 'goal') return s.mesos.goals.some((g) => g.id === id) || undefined;
  if (kind === 'hidden') return s.ui.hiddenEvents[id];
  if (kind === 'tick') return s.checklist.items[id] && s.checklist.items[id].d;
  if (kind === 'drop') return (s.pitch.c1 && s.pitch.c1.drops.some((d) => d.id === id)) || undefined;
};

test('three devices converge and keep the newest edit of everything (1,500 random runs)', () => {
  const runs = Number(process.env.SYNC_RUNS) || 1500;
  const failures = [];
  for (let seed = 1; seed <= runs; seed++) {
    const r = rng(seed);
    let gist = blank();
    const dev = [structuredClone(gist), structuredClone(gist), structuredClone(gist)];
    const newest = new Map(); // key -> [time, value]
    let t = 10;
    for (let step = 0; step < 14; step++) {
      const i = Math.floor(r() * 3);
      if (r() < 0.6) {
        t += 1 + Math.floor(r() * 5);
        const fn = EDITS[Math.floor(r() * EDITS.length)];
        const n = Math.floor(r() * 1000);
        let change;
        const before = dev[i];
        dev[i] = edit(dev[i], t, (s) => { change = fn(s, r, n); });
        // Setting a value the device already shows changes nothing there, so there is no edit to keep.
        if (changedPaths(before, dev[i]).length) newest.set(change[0], [t, change[1]]);
      } else {
        // A sync: merge with the gist, then write the result back.
        const m = mergeStates(dev[i], gist, 1e12);
        dev[i] = m;
        gist = structuredClone(m);
      }
    }
    // Everyone syncs three times in turn at the end (an order tie settles on the highest order, which can take
    // one round to reach every device), and a further round must change nothing.
    for (let round = 0; round < 3; round++) for (let i = 0; i < 3; i++) { dev[i] = mergeStates(dev[i], gist, 1e12); gist = structuredClone(dev[i]); }
    for (let i = 1; i < 3; i++) if (!sameEntries(dev[0], dev[i])) failures.push(`seed ${seed}: device ${i} differs from device 0`);
    const settled = mergeStates(dev[0], gist, 1e12);
    if (!sameEntries(settled, dev[0])) failures.push(`seed ${seed}: another sync still changes something`);
    for (const [key, [, value]] of newest) if (read(dev[0], key) !== value) failures.push(`seed ${seed}: ${key} is ${read(dev[0], key)}, newest edit set ${value}`);
    const ids = dev[0].mesos.goals.map((g) => g.id);
    if (new Set(ids).size !== ids.length) failures.push(`seed ${seed}: a goal is listed twice`);
    if (failures.length > 20) break;
  }
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} failures`);
  assert.ok(units(blank()).size > 0);
});
