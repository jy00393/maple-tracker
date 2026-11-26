// Third round, interface side: fixes to the second round's fixes.
// Cube odds boxes ignore out-of-range numbers again, a Stepper button always replaces typed text,
// counts of one take a singular noun everywhere, and the plural fold in dedupeEvents covers names ending in "e".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

const siteFile = (name) => fileURLToPath(new URL(`../../site/${name}`, import.meta.url));
installFakeBrowser({ files: { 'data/items.json': siteFile('data/items.json') } });

const { html, render, useState } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const { NumberInput, Stepper, plural } = await import('../../site/app/ui.js');
const { dedupeEvents, eventKey } = await import('../../site/app/calc/events.js');
const { slotProgress, erdaNextSteps } = await import('../../site/app/calc/progress.js');
const { MesosPage } = await import('../../site/app/pages/mesos.js');
const { TodayPage } = await import('../../site/app/pages/today.js');
const { GearPage } = await import('../../site/app/pages/gear.js');
const { ProgressPage } = await import('../../site/app/pages/progress.js');

const load = (name) => JSON.parse(readFileSync(siteFile(`data/${name}.json`), 'utf8'));
const DATA = {
  bosses: load('bosses'), symbols: load('symbols'), liberation: load('liberation'), ibp: load('ibp'), checklist: load('checklist'),
  gear: load('gear'), erda: load('erda'), upgrades: load('upgrades'), potential: load('potential'), gearStats: load('gearstats'),
  events: { events: [], sunny: [] }, news: { items: [] }, nexonCharacters: { characters: [] }, meta: null, tables: load('tables'), season: load('season'),
  pitched: load('pitched'), shops: { source: 'test', shops: [] }, flames: load('flames'), champions: load('champions'), expSources: load('expsources'),
  upcoming: { items: [] }, bossCp: load('bosscp'), classes: load('classes')
};
DATA.bossById = Object.fromEntries(DATA.bosses.bosses.map((b) => [b.id, b]));

const mounted = [];
after(() => { for (const el of mounted) render(null, el); });
function mount(vnode) {
  const el = new FakeNode('div');
  mounted.push(el);
  render(vnode, el);
  return el;
}
const unmount = (el) => render(null, el);
// Every test starts from its own state, loaded the way saved data is (normalise and sanitise run).
function setState(mutator) {
  const s = store.blankState();
  s.characters = [{ id: 'c1', name: 'Solo', cls: 'Erel Light', level: 264, region: 'na', world: 'heroic', challenger: true, mainStat: 'STR' }];
  s.activeId = 'c1';
  mutator(s);
  store.replaceState(s, true);
}
async function show(Page) {
  const App = () => html`<${Page} data=${DATA} state=${store.useStore()} />`;
  const el = mount(html`<${App} />`);
  await tick(5);
  return el;
}
async function textOf(Page, mutator) {
  setState(mutator);
  const el = await show(Page);
  const t = el.text.replace(/\s+/g, ' ');
  unmount(el);
  return t;
}
const boxText = (box) => String(box.value ?? box.attrs.value ?? '');
async function type(box, chars) {
  for (const ch of chars) {
    box.value = boxText(box) + ch;
    box.fire('input', { currentTarget: box });
    await tick(5);
  }
}
async function clearBox(box) {
  box.value = '';
  box.fire('input', { currentTarget: box });
  await tick(5);
}
const byLabel = (el, re) => el.find((n) => n.localName === 'input' && re.test(n.attrs['aria-label'] || ''));
const button = (el, re) => el.find((n) => n.localName === 'button' && re.test(n.text.trim()));

