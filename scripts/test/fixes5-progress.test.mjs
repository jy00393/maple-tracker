// Fifth round, progress area: figures typed once no longer pretend to count down.
// - Symbol counts and traces remember the day they were typed; their estimates are dates fixed on that day.
// - Mesos held, coins held, claims, crests and Sol Erda show the day they were last changed ("as of 27 Nov").
// - First-run setup without an EXP % saves no reading. Unlock flags follow Progress, work on one press and can
//   be taken back. After the season ends, passed deadlines are not "open". An Interactive character is not told
//   Heroic-only things. First-run wording.
// Every test builds its own state and sets its own clock, and puts both back when it ends. Nothing here waits a
// fixed time for a redraw: a page is read once it listens to the store, and after a click the test waits for the
// change itself.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

installFakeBrowser({});
const { html, render, useEffect } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const { symbolPlan, liberationPlan, dateTyped, typedAt } = await import('../../site/app/calc/progress.js');
const { itemStatus, listedItems, setUnlocked, openAreas } = await import('../../site/app/calc/checklist.js');
const { seasonOutlook } = await import('../../site/app/calc/season.js');
const { applySetup } = await import('../../site/app/calc/setup.js');
const { affordableAt } = await import('../../site/app/calc/advice.js');
const { changedAt } = await import('../../site/app/calc/asof.js');
const { worldName } = await import('../../site/app/calc/world.js');
const { mergeStates, units, sameEntries } = await import('../../site/app/calc/merge.js');
const { fmtDay, asOf } = await import('../../site/app/time.js');
const { TodayPage } = await import('../../site/app/pages/today.js');
const { ProgressPage } = await import('../../site/app/pages/progress.js');
const { ChecklistPage, dailyProgress, whoFor } = await import('../../site/app/pages/checklist.js');
const { MesosPage, goalDates } = await import('../../site/app/pages/mesos.js');
const { GearPage } = await import('../../site/app/pages/gear.js');
const { ShopsView } = await import('../../site/app/pages/shops.js');
const { levelOutlook } = await import('../../site/app/pages/level.js');

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const DAY = 86400000;
const T0 = Date.parse('2026-11-27T03:00:00Z'); // Fri 27 Nov, 12:00 KST

// The game data, with nothing that the refresh job rewrites (events, news, shops), so the tests read the same
// on any day.
function pageData() {
  const names = { gearstats: 'gearStats', expsources: 'expSources', bosscp: 'bossCp' };
  const data = {};
  for (const n of ['bosses', 'symbols', 'liberation', 'ibp', 'checklist', 'gear', 'erda', 'upgrades', 'potential', 'gearstats', 'tables', 'season', 'pitched', 'flames', 'champions', 'expsources', 'bosscp', 'classes']) data[names[n] || n] = load(n);
  data.events = { events: [], sunny: [] };
  data.news = { items: [] };
  data.nexonCharacters = { characters: [] };
  data.meta = null;
  data.upcoming = { items: [] };
  data.shops = JSON.parse(readFileSync(new URL('./fixtures/shops.json', import.meta.url), 'utf8'));
  data.bossById = Object.fromEntries(data.bosses.bosses.map((b) => [b.id, b]));
  return data;
}
const DATA = pageData();
const sacred = DATA.symbols.sacred;
const cernium = sacred.areas.find((a) => a.id === 'cernium');
const MAIN = { id: 'a', name: 'Erel', cls: 'Erel Light', level: 264, world: 'heroic', region: 'na', mainStat: 'STR', challenger: true, beyondBurning: true };

const realNow = Date.now;
let clock = null;
Date.now = () => (clock === null ? realNow() : clock);
after(() => { Date.now = realNow; });
// Sets the clock for one test and starts it from an empty tracker.
function at(t, time) {
  clock = time;
  store.resetState();
  t.after(() => { clock = null; store.resetState(); });
}
async function until(check, ms = 5000) {
  for (const end = realNow() + ms; realNow() < end;) { if (check()) return true; await tick(5); }
  return Boolean(check());
}
// A state with the main character, changed by `mutate`, saved the way an edit is (stamped at the clock).
function start(mutate = () => {}, chars = [MAIN]) {
  store.update((s) => {
    s.characters = chars.map((c) => ({ ...c }));
    s.activeId = chars[0].id;
    mutate(s);
  });
}
// Mounts a page (or any component taking data and state) and returns once it listens to the store.
async function mount(t, Page, props = {}) {
  const el = new FakeNode('div');
  let listening = false;
  const App = () => {
    const state = store.useStore();
    useEffect(() => { listening = true; }, []);
    return html`<${Page} data=${DATA} state=${state} ...${props} />`;
  };
  t.after(() => render(null, el));
  render(html`<${App} />`, el);
  assert.ok(await until(() => listening), 'the page listens to the store');
  return el;
}
const flat = (el) => el.text.replace(/\s+/g, ' ');
// The text of a page drawn fresh at the current clock, like opening it on that day.
async function textOf(t, Page, props) {
  const el = await mount(t, Page, props);
  const text = flat(el);
  render(null, el);
  return text;
}
const rowOf = (el, label) => el.findAll((n) => n.localName === 'div' && /(^| )row( |$)/.test(n.attrs.class || '') && n.text.includes(label))[0];
const buttonIn = (node, text) => node.findAll((n) => n.localName === 'button' && n.text.trim() === text)[0];

