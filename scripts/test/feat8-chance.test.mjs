// "What your mesos buy" on Mesos > Star Force, Cubes and Flames (calc/chance.js, pages/chance.js): the chance to
// reach the target with a budget, read from the same distributions as the "To be this sure" tables.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

const siteFile = (name) => fileURLToPath(new URL(`../../site/${name}`, import.meta.url));
installFakeBrowser({ files: { 'data/items.json': siteFile('data/items.json') } });

const { html, render, useEffect } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const { starPlan, starSpread, starCosts } = await import('../../site/app/calc/starforce.js');
const { cubePlan } = await import('../../site/app/calc/upgrades.js');
const { scoreDist, chanceAtLeast, flamesNeeded } = await import('../../site/app/calc/flames.js');
const chance = await import('../../site/app/calc/chance.js');
const { units, mergeStates } = await import('../../site/app/calc/merge.js');
const { sanitiseState } = await import('../../site/app/calc/sanitise.js');
const { MesosPage } = await import('../../site/app/pages/mesos.js');

const { chanceFromCosts, starChance, cubeChance, cubesEnough, flameChance, fmtChance, sunnyTerms, sunnyOpts, budgetFor, SF_RUNS, SF_SEED, SF_MAX_ATTEMPTS } = chance;
const load = (name) => JSON.parse(readFileSync(siteFile(`data/${name}.json`), 'utf8'));
const UP = load('upgrades');
const SF = UP.starforce;
const FL = load('flames');

// ---- the CDF reading -----------------------------------------------------------------------------------------
test('chanceFromCosts counts the runs at or below the budget', () => {
  const costs = [1, 2, 2, 3, 10];
  assert.equal(chanceFromCosts(costs, 0), 0);
  assert.equal(chanceFromCosts(costs, 1), 0.2);
  assert.equal(chanceFromCosts(costs, 2), 0.6);
  assert.equal(chanceFromCosts(costs, 9.99), 0.8);
  assert.equal(chanceFromCosts(costs, 10), 1);
  assert.equal(chanceFromCosts(costs, NaN), 0);
  assert.equal(chanceFromCosts([], 5), 1, 'nothing to do is certain');
});

test('Star Force: a budget at the 50% / 90% cost of the table reads about 50% / 90%', () => {
  for (const [lvl, from, to, opts] of [[160, 17, 22, {}], [200, 15, 21, { safeguard: true }], [160, 12, 18, { discount: true, lessBoom: true }]]) {
    const spread = starSpread(SF, lvl, from, to, opts, 0, SF_RUNS, SF_SEED);
    for (const [q, p] of [[0.5, spread.p50], [0.75, spread.p75], [0.9, spread.p90], [0.95, spread.p95]]) {
      const c = starChance(SF, lvl, from, to, opts, 0, p);
      assert.equal(c.kind, 'chance');
      assert.ok(c.chance >= q && c.chance <= q + 0.04, `${lvl} ${from}->${to} at the ${q} cost reads ${c.chance}`);
      // One meso under that cost is below it.
      assert.ok(starChance(SF, lvl, from, to, opts, 0, p - 1).chance <= q + 0.0005);
    }
  }
});

test('Star Force chance is the same for the same inputs, rounds to a whole percent, and rises with the budget', () => {
  const plan = starPlan(SF, 160, 17, 22, {});
  const a = starChance(SF, 160, 17, 22, {}, 0, plan.cost);
  const b = starChance(SF, 160, 17, 22, {}, 0, plan.cost);
  assert.equal(a.chance, b.chance);
  assert.match(fmtChance(a.chance, true), /^\d{1,2}%$/);
  let last = -1;
  for (const f of [0.1, 0.5, 1, 2, 4, 8]) {
    const c = starChance(SF, 160, 17, 22, {}, 0, plan.cost * f).chance;
    assert.ok(c >= last);
    last = c;
  }
  // The runs are shared with the table and never changed by a reader.
  const costs = starCosts(SF, 160, 17, 22, {}, 0, SF_RUNS, SF_SEED);
  assert.ok(Object.isFrozen(costs));
  assert.equal(costs.length, SF_RUNS);
  for (let i = 1; i < costs.length; i++) assert.ok(costs[i] >= costs[i - 1]);
});

