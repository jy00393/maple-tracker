// Fifth round, boss area: one record per boss clear. The ticks on the Bosses page are the only record; the
// Checklist and Today rows for daily bosses, weekly bosses, Kai and Mayrin read and write the same ticks.
// Also: the week's target drops daily-boss days that have passed, the "Do today" heading, setup's one clear per
// boss, entry rules (Challenger World, level) on the boss picker, and Liberation set from the Bosses picks.
// Every test builds its own state and sets its own clock, and puts both back when it ends. Nothing sleeps for a
// fixed time: a test waits on the condition it needs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

installFakeBrowser({});
const { html, render, useEffect } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const { computeIncome, crystalValue, characterLines, bossRows, bossClear, bossResetHint, entryBlock } = await import('../../site/app/calc/income.js');
const { itemStatus, recordKey } = await import('../../site/app/calc/checklist.js');
const { resetWarnings } = await import('../../site/app/calc/reminders.js');
const { liberationFromBosses, liberationPlan } = await import('../../site/app/calc/progress.js');
const { toggleSetupPick, applySetup } = await import('../../site/app/calc/setup.js');
const { periodKey, dayKey } = await import('../../site/app/time.js');
const { dedupeEvents } = await import('../../site/app/calc/events.js');
const { BossesPage, toggleClear } = await import('../../site/app/pages/bosses.js');
const { TodayPage } = await import('../../site/app/pages/today.js');
const { ChecklistPage, whoFor: whoForState, dailyProgress, tickItem } = await import('../../site/app/pages/checklist.js');
// The calc tests give only the parts of the saved state they are about; the rest is a blank state.
const whoFor = (data, state, c) => whoForState(data, { ...store.blankState(), ...state }, c);
const { ProgressPage } = await import('../../site/app/pages/progress.js');
const { planSession } = await import('../../site/app/pages/session.js');

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const bosses = load('bosses');
const checklist = load('checklist');
const liberation = load('liberation');
const bossById = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const main = { id: 'a', name: 'Erel', level: 264, world: 'heroic', region: 'na', mainStat: 'STR', challenger: true };
const alt = { id: 'b', name: 'Mule', level: 210, world: 'heroic', region: 'na', mainStat: 'STR', challenger: false };
const heroic = (id, party = 1) => crystalValue(bossById[id], main, bosses, party);
const income = (picks, clears, now, c = main) => computeIncome([c], { bosses: { [c.id]: { picks, clears } } }, bosses, bossById, now).perChar[c.id];
const solo = (...ids) => Object.fromEntries(ids.map((id) => [id, { party: 1 }]));
const DAY = 86400000;
const THU = Date.parse('2026-11-26T03:00:00Z'); // day 1 of the crystal week
const FRI = Date.parse('2026-11-27T03:00:00Z'); // day 2
const SUN = Date.parse('2026-11-29T03:00:00Z'); // day 4
const WED = Date.parse('2026-12-02T03:00:00Z'); // day 7, the last one
const dayOf = (t) => periodKey('daily', t);
const week = periodKey('thu', FRI);
const group = (key) => checklist.groups.find((g) => g.key === key);
const itemOf = (id) => { for (const g of checklist.groups) { const i = g.items.find((x) => x.id === id); if (i) return [i, g]; } throw new Error('no item ' + id); };
const text = (el) => el.text.replace(/\s+/g, ' ');

// ---- pages in the stand-in browser ----
const realNow = Date.now;
let clock = null;
Date.now = () => (clock === null ? realNow() : clock);
after(() => { Date.now = realNow; });
function at(t, time) {
  clock = time;
  t.after(() => { clock = null; store.resetState(); });
}
async function until(check, ms = 8000) {
  for (const end = realNow() + ms; realNow() < end;) { if (check()) return true; await tick(5); }
  return Boolean(check());
}
function pageData() {
  const names = { gearstats: 'gearStats', characters: 'nexonCharacters', expsources: 'expSources', bosscp: 'bossCp' };
  const data = {};
  for (const n of ['bosses', 'symbols', 'liberation', 'ibp', 'checklist', 'gear', 'erda', 'upgrades', 'potential', 'gearstats', 'events', 'news', 'characters', 'meta', 'tables', 'season', 'pitched', 'shops', 'flames', 'champions', 'expsources', 'upcoming', 'bosscp', 'classes']) {
    try { data[names[n] || n] = load(n); } catch { data[names[n] || n] = null; }
  }
  data.events = data.events || { events: [] };
  data.events.events = dedupeEvents(data.events.events || []);
  data.events.sunny = Array.isArray(data.events.sunny) ? data.events.sunny : [];
  data.news = data.news || { items: [] };
  // No rankings history: the levels in these tests are the ones typed on the characters.
  data.nexonCharacters = { characters: [] };
  data.bossById = bossById;
  return data;
}
const DATA = pageData();
// Mounts a page on its own state and returns once it listens to the store. Taken down when the test ends.
async function show(t, Page, mutate) {
  const s = store.blankState();
  s.characters = [{ ...main }];
  s.activeId = 'a';
  if (mutate) mutate(s);
  store.replaceState(s);
  const el = new FakeNode('div');
  let listening = false;
  const App = () => {
    const state = store.useStore();
    useEffect(() => { listening = true; }, []);
    return html`<${Page} data=${DATA} state=${state} />`;
  };
  t.after(() => { render(null, el); store.resetState(); });
  render(html`<${App} />`, el);
  assert.ok(await until(() => listening), 'the page listens to the store');
  return el;
}
const byId = (el, id) => el.find((n) => n.attrs.id === id);
const isOn = (node) => node.checked === true || ('checked' in node.attrs && node.attrs.checked !== 'false');
const isOff = (node) => node.disabled === true || ('disabled' in node.attrs && node.attrs.disabled !== 'false');
const rowOf = (el, label) => el.find((n) => n.localName === 'div' && String(n.attrs.class || '').split(' ').includes('row') && n.text.includes(label));
const who = (state, c = state.characters.find((x) => x.id === state.activeId)) => whoFor(DATA, state, c);
// Every core daily except the boss item, ticked for the day of `now`.
function tickOtherDailies(s, charId, now) {
  for (const item of group('daily').items) {
    if (item.bosses) continue;
    const key = item.scope === 'account' ? item.id : `${charId}|${item.id}`;
    s.checklist.items[key] = { p: dayOf(now), t: now, d: 1, ...(item.type === 'count' ? { c: item.target } : {}) };
  }
}