// ---------- 9, 32, 41: symbol dates are fixed on the day the count was typed ----------
test('symbolPlan: the level-up day is fixed when the count is typed and does not move with the clock', () => {
  const need = sacred.symbolsPerLevel[4];
  const entry = { level: 5, have: need - 8 * cernium.daily + 5, at: T0 }; // 8 dailies short
  const day0 = symbolPlan(sacred, cernium, entry, T0);
  assert.equal(day0.daysToNext, 8);
  assert.equal(day0.nextAt, Date.parse('2026-12-05T00:00:00Z'), 'eight game days after the day it was typed');
  assert.equal(day0.nextDue, false);
  for (const d of [1, 3, 7]) {
    const later = symbolPlan(sacred, cernium, entry, T0 + d * DAY);
    assert.equal(later.nextAt, day0.nextAt, `day ${d}: the same date`);
    assert.equal(later.maxAt, day0.maxAt);
    assert.equal(later.nextDue, false);
  }
  // The day arrives (at the daily reset): the count needs updating; nothing was added to it.
  const due = symbolPlan(sacred, cernium, entry, Date.parse('2026-12-05T00:00:00Z'));
  assert.equal(due.nextDue, true);
  assert.equal(due.have, entry.have);
  assert.equal(due.affordable, 0);
  // Typed late in the Korean morning of the next day but before the reset: still the same game day.
  assert.equal(symbolPlan(sacred, cernium, { ...entry, at: Date.parse('2026-11-27T23:30:00Z') }, T0 + DAY).nextAt, day0.nextAt);
  assert.equal(symbolPlan(sacred, cernium, { ...entry, at: Date.parse('2026-11-28T00:30:00Z') }, T0 + DAY).nextAt, day0.nextAt + DAY);
  // Enough held: ready now, never "due".
  const ready = symbolPlan(sacred, cernium, { level: 5, have: need, at: T0 - 30 * DAY }, T0);
  assert.equal(ready.affordable, 1);
  assert.equal(ready.nextDue, false);
  // No date (saved before counts were dated) or a date from a clock that runs ahead: counted from now.
  assert.equal(symbolPlan(sacred, cernium, { level: 5, have: entry.have }, T0).nextAt, day0.nextAt);
  assert.equal(symbolPlan(sacred, cernium, { level: 5, have: entry.have, at: T0 + 40 * DAY }, T0).nextAt, day0.nextAt);
  assert.equal(typedAt({ at: T0 - 5 }, T0), T0 - 5);
  assert.equal(typedAt({}, T0), T0);
  // Locked and maxed areas have no dates.
  assert.equal(symbolPlan(sacred, cernium, { level: 0 }, T0).nextAt, null);
  assert.equal(symbolPlan(sacred, cernium, { level: sacred.maxLevel }, T0).nextDue, false);
});

test('Today: "ready about 5 Dec" stays put while the Cernium daily is ticked every day, then asks for the count', async (t) => {
  at(t, T0);
  const need = sacred.symbolsPerLevel[4];
  const have = need - 8 * cernium.daily + 5;
  start((s) => { s.symbols = { a: { cernium: { level: 5, have, at: T0 } } }; });
  const line = (text) => (text.match(/Cernium Lv\. 5 → 6 [^·]*·/) || ['(none)'])[0];
  const seen = [];
  for (let d = 0; d <= 9; d++) {
    clock = T0 + d * DAY;
    const el = await mount(t, TodayPage);
    seen.push(line(flat(el)));
    // Tick the daily, as the player does.
    const box = el.find((n) => n.localName === 'input' && n.attrs.id === 'cl-d-cernium');
    assert.ok(box, 'the Cernium daily is on Today');
    box.checked = true;
    box.fire('change');
    assert.ok(await until(() => Boolean(store.getState().checklist.items['a|d-cernium'])));
    render(null, el);
  }
  for (let d = 0; d <= 7; d++) assert.equal(seen[d], 'Cernium Lv. 5 → 6 ready about 5 Dec ·', `day ${d}`);
  assert.match(seen[8], /Cernium Lv\. 5 → 6 should be ready: update your count/);
  assert.match(seen[9], /should be ready: update your count/);
  assert.doesNotMatch(seen.join(' '), /in \d+ days?/);
  // Ticks never add symbols.
  assert.deepEqual(store.getState().symbols.a.cernium, { level: 5, have, at: T0 });
  // Enough held: ready now.
  store.update((s) => { s.symbols.a.cernium = { level: 5, have: need, at: clock }; });
  assert.match(await textOf(t, TodayPage), /Cernium Lv\. 5 → 6 ready now ·/);
});

test('Progress symbols: typing a level or a held count dates the entry; the row shows a date, then "should be ready"', async (t) => {
  at(t, T0);
  const need = sacred.symbolsPerLevel[4];
  start((s) => { s.ui.progressView = 'symbols'; s.symbols = { a: { cernium: { level: 5, have: need - 8 * cernium.daily + 5, at: T0 } } }; });
  const row = (el) => el.findAll((n) => n.localName === 'tr' && n.text.startsWith('Cernium'))[0];
  let el = await mount(t, ProgressPage);
  assert.match(row(el).text.replace(/\s+/g, ' '), /5 Dec ?8 days/);
  assert.doesNotMatch(row(el).text, /as of/, 'typed today: no "as of"');
  render(null, el);
  clock = T0 + 3 * DAY;
  el = await mount(t, ProgressPage);
  assert.match(row(el).text.replace(/\s+/g, ' '), /as of 27 Nov .*5 Dec ?5 days/);
  render(null, el);
  clock = T0 + 9 * DAY;
  el = await mount(t, ProgressPage);
  assert.match(row(el).text.replace(/\s+/g, ' '), /should be ready ?update Held/);
  // Typing the held count again dates it now, and the date is worked out afresh.
  const held = el.find((n) => n.localName === 'input' && n.attrs['aria-label'] === 'Cernium symbols held');
  held.value = String(need - cernium.daily);
  held.fire('input');
  assert.ok(await until(() => store.getState().symbols.a.cernium.at === clock), 'the entry is dated at the keystroke');
  assert.equal(store.getState().symbols.a.cernium.have, need - cernium.daily);
  assert.ok(await until(() => /7 Dec ?tomorrow/.test(row(el).text.replace(/\s+/g, ' '))), row(el).text);
  // A level change (fusing) dates it too; a per-day change does not.
  clock += DAY;
  buttonIn(row(el), '+').fire('click');
  assert.ok(await until(() => store.getState().symbols.a.cernium.level === 6));
  assert.equal(store.getState().symbols.a.cernium.at, clock);
  clock += DAY;
  const perDay = el.find((n) => n.localName === 'input' && n.attrs['aria-label'] === 'Cernium symbols per day');
  perDay.value = '20';
  perDay.fire('input');
  assert.ok(await until(() => store.getState().symbols.a.cernium.daily === 20));
  assert.equal(store.getState().symbols.a.cernium.at, clock - DAY);
});