test('Star Force: nothing to do, and too far to estimate past 2,000 expected attempts', () => {
  assert.equal(starChance(SF, 160, 22, 22, {}, 0, 1e9).kind, 'done');
  assert.equal(starChance(SF, 160, 23, 22, {}, 0, 1e9).kind, 'done');
  // Find a run that needs more than 2,000 attempts on average, from the plan itself.
  let far = null;
  for (let to = 23; to <= 30 && !far; to++) if (starPlan(SF, 250, 0, to, {}).attempts > SF_MAX_ATTEMPTS) far = to;
  assert.ok(far, 'some target takes thousands of attempts');
  assert.equal(starChance(SF, 250, 0, far, {}, 0, 1e15).kind, 'far');
});

test('Cubes: a budget at the 50% / 90% cube count reads at least that, one cube fewer reads less (exact)', () => {
  for (const id of ['bright', 'glowing']) {
    const cube = UP.cubes.types[id];
    for (const [from, to] of [[1, 2], [1, 4], [3, 4], [2, 4]]) {
      const plan = cubePlan(cube, from, to);
      for (const q of [50, 75, 90, 95]) {
        const n = plan.sure[q];
        const at = cubeChance(cube, from, to, n * cube.price);
        assert.equal(at.cubes, n);
        assert.ok(at.chance >= q / 100 - 1e-12, `${id} ${from}->${to} ${n} cubes: ${at.chance}`);
        assert.ok(at.chance < q / 100 + 0.05);
        assert.ok(cubeChance(cube, from, to, (n - 1) * cube.price).chance < q / 100);
      }
    }
  }
  const one = UP.cubes.types.bright;
  assert.equal(cubesEnough(one, 3, 4, 1), one.tierUp[2]);
  assert.ok(Math.abs(cubesEnough(one, 3, 4, 10) - (1 - Math.pow(1 - one.tierUp[2], 10))) < 1e-12);
  assert.equal(cubesEnough(one, 4, 4, 0), 1);
  assert.equal(cubeChance(one, 1, 4, one.price - 1).chance, 0);
  assert.equal(cubeChance({ ...one, price: 0 }, 1, 4, 1e9).kind, 'noprice');
});

test('Flames: a budget at the 50% / 90% flame count reads at least that, one fewer reads less (exact)', () => {
  const reset = FL.types.find((t) => t.price > 0);
  const dist = scoreDist(FL, { level: 160, mainStat: 'STR', type: reset.id, advantaged: true });
  for (const target of [60, 100, 120]) {
    const p = chanceAtLeast(dist, target);
    const need = flamesNeeded(p);
    for (const [q, n] of [[0.5, need.p50], [0.9, need.p90]]) {
      const c = flameChance(p, reset.price, n * reset.price);
      assert.equal(c.flames, n);
      assert.ok(c.chance >= q - 1e-12, `${target} at ${n} flames reads ${c.chance}`);
      if (n > 1) assert.ok(flameChance(p, reset.price, (n - 1) * reset.price).chance < q);
    }
  }
  assert.equal(flameChance(0, reset.price, 1e12).kind, 'never');
  assert.equal(flameChance(0.5, 0, 1e12).kind, 'noprice');
  assert.equal(flameChance(0.5, reset.price, reset.price - 1).chance, 0);
  // A huge budget is still not a certainty while a flame can miss; one that cannot miss is.
  assert.equal(fmtChance(flameChance(0.5, 1, 1e6).chance), 'over 99%');
  assert.equal(fmtChance(cubeChance(UP.cubes.types.bright, 1, 4, 1e15).chance), 'over 99%');
  assert.equal(fmtChance(flameChance(1, 1, 5).chance), '100%');
});

test('fmtChance: whole percent; a simulated 0 or 100 is never shown as certain', () => {
  assert.equal(fmtChance(0.634), '63%');
  assert.equal(fmtChance(0.004), 'under 1%');
  assert.equal(fmtChance(0.996), 'over 99%');
  assert.equal(fmtChance(0), '0%');
  assert.equal(fmtChance(1), '100%');
  assert.equal(fmtChance(0, true), 'under 1%');
  assert.equal(fmtChance(1, true), 'over 99%');
  assert.equal(fmtChance(NaN), '—');
});

