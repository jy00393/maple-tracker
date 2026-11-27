// One-press ticks with an Undo bar, and shorter phone pages.
// - "All done" ticks a checklist group's open plain rows; "All cleared" this week's open weekly bosses (each through
//   toggleClear, so shared difficulties move the right tick).
// - The Undo bar: a new update() that puts back only what the action changed, never what changed meanwhile.
// - Phone pages: the streak calendar under the lists, notes behind an (i), the season card folded to one line,
//   cleared bosses at the bottom of Today's list.
// Every test sets its own clock and state and puts both back. Pages are read once they listen to the store, and
// after a press the test waits for the change itself, never a fixed time. The Undo bar is told to stay for 10
// minutes, so nothing depends on how fast the tests run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

installFakeBrowser({});
const store = await import('../../site/app/store.js');
const { html, render, useEffect } = await import('../../site/vendor/htm-preact.mjs');
const { changesBetween, revertChanges } = await import('../../site/app/calc/undo.js');
const { bulkTargets, weeklyTargets, clearedLast, seasonFold, notesShown } = await import('../../site/app/calc/daily.js');
const { seasonOutlook } = await import('../../site/app/calc/season.js');
const { units, mergeStates } = await import('../../site/app/calc/merge.js');
const { undoable, undoLast, undoNow, dismissUndo, undoTimes, UndoBar } = await import('../../site/app/undo.js');
const { TodayPage } = await import('../../site/app/pages/today.js');
const { ChecklistPage, whoOf } = await import('../../site/app/pages/checklist.js');
const { BossesPage, toggleClear } = await import('../../site/app/pages/bosses.js');
const { computeIncome, clearKey } = await import('../../site/app/calc/income.js');
const { periodKey } = await import('../../site/app/time.js');

undoTimes.ms = 600000;
const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const DAY = 86400000;
const T0 = Date.parse('2026-11-27T03:00:00Z'); // Fri 27 Nov, 12:00 KST

function pageData(extra = {}) {
  const names = { gearstats: 'gearStats', expsources: 'expSources', bosscp: 'bossCp' };
  const data = {};
  for (const n of ['bosses', 'symbols', 'liberation', 'ibp', 'checklist', 'gear', 'erda', 'upgrades', 'potential', 'gearstats', 'tables', 'season', 'pitched', 'flames', 'champions', 'expsources', 'bosscp', 'classes']) data[names[n] || n] = load(n);
  Object.assign(data, { events: { events: [], sunny: [] }, news: { items: [] }, nexonCharacters: { characters: [] }, meta: null, upcoming: { items: [] } });
  data.shops = JSON.parse(readFileSync(new URL('./fixtures/shops.json', import.meta.url), 'utf8'));
  Object.assign(data, extra);
  data.bossById = Object.fromEntries(data.bosses.bosses.map((b) => [b.id, b]));
  return data;
}
const DATA = pageData();
const MAIN = { id: 'a', name: 'Erel', cls: 'Erel Light', level: 264, world: 'heroic', region: 'na', mainStat: 'STR', challenger: true, beyondBurning: true };
const ALT = { id: 'b', name: 'Alt', cls: 'Bishop', level: 210, world: 'interactive', region: 'na', mainStat: 'INT', challenger: false };

const realNow = Date.now;
let clock = null;
Date.now = () => (clock === null ? realNow() : clock);
const mounted = new Set();
after(() => { Date.now = realNow; for (const el of mounted) render(null, el); });
function at(t, time) {
  clock = time;
  store.resetState();
  dismissUndo();
  setNarrow(false);
  t.after(() => { clock = null; store.resetState(); dismissUndo(); setNarrow(false); });
}
function start(mutate = () => {}, chars = [MAIN]) {
  store.update((s) => {
    s.characters = chars.map((c) => ({ ...c }));
    s.activeId = chars.length ? chars[0].id : null;
    mutate(s);
  });
}
async function until(check, what, ms = 5000) {
  for (const end = realNow() + ms; realNow() < end;) { if (check()) return true; await tick(5); }
  assert.ok(check(), `waited for ${what}`);
  return true;
}
// The page with the Undo bar under it, returned once it listens to the store.
async function show(Page, data = DATA) {
  let ready = false;
  const App = () => { const state = store.useStore(); useEffect(() => { ready = true; }, []); return html`<${Page} data=${data} state=${state} /><${UndoBar} />`; };
  const el = new FakeNode('div');
  mounted.add(el);
  render(html`<${App} />`, el);
  await until(() => ready, 'the page to listen');
  await tick(5);
  return el;
}
const close = (el) => { render(null, el); mounted.delete(el); };
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
const button = (el, re) => el.find((n) => n.localName === 'button' && (re.test(n.attrs['aria-label'] || '') || re.test(squash(n.text))));
const bar = (el) => el.find((n) => n.attrs.class === 'undo-bar');
// A phone-sized screen (760px or less) or a wide one, as matchMedia reports it.
function setNarrow(on) {
  globalThis.window.matchMedia = (q) => ({ matches: on && /max-width:\s*760px/.test(q), addEventListener() {}, removeEventListener() {} });
}

