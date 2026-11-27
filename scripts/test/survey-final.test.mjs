// Fixes from the independent re-check of the survey round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bountyWeek, bossCrests, weeklyPicks } from '../../site/app/calc/rewards.js';
import { mergeStates, stampEdit } from '../../site/app/calc/merge.js';
import { blankState } from '../../site/app/store.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const bosses = read('bosses');
const bounty = read('bounty');
const ibp = read('ibp');
const checklist = read('checklist');
const bossById = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const solo = (...ids) => ({ picks: Object.fromEntries(ids.map((id) => [id, { party: 1 }])), clears: {} });

test('coins and crests never count a boss the character cannot enter yet', () => {
  const st = solo('first-adversary-easy', 'chosen-seren-normal', 'lucid-hard');
  const main = { level: 264, challenger: true };
  const open = weeklyPicks(st, bossById, main);
  assert.deepEqual(open.locked.map((b) => b.id), ['first-adversary-easy']);
  const week = bountyWeek(bounty, [st], bossById, [main]);
  assert.notEqual(week.best.intermediate && week.best.intermediate.id, 'first-adversary-easy');
  const later = bountyWeek(bounty, [st], bossById, [{ level: 275, challenger: true }]);
  assert.ok(later.intermediate >= week.intermediate, 'it counts once the level is reached');
  // Without a character, nothing is locked (an unknown level never locks).
  assert.equal(weeklyPicks(st, bossById).locked.length, 0);
  const crests = bossCrests(ibp, solo('lucid-hard', 'kalos-the-guardian-easy'), bossById, main);
  assert.ok(crests.rows.every((r) => r.boss.id !== 'kalos-the-guardian-easy'));
});

test('Etherion banks completions, so it is optional and never in a reset warning', () => {
  const item = checklist.groups.flatMap((g) => g.items).find((i) => i.id === 'w-etherion');
  assert.equal(item.optional, true);
});

test('syncing with a device that never had the character keeps each part\'s own change time', () => {
  const base = blankState();
  base.characters = [{ id: 'a', name: 'Main', level: 264 }];
  base.activeId = 'a';
  const t0 = Date.parse('2026-11-10T03:00:00Z');
  const a = structuredClone(base);
  a.ibp = { a: { done: {}, crests: 900 } };
  a.stamps = {};
  stampEdit(a.stamps, blankState(), a, t0);
  const later = Date.parse('2026-11-20T03:00:00Z');
  const a2 = structuredClone(a);
  a2.characters[0].level = 266;
  stampEdit(a2.stamps, a, a2, later);
  const empty = blankState();
  for (const m of [mergeStates(a2, empty, later + 1000), mergeStates(empty, a2, later + 1000)]) {
    const ibpStamps = Object.entries(m.stamps).filter(([k]) => k.startsWith('ibp/'));
    assert.ok(ibpStamps.length > 0);
    for (const [, v] of ibpStamps) assert.ok(v < later, 'the crests keep the day they were typed');
  }
});

test('a page that came from the network does not race its files against the timer', () => {
  const sw = readFileSync(new URL('../../site/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /freshPages\.set\(pageId/);
  assert.match(sw, /isFresh\(pageId\)/);
});