// ---- Sunny Sunday terms --------------------------------------------------------------------------------------
const NOW = Date.parse('2030-03-05T12:00:00Z'); // a Tuesday
const SUNNY = [
  { date: '2030-03-10', perks: ['1+1 Star Force upon a successful enhancement at 10-Star or below.', 'Can reach up to 12 Stars.'] },
  { date: '2030-03-17', perks: ['Shining Star Force Time', '30% off Star Force enhancements', 'Mesos used to safeguard are not eligible for the 30% discount.', '30% reduced chance of item destruction when enhancing items at 21 Stars or below'] }
];

test('sunnyTerms reads the next Star Force Sunday and its perks, skipping a 1+1 Sunday', () => {
  const t = sunnyTerms(SUNNY, NOW);
  assert.equal(t.kind, 'wait');
  assert.equal(t.day.date, '2030-03-17');
  assert.equal(t.discount, true);
  assert.equal(t.lessBoom, true);
  const on = sunnyTerms(SUNNY, Date.parse('2030-03-17T05:00:00Z'));
  assert.equal(on.kind, 'now');
  const half = sunnyTerms([{ date: '2030-03-17', perks: ['30% off Star Force enhancements'] }], NOW);
  assert.deepEqual([half.discount, half.lessBoom], [true, false]);
  assert.deepEqual(sunnyOpts({ safeguard: true }, half), { safeguard: true, discount: true, lessBoom: false });
  const none = sunnyTerms([SUNNY[0]], NOW);
  assert.equal(none.kind, 'none');
  assert.equal(sunnyTerms([], NOW).kind, 'unknown');
  assert.equal(sunnyTerms(SUNNY, Date.parse('2030-04-01T00:00:00Z')).kind, 'unknown', 'past Sundays are not used');
  // Without announced perks the usual pair is used, for an "if one comes" figure.
  assert.deepEqual(sunnyOpts({}, none), { discount: true, lessBoom: true });
});

test('the Sunny Sunday chance is at least the plain chance for the same budget', () => {
  const plan = starPlan(SF, 160, 17, 22, {});
  for (const f of [0.3, 1, 2]) {
    const plain = starChance(SF, 160, 17, 22, {}, 0, plan.cost * f).chance;
    const sunny = starChance(SF, 160, 17, 22, sunnyOpts({}, sunnyTerms(SUNNY, NOW)), 0, plan.cost * f).chance;
    assert.ok(sunny >= plain, `${f}: ${sunny} vs ${plain}`);
  }
});

// ---- the budget figure, saved data and sync ------------------------------------------------------------------
test('budgetFor uses the planner figure unless one was typed for this calculation', () => {
  assert.deepEqual(budgetFor({ mesos: { held: 4.1e9 }, ui: { budget: { mesos: null } } }), { mesos: 4.1e9, own: false });
  assert.deepEqual(budgetFor({ mesos: { held: 4.1e9 }, ui: { budget: { mesos: 2e9 } } }), { mesos: 2e9, own: true });
  assert.deepEqual(budgetFor({ mesos: { held: 0 }, ui: {} }), { mesos: 0, own: false });
  assert.deepEqual(budgetFor({}), { mesos: 0, own: false });
});

test('saved data: old states get an empty budget, bad budgets are cleaned', () => {
  const base = store.blankState();
  assert.deepEqual(base.ui.budget, { mesos: null });
  assert.deepEqual(sanitiseState({ ui: { hideClassic: true } }, base).ui.budget, { mesos: null });
  assert.deepEqual(sanitiseState({ ui: { budget: { mesos: 3e9, sf: 'hat', cubes: 'top' } } }, base).ui.budget, { mesos: 3e9, sf: 'hat', cubes: 'top' });
  for (const bad of [null, 5, 'x', [], { mesos: -1 }, { mesos: 1e16 }, { mesos: '3b' }, { mesos: NaN }]) {
    assert.deepEqual(sanitiseState({ ui: { budget: bad } }, base).ui.budget, { mesos: null }, JSON.stringify(bad));
  }
  assert.deepEqual(sanitiseState({ ui: { budget: { sf: '__proto__', cubes: 7, extra: 1 } } }, base).ui.budget, { mesos: null });
});