// ---- the undo maths -------------------------------------------------------------------------------------------
test('changesBetween lists only what changed; revertChanges puts it back and keeps what changed since', () => {
  const before = { checklist: { items: { x: { d: 1 } } }, bosses: {}, mesos: { held: 5, goals: [{ id: 'g' }] }, stamps: { a: 1 }, updatedAt: 1 };
  const after = structuredClone(before);
  after.checklist.items.y = { d: 1 };
  after.bosses.a = { clears: { will: { k: true } } };
  after.mesos.goals = [];
  after.stamps = { a: 2 };
  after.updatedAt = 2;
  const ch = changesBetween(before, after);
  assert.deepEqual(ch.map((c) => c.path.join('/')).sort(), ['bosses/a', 'checklist/items/y', 'mesos/goals']);
  // Meanwhile another device changed something else, and one of the same values.
  const now = structuredClone(after);
  now.mesos.held = 9;
  now.mesos.goals = [{ id: 'h' }];
  const r = revertChanges(now, ch);
  assert.deepEqual(r, { undone: 2, skipped: 1 });
  assert.equal(now.checklist.items.y, undefined);
  assert.equal(now.bosses.a, undefined);
  assert.deepEqual(now.mesos.goals, [{ id: 'h' }], 'a value changed since is left as it is');
  assert.equal(now.mesos.held, 9, 'an unrelated edit is kept');
  assert.deepEqual(now.stamps, { a: 2 }, 'the bookkeeping is never put back');
  // Nothing that names the object prototype is walked or written.
  const bad = JSON.parse('{"__proto__": {"x": 1}}');
  assert.deepEqual(changesBetween({}, bad), []);
  assert.deepEqual(revertChanges({}, [{ path: ['__proto__', 'x'], was: 1, now: undefined }]), { undone: 0, skipped: 0 });
  assert.equal({}.x, undefined);
});

test('Undo after a tick is a new edit: its own stamps, an edit synced in meanwhile is kept', (t) => {
  at(t, T0);
  start();
  const item = DATA.checklist.groups[0].items.find((i) => i.id === 'd-coupon');
  const group = DATA.checklist.groups[0];
  undoable('Ticked a row', () => store.update((s) => { s.checklist.items['a|d-coupon'] = { p: periodKey('daily', T0), t: T0, d: 1 }; }));
  assert.equal(undoNow().label, 'Ticked a row');
  const tickStamp = store.getState().stamps['checklist/items/a|d-coupon'];
  assert.ok(tickStamp >= T0);
  // Another device's change arrives (merged in like sync does) before Undo.
  clock = T0 + 2000;
  const other = structuredClone(store.getState());
  other.mesos.held = 123;
  other.stamps['mesos/held'] = T0 + 1000;
  other.updatedAt = T0 + 1000;
  store.replaceState(mergeStates(store.getState(), other), true);
  clock = T0 + 3000;
  const r = undoLast();
  assert.deepEqual(r, { undone: 1, skipped: 0 });
  const s = store.getState();
  assert.equal(s.checklist.items['a|d-coupon'], undefined);
  assert.equal(s.mesos.held, 123, 'the synced edit is kept');
  assert.equal(s.stamps['checklist/items/a|d-coupon'], T0 + 3000, 'the undo is stamped as a new edit');
  assert.ok(!units(s).has('checklist/items/a|d-coupon'));
  assert.equal(group.items.includes(item), true);
  assert.match(undoNow().label, /Ticked a row/);
  assert.equal(undoLast(), null, 'an undo cannot be undone twice');
});

