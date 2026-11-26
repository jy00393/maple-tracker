// Fifth round, inputs and phone: things a player meets in a minute of ordinary use.
// Enter saves a meso box (also inside a form), meso boxes open the full phone keyboard, removing a logged drop asks
// first, an outside tap only closes the More sheet, each streak day can be picked, and small dead ends are gone.
// Nothing here waits a fixed time for a redraw: every step waits on the thing it needs (`until`).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

const siteFile = (name) => fileURLToPath(new URL(`../../site/${name}`, import.meta.url));
const files = {};
for (const f of readdirSync(siteFile('data'))) if (f.endsWith('.json')) files[`data/${f}`] = siteFile(`data/${f}`);
installFakeBrowser({ files });

// The app's own root, and a record of what it listens for on the document (the app is started in the last test).
const appRoot = new FakeNode('div');
const docListeners = {};
document.getElementById = () => appRoot;
document.addEventListener = (type, fn) => { (docListeners[type] ||= new Set()).add(fn); };
document.removeEventListener = (type, fn) => { if (docListeners[type]) docListeners[type].delete(fn); };
const winListeners = {};
window.addEventListener = (type, fn) => { (winListeners[type] ||= new Set()).add(fn); };
window.removeEventListener = (type, fn) => { if (winListeners[type]) winListeners[type].delete(fn); };

const { html, render } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const { MesoInput, NumberInput, Counter } = await import('../../site/app/ui.js');
const { MesosPage } = await import('../../site/app/pages/mesos.js');
const { CharactersPage } = await import('../../site/app/pages/characters.js');
const { QuickSetup } = await import('../../site/app/pages/setup.js');
const { PitchedCard } = await import('../../site/app/pages/pitched.js');
const { StreakCard } = await import('../../site/app/pages/session.js');
const { CombatPowerCard } = await import('../../site/app/pages/bosscp.js');
const { Item } = await import('../../site/app/pages/checklist.js');

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
after(() => { for (const el of mounted) render(null, el); render(null, appRoot); });
function mount(vnode) {
  const el = new FakeNode('div');
  mounted.push(el);
  render(vnode, el);
  return el;
}
const unmount = (el) => { render(null, el); mounted.splice(mounted.indexOf(el), 1); };
// Waits for a condition, however slow the machine is; never a fixed pause.
async function until(check, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return true; await tick(5); }
  return Boolean(check());
}
function setState(mutator = () => {}) {
  const s = store.blankState();
  s.characters = [{ id: 'c1', name: 'Solo', cls: 'Erel Light', level: 264, region: 'na', world: 'heroic', challenger: true, mainStat: 'STR' }];
  s.activeId = 'c1';
  mutator(s);
  store.replaceState(s, true);
}
// A page or card drawn from the live store, redrawn when the store changes.
function show(draw) {
  const App = () => draw(store.useStore());
  return mount(html`<${App} />`);
}
const flag = (node, name) => node[name] === true || (name in node.attrs && node.attrs[name] !== 'false');
const labelled = (el, re, tag) => el.find((n) => (!tag || n.localName === tag) && re.test(n.attrs['aria-label'] || ''));
const squash = (el) => el.text.replace(/\s+/g, ' ');
// Typing, as the browser reports it: the box holds the text and an input event fires. No blur.
function typeInto(box, text) {
  box.value = text;
  box.fire('input', { currentTarget: box });
}
const enter = (box) => box.fire('keydown', { key: 'Enter', currentTarget: box });

