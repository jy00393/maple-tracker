// Regression tests for the findings of the 24 Nov 2026 review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flameWeights, flameLines, flameScore, scoreDist, bestScore } from '../../site/app/calc/flames.js';
import { flameOptions } from '../../site/app/calc/advice.js';
import { starPlan, starSpread } from '../../site/app/calc/starforce.js';
import { mergeStates, changedPaths, units } from '../../site/app/calc/merge.js';
import { sanitiseState } from '../../site/app/calc/sanitise.js';
import { isDay, cleanDrops } from '../../site/app/calc/pitched.js';
import { cleanChampions } from '../../site/app/calc/champions.js';
import { comingUp } from '../../site/app/calc/upcoming.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const fl = load('flames');
const up = load('upgrades');
const gear = load('gear');
const upcoming = load('upcoming');
const base = { characters: [], checklist: {}, ui: {}, mesos: {}, pitch: {}, shops: {}, champions: { slots: [], raid: {} } };

test('cleared flame weights fall back to the defaults, never to zero', () => {
  assert.deepEqual(flameWeights(fl, null), fl.weights);
  assert.deepEqual(flameWeights(fl, undefined), fl.weights);
  assert.deepEqual(flameWeights(fl, { att: null, allstat: '', secondary: '0.5' }), fl.weights);
  assert.deepEqual(flameWeights(fl, { att: 0, allstat: 8 }), { ...fl.weights, att: 0, allstat: 8 });
  // The upgrade ranking gets the same weights after "Reset to the defaults" (weights: null).
  const g = { slots: { hat: { tier: 2, ilvl: 150, flame: { main: 60, att: 3, allstat: 4 } } } };
  const stats = { main: 40000, sub: 5000, att: 5000, mainPct: 300, attPct: 100 };
  assert.equal(flameOptions(gear, g, fl, 'STR', stats, null)[0].flameNow, 60 + 3 * fl.weights.att + 4 * fl.weights.allstat);
});

test('a typed flame can carry secondary stat, and a secondary equal to the main stat is ignored', () => {
  assert.equal(flameScore({ main: 60, sub: 40 }, fl.weights), 60 + 40 * fl.weights.secondary);
  const same = flameLines(fl, { level: 160, mainStat: 'LUK', secondary: 'LUK' });
  const dflt = flameLines(fl, { level: 160, mainStat: 'LUK' });
  assert.deepEqual(same, dflt);
  assert.equal(bestScore(scoreDist(fl, { level: 160, mainStat: 'LUK', secondary: 'LUK', type: 'black', advantaged: true })), 206.5);
  // Boss items always get four lines: the rule is in the data file.
  assert.deepEqual(fl.advantagedLineCount, [0, 0, 0, 1]);
});

test('Star Force: decimals are rounded down, and a run too long to simulate reports no spread', () => {
  const whole = starPlan(up.starforce, 160, 2, 12);
  const typed = starPlan(up.starforce, 160, 2.5, 12.9);
  assert.equal(typed.cost, whole.cost);
  assert.equal(typed.steps.length, 10);
  assert.equal(starPlan(up.starforce, 160, 'x', null).cost, 0);
  const t0 = Date.now();
  assert.equal(starSpread(up.starforce, 250, 22, 30, {}, 0, 2500), null);
  assert.ok(Date.now() - t0 < 1500, 'it gives up quickly');
  const ok = starSpread(up.starforce, 160, 15.7, 20, {}, 0, 500);
  assert.ok(ok && ok.p50 > 0 && ok.p95 >= ok.p90);
});

test('saved decimals and out-of-range cube odds are repaired on load', () => {
  const out = sanitiseState({ gear: { a: { slots: { hat: { tier: 2, stars: 2.5, ilvl: 150.9, target: { stars: 21.7 } } } } },
    mesos: { cubeRates: { bright: [0.15, 0.035, 0.012], glowing: [0.0000001, 0.5, 0.5], odd: 'x', three: [0.1, 2, 0.1] } } }, base);
  assert.equal(out.gear.a.slots.hat.stars, 2);
  assert.equal(out.gear.a.slots.hat.ilvl, 150);
  assert.equal(out.gear.a.slots.hat.target.stars, 21);
  assert.deepEqual(out.mesos.cubeRates, { bright: [0.15, 0.035, 0.012] });
  assert.equal('cubeRates' in sanitiseState({ mesos: { cubeRates: { bright: [9, 9, 9] } } }, base).mesos, false);
});