test('Undo leaves a value alone when it changed again since, and says so', async (t) => {
  at(t, T0);
  start();
  const el = await show(ChecklistPage);
  const box = el.find((n) => n.attrs.id === 'cl-d-coupon');
  box.checked = true;
  box.fire('change', { currentTarget: box });
  await until(() => bar(el), 'the Undo bar');
  assert.equal(bar(el).attrs.role, 'status');
  assert.match(squash(bar(el).text), /^Ticked Pop a 3x EXP coupon, then start the grind Undo/);
  // The same row is changed again without the bar (another tab, say).
  store.update((s) => { s.checklist.items['a|d-coupon'] = { p: periodKey('daily', T0), t: T0, d: 0 }; });
  button(bar(el), /^Undo$/).fire('click');
  await until(() => /Not undone/.test(squash(bar(el).text)), 'the bar to say it could not undo');
  assert.equal(store.getState().checklist.items['a|d-coupon'].d, 0);
  assert.equal(button(bar(el), /^Undo$/), null);
  button(bar(el), /Close this message/).fire('click');
  await until(() => !bar(el), 'the bar to close');
  close(el);
});

// ---- All done -------------------------------------------------------------------------------------------------
test('"All done" ticks a group\'s open plain rows for the character on screen, once, and Undo takes them back', async (t) => {
  at(t, T0);
  start((s) => {
    // One row already ticked, one boss row, a counter and a chip row are left alone.
    s.checklist.items['a|d-cernium'] = { p: periodKey('daily', T0), t: T0, d: 1 };
    s.bosses = { a: { picks: { 'cygnus-normal': { party: 1 } }, clears: {} } };
  }, [MAIN, ALT]);
  const thu = DATA.checklist.groups.find((g) => g.key === 'thu');
  const who = whoOf(DATA, store.getState());
  const targets = bulkTargets(thu, thu.items, store.getState().checklist, T0, who).map((x) => x.item.id);
  for (const id of targets) {
    const item = thu.items.find((i) => i.id === id);
    assert.ok(!item.optional && item.type !== 'count' && item.type !== 'chips' && item.type !== 'link' && !item.boss, `${id} is a plain row`);
  }
  assert.ok(!targets.includes('w-crest') && !targets.includes('w-crystals') && !targets.includes('w-mayrin'));
  const el = await show(ChecklistPage);
  const before = structuredClone(store.getState().checklist.items);
  const all = el.findAll((n) => n.localName === 'button' && /^All done/.test(n.attrs['aria-label'] || ''));
  assert.ok(all.length >= 3, 'each group with open rows has one');
  const daily = button(el, /All done: tick the \d+ open rows of Daily$/);
  daily.fire('click');
  await until(() => bar(el), 'the Undo bar');
  const items = store.getState().checklist.items;
  const ticked = Object.keys(items).filter((k) => !before[k]);
  assert.ok(ticked.length >= 3);
  assert.ok(ticked.every((k) => k.startsWith('a|') && items[k].d === 1 && items[k].p === periodKey('daily', T0)), 'ticked for the character on screen, today');
  assert.ok(!ticked.includes('a|d-bosses'), 'the daily boss row is left to the boss ticks');
  assert.deepEqual(items['a|d-cernium'], before['a|d-cernium'], 'a row already ticked is not touched');
  assert.ok(!Object.keys(items).some((k) => k.startsWith('b|')), 'the alt is untouched');
  assert.match(squash(bar(el).text), /^Ticked \d+ rows: Daily Undo/);
  assert.equal(button(el, /All done: tick the \d+ open rows of Daily$/), null, 'nothing left to tick: the button goes');
  // An account-wide row is one tick for the account, and a new action replaces the bar.
  button(el, /open rows? of Daily, optional$/).fire('click');
  await until(() => /Daily, optional/.test(squash(bar(el).text)), 'the bar for the second press');
  assert.equal(el.findAll((n) => n.attrs.class === 'undo-bar').length, 1, 'one bar at a time');
  const after2 = store.getState().checklist.items;
  assert.equal(after2['d-claim'].d, 1, 'the account-wide row is ticked once, for the account');
  assert.equal(after2['a|d-claim'], undefined);
  assert.equal(after2['a|d-shadow'], undefined, 'a counter is not ticked');
  assert.equal(after2['a|d-gollux'], undefined, 'a boss row is not ticked');
  button(bar(el), /^Undo$/).fire('click');
  await until(() => /Undone/.test(squash(bar(el).text)), 'the second undo');
  assert.equal(store.getState().checklist.items['d-claim'], undefined);
  assert.equal(store.getState().checklist.items['a|d-coupon'].d, 1, 'only the last action is undone');
  close(el);
});