test('the typed budget stays on its device: not a sync unit, and a merge keeps each side its own', () => {
  const a = store.blankState();
  a.ui.budget = { mesos: 1e9, sf: 'hat' };
  a.mesos.held = 5e9;
  a.updatedAt = 1;
  const b = store.blankState();
  b.ui.budget = { mesos: 7e9 };
  b.updatedAt = 2;
  b.stamps = { 'ui/budget': 2 };
  assert.ok(![...units(a).keys()].some((k) => k.startsWith('ui/budget')));
  const m = mergeStates(a, b, 10);
  assert.deepEqual(m.ui.budget, { mesos: 1e9, sf: 'hat' });
  const n = mergeStates(b, a, 10);
  assert.deepEqual(n.ui.budget, { mesos: 7e9 });
});

// ---- on the page ---------------------------------------------------------------------------------------------
const DATA = {
  bosses: load('bosses'), symbols: load('symbols'), liberation: load('liberation'), ibp: load('ibp'), checklist: load('checklist'),
  gear: load('gear'), erda: load('erda'), upgrades: UP, potential: load('potential'), gearStats: load('gearstats'),
  events: { events: [], sunny: [] }, news: { items: [] }, nexonCharacters: { characters: [] }, meta: null, tables: load('tables'), season: load('season'),
  pitched: load('pitched'), shops: { source: 'test', shops: [] }, flames: FL, champions: load('champions'), expSources: load('expsources'),
  upcoming: { items: [] }, bossCp: load('bosscp'), classes: load('classes')
};
DATA.bossById = Object.fromEntries(DATA.bosses.bosses.map((b) => [b.id, b]));

const mounted = [];
after(() => { for (const el of mounted) render(null, el); });
function setState(mutator) {
  const s = store.blankState();
  s.characters = [{ id: 'c1', name: 'Solo', cls: 'Erel Light', level: 264, region: 'na', world: 'heroic', challenger: true, mainStat: 'STR' }];
  s.activeId = 'c1';
  mutator(s);
  store.replaceState(s, true);
}
async function show(data = DATA) {
  let ready = false;
  const App = () => { const state = store.useStore(); useEffect(() => { ready = true; }, []); return html`<${MesosPage} data=${data} state=${state} />`; };
  const el = new FakeNode('div');
  mounted.push(el);
  render(html`<${App} />`, el);
  for (const end = Date.now() + 5000; !ready && Date.now() < end;) await tick(5);
  await tick(5);
  return el;
}
const flat = (el) => el.text.replace(/\s+/g, ' ');
async function until(cond, ms = 3000) {
  for (const end = Date.now() + ms; !cond() && Date.now() < end;) await tick(5);
  return cond();
}
const boxText = (box) => String(box.value ?? box.attrs.value ?? '');
const byLabel = (el, re) => el.find((n) => n.localName === 'input' && re.test(n.attrs['aria-label'] || ''));

test('Star Force page: the chance with the planner figure, matching the calc, and a next Sunny Sunday figure', async () => {
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const data = { ...DATA, events: { events: [], sunny: [{ date: day, perks: SUNNY[1].perks }] } };
  setState((s) => { s.ui.mesosView = 'starforce'; s.ui.sfCalc = { level: 160, from: 17, to: 22 }; s.mesos.held = 4.1e9; });
  const el = await show(data);
  const t = flat(el);
  const want = fmtChance(starChance(SF, 160, 17, 22, { discount: false, lessBoom: false, safeguard: false, mvp: 'none' }, 0, 4.1e9).chance, true);
  assert.match(t, /What your mesos buy/);
  assert.ok(t.includes(`With your settings ${want}`), t);
  assert.match(t, /Next Sunny Sunday \d+% \w{3} \d+ \w{3}, 09:00 KST/);
  assert.match(t, /30% off, 30% less destruction at 21★ or below/);
  assert.match(t, /From Mesos → Planner/);
  render(null, el);
});

test('typing a budget changes this calculation only; "Save to the planner" changes the planner', async () => {
  setState((s) => { s.ui.mesosView = 'starforce'; s.ui.sfCalc = { level: 160, from: 17, to: 22 }; s.mesos.held = 4.1e9; });
  const el = await show();
  const box = byLabel(el, /Mesos you have for this calculation/);
  box.value = '20b';
  box.fire('input', { currentTarget: box });
  box.fire('change', { currentTarget: box });
  assert.ok(await until(() => store.getState().ui.budget.mesos === 2e10));
  assert.equal(store.getState().mesos.held, 4.1e9, 'the planner keeps its figure');
  assert.ok(await until(() => /Your planner says 4\.10B\. Use the planner figure · Save to the planner/.test(flat(el))), flat(el));
  const save = el.find((n) => n.localName === 'button' && /Save to the planner/.test(n.text));
  save.fire('click');
  assert.ok(await until(() => store.getState().mesos.held === 2e10 && store.getState().ui.budget.mesos === null));
  assert.ok(await until(() => /From Mesos → Planner/.test(flat(el))));
  assert.equal(boxText(byLabel(el, /Mesos you have for this calculation/)), '20B');
  render(null, el);
});