// ---- 14 ------------------------------------------------------------------------------------------------------
test('14 a cube odds box saves nothing for a number outside 0.1 to 100, and still saves one inside', async () => {
  setState((s) => { s.ui.mesosView = 'cubes'; });
  const el = await show(MesosPage);
  const box = byLabel(el, /Bright.*tier-up 3 percent/);
  const estimate = boxText(box);
  for (const slip of ['0', '250', '0.05', '-5', '100.5', '1e30']) {
    await clearBox(box);
    box.value = slip;
    box.fire('input', { currentTarget: box });
    await tick(5);
    assert.equal(store.getState().mesos.cubeRates, undefined, `${slip} is ignored, not saved as the nearest limit`);
  }
  // The limits themselves are allowed.
  await clearBox(box);
  await type(box, '100');
  assert.equal(store.getState().mesos.cubeRates.bright[2], 1);
  await clearBox(box);
  await type(box, '0.1');
  assert.ok(Math.abs(store.getState().mesos.cubeRates.bright[2] - 0.001) < 1e-12);
  // A slip typed over a saved value leaves the saved value alone, and leaving the box shows it again.
  await clearBox(box);
  await type(box, '25');
  assert.equal(store.getState().mesos.cubeRates.bright[2], 0.25);
  await type(box, '0');
  assert.equal(boxText(box), '250');
  assert.equal(store.getState().mesos.cubeRates.bright[2], 0.25, '250 does not become 100%');
  box.fire('blur', { currentTarget: box });
  await tick(5);
  assert.equal(boxText(box), '25');
  // "Reset to the estimates" also clears a typed number that was never saved, without the box being left.
  button(el, /^Reset to the estimates$/).fire('click');
  await tick(5);
  assert.equal(store.getState().mesos.cubeRates, undefined);
  assert.equal(boxText(box), estimate);
  await clearBox(box);
  box.value = '250'; // pasted in one go: nothing on the way to it is in range
  box.fire('input', { currentTarget: box });
  await tick(5);
  assert.equal(boxText(box), '250');
  assert.equal(store.getState().mesos.cubeRates, undefined);
  button(el, /^Reset to the estimates$/).fire('click');
  await tick(5);
  assert.equal(boxText(box), estimate, 'the box shows the odds in use, not the ignored 250');
  unmount(el);
});

test('14 other number boxes still cap what is typed (clamp is on unless switched off)', async () => {
  const seen = [];
  const el = mount(html`<${NumberInput} label="Capped" value=${5} min=${2} max=${10} onChange=${(n) => seen.push(n)} />`);
  await tick(5);
  const box = el.find((n) => n.localName === 'input');
  for (const text of ['99', '1', '-4']) { box.value = text; box.fire('input', { currentTarget: box }); }
  assert.deepEqual(seen, [10, 2, 2]);
  unmount(el);
  const raw = [];
  const el2 = mount(html`<${NumberInput} label="Raw" value=${5} min=${2} max=${10} clamp=${false} onChange=${(n) => raw.push(n)} />`);
  await tick(5);
  const box2 = el2.find((n) => n.localName === 'input');
  for (const text of ['99', '1', '7.6', '']) { box2.value = text; box2.fire('input', { currentTarget: box2 }); }
  assert.deepEqual(raw, [99, 1, 8, null], 'passed on as typed; whole-number rounding and the empty box are unchanged');
  unmount(el2);
});

// ---- 15 ------------------------------------------------------------------------------------------------------
test('15 a Stepper button replaces the typed text even when it lands on the number already saved', async () => {
  function Stars() {
    const [v, setV] = useState(17);
    return html`<${Stepper} label="Hat stars" value=${v} max=${30} onChange=${(n) => setV(n ?? 0)} presets=${[[0, 'None'], [22, 'Target 22'], [30, 'Max 30']]} />`;
  }
  const el = mount(html`<${Stars} />`);
  await tick(5);
  const box = el.find((n) => n.localName === 'input');
  const chip = (re) => el.find((n) => n.localName === 'button' && re.test(n.text));
  await clearBox(box);
  await type(box, '99');
  assert.equal(boxText(box), '99', 'not rewritten while typing');
  assert.equal(chip(/Max 30/).attrs['aria-pressed'], 'true', '99 was saved as the cap, 30');
  chip(/Max 30/).fire('click');
  await tick(5);
  assert.equal(boxText(box), '30', 'the press shows through without leaving the box');
  // Typing still works after a press, and a press that changes the value shows as before.
  await clearBox(box);
  await type(box, '12');
  assert.equal(boxText(box), '12');
  chip(/Target 22/).fire('click');
  await tick(5);
  assert.equal(boxText(box), '22');
  // An emptied box saves 0; "None" (0) then shows 0 instead of leaving the box empty.
  await clearBox(box);
  assert.equal(boxText(box), '');
  chip(/None/).fire('click');
  await tick(5);
  assert.equal(boxText(box), '0');
  // − at the cap after a capped entry: 99 typed, saved 30, − gives 29.
  await clearBox(box);
  await type(box, '99');
  el.find((n) => n.localName === 'button' && /One fewer/.test(n.attrs['aria-label'])).fire('click');
  await tick(5);
  assert.equal(boxText(box), '29');
  unmount(el);
});