test('saved data without dates: dated on first load, without moving any change time; then left alone', async (t) => {
  at(t, T0);
  const old = store.blankState();
  old.characters = [{ ...MAIN }];
  old.activeId = 'a';
  old.symbols = { a: { cernium: { level: 5, have: 100 }, arcus: { level: 0, have: 0 }, odium: { level: 2, have: 0, at: 'yesterday' }, vj: { level: 3, have: 1, at: T0 - 4 * DAY } } };
  old.liberation = { a: { genesis: { stage: 2, traces: 300, picks: { 'lotus-hard': true } } } };
  old.updatedAt = T0 - 10 * DAY;
  old.stamps = { 'symbols/a/cernium': T0 - 10 * DAY, 'symbols/a/vj': T0 - 4 * DAY, 'liberation/a/genesis': T0 - 10 * DAY };
  store.replaceState(structuredClone(old), true);
  let s = store.getState();
  assert.equal(s.symbols.a.cernium.at, T0, 'treated as typed today');
  assert.deepEqual({ level: s.symbols.a.cernium.level, have: s.symbols.a.cernium.have }, { level: 5, have: 100 });
  assert.equal('at' in s.symbols.a.arcus, false, 'an area that was never entered gets no date');
  assert.equal(s.symbols.a.odium.at, T0, 'a date of the wrong kind is dropped, then given');
  assert.equal(s.symbols.a.vj.at, T0 - 4 * DAY, 'a real date is kept');
  assert.equal(s.liberation.a.genesis.at, T0);
  for (const [k, v] of Object.entries(old.stamps)) assert.equal(s.stamps[k], v, `${k}: change time untouched`);
  assert.equal(s.updatedAt, old.updatedAt);
  // Loading the dated copy again on a later day changes nothing.
  clock = T0 + 5 * DAY;
  store.replaceState(structuredClone(s), true);
  s = store.getState();
  assert.equal(s.symbols.a.cernium.at, T0);
  assert.equal(s.liberation.a.genesis.at, T0);
  // dateTyped itself: says whether it dated anything.
  const again = structuredClone(s);
  assert.equal(dateTyped(again, clock), false);
  assert.equal(dateTyped({ symbols: { a: { x: { level: 1 } } }, liberation: {} }, 7), true);
  // Today counts the old count from the first load: a date, not a number of days.
  clock = T0;
  assert.match(await textOf(t, TodayPage), /Cernium Lv\. 5 → 6 ready about \d+ \w{3} ·/);
});

test('two devices that dated the same old count differently settle on the earlier date; a dated count beats an undated one', () => {
  const base = store.blankState();
  base.characters = [{ ...MAIN }];
  base.symbols = { a: { cernium: { level: 5, have: 100 } } };
  base.updatedAt = 1000;
  base.stamps = { 'characters/a': 1000, 'symbols/a/cernium': 1000 };
  const phone = structuredClone(base);
  const pc = structuredClone(base);
  dateTyped(phone, T0);
  dateTyped(pc, T0 + 3 * DAY);
  base.liberation = { a: { genesis: { stage: 2, traces: 300, picks: {} } } };
  base.stamps['liberation/a/genesis'] = 1000;
  for (const [x, y] of [[phone, pc], [pc, phone]]) {
    assert.deepEqual(mergeStates(x, y, T0 + 4 * DAY).symbols.a.cernium, { level: 5, have: 100, at: T0 }, 'the earlier day stands');
  }
  // The synced copy still holds the count without a day (saved before this version). Whatever the two copies'
  // own times are, this device keeps its day (so it is not dated afresh at every sync) and the synced copy
  // differs from the result, so it is written back with the day.
  for (const [mine, theirs] of [[1000, 1000], [1000, 5000], [5000, 1000]]) {
    const local = { ...structuredClone(phone), updatedAt: mine };
    const remote = { ...structuredClone(base), updatedAt: theirs };
    delete remote.liberation;
    delete remote.stamps['liberation/a/genesis'];
    const merged = mergeStates(local, remote, T0 + 4 * DAY);
    assert.equal(merged.symbols.a.cernium.at, T0, `${mine} / ${theirs}`);
    assert.equal(sameEntries(merged, local), true);
    assert.equal(sameEntries(merged, remote), false);
    assert.equal(mergeStates(remote, local, T0 + 4 * DAY).symbols.a.cernium.at, T0);
  }
  // Traces follow the same rule.
  const libA = structuredClone(base);
  const libB = structuredClone(base);
  dateTyped(libA, T0 + DAY);
  dateTyped(libB, T0);
  assert.equal(mergeStates(libA, libB, T0 + 4 * DAY).liberation.a.genesis.at, T0);
  assert.equal(mergeStates(libB, libA, T0 + 4 * DAY).liberation.a.genesis.at, T0);
  assert.equal(mergeStates(libA, base, T0 + 4 * DAY).liberation.a.genesis.at, T0 + DAY);
  // Figures that really differ are not this case: the usual rules decide, the same way on both devices.
  const other = structuredClone(pc);
  other.symbols.a.cernium.have = 130;
  assert.deepEqual(mergeStates(phone, other, T0 + 4 * DAY).symbols.a.cernium, mergeStates(other, phone, T0 + 4 * DAY).symbols.a.cernium);
  // A count typed later on one device wins with its own date.
  const typed = structuredClone(phone);
  typed.symbols.a.cernium = { level: 5, have: 160, at: T0 + 2 * DAY };
  typed.stamps['symbols/a/cernium'] = T0 + 2 * DAY;
  typed.updatedAt = T0 + 2 * DAY;
  assert.deepEqual(mergeStates(pc, typed, T0 + 4 * DAY).symbols.a.cernium, { level: 5, have: 160, at: T0 + 2 * DAY });
  assert.deepEqual(mergeStates(typed, pc, T0 + 4 * DAY).symbols.a.cernium, { level: 5, have: 160, at: T0 + 2 * DAY });
});