// ---- 45: the phone keyboard -------------------------------------------------------------------------------------
test('45 a meso box asks the phone for the full keyboard, a plain number box keeps the keypad', () => {
  const el = mount(html`<div><${MesoInput} label="Combat Power" placeholder="e.g. 45M" value=${null} onChange=${() => {}} />
    <${NumberInput} label="Level" value=${200} onChange=${() => {}} /></div>`);
  const meso = labelled(el, /^Combat Power$/, 'input');
  assert.equal(meso.attrs.inputmode, 'text', 'letters and a dot can be typed: 45M, 1.5B');
  assert.equal(meso.attrs.autocapitalize, 'off');
  assert.equal(meso.attrs.autocorrect, 'off');
  assert.equal(meso.attrs.autocomplete, 'off');
  assert.ok(!flag(meso, 'spellcheck'), 'no red underline under 45m');
  assert.equal(labelled(el, /^Level$/, 'input').attrs.inputmode, 'numeric', 'whole numbers keep the digit keypad');
  unmount(el);
});

test('45 every meso box on Mesos, Bosses and Characters, and the goal Cost box, takes letters', async () => {
  setState();
  for (const draw of [
    (state) => html`<${MesosPage} data=${DATA} state=${state} />`,
    (state) => html`<${CombatPowerCard} data=${DATA} state=${state} char=${state.characters[0]} />`,
    (state) => html`<${CharactersPage} data=${DATA} state=${state} />`
  ]) {
    const el = show(draw);
    const boxes = el.findAll((n) => n.localName === 'input' && /\d\s?[kmb]\b/i.test(n.attrs.placeholder || ''));
    assert.ok(boxes.length > 0, 'the page has a box whose hint shows a unit');
    for (const box of boxes) {
      assert.notEqual(box.attrs.inputmode, 'decimal', `${box.attrs['aria-label'] || box.attrs.name}: not the digits-only keypad`);
      assert.notEqual(box.attrs.inputmode, 'numeric', `${box.attrs['aria-label'] || box.attrs.name}: not the digits-only keypad`);
      assert.equal(box.attrs.autocapitalize, 'off', `${box.attrs['aria-label'] || box.attrs.name}: no automatic capital`);
    }
    unmount(el);
  }
});

// ---- 23: Enter saves --------------------------------------------------------------------------------------------
test('23 Enter in a meso box saves what was typed, once', () => {
  const got = [];
  const el = mount(html`<${MesoInput} label="Amount" value=${null} onChange=${(v) => got.push(v)} />`);
  const box = labelled(el, /^Amount$/, 'input');
  typeInto(box, '2b');
  box.fire('keydown', { key: 'b', currentTarget: box });
  assert.deepEqual(got, [], 'typing alone saves nothing');
  enter(box);
  assert.deepEqual(got, [2e9]);
  box.fire('blur', { currentTarget: box });
  assert.deepEqual(got, [2e9], 'leaving the box afterwards does not save again');
  // The browser's own "change" (what a phone's Done key gives) saves too.
  typeInto(box, '750m');
  box.fire('change', { currentTarget: box });
  assert.deepEqual(got, [2e9, 750e6]);
  // Text that cannot be read is not saved by Enter either, and an emptied box clears the amount.
  typeInto(box, '1.5');
  enter(box);
  assert.deepEqual(got, [2e9, 750e6]);
  typeInto(box, '');
  enter(box);
  assert.deepEqual(got, [2e9, 750e6, null]);
  unmount(el);
});

test('23 Mesos: Enter in "Mesos you have now" saves it without leaving the box', async () => {
  setState();
  const el = show((state) => html`<${MesosPage} data=${DATA} state=${state} />`);
  const box = labelled(el, /^Mesos held$/, 'input');
  typeInto(box, '2b');
  assert.equal(store.getState().mesos.held, 0);
  enter(box);
  assert.equal(store.getState().mesos.held, 2e9);
  unmount(el);
});

test('23 Characters: Enter in the Combat Power box saves the character with it', async () => {
  setState((s) => { s.characters = []; s.activeId = null; });
  const el = show((state) => html`<${CharactersPage} data=${DATA} state=${state} />`);
  typeInto(el.find((n) => n.attrs.id === 'char-name'), 'AltBishop');
  assert.ok(await until(() => !flag(el.find((n) => n.localName === 'button' && /^Add/.test(n.text.trim()) && n.attrs.type === 'submit'), 'disabled')));
  const cp = labelled(el, /^Combat Power$/, 'input');
  typeInto(cp, '45m');
  // What Enter does in a browser: keydown on the box, then the form submits at once. No blur, no redraw between.
  enter(cp);
  el.find((n) => n.localName === 'form').fire('submit');
  const saved = store.getState().characters;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'AltBishop');
  assert.equal(saved[0].cp, 45e6);
  unmount(el);
});