// ---- the week's target: a daily boss day that passed uncleared has left it ----
test('the target counts a daily boss only for today and the days still to come', () => {
  const picks = solo('zakum-normal', 'cygnus-normal');
  const one = heroic('zakum-normal') + heroic('cygnus-normal');
  assert.equal(income(picks, {}, THU).target, 7 * one, 'on the first day the whole week is open');
  assert.equal(income(picks, {}, SUN).target, 4 * one, 'three days have passed: four are left');
  assert.equal(income(picks, {}, WED).target, one, 'on the last day one clear of each is left');
  const done = { 'zakum-normal': { [dayOf(WED)]: true }, 'cygnus-normal': { [dayOf(WED)]: true } };
  const r = income(picks, done, WED);
  assert.equal(r.earned, one);
  assert.equal(r.target, r.earned, 'everything that could still be earned is earned');
  // Cleared Thursday, missed Friday and Saturday, cleared Sunday: 2 earned, 3 days still open.
  const mixed = { 'cygnus-normal': { [dayOf(THU)]: true, [dayOf(SUN)]: true } };
  const m = income(solo('cygnus-normal'), mixed, SUN);
  assert.equal(m.earned, 2 * heroic('cygnus-normal'));
  assert.equal(m.target, 5 * heroic('cygnus-normal'));
  assert.equal(m.lines[0].cleared, 2, 'the row still counts the days cleared');
  // The plan for an average week (income a week, goal dates) is not touched.
  assert.equal(income(picks, {}, WED).planned, 7 * one);
});

test('today is not open any more when the clear was made on another difficulty', () => {
  // Normal Zakum is picked; today's clear was ticked on Easy (one clear a day for both).
  const r = income(solo('zakum-normal'), { 'zakum-easy': { [dayOf(WED)]: true } }, WED);
  assert.equal(r.lines[0].open, 0);
  assert.equal(r.target, r.earned);
  // A second difficulty picked for the same clear adds no open days of its own.
  const two = income(solo('zakum-normal', 'zakum-easy'), {}, SUN);
  assert.equal(two.target, 4 * heroic('zakum-normal'));
});

test('weekly and monthly bosses stay in the target until their own reset', () => {
  const r = income(solo('lucid-hard', 'cygnus-normal'), {}, WED);
  assert.equal(r.target, heroic('lucid-hard') + heroic('cygnus-normal'));
});

// ---- "Daily bosses" follows the daily bosses picked on Bosses, with the same ticks ----
test('the Daily bosses item is the picked daily bosses, one per shared clear, and is done by the Bosses ticks', () => {
  const [item, g] = itemOf('d-bosses');
  assert.equal(item.bosses, 'daily', 'the rule is data in checklist.json');
  assert.equal(item.chips, undefined, 'no fixed list of names');
  const state = { characters: [main], bosses: { a: { picks: solo('omni-cln-normal', 'zakum-normal', 'zakum-easy', 'horntail-chaos', 'lucid-hard'), clears: {} } } };
  const cs = { items: {}, resets: {}, flags: {}, history: {} };
  let st = itemStatus(item, g, cs, FRI, whoFor(DATA, state, main));
  assert.deepEqual(st.rows.map((r) => r.bossId).sort(), ['horntail-chaos', 'omni-cln-normal', 'zakum-normal'], 'the picks, Easy and Normal Zakum as one clear, no weekly boss');
  assert.equal(st.total, 3);
  assert.equal(st.count, 0);
  assert.equal(st.done, false);
  assert.equal(st.link, false, 'it counts as a core daily');
  // Cleared on Bosses: OMNI-CLN, and Zakum on the Easy difficulty.
  state.bosses.a.clears = { 'omni-cln-normal': { [dayOf(FRI)]: true }, 'zakum-easy': { [dayOf(FRI)]: true } };
  st = itemStatus(item, g, cs, FRI, whoFor(DATA, state, main));
  assert.equal(st.count, 2);
  assert.equal(st.done, false);
  state.bosses.a.clears['horntail-chaos'] = { [dayOf(FRI)]: true };
  st = itemStatus(item, g, cs, FRI, whoFor(DATA, state, main));
  assert.equal(st.count, 3);
  assert.equal(st.done, true);
  // The next day the ticks are for yesterday.
  assert.equal(itemStatus(item, g, cs, FRI + DAY, whoFor(DATA, state, main)).count, 0);
});