// ---------- 32, 41: Genesis traces ----------
test('Genesis: the finish date counts from the day the traces were typed and does not slide', async (t) => {
  const def = DATA.liberation.genesis;
  const entry = { stage: 2, traces: 300, picks: { 'lotus-hard': true, 'damien-hard': true }, at: T0 };
  const day0 = liberationPlan(def, entry, T0, DATA.bossById);
  assert.ok(Number.isFinite(day0.weeks) && day0.weeks > 2);
  assert.equal(day0.eta, T0 + day0.weeks * 7 * DAY);
  for (const d of [1, 7, 14]) {
    const later = liberationPlan(def, entry, T0 + d * DAY, DATA.bossById);
    assert.equal(later.eta, day0.eta, `day ${d}: the same date`);
    assert.equal(later.remaining, day0.remaining);
    assert.equal(later.due, false);
  }
  assert.equal(liberationPlan(def, entry, day0.eta + 1, DATA.bossById).due, true);
  // Without a date it counts from now, as before.
  const { at: _at, ...undated } = entry;
  assert.equal(liberationPlan(def, undated, T0 + 7 * DAY, DATA.bossById).eta, day0.eta + 7 * DAY);

  at(t, T0);
  start((s) => { s.ui.progressView = 'liberation'; s.liberation = { a: { genesis: { ...entry } } }; });
  const today0 = (await textOf(t, TodayPage)).match(/traces left [^·]*· [^.]*?\d{4}/)[0];
  assert.match(today0, /traces left as of today · done around \d+ \w{3} \d{4}/);
  clock = T0 + 9 * DAY;
  const today9 = (await textOf(t, TodayPage)).match(/traces left [^·]*· [^.]*?\d{4}/)[0];
  assert.equal(today9, today0.replace('as of today', 'as of 27 Nov'));
  assert.match(await textOf(t, ProgressPage), /counted from what you had as of 27 Nov: around /);
  // Typing the traces dates the entry again.
  const el = await mount(t, ProgressPage);
  const box = el.find((n) => n.localName === 'input' && n.attrs['aria-label'] === 'Collected in this stage');
  box.value = '400';
  box.fire('input');
  assert.ok(await until(() => store.getState().liberation.a.genesis.at === clock));
  assert.equal(store.getState().liberation.a.genesis.traces, 400);
  // Past the finish date with the figures untouched: it says so.
  render(null, el);
  clock = liberationPlan(def, store.getState().liberation.a.genesis, clock, DATA.bossById).eta + DAY;
  assert.match(await textOf(t, ProgressPage), /should be finished by now\. The figures are as of 6 Dec/);
  assert.match(await textOf(t, TodayPage), /should be done: update your traces/);
});

test('Genesis: a first boss pick dates a new entry, so its date does not slide either', async (t) => {
  at(t, T0);
  start((s) => { s.ui.progressView = 'liberation'; });
  const el = await mount(t, ProgressPage);
  const chip = el.findAll((n) => n.localName === 'button' && /Hard Lotus/.test(n.text))[0];
  chip.fire('click');
  assert.ok(await until(() => Boolean(store.getState().liberation.a?.genesis?.picks?.['lotus-hard'])));
  assert.equal(store.getState().liberation.a.genesis.at, T0);
  // A later pick leaves the date alone.
  clock = T0 + 2 * DAY;
  el.findAll((n) => n.localName === 'button' && /Hard Damien/.test(n.text))[0].fire('click');
  assert.ok(await until(() => Boolean(store.getState().liberation.a.genesis.picks['damien-hard'])));
  assert.equal(store.getState().liberation.a.genesis.at, T0);
});

// ---------- 41: mesos held, goals, crests, coins, Sol Erda ----------
test('goal dates count from the day the mesos were typed; a passed date asks for an update', async (t) => {
  const goals = [{ id: 'g', name: 'Big', cost: 5e9 }];
  const day0 = goalDates(goals, 1e9, 1.4e9, T0, T0)[0];
  assert.equal(day0.at, T0 + 20 * DAY);
  assert.equal(goalDates(goals, 1e9, 1.4e9, T0 + 5 * DAY, T0)[0].at, day0.at, 'the same date five days later');
  assert.equal(goalDates(goals, 1e9, 1.4e9, T0 + 5 * DAY, T0)[0].due, undefined);
  assert.equal(goalDates(goals, 1e9, 1.4e9, T0 + 21 * DAY, T0)[0].due, true);
  // Without a known day it counts from now, as before.
  assert.equal(goalDates(goals, 1e9, 1.4e9, T0 + 5 * DAY)[0].at, day0.at + 5 * DAY);
  assert.equal(goalDates(goals, 6e9, 1.4e9, T0 + 5 * DAY, T0)[0].now, true);
  assert.equal(affordableAt(5e9, 1e9, 1.4e9, T0 + 5 * DAY, T0), T0 + 20 * DAY);
  assert.equal(affordableAt(5e9, 1e9, 1.4e9, T0 + 5 * DAY), T0 + 25 * DAY);
  assert.equal(affordableAt(5e9, 6e9, 0, T0 + 5 * DAY, T0), T0 + 5 * DAY);

  at(t, T0);
  start((s) => { s.mesos.held = 1e9; s.mesos.other = 1.4e9; s.mesos.goals = [...goals]; });
  assert.equal(changedAt(store.getState(), 'mesos/held'), T0);
  let text = await textOf(t, MesosPage);
  assert.match(text, /Big.*?17 Dec 2026 20 days/);
  assert.match(text, /Mesos you have now \(as of today\)/);
  clock = T0 + 9 * DAY;
  text = await textOf(t, MesosPage);
  assert.match(text, /Big.*?17 Dec 2026 11 days/);
  assert.match(text, /Mesos you have now \(as of 27 Nov\)/);
  clock = T0 + 30 * DAY;
  assert.match(await textOf(t, MesosPage), /Big.*?should be affordable update your mesos/);
  // Typing the amount again dates it now.
  const el = await mount(t, MesosPage);
  const box = el.find((n) => n.localName === 'input' && n.attrs['aria-label'] === 'Mesos held');
  box.value = '2b';
  box.fire('input');
  box.fire('blur'); // the meso box saves when it is left
  assert.ok(await until(() => store.getState().mesos.held === 2e9));
  assert.equal(changedAt(store.getState(), 'mesos/held'), clock);
});