test('23 Characters: editing with Enter keeps the other fields and takes the new Combat Power', async () => {
  setState((s) => { s.characters[0].cp = 30e6; });
  const el = show((state) => html`<${CharactersPage} data=${DATA} state=${state} />`);
  el.find((n) => n.localName === 'button' && /^Edit/.test(n.text.trim())).fire('click');
  assert.ok(await until(() => labelled(el, /^Combat Power$/, 'input')));
  const cp = labelled(el, /^Combat Power$/, 'input');
  typeInto(cp, '52m');
  enter(cp);
  cp.parentNode.parentNode.parentNode.fire('submit');
  const c = store.getState().characters[0];
  assert.equal(c.cp, 52e6);
  assert.equal(c.name, 'Solo');
  assert.equal(c.level, 264);
  assert.equal(c.challenger, true);
  unmount(el);
});

test('23 first-run setup: Enter in the Combat Power box starts tracking with it', async () => {
  setState((s) => { s.characters = []; s.activeId = null; });
  const el = mount(html`<${QuickSetup} data=${DATA} />`);
  typeInto(el.find((n) => n.attrs.id === 'qs-name'), 'Newcomer');
  const cp = labelled(el, /^Combat Power$/, 'input');
  typeInto(cp, '45m');
  enter(cp);
  el.find((n) => n.localName === 'form').fire('submit');
  const saved = store.getState().characters;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'Newcomer');
  assert.equal(saved[0].cp, 45e6);
  unmount(el);
});

// ---- 46: removing a logged drop ---------------------------------------------------------------------------------
test('46 the × on a logged Pitched drop asks first: Keep leaves it, Remove deletes it', async () => {
  const now = Date.parse('2026-10-10T03:00:00Z');
  const item = DATA.pitched.sets[0].items[0];
  setState((s) => { s.pitch = { c1: { drops: [{ id: 'd1', item: item.id, d: '2026-10-03' }, { id: 'd2', item: item.id, d: '2026-10-08' }] } }; });
  const el = show((state) => html`<${PitchedCard} data=${DATA} state=${state} char=${state.characters[0]} now=${now} />`);
  const x = () => labelled(el, /^Remove the .+ drop of 3 Oct 2026$/, 'button');
  const yes = () => labelled(el, /^Yes, remove the .+ drop of 3 Oct 2026$/, 'button');
  const keep = () => labelled(el, /^Keep the .+ drop of 3 Oct 2026$/, 'button');
  const ids = () => store.getState().pitch.c1.drops.map((d) => d.id);
  assert.ok(x() && !yes(), 'no question until the × is pressed');
  x().fire('click');
  assert.ok(await until(() => yes() && keep()), 'one tap only asks');
  assert.deepEqual(ids(), ['d1', 'd2'], 'one tap deletes nothing');
  assert.ok(labelled(el, /^Remove the .+ drop of 8 Oct 2026$/, 'button'), 'the other drop is not asked about');
  keep().fire('click');
  assert.ok(await until(() => x() && !yes()));
  assert.deepEqual(ids(), ['d1', 'd2']);
  x().fire('click');
  assert.ok(await until(() => yes()));
  yes().fire('click');
  assert.ok(await until(() => !squash(el).includes('3 Oct 2026')));
  assert.deepEqual(ids(), ['d2']);
  unmount(el);
});