test('with no daily boss picked the item is a pointer to Bosses and is not counted', () => {
  const [item, g] = itemOf('d-bosses');
  const state = { characters: [main], bosses: { a: { picks: solo('lucid-hard'), clears: {} } } };
  // A chip tick saved by the version before stays in the data and is not read.
  const cs = { items: { 'a|d-bosses_cyg': { p: dayOf(FRI), d: 1 }, 'a|d-bosses_hilla': { p: dayOf(FRI), d: 1 }, 'a|d-bosses_pb': { p: dayOf(FRI), d: 1 } }, resets: {}, flags: {}, history: {} };
  const before = JSON.stringify(cs);
  const st = itemStatus(item, g, cs, FRI, whoFor(DATA, state, main));
  assert.equal(st.link, true);
  assert.equal(st.prompt, true);
  assert.equal(st.done, false);
  assert.equal(JSON.stringify(cs), before, 'saved ticks are left as they are');
  assert.ok(item.empty && /Bosses/.test(item.empty), 'the pointer text is data');
  const withPick = { characters: [main], bosses: { a: { picks: solo('lucid-hard', 'cygnus-normal'), clears: {} } } };
  const none = dailyProgress(checklist, cs, FRI, whoFor(DATA, state, main));
  const some = dailyProgress(checklist, cs, FRI, whoFor(DATA, withPick, main));
  // Daily bosses are counted with the bosses, never with the core dailies: a new pick cannot undo a finished day.
  assert.equal(some.total, none.total, 'picking a daily boss does not change the dailies total');
  // The old chip ticks never make it done.
  assert.equal(itemStatus(item, g, cs, FRI, whoFor(DATA, withPick, main)).done, false);
});

test('Today: the chips are the picked daily bosses; pressing one is the Bosses tick; the day can be finished', async (t) => {
  at(t, FRI);
  const el = await show(t, TodayPage, (s) => {
    s.bosses.a = { picks: solo('omni-cln-normal', 'zakum-normal', 'lucid-hard'), clears: {} };
    tickOtherDailies(s, 'a', FRI);
  });
  const row = () => rowOf(el, 'Daily bosses');
  const chips = () => row().findAll((n) => n.localName === 'button' && String(n.attrs.class || '').split(' ').includes('chip'));
  assert.deepEqual(chips().map((c) => c.text.trim()).sort(), ['Normal OMNI-CLN', 'Normal Zakum']);
  assert.doesNotMatch(text(row()), /Hilla|Pink Bean|Cygnus/, 'no boss that is not picked');
  assert.match(text(row()), /0 \/ 2/);
  const total = dailyProgress(checklist, store.getState().checklist, FRI, who(store.getState())).total;
  // The other dailies are all ticked, so the dailies are complete whatever the bosses say; the boss count holds
  // all three picked bosses, the daily ones included.
  assert.match(text(el), new RegExp(`Do today ${total} / ${total} dailies · 0 / 3 bosses `));
  // Listed once: the daily bosses are chips, the list under "Bosses" holds the weekly one.
  assert.equal(byId(el, 'today-boss-omni-cln-normal'), null);
  assert.ok(byId(el, 'today-boss-lucid-hard'));

  chips().find((c) => c.text.trim() === 'Normal OMNI-CLN').fire('click');
  assert.ok(await until(() => /1 \/ 2/.test(text(row()))), 'the count moves');
  assert.equal(store.getState().bosses.a.clears['omni-cln-normal'][dayOf(FRI)], true, 'saved as the boss clear');
  assert.equal(Object.keys(store.getState().checklist.items).some((k) => k.includes('d-bosses')), false, 'no second record');
  assert.equal(chips().find((c) => c.text.trim() === 'Normal OMNI-CLN').attrs['aria-pressed'], 'true');

  chips().find((c) => c.text.trim() === 'Normal Zakum').fire('click');
  assert.ok(await until(() => /2 \/ 2/.test(text(row()))));
  assert.ok(text(el).includes('dailies · 2 / 3 bosses '), 'the boss count covers the daily ones');
  // Every core daily is done: the tile, the card and the streak agree.
  assert.ok(await until(() => { const h = (store.getState().checklist.history || {})[dayKey(FRI)]; return h && h.done === total && h.total === total; }), 'the streak day is complete');
  assert.match(text(el), new RegExp(`Core dailies ${total} / ${total}`));
  assert.match(text(el), /1-day streak/);
  // The crystals are counted: both daily clears are earned.
  const mine = computeIncome(store.getState().characters, store.getState(), bosses, bossById, FRI).perChar.a;
  assert.equal(mine.earned, heroic('omni-cln-normal') + heroic('zakum-normal'));

  // Pressing again takes the clear back, on Bosses too.
  chips().find((c) => c.text.trim() === 'Normal Zakum').fire('click');
  assert.ok(await until(() => /1 \/ 2/.test(text(row()))));
  assert.equal(store.getState().bosses.a.clears['zakum-normal'][dayOf(FRI)], undefined);
});

