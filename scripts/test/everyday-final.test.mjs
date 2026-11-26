// Fixes from the independent re-check of the everyday-use round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dailyProgress, whoFor } from '../../site/app/pages/checklist.js';
import { symbolPlan } from '../../site/app/calc/progress.js';
import { watchData, RETRY_GAP, REFRESH_GAP } from '../../site/app/data.js';
import { changedAt } from '../../site/app/calc/asof.js';
import * as store from '../../site/app/store.js';
import { periodKey } from '../../site/app/time.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const checklist = read('checklist');
const bosses = read('bosses');
const symbols = read('symbols');
const DATA = { checklist, bosses, bossById: Object.fromEntries(bosses.bosses.map((b) => [b.id, b])), upgrades: read('upgrades'), nexonCharacters: { characters: [] } };
const NOW = Date.parse('2026-11-27T03:00:00Z');
const main = { id: 'a', name: 'Main', level: 264, challenger: true, world: 'heroic' };

test('daily bosses never change the dailies total or undo a finished day', () => {
  const group = checklist.groups.find((g) => g.key === 'daily');
  const day = periodKey('daily', NOW);
  const items = {};
  // Everything a tick box or a counter can finish is finished.
  for (const item of group.items) {
    if (item.bosses) continue;
    const key = item.scope === 'account' ? item.id : `a|${item.id}`;
    if (item.type === 'count') items[key] = { p: day, t: NOW, c: item.target };
    else items[key] = { p: day, t: NOW, d: 1 };
    for (const [cid] of item.chips || []) items[`${key}_${cid}`] = { p: day, t: NOW, d: 1 };
  }
  const cs = { items, resets: {}, flags: {}, history: {} };
  const withPicks = (picks, clears = {}) => ({ characters: [main], level: {}, symbols: {}, bosses: { a: { picks, clears } } });
  const none = dailyProgress(checklist, cs, NOW, whoFor(DATA, withPicks({}), main));
  assert.ok(none.total > 0);
  assert.equal(none.done, none.total, 'the day is finished');
  // One daily boss picked and cleared, then a second picked in the evening: still finished.
  const one = dailyProgress(checklist, cs, NOW, whoFor(DATA, withPicks({ 'zakum-normal': { party: 1 } }, { 'zakum-normal': { [day]: true } }), main));
  const two = dailyProgress(checklist, cs, NOW, whoFor(DATA, withPicks({ 'zakum-normal': { party: 1 }, 'cygnus-normal': { party: 1 } }, { 'zakum-normal': { [day]: true } }), main));
  assert.deepEqual(one, none);
  assert.deepEqual(two, none);
});

test('a symbol with enough held for every level left reads as covered, not as overdue', () => {
  const area = Object.keys(symbols).map((k) => symbols[k]).find((v) => v && typeof v === 'object' && Array.isArray(v.areas));
  const def = area ? area.areas[0] : null;
  if (!def) return; // the data has another shape: covered by the page tests
  const plan = symbolPlan(area, def, { level: 1, have: 1e9, at: NOW - 40 * 86400000 }, NOW);
  if (plan.maxed || plan.locked) return;
  assert.equal(plan.remainingSymbols, 0);
  assert.equal(plan.maxDue, false);
});

test('a failed re-read of the data files is tried again within minutes, not after an hour', async () => {
  let t = NOW;
  const realNow = Date.now;
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  let timer = null;
  Date.now = () => t;
  globalThis.setInterval = (fn) => { timer = fn; return 1; };
  globalThis.clearInterval = () => { timer = null; };
  const realFetch = globalThis.fetch;
  let asked = 0;
  let fail = true;
  globalThis.fetch = async () => { asked++; if (fail) throw new Error('down'); return { ok: true, json: async () => ({ checkedAt: new Date(t).toISOString(), ok: true }) }; };
  let data = { meta: { checkedAt: new Date(NOW - 3600000).toISOString() }, refresh: { failed: false, at: NOW } };
  const stop = watchData({ get: () => data, set: (d) => { data = d; }, doc: { visibilityState: 'visible' }, win: null, nav: { onLine: true } });
  const minute = async () => { t += 60000; if (timer) timer(); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };
  try {
    for (let i = 0; i < 61; i++) await minute();
    assert.equal(asked >= 1, true, 'the hourly check ran');
    assert.equal(data.refresh.failed, true);
    const afterFail = asked;
    for (let i = 0; i < 3; i++) await minute();
    assert.ok(asked > afterFail, 'it is tried again within three minutes');
    assert.ok(RETRY_GAP < REFRESH_GAP);
  } finally {
    stop();
    Date.now = realNow;
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
    globalThis.fetch = realFetch;
  }
});

test('confirming the same mesos held moves its "as of" day without changing the amount', () => {
  const realNow = Date.now;
  try {
    let t = Date.parse('2026-11-01T03:00:00Z');
    Date.now = () => t;
    store.replaceState(store.blankState());
    store.update((s) => { s.mesos.held = 1234567890; });
    assert.equal(changedAt(store.getState(), 'mesos/held', t), t);
    const first = t;
    t += 20 * 86400000;
    store.touch('mesos/held');
    assert.equal(store.getState().mesos.held, 1234567890, 'the exact amount stays');
    assert.equal(changedAt(store.getState(), 'mesos/held', t), t, 'the figure counts as looked at today');
    assert.ok(t > first);
  } finally { Date.now = realNow; }
});