test('46 the × and the question buttons are finger-sized on phones', () => {
  const css = readFileSync(siteFile('styles.css'), 'utf8');
  // The phone block has to come after the plain rule, or the plain rule would win.
  const plainAt = css.indexOf('\n.tagdate .x {');
  assert.ok(plainAt > 0);
  const phone = css.slice(plainAt + 1).split('@media (max-width: 900px)').slice(1).join('\n');
  const px = (selector, name) => {
    const rule = new RegExp(`\\n\\s+${selector} \\{([^}]*)\\}`).exec(phone);
    return rule ? Number((new RegExp(`${name}:\\s*(\\d+)px`).exec(rule[1]) || [])[1]) : NaN;
  };
  assert.ok(px('\\.tagdate \\.x', 'min-width') >= 32 && px('\\.tagdate \\.x', 'min-height') >= 32, 'the ×: at least 32px each way');
  assert.ok(px('\\.tagdate\\.ask button', 'min-height') >= 32, 'Remove and Keep: at least 32px tall');
});

// ---- 48: the streak squares -------------------------------------------------------------------------------------
test('48 a streak square shows its date and count when tapped, and with the arrow keys', async () => {
  const now = Date.parse('2026-11-26T03:00:00Z');
  setState((s) => { s.checklist.history = { '2026-11-24': { done: 7, total: 7 }, '2026-11-25': { done: 5, total: 7 }, '2026-11-26': { done: 2, total: 7 } }; });
  const el = show((state) => html`<${StreakCard} state=${state} now=${now} />`);
  const line = () => squash(el.find((n) => /heat-day/.test(n.attrs.class || '')));
  const cells = () => el.find((n) => /^heat$/.test(n.attrs.class || '')).childNodes;
  const cell = (re) => cells().find((n) => re.test(n.attrs['aria-label'] || ''));
  assert.match(line(), /Today: 2 of 7 core dailies/, 'before any tap the line is about today');
  assert.ok(cells().every((n) => n.localName === 'button' && n.attrs['aria-label']), 'every square is a named button');
  assert.equal(cells().filter((n) => n.attrs.tabindex === '0').length, 1, 'one Tab stop, not 100');
  cell(/^25 Nov 2026/).fire('click');
  assert.ok(await until(() => /25 Nov 2026: 5 of 7 core dailies/.test(line())), line());
  assert.equal(cell(/^25 Nov 2026/).attrs['aria-pressed'], 'true');
  // Up is the day before, left the week before; the keyboard focus goes along.
  let focused = null;
  for (const n of cells()) n.focus = () => { focused = n; };
  cell(/^25 Nov 2026/).fire('keydown', { key: 'ArrowUp' });
  assert.ok(await until(() => /24 Nov 2026: 7 of 7 core dailies/.test(line())), line());
  assert.equal(focused, cell(/^24 Nov 2026/));
  cell(/^24 Nov 2026/).fire('keydown', { key: 'ArrowLeft' });
  assert.ok(await until(() => /17 Nov 2026: no record/.test(line())), line());
  assert.equal(cells().filter((n) => n.attrs.tabindex === '0').length, 1);
  // Past the last square nothing moves.
  cell(/^26 Nov 2026/).fire('click');
  assert.ok(await until(() => /Today: 2 of 7/.test(line())));
  cell(/^26 Nov 2026/).fire('keydown', { key: 'ArrowDown' });
  cell(/^26 Nov 2026/).fire('keydown', { key: 'Home' });
  assert.ok(await until(() => cells()[0].attrs['aria-pressed'] === 'true'));
  unmount(el);
});