test('"as of" comes from the change times sync keeps: unknown, seeded and slightly-ahead times', () => {
  assert.equal(changedAt({ stamps: {} }, 'mesos/held', T0), null, 'never changed');
  assert.equal(changedAt({ stamps: { 'mesos/held': 1 } }, 'mesos/held', T0), null, 'a seeded stamp is not a time');
  assert.equal(changedAt({ stamps: { mesos: T0 - DAY } }, 'mesos/held', T0), T0 - DAY, 'the older whole-part time stands in');
  assert.equal(changedAt({ stamps: { 'mesos/held': T0 + 60000 } }, 'mesos/held', T0), T0, 'a clock a minute ahead counts as now');
  assert.equal(changedAt({ stamps: { 'mesos/held': T0 + 2 * DAY } }, 'mesos/held', T0), null, 'a time days ahead is not trusted');
  assert.equal(changedAt(null, 'mesos/held', T0), null);
  assert.equal(asOf(T0, T0 + 3600000), 'as of today');
  assert.equal(asOf(T0, T0 + 3 * DAY), 'as of 27 Nov');
  assert.equal(asOf(null, T0), '');
  assert.equal(fmtDay(Date.parse('2027-04-10T00:00:00Z'), T0), '10 Apr 2027');
  assert.equal(fmtDay(Date.parse('2026-12-05T00:00:00Z'), T0), '5 Dec');
  assert.equal(fmtDay(Date.parse('2026-12-04T15:00:00Z'), T0), '5 Dec', 'the day in Korea');
});

test('crests, coins, claims and Sol Erda show the day they were typed', async (t) => {
  at(t, T0);
  start((s) => {
    s.ibp = { a: { done: {}, crests: 300 } };
    s.shops = { 'alliance-credit': { have: 4000, claims: 5, want: {} } };
    s.erda = { a: { template: 'erel', levels: {}, steps: {}, solErda: 3, fragments: 20 } };
  });
  const shop = (now) => textOf(t, ShopsView, { now });
  assert.match(await shop(clock), /4,000 held as of today \+ up to/);
  store.update((s) => { s.ui.progressView = 'sixth'; });
  const erda0 = (await textOf(t, ProgressPage)).match(/HEXA Origin table\) (about \d+ \w{3}( \d{4})?)/);
  assert.ok(erda0, 'the Origin step has a date');
  clock = T0 + 9 * DAY;
  let text = await shop(clock);
  assert.match(text, /4,000 held as of 27 Nov \+ up to/);
  assert.match(text, /claimed so far \(max 60, as of 27 Nov\)/);
  assert.match(text, /missions ticked on Checklist do not change them/);
  text = await textOf(t, ProgressPage);
  assert.match(text, /3 Sol Erda · 20 Fragments held as of 27 Nov/);
  assert.equal(text.match(/HEXA Origin table\) (about \d+ \w{3}( \d{4})?)/)[1], erda0[1], 'the same date nine days later');
  store.update((s) => { s.ui.progressView = 'ibp'; });
  text = await textOf(t, ProgressPage);
  assert.match(text, /Challenge Crests held \(as of 27 Nov\)/);
  assert.match(text, /hunts ticked on Checklist do not add to it/);
  // Only the amount that was retyped moves.
  store.update((s) => { s.shops['alliance-credit'].have = 4800; });
  text = await shop(clock);
  assert.match(text, /4,800 held as of today \+ up to/);
  assert.match(text, /claimed so far \(max 60, as of 27 Nov\)/);
  // A shop nobody has typed anything into says nothing about a day.
  store.update((s) => { delete s.shops['alliance-credit']; });
  store.resetState();
  start();
  assert.doesNotMatch(await shop(clock), /as of/);
});

// ---------- 8, 31: first-run setup ----------
test('setup without an EXP % saves the level and no reading; the rate starts from real readings', async (t) => {
  const form = { name: 'New', cls: 'Erel Light', level: 264, pct: null, world: 'heroic', challenger: true, beyondBurning: true, mainStat: 'STR' };
  const s = applySetup(store.blankState(), form, [], 'n', T0);
  assert.equal(s.characters[0].level, 264);
  assert.equal(s.level.n, undefined, 'no made-up 0% reading');
  // The next day's first real reading gives no rate yet, so no gate gets a date.
  s.level.n = { log: [{ t: T0 + DAY, level: 264, pct: 45.2 }] };
  const o = levelOutlook(DATA, s, s.characters[0], T0 + DAY + 1000);
  assert.equal(o.rate, null);
  assert.ok(o.gates.length > 0 && o.gates.every((g) => g.at === null));
  // A typed EXP %, zero included, is a reading.
  assert.deepEqual(applySetup(store.blankState(), { ...form, pct: 43 }, [], 'n', T0).level.n.log, [{ t: T0, level: 264, pct: 43 }]);
  assert.deepEqual(applySetup(store.blankState(), { ...form, pct: 0 }, [], 'n', T0).level.n.log, [{ t: T0, level: 264, pct: 0 }]);
  assert.equal(applySetup(store.blankState(), { name: 'X', pct: 50 }, [], 'n', T0).level.n, undefined, 'no level: nothing to log');

  // 38: what the pages say right after setup.
  at(t, T0);
  store.update((x) => { applySetup(x, form, [], 'n', T0); x.ui.progressView = 'level'; });
  let today = await textOf(t, TodayPage);
  assert.match(today, /Next gate · Lv\. 265 — log your EXP % on Progress for a date · Hotel Arcus/);
  assert.doesNotMatch(today, /log your level on Progress/);
  let progress = await textOf(t, ProgressPage);
  assert.match(progress, /Now Lv\. 264 up to [\d.]+T EXP to Lv\. 265 · from Characters; log your EXP % below/);
  assert.doesNotMatch(progress, /0\.00%/, 'no EXP % is shown that nobody typed');
  // One real reading: a second one on another day is what is missing.
  store.update((x) => { x.level.n = { log: [{ t: T0, level: 264, pct: 45.2 }] }; });
  today = await textOf(t, TodayPage);
  assert.match(today, /Next gate · Lv\. 265 — log your EXP % again on another day for a date/);
  assert.match(await textOf(t, ProgressPage), /Now Lv\. 264 · 45\.20%/);
});

