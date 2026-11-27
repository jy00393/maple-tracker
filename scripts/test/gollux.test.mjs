// Gollux: a daily boss with no crystal, added by hand (the boss list comes from the crystal table).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { characterLines, computeIncome, shareKey, entryBlock } from '../../site/app/calc/income.js';
import { suggestBosses } from '../../site/app/calc/bosscp.js';
import { itemStatus } from '../../site/app/calc/checklist.js';
import { whoFor } from '../../site/app/pages/checklist.js';
import { periodKey } from '../../site/app/time.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const bosses = read('bosses');
const checklist = read('checklist');
const bossCp = read('bosscp');
const bossById = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const DATA = { checklist, bosses, bossById, upgrades: read('upgrades'), nexonCharacters: { characters: [] } };
const NOW = Date.parse('2026-11-27T03:00:00Z');
const day = periodKey('daily', NOW);
const main = { id: 'a', name: 'Main', level: 264, world: 'heroic', challenger: true };
const gollux = bosses.bosses.filter((b) => b.boss === 'Gollux');

test('Gollux has four difficulties, one daily clear, no crystal, and a source', () => {
  assert.deepEqual(gollux.map((b) => b.difficulty), ['Easy', 'Normal', 'Hard', 'Hell']);
  for (const b of gollux) {
    assert.equal(b.reset, 'daily');
    assert.equal(b.noCrystal, true);
    assert.equal(b.minLevel, 180);
    assert.match(b.note, /MapleStory Wiki, Gollux/);
    assert.equal(shareKey(b), shareKey(gollux[0]), 'all four share one clear');
  }
  assert.ok(bosses.noCrystalNote, 'the data says why bosses without a crystal can be missing');
  assert.equal(new Set(bosses.bosses.map((b) => b.id)).size, bosses.bosses.length, 'ids stay unique');
});

test('Hell Gollux can be picked and ticked, earns nothing, and blocks the other difficulties for the day', () => {
  const state = { picks: { 'gollux-hell': { party: 1 }, 'gollux-hard': { party: 1 }, 'lotus-hard': { party: 1 } }, clears: { 'gollux-hell': { [day]: true } } };
  const lines = characterLines(main, state, bosses, bossById, NOW);
  const hell = lines.find((l) => l.bossId === 'gollux-hell');
  const hard = lines.find((l) => l.bossId === 'gollux-hard');
  assert.equal(hell.clearedNow, true);
  assert.equal(hell.value, 0);
  assert.equal(hard.doneAs, 'Hell');
  const mine = computeIncome([main], { bosses: { a: state } }, bosses, bossById, NOW).perChar.a;
  assert.equal(mine.earned, 0);
  assert.equal(mine.weeklyPicked, 1, 'it takes no weekly crystal slot');
});

test('Gollux is open at Lv. 264, locked below Lv. 180, and never in the Combat Power suggestion', () => {
  assert.equal(entryBlock(bossById['gollux-hell'], main, 264), null);
  assert.ok(entryBlock(bossById['gollux-hell'], { ...main, level: 150 }, 150), 'locked below its level');
  const sug = suggestBosses(bosses, bossCp, 1e12, 1, main, []);
  assert.equal(sug.ids.some((id) => id.startsWith('gollux')), false);
});

test('the Checklist "Gollux" row is the same tick as Gollux on Bosses, on any difficulty', () => {
  const group = checklist.groups.find((g) => g.items.some((i) => i.id === 'd-gollux'));
  const item = group.items.find((i) => i.id === 'd-gollux');
  assert.deepEqual(item.boss, gollux.map((b) => b.id));
  const cs = { items: {}, resets: {}, flags: {}, history: {} };
  const state = (clears) => ({ characters: [main], level: {}, symbols: {}, bosses: { a: { picks: {}, clears } } });
  assert.equal(itemStatus(item, group, cs, NOW, whoFor(DATA, state({}), main)).done, false);
  assert.equal(itemStatus(item, group, cs, NOW, whoFor(DATA, state({ 'gollux-normal': { [day]: true } }), main)).done, true);
  // The next day it is open again.
  assert.equal(itemStatus(item, group, cs, NOW + 86400000, whoFor(DATA, state({ 'gollux-normal': { [day]: true } }), main)).done, false);
});