test('a daily boss ticked on Bosses shows on the Checklist chips, and the other way round', async (t) => {
  at(t, FRI);
  const picks = solo('cygnus-normal', 'hilla-hard');
  const el = await show(t, ChecklistPage, (s) => { s.bosses.a = { picks, clears: {} }; });
  const chip = (name) => rowOf(el, 'Daily bosses').findAll((n) => n.localName === 'button').find((c) => c.text.trim() === name);
  assert.equal(chip('Normal Cygnus').attrs['aria-pressed'], 'false');
  // Ticked the way the Bosses page ticks it.
  const line = characterLines(main, { picks, clears: {} }, bosses, bossById, FRI).find((l) => l.bossId === 'cygnus-normal');
  toggleClear('a', bossById['cygnus-normal'], line, true);
  assert.ok(await until(() => chip('Normal Cygnus').attrs['aria-pressed'] === 'true'));
  assert.match(text(rowOf(el, 'Daily bosses')), /1 \/ 2/);
  chip('Hard Hilla').fire('click');
  assert.ok(await until(() => chip('Hard Hilla').attrs['aria-pressed'] === 'true'));
  const bossesEl = await show(t, BossesPage, (s) => { s.bosses.a = JSON.parse(JSON.stringify(store.getState().bosses.a)); });
  assert.ok(isOn(byId(bossesEl, 'clear-hilla-hard')), 'the Bosses row is ticked');
  assert.ok(isOn(byId(bossesEl, 'clear-cygnus-normal')));
});

test('with no daily boss picked Today and Checklist show a short link to Bosses', async (t) => {
  at(t, FRI);
  const today = await show(t, TodayPage, (s) => { s.bosses.a = { picks: solo('lucid-hard'), clears: {} }; });
  assert.match(text(today), /Pick your daily bosses on Bosses/);
  const link = today.find((n) => n.localName === 'a' && /Pick your daily bosses on Bosses/.test(n.text));
  assert.equal(link.attrs.href, '#bosses');
  assert.doesNotMatch(text(today), /Cygnus \(Normal\)|Hilla \(Hard\)|Pink Bean \(Chaos\)/);
  assert.equal(today.findAll((n) => n.localName === 'button' && String(n.attrs.class || '').split(' ').includes('chip') && /Cygnus|Hilla|Pink Bean/.test(n.text)).length, 0);
});

test('the reset warning names daily bosses once, and not at all when they are cleared', () => {
  const now = Date.parse('2026-11-27T22:30:00Z'); // 1.5 h before the daily reset
  const picks = solo('cygnus-normal', 'hilla-hard');
  const run = (clears) => {
    const state = { characters: [main], bosses: { a: { picks, clears } } };
    const cs = { items: {}, resets: {}, flags: {}, history: {} };
    tickOtherDailies({ checklist: cs }, 'a', now);
    const lines = characterLines(main, state.bosses.a, bosses, bossById, now);
    return resetWarnings(checklist, cs, lines, now, { who: whoFor(DATA, state, main), weeklyCap: 14 }).find((w) => w.kind === 'daily');
  };
  const open = run({});
  assert.equal(open.bosses.count, 2);
  assert.equal(open.items.includes('Daily bosses'), false, 'the bosses are in the boss count, not named again');
  const half = run({ 'cygnus-normal': { [dayOf(now)]: true } });
  assert.equal(half.bosses.count, 1);
  assert.equal(run({ 'cygnus-normal': { [dayOf(now)]: true }, 'hilla-hard': { [dayOf(now)]: true } }), undefined, 'nothing is open: no warning');
});

// ---- Normal Kai and Mayrin: the Checklist rows are the Bosses ticks ----
test('Normal Kai on the Checklist is the same tick as Kai on Bosses, picked or not', () => {
  const [item, g] = itemOf('w-kai');
  assert.deepEqual(item.boss, ['kai-normal']);
  const cs = { items: {}, resets: {}, flags: {}, history: {} };
  const state = { characters: [main], bosses: { a: { picks: {}, clears: {} } } };
  assert.equal(itemStatus(item, g, cs, FRI, whoFor(DATA, state, main)).done, false);
  state.bosses.a.clears['kai-normal'] = { [week]: true };
  assert.equal(itemStatus(item, g, cs, FRI, whoFor(DATA, state, main)).done, true, 'not picked: the clear still shows');
  state.bosses.a.picks = solo('kai-normal');
  assert.equal(itemStatus(item, g, cs, FRI, whoFor(DATA, state, main)).done, true);
  assert.equal(itemStatus(item, g, cs, FRI + 7 * DAY, whoFor(DATA, state, main)).done, false, 'gone after the Thursday reset');
  // A tick made on the Checklist before this change still shows for its week.
  const old = { items: { 'a|w-kai': { p: week, d: 1 } }, resets: {}, flags: {}, history: {} };
  const blank = { characters: [main], bosses: { a: { picks: {}, clears: {} } } };
  assert.equal(itemStatus(item, g, old, FRI, whoFor(DATA, blank, main)).done, true);
});

