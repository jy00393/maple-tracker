// Flame rerolls in the upgrade ranking, the cost spread, Legion Champions, EXP sources and upcoming content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flameOptions, upgradeOptions, bestUpgrade } from '../../site/app/calc/advice.js';
import { scoreDist, flameScore } from '../../site/app/calc/flames.js';
import { damageGain } from '../../site/app/calc/gearstats.js';
import { cubePlan } from '../../site/app/calc/upgrades.js';
import { starSpread } from '../../site/app/calc/starforce.js';
import { championSummary, cleanChampions, insigniaLabel, raidMonth } from '../../site/app/calc/champions.js';
import { expSourcesAt } from '../../site/app/calc/expsources.js';
import { expToNext } from '../../site/app/calc/upgrades.js';
import { comingUp } from '../../site/app/calc/upcoming.js';
import { sanitiseState } from '../../site/app/calc/sanitise.js';
import { mergeStates } from '../../site/app/calc/merge.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const gear = load('gear');
const up = load('upgrades');
const gearStats = load('gearstats');
const fl = load('flames');
const ch = load('champions');
const src = load('expsources');
const upcoming = load('upcoming');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} is not ${b}`);
const stats = { main: 40000, sub: 5000, att: 5000, mainPct: 300, attPct: 100 };

test('flame rerolls are ranked: cost to beat the current flame and the damage it adds', () => {
  const g = { preset: 'mid', slots: {
    hat: { tier: 2, ilvl: 150, stars: 22, pot: 4, flame: { main: 80, allstat: 5 } },
    top: { tier: 2, ilvl: 150, stars: 22, pot: 4 }, // no flame typed in: not ranked
    gloves: { tier: 2, ilvl: 150, flame: { main: 10 }, temporary: true },
    weapon: { tier: 2, ilvl: 150, flame: { att: 50 } },
    ring1: { tier: 2, ilvl: 150, flame: { main: 30 } },
    cape: { tier: 2, ilvl: 150, flame: { main: 9999 } } // nothing can beat it
  } };
  const opts = flameOptions(gear, g, fl, 'STR', stats);
  assert.deepEqual(opts.map((o) => o.slotId), ['hat']);
  const o = opts[0];
  const now = flameScore(g.slots.hat.flame, fl.weights);
  assert.equal(now, 130);
  const dist = scoreDist(fl, { level: 150, mainStat: 'STR', type: 'reset', advantaged: true });
  const chance = dist.filter(([s]) => s > now).reduce((a, [, p]) => a + p, 0);
  const mean = dist.filter(([s]) => s > now).reduce((a, [s, p]) => a + p * s, 0) / chance;
  near(o.chance, chance);
  near(o.cost, 3000000 / chance);
  near(o.flameGain, mean - now);
  near(o.dmg, damageGain(stats, { main: mean - now }));
  assert.ok(o.cost90 > o.cost);
  // Without the boss advantage a better flame is rarer, so the same reroll costs more.
  const plain = flameOptions(gear, { slots: { hat: { ...g.slots.hat, flameAdv: false } } }, fl, 'STR', stats)[0];
  assert.ok(plain.cost > o.cost);
  // No stats entered, or a Max HP character: nothing to rank.
  assert.deepEqual(flameOptions(gear, g, fl, 'STR', null), []);
  assert.deepEqual(flameOptions(gear, g, fl, 'HP', stats), []);
  assert.deepEqual(flameOptions(gear, undefined, fl, 'STR', stats), []);
  // In the full ranking it sits with the Star Force options and can be the best pick.
  const all = upgradeOptions(gear, g, up, gearStats, stats, { fl, mainStat: 'STR' });
  assert.ok(all.some((x) => x.kind === 'flame'));
  assert.ok(!upgradeOptions(gear, g, up, gearStats, stats).some((x) => x.kind === 'flame'));
  const best = bestUpgrade(all);
  assert.equal(best.by, 'damage');
  assert.ok(all.every((x) => !(x.dmg > 0) || x.dmg / x.cost <= best.dmg / best.cost + 1e-18));
});

test('a main-stat-only gain counts for less than the same gain to main and secondary stat', () => {
  assert.ok(damageGain(stats, { main: 50 }) > 0);
  assert.ok(damageGain(stats, { main: 50 }) < damageGain(stats, { stat: 50 }));
  near(damageGain(stats, { main: 50 }), (4 * (40000 + 50 * 4) + 5000) / (4 * 40000 + 5000) - 1);
});

test('calculators give the 50, 75, 90 and 95% figures', () => {
  const cube = { price: 22000000, tierUp: [0.15, 0.035, 0.012] };
  const one = cubePlan(cube, 3, 4);
  for (const q of [50, 75, 90, 95]) assert.equal(one.sure[q], Math.ceil(Math.log(1 - q / 100) / Math.log(1 - 0.012)));
  assert.equal(one.sure[90], one.n90);
  const path = cubePlan(cube, 1, 4);
  assert.ok(path.sure[50] < path.sure[75] && path.sure[75] < path.sure[90] && path.sure[90] < path.sure[95]);
  assert.ok(path.sure[50] < path.expected && path.expected < path.sure[75], 'the average sits between the median and the 75% mark');
  assert.deepEqual(cubePlan(cube, 4, 4).sure, { 50: 0, 75: 0, 90: 0, 95: 0 });
  const s = starSpread(up.starforce, 160, 15, 20, {}, 0, 1500);
  assert.ok(s.p50 <= s.p75 && s.p75 <= s.p90 && s.p90 <= s.p95 && s.p50 > 0);
  assert.deepEqual(starSpread(up.starforce, 160, 20, 20), { p50: 0, p75: 0, p90: 0, p95: 0 });
});

test('Legion Champions: slots open by rank, and insignia add up', () => {
  assert.equal(ch.ranks.map((r) => r.id).join(' '), 'C B A S SS SSS');
  assert.equal(ch.maxSlots, 5);
  const sum = (slots) => championSummary(ch, { slots });
  const c = (name, rank) => ({ name, rank: ch.ranks.findIndex((r) => r.id === rank) });
  const empty = sum([]);
  assert.equal(empty.open, 2);
  assert.equal(empty.registered, 0);
  assert.equal(insigniaLabel(empty.insignia), '');
  assert.equal(empty.slots.length, 5);
  assert.equal(empty.nextRule.slot, 3);
  assert.equal(sum([c('A', 'A'), c('B', 'B')]).open, 2);
  assert.equal(sum([c('A', 'A'), c('B', 'A')]).open, 3);
  // A new rank-C Champion in the third slot does not lock that slot again.
  const three = sum([c('A', 'A'), c('B', 'A'), c('C', 'C')]);
  assert.equal(three.open, 3);
  assert.equal(three.registered, 3);
  assert.equal(three.slots[2].next.id, 'B');
  assert.equal(sum([c('A', 'A'), c('B', 'A'), c('C', 'A')]).open, 4);
  assert.equal(sum([c('A', 'S'), c('B', 'S'), c('C', 'S'), c('D', 'A')]).open, 4);
  const full = sum([c('A', 'SSS'), c('B', 'S'), c('C', 'S'), c('D', 'S'), c('E', 'C'), c('F', 'SSS')]);
  assert.equal(full.open, 5);
  assert.equal(full.nextRule, null);
  assert.equal(full.slots[0].next, null);
  // An unnamed slot does not count as a Champion.
  assert.equal(sum([c('A', 'A'), c('  ', 'A')]).open, 2);
  // Two rank-A Champions: each gives the B and the A insignia.
  assert.deepEqual(sum([c('A', 'A'), c('B', 'A')]).insignia, { allStats: 40, hp: 2000, att: 20, boss: 0, critDmg: 0, ied: 0 });
  assert.equal(insigniaLabel(sum([c('A', 'SSS')]).insignia), 'All Stats +20 · Max HP/MP +1,000 · ATT +10 · Boss Damage +5% · Crit Damage +3% · IED +5%');
  assert.equal(raidMonth(Date.parse('2026-11-30T23:59:59Z')), '2026-11');
  assert.equal(raidMonth(Date.parse('2026-12-01T00:00:00Z')), '2026-12');
});

test('Legion Champions: damaged data is repaired and the part syncs as one unit', () => {
  assert.deepEqual(cleanChampions(undefined), { slots: [], raid: {} });
  assert.deepEqual(cleanChampions({ slots: 'x', raid: 5 }), { slots: [], raid: {} });
  const fixed = cleanChampions({ slots: [{ name: 'A', rank: 2 }, null, { name: 7, rank: 99 }, { name: 'B', rank: 1.5 }], raid: { '2026-11': 1.2e9, bad: 5, '2026-12': -1, '2027-01': 'x' } });
  assert.deepEqual(fixed.slots, [{ name: 'A', rank: 2 }, { name: '', rank: 0 }, { name: '', rank: 0 }, { name: 'B', rank: 0 }]);
  assert.deepEqual(fixed.raid, { '2026-11': 1.2e9 });
  assert.equal(cleanChampions({ slots: Array.from({ length: 20 }, () => ({ name: 'x', rank: 1 })) }).slots.length, 6);
  const base = { characters: [], checklist: {}, ui: {}, mesos: {}, champions: { slots: [], raid: {} } };
  assert.deepEqual(sanitiseState({}, base).champions, { slots: [], raid: {} });
  assert.deepEqual(sanitiseState({ champions: { slots: [{ name: 'A', rank: 3 }], raid: { '2026-11': 5 } } }, base).champions, { slots: [{ name: 'A', rank: 3 }], raid: { '2026-11': 5 } });
  const pc = { characters: [], champions: { slots: [{ name: 'A', rank: 3 }], raid: {} }, mesos: { held: 1 }, updatedAt: 100, stamps: { champions: 100, mesos: 10 } };
  const phone = { characters: [], champions: { slots: [], raid: {} }, mesos: { held: 2 }, updatedAt: 90, stamps: { champions: 20, mesos: 90 } };
  for (const merged of [mergeStates(pc, phone, 1000), mergeStates(phone, pc, 1000)]) {
    assert.equal(merged.champions.slots[0].name, 'A');
    assert.equal(merged.mesos.held, 2);
  }
});

test('EXP sources: the best Monster Park dungeon and the potions that work at a level', () => {
  for (const d of src.monsterPark.dungeons) assert.ok(d.from <= d.to && d.exp > 0 && d.name, d.name);
  const toNext = expToNext(up.exp, 264);
  const o = expSourcesAt(src, 264, toNext);
  assert.equal(o.park.best.name, 'Cernium');
  assert.equal(o.park.best.exp, 37474604460);
  assert.deepEqual(o.dungeons.map((d) => d.name), ['Cernium', 'Limina']);
  near(o.park.best.share, 37474604460 / toNext);
  assert.equal(o.park.perDay, 2 * 37474604460);
  assert.equal(o.park.perWeek, 2 * 37474604460 * 7.5); // six ordinary days and one Sunday at +50%
  near(o.park.weekShare, (2 * 37474604460 * 7.5) / toNext);
  assert.equal(o.park.sundayExp, 37474604460 * 1.5);
  assert.deepEqual(o.potions.map((p) => p.name), ['Growth Potion (200 - 269)', 'Growth Potion (200 - 279)']);
  // Level 204: the Arcane River dungeon is worth more than Spirit Valley.
  const low = expSourcesAt(src, 204, null);
  assert.equal(low.park.best.name, 'Vanishing Journey');
  assert.equal(low.park.weekShare, null);
  assert.equal(low.potions.length, 8);
  assert.equal(expSourcesAt(src, 100, null).park, null);
  assert.equal(expSourcesAt(src, 280, null).potions.length, 0);
  assert.equal(expSourcesAt(src, null, null), null);
  assert.equal(expSourcesAt(src, 'x', null), null);
});

test('upcoming content: soonest first, past dates dropped, Challenger-only items hidden for other characters', () => {
  const ids = upcoming.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const it of upcoming.items) assert.ok(Number.isFinite(Date.parse(it.at)) && it.title && it.note, it.id);
  const now = Date.parse('2026-11-24T00:00:00Z');
  const main = comingUp(upcoming, now, { challenger: true }, 20);
  assert.ok(main.every((x, i) => i === 0 || x.t >= main[i - 1].t));
  assert.equal(main[0].id, 'part-2');
  assert.equal(main[0].days, 22);
  assert.ok(main.some((x) => x.id === 'world-leap-1'));
  // The weekly pass missions show only the next one.
  assert.deepEqual(main.filter((x) => x.group === 'gpp').map((x) => x.id), ['gpp-seren']);
  const mule = comingUp(upcoming, now, { challenger: false }, 20);
  assert.ok(!mule.some((x) => x.only === 'challenger'));
  assert.ok(!comingUp(upcoming, now, null, 20).some((x) => x.only === 'challenger'));
  const later = comingUp(upcoming, Date.parse('2026-12-25T00:00:00Z'), { challenger: true }, 20);
  assert.equal(later[0].id, 'gpp-adversary');
  assert.ok(!later.some((x) => x.id === 'part-2'));
  assert.deepEqual(comingUp(upcoming, Date.parse('2028-01-01T00:00:00Z'), { challenger: true }), []);
  assert.deepEqual(comingUp(null, now, null), []);
  assert.deepEqual(comingUp({ items: [{ at: 'nonsense', title: 'x' }] }, now, null), []);
  assert.equal(comingUp(upcoming, now, { challenger: true }, 2).length, 2);
});
