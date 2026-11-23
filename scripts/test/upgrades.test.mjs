import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { baseCost, attempt, starPlan, starSpread, restoreStar, maxStarsFor } from '../../site/app/calc/starforce.js';
import { cubePlan, lineOptions, defaultValue, usefulLines, lineTotals, expToReach, expBetween, expRate, erdaCost } from '../../site/app/calc/upgrades.js';

const up = JSON.parse(readFileSync(new URL('../../site/data/upgrades.json', import.meta.url), 'utf8'));
const gear = JSON.parse(readFileSync(new URL('../../site/data/gear.json', import.meta.url), 'utf8'));
const sf = up.starforce;
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);
const slot = (id) => gear.slots.find((s) => s.id === id);

test('Star Force cost matches the wiki formula and worked examples', () => {
  assert.equal(baseCost(sf, 160, 0), 164800);
  assert.equal(baseCost(sf, 200, 0), 321000);
  near(baseCost(sf, 200, 18), 324.06e6, 0.4e6);
  near(baseCost(sf, 160, 21), 138.04e6, 0.2e6);
  near(attempt(sf, 200, 18, { discount: true }).cost, 226.8e6, 0.3e6);
});

test('Star Catch bonus is folded in and Sunny Sunday cuts destruction', () => {
  const a = attempt(sf, 160, 17);
  near(a.success, 0.1575, 1e-9);
  near(a.destroy, 0.0674, 0.0001);
  near(attempt(sf, 200, 18, { lessBoom: true }).destroy, 0.0472, 0.0001);
  assert.equal(attempt(sf, 160, 22, { lessBoom: true }).destroy, attempt(sf, 160, 22).destroy);
  const g = attempt(sf, 160, 16, { safeguard: true });
  assert.equal(g.destroy, 0);
  assert.equal(g.cost, g.base * 3);
});

test('restore stars, max stars and plans', () => {
  assert.equal(restoreStar(sf, 17), 12);
  assert.equal(restoreStar(sf, 21), 17);
  assert.equal(maxStarsFor(sf, 120), 15);
  assert.equal(maxStarsFor(sf, 160), 30);
  const safe = starPlan(sf, 160, 0, 15);
  assert.equal(safe.booms, 0);
  assert.equal(safe.noBoom, 1);
  const risky = starPlan(sf, 160, 17, 22);
  assert.ok(risky.cost > 1e9 && risky.cost < 2e10, String(risky.cost));
  assert.ok(risky.booms > 0.3 && risky.noBoom < 0.8);
  const spread = starSpread(sf, 160, 17, 22, {}, 0, 1500);
  assert.ok(spread.p50 < risky.cost * 1.3 && spread.p90 > spread.p50);
  assert.ok(starPlan(sf, 160, 17, 22, { discount: true, lessBoom: true }).cost < risky.cost);
});

test('cube tier-up expectations', () => {
  const b = cubePlan(up.cubes.types.bright, 3, 4);
  near(b.expected, 20, 1e-9);
  near(b.cost, 440e6, 1);
  assert.equal(b.n90, 45);
  const g = cubePlan(up.cubes.types.glowing, 3, 4);
  near(g.cost, 480e6, 1);
  const path = cubePlan(up.cubes.types.bright, 1, 4);
  assert.ok(path.n90 > path.expected);
});

test('potential lines per slot', () => {
  assert.ok(lineOptions(slot('ring1'), 4).includes('meso'));
  assert.ok(lineOptions(slot('ring1'), 4).includes('drop'));
  assert.ok(!lineOptions(slot('ring1'), 3).includes('meso'));
  assert.ok(!lineOptions(slot('belt'), 4).includes('meso'));
  assert.ok(lineOptions(slot('gloves'), 4).includes('critdmg'));
  assert.ok(lineOptions(slot('hat'), 4).includes('cdr'));
  assert.ok(lineOptions(slot('weapon'), 4).includes('boss'));
  assert.ok(!lineOptions(slot('emblem'), 4).includes('boss'));
  assert.deepEqual(lineOptions(slot('pocket'), 4), []);
  assert.equal(defaultValue(up, 'main', 4, 120), 12);
  assert.equal(defaultValue(up, 'allstat', 4, 120), 9);
  assert.equal(defaultValue(up, 'main', 4, 160), 13);
  const entry = { tier: 1, pot: 4, potLines: [{ type: 'meso', value: 20 }, { type: 'drop', value: 20 }, { type: 'hp', value: 12 }] };
  assert.equal(usefulLines(slot('ring1'), entry), 2);
  const totals = lineTotals(gear.slots, { slots: { ring1: entry, hat: { tier: 1, potLines: [{ type: 'main', stat: 'STR', value: 13 }, { type: 'allstat', value: 10 }] } } });
  assert.equal(totals.meso, 20);
  assert.equal(totals.main, 23);
});

test('EXP with Beyond Burning skips every other level', () => {
  const exp = up.exp;
  const e = (l) => exp.toNext[l - exp.from];
  assert.equal(expToReach(exp, 264, 0, 265, true), e(264));
  assert.equal(expToReach(exp, 264, 0, 270, true), e(264) + e(266) + e(268));
  assert.equal(expToReach(exp, 264, 0, 270, false), e(264) + e(265) + e(266) + e(267) + e(268) + e(269));
  near(expBetween(exp, { level: 264, frac: 0.5 }, { level: 266, frac: 0.1 }, true), 0.5 * e(264) + 0.1 * e(266), 1);
  const now = Date.parse('2026-11-23T00:00:00Z');
  const rate = expRate(exp, [{ t: now - 4 * 86400000, level: 264, frac: 0.2 }, { t: now, level: 264, frac: 0.6 }], true, 14, now);
  near(rate.perDay, (0.4 * e(264)) / 4, 1);
});

test('Sol Erda cost from the Origin table', () => {
  assert.deepEqual(erdaCost(up.erda.originPerLevel, 1, 10), { sol: 25, frag: 580 });
  assert.deepEqual(erdaCost(up.erda.originPerLevel, 1, 30), { sol: 145, frag: 4400 });
});

test('a plan starting above a restore point still resolves', () => {
  const p = starPlan(sf, 160, 21, 22);
  assert.ok(Number.isFinite(p.cost) && p.cost > 0);
  assert.ok(p.booms > 0);
});
