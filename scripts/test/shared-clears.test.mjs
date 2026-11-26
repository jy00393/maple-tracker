// Difficulties of one boss with the same reset share one clear (bosses.json `sharedClear`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { characterLines, computeIncome, shareKey } from '../../site/app/calc/income.js';
import { resetWarnings } from '../../site/app/calc/reminders.js';
import { periodKey, fmtLeft } from '../../site/app/time.js';

const bosses = JSON.parse(readFileSync(new URL('../../site/data/bosses.json', import.meta.url), 'utf8'));
const bossById = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const char = { id: 'a', world: 'heroic', region: 'na' };
const now = Date.parse('2026-11-27T03:00:00Z'); // a Friday: day 2 of the crystal week
const day = periodKey('daily', now);
const week = periodKey('thu', now);
const lineOf = (lines, id) => lines.find((l) => l.bossId === id);
const run = (picks, clears) => characterLines(char, { picks, clears }, bosses, bossById, now);

test('the data names the rule and its source', () => {
  assert.deepEqual(bosses.sharedClear.by, ['boss', 'reset']);
  assert.ok(bosses.sharedClear.source && bosses.sharedClear.checked);
  assert.equal(shareKey(bossById['zakum-easy']), shareKey(bossById['zakum-normal']));
  assert.notEqual(shareKey(bossById['zakum-normal']), shareKey(bossById['zakum-chaos']));
});

test('a daily boss cleared on one difficulty is done on the other', () => {
  const picks = { 'zakum-easy': { party: 1 }, 'zakum-normal': { party: 1 }, 'zakum-chaos': { party: 1 } };
  const lines = run(picks, { 'zakum-easy': { [day]: true } });
  const easy = lineOf(lines, 'zakum-easy');
  const normal = lineOf(lines, 'zakum-normal');
  assert.equal(easy.clearedNow, true);
  assert.equal(easy.doneAs, null);
  assert.equal(normal.clearedNow, false);
  assert.equal(normal.doneAs, 'Easy');
  assert.equal(normal.cleared, 0);
  assert.deepEqual(normal.shared, ['zakum-easy']);
  // Chaos Zakum is a weekly clear of its own.
  assert.equal(lineOf(lines, 'zakum-chaos').doneAs, null);
  assert.deepEqual(lineOf(lines, 'zakum-chaos').shared, []);
});

test('a tick on a difficulty that is no longer picked still counts', () => {
  const lines = run({ 'lotus-hard': { party: 1 } }, { 'lotus-normal': { [week]: true } });
  assert.equal(lineOf(lines, 'lotus-hard').doneAs, 'Normal');
  assert.equal(lineOf(lines, 'lotus-hard').cleared, 0);
});

test('two difficulties ticked for one period: only the better crystal is earned', () => {
  const picks = { 'lotus-normal': { party: 1 }, 'lotus-hard': { party: 1 } };
  const clears = { 'lotus-normal': { [week]: true }, 'lotus-hard': { [week]: true } };
  const lines = run(picks, clears);
  assert.equal(lineOf(lines, 'lotus-hard').cleared, 1);
  assert.equal(lineOf(lines, 'lotus-normal').cleared, 0);
  assert.equal(lineOf(lines, 'lotus-normal').doneAs, 'Hard');
  const { perChar } = computeIncome([char], { bosses: { a: { picks, clears } } }, bosses, bossById, now);
  assert.equal(perChar.a.earned, bossById['lotus-hard'].price * 5);
});

test('two picks for one clear: only the better one is planned', () => {
  const picks = { 'lotus-normal': { party: 1 }, 'lotus-hard': { party: 1 }, 'zakum-easy': { party: 1 }, 'zakum-normal': { party: 1 } };
  const { perChar } = computeIncome([char], { bosses: { a: { picks, clears: {} } } }, bosses, bossById, now);
  assert.equal(perChar.a.planned, bossById['lotus-hard'].price * 5 + 7 * bossById['zakum-normal'].price * 5);
  assert.equal(perChar.a.weeklyPicked, 1);
  assert.equal(lineOf(perChar.a.lines, 'lotus-normal').spare, 'Hard');
  assert.equal(lineOf(perChar.a.lines, 'lotus-hard').spare, null);
  assert.equal(lineOf(perChar.a.lines, 'zakum-easy').planned, 0);
});

test('clearing the lower difficulty earns the lower crystal', () => {
  const picks = { 'lotus-normal': { party: 1 }, 'lotus-hard': { party: 1 } };
  const clears = { 'lotus-normal': { [week]: true } };
  const { perChar } = computeIncome([char], { bosses: { a: { picks, clears } } }, bosses, bossById, now);
  assert.equal(perChar.a.earned, bossById['lotus-normal'].price * 5);
  assert.equal(perChar.a.weeklyCleared, 1);
});

test('daily clears on different difficulties each count for their own day', () => {
  const yesterday = periodKey('daily', now - 86400000);
  const picks = { 'zakum-easy': { party: 1 }, 'zakum-normal': { party: 1 } };
  const lines = run(picks, { 'zakum-easy': { [yesterday]: true }, 'zakum-normal': { [day]: true } });
  assert.equal(lineOf(lines, 'zakum-easy').cleared, 1);
  assert.equal(lineOf(lines, 'zakum-normal').cleared, 1);
  assert.equal(lineOf(lines, 'zakum-easy').doneAs, 'Normal');
});

test('Black Mage: Hard and Extreme share the monthly clear', () => {
  const month = periodKey('monthly', now);
  const lines = run({ 'black-mage-hard': { party: 1 }, 'black-mage-extreme': { party: 1 } }, { 'black-mage-hard': { [month]: now } });
  assert.equal(lineOf(lines, 'black-mage-extreme').doneAs, 'Hard');
  assert.equal(lineOf(lines, 'black-mage-hard').cleared, 1);
  assert.equal(lineOf(lines, 'black-mage-hard').planned, 0);
});

test('reset warnings leave out a boss done on another difficulty and spare picks', () => {
  const late = Date.parse('2026-11-27T23:00:00Z');
  const picks = { 'zakum-easy': { party: 1 }, 'zakum-normal': { party: 1 } };
  const open = characterLines(char, { picks, clears: {} }, bosses, bossById, late);
  const w1 = resetWarnings({ groups: [] }, {}, open, late);
  assert.equal(w1[0].bosses.count, 1);
  const done = characterLines(char, { picks, clears: { 'zakum-easy': { [periodKey('daily', late)]: true } } }, bosses, bossById, late);
  assert.equal(resetWarnings({ groups: [] }, {}, done, late).length, 0);
});

test('the countdown text shows seconds only under an hour', () => {
  assert.equal(fmtLeft(29 * 60000 + 15000), '29m 15s');
  assert.equal(fmtLeft(3600000 + 60000), '1h 01m');
});
