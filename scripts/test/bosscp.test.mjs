// Boss suggestions from Combat Power: the game's solo entry minimums against what the character has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { minCpFor, reach, marginOf, suggestBosses, picksOutOfReach, fmtCp } from '../../site/app/calc/bosscp.js';
import { crystalValue } from '../../site/app/calc/income.js';
import { sanitiseState } from '../../site/app/calc/sanitise.js';
import { applySetup } from '../../site/app/calc/setup.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const bosses = load('bosses');
const cpData = load('bosscp');
const byId = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const heroic = { world: 'heroic' };

test('the combat power table matches the boss list and never asks less for a harder difficulty', () => {
  assert.ok(cpData.source.length > 40);
  for (const id of Object.keys(cpData.minCp)) assert.ok(byId[id], `${id} is a boss in bosses.json`);
  for (const v of Object.values(cpData.minCp)) assert.ok(Number.isInteger(v) && v >= 10000);
  const families = {};
  for (const b of bosses.bosses) if (minCpFor(cpData, b) !== null) (families[b.boss] = families[b.boss] || []).push(b);
  for (const [name, list] of Object.entries(families)) {
    const byPrice = list.slice().sort((a, b) => a.price - b.price);
    for (let i = 1; i < byPrice.length; i++) assert.ok(minCpFor(cpData, byPrice[i]) >= minCpFor(cpData, byPrice[i - 1]), name);
  }
  // Spot checks against the wiki table.
  assert.equal(minCpFor(cpData, byId['lucid-hard']), 18000000);
  assert.equal(minCpFor(cpData, byId['lotus-extreme']), 200000000);
  assert.equal(minCpFor(cpData, byId['kalos-the-guardian-easy']), 35000000);
  assert.equal(minCpFor(cpData, byId['zakum-chaos']), 300000);
  assert.equal(minCpFor(cpData, byId['mayrin-normal']), null); // not in the wiki's table
});

test('reach: enough, not enough, no figure, and nothing typed', () => {
  const lucid = byId['lucid-hard'];
  assert.equal(reach(cpData, lucid, 18000000), 'yes');
  assert.equal(reach(cpData, lucid, 17999999), 'no');
  assert.equal(reach(cpData, lucid, 30000000, 2), 'no'); // 2x room needs 36M
  assert.equal(reach(cpData, lucid, 36000000, 2), 'yes');
  assert.equal(reach(cpData, lucid, 0), 'nocp');
  assert.equal(reach(cpData, lucid, null), 'nocp');
  assert.equal(reach(cpData, byId['mayrin-normal'], 1e12), 'unknown');
  assert.equal(reach(null, lucid, 1e12), 'unknown');
  assert.equal(marginOf(cpData, 2), 2);
  assert.equal(marginOf(cpData, 7), 1);
  assert.equal(marginOf(cpData, undefined), 1);
  assert.equal(fmtCp(18000000), '18M');
  assert.equal(fmtCp(1500000), '1.5M');
  assert.equal(fmtCp(2500000000), '2.5B');
  assert.equal(fmtCp(300000), '300K');
  assert.equal(fmtCp(0), '—');
});