test('setup with a name only: Progress asks for a level instead of saying there are no gates', async (t) => {
  at(t, T0);
  store.update((x) => { applySetup(x, { name: 'Nameonly' }, [], 'n', T0); x.ui.progressView = 'level'; });
  const progress = await textOf(t, ProgressPage);
  assert.match(progress, /Log your level to see the gates\./);
  assert.doesNotMatch(progress, /No gates ahead/);
  assert.doesNotMatch(progress, /Dates show once/);
  // A character past the last gate still reads "No gates ahead".
  store.update((x) => { x.characters[0].level = 290; });
  assert.match(await textOf(t, ProgressPage), /No gates ahead\./);
});

// ---------- 12, 27: unlock flags ----------
const dailyGroup = DATA.checklist.groups.find((g) => g.key === 'daily');
const arcusItem = dailyGroup.items.find((i) => i.id === 'd-arcus');
const emptyList = () => ({ items: {}, resets: {}, flags: {}, history: {}, owner: null });

test('a symbol level on Progress unlocks that area\'s daily, for that character only', async (t) => {
  const st = (who) => itemStatus(arcusItem, dailyGroup, emptyList(), T0, who);
  assert.equal(st({ id: 'a', level: 266 }).locked, true, 'questline lock');
  assert.equal(st({ id: 'a', level: 266, open: ['arcus'] }).locked, false);
  assert.equal(st({ id: 'a', level: 264, open: ['arcus'] }).locked, false, 'the symbol level proves the area whatever the tracker\'s level says');
  assert.equal(st({ id: 'a', level: 264, open: ['arcus'] }).byHand, false);
  assert.equal(st({ id: 'a', level: 266, open: ['cernium'] }).locked, true);
  assert.deepEqual(openAreas({ cernium: { level: 5 }, arcus: { level: 0, have: 3 }, odium: null, vj: { level: 1 } }), ['cernium', 'vj']);
  assert.deepEqual(openAreas(undefined), []);

  at(t, T0);
  const alt = { id: 'b', name: 'Alt', level: 266, world: 'heroic', region: 'na', mainStat: 'INT' };
  start((s) => { s.symbols = { a: { cernium: { level: 5, have: 0, at: T0 }, arcus: { level: 3, have: 20, at: T0 } } }; }, [MAIN, alt]);
  const state = store.getState();
  assert.deepEqual(whoFor(DATA, state, state.characters[0]).open, ['cernium', 'arcus']);
  assert.deepEqual(whoFor(DATA, state, state.characters[1]).open, []);
  const el = await mount(t, ChecklistPage);
  const row = rowOf(el, 'Hotel Arcus daily');
  assert.doesNotMatch(row.attrs.class, /locked/);
  assert.equal(buttonIn(row, 'Mark unlocked'), undefined);
  assert.equal(buttonIn(row, 'Lock again'), undefined, 'it follows Progress: nothing to take back here');
  assert.match(flat(await mount(t, TodayPage)), /Hotel Arcus daily/);
  // The alt has no Arcus symbols: still locked for it.
  const base = dailyProgress(DATA.checklist, state.checklist, T0, whoFor(DATA, state, state.characters[0])).total;
  store.update((s) => { s.activeId = 'b'; });
  assert.ok(await until(() => /locked/.test(rowOf(el, 'Hotel Arcus daily').attrs.class)));
  // Taking the symbol level back to 0 locks it again for the main.
  store.update((s) => { s.activeId = 'a'; s.symbols.a.arcus.level = 0; });
  assert.ok(await until(() => /locked/.test(rowOf(el, 'Hotel Arcus daily').attrs.class)));
  const now = store.getState();
  assert.equal(dailyProgress(DATA.checklist, now.checklist, T0, whoFor(DATA, now, now.characters[0])).total, base - 1);
});