test('"All done" on Today ticks the core dailies; Undo restores exactly what was there', async (t) => {
  at(t, T0);
  start();
  const el = await show(TodayPage);
  const before = structuredClone(store.getState().checklist.items);
  button(el, /All done: tick the \d+ open rows of core dailies/).fire('click');
  await until(() => bar(el), 'the Undo bar');
  assert.match(squash(el.text), /Do today 4 \/ 4 dailies/);
  button(bar(el), /^Undo$/).fire('click');
  await until(() => /Undone: ticked 4 rows: core dailies\./.test(squash(bar(el).text)), 'the undo');
  assert.deepEqual(store.getState().checklist.items, before);
  assert.match(squash(el.text), /Do today 0 \/ 4 dailies/);
  close(el);
});

// ---- All cleared ------------------------------------------------------------------------------------------------
test('"All cleared" ticks each open weekly boss once, never a spare difficulty, and Undo takes them all back', async (t) => {
  at(t, T0);
  start((s) => {
    s.bosses = { a: { picks: { 'will-hard': { party: 1 }, 'lucid-hard': { party: 1 }, 'lucid-normal': { party: 1 }, 'zakum-chaos': { party: 1 }, 'cygnus-normal': { party: 1 } }, clears: {} } };
  });
  const lines = computeIncome(store.getState().characters, store.getState(), DATA.bosses, DATA.bossById, T0).perChar.a.lines;
  const ids = weeklyTargets(lines, { challenger: true, level: 264 }).map((l) => l.bossId).sort();
  assert.deepEqual(ids, ['lucid-hard', 'will-hard', 'zakum-chaos'], 'the spare Lucid pick is left out, the daily boss too');
  const el = await show(BossesPage);
  button(el, /All cleared: mark the 3 open weekly bosses/).fire('click');
  await until(() => bar(el), 'the Undo bar');
  const clears = store.getState().bosses.a.clears;
  const week = (id) => clearKey(DATA.bossById[id], T0);
  for (const id of ids) assert.equal(clears[id][week(id)], true, `${id} cleared`);
  assert.equal(clears['lucid-normal'], undefined);
  assert.equal(clears['cygnus-normal'], undefined);
  assert.match(squash(bar(el).text), /^Cleared 3 weekly bosses Undo/);
  button(bar(el), /^Undo$/).fire('click');
  await until(() => /Undone/.test(squash(bar(el).text)), 'the undo');
  assert.deepEqual(store.getState().bosses.a.clears, {});
  close(el);
});

test('"All cleared" leaves a boss cleared on another difficulty alone, and Today lists cleared bosses last', async (t) => {
  at(t, T0);
  start((s) => {
    s.bosses = { a: { picks: { 'will-hard': { party: 1 }, 'lucid-hard': { party: 1 }, 'zakum-chaos': { party: 1 } }, clears: {} } };
  });
  // Lucid was cleared on Normal this week (not picked): one clear for all difficulties.
  toggleClear('a', DATA.bossById['lucid-normal'], null, true);
  toggleClear('a', DATA.bossById['will-hard'], null, true);
  const el = await show(TodayPage);
  const order = el.findAll((n) => n.localName === 'input' && /^today-boss-/.test(n.attrs.id || '')).map((n) => n.attrs.id.slice(11));
  assert.deepEqual(order.slice(-2).sort(), ['lucid-hard', 'will-hard'], 'cleared bosses at the bottom');
  assert.equal(order[0], 'zakum-chaos');
  button(el, /All cleared: mark the 1 open weekly boss /).fire('click');
  await until(() => /Cleared 1 weekly boss/.test(squash(bar(el)?.text || '')), 'the bar');
  const clears = store.getState().bosses.a.clears;
  assert.equal(clears['lucid-hard'], undefined, 'the shared clear stays on Normal');
  assert.equal(Object.keys(clears['lucid-normal']).length, 1);
  assert.equal(button(el, /All cleared/), null, 'nothing open: the button goes');
  close(el);
});