test('ticking Kai on the Checklist ticks it on Bosses and Today, and unticking takes it back', async (t) => {
  at(t, FRI);
  const el = await show(t, ChecklistPage, (s) => { s.bosses.a = { picks: solo('kai-normal', 'lucid-hard'), clears: {} }; });
  const box = () => byId(el, 'cl-w-kai');
  assert.equal(isOn(box()), false);
  box().fire('change', { currentTarget: { checked: true } });
  assert.ok(await until(() => isOn(box())));
  assert.equal(store.getState().bosses.a.clears['kai-normal'][week], true);
  assert.equal(store.getState().checklist.items['a|w-kai'], undefined, 'no second record');
  const saved = JSON.parse(JSON.stringify(store.getState().bosses.a));
  const bossesEl = await show(t, BossesPage, (s) => { s.bosses.a = saved; });
  assert.ok(isOn(byId(bossesEl, 'clear-kai-normal')), 'Bosses shows it cleared');
  // Unticked on Bosses: the Checklist row follows.
  byId(bossesEl, 'clear-kai-normal').fire('change', { currentTarget: { checked: false } });
  assert.ok(await until(() => !store.getState().bosses.a.clears['kai-normal'][week]));
  const again = await show(t, ChecklistPage, (s) => { s.bosses.a = JSON.parse(JSON.stringify(store.getState().bosses.a)); });
  assert.equal(isOn(byId(again, 'cl-w-kai')), false);
});

test('Kai ticked on Today leaves no "Normal Kai" in the Thursday warning', () => {
  const now = Date.parse('2026-12-02T20:00:00Z');
  const wk = periodKey('thu', now);
  const state = { characters: [main], bosses: { a: { picks: solo('kai-normal'), clears: { 'kai-normal': { [wk]: true } } } } };
  const cs = { items: {}, resets: {}, flags: {}, history: {} };
  const lines = characterLines(main, state.bosses.a, bosses, bossById, now);
  const thu = resetWarnings(checklist, cs, lines, now, { who: whoFor(DATA, state, main), weeklyCap: 14 }).find((w) => w.kind === 'thu');
  assert.ok(thu, 'other Thursday items are still open');
  assert.equal(thu.items.includes('Normal Kai'), false);
  state.bosses.a.clears = {};
  const open = resetWarnings(checklist, cs, characterLines(main, state.bosses.a, bosses, bossById, now), now, { who: whoFor(DATA, state, main), weeklyCap: 14 }).find((w) => w.kind === 'thu');
  assert.equal(open.items.includes('Normal Kai'), true, 'named while it is open');
});

test('an old Checklist tick for Kai can be taken back, and the session planner writes the boss tick', async (t) => {
  at(t, FRI);
  const [item, g] = itemOf('w-kai');
  store.replaceState({ ...store.blankState(), characters: [{ ...main }], activeId: 'a' });
  t.after(() => store.resetState());
  store.update((s) => { s.checklist.items['a|w-kai'] = { p: week, d: 1, t: FRI }; });
  let st = itemStatus(item, g, store.getState().checklist, FRI, who(store.getState()));
  assert.equal(st.done, true);
  tickItem(item, st, who(store.getState()), false);
  st = itemStatus(item, g, store.getState().checklist, FRI, who(store.getState()));
  assert.equal(st.done, false, 'unticking clears the old tick');
  tickItem(item, st, who(store.getState()), true);
  assert.equal(store.getState().bosses.a.clears['kai-normal'][week], true, 'a new tick is the boss clear');
  // The planner lists Kai (resets within two days of a Tuesday) and leaves the boss-list rows out.
  const tue = Date.parse('2026-12-01T12:00:00Z');
  const plan = planSession(checklist, { items: {}, resets: {}, flags: {}, history: {} }, tue, 600, whoFor(DATA, { characters: [main], bosses: { a: { picks: solo('cygnus-normal'), clears: {} } } }, main));
  assert.ok(plan.picks.some((p) => p.item.id === 'w-kai'));
  assert.equal(plan.picks.some((p) => p.item.bosses), false);
});

test('Mayrin on the Checklist is account-wide: a clear on any character counts, and the tick goes to the picked difficulty', () => {
  const [item, g] = itemOf('w-mayrin');
  assert.deepEqual(item.boss, ['mayrin-normal', 'mayrin-hard']);
  assert.equal(item.scope, 'account');
  const hi = { ...main, id: 'a', level: 281 };
  const second = { ...main, id: 'c', name: 'Second', level: 272 };
  const cs = { items: {}, resets: {}, flags: {}, history: {} };
  const state = { characters: [hi, second], bosses: { a: { picks: solo('mayrin-hard'), clears: {} }, c: { picks: solo('mayrin-normal'), clears: {} } } };
  let st = itemStatus(item, g, cs, FRI, whoFor(DATA, state, hi));
  assert.equal(st.done, false);
  assert.equal(st.clear.boss.id, 'mayrin-hard', 'a tick goes to the difficulty this character picked');
  state.bosses.c.clears['mayrin-normal'] = { [week]: true };
  st = itemStatus(item, g, cs, FRI, whoFor(DATA, state, hi));
  assert.equal(st.done, true, 'cleared on the other character');
  assert.equal(st.clear.own, false);
  assert.deepEqual(st.clear.others.map((o) => o.id), ['c']);
  assert.equal(itemStatus(item, g, cs, FRI, whoFor(DATA, state, second)).done, true);
});

