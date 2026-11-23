import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { periodKey, nextReset, fmtKst, weekStart } from '../../site/app/time.js';
import { computeIncome, crystalValue, fmtMesos } from '../../site/app/calc/income.js';
import { symbolPlan, liberationPlan, gearSummary, erdaNextSteps, gearProjection } from '../../site/app/calc/progress.js';
import { dedupeEvents } from '../../site/app/calc/events.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const bosses = load('bosses');
const bossById = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const symbols = load('symbols');
const liberation = load('liberation');
const gear = load('gear');
const erda = load('erda');

test('reset keys and next resets', () => {
  const mon = Date.parse('2026-11-23T03:00:00Z');
  assert.equal(periodKey('daily', mon), 'daily:2026-11-23');
  assert.equal(periodKey('thu', mon), 'thu:2026-11-19');
  assert.equal(periodKey('wed', mon), 'wed:2026-11-18');
  assert.equal(periodKey('mon', mon), 'mon:2026-11-23');
  assert.equal(periodKey('monthly', mon), 'monthly:2026-11');
  assert.equal(new Date(nextReset('thu', mon)).toISOString(), '2026-11-26T00:00:00.000Z');
  assert.equal(new Date(nextReset('wed', mon)).toISOString(), '2026-11-25T00:00:00.000Z');
  assert.equal(new Date(nextReset('monthly', mon)).toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(fmtKst(Date.parse('2026-11-24T23:59:00Z')), 'Wed 25 Nov, 08:59 KST');
  assert.equal(new Date(weekStart(Date.parse('2026-11-26T00:00:00Z'), 4)).toISOString(), '2026-11-26T00:00:00.000Z');
});

test('Heroic crystal values are five times the table and split by party', () => {
  const heroic = { world: 'heroic' };
  assert.equal(crystalValue(bossById['lucid-hard'], heroic, bosses), 504000000);
  assert.equal(crystalValue(bossById['cygnus-normal'], heroic, bosses), 14450000);
  assert.equal(crystalValue(bossById['lucid-hard'], { world: 'interactive' }, bosses), 100800000);
  assert.equal(crystalValue(bossById['lucid-hard'], heroic, bosses, 2), 252000000);
  assert.equal(crystalValue(bossById['mayrin-normal'], heroic, bosses), 0);
  assert.equal(crystalValue(bossById['lucid-hard'], { world: 'heroic', quanah: true }, bosses), 0);
});

test('only the 14 best weekly crystals count', () => {
  const now = Date.parse('2026-11-23T03:00:00Z');
  const weekly = bosses.bosses.filter((b) => b.reset === 'weekly' && !b.noCrystal).slice(0, 16);
  const picks = Object.fromEntries(weekly.map((b) => [b.id, { party: 1 }]));
  const clears = Object.fromEntries(weekly.map((b) => [b.id, { [periodKey('thu', now)]: true }]));
  const char = { id: 'a', world: 'heroic', region: 'na', challenger: true };
  const state = { bosses: { a: { picks, clears } } };
  const { perChar, worlds } = computeIncome([char], state, bosses, bossById, now);
  const values = weekly.map((b) => b.price * 5).sort((x, y) => y - x).slice(0, 14);
  assert.equal(perChar.a.earned, values.reduce((s, v) => s + v, 0));
  assert.equal(perChar.a.overCap, 2);
  assert.equal(worlds[0].earnedCount, 14);
});

test('daily boss clears count across the crystal week', () => {
  const now = Date.parse('2026-11-23T03:00:00Z'); // Monday; crystal week started Thursday 19 Nov
  const clears = { 'cygnus-normal': { 'daily:2026-11-19': true, 'daily:2026-11-22': true, 'daily:2026-11-23': true, 'daily:2026-11-18': true } };
  const state = { bosses: { a: { picks: { 'cygnus-normal': { party: 1 } }, clears } } };
  const { perChar } = computeIncome([{ id: 'a', world: 'heroic' }], state, bosses, bossById, now);
  assert.equal(perChar.a.earned, 3 * 14450000);
  assert.equal(perChar.a.planned, 7 * 14450000);
});

test('symbol plans', () => {
  const cernium = symbols.sacred.areas.find((a) => a.id === 'cernium');
  const p = symbolPlan(symbols.sacred, cernium, { level: 5, have: 100 });
  assert.equal(p.needNext, 325);
  assert.equal(p.daysToNext, Math.ceil(225 / 30));
  assert.equal(p.power, 50);
  assert.equal(p.nextMesos, 331500000);
  assert.equal(p.remainingMesos, 331500000 + 426200000 + 522900000 + 618200000 + 709000000 + 792000000);
  const max = symbolPlan(symbols.sacred, cernium, { level: 11 });
  assert.equal(max.maxed, true);
  const vj = symbols.arcane.areas.find((a) => a.id === 'vj');
  assert.equal(symbolPlan(symbols.arcane, vj, { level: 20 }).power, 220);
  const ready = symbolPlan(symbols.arcane, vj, { level: 12, have: 400 });
  assert.equal(ready.affordable, 2); // 155 + 180 = 335 <= 400 < 335 + 207
});

test('liberation plan with and without the Genesis Pass', () => {
  const now = Date.parse('2026-11-23T00:00:00Z');
  const plain = liberationPlan(liberation.genesis, { stage: 0, traces: 0, picks: { 'lotus-normal': true, 'damien-normal': true, 'lucid-easy': true, 'will-easy': true } }, now);
  assert.equal(plain.remaining, 6500);
  assert.equal(plain.perWeek, 50);
  assert.equal(plain.weeks, 130);
  const pass = liberationPlan(liberation.genesis, { stage: 0, traces: 0, pass: true, picks: { 'lotus-normal': true, 'damien-normal': true, 'lucid-easy': true, 'will-easy': true } }, now);
  assert.equal(pass.weeks, Math.ceil(6500 / 150));
});

test('gear summary weights and gaps', () => {
  const empty = gearSummary(gear, {});
  assert.ok(empty.overall < 0.2);
  const slots = {};
  for (const s of gear.slots) slots[s.id] = { tier: 5, stars: 30, pot: 4, lines: 3, bpot: 4 };
  const full = gearSummary(gear, { preset: 'end', slots });
  assert.equal(Math.round(full.overall * 1000) / 1000, 1);
  assert.equal(full.gaps.length, 0);
  const proj = gearProjection([{ d: '2026-11-01', pct: 0.2 }, { d: '2026-11-15', pct: 0.3 }], 0.3, Date.parse('2026-11-15T00:00:00Z'));
  assert.equal(Math.round(proj.perWeek * 1000) / 1000, 0.05);
});

test('Erda Link next steps follow the order', () => {
  const t = erda.templates.erel;
  assert.match(erdaNextSteps(t, {}, 1)[0].label, /Shinestone 3/);
  const next = erdaNextSteps(t, { steps: { shinestone3: true }, levels: { lugh: 10 } }, 1)[0];
  assert.match(next.label, /Origin Stone/);
});

test('meso formatting', () => {
  assert.equal(fmtMesos(4400000000), '4.4B');
  assert.equal(fmtMesos(14450000), '14.45M');
  assert.equal(fmtMesos(504000000), '504M');
  assert.equal(fmtMesos(500000000), '500M');
  assert.equal(fmtMesos(81000000), '81M');
});

test('events repeated in patch notes collapse into the dedicated post', () => {
  const win = { start: '2026-11-11T00:00:00.000Z', end: '2026-11-24T23:59:00.000Z' };
  const ev = (postId, title, category, liveDate) => ({ ...win, id: postId + '-x', title, category, liveDate, postId, postName: 'Post ' + postId, url: 'u' + postId, resets: [] });
  const out = dedupeEvents([
    ev(47132, 'Winter Countdown', 'update', '2026-11-10T15:30:00Z'),
    ev(45393, 'Winter Countdown Event', 'events', '2026-10-06T17:00:30Z'),
    ev(44597, 'Winter Countdown', 'update', '2026-09-08T18:00:00Z'),
    { ...ev(47555, 'Lucky Box', 'sale', '2026-11-22T16:00:00Z'), end: '2026-11-24T07:59:00.000Z' }
  ]);
  assert.equal(out.length, 2);
  const wc = out.find((e) => /Winter/.test(e.title));
  assert.equal(wc.postId, 45393);
  assert.deepEqual(wc.alsoIn.map((p) => p.postId).sort(), [44597, 47132]);
});