// ---- 22 ------------------------------------------------------------------------------------------------------
test('22 plural() picks the noun for the count shown', () => {
  assert.equal(plural(1, 'flame'), 'flame');
  assert.equal(plural(0, 'flame'), 'flames');
  assert.equal(plural(2, 'flame'), 'flames');
  assert.equal(plural(1, 'boss', 'bosses'), 'boss');
  assert.equal(plural(3, 'boss', 'bosses'), 'bosses');
  assert.equal(plural('1', 'day'), 'day');
  assert.equal(plural(1.5, 'day'), 'days');
});

const WRONG = /\b1 (flames|attempts|days|stars|cubes|bosses|weeks|lines|Fragments|claims|traces)\b|\b1 (more useful|useful|damage) lines\b/;

test('22 Mesos: one flame, one attempt and one cube are singular; more than one stay plural', async () => {
  let t = await textOf(MesosPage, (s) => { s.ui.mesosView = 'flames'; s.ui.flameCalc = { level: 150, target: 7, type: 'reset', adv: true }; });
  assert.match(t, /Typical \S+ 1 flame: half of all tries/);
  assert.match(t, /1 flame on average/);
  assert.doesNotMatch(t, WRONG);
  t = await textOf(MesosPage, (s) => { s.ui.mesosView = 'flames'; s.ui.flameCalc = { level: 150, target: 7, type: 'reset', adv: true, have: 1 }; });
  assert.match(t, /with your 1 flame /);
  assert.doesNotMatch(t, WRONG);
  // An event flame has no meso price, so the count itself is the headline.
  const free = DATA.flames.types.find((x) => !x.price);
  if (free) {
    t = await textOf(MesosPage, (s) => { s.ui.mesosView = 'flames'; s.ui.flameCalc = { level: 150, target: 7, type: free.id, adv: true }; });
    assert.match(t, /Typical 1 flame /);
    assert.doesNotMatch(t, WRONG);
  }
  t = await textOf(MesosPage, (s) => { s.ui.mesosView = 'flames'; s.ui.flameCalc = { level: 150, target: 90, type: 'reset', adv: true, have: 5 }; });
  assert.match(t, /\d flames: half of all tries/);
  assert.match(t, /with your 5 flames /);

  t = await textOf(MesosPage, (s) => { s.ui.mesosView = 'starforce'; s.ui.sfCalc = { level: 160, from: 0, to: 1 }; });
  assert.match(t, /\b1 attempt on average/);
  assert.doesNotMatch(t, WRONG);
  t = await textOf(MesosPage, (s) => { s.ui.mesosView = 'starforce'; s.ui.sfCalc = { level: 160, from: 0, to: 12 }; });
  assert.match(t, /\d attempts on average/);

  t = await textOf(MesosPage, (s) => { s.ui.mesosView = 'cubes'; s.mesos.cubeRates = { bright: [1, 1, 1], glowing: [1, 1, 1] }; });
  assert.match(t, /\b1 cube on average/);
  assert.doesNotMatch(t, WRONG);
  t = await textOf(MesosPage, (s) => { s.ui.mesosView = 'cubes'; });
  assert.match(t, /\d cubes on average/);
});

// (The planner now shows the day a step is reached, counted from when its figures were last changed.)
test('22 Sol Erda planner: "1 day" and "1 Fragment"', async () => {
  const st = erdaNextSteps(DATA.erda.templates.erel, { levels: {}, steps: {} }, 6).filter((x) => x.node && x.node !== 'origin')[0];
  const erda = (costs, fragments = 0) => ({ c1: { template: 'erel', levels: {}, steps: {}, solErda: 0, fragments, weekly: { sol: 100, frag: 49 }, costs } });
  let t = await textOf(ProgressPage, (s) => { s.ui.progressView = 'sixth'; s.erda = erda({ [st.id]: { sol: 0, frag: 7 } }, 1); });
  assert.match(t, /\(your entry\).*? about \d+ \w{3}/);
  assert.match(t, /· 1 Fragment held/);
  assert.doesNotMatch(t, WRONG);
  t = await textOf(ProgressPage, (s) => { s.ui.progressView = 'sixth'; s.erda = erda({ [st.id]: { sol: 0, frag: 1 } }); });
  assert.match(t, /\+ 1 Fragment \(your entry\)/);
  assert.match(t, /· 0 Fragments held/);
  t = await textOf(ProgressPage, (s) => { s.ui.progressView = 'sixth'; s.erda = erda({ [st.id]: { sol: 0, frag: 14 } }); });
  assert.match(t, /\+ 14 Fragments \(your entry\).*? about \d+ \w{3}/);
});