test('unticking account-wide Mayrin takes the clear away from the character that has it', async (t) => {
  at(t, FRI);
  const [item, g] = itemOf('w-mayrin');
  const hi = { ...main, id: 'a', level: 281 };
  const second = { ...main, id: 'c', name: 'Second', level: 272 };
  store.replaceState({ ...store.blankState(), characters: [hi, second], activeId: 'a' });
  t.after(() => store.resetState());
  store.update((s) => { s.bosses.a = { picks: {}, clears: {} }; s.bosses.c = { picks: solo('mayrin-normal'), clears: { 'mayrin-normal': { [week]: true } } }; });
  let st = itemStatus(item, g, store.getState().checklist, FRI, who(store.getState()));
  assert.equal(st.done, true);
  tickItem(item, st, who(store.getState()), false);
  assert.equal(store.getState().bosses.c.clears['mayrin-normal'][week], undefined);
  st = itemStatus(item, g, store.getState().checklist, FRI, who(store.getState()));
  assert.equal(st.done, false);
  // Ticked with nothing picked: saved on Normal, the first difficulty.
  tickItem(item, st, who(store.getState()), true);
  assert.equal(store.getState().bosses.a.clears['mayrin-normal'][week], true);
});

// ---- "Weekly bosses" shows the real count ----
test('the Weekly bosses row shows cleared / picked from Bosses and stays out of the dailies and the warning', async (t) => {
  at(t, FRI);
  const [item, g] = itemOf('w-crystals');
  const state = { characters: [main], bosses: { a: { picks: solo('lucid-hard', 'lucid-normal', 'will-hard', 'cygnus-normal'), clears: { 'lucid-normal': { [week]: true } } } } };
  const cs = { items: {}, resets: {}, flags: {}, history: {} };
  const st = itemStatus(item, g, cs, FRI, whoFor(DATA, state, main));
  assert.equal(st.total, 2, 'two weekly clears are picked: Lucid (two difficulties, one clear) and Will');
  assert.equal(st.count, 1, 'Lucid is cleared, on Normal');
  assert.equal(st.link, true, 'still a pointer: never a to-do of its own');
  assert.equal(st.done, false);
  const el = await show(t, ChecklistPage, (s) => { s.bosses.a = JSON.parse(JSON.stringify(state.bosses.a)); });
  const row = () => rowOf(el, 'Weekly bosses');
  assert.match(text(row()), /1 \/ 2/);
  assert.ok(row().find((n) => n.localName === 'a' && n.attrs.href === '#bosses'), 'the Open link stays');
  assert.equal(String(row().attrs.class).split(' ').includes('done'), false);
  const line = characterLines(main, store.getState().bosses.a, bosses, bossById, FRI).find((l) => l.bossId === 'will-hard');
  toggleClear('a', bossById['will-hard'], line, true);
  assert.ok(await until(() => /2 \/ 2/.test(text(row()))));
  assert.ok(String(row().attrs.class).split(' ').includes('done'), 'all picked weekly bosses cleared: the row is done');
});

// ---- the "Do today" boss list heading ----
test('the boss list heading names the resets that are in the list', async (t) => {
  const lines = (...kinds) => kinds.map((kind) => ({ kind }));
  assert.equal(bossResetHint(lines('weekly', 'weekly')), 'weekly reset Thu 09:00 KST');
  assert.equal(bossResetHint(lines('daily')), 'daily reset 09:00 KST');
  assert.match(bossResetHint(lines('weekly', 'monthly')), /weekly ones Thu 09:00 KST · monthly ones on the 1st/);
  assert.match(bossResetHint(lines('monthly', 'daily', 'weekly')), /^resets: daily ones 09:00 KST · weekly ones Thu 09:00 KST · monthly ones on the 1st$/);
  assert.equal(bossResetHint([]), '');
  at(t, FRI);
  const el = await show(t, TodayPage, (s) => { s.bosses.a = { picks: solo('black-mage-hard', 'lucid-normal', 'cygnus-normal'), clears: {} }; });
  const head = el.findAll((n) => n.localName === 'h4').find((n) => /^Bosses/.test(n.text.trim()));
  assert.match(text(head), /weekly ones Thu 09:00 KST · monthly ones on the 1st/);
  assert.doesNotMatch(text(head), /weekly reset Thu/, 'one reset is not claimed for a mixed list');
  const only = await show(t, TodayPage, (s) => { s.bosses.a = { picks: solo('lucid-normal', 'cygnus-normal'), clears: {} }; });
  const head2 = only.findAll((n) => n.localName === 'h4').find((n) => /^Bosses/.test(n.text.trim()));
  assert.match(text(head2), /weekly reset Thu 09:00 KST/);
  // Only daily bosses picked: they are the chips above, and the list says so.
  const daily = await show(t, TodayPage, (s) => { s.bosses.a = { picks: solo('cygnus-normal'), clears: {} }; });
  assert.match(text(daily), /Your daily bosses are under Core dailies above/);
  assert.doesNotMatch(text(daily), /No bosses picked yet/);
});