test('the suggested list is the best-paying difficulty of each boss within reach, capped at what sells', () => {
  const cap = bosses.limits.weeklyPerCharacter;
  assert.deepEqual(suggestBosses(bosses, cpData, 0, 1, heroic), { ids: [], total: 0, list: [], beyond: 0 });
  // 20M: Hard Lucid (18M) and Hard Will (20M) are in, Hard Verus Hilla (24M) is not, so its Normal mode is picked.
  const s = suggestBosses(bosses, cpData, 20000000, 1, heroic);
  assert.ok(s.ids.includes('lucid-hard') && s.ids.includes('will-hard'));
  assert.ok(s.ids.includes('verus-hilla-normal') && !s.ids.includes('verus-hilla-hard'));
  assert.ok(!s.ids.includes('lucid-normal') && !s.ids.includes('lucid-easy'), 'one difficulty per boss');
  assert.ok(s.ids.length <= cap);
  assert.equal(new Set(s.list.map((x) => x.boss.boss)).size, s.ids.length);
  assert.ok(s.list.every((x, i) => i === 0 || x.value <= s.list[i - 1].value), 'best value first');
  assert.equal(s.total, s.list.reduce((a, x) => a + x.value, 0));
  assert.equal(s.list[0].value, crystalValue(s.list[0].boss, heroic, bosses, 1));
  assert.ok(s.ids.every((id) => byId[id].reset === 'weekly' && !byId[id].noCrystal && minCpFor(cpData, byId[id]) <= 20000000));
  assert.ok(s.beyond > 0);
  // Asking for 2x room moves the line: Hard Lucid now needs 36M.
  const careful = suggestBosses(bosses, cpData, 20000000, 2, heroic);
  assert.ok(!careful.ids.includes('lucid-hard') && careful.ids.includes('lucid-normal'));
  assert.ok(careful.total < s.total);
  // More power never earns less, and enormous power picks the top difficulty of everything it can.
  let last = 0;
  for (const cp of [1e4, 1e5, 1e6, 5e6, 2e7, 1e8, 1e9, 1e10]) {
    const t = suggestBosses(bosses, cpData, cp, 1, heroic).total;
    assert.ok(t >= last, `total at ${cp}`);
    last = t;
  }
  const top = suggestBosses(bosses, cpData, 1e12, 1, heroic);
  assert.equal(top.ids.length, cap);
  assert.equal(top.beyond, 0);
  // Tiny power: only the bosses that ask for 10,000.
  assert.ok(suggestBosses(bosses, cpData, 10000, 1, heroic).ids.every((id) => minCpFor(cpData, byId[id]) === 10000));
  assert.deepEqual(suggestBosses(bosses, cpData, 9999, 1, heroic).ids, []);
});

test('picked bosses above your Combat Power are called out, but party picks are left alone', () => {
  const picks = { 'lucid-hard': { party: 1 }, 'will-hard': { party: 3 }, 'zakum-chaos': { party: 1 }, 'mayrin-normal': { party: 1 }, 'black-mage-hard': {} };
  assert.deepEqual(picksOutOfReach(bosses, cpData, picks, 5000000).map((b) => b.id).sort(), ['black-mage-hard', 'lucid-hard']);
  assert.deepEqual(picksOutOfReach(bosses, cpData, picks, 1e12), []);
  assert.deepEqual(picksOutOfReach(bosses, cpData, picks, 0), []);
  assert.deepEqual(picksOutOfReach(bosses, cpData, undefined, 5000000), []);
});

test('Combat Power is saved on the character and repaired when damaged', () => {
  const base = { characters: [], checklist: {}, ui: {}, mesos: {} };
  const clean = (cp) => sanitiseState({ characters: [{ id: 'a', name: 'A', cp }] }, base).characters[0];
  assert.equal(clean(45000000).cp, 45000000);
  assert.equal(clean(45000000.9).cp, 45000000);
  for (const bad of [null, 0, -5, 'x', NaN, 1e30]) assert.equal('cp' in clean(bad), false, String(bad));
  assert.equal('cp' in sanitiseState({ characters: [{ id: 'a', name: 'A' }] }, base).characters[0], false);
  const s = { characters: [], bosses: {}, level: {}, checklist: {} };
  applySetup(s, { name: 'New', cp: 12500000.4, level: 260 }, ['zakum-chaos'], 'id1', 1);
  assert.equal(s.characters[0].cp, 12500000);
  const t = { characters: [], bosses: {}, level: {}, checklist: {} };
  applySetup(t, { name: 'New' }, [], 'id2', 1);
  assert.equal('cp' in t.characters[0], false);
});
