// Flame calculator, coin shop planner and pitched drop log: the maths and the data files behind them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bandValue, flameLines, scoreDist, chanceAtLeast, flamesNeeded, chanceWithin, flameScore, flameWeights, bestScore, flamesSupported } from '../../site/app/calc/flames.js';
import { shopItems, shopPlan, coinsToCome, itemCap, limitText } from '../../site/app/calc/shops.js';
import { cleanDrops, pitchedSummary, kstDay } from '../../site/app/calc/pitched.js';
import { sanitiseState } from '../../site/app/calc/sanitise.js';
import { mergeStates } from '../../site/app/calc/merge.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const fl = load('flames');
const shops = load('shops');
const pitched = load('pitched');
const near = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} is not ${b}`);

test('flame data: odds add up and every table has a source', () => {
  for (const file of [fl, shops, pitched]) assert.ok(file.source && file.source.length > 30);
  for (const t of fl.types) near(t.odds.reduce((a, b) => a + b, 0), 1);
  near(fl.lineCount.reduce((a, b) => a + b, 0), 1);
  assert.equal(fl.armourLines.length, 19);
  assert.equal(new Set(fl.armourLines).size, 19);
});

test('flame values follow the item level bands', () => {
  assert.equal(bandValue(fl.single, 150), 8);
  assert.equal(bandValue(fl.single, 200), 11);
  assert.equal(bandValue(fl.single, 229), 11);
  assert.equal(bandValue(fl.single, 230), 12);
  assert.equal(bandValue(fl.double, 160), 5);
  assert.equal(bandValue(fl.double, 249), 6);
  assert.equal(bandValue(fl.double, 250), 7);
  // Low-level items cannot roll ATT, Magic ATT or All Stats %.
  assert.equal(flameLines(fl, { level: 50, mainStat: 'STR' }).length, 16);
  assert.equal(flameLines(fl, { level: 65, mainStat: 'STR' }).length, 18);
  assert.equal(flameLines(fl, { level: 160, mainStat: 'STR' }).length, 19);
});

test('flame score chances always add up to 1', () => {
  for (const type of fl.types) {
    for (const advantaged of [true, false]) {
      for (const mainStat of ['STR', 'INT', 'XENON']) {
        for (const level of [10, 65, 160, 250]) {
          const dist = scoreDist(fl, { level, mainStat, type: type.id, advantaged });
          near(dist.reduce((a, [, p]) => a + p, 0), 1, 1e-9);
          near(chanceAtLeast(dist, 0), 1, 1e-9);
          assert.ok(dist.every(([s], i) => i === 0 || s > dist[i - 1][0]), 'scores are sorted');
        }
      }
    }
  }
});

test('the flame chance matches counting every mix of four lines by hand', () => {
  const opts = { level: 160, mainStat: 'STR', type: 'black', advantaged: true };
  const lines = flameLines(fl, opts);
  const odds = fl.types.find((t) => t.id === 'black').odds.map((p, i) => [i + 1 + fl.advantageShift, p]).filter(([, p]) => p > 0);
  const counted = new Map();
  let sets = 0;
  for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) for (let c = b + 1; c < lines.length; c++) for (let d = c + 1; d < lines.length; d++) {
    sets++;
    for (const [ta, pa] of odds) for (const [tb, pb] of odds) for (const [tc, pc] of odds) for (const [td, pd] of odds) {
      const score = Math.round((lines[a].per * ta + lines[b].per * tb + lines[c].per * tc + lines[d].per * td) * 100);
      counted.set(score, (counted.get(score) || 0) + pa * pb * pc * pd);
    }
  }
  assert.equal(sets, 3876);
  const dist = scoreDist(fl, opts);
  assert.equal(dist.length, counted.size);
  for (const [score, p] of dist) near(p, counted.get(Math.round(score * 100)) / sets, 1e-9);
  // Best flame at level 160 for STR: All Stats 7% (70), STR 63, STR+DEX 38.5 and one of STR+INT / STR+LUK (35), all tier 7.
  assert.equal(bestScore(dist), 206.5);
  near(chanceAtLeast(dist, 206.5), (2 / 3876) * 0.01 ** 4, 1e-6);
  assert.equal(flamesNeeded(chanceAtLeast(dist, 207)), null);
});

test('flames without the boss advantage roll one to four lines at lower tiers', () => {
  const adv = scoreDist(fl, { level: 160, mainStat: 'STR', type: 'black', advantaged: true });
  const plain = scoreDist(fl, { level: 160, mainStat: 'STR', type: 'black', advantaged: false });
  assert.ok(chanceAtLeast(plain, 80) < chanceAtLeast(adv, 80));
  // A score of 0 means every line rolled is one of the 10 worth nothing to a STR character
  // (INT, LUK, INT+LUK, HP, MP, level, DEF, Magic ATT, speed, jump).
  const zeroLines = flameLines(fl, { level: 160, mainStat: 'STR' }).filter((l) => l.per === 0).length;
  assert.equal(zeroLines, 10);
  const pZero = plain.find(([s]) => s === 0)[1];
  const expected = [1, 2, 3, 4].reduce((sum, k) => {
    let ways = 1;
    for (let i = 0; i < k; i++) ways *= (zeroLines - i) / (19 - i);
    return sum + fl.lineCount[k - 1] * ways;
  }, 0);
  near(pZero, expected, 1e-9);
  // Abyssal flames beat Black flames, which beat Burning flames.
  const at = (type) => chanceAtLeast(scoreDist(fl, { level: 200, mainStat: 'LUK', type, advantaged: true }), 120);
  assert.ok(at('abyssal') > at('black') && at('black') > at('burning'));
  near(at('reset'), at('black'));
});

test('flames needed, weights and the typed flame score', () => {
  const n = flamesNeeded(0.5);
  assert.deepEqual([n.expected, n.p50, n.p75, n.p90, n.p95], [2, 1, 2, 4, 5]);
  assert.equal(flamesNeeded(1).p95, 1);
  assert.equal(flamesNeeded(0), null);
  near(chanceWithin(0.5, 3), 0.875);
  assert.equal(chanceWithin(0.5, 0), 0);
  assert.deepEqual(flameWeights(fl, { att: 3, allstat: 'x', secondary: -1 }), { att: 3, allstat: fl.weights.allstat, secondary: fl.weights.secondary });
  assert.equal(flameScore({ main: 63, att: 5, allstat: 6 }, fl.weights), 63 + 5 * fl.weights.att + 6 * fl.weights.allstat);
  assert.equal(flameScore(null, fl.weights), 0);
  assert.equal(flamesSupported('HP'), false);
  // INT characters count Magic ATT, not ATT; the chances mirror a STR character's.
  const int = flameLines(fl, { level: 160, mainStat: 'INT' });
  assert.equal(int.find((l) => l.id === 'MATT').per, fl.weights.att);
  assert.equal(int.find((l) => l.id === 'ATT').per, 0);
  // Xenon counts STR, DEX and LUK in full.
  const xen = flameLines(fl, { level: 160, mainStat: 'XENON' });
  assert.equal(xen.find((l) => l.id === 'DEX+LUK').per, 10);
  assert.equal(xen.find((l) => l.id === 'INT').per, 0);
});

test('coin shop: items, limits and what you can still earn', () => {
  const shop = shops.shops[0];
  const ids = shop.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of shop.items) assert.ok(item.cost > 0 && item.limit > 0 && item.name, item.id);
  assert.equal(shop.items.length, 30);
  const heroic = shopItems(shop, { world: 'heroic' });
  const inter = shopItems(shop, { world: 'interactive' });
  assert.ok(heroic.some((i) => i.id === 'black-rebirth-flame') && !inter.some((i) => i.id === 'black-rebirth-flame'));
  assert.ok(!heroic.some((i) => i.only === 'interactive'));
  assert.equal(heroic.length, 23);
  assert.equal(itemCap(shop.items.find((i) => i.id === 'infinite-revitalizer')), undefined);
  assert.equal(limitText(shop.items.find((i) => i.id === 'infinite-revitalizer')), '5 a day');
  assert.equal(limitText(shop.items.find((i) => i.id === 'mysterious-monsterbloom')), '40 per world');
  const t = (iso) => Date.parse(iso);
  assert.equal(coinsToCome(shop, 0, t('2026-11-24T00:00:00Z')), 48000);
  assert.equal(coinsToCome(shop, 10, t('2026-11-24T00:00:00Z')), 40000);
  assert.equal(coinsToCome(shop, 10, t('2027-01-31T00:00:00Z')), 8000); // 10 days left: two weeks of 5 claims
  assert.equal(coinsToCome(shop, 60, t('2026-11-24T00:00:00Z')), 0);
  assert.equal(coinsToCome(shop, 0, t('2027-02-10T00:00:00Z')), 0);
});

test('coin shop plan: short, left over, and limits respected', () => {
  const shop = shops.shops[0];
  const now = Date.parse('2026-11-24T00:00:00Z');
  const char = { world: 'heroic', challenger: true };
  const plan = shopPlan(shop, { have: 5000, claims: 10, want: { 'sol-erda': 9, 'black-rebirth-flame': 200, 'innocence-scroll': 20, nonsense: 4 } }, char, now);
  // Sol Erda is capped at 3; the Interactive-only scroll and the unknown id cost nothing.
  assert.equal(plan.need, 3 * 8000 + 200 * 10);
  assert.equal(plan.total, 5000 + 40000);
  assert.equal(plan.spare, 45000 - 26000);
  assert.equal(plan.short, 0);
  assert.equal(plan.picked, 2);
  assert.equal(plan.daysLeft, 78);
  const greedy = shopPlan(shop, { have: 0, claims: 60, want: { 'growth-potion-200-259': 1, 'sol-erda': 3 } }, char, now);
  assert.equal(greedy.short, 34000);
  const empty = shopPlan(shop, undefined, null, now);
  assert.equal(empty.need, 0);
  assert.equal(empty.total, 48000);
  assert.equal(shopPlan(shop, { have: 100 }, char, Date.parse('2027-03-01T00:00:00Z')).open, false);
});

test('pitched drops: summary, bad entries and the Korean date', () => {
  const all = pitched.sets.flatMap((s) => s.items.map((i) => i.id));
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(pitched.sets.map((s) => s.items.length), [11, 6]);
  const saved = { drops: [{ id: 'a', item: 'dreamy-belt', d: '2026-10-03' }, { id: 'b', item: 'berserked', d: '2026-09-19' }, { id: 'c', item: 'dreamy-belt', d: '2026-11-01' },
    { id: 'd', item: 'made-up', d: '2026-11-02' }, { item: 'berserked', d: 'yesterday' }, null, 'x', { item: 5, d: '2026-01-01' }] };
  const sum = pitchedSummary(pitched, saved);
  assert.equal(sum.sets[0].owned, 2);
  assert.equal(sum.sets[1].owned, 0);
  assert.equal(sum.count, 3);
  assert.equal(sum.latest.id, 'c');
  assert.deepEqual(sum.sets[0].items.find((r) => r.item.id === 'dreamy-belt').drops.map((d) => d.d), ['2026-10-03', '2026-11-01']);
  assert.equal(cleanDrops(saved.drops).length, 4);
  assert.equal(pitchedSummary(pitched, undefined).count, 0);
  assert.equal(kstDay(Date.parse('2026-11-24T14:59:00Z')), '2026-11-24');
  assert.equal(kstDay(Date.parse('2026-11-24T15:00:00Z')), '2026-11-25');
});

test('drops and shop picks survive loading, are repaired when damaged, and merge per character and per shop', () => {
  const base = { characters: [], checklist: {}, ui: {}, mesos: {}, pitch: {}, shops: {} };
  const good = { characters: [{ id: 'a', name: 'A' }], pitch: { a: { drops: [{ id: 'x', item: 'berserked', d: '2026-11-01' }] } }, shops: { 'alliance-credit': { have: 1200, claims: 3, want: { 'sol-erda': 2 } } } };
  const out = sanitiseState(good, base);
  assert.deepEqual(out.pitch, good.pitch);
  assert.deepEqual(out.shops, good.shops);
  const bad = sanitiseState({ pitch: { a: { drops: 'no' }, b: 7 }, shops: { s: { have: -5, claims: 'x', want: { a: 2.7, b: -1, c: 'q' } }, t: null } }, base);
  assert.deepEqual(bad.pitch, { a: { drops: [] } });
  assert.deepEqual(bad.shops, { s: { have: 0, claims: 0, want: { a: 2 } } });
  assert.deepEqual(sanitiseState({}, base).pitch, {});
  // Two devices: a drop logged on one and a shop pick made on the other both survive.
  const pc = { ...good, updatedAt: 100, stamps: { 'pitch/a': 100, 'shops/alliance-credit': 50, 'characters/a': 10 } };
  const phone = { characters: good.characters, pitch: {}, shops: { 'alliance-credit': { have: 9000, claims: 5, want: {} } }, updatedAt: 90, stamps: { 'shops/alliance-credit': 90, 'characters/a': 10 } };
  for (const merged of [mergeStates(pc, phone, 1000), mergeStates(phone, pc, 1000)]) {
    assert.equal(merged.pitch.a.drops.length, 1);
    assert.equal(merged.shops['alliance-credit'].have, 9000);
  }
});