test('impossible dates are dropped from the drop log and the raid scores', () => {
  assert.equal(isDay('2026-11-24'), true);
  assert.equal(isDay('2024-02-29'), true);
  for (const bad of ['2026-13-45', '2026-02-31', '2026-00-10', '2026-1-1', '', null, 20261124]) assert.equal(isDay(bad), false, String(bad));
  assert.deepEqual(cleanDrops([{ id: 'a', item: 'berserked', d: '2026-13-45' }, { id: 'b', item: 'berserked', d: '2026-02-31' }, { id: 'c', item: 'berserked', d: '2026-11-01' }]).map((d) => d.id), ['c']);
  assert.deepEqual(cleanChampions({ raid: { '2026-13': 5, '2026-00': 5, '2026-12': 7 } }).raid, { '2026-12': 7 });
});

test('two devices editing drops, shop picks and Champions keep both sides', () => {
  const start = sanitiseState({
    characters: [{ id: 'c1', name: 'A' }],
    pitch: { c1: { drops: [{ id: 'old', item: 'magic-eyepatch', d: '2026-10-01' }] } },
    shops: { s1: { have: 100, claims: 2, want: { 'karma-solid-cube': 5 } } },
    champions: { slots: [{ name: 'A', rank: 1 }, { name: 'B', rank: 1 }], raid: {} }
  }, base);
  const edit = (at, fn) => {
    const next = structuredClone(start);
    fn(next);
    const stamps = {};
    for (const p of changedPaths(start, next)) stamps[p] = at;
    return { ...next, stamps, updatedAt: at };
  };
  // Device A: a rank change, a new drop, coins held, and it removes the old drop.
  const a = edit(100, (s) => {
    s.champions.slots[0].rank = 3;
    s.pitch.c1.drops.push({ id: 'da', item: 'berserked', d: '2026-11-20' });
    s.pitch.c1.drops = s.pitch.c1.drops.filter((d) => d.id !== 'old');
    s.shops.s1.have = 5000;
  });
  // Device B, before syncing: a raid score, another drop, a shop pick, and a third Champion.
  const b = edit(90, (s) => {
    s.champions.raid['2026-11'] = 1200000000;
    s.champions.slots.push({ name: 'C', rank: 0 });
    s.pitch.c1.drops.push({ id: 'db', item: 'dreamy-belt', d: '2026-11-21' });
    s.shops.s1.want['sol-erda'] = 3;
    s.shops.s1.claims = 4;
  });
  for (const m of [mergeStates(a, b, 1000), mergeStates(b, a, 1000)]) {
    assert.deepEqual(m.pitch.c1.drops.map((d) => d.id).sort(), ['da', 'db'], 'both new drops are kept and the removed one stays removed');
    assert.deepEqual(m.shops.s1, { have: 5000, claims: 4, want: { 'karma-solid-cube': 5, 'sol-erda': 3 } });
    assert.deepEqual(m.champions.slots, [{ name: 'A', rank: 3 }, { name: 'B', rank: 1 }, { name: 'C', rank: 0 }]);
    assert.deepEqual(m.champions.raid, { '2026-11': 1200000000 });
    // What comes out is still in the shape the pages expect.
    assert.deepEqual(sanitiseState(m, base).pitch, m.pitch);
  }
  // Each entry is its own part.
  const paths = [...units(start).keys()].filter((p) => /^(pitch|shops|champions)/.test(p)).sort();
  assert.deepEqual(paths, ['champions/slot/0', 'champions/slot/1', 'pitch/c1/old', 'shops/s1/claims', 'shops/s1/have', 'shops/s1/want/karma-solid-cube']);
  // Clearing a Champion on one device clears it on the other, without disturbing the rest.
  const cleared = edit(200, (s) => { s.champions.slots[1] = { name: '', rank: 0 }; });
  const merged = mergeStates(b, cleared, 1000);
  assert.deepEqual(merged.champions.slots, [{ name: 'A', rank: 1 }, { name: '', rank: 0 }, { name: 'C', rank: 0 }]);
});

test('a day-only announcement stays listed through its own day, and the shop deadline shows for every character', () => {
  const during = comingUp(upcoming, Date.parse('2026-12-16T00:30:00Z'), { challenger: true }, 20);
  const part2 = during.find((x) => x.id === 'part-2');
  assert.ok(part2, 'still listed at 09:30 KST on the day');
  assert.equal(part2.days, 0);
  assert.ok(!comingUp(upcoming, Date.parse('2026-12-17T00:30:00Z'), { challenger: true }, 20).some((x) => x.id === 'part-2'));
  const now = Date.parse('2026-11-24T00:00:00Z');
  assert.ok(comingUp(upcoming, now, { challenger: false }, 20).some((x) => x.id === 'season-end'));
  assert.ok(comingUp(upcoming, now, null, 20).some((x) => x.id === 'season-end'));
});