// ---- 29: small dead ends ----------------------------------------------------------------------------------------
test('29 a refused goal\'s message goes away on the next goal action; arrows at the ends are disabled', async () => {
  setState((s) => { s.mesos.goals = [{ id: 'g1', name: 'One', cost: 1e9 }, { id: 'g2', name: 'Two', cost: 2e9 }, { id: 'g3', name: 'Three', cost: 3e9 }]; });
  const el = show((state) => html`<${MesosPage} data=${DATA} state=${state} />`);
  const ERR = /Type the cost like 750m/;
  const names = () => store.getState().mesos.goals.map((g) => g.name).join(',');
  const form = () => el.find((n) => n.localName === 'form' && n.find((c) => c.attrs.name === 'cost'));
  const refuse = async () => {
    const values = { name: 'Thing', cost: '1.5' };
    const realFormData = globalThis.FormData;
    globalThis.FormData = class { get(k) { return values[k]; } };
    try { form().fire('submit', { currentTarget: { reset() {} } }); } finally { globalThis.FormData = realFormData; }
    assert.ok(await until(() => ERR.test(squash(el))), 'the refused cost says why');
  };
  const gone = async (what) => assert.ok(await until(() => !ERR.test(squash(el))), `the message is gone after ${what}`);

  await refuse();
  labelled(el, /^Move down: One$/, 'button').fire('click');
  await gone('a move');
  assert.equal(names(), 'Two,One,Three');

  await refuse();
  labelled(el, /^Remove: Three$/, 'button').fire('click');
  await gone('a remove');
  assert.equal(names(), 'Two,One');

  await refuse();
  el.find((n) => n.localName === 'button' && /^\+ 200 Bright Cubes/.test(n.text.trim())).fire('click');
  await gone('adding a suggested goal');
  assert.equal(store.getState().mesos.goals.length, 3);

  await refuse();
  form().fire('input');
  await gone('typing in the form again');

  const goals = store.getState().mesos.goals;
  const first = String(goals[0].name);
  const last = String(goals[goals.length - 1].name);
  const btn = (text) => el.find((n) => n.localName === 'button' && n.attrs['aria-label'] === text);
  assert.ok(flag(btn('Move up: ' + first), 'disabled'), 'the first goal cannot move up');
  assert.ok(!flag(btn('Move down: ' + first), 'disabled'));
  assert.ok(flag(btn('Move down: ' + last), 'disabled'), 'the last goal cannot move down');
  assert.ok(!flag(btn('Move up: ' + last), 'disabled'));
  unmount(el);
});