test('"Mark unlocked" opens Hotel Arcus on the first press at Lv. 264, and "Lock again" takes it back', async (t) => {
  at(t, T0);
  start();
  const total = () => { const s = store.getState(); return dailyProgress(DATA.checklist, s.checklist, T0, whoFor(DATA, s, s.characters[0])).total; };
  const before = total();
  const el = await mount(t, ChecklistPage);
  const row = () => rowOf(el, 'Hotel Arcus daily');
  assert.match(row().attrs.class, /locked/);
  assert.match(row().text, /from Lv\. 265/);
  assert.equal(row().findAll((n) => n.localName === 'button' && /unlocked/.test(n.text)).length, 1, 'one button');
  buttonIn(row(), 'Mark unlocked').fire('click');
  assert.ok(await until(() => !/locked/.test(row().attrs.class)), 'one press unlocks it');
  assert.equal(total(), before + 1);
  assert.equal(buttonIn(row(), 'Mark unlocked'), undefined);
  // It can be undone, and the undo is saved as "off" so it reaches other devices.
  buttonIn(row(), 'Lock again').fire('click');
  assert.ok(await until(() => /locked/.test(row().attrs.class)), 'locked again');
  assert.equal(total(), before);
  assert.deepEqual(store.getState().checklist.flags, { 'a|lvl:d-arcus': false, 'a|arcus': false });
  assert.ok(buttonIn(row(), 'Mark unlocked'), 'and it can be opened again');
  // At Lv. 265 the questline unlock alone can be taken back too.
  store.update((s) => { s.characters[0].level = 265; });
  assert.ok(await until(() => !/from Lv\. 265/.test(row().text)));
  buttonIn(row(), 'Mark unlocked').fire('click');
  assert.ok(await until(() => Boolean(buttonIn(row(), 'Lock again'))));
  buttonIn(row(), 'Lock again').fire('click');
  assert.ok(await until(() => /locked/.test(row().attrs.class)));
  // An item with a level lock only (Cernium for a Lv. 210 character): same two buttons, one flag.
  const cs = emptyList();
  const cern = dailyGroup.items.find((i) => i.id === 'd-cernium');
  setUnlocked(cs, cern, { id: 'm', level: 210 }, true);
  assert.deepEqual(cs.flags, { 'm|lvl:d-cernium': true });
  assert.equal(itemStatus(cern, dailyGroup, cs, T0, { id: 'm', level: 210 }).byHand, true);
  assert.equal(itemStatus(cern, dailyGroup, cs, T0, { id: 'm', level: 262 }).byHand, false, 'the level is enough: nothing was unlocked by hand');
});

test('unlock flags: one saved before flags were per character is taken back too, and "off" beats "on" in a merge', () => {
  const cs = { ...emptyList(), flags: { arcus: true }, owner: 'a' };
  assert.equal(itemStatus(arcusItem, dailyGroup, cs, T0, { id: 'a', level: 266 }).byHand, true);
  setUnlocked(cs, arcusItem, { id: 'a', level: 266 }, false);
  assert.equal(itemStatus(arcusItem, dailyGroup, cs, T0, { id: 'a', level: 266 }).locked, true);
  // Another character never loses its own flag to it.
  const two = { ...emptyList(), flags: { 'b|arcus': true } };
  setUnlocked(two, arcusItem, { id: 'a', level: 266 }, false);
  assert.equal(two.flags['b|arcus'], true);

  const base = store.blankState();
  base.characters = [{ ...MAIN }];
  base.checklist.flags = { 'a|arcus': true };
  base.updatedAt = 1000;
  base.stamps = { 'characters/a': 1000, 'checklist/flags/a|arcus': 1000 };
  const locked = structuredClone(base);
  locked.checklist.flags['a|arcus'] = false;
  locked.stamps['checklist/flags/a|arcus'] = 2000;
  locked.updatedAt = 2000;
  assert.equal(units(locked).get('checklist/flags/a|arcus'), false, 'an "off" flag is carried, not dropped');
  assert.equal(mergeStates(base, locked, T0).checklist.flags['a|arcus'], false);
  assert.equal(mergeStates(locked, base, T0).checklist.flags['a|arcus'], false);
});

// ---------- 20: a daily row for every Grandis area in symbols.json ----------
test('every sacred symbol area with a daily amount has a checklist daily, locked the same way', async (t) => {
  const gated = dailyGroup.items.filter((i) => i.gate);
  for (const area of sacred.areas.filter((a) => a.daily > 0)) {
    const item = dailyGroup.items.find((i) => i.minLevel === area.unlockLevel && new RegExp(`\\b${area.daily} `).test(i.label) && (i.gate === area.id || area.id === 'cernium'));
    assert.ok(item, `${area.name}: a daily row from Lv. ${area.unlockLevel} with ${area.daily} symbols`);
  }
  const areaIds = new Set([...sacred.areas, ...DATA.symbols.arcane.areas].map((a) => a.id));
  for (const i of gated) assert.ok(areaIds.has(i.gate), `${i.id}: its gate is a symbol area id`);
  assert.deepEqual(gated.map((i) => i.minLevel), gated.map((i) => i.minLevel).slice().sort((x, y) => x - y), 'gated rows are in level order');

  // Lv. 264: only the next area above the level is listed; Today and the core count are as before.
  const shown = (who) => listedItems(dailyGroup, emptyList(), T0, who).filter((i) => i.gate).map((i) => i.id);
  assert.deepEqual(shown({ id: 'a', level: 264 }), ['d-arcus']);
  assert.deepEqual(shown({ id: 'a', level: 266 }), ['d-arcus'], 'Arcus is in reach and still locked: nothing further up yet');
  assert.deepEqual(shown({ id: 'a', level: 266, open: ['arcus'] }), ['d-arcus', 'd-odium']);
  assert.deepEqual(shown({ id: 'a', level: 272 }), ['d-arcus', 'd-odium'], 'both in reach');
  assert.deepEqual(shown({ id: 'a', level: 272, open: ['arcus', 'odium'] }), ['d-arcus', 'd-odium', 'd-shangrila']);
  assert.deepEqual(shown({ id: 'a', level: 290 }), ['d-arcus', 'd-odium', 'd-shangrila', 'd-arteria', 'd-carcion']);
  assert.deepEqual(shown({ id: 'a' }), ['d-arcus'], 'no level known yet: one locked area, not five');
  assert.deepEqual(shown({}), ['d-arcus']);
  assert.equal(listedItems(dailyGroup, emptyList(), T0, { id: 'a', level: 210 }).length, dailyGroup.items.length - 4, 'rows without a gate are always listed');
  // At Lv. 272 Odium is locked until its symbols are entered or it is marked unlocked; then it counts.
  const odium = dailyGroup.items.find((i) => i.id === 'd-odium');
  assert.equal(itemStatus(odium, dailyGroup, emptyList(), T0, { id: 'a', level: 272 }).locked, true);
  assert.equal(itemStatus(odium, dailyGroup, emptyList(), T0, { id: 'a', level: 272, open: ['odium'] }).locked, false);

  at(t, T0);
  start((s) => { s.characters[0].level = 272; s.symbols = { a: { arcus: { level: 4, have: 0, at: T0 }, odium: { level: 1, have: 0, at: T0 } } }; });
  const text = await textOf(t, TodayPage);
  assert.match(text, /Odium daily: 15 Odium symbols/);
  assert.doesNotMatch(text, /Shangri-La daily/);
  const list = await textOf(t, ChecklistPage);
  assert.match(list, /Shangri-La daily: 15 Shangri-La symbols from Lv\. 275 Mark unlocked/);
  assert.doesNotMatch(list, /Arteria daily/);
});