test('an item that expires gets no chance, on Star Force, Cubes and Flames', async () => {
  const gear = { preset: 'mid', slots: { hat: { tier: 2, ilvl: 160, stars: 17, pot: 3, temporary: true }, top: { tier: 2, ilvl: 150, stars: 15, pot: 3 } } };
  for (const [view, extra] of [['starforce', { budget: { mesos: null, sf: 'hat' } }], ['cubes', { budget: { mesos: null, cubes: 'hat' } }], ['flames', { flameCalc: { slot: 'hat', level: 160, target: 60, type: 'reset', adv: true } }]]) {
    setState((s) => { s.ui.mesosView = view; Object.assign(s.ui, extra); s.mesos.held = 50e9; s.gear = { c1: gear }; });
    const el = await show();
    const card = el.findAll((n) => n.localName === 'section' && /What your mesos buy/.test(n.text))[0];
    assert.ok(card, view);
    assert.match(flat(card), /expires, so put no/, view);
    assert.doesNotMatch(flat(card), /\d%|under 1%|over 99%/, `${view}: ${flat(card)}`);
    render(null, el);
  }
});

test('picking an item fills in the calculator from its level and stars', async () => {
  setState((s) => { s.ui.mesosView = 'starforce'; s.ui.sfCalc = { level: 100, from: 0, to: 10 }; s.mesos.held = 5e9; s.gear = { c1: { preset: 'mid', slots: { top: { tier: 2, ilvl: 150, stars: 15, pot: 3 } } } }; });
  const el = await show();
  const sel = el.find((n) => n.localName === 'select' && n.attrs['aria-label'] === 'Item for the chance');
  sel.value = 'top';
  sel.fire('change', { currentTarget: sel });
  assert.ok(await until(() => store.getState().ui.sfCalc.level === 150));
  const o = store.getState().ui.sfCalc;
  assert.deepEqual([o.from, o.to], [15, 16]);
  assert.equal(store.getState().ui.budget.sf, 'top');
  render(null, el);
});

test('Cubes and Flames pages show an exact whole-percent chance; flames that mesos do not buy say so', async () => {
  setState((s) => { s.ui.mesosView = 'cubes'; s.ui.cubeCalc = { from: 3, to: 4 }; s.mesos.held = 1e9; });
  let el = await show();
  const bright = UP.cubes.types.bright;
  const want = fmtChance(cubeChance(bright, 3, 4, 1e9).chance);
  assert.ok(flat(el).includes(`Bright Cubes ${want}`), flat(el));
  assert.match(flat(el), /45 cubes with 1B/);
  render(null, el);

  setState((s) => { s.ui.mesosView = 'flames'; s.ui.flameCalc = { level: 160, target: 100, type: 'reset', adv: true }; s.mesos.held = 3e9; });
  el = await show();
  assert.match(flat(el), /Chance to reach score 100 (\d{1,2}%|under 1%|over 99%|100%)/);
  assert.match(flat(el), /1,000 meso resets with 3B/);
  render(null, el);

  setState((s) => { s.ui.mesosView = 'flames'; s.ui.flameCalc = { level: 160, target: 100, type: 'black', adv: true }; s.mesos.held = 3e9; });
  el = await show();
  assert.match(flat(el), /mesos don't buy them/);
  render(null, el);
});

test('a new player with no mesos is asked for a figure; an Interactive character gets no cube chance', async () => {
  setState((s) => { s.characters = []; s.activeId = null; s.ui.mesosView = 'starforce'; });
  let el = await show();
  assert.match(flat(el), /Type the mesos you have to see your chance/);
  render(null, el);
  setState((s) => { s.characters[0].world = 'interactive'; s.ui.mesosView = 'cubes'; s.mesos.held = 5e9; });
  el = await show();
  assert.match(flat(el), /no chance is shown/);
  render(null, el);
});