// ---- Undo on the other actions ----------------------------------------------------------------------------------
test('"Got one", a removed drop and "Use this list" each get an Undo', async (t) => {
  at(t, T0);
  start((s) => { s.characters[0].cp = 2e9; });
  const el = await show(BossesPage);
  button(el, /^Got one: /).fire('click');
  await until(() => /^Logged /.test(squash(bar(el)?.text || '')), 'the bar after Got one');
  assert.equal(store.getState().pitch.a.drops.length, 1);
  button(bar(el), /^Undo$/).fire('click');
  await until(() => (store.getState().pitch.a?.drops || []).length === 0, 'the drop to go');
  const use = button(el, /^Use this list$/);
  assert.ok(use, 'a list is suggested');
  use.fire('click');
  await until(() => /Weekly boss list replaced/.test(squash(bar(el)?.text || '')), 'the bar after Use this list');
  assert.ok(Object.keys(store.getState().bosses.a.picks).length > 0);
  button(bar(el), /^Undo$/).fire('click');
  await until(() => Object.keys(store.getState().bosses.a?.picks || {}).length === 0, 'the picks to go back');
  close(el);
});

// ---- Shorter phone pages -----------------------------------------------------------------------------------------
test('Checklist: the streak is one line at the top and its calendar comes after the lists', async (t) => {
  at(t, T0);
  start((s) => { s.checklist.history = { '2026-11-25': { done: 5, total: 5 }, '2026-11-26': { done: 5, total: 5 } }; });
  const el = await show(ChecklistPage);
  const text = squash(el.text);
  assert.match(text, /Core dailies today \d+ \/ \d+ Streak 2 days · best 2 · calendar below/);
  const firstList = text.indexOf('Pop a 3x EXP coupon');
  const lastList = text.lastIndexOf('Erda');
  const cal = el.find((n) => n.attrs.class === 'heat' || /\bheat\b/.test(n.attrs.class || ''));
  assert.ok(cal, 'the calendar is still there');
  const all = el.findAll(() => true);
  const firstRow = el.find((n) => n.attrs.id === 'cl-d-coupon');
  assert.ok(all.indexOf(cal) > all.indexOf(firstRow), 'the calendar comes after the first daily');
  assert.ok(firstList > 0 && lastList > firstList);
  close(el);
});

