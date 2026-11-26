// Fixes from the second test-everything round, gear area: line counting, upgrade advice, the item picker,
// overalls, gear pace, the flame calculator and the level log.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

const dataFile = (name) => fileURLToPath(new URL(`../../site/data/${name}`, import.meta.url));
installFakeBrowser({ files: { 'data/items.json': dataFile('items.json') } });
const load = (name) => JSON.parse(readFileSync(dataFile(`${name}.json`), 'utf8'));

const { html, render } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const U = await import('../../site/app/calc/upgrades.js');
const P = await import('../../site/app/calc/potential.js');
const A = await import('../../site/app/calc/advice.js');
const I = await import('../../site/app/calc/items.js');
const G = await import('../../site/app/calc/progress.js');
const L = await import('../../site/app/pages/level.js');
const { GearPage } = await import('../../site/app/pages/gear.js');
const { Flames } = await import('../../site/app/pages/flames.js');
const { ProgressPage } = await import('../../site/app/pages/progress.js');

const DATA = {
  gear: load('gear'), upgrades: load('upgrades'), potential: load('potential'), gearStats: load('gearstats'), flames: load('flames'),
  erda: load('erda'), symbols: load('symbols'), liberation: load('liberation'), ibp: load('ibp'), champions: load('champions'), expSources: load('expsources'),
  season: load('season'), events: { events: [], sunny: [] }, nexonCharacters: { characters: [] }
};
const gear = DATA.gear;
const slotOf = (id) => gear.slots.find((s) => s.id === id);
const DAY = 86400000;

const mounted = [];
after(() => { for (const el of mounted) render(null, el); });
async function show(Page, data = DATA) {
  const el = new FakeNode('div');
  mounted.push(el);
  const App = () => html`<${Page} data=${data} state=${store.useStore()} />`;
  render(html`<${App} />`, el);
  await tick(5);
  return el;
}
// Waits for the page to catch up with the store: a slow machine can take longer than one tick to redraw.
async function until(check, ms = 3000) {
  for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return true; await tick(10); }
  return Boolean(check());
}
function close(el) { render(null, el); mounted.splice(mounted.indexOf(el), 1); }
const char = (over = {}) => ({ id: 'c', name: 'Tester', cls: 'Hero', level: 264, region: 'na', world: 'heroic', mainStat: 'STR', ...over });
function setState(over) {
  const s = store.blankState();
  store.replaceState({ ...s, characters: [char()], activeId: 'c', ...over }, true);
}
// Every slot exactly at the preset's target.
function atTarget(preset, skip = []) {
  const sum = G.gearSummary(gear, { preset, slots: {} });
  const slots = {};
  for (const r of sum.slots) if (!skip.includes(r.slot.id)) slots[r.slot.id] = { tier: r.target.tier, stars: r.target.stars, pot: r.target.pot, lines: r.target.lines, ilvl: 250 };
  return { preset, slots, history: [] };
}

// ---------- 14: one rule for "is this a main-stat line" ----------
test('lines: the gear score and the stat totals agree on which lines raise the main stat', () => {
  const hat = slotOf('hat');
  // A: STR lines kept from another tier while the character is DEX.
  const kept = [1, 2, 3].map(() => ({ pid: 1, prime: true, text: 'STR +13%', type: 'main', stat: 'STR', value: 13 }));
  const a = { slots: { hat: { tier: 2, pot: 3, potLines: kept } } };
  assert.equal(U.usefulLines(hat, a.slots.hat, 'DEX'), 0);
  assert.deepEqual([U.lineTotals(gear.slots, a, 'DEX').main, U.lineTotals(gear.slots, a, 'DEX').damageLines], [0, 0]);
  assert.equal(U.usefulLines(hat, a.slots.hat, 'STR'), 3);
  assert.equal(U.lineTotals(gear.slots, a, 'STR').main, 39);
  // B: a Max HP character. Old 'hp' lines count, All Stats does not, in both places.
  const b = { slots: { hat: { tier: 2, pot: 4, potLines: [{ type: 'hp', value: 12 }, { type: 'hp', value: 12 }, { type: 'allstat', value: 10 }] } } };
  assert.equal(U.usefulLines(hat, b.slots.hat, 'HP'), 2);
  assert.deepEqual([U.lineTotals(gear.slots, b, 'HP').main, U.lineTotals(gear.slots, b, 'HP').damageLines], [24, 2]);
  assert.equal(U.usefulLines(hat, b.slots.hat, 'STR'), 1, 'for anyone else All Stats counts and Max HP does not');
  assert.equal(U.lineTotals(gear.slots, b, 'STR').main, 10);
  // C: a main-stat line saved without a stat is the character's own stat for the label, the score and the total.
  const c = { slots: { hat: { tier: 2, pot: 4, potLines: [{ type: 'main', value: 13 }] } } };
  assert.equal(U.lineLabel(c.slots.hat.potLines[0], 'DEX'), 'DEX +13%');
  assert.equal(U.usefulLines(hat, c.slots.hat, 'DEX'), 1);
  assert.equal(U.lineTotals(gear.slots, c, 'DEX').main, 13);
  // The score follows: three off-stat lines are worth nothing.
  const score = (ms) => G.gearSummary(gear, a, ms).slots.find((r) => r.slot.id === 'hat').parts.lines;
  assert.deepEqual([score('DEX'), score('STR')], [0, 1]);
});