test('22 Gear and Today: "+1 star", "1 more useful line", "0 / 1 boss"', async () => {
  const names = ['Rare', 'Epic'];
  assert.deepEqual(slotProgress({ tier: 2, stars: 21, pot: 4, lines: 2 }, { tier: 2, stars: 22, pot: 4, lines: 3 }, names).gaps, ['+1 star', '1 more useful line']);
  assert.deepEqual(slotProgress({ tier: 2, stars: 20, pot: 4, lines: 1 }, { tier: 2, stars: 22, pot: 4, lines: 3 }, names).gaps, ['+2 stars', '2 more useful lines']);

  const oneStarShort = (s) => {
    const slots = {};
    for (const sl of DATA.gear.slots) slots[sl.id] = { temporary: true };
    slots.hat = { tier: 2, ilvl: 150, stars: 21, pot: 4, target: { stars: 22, pot: 4 } };
    s.gear = { c1: { preset: 'mid', slots } };
  };
  let t = await textOf(GearPage, oneStarShort);
  assert.match(t, /\+1 star\b/);
  assert.doesNotMatch(t, WRONG);

  t = await textOf(TodayPage, (s) => { s.bosses = { c1: { picks: { 'lucid-hard': { party: 1 } }, clears: {} } }; });
  assert.match(t, /· 0 \/ 1 boss /);
  t = await textOf(TodayPage, (s) => { s.bosses = { c1: { picks: { 'lucid-hard': { party: 1 }, 'will-hard': { party: 1 } }, clears: {} } }; });
  assert.match(t, /· 0 \/ 2 bosses /);
});

// ---- 29 ------------------------------------------------------------------------------------------------------
test('29 a title that differs only by a plural ending folds, also when the singular ends in e', () => {
  const ev = (title, postId, extra = {}) => ({ id: `${postId}-x`, title, category: 'events', postId, postName: `post ${postId}`, url: `u${postId}`, liveDate: '2026-11-10T00:00:00Z', start: '2026-12-01T00:00:00.000Z', end: '2026-12-15T00:00:00.000Z', ...extra });
  const pairs = [['Hot Time', 'Hot Times'], ['Mega Bundle', 'Mega Bundles'], ['Sol Erda Package', 'Sol Erda Packages'], ['Lucky Surprise', 'Lucky Surprises'],
    ['Cube Sale', 'Cube Sales'], ['Genesis Pass', 'Genesis Passes'], ['Royal Style Box', 'Royal Style Boxes'], ['Burning Event', 'Burning Events']];
  for (const [one, many] of pairs) {
    assert.equal(dedupeEvents([ev(one, 1), ev(many, 2)]).length, 1, `${one} / ${many}`);
    assert.equal(dedupeEvents([ev(many, 1), ev(one, 2)]).length, 1, `${many} / ${one}`);
  }
  // Still apart: another name, another window, or both listed by the same post.
  assert.equal(dedupeEvents([ev('Hot Time', 1), ev('Hot Tips', 2)]).length, 2);
  assert.equal(dedupeEvents([ev('Hot Time', 1), ev('Hot Timer', 2)]).length, 2);
  assert.equal(dedupeEvents([ev('Hot Time', 1), ev('Hot Times', 2, { end: '2026-12-16T00:00:00.000Z' })]).length, 2);
  assert.equal(dedupeEvents([ev('Hot Time', 1), ev('Hot Times', 1)]).length, 2);
  // A name made only of those letters is not folded into nothing.
  assert.equal(dedupeEvents([ev('SSS', 1), ev('EE', 2)]).length, 2);
  // The key hidden events are saved under is unchanged.
  assert.equal(eventKey({ title: 'Hot Times', start: 's', end: 'e' }), 'hottimes|s|e');
});