test('Show notes: on wide screens notes show; on phones each sits behind an (i); the switch is this device\'s only', async (t) => {
  at(t, T0);
  start();
  const note = DATA.checklist.groups[0].items.find((i) => i.id === 'd-cernium').note;
  let el = await show(ChecklistPage);
  assert.ok(squash(el.text).includes(squash(note)), 'wide: the note shows');
  assert.equal(el.find((n) => n.attrs.class === 'note-i'), null);
  close(el);
  setNarrow(true);
  el = await show(ChecklistPage);
  assert.ok(!squash(el.text).includes(squash(note)), 'phone: the note is folded');
  const i = button(el, /Show the note: Cernium daily/);
  assert.equal(i.attrs['aria-expanded'], 'false');
  i.fire('click');
  await until(() => squash(el.text).includes(squash(note)), 'the note to open');
  assert.equal(button(el, /Hide the note: Cernium daily/).attrs['aria-expanded'], 'true');
  // Today's "Do today" rows hide notes with CSS, as before (styles.css: .todo .row > .note, .note-i).
  const css = readFileSync(new URL('../../site/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.todo \.row > \.note \{ display: none; \}/);
  assert.match(css, /\.todo \.row > \.note-i \{ display: none; \}/);
  const sw = el.find((n) => n.attrs.id === 'show-notes');
  assert.equal(Boolean(sw.checked ?? sw.attrs.checked), false);
  sw.checked = true;
  sw.fire('change', { currentTarget: sw });
  await until(() => store.getState().ui.showNotes === true, 'the switch to save');
  await until(() => el.findAll((n) => n.attrs.class === 'note-i').length === 0, 'every note to show');
  // Not synced: no stamp, no unit, and a merge keeps each device's own choice.
  const s = store.getState();
  assert.ok(![...units(s).keys()].some((k) => k.includes('showNotes')));
  assert.ok(!Object.keys(s.stamps).some((k) => k.includes('showNotes')));
  const other = structuredClone(s);
  other.ui.showNotes = false;
  other.updatedAt = s.updatedAt + 10;
  assert.equal(mergeStates(s, other).ui.showNotes, true);
  close(el);
  assert.equal(notesShown({ showNotes: null }, true), false);
  assert.equal(notesShown({ showNotes: null }, false), true);
  assert.equal(notesShown({ showNotes: true }, true), true);
});

test('Show notes: a bad saved value is cleaned to "not chosen", and old copies load without it', (t) => {
  at(t, T0);
  for (const bad of ['yes', 1, {}, null]) {
    const raw = { ...store.blankState(), ui: { ...store.blankState().ui, showNotes: bad } };
    store.replaceState(raw, true);
    assert.equal(store.getState().ui.showNotes, null, String(bad));
  }
  const old = store.blankState();
  delete old.ui.showNotes;
  store.replaceState(old, true);
  assert.equal(store.getState().ui.showNotes, null);
  store.replaceState({ ...store.blankState(), ui: { ...store.blankState().ui, showNotes: false } }, true);
  assert.equal(store.getState().ui.showNotes, false);
});

test('Season card: one line until 14 days before its first deadline, whole after, and one press opens it', async (t) => {
  const season = DATA.season;
  const o0 = seasonOutlook(season, {}, Date.parse(season.ends) - 60 * DAY);
  const first = o0.groups[0].at;
  at(t, first - 20 * DAY);
  start();
  assert.ok(seasonFold(seasonOutlook(season, {}, first - 20 * DAY), first - 20 * DAY));
  assert.equal(seasonFold(seasonOutlook(season, {}, first - 13 * DAY), first - 13 * DAY), null);
  let el = await show(TodayPage);
  let text = squash(el.text);
  assert.match(text, new RegExp(`${season.name}: \\d+ days left\\. Next deadline .+? \\(.+? left, \\d+ steps? open\\)\\.(?: Expiring soon: .+?\\.)? Show all ${season.actions.length} steps`));
  assert.doesNotMatch(text, /end-of-season steps still open/);
  button(el, /^Show all \d+ steps$/).fire('click');
  await until(() => /end-of-season steps still open/.test(squash(el.text)), 'the whole card');
  close(el);
  clock = first - 10 * DAY;
  el = await show(TodayPage);
  text = squash(el.text);
  assert.match(text, /end-of-season steps still open/);
  close(el);
  // A non-Challenger character sees neither.
  store.update((s) => { s.characters[0].challenger = false; });
  el = await show(TodayPage);
  assert.doesNotMatch(squash(el.text), /Season 4/);
  close(el);
});

test('clearedLast keeps each part in order', () => {
  const l = [{ id: 1, clearedNow: true }, { id: 2 }, { id: 3, doneAs: 'Normal' }, { id: 4 }];
  assert.deepEqual(clearedLast(l).map((x) => x.id), [2, 4, 1, 3]);
});

test('pages read sensibly for the Lv. 264 Challenger main, a Lv. 210 alt and a new player', async (t) => {
  at(t, T0);
  start((s) => { s.bosses = { a: { picks: { 'will-hard': { party: 1 } }, clears: {} }, b: { picks: { 'zakum-chaos': { party: 1 } }, clears: {} } }; }, [MAIN, ALT]);
  for (const id of ['a', 'b']) {
    store.update((s) => { s.activeId = id; });
    for (const Page of [TodayPage, ChecklistPage, BossesPage]) {
      const el = await show(Page);
      const text = squash(el.text);
      assert.doesNotMatch(text, /undefined|NaN|\[object|null/, `${Page.name} for ${id}`);
      close(el);
    }
  }
  store.resetState();
  for (const Page of [TodayPage, ChecklistPage]) {
    const el = await show(Page);
    const text = squash(el.text);
    assert.doesNotMatch(text, /undefined|NaN|\[object|null/);
    assert.ok(!button(el, /All cleared/));
    close(el);
  }
});