test('lines: changing the main stat re-types a table line kept from another tier', () => {
  // Rare tier on a Lv. 160 hat cannot roll a 13% line, so refreshLines keeps it as it is.
  const g = { slots: { hat: { tier: 2, ilvl: 160, pot: 1, potLines: [{ pid: 99999, prime: true, text: 'STR +13%', type: 'main', stat: 'STR', value: 13 }] } } };
  P.reclassifyLines(DATA, g, 'DEX', 'STR');
  assert.equal(g.slots.hat.potLines[0].type, 'offstat');
  assert.equal(g.slots.hat.potLines[0].text, 'STR +13%');
  P.reclassifyLines(DATA, g, 'STR', 'DEX');
  assert.equal(g.slots.hat.potLines[0].type, 'main');
});

// ---------- 16, 23: an item at its star limit, below the target ----------
test('outlook: an item whose star limit is below the target says so', async () => {
  const up = DATA.upgrades;
  const hat = slotOf('hat');
  const target = { tier: 2, stars: 22, pot: 3, lines: 2 };
  const low = A.slotOutlook(hat, { tier: 2, ilvl: 130, stars: 20, pot: 3 }, target, up);
  assert.deepEqual(low.capped, { max: 20, target: 22 });
  assert.equal(low.sf, undefined);
  const part = A.slotOutlook(hat, { tier: 2, ilvl: 130, stars: 18, pot: 3 }, target, up);
  assert.equal(part.sf.to, 20);
  assert.deepEqual(part.capped, { max: 20, target: 22 });
  assert.equal(A.slotOutlook(hat, { tier: 2, ilvl: 160, stars: 22, pot: 3 }, target, up).capped, undefined);
  // A ring with no level at the lowest tier is taken as Lv. 120 (limit 15) against the 17-star target.
  const ring = A.slotOutlook(slotOf('ring1'), { tier: 2, ilvl: 120, stars: 15, pot: 3 }, { tier: 2, stars: 17, pot: 3 }, up);
  assert.deepEqual(ring.capped, { max: 15, target: 17 });

  const capped = atTarget('mid');
  capped.slots.hat = { ...capped.slots.hat, ilvl: 130, stars: 20 };
  setState({ gear: { c: capped } });
  const el = await show(GearPage);
  assert.match(el.text.replace(/\s+/g, ' '), /This item caps at 20★: replace it, or lower the slot's target stars/);
  el.find((n) => n.localName === 'button' && n.attrs['aria-label'] === 'Hat: edit').fire('click');
  await tick(5);
  const modal = el.find((n) => n.attrs.role === 'dialog').text.replace(/\s+/g, ' ');
  assert.match(modal, /This item caps at 20★, below the 22★ target/);
  assert.doesNotMatch(modal, /Stars and potential tier meet the target/);
  close(el);
});

// ---------- 17: the cube option ----------
test('advice: a potential tier-up is priced with the cheaper cube and labelled from Rare', () => {
  const up = DATA.upgrades;
  const g = atTarget('mid');
  g.slots.hat = { ...g.slots.hat, pot: 0 };
  const opt = A.upgradeOptions(gear, g, up).find((o) => o.kind === 'cube' && o.slotId === 'hat');
  const to = G.gearSummary(gear, g).slots.find((r) => r.slot.id === 'hat').target.pot;
  const bright = U.cubePlan(up.cubes.types.bright, 1, to);
  const glowing = U.cubePlan(up.cubes.types.glowing, 1, to);
  assert.equal(opt.cost, Math.min(bright.cost, glowing.cost));
  assert.equal(opt.cube, glowing.cost < bright.cost ? 'glowing' : 'bright');
  assert.match(opt.label, /^Hat: potential Rare → /);
  assert.ok(opt.label.includes(up.cubes.types[opt.cube].name));
  assert.equal(opt.needsScroll, true);
  // With odds typed in that make Bright the cheaper one, Bright is used.
  const flipped = A.withCubeRates(up, { glowing: [0.001, 0.001, 0.001] });
  assert.equal(A.upgradeOptions(gear, g, flipped).find((o) => o.kind === 'cube' && o.slotId === 'hat').cube, 'bright');
});

// ---------- 19: tier guesses from item names ----------
test('item picker: Superior Gollux, Dawn and pitched boss names land on their own rung', () => {
  const rung = (name, type) => { const tiers = gear.slotTypes[type].filter(Boolean); return tiers[I.tierFromName(name, tiers, gear.tierHints) - 1] || null; };
  for (const [name, type] of [['Superior Engraved Gollux Belt', 'accessory'], ['Superior Engraved Gollux Pendant', 'accessory'], ['Superior Gollux Earrings', 'accessory'], ['Superior Gollux Ring', 'ring']]) {
    assert.match(rung(name, type) || '', /Superior Gollux/, name);
  }
  assert.equal(rung('Reinforced Engraved Gollux Belt', 'accessory'), null, 'only Superior Gollux is on the ladder');
  const sets = Object.fromEntries(DATA.gearStats.sets.list.map((s) => [s.id, s.match.names]));
  for (const name of sets.dawnBoss) assert.ok(['accessory', 'ring'].some((t) => /Dawn/.test(rung(name, t) || '')), name);
  for (const name of sets.pitchedBoss) assert.ok(['accessory', 'ring', 'misc', 'emblem'].some((t) => /pitched/i.test(rung(name, t) || '')), name);
  assert.match(rung('Genesis Badge', 'misc'), /Pitched/);
  // Earlier guesses still hold.
  assert.equal(rung('Royal Warrior Helm', 'hat'), 'Chaos Root Abyss');
  assert.equal(rung('Genesis Two-handed Sword', 'weapon'), 'Genesis');
  assert.equal(rung('Royal Von Leon Helm', 'hat'), null);
  assert.equal(I.tierFromName('Anything', ['a'], [[[], 'a']]), 0, 'an empty keyword list matches nothing');
});

// ---------- 20: no flame reroll on an item to replace ----------
test('advice: no flame reroll is offered for an item below its target tier', () => {
  const stats = { main: 40000, att: 5000, mainPct: 400, attPct: 100 };
  const ctx = { fl: DATA.flames, mainStat: 'STR' };
  const hat = { tier: 2, ilvl: 150, stars: 22, pot: 4, lines: 2, flame: { main: 40 } };
  const flamesFor = (preset) => A.upgradeOptions(gear, { preset, slots: { hat } }, DATA.upgrades, DATA.gearStats, stats, ctx).filter((o) => o.kind === 'flame');
  assert.equal(flamesFor('mid').length, 1, 'tier 2 meets the mid-game target');
  assert.deepEqual(flamesFor('late'), [], 'the late-game target is a better hat, so this one is replaced');
  // Lowering the slot's own target tier brings it back.
  const own = A.upgradeOptions(gear, { preset: 'late', slots: { hat: { ...hat, target: { tier: 2 } } } }, DATA.upgrades, DATA.gearStats, stats, ctx);
  assert.equal(own.filter((o) => o.kind === 'flame').length, 1);
});

// ---------- 21: the flame calculator and temporary items ----------
test('flame calculator: an item that expires is marked, warned about, and sets no target', async () => {
  setState({
    gear: { c: { preset: 'mid', slots: { hat: { tier: 1, note: 'Challenger Hat', ilvl: 200, temporary: true, flame: { main: 62 } }, shoes: { tier: 2, note: 'Keeper Shoes', ilvl: 160, flame: { main: 30 } } }, history: [] } },
    ui: { ...store.blankState().ui, flameCalc: { target: 111 } }
  });
  const el = await show(Flames);
  const select = el.find((n) => n.attrs.id === 'flame-slot');
  assert.match(select.text, /Hat: Challenger Hat \(expires\)/);
  assert.doesNotMatch(select.text, /Keeper Shoes \(expires\)/);
  select.value = 'hat';
  select.fire('change', { currentTarget: select });
  await tick(5);
  assert.equal(store.getState().ui.flameCalc.slot, 'hat');
  assert.equal(store.getState().ui.flameCalc.target, 111, 'no "beat this flame" target for an item that expires');
  assert.ok(await until(() => /This item expires, so put no mesos or flames into it/.test(el.text.replace(/\s+/g, ' '))));
  // A permanent item still gets the target one above its flame, and no warning.
  select.value = 'shoes';
  select.fire('change', { currentTarget: select });
  assert.ok(await until(() => /Your shoes flame scores/.test(el.text.replace(/\s+/g, ' '))));
  assert.equal(store.getState().ui.flameCalc.target, 31);
  assert.doesNotMatch(el.text.replace(/\s+/g, ' '), /This item expires/);
  close(el);
});

// ---------- 22: a name typed by hand ----------
test('item picker: typing a name drops the level of the item picked before, or takes the typed item', async () => {
  const items = [[1, 'Royal Von Leon Helm', 130, 'hat'], [2, 'Royal Warrior Helm', 150, 'hat'], [3, 'Royal Warrior Helm', 140, 'hat'], [4, 'Royal Warrior Helm', 200, 'top']];
  assert.deepEqual(I.exactItem(items, 'hat', '  royal warrior helm '), { id: 2, name: 'Royal Warrior Helm', level: 150 });
  assert.equal(I.exactItem(items, 'hat', 'Royal Warrior'), null);
  assert.equal(I.exactItem(items, 'hat', ''), null);
  assert.equal(I.exactItem(null, 'hat', 'x'), null);

  const list = load('items');
  const real = list.items.find((r) => r[3] === 'hat' && r[1] === 'Royal Warrior Helm');
  assert.ok(real, 'the item list has the Royal Warrior Helm');
  const line = { pid: 99999, prime: true, text: 'STR +13%', type: 'main', stat: 'STR', value: 13 };
  setState({ gear: { c: { preset: 'mid', slots: { hat: { tier: 1, note: 'Royal Von Leon Helm', itemId: 1003154, iconVer: '270', ilvl: 130, pot: 4, potLines: [line] }, shoes: { tier: 2, note: 'My shoes', ilvl: 145 } }, history: [] } } });
  const el = await show(GearPage);
  const typeInto = async (slotLabel, text) => {
    el.find((n) => n.localName === 'button' && n.attrs['aria-label'] === `${slotLabel}: edit`).fire('click');
    await tick(20);
    const box = el.find((n) => n.attrs.role === 'dialog').find((n) => n.attrs['aria-label'] === 'Item name');
    box.value = text;
    box.fire('input', { currentTarget: box });
    await tick(5);
    el.find((n) => n.attrs.role === 'dialog').findAll((n) => n.localName === 'button' && n.text.trim() === 'Done')[0].fire('click');
    await tick(5);
  };
  const hat = () => store.getState().gear.c.slots.hat;
  await typeInto('Hat', 'Some hat of my own');
  assert.deepEqual([hat().note, hat().ilvl, hat().itemId], ['Some hat of my own', null, null], 'the level came from the list item, so it goes with it');
  assert.equal(hat().potLines.length, 1, 'no potential line is deleted');
  assert.equal(hat().tier, 1, 'the tier is left alone');
  await typeInto('Hat', real[1]);
  assert.deepEqual([hat().ilvl, hat().itemId], [real[2], real[0]], 'an exact list name is taken as that item');
  // A level typed by hand, with no list item behind it, stays.
  await typeInto('Shoes', 'My other shoes');
  assert.equal(store.getState().gear.c.slots.shoes.ilvl, 145);
  close(el);
});

// ---------- 24, 51, 52: gear history and pace ----------
test('gear target: the saved point is the score on screen, whatever the main stat', async () => {
  const matt = { type: 'matt', value: 12 };
  const slots = { weapon: { tier: 2, stars: 22, pot: 4, potLines: [matt, matt, matt] }, secondary: { tier: 2, pot: 4, potLines: [matt, matt] }, emblem: { tier: 2, pot: 4, potLines: [matt, matt] } };
  setState({ characters: [char({ mainStat: 'INT' })], gear: { c: { preset: 'mid', slots, history: [{ d: '2026-01-01', pct: 0.1 }] } } });
  const el = await show(GearPage);
  el.find((n) => n.localName === 'button' && n.text.trim() === gear.presets.late.name).fire('click');
  await tick(5);
  const g = store.getState().gear.c;
  assert.equal(g.preset, 'late');
  const last = g.history[g.history.length - 1];
  const shown = Math.round(G.gearSummary(gear, g, 'INT').overall * 1000) / 1000;
  assert.notEqual(shown, Math.round(G.gearSummary(gear, g, 'STR').overall * 1000) / 1000, 'the test state tells INT from STR');
  assert.equal(last.pct, shown);
  assert.equal(last.p, 'late', 'the point remembers its target');
  assert.equal(g.history[0].p, 'mid', 'older points are marked with the target that was left');
  close(el);
});

test('gear pace: only points for the current target count, and rounding is not progress', () => {
  const now = Date.parse('2026-11-26T00:00:00Z');
  const day = (n) => new Date(now - n * DAY).toISOString().slice(0, 10);
  // Nothing changed for ten days: the stored point is rounded, the live score is not.
  const flat = G.gearProjection([{ d: day(10), pct: 0.52, p: 'mid' }, { d: day(0), pct: 0.52, p: 'mid' }], 0.5204, now, 'mid');
  assert.deepEqual(flat, { perWeek: 0, eta: null });
  assert.deepEqual(G.gearProjection([{ d: day(10), pct: 0.52 }, { d: day(0), pct: 0.52 }], 0.5196, now, 'mid'), { perWeek: 0, eta: null });
  // After switching to an easier target the old points are not compared with the new score.
  const switched = [{ d: day(10), pct: 0.5, p: 'late' }, { d: day(5), pct: 0.5, p: 'late' }, { d: day(0), pct: 0.95, p: 'mid' }];
  assert.equal(G.gearProjection(switched, 0.95, now, 'mid'), null);
  assert.deepEqual(G.historyFor(switched, 'late').map((h) => h.d), [day(10), day(5)]);
  // Real progress against one target still projects, and so does a history saved before points had a target.
  for (const hist of [[{ d: day(14), pct: 0.5, p: 'mid' }, { d: day(0), pct: 0.6, p: 'mid' }], [{ d: day(14), pct: 0.5 }, { d: day(0), pct: 0.6 }]]) {
    const p = G.gearProjection(hist, 0.6, now, 'mid');
    assert.ok(Math.abs(p.perWeek - 0.05) < 1e-9);
    assert.ok(Math.abs(p.eta - (now + 8 * 7 * DAY)) < 1000);
  }
  assert.ok(G.gearProjection([{ d: day(14), pct: 0.5 }, { d: day(0), pct: 0.6 }], 0.6, now).eta, 'without a target every point counts, as before');
  assert.deepEqual(G.historyFor(undefined, 'mid'), []);
});

// ---------- 69: overalls ----------
test('overall: AbsoLab and Arcane Umbra overalls get a tier, and Bottom is not scored under one', async () => {
  const tiers = gear.slotTypes.topbottom.filter(Boolean);
  for (const name of ['AbsoLab Knight Suit', 'Arcane Umbra Knight Suit', 'Eagle Eye Warrior Armor']) assert.equal(I.tierFromName(name, tiers, gear.tierHints), 2, name);
  assert.equal(tiers[I.tierFromName('Eternal Knight Armor', tiers, gear.tierHints) - 1], 'Eternal');
  assert.equal(tiers.length, 3, 'the ladder keeps its three rungs, so saved tiers mean what they did');
  const list = load('items');
  const suit = list.items.find((r) => r[1] === 'Arcane Umbra Knight Suit');
  const top = list.items.find((r) => r[1] === 'Eagle Eye Warrior Armor');
  assert.deepEqual([I.isOverall(gear.overall, suit[0]), I.isOverall(gear.overall, top[0]), I.isOverall(gear.overall, null), I.isOverall(undefined, suit[0])], [true, false, false, false]);

  const g = atTarget('mid', ['bottom']);
  const before = G.gearSummary(gear, g);
  assert.ok(before.overall < 1);
  assert.equal(before.gaps[0].slot.id, 'bottom');
  g.slots.top.overall = true;
  const sum = G.gearSummary(gear, g);
  assert.equal(sum.overall, 1);
  assert.deepEqual(sum.gaps, []);
  assert.equal(sum.slots.length, gear.slots.length, 'Bottom is still listed for the pages');
  assert.equal(sum.slots.find((r) => r.slot.id === 'bottom').covered, true);
  assert.equal(sum.totalWeight, before.totalWeight - slotOf('bottom').weight);
  // The flag only counts while Top holds an item.
  assert.equal(G.gearSummary(gear, { preset: 'mid', slots: { top: { overall: true } } }).slots.some((r) => r.covered), false);
  // No upgrade is suggested for a Bottom left under an overall.
  g.slots.bottom = { tier: 2, ilvl: 150, stars: 0, pot: 1 };
  assert.deepEqual(A.upgradeOptions(gear, g, DATA.upgrades).filter((o) => o.slotId === 'bottom'), []);

  // Picking an overall from the list marks Top; the page says Bottom is covered.
  setState({ gear: { c: { preset: 'mid', slots: {}, history: [] } } });
  const el = await show(GearPage);
  el.find((n) => n.localName === 'button' && n.attrs['aria-label'] === 'Top: edit').fire('click');
  await tick(20);
  const dialog = () => el.find((n) => n.attrs.role === 'dialog');
  const box = dialog().find((n) => n.attrs['aria-label'] === 'Item name');
  box.fire('focus');
  box.value = 'Arcane Umbra Knight';
  box.fire('input', { currentTarget: box });
  assert.ok(await until(() => dialog().find((n) => n.attrs.role === 'option')), 'the item list suggests the overall');
  dialog().find((n) => n.attrs.role === 'option').fire('mousedown');
  await tick(5);
  const saved = store.getState().gear.c.slots.top;
  assert.deepEqual([saved.note, saved.overall, saved.tier], ['Arcane Umbra Knight Suit', true, 2]);
  assert.match(dialog().text.replace(/\s+/g, ' '), /Overall \(fills the Bottom slot too/);
  assert.match(el.find((n) => n.localName === 'button' && n.attrs['aria-label'] === 'Bottom: edit').attrs.title, /covered by the overall/);
  assert.doesNotMatch(el.text.replace(/\s+/g, ' '), /Bottom \d+% empty/);
  close(el);
});

// ---------- 57, 61: Beyond Burning in the level gates ----------
test('level gates: nothing is free after Beyond Burning ends or before an announced run starts', () => {
  const exp = DATA.upgrades.exp;
  const now = Date.parse('2027-03-01T00:00:00Z');
  const data = { ...DATA, events: { events: [{ title: 'Beyond Burning', start: '2026-11-01T00:00:00Z', end: '2027-02-09T23:59:00Z' }] } };
  const c = { id: 'c', name: 'T', level: 270, beyondBurning: true };
  // The last reading is from before the end; now is after it.
  const st = { level: { c: { log: [{ t: Date.parse('2027-02-01T00:00:00Z'), level: 270, pct: 0 }] } } };
  const o = L.levelOutlook(data, st, c, now);
  assert.equal(o.beyond, false);
  const noLog = L.levelOutlook(data, { level: {} }, c, now);
  for (const lvl of [275, 280]) {
    const want = U.expToReach(exp, 270, 0, lvl, false);
    assert.equal(o.gates.find((g) => g.level === lvl).need, want, `Lv. ${lvl} from a reading`);
    assert.equal(noLog.gates.find((g) => g.level === lvl).need, want, `Lv. ${lvl} from Characters`);
  }
  // While the event runs the free levels are still counted.
  const during = L.levelOutlook(data, st, c, Date.parse('2027-02-02T00:00:00Z'));
  assert.equal(during.beyond, true);
  assert.equal(during.gates.find((g) => g.level === 275).need, U.expToReach(exp, 270, 0, 275, true));

  // Between two runs: the next one is only announced.
  const two = { ...DATA, events: { events: [{ title: 'Beyond Burning', start: '2026-06-01T00:00:00Z', end: '2026-09-01T23:59:00Z' }, { title: 'Beyond Burning', start: '2027-06-01T00:00:00Z', end: '2027-09-01T23:59:00Z' }] } };
  const mid = Date.parse('2026-11-26T00:00:00Z');
  assert.equal(L.beyondBurningEnd(two, mid), Date.parse('2026-09-01T23:59:00Z'));
  const c264 = { id: 'c', name: 'T', level: 264, beyondBurning: true };
  const gap = L.levelOutlook(two, { level: {} }, c264, mid);
  assert.equal(gap.beyond, false);
  assert.equal(gap.gates.find((g) => g.level === 270).need, U.expToReach(exp, 264, 0, 270, false));
  // Only an announced run: nothing yet. Once it starts, it counts.
  const announced = { ...DATA, events: { events: [two.events.events[1]] } };
  assert.equal(L.levelOutlook(announced, { level: {} }, c264, mid).beyond, false);
  assert.equal(L.levelOutlook(announced, { level: {} }, c264, Date.parse('2027-06-02T00:00:00Z')).beyond, true);
  // No run in the news at all: the season end stands in, as before.
  assert.equal(L.beyondBurningEnd({ ...DATA, events: { events: [] } }, mid), Date.parse(DATA.season.ends));
});

// ---------- 59, 60: the level log ----------
test('level log: a later, lower reading wins over a mistyped high one', () => {
  const t0 = Date.parse('2026-11-20T00:00:00Z');
  const row = (d, level, pct) => ({ t: t0 + d * DAY, level, pct });
  const log = [row(0, 264, 10), row(1, 284, 20), row(2, 264, 30), row(3, 264, 50)];
  assert.deepEqual(L.standingLog(log).map((r) => r.pct), [10, 30, 50]);
  assert.deepEqual(L.standingLog([row(3, 264, 50), row(1, 284, 20)]).map((r) => r.pct), [50], 'the order they are stored in does not matter');
  assert.deepEqual(L.standingLog(undefined), []);
  const c = { id: 'c', name: 'T', level: 264 };
  const st = { level: { c: { log } } };
  assert.equal(L.knownLevel(DATA, st, c), 264);
  assert.ok(L.levelOutlook(DATA, st, c, t0 + 3.5 * DAY).rate, 'the rate comes back too');
  // A high reading with nothing after it still stands (it may be right).
  assert.equal(L.knownLevel(DATA, { level: { c: { log: [row(0, 264, 10), row(1, 266, 0)] } } }, c), 266);
});

test('level log: every reading can be deleted, and deleting the only one puts the level back', async () => {
  const t0 = Date.now() - 20 * DAY;
  const log = [{ t: t0, level: 284, pct: 1 }, ...Array.from({ length: 8 }, (_, i) => ({ t: t0 + (i + 1) * DAY, level: 264, pct: 10 + i }))];
  setState({ level: { c: { log } }, ui: { ...store.blankState().ui, progressView: 'level' } });
  let el = await show(ProgressPage);
  const dels = () => el.findAll((n) => n.localName === 'button' && n.attrs['aria-label'] === 'Delete this reading');
  assert.equal(dels().length, 7, 'the last six and the ignored one');
  assert.match(el.text.replace(/\s+/g, ' '), /Ignored: a later reading has a lower level/);
  el.find((n) => n.localName === 'button' && /^Show all 9 readings$/.test(n.text.trim())).fire('click');
  assert.ok(await until(() => dels().length === 9));
  dels()[8].fire('click'); // the oldest row, the slip
  await tick(5);
  assert.deepEqual(store.getState().level.c.log.map((r) => r.level), Array(8).fill(264));
  close(el);

  // "Log it" remembers the level it replaces; deleting that reading puts it back.
  setState({ level: {}, ui: { ...store.blankState().ui, progressView: 'level' } });
  el = await show(ProgressPage);
  const form = el.find((n) => n.localName === 'form');
  const RealFormData = globalThis.FormData;
  globalThis.FormData = class { get(k) { return { level: '284', pct: '5' }[k]; } };
  try { form.fire('submit', { currentTarget: { reset() {} } }); } finally { globalThis.FormData = RealFormData; }
  await tick(5);
  assert.equal(store.getState().characters[0].level, 284);
  assert.equal(store.getState().level.c.log[0].was, 264);
  assert.ok(await until(() => dels().length === 1));
  dels()[0].fire('click');
  await tick(5);
  assert.deepEqual(store.getState().level.c.log, []);
  assert.equal(store.getState().characters[0].level, 264);
  close(el);
});