test('29 a checklist counter greys − at 0 and + at its cap, and a press there still reaches the owner', async () => {
  const steps = [];
  const draw = (value) => html`<${Counter} value=${value} target=${10} label="Runs" onStep=${(d) => steps.push(d)} />`;
  const el = mount(draw(0));
  const minus = () => labelled(el, /^One fewer: Runs$/, 'button');
  const plus = () => labelled(el, /^One more: Runs$/, 'button');
  assert.equal(minus().attrs['aria-disabled'], 'true');
  assert.equal(plus().attrs['aria-disabled'], 'false');
  render(draw(4), el);
  assert.equal(minus().attrs['aria-disabled'], 'false');
  assert.equal(plus().attrs['aria-disabled'], 'false');
  render(draw(10), el);
  assert.equal(plus().attrs['aria-disabled'], 'true');
  // The drawn count can be a moment old (a reset just passed), so the owner still gets the press and decides.
  plus().fire('click');
  assert.deepEqual(steps, [1]);
  unmount(el);

  const css = readFileSync(siteFile('styles.css'), 'utf8');
  assert.match(css, /\.iconbtn\[aria-disabled="true"\][^{]*\{[^}]*opacity/, 'a greyed look exists for it');
  assert.match(css, /\.iconbtn:disabled[^{]*\{[^}]*opacity/, 'and for a disabled arrow outside a stepper');

  // On the real checklist: the first count item, at 0, then pressed to its cap.
  const group = DATA.checklist.groups.find((g) => g.items.some((i) => i.type === 'count'));
  const item = group.items.find((i) => i.type === 'count');
  setState();
  const who = { id: 'c1', level: 264, challenger: true };
  const now = Date.now();
  const row = show((state) => html`<${Item} item=${item} group=${group} cs=${state.checklist} now=${now} who=${who} />`);
  const rowPlus = () => labelled(row, /^One more: /, 'button');
  assert.equal(labelled(row, /^One fewer: /, 'button').attrs['aria-disabled'], 'true');
  for (let i = 0; i < item.target; i++) rowPlus().fire('click');
  assert.ok(await until(() => rowPlus().attrs['aria-disabled'] === 'true'), 'the + greys at the cap');
  unmount(row);
});

// ---- 21: Monster Park free clears -------------------------------------------------------------------------------
test('21 the Monster Park Sweep row says the free clears are shared in the world, as the EXP data does', () => {
  const item = DATA.checklist.groups.flatMap((g) => g.items).find((i) => i.id === 'd-mp');
  assert.match(DATA.expSources.monsterPark.note, /free clears a day per world/, 'the rule the note leans on is in the data');
  assert.match(item.note, new RegExp(`${DATA.expSources.monsterPark.freePerDay} free clears a day are shared by every character in the same world`));
  // Not one tick for the whole account: a character in another world has its own free clears.
  assert.notEqual(item.scope, 'account');
});

// ---- 47: the More sheet (the whole app is started here) ---------------------------------------------------------
test('47 an outside tap on the More sheet lands on a backdrop that only closes it', async () => {
  setState();
  Object.defineProperty(appRoot, 'textContent', { set() {}, get() { return ''; }, configurable: true });
  await import('../../site/app/main.js');
  const nav = () => appRoot.find((n) => n.attrs.class === 'bottomnav');
  // Started means drawn and settled: the app listens for the address changing only once its first draw's effects
  // have run (one of them closes the sheet, which must not land after the click below).
  assert.ok(await until(() => nav() && winListeners.hashchange && winListeners.hashchange.size === 1), 'the app started');
  const sheet = () => appRoot.find((n) => n.attrs.class === 'more-sheet');
  const back = () => appRoot.find((n) => n.attrs.class === 'more-back');
  const moreBtn = () => nav().find((n) => n.localName === 'button' && /More/.test(n.text));
  assert.ok(!sheet() && !back(), 'closed: no sheet and nothing over the page');

  moreBtn().fire('click');
  assert.ok(await until(() => sheet() && back()), 'open: the sheet and a backdrop');
  // The backdrop is outside the bar (so it can cover the whole screen) and comes before it (so the bar stays on top).
  assert.ok(!nav().find((n) => n === back()), 'the backdrop is not inside the bar');
  const siblings = back().parentNode.childNodes;
  assert.ok(siblings.indexOf(back()) < siblings.indexOf(nav()));
  // Nothing closes the sheet from a document-wide pointer listener any more: that let the same tap reach the page.
  assert.ok(await until(() => docListeners.keydown && docListeners.keydown.size === 1), 'Escape still closes it');
  assert.equal((docListeners.pointerdown || new Set()).size, 0);

  const before = localStorage.getItem('maple-tracker:v1');
  back().fire('click');
  assert.ok(await until(() => !sheet() && !back()), 'the tap closed the sheet and took the backdrop away');
  assert.equal(localStorage.getItem('maple-tracker:v1'), before, 'and changed nothing');

  moreBtn().fire('click');
  assert.ok(await until(() => sheet() && docListeners.keydown.size === 1));
  for (const fn of [...docListeners.keydown]) fn({ key: 'Escape' });
  assert.ok(await until(() => !sheet() && !back()));

  const css = readFileSync(siteFile('styles.css'), 'utf8');
  assert.match(css, /\.more-back \{ display: none; \}/, 'no backdrop on a wide screen, where there is no bottom bar');
  const rule = /\n\s+\.more-back \{([^}]*)\}/.exec(css.split('@media (max-width: 760px)').slice(1).join('\n'));
  assert.ok(rule && /display:\s*block/.test(rule[1]) && /position:\s*fixed/.test(rule[1]) && /inset:\s*0/.test(rule[1]), 'the backdrop covers the screen on phones');
  const z = Number(/z-index:\s*(\d+)/.exec(rule[1])[1]);
  const navZ = Number(/\.bottomnav \{[^}]*z-index:\s*(\d+)/.exec(css)[1]);
  assert.ok(z < navZ, 'under the bar and its sheet');
});