// ---------- 36: after the season ends ----------
test('season: once the season is over only steps that can still be done count as open', async (t) => {
  const season = DATA.season;
  const ends = Date.parse(season.ends);
  const before = seasonOutlook(season, { 'spend-coins': true }, ends - 20 * DAY);
  assert.equal(before.open, season.actions.length - 1);
  assert.equal(before.missed, 0);
  const lastBy = Math.max(...season.actions.map((a) => Date.parse(a.by)));
  const stillOpen = season.actions.filter((a) => Date.parse(a.by) === lastBy).length;
  const feb12 = Date.parse('2027-02-12T03:00:00Z');
  const o = seasonOutlook(season, {}, feb12);
  assert.equal(o.ended, true);
  assert.equal(o.open, stillOpen);
  assert.equal(o.missed, season.actions.length - stillOpen);
  assert.equal(o.total, season.actions.length);
  assert.equal(seasonOutlook(season, { 'tier-rewards': true }, feb12).missed, season.actions.length - stillOpen - 1);
  const over = seasonOutlook(season, {}, lastBy + 1);
  assert.equal(over.over, true);
  assert.equal(over.last, lastBy);

  at(t, ends - 20 * DAY);
  start();
  let text = await textOf(t, TodayPage);
  assert.match(text, new RegExp(`Season ends .*? ${season.actions.length} of ${season.actions.length} end-of-season steps still open\\. Challenger gear stops working then`));
  clock = feb12;
  text = await textOf(t, TodayPage);
  assert.match(text, /Challenger World Season 4 has ended season over: last deadlines Season ended Wed 10 Feb, 08:59 KST 1 step can still be done; 14 were not ticked before their deadline\. Challenger gear has stopped working\./);
  assert.match(text, /passed · 9 not ticked/);
  assert.doesNotMatch(text, /passed · \d+ open/);
  assert.doesNotMatch(text, /steps still open/);
  // After the last deadline: what the notice leaves to do with the character, and nothing invented.
  clock = Date.parse('2027-03-27T03:00:00Z');
  text = await textOf(t, TodayPage);
  assert.match(text, /Challenger World Season 4 has ended every deadline has passed/);
  assert.match(text, /The last step closed on Wed 24 Feb, 08:59 KST: World Leap the character out of Challenger World\./);
  assert.match(text, /what happens to characters that never leap is not stated/);
  assert.match(text, /untick "Challenger World character" on Characters/);
  // A character that is not in Challenger World sees no season card at all.
  store.update((s) => { s.characters[0].challenger = false; });
  assert.doesNotMatch(await textOf(t, TodayPage), /Season 4/);
});

// ---------- 37: an Interactive-world character ----------
test('an Interactive character is not offered Heroic cube goals or told Heroic-only facts', async (t) => {
  assert.equal(worldName({ world: 'interactive' }), 'Interactive');
  assert.equal(worldName({ world: 'heroic' }), 'Heroic');
  assert.equal(worldName(null), 'Heroic');
  at(t, T0);
  const bish = { id: 'i', name: 'Bish', cls: 'Bishop', level: 262, world: 'interactive', region: 'na', mainStat: 'INT' };
  start(() => {}, [bish]);
  let text = await textOf(t, MesosPage);
  assert.doesNotMatch(text, /Bright Cubes ·|Glowing Cubes ·/);
  store.update((s) => { s.ui.mesosView = 'cubes'; });
  text = await textOf(t, MesosPage);
  assert.match(text, /These are Heroic Cube Shop prices; Bish is on an Interactive world\./);
  assert.doesNotMatch(text, /Heroic gear has no bonus potential/);
  text = await textOf(t, GearPage);
  assert.doesNotMatch(text, /Heroic worlds have no bonus potential/);
  assert.match(text, /The targets and the cube prices were written for Heroic worlds; the tracker has no Interactive figures for them\./);
  // A Heroic character reads what it read before.
  store.resetState();
  start();
  text = await textOf(t, MesosPage);
  assert.match(text, /\+ 200 Bright Cubes ·/);
  assert.match(text, /\+ 100 Glowing Cubes ·/);
  store.update((s) => { s.ui.mesosView = 'cubes'; });
  assert.match(await textOf(t, MesosPage), /Heroic gear has no bonus potential/);
  assert.match(await textOf(t, GearPage), /not official numbers\. Heroic worlds have no bonus potential, so it isn't counted\. Star Force and cube figures/);
});

// ---------- 35 (the part that needs no source): Beyond Burning in the gates ----------
test('level gates: "end of Beyond Burning" only for a character that has Beyond Burning', () => {
  const state = store.blankState();
  const alt = { id: 'b', name: 'Alt', level: 232, world: 'heroic', challenger: false, beyondBurning: false };
  const plain = levelOutlook(DATA, state, alt, T0);
  assert.equal(plain.beyond, false);
  assert.ok(plain.gates.some((g) => g.level === 280));
  assert.ok(plain.gates.every((g) => !/Beyond Burning/.test(g.what)), plain.gates.map((g) => g.what).join(' | '));
  const burning = levelOutlook(DATA, state, { ...MAIN }, T0);
  assert.equal(burning.beyond, true);
  assert.match(burning.gates.find((g) => g.level === 280).what, /^Arteria, .*end of Beyond Burning$/);
  // After Beyond Burning has ended nobody is told about its end.
  const after = levelOutlook(DATA, state, { ...MAIN }, Date.parse(DATA.season.ends) + DAY);
  assert.ok(after.gates.every((g) => !/Beyond Burning/.test(g.what)));
});