// ---- first-run setup: one clear per boss ----
test('setup: a second difficulty of the same boss replaces the first', async (t) => {
  let p = toggleSetupPick({}, bossById['lucid-normal'], bosses.bosses);
  p = toggleSetupPick(p, bossById['lucid-hard'], bosses.bosses);
  assert.deepEqual(Object.keys(p).filter((id) => p[id]), ['lucid-hard']);
  p = toggleSetupPick(p, bossById['will-hard'], bosses.bosses);
  p = toggleSetupPick(p, bossById['zakum-chaos'], bosses.bosses);
  assert.deepEqual(Object.keys(p).filter((id) => p[id]).sort(), ['lucid-hard', 'will-hard', 'zakum-chaos']);
  p = toggleSetupPick(p, bossById['lucid-hard'], bosses.bosses);
  assert.equal(Boolean(p['lucid-hard']), false, 'pressing a picked chip takes it back');
  assert.equal(Boolean(p['lucid-normal']), false);

  at(t, FRI);
  const el = await show(t, TodayPage, (s) => { s.characters = []; s.activeId = null; });
  const chip = (name) => el.findAll((n) => n.localName === 'button' && String(n.attrs.class || '').split(' ').includes('chip')).find((c) => c.text.trim().startsWith(name + ' ·'));
  const line = () => text(el.findAll((n) => n.localName === 'span' && /Weekly bosses you clear/.test(n.text))[0]);
  chip('Normal Lucid').fire('click');
  assert.ok(await until(() => /1 picked/.test(line())));
  chip('Hard Lucid').fire('click');
  assert.ok(await until(() => chip('Hard Lucid').attrs['aria-pressed'] === 'true' && chip('Normal Lucid').attrs['aria-pressed'] === 'false'));
  assert.match(line(), /1 picked/);
  const interactive = (id) => crystalValue(bossById[id], { world: 'heroic' }, bosses);
  const { fmtMesos } = await import('../../site/app/calc/income.js');
  assert.ok(line().includes(`${fmtMesos(interactive('lucid-hard'))} a week`), 'the total is one Lucid crystal: ' + line());
  // What is saved is what the rest of the app plans.
  const s = store.blankState();
  applySetup(s, { name: 'New', level: 264, world: 'heroic' }, Object.keys(p).filter((id) => p[id]), 'n1', FRI);
  const r = computeIncome(s.characters, s, bosses, bossById, FRI).perChar.n1;
  assert.equal(r.lines.some((l) => l.spare), false);
});

// ---- entry rules on the boss picker ----
test('entry rules are data on the boss, and follow the character', () => {
  assert.equal(bossById['kai-normal'].only, 'challenger');
  assert.equal(bossById['mayrin-normal'].minLevel, itemOf('w-mayrin')[0].minLevel, 'the same level as the Checklist item');
  assert.ok(bossById['mayrin-hard'].minLevel > bossById['mayrin-normal'].minLevel);
  assert.ok(bosses.entryNote, 'the fields say where their rules come from');
  assert.equal(entryBlock(bossById['kai-normal'], { challenger: false, level: 210 }), 'challenger');
  assert.equal(entryBlock(bossById['kai-normal'], { challenger: true, level: 210 }), null);
  assert.equal(entryBlock(bossById['mayrin-normal'], { challenger: true, level: 264 }), 'level');
  assert.equal(entryBlock(bossById['mayrin-normal'], { challenger: true, level: 270 }), null);
  assert.equal(entryBlock(bossById['mayrin-normal'], { challenger: true, level: undefined }), null, 'an unknown level never locks');
  assert.equal(entryBlock(bossById['lucid-hard'], { challenger: false, level: 10 }), null, 'a boss with no entry fields is always offered');
});

test('Bosses: Kai and Mayrin are not offered to a character that cannot enter', async (t) => {
  at(t, FRI);
  // A Lv. 210 alt outside Challenger World.
  const altEl = await show(t, BossesPage, (s) => { s.characters = [{ ...main }, { ...alt }]; s.activeId = 'b'; });
  assert.ok(byId(altEl, 'pick-lucid-hard'), 'the weekly list is drawn');
  for (const id of ['kai-normal', 'mayrin-normal', 'mayrin-hard']) assert.equal(byId(altEl, 'pick-' + id), null, id + ' is left out');
  // The Lv. 264 Challenger main: Kai is offered, Mayrin is shown locked with the level.
  const mainEl = await show(t, BossesPage);
  assert.ok(byId(mainEl, 'pick-kai-normal'));
  assert.equal(isOff(byId(mainEl, 'pick-kai-normal')), false);
  assert.ok(isOff(byId(mainEl, 'pick-mayrin-normal')), 'locked below its level');
  assert.ok(isOff(byId(mainEl, 'pick-mayrin-hard')));
  const row = mainEl.find((n) => n.localName === 'tr' && n.find((x) => x.attrs.id === 'pick-mayrin-normal'));
  assert.match(text(row), /From Lv\. 270: Erel is Lv\. 264/);
  // At the level it opens.
  const high = await show(t, BossesPage, (s) => { s.characters = [{ ...main, level: 270 }]; });
  assert.equal(isOff(byId(high, 'pick-mayrin-normal')), false);
  assert.ok(isOff(byId(high, 'pick-mayrin-hard')));
  // A pick saved earlier stays, so it can be unticked; nothing is deleted.
  const kept = await show(t, BossesPage, (s) => { s.characters = [{ ...alt }]; s.activeId = 'b'; s.bosses.b = { picks: solo('kai-normal'), clears: {} }; });
  assert.ok(byId(kept, 'pick-kai-normal'));
  assert.equal(isOff(byId(kept, 'pick-kai-normal')), false);
  assert.ok(store.getState().bosses.b.picks['kai-normal']);
});

// ---- Liberation: a plan that can be set from the Bosses picks ----
test('Liberation can be set from the bosses picked on Bosses, one per shared clear', () => {
  const def = liberation.genesis;
  const sources = Object.keys(def.sources).filter((id) => bossById[id]);
  // Two difficulties of one trace boss, if the data has such a pair, count once.
  const pair = sources.map((id) => [id, sources.find((o) => o !== id && bossById[o].boss === bossById[id].boss && bossById[o].reset === bossById[id].reset)]).find(([, o]) => o);
  const notSource = bosses.bosses.find((b) => !def.sources[b.id]);
  const picks = solo(sources[0], notSource.id, ...(pair || []));
  const set = liberationFromBosses(def, picks, bossById);
  for (const id of Object.keys(set)) assert.ok(def.sources[id], 'only bosses that give traces');
  assert.ok(set[sources[0]] || (pair && pair.includes(sources[0])));
  if (pair) {
    const best = def.sources[pair[0]] >= def.sources[pair[1]] ? pair[0] : pair[1];
    assert.equal(Boolean(set[pair[0]]) + Boolean(set[pair[1]]), 1);
    assert.ok(def.sources[Object.keys(set).find((id) => pair.includes(id))] === def.sources[best]);
  }
  assert.deepEqual(liberationFromBosses(def, solo(notSource.id), bossById), {});
  assert.deepEqual(liberationFromBosses(def, {}, bossById), {});
  // The plan from that list is the plan from ticking the same chips by hand.
  const a = liberationPlan(def, { picks: set }, FRI, bossById);
  const b = liberationPlan(def, { picks: Object.fromEntries(Object.keys(set).map((id) => [id, true])) }, FRI, bossById);
  assert.equal(a.perWeek, b.perWeek);
});

test('Progress > Liberation: one button uses the Bosses picks, and the card says it is a plan', async (t) => {
  at(t, FRI);
  const def = liberation.genesis;
  const src = Object.keys(def.sources).filter((id) => bossById[id] && bossById[id].reset === 'weekly').slice(0, 2);
  const el = await show(t, ProgressPage, (s) => { s.ui.progressView = 'liberation'; s.bosses.a = { picks: solo(...src, 'cygnus-normal'), clears: {} }; });
  assert.match(text(el), /This is a plan, not a record of clears/);
  assert.match(text(el), /does not add traces/);
  const btn = byId(el, 'lib-from-bosses-genesis');
  assert.ok(btn, 'the button is there');
  assert.equal(isOff(btn), false);
  assert.equal(store.getState().liberation.a, undefined, 'nothing is saved until it is pressed');
  btn.fire('click');
  assert.ok(await until(() => store.getState().liberation.a && store.getState().liberation.a.genesis && store.getState().liberation.a.genesis.picks));
  assert.deepEqual(Object.keys(store.getState().liberation.a.genesis.picks).sort(), [...src].sort());
  assert.ok(await until(() => isOff(byId(el, 'lib-from-bosses-genesis'))), 'pressed: the list matches');
  assert.match(text(byId(el, 'lib-from-bosses-genesis')), /Matches your Bosses picks/);
  // With no trace boss picked there is nothing to use.
  const none = await show(t, ProgressPage, (s) => { s.ui.progressView = 'liberation'; s.bosses.a = { picks: solo('cygnus-normal'), clears: {} }; });
  assert.ok(isOff(byId(none, 'lib-from-bosses-genesis')));
});

// ---- helpers the pages share ----
test('bossRows and bossClear read the same ticks the Bosses page writes', () => {
  const state = { picks: solo('zakum-normal', 'zakum-easy', 'lucid-hard'), clears: { 'zakum-easy': { [dayOf(FRI)]: true } } };
  const lines = characterLines(main, state, bosses, bossById, FRI);
  const rows = bossRows(lines, 'daily');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bossId, 'zakum-normal');
  assert.equal(rows[0].on, true, 'done on the other difficulty');
  assert.equal(bossRows(lines, 'weekly')[0].on, false);
  const c = bossClear(['mayrin-normal', 'mayrin-hard'], { picks: solo('mayrin-hard'), clears: {} }, bossById, FRI);
  assert.equal(c.boss.id, 'mayrin-hard');
  assert.deepEqual(c.shared, ['mayrin-normal']);
  assert.equal(c.on, false);
  assert.equal(bossClear(['no-such-boss'], {}, bossById, FRI), null);
  assert.equal(bossClear(['kai-normal'], { clears: { 'kai-normal': { [week]: true } } }, bossById, FRI).on, true);
  assert.equal(recordKey(itemOf('w-kai')[0], { id: 'a' }), 'a|w-kai');
});
