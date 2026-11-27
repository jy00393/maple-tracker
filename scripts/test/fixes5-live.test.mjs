// Fifth round, "live" share: the page must stay right while it is left open. Resets, countdowns, ages, the
// Nexon files and Sync are all driven here by a clock the test moves; nothing waits on real time, and nothing
// talks to GitHub or Nexon (fetch is a stand-in and the "token" is a made-up word).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeNode, installFakeBrowser } from './lib/fake-dom.mjs';

const siteFile = (name) => fileURLToPath(new URL(`../../site/${name}`, import.meta.url));
const mem = installFakeBrowser();

// ---- A browser whose events the test can deliver --------------------------------------------------------------
const handlers = {};
const listenOn = (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); };
const listenOff = (type, fn) => { handlers[type] = (handlers[type] || []).filter((f) => f !== fn); };
globalThis.window.addEventListener = listenOn;
globalThis.window.removeEventListener = listenOff;
globalThis.window.scrollTo = () => {};
globalThis.document.addEventListener = listenOn;
globalThis.document.removeEventListener = listenOff;
const fireEvent = (type) => { for (const fn of [...(handlers[type] || [])]) fn({ type }); };
const nav = { onLine: true };
Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });

// ---- A clock the test moves -----------------------------------------------------------------------------------
// Date.now and every timer with a delay belong to the test. Timers without a delay (Preact's own housekeeping)
// run on the real event loop, at once. Effects are flushed through requestAnimationFrame, also at once.
const real = { setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate, now: Date.now };
const clock = { t: Date.parse('2026-11-26T03:00:00Z'), timers: new Map(), seq: 0 };
Date.now = () => clock.t;
const addTimer = (fn, ms, every, args) => {
  const id = { fake: ++clock.seq, unref() {} };
  clock.timers.set(id, { id, seq: id.fake, at: clock.t + Math.max(1, Math.ceil(ms)), every, fn, args });
  return id;
};
globalThis.setTimeout = (fn, ms, ...args) => (ms > 0 ? addTimer(fn, ms, 0, args) : real.setImmediate(fn, ...args));
globalThis.setInterval = (fn, ms, ...args) => addTimer(fn, ms, Math.max(1, ms), args);
globalThis.clearTimeout = (id) => { if (id && id.fake) clock.timers.delete(id); else if (id) real.clearImmediate(id); };
globalThis.clearInterval = globalThis.clearTimeout;
globalThis.requestAnimationFrame = (fn) => real.setImmediate(fn);
globalThis.cancelAnimationFrame = (id) => real.clearImmediate(id);
after(() => {
  Object.assign(globalThis, { setTimeout: real.setTimeout, clearTimeout: real.clearTimeout, setInterval: real.setInterval, clearInterval: real.clearInterval });
  Date.now = real.now;
});

// Lets everything that is already due on the event loop run: redraws, effects, promise chains. Counted in
// turns of the loop, not in time.
const turn = () => new Promise((r) => real.setImmediate(r));
async function settle(turns = 12) { for (let i = 0; i < turns; i++) await turn(); }
// Waits for something to become true; fails with a message instead of hanging.
async function until(check, what) {
  for (let i = 0; i < 5000; i++) { if (check()) return; await turn(); }
  assert.fail(`never happened: ${what}`);
}
const nextTimer = (target) => {
  let next = null;
  for (const tm of clock.timers.values()) if (tm.at <= target && (!next || tm.at < next.at || (tm.at === next.at && tm.seq < next.seq))) next = tm;
  return next;
};
// Moves the clock to `target`, firing every timer on the way at its own time, in order.
async function advanceTo(target) {
  for (let tm = nextTimer(target); tm; tm = nextTimer(target)) {
    clock.t = Math.max(clock.t, tm.at);
    if (tm.every) tm.at += tm.every; else clock.timers.delete(tm.id);
    tm.fn(...tm.args);
    await settle(4);
  }
  clock.t = Math.max(clock.t, target);
  await settle();
}
const advance = (ms) => advanceTo(clock.t + ms);
// A device that slept: the clock jumps, and each timer that came due fires once, late, as a browser does.
async function sleepTo(target) {
  clock.t = target;
  const due = [...clock.timers.values()].filter((tm) => tm.at <= target).sort((a, b) => a.at - b.at || a.seq - b.seq);
  for (const tm of due) {
    if (!clock.timers.has(tm.id)) continue;
    if (tm.every) tm.at = target + tm.every; else clock.timers.delete(tm.id);
    tm.fn(...tm.args);
    await settle(4);
  }
  await settle();
}
const at = (iso) => { clearScreen(); clock.t = Date.parse(iso); return clock.t; };
const SEC = 1000;
const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;

const { html, render } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const merge = await import('../../site/app/calc/merge.js');
const sync = await import('../../site/app/sync.js');
const ui = await import('../../site/app/ui.js');
const time = await import('../../site/app/time.js');
const dataJs = await import('../../site/app/data.js');
const { appStatus, nexonAge } = await import('../../site/app/calc/status.js');
const { TodayPage } = await import('../../site/app/pages/today.js');
const { ChecklistPage } = await import('../../site/app/pages/checklist.js');
const { BossesPage } = await import('../../site/app/pages/bosses.js');
const { EventsPage } = await import('../../site/app/pages/events.js');
const { ProgressPage } = await import('../../site/app/pages/progress.js');
const { GearPage } = await import('../../site/app/pages/gear.js');
const { SettingsPage } = await import('../../site/app/pages/settings.js');

// ---- Data and saved state -------------------------------------------------------------------------------------
const load = (name) => JSON.parse(readFileSync(siteFile(`data/${name}.json`), 'utf8'));
function loadData(overrides = {}) {
  const data = {
    bosses: load('bosses'), symbols: load('symbols'), liberation: load('liberation'), ibp: load('ibp'), checklist: load('checklist'),
    gear: load('gear'), erda: load('erda'), upgrades: load('upgrades'), potential: load('potential'), gearStats: load('gearstats'),
    events: { events: [], sunny: [] }, news: { items: [] }, nexonCharacters: { characters: [] }, meta: null, tables: load('tables'), season: load('season'),
    pitched: load('pitched'), shops: { source: 'test', shops: [] }, flames: load('flames'), champions: load('champions'), expSources: load('expsources'),
    upcoming: { items: [] }, bossCp: load('bosscp'), classes: load('classes'),
    ...overrides
  };
  data.bossById = Object.fromEntries(data.bosses.bosses.map((b) => [b.id, b]));
  return data;
}
const event = (id, title, start, end) => ({ id, title, start: new Date(start).toISOString(), end: new Date(end).toISOString(), startApprox: false, endApprox: false, afterMaintenance: false, resets: [], postId: 1, postName: 'Test post', liveDate: new Date(start).toISOString(), category: 'event', isClassic: false, url: 'https://example.test/post' });
const metaAt = (t) => ({ ok: true, checkedAt: new Date(t).toISOString(), errors: [] });

// A Lv. 264 Challenger main and a Lv. 210 alt, with a few days of entries behind them.
function saved(now) {
  const d = (off) => new Date(now - off * DAY).toISOString().slice(0, 10);
  return {
    v: 1,
    characters: [
      { id: 'main', name: 'Main', cls: 'Erel Light', level: 264, region: 'na', world: 'heroic', challenger: true, mainStat: 'STR', beyondBurning: true },
      { id: 'alt', name: 'Alt', cls: 'Hero', level: 210, region: 'na', world: 'heroic', challenger: false, mainStat: 'STR' }
    ],
    activeId: 'main',
    checklist: { items: {}, resets: {}, flags: {}, history: {}, owner: 'main', ownerSet: true },
    bosses: { main: { picks: { 'zakum-normal': { party: 1 }, 'lucid-hard': { party: 1 } }, clears: {} } },
    liberation: { main: { genesis: { stage: 2, traces: 300, picks: { 'lotus-hard': true, 'damien-hard': true }, pass: true } } },
    gear: { main: { preset: 'mid', history: [{ d: d(9), pct: 0.2 }, { d: d(0), pct: 0.35 }], slots: { hat: { tier: 2, ilvl: 150, stars: 17, pot: 4 } } } },
    level: { main: { log: [{ t: now - 6 * DAY, level: 263, pct: 40 }, { t: now - HOUR, level: 264, pct: 12.5 }] } },
    ui: { eventsView: 'live', progressView: 'level' },
    updatedAt: now - 1000
  };
}
function startWith(now, mutate) {
  store.resetState();
  store.replaceState(saved(now));
  if (mutate) store.update(mutate);
}

const mounted = new Set();
after(() => { for (const el of mounted) render(null, el); sync.disconnect(); });
async function mount(vnode) {
  const el = new FakeNode('div');
  mounted.add(el);
  render(vnode, el);
  await settle();
  return el;
}
const show = (Page, data) => {
  const App = () => html`<${Page} data=${data} state=${store.useStore()} />`;
  return mount(html`<${App} />`);
};
const unmount = (el) => { render(null, el); mounted.delete(el); };
// Each test starts with nothing on screen, whatever an earlier one left behind.
function clearScreen() { for (const el of [...mounted]) unmount(el); }
const squash = (text) => text.replace(/\s+/g, ' ').trim();
const textOf = (el) => squash(el.text);
const box = (el, id) => el.find((n) => n.localName === 'input' && n.attrs.id === id);
const ticked = (node) => node.checked === true || node.attrs.checked === 'true' || node.attrs.checked === '';
async function setBox(node, on) {
  node.fire('change', { currentTarget: { checked: on } });
  await settle();
}
const NEVER = /\bin now\b|now left|starts in now|\bin\s+\(|reset has passed/;

// ---- 5, 26, 42: resets ----------------------------------------------------------------------------------------
test('5 42: Checklist clears yesterday\'s ticks at the reset second, and a tick made right after a reset shows at once', async () => {
  const reset = Date.parse('2026-11-28T00:00:00Z');
  at('2026-11-27T23:59:40Z');
  startWith(clock.t);
  const el = await show(ChecklistPage, loadData());
  await setBox(box(el, 'cl-d-coupon'), true);
  await setBox(box(el, 'cl-d-ursus'), true);
  assert.match(textOf(el), /Core dailies today 2 \/ \d+/);
  assert.ok(ticked(box(el, 'cl-d-coupon')) && ticked(box(el, 'cl-d-ursus')));
  await advanceTo(reset - 1);
  assert.match(textOf(el), /Core dailies today 2 \/ \d+/, 'still yesterday one millisecond before the reset');
  await advanceTo(reset);
  assert.match(textOf(el), /Core dailies today 0 \/ \d+/, 'cleared at the reset itself, not at the next 15 s redraw');
  assert.ok(!ticked(box(el, 'cl-d-coupon')) && !ticked(box(el, 'cl-d-ursus')));
  unmount(el);

  // The device slept across the reset and no timer has fired yet: the first tick still shows, on today's list.
  at('2026-11-28T23:50:00Z');
  startWith(clock.t);
  const el2 = await show(ChecklistPage, loadData());
  await setBox(box(el2, 'cl-d-coupon'), true);
  await setBox(box(el2, 'cl-d-ursus'), true);
  clock.t = Date.parse('2026-11-29T00:20:00Z');
  // A third core daily (Training Cards became optional: cards only come with Defense Mission claims).
  await setBox(box(el2, 'cl-d-sauna'), true);
  assert.ok(ticked(box(el2, 'cl-d-sauna')), 'the new tick is shown');
  assert.ok(!ticked(box(el2, 'cl-d-coupon')) && !ticked(box(el2, 'cl-d-ursus')), 'yesterday\'s ticks are gone');
  assert.match(textOf(el2), /Core dailies today 1 \/ \d+/);
  assert.equal(store.getState().checklist.items['main|d-sauna'].p, 'daily:2026-11-29');
  unmount(el2);

  // A tab brought back to the front redraws at once, before any timer.
  at('2026-11-29T23:50:00Z');
  startWith(clock.t);
  const el3 = await show(ChecklistPage, loadData());
  await setBox(box(el3, 'cl-d-coupon'), true);
  assert.match(textOf(el3), /Core dailies today 1 \/ \d+/);
  clock.t = Date.parse('2026-11-30T00:20:00Z');
  fireEvent('visibilitychange');
  await settle();
  assert.match(textOf(el3), /Core dailies today 0 \/ \d+/);
  unmount(el3);
});

test('3 5 26: Today never reads "in now"; the warning, the ticks and the next-ending event move on at their moment', async () => {
  // Wednesday night into the Thursday reset: a daily reset and the weekly boss reset together.
  const reset = Date.parse('2026-12-03T00:00:00Z');
  at('2026-12-02T23:59:40Z');
  startWith(clock.t);
  const ends = reset - 4 * SEC;
  const data = loadData({ events: { events: [event('a', 'Event A', reset - 5 * DAY, ends), event('b', 'Event B', reset - 5 * DAY, reset + 2 * DAY)], sunny: [] } });
  const el = await show(TodayPage, data);
  await setBox(box(el, 'cl-d-coupon'), true);
  await setBox(box(el, 'today-boss-lucid-hard'), true);
  let text = textOf(el);
  assert.match(text, /Daily reset in 0m 20s/);
  assert.match(text, /Thursday reset in 0m 20s/);
  assert.match(text, /Core dailies 1 \/ \d+/);
  assert.match(text, /Events ending this week 2 next: Event A in 0m 16s/);
  assert.ok(ticked(box(el, 'today-boss-lucid-hard')));
  // Second by second across both moments.
  for (let t = clock.t + SEC; t <= reset + 3 * SEC; t += SEC) {
    await advanceTo(t);
    text = textOf(el);
    const when = new Date(t).toISOString();
    assert.doesNotMatch(text, NEVER, when);
    if (t < ends) assert.match(text, new RegExp(`next: Event A in 0m ${String((ends - t) / SEC).padStart(2, '0')}s`), when);
    else assert.match(text, /Events ending this week 1 next: Event B in (2d 0h|1d 23h)/, `${when}: the tile moved on to the next event`);
    if (t < reset) {
      assert.match(text, new RegExp(`Daily reset in 0m ${String((reset - t) / SEC).padStart(2, '0')}s`), when);
      assert.match(text, /Core dailies 1 \/ \d+/, when);
    } else {
      assert.doesNotMatch(text, /Daily reset|Thursday reset/, `${when}: the warnings left with the reset`);
      assert.match(text, /Core dailies 0 \/ \d+/, `${when}: yesterday's ticks cleared with the reset`);
      assert.ok(!ticked(box(el, 'cl-d-coupon')) && !ticked(box(el, 'today-boss-lucid-hard')), when);
    }
  }
  unmount(el);
});

test('5: Bosses clears a daily boss tick at the reset second', async () => {
  const reset = Date.parse('2026-12-05T00:00:00Z');
  at('2026-12-04T23:59:47Z');
  startWith(clock.t);
  const el = await show(BossesPage, loadData());
  await setBox(box(el, 'clear-zakum-normal'), true);
  await setBox(box(el, 'clear-lucid-hard'), true);
  await advanceTo(reset - 1);
  assert.ok(ticked(box(el, 'clear-zakum-normal')));
  await advanceTo(reset);
  assert.ok(!ticked(box(el, 'clear-zakum-normal')), 'the daily boss is open again at the reset');
  assert.ok(ticked(box(el, 'clear-lucid-hard')), 'the weekly boss stays ticked (Friday into Saturday)');
  unmount(el);
});

test('3: a countdown ticks when its text changes, ends on its done text or disappears, and wakes the pages', async () => {
  const t0 = at('2026-11-26T03:00:00.250Z');
  let draws = 0;
  let seen = 0;
  const Page = () => { seen = ui.useClock(); draws++; return null; };
  const el = await mount(html`<div><${Page} /><p id="a"><${ui.Left} until=${t0 + 2500} before="in " /></p><p id="b"><${ui.Left} until=${t0 + 2500} after=" left" done="ended" /></p><p id="c"><${ui.Left} until=${t0 + 2 * HOUR} /></p><p id="d"><${ui.Left} until=${t0 - 5} before="in " /></p></div>`);
  const p = (id) => squash(el.find((n) => n.attrs.id === id).text);
  assert.deepEqual([p('a'), p('b'), p('c'), p('d')], ['in 0m 02s', '0m 02s left', '2h 00m', '']);
  await advanceTo(t0 + 500);
  assert.equal(p('a'), 'in 0m 02s');
  await advanceTo(t0 + 501);
  assert.deepEqual([p('a'), p('b'), p('c')], ['in 0m 01s', '0m 01s left', '1h 59m'], 'each changes at its own moment');
  await advanceTo(t0 + 2499);
  assert.deepEqual([p('a'), p('b')], ['in 0m 00s', '0m 00s left']);
  const before = draws;
  await advanceTo(t0 + 2500);
  assert.deepEqual([p('a'), p('b')], ['', 'ended'], 'never "in now" or "now left"');
  assert.ok(draws > before, 'the page was redrawn when the countdown ended');
  assert.ok(seen >= t0 + 2500, 'with the time of the ending');
  unmount(el);
  assert.equal(time.fmtLeftCoarse(29 * MIN + 15 * SEC), '30 min');
  assert.equal(time.fmtLeftCoarse(20 * SEC), '1 min');
  assert.equal(time.fmtLeftCoarse(HOUR + MIN), '1h 01m');
  assert.equal(time.fmtLeftCoarse(0), 'now');
});

test('5: the page clock redraws on the round interval, at the reset, and never leaves a timer behind', async () => {
  at('2026-11-26T23:59:10.400Z');
  const times = [];
  const Page = () => { times.push(ui.useClock({ every: 30000 })); return null; };
  const el = await mount(html`<${Page} />`);
  const reset = Date.parse('2026-11-27T00:00:00Z');
  await advanceTo(reset + 30 * SEC);
  assert.deepEqual(times.slice(1), [reset - 30 * SEC, reset, reset + 30 * SEC], 'on the round half minutes, the reset among them');
  // An odd interval still gets the reset.
  unmount(el);
  at('2026-11-27T23:59:00Z');
  const odd = [];
  const Odd = () => { odd.push(ui.useClock({ every: 7 * HOUR })); return null; };
  const el2 = await mount(html`<${Odd} />`);
  await advanceTo(Date.parse('2026-11-28T00:00:00Z'));
  assert.equal(odd[odd.length - 1], Date.parse('2026-11-28T00:00:00Z'));
  const live = clock.timers.size;
  unmount(el2);
  await settle();
  assert.equal(clock.timers.size, live - 1, 'its timer is gone with it');
});

// ---- 4, 25: an age that shows seconds ticks every second -------------------------------------------------------
test('4 25: "Nexon data checked 9m 50s ago" counts up every second', async () => {
  const t0 = at('2026-11-24T16:40:00Z');
  startWith(t0);
  const el = await show(EventsPage, loadData({ meta: metaAt(t0 - 9 * MIN - 50 * SEC) }));
  assert.match(textOf(el), /Nexon data checked 9m 50s ago/);
  for (let s = 1; s <= 12; s++) {
    await advance(SEC);
    const secs = 50 + s;
    assert.match(textOf(el), new RegExp(`Nexon data checked ${9 + Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s ago`), `after ${s} s`);
  }
  unmount(el);
  // Past an hour it shows minutes and moves with them.
  const t1 = at('2026-11-24T18:00:00Z');
  const el2 = await show(EventsPage, loadData({ meta: metaAt(t1 - HOUR - 4 * MIN - 30 * SEC) }));
  assert.match(textOf(el2), /Nexon data checked 1h 04m ago/);
  await advance(30 * SEC);
  assert.match(textOf(el2), /Nexon data checked 1h 05m ago/);
  unmount(el2);
  // A bar's tooltip cannot tick, so it carries no seconds.
  const t2 = at('2026-11-25T10:00:00Z');
  startWith(t2, (s) => { s.ui.eventsView = 'timeline'; });
  const el3 = await show(EventsPage, loadData({ events: { events: [event('x', 'Short one', t2 - DAY, t2 + 20 * MIN + 30 * SEC)], sunny: [] } }));
  const tips = el3.findAll((n) => typeof n.attrs.title === 'string' && /^Short one\n/.test(n.attrs.title)).map((n) => n.attrs.title);
  assert.ok(tips.length > 0);
  for (const tip of tips) { assert.match(tip, /21 min left/); assert.doesNotMatch(tip, /\d\ds left/); }
  unmount(el3);
});

// ---- 2, 44: pages that had no clock ----------------------------------------------------------------------------
test('2 44: Progress, Gear and Settings left open for days read the same as a freshly opened page', async () => {
  const t0 = Date.parse('2026-11-26T03:00:00Z');
  const data = loadData({ meta: metaAt(t0 - 34 * HOUR) });
  const cases = [
    ['Progress > Level', ProgressPage, (s) => { s.ui.progressView = 'level'; }, /\d+ days/],
    ['Progress > Liberation', ProgressPage, (s) => { s.ui.progressView = 'liberation'; }, /around \d+ \w+ \d{4}/],
    ['Gear', GearPage, null, /pts\/wk/],
    ['Settings', SettingsPage, null, /Events and news are 34 hours old/]
  ];
  for (const [name, Page, mutate, expects] of cases) {
    at('2026-11-26T03:00:00Z');
    startWith(t0, mutate);
    const open = await show(Page, data);
    const first = textOf(open);
    assert.match(first, expects, `${name}: the fixture shows something that depends on the day`);
    for (const days of [1, 4]) {
      await sleepTo(t0 + days * DAY + 5 * MIN);
      const fresh = await show(Page, data);
      assert.equal(textOf(open), textOf(fresh), `${name}: open for ${days} day(s) reads like a fresh page`);
      unmount(fresh);
    }
    assert.notEqual(textOf(open), first, `${name}: and it did move`);
    unmount(open);
  }
});

// ---- 0, 39: the Nexon files are read again while the page stays open -------------------------------------------
// A stand-in for the site's data folder: `files` is what the server holds now.
function server(files) {
  const calls = [];
  const state = { files, down: false, bad: null };
  globalThis.fetch = async (url) => {
    const name = String(url).split('data/')[1];
    calls.push(name);
    if (state.down) throw new TypeError('Failed to fetch');
    if (name === state.bad || !(name in state.files)) return { ok: false, status: 503, json: async () => ({}) };
    const body = JSON.stringify(state.files[name]);
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  };
  return { calls, state };
}
const jobFiles = (t, events) => ({ 'meta.json': metaAt(t), 'events.json': { events, sunny: [] }, 'news.json': { items: [] }, 'characters.json': { characters: [] }, 'shops.json': { source: 'test', shops: [] } });

test('0 39: refreshData swaps the job\'s files only when meta.checkedAt changed, and keeps the old data on any failure', async () => {
  const t0 = at('2026-11-26T03:00:00Z');
  const old = [event('a', 'Old Event A', t0 - DAY, t0 + DAY)];
  const data = loadData({ meta: metaAt(t0 - HOUR), events: { events: old, sunny: [] }, refresh: { failed: false, at: t0 } });
  const web = server(jobFiles(t0 - HOUR, old));
  at('2026-11-26T04:00:00Z');
  let next = await dataJs.refreshData(data);
  assert.deepEqual(web.calls, ['meta.json'], 'the same checkedAt: only meta.json is asked for');
  assert.equal(next.events, data.events);
  assert.deepEqual(next.refresh, { failed: false, at: clock.t });

  web.state.files = jobFiles(t0 + 5 * HOUR, [...old, event('b', 'Brand New Event B', t0, t0 + 3 * DAY), event('b2', 'Brand New Event B', t0, t0 + 3 * DAY)]);
  web.calls.length = 0;
  next = await dataJs.refreshData(data);
  assert.deepEqual([...web.calls].sort(), ['characters.json', 'events.json', 'meta.json', 'news.json', 'shops.json']);
  assert.equal(next.meta.checkedAt, new Date(t0 + 5 * HOUR).toISOString());
  assert.ok(next.events.events.some((e) => e.title === 'Brand New Event B'));
  assert.equal(next.bosses, data.bosses, 'the game tables are untouched');
  assert.deepEqual(Object.keys(next.bossById), Object.keys(data.bossById));
  assert.equal(next.refresh.failed, false);
  assert.equal(data.events.events.length, 1, 'the object on screen is never changed in place');

  // One file fails: nothing is swapped, not even the ones that arrived.
  for (const bad of ['shops.json', 'events.json', 'meta.json']) {
    web.state.bad = bad;
    next = await dataJs.refreshData(data);
    assert.equal(next.events, data.events, bad);
    assert.equal(next.meta, data.meta, bad);
    assert.equal(next.refresh.failed, true, bad);
  }
  web.state.bad = null;
  web.state.down = true;
  next = await dataJs.refreshData(data);
  assert.equal(next.meta, data.meta);
  assert.equal(next.refresh.failed, true);
  web.state.down = false;
  web.calls.length = 0;
  next = await dataJs.refreshData(data, '', false);
  assert.equal(web.calls.length, 0, 'offline: nothing is asked for');
  assert.equal(next.refresh.failed, true);
  // A meta.json that is not the job's (a sign-in page turned into JSON, an empty object) is a failure too.
  web.state.files = { ...jobFiles(t0 + 6 * HOUR, old), 'meta.json': {} };
  next = await dataJs.refreshData(data);
  assert.equal(next.meta, data.meta);
  assert.equal(next.refresh.failed, true);
});

test('0 39: an open page re-reads on return and about hourly, never within 15 minutes, never while hidden', async () => {
  const t0 = at('2026-11-26T03:00:00Z');
  const web = server(jobFiles(t0 - HOUR, []));
  let data = loadData({ meta: metaAt(t0 - HOUR), refresh: { failed: false, at: t0 } });
  const doc = { visibilityState: 'visible', on: [], addEventListener(type, fn) { this.on.push(fn); }, removeEventListener(type, fn) { this.on = this.on.filter((f) => f !== fn); } };
  const win = { on: [], addEventListener(type, fn) { this.on.push(fn); }, removeEventListener(type, fn) { this.on = this.on.filter((f) => f !== fn); } };
  const net = { onLine: true };
  let sets = 0;
  const stop = dataJs.watchData({ get: () => data, set: (d) => { data = d; sets++; }, doc, win, nav: net });
  const asked = () => web.calls.filter((n) => n === 'meta.json').length;
  const back = async () => { for (const fn of doc.on) fn(); await settle(); };

  await advance(59 * MIN);
  assert.equal(asked(), 0, 'nothing in the first hour');
  await advance(2 * MIN);
  assert.equal(asked(), 1, 'about hourly while on screen');
  await back();
  assert.equal(asked(), 1, 'coming back within 15 minutes asks nothing');
  await advance(16 * MIN);
  await back();
  assert.equal(asked(), 2, 'coming back after 15 minutes re-reads at once');

  doc.visibilityState = 'hidden';
  await back();
  await advance(5 * HOUR);
  assert.equal(asked(), 2, 'nothing while hidden');
  doc.visibilityState = 'visible';
  web.state.files = jobFiles(clock.t - 10 * MIN, [event('n', 'Posted Meanwhile', clock.t - HOUR, clock.t + DAY)]);
  await back();
  assert.equal(asked(), 3);
  assert.ok(data.events.events.some((e) => e.title === 'Posted Meanwhile'), 'what Nexon posted meanwhile is on screen');

  // No connection: the old data stays and the failure is recorded; the connection coming back retries.
  net.onLine = false;
  await advance(61 * MIN);
  assert.equal(asked(), 3);
  assert.equal(data.refresh.failed, true);
  assert.ok(data.events.events.some((e) => e.title === 'Posted Meanwhile'));
  // Back online: the failed read is tried again within a minute, without waiting for the hour.
  net.onLine = true;
  await advance(2 * MIN);
  assert.equal(asked(), 4);
  assert.equal(data.refresh.failed, false);
  // The "online" event asks again only once the usual 15 minutes have passed.
  for (const fn of win.on) fn();
  await settle();
  assert.equal(asked(), 4);
  await advance(18 * MIN);
  for (const fn of win.on) fn();
  await settle();
  assert.equal(asked(), 5);

  const before = [asked(), sets];
  stop();
  await advance(3 * HOUR);
  await back();
  assert.deepEqual([asked(), sets], before, 'stopped means stopped');
  assert.equal(doc.on.length + win.on.length, 0);
});

test('0 39: "the job may have stopped" only when it really stopped; a failed re-read says so instead', async () => {
  const now = at('2026-11-28T03:00:00Z');
  const base = { syncOn: false, sync: { state: 'off' }, news: [], tablesChecked: '2026-11-23T00:00:00Z', now };
  const oldMeta = metaAt(now - 31 * HOUR);
  const nexon = (refresh, meta = oldMeta) => appStatus({ ...base, meta, refresh }).parts.find((p) => p.key === 'nexon');
  // Just re-read and still old: the job.
  assert.match(nexon({ failed: false, at: now - MIN }).text, /31 hours old\. The 6-hour refresh job may have stopped/);
  assert.equal(appStatus({ ...base, meta: oldMeta, refresh: { failed: false, at: now - MIN } }).label, 'Nexon data old');
  // The re-read failed: not the job's fault, as far as this page can tell.
  const failed = nexon({ failed: true, at: now - MIN });
  assert.match(failed.text, /31 hours old\. This page could not load a newer copy/);
  assert.doesNotMatch(failed.text, /job/);
  assert.equal(failed.level, 'warn');
  // Not re-read for a while (the device slept): a check is on its way, no alarm yet.
  const waking = nexon({ failed: false, at: now - 9 * HOUR });
  assert.equal(waking.level, 'busy');
  assert.doesNotMatch(waking.text, /job/);
  // Fresh data is fresh whatever the last re-read did; without re-read information the old rule stands.
  assert.equal(nexon({ failed: true, at: now }, metaAt(now - 2 * HOUR)).level, 'ok');
  assert.match(nexon(undefined).text, /job may have stopped/);
  assert.deepEqual(nexonAge(null, now, undefined), { kind: 'none', hours: 0 });

  // The same answers on Events.
  startWith(now);
  for (const [refresh, expected, never] of [
    [{ failed: false, at: now - MIN }, /checked 1d 7h ago .* The scheduled job may have stopped/, /could not load/],
    [{ failed: true, at: now - MIN }, /checked 1d 7h ago .* This page could not load a newer copy just now/, /job may have stopped/],
    [{ failed: false, at: now - 9 * HOUR }, /Looking for a newer copy/, /job may have stopped/]
  ]) {
    const el = await show(EventsPage, loadData({ meta: oldMeta, refresh }));
    assert.match(textOf(el), expected);
    assert.doesNotMatch(textOf(el), never);
    unmount(el);
  }
});

// ---- 1: Sync also checks the gist on a timer -------------------------------------------------------------------
const SYNC = 'maple-tracker:sync';
const TOKEN = 'made-up-token-for-tests';
const FILE = 'maple-tracker.json';
// A stand-in for GitHub's gist API. `gist.text` is the synced copy; `gist.answer` can replace the reply to a read.
function github() {
  const gist = { text: '{}', answer: null, gets: 0, patches: 0, urls: [], auth: new Set() };
  const reply = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => (k.toLowerCase() in headers ? headers[k.toLowerCase()] : null) }, json: async () => JSON.parse(body), text: async () => body });
  gist.reply = reply;
  globalThis.fetch = async (url, opts = {}) => {
    gist.urls.push(String(url));
    gist.auth.add(opts.headers && opts.headers.Authorization);
    if ((opts.method || 'GET') === 'PATCH') { gist.patches++; gist.text = JSON.parse(opts.body).files[FILE].content; return reply(200, '{}'); }
    gist.gets++;
    if (gist.answer) return gist.answer();
    return reply(200, JSON.stringify({ id: 'g1', files: { [FILE]: { content: gist.text } } }));
  };
  return gist;
}
// An edit made on the other device and already in the gist.
function phoneEdit(gist, fn) {
  const prev = JSON.parse(gist.text);
  const next = structuredClone(prev);
  fn(next);
  next.stamps = { ...(prev.stamps || {}) };
  merge.stampEdit(next.stamps, prev, next, clock.t);
  next.updatedAt = Math.max(clock.t, (prev.updatedAt || 0) + 1);
  gist.text = JSON.stringify(next);
}

test('1: with Sync on, a tab that stays on screen picks up the other device\'s ticks by itself', async () => {
  const logged = [];
  const consoles = ['log', 'info', 'warn', 'error', 'debug'].map((k) => [k, console[k]]);
  for (const [k] of consoles) console[k] = (...args) => { logged.push(args.map(String).join(' ')); };
  const statuses = [];
  const off = sync.onSyncStatus((s) => statuses.push(`${s.state}: ${s.message}`));
  try {
    const t0 = at('2026-11-26T03:00:00Z');
    nav.onLine = true;
    globalThis.document.visibilityState = 'visible';
    startWith(t0, (s) => { s.mesos.held = 111; });
    const gist = github();
    mem.set(SYNC, JSON.stringify({ token: TOKEN, gistId: 'g1' }));
    sync.startSync();
    await until(() => sync.syncStatus().state === 'ok', 'the first sync');
    assert.equal(JSON.parse(gist.text).mesos.held, 111);
    const el = await show(TodayPage, loadData());
    assert.match(textOf(el), /Core dailies 0 \/ \d+/);

    // The phone ticks two dailies and changes the meso balance.
    await advance(MIN);
    phoneEdit(gist, (s) => {
      s.mesos.held = 999;
      for (const id of ['d-coupon', 'd-ursus']) s.checklist.items[`main|${id}`] = { p: time.periodKey('daily', clock.t), t: clock.t, d: 1 };
    });
    let gets = gist.gets;
    statuses.length = 0;
    await advanceTo(t0 + sync.POLL_MS - MIN);
    assert.equal(gist.gets, gets, 'not before the interval is up');
    await advanceTo(t0 + sync.POLL_MS);
    assert.equal(gist.gets, gets + 1, 'one read of the gist');
    assert.equal(store.getState().mesos.held, 999);
    assert.match(textOf(el), /Core dailies 2 \/ \d+/, 'the PC shows the phone\'s ticks without a tab switch');
    assert.ok(!statuses.some((s) => s.startsWith('busy')), 'a timed check does not flash "Syncing…"');
    assert.equal(sync.syncStatus().state, 'ok');

    // Steady state: one small request per interval, no writes when nothing changed.
    // (First let the page save what it recorded about the new ticks, a change like any other.)
    await advance(MIN);
    gets = gist.gets;
    const patches = gist.patches;
    await advance(HOUR);
    assert.ok(gist.gets - gets >= HOUR / sync.POLL_MS - 1 && gist.gets - gets <= HOUR / sync.POLL_MS, `${gist.gets - gets} reads in an hour`);
    assert.equal(gist.patches, patches);

    // A sync for another reason (a tick here) moves the next timed check back.
    gets = gist.gets;
    await setBox(box(el, 'cl-d-sauna'), true);
    await advance(10 * SEC);
    assert.equal(gist.gets, gets + 1, 'the tick was sent 4 s later');
    await advance(sync.POLL_MS - 30 * SEC);
    assert.equal(gist.gets, gets + 1);
    await advance(2 * MIN);
    assert.equal(gist.gets, gets + 2);

    // Hidden: nothing. Offline: nothing.
    gets = gist.gets;
    globalThis.document.visibilityState = 'hidden';
    await advance(2 * HOUR);
    assert.equal(gist.gets, gets, 'no request while hidden');
    globalThis.document.visibilityState = 'visible';
    nav.onLine = false;
    await advance(2 * HOUR);
    assert.equal(gist.gets, gets, 'no request while offline');
    assert.equal(sync.pollDue(), false);
    nav.onLine = true;
    assert.equal(sync.pollDue(), true);
    fireEvent('online');
    await settle();
    assert.equal(gist.gets, gets + 1, 'back online: caught up at once');

    // Failures in a row: the wait doubles.
    gist.answer = () => gist.reply(500, '{}');
    gets = gist.gets;
    const start = clock.t;
    const seenAt = [];
    for (let m = 1; m <= 80; m++) { await advance(MIN); if (gist.gets > gets) { seenAt.push(Math.round((clock.t - start) / MIN)); gets = gist.gets; } }
    // (The timer looks at the clock once a minute, so the first can be up to a minute late.)
    assert.ok(seenAt[0] === 5 || seenAt[0] === 6, `first retry after ${seenAt[0]} min`);
    assert.deepEqual(seenAt.slice(1).map((m, i) => m - seenAt[i]), [10, 20, 40], 'then 10, 20 and 40 minutes apart');
    assert.equal(sync.syncStatus().state, 'error');
    gist.answer = null;
    await advance(81 * MIN);
    assert.equal(sync.syncStatus().state, 'ok', 'it recovers by itself');

    // GitHub says to wait: nothing goes out by itself before the time it gives, not even after a tick.
    gist.answer = () => gist.reply(403, '{}', { 'retry-after': '1800' });
    await advance(sync.POLL_MS + MIN);
    assert.equal(sync.syncStatus().state, 'error');
    gist.answer = null;
    gets = gist.gets;
    const held = clock.t;
    await setBox(box(el, 'cl-d-sauna'), true);
    fireEvent('visibilitychange');
    await advanceTo(held + 28 * MIN);
    assert.equal(gist.gets, gets, 'held for the half hour GitHub asked for');
    await advanceTo(held + 45 * MIN);
    assert.ok(gist.gets > gets);
    assert.equal(sync.syncStatus().state, 'ok');
    assert.equal(JSON.parse(gist.text).checklist.items['main|d-sauna'].d, 1, 'and the tick made meanwhile was sent');
    // A used-up rate limit names its reset time.
    gist.answer = () => gist.reply(403, '{}', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor((clock.t + 50 * MIN) / 1000)) });
    await advance(sync.POLL_MS + MIN);
    gist.answer = null;
    gets = gist.gets;
    const limited = clock.t;
    await advanceTo(limited + 40 * MIN);
    assert.equal(gist.gets, gets);
    await advanceTo(limited + 60 * MIN);
    assert.ok(gist.gets > gets);

    // Disconnected: the timer asks nothing.
    sync.disconnect();
    gets = gist.gets;
    await advance(HOUR);
    assert.equal(gist.gets, gets);

    // The token went to GitHub in the Authorization header only.
    assert.deepEqual([...gist.auth], [`Bearer ${TOKEN}`]);
    for (const text of [...gist.urls, ...logged, ...statuses, gist.text, mem.get('maple-tracker:v1') || '', mem.get('maple-tracker:backups') || '']) assert.ok(!text.includes(TOKEN));
    assert.ok(gist.urls.every((u) => u.startsWith('https://api.github.com/gists/g1')));
    unmount(el);
  } finally {
    off();
    for (const [k, fn] of consoles) console[k] = fn;
    sync.disconnect();
    mem.delete(SYNC);
    nav.onLine = true;
    globalThis.document.visibilityState = 'visible';
  }
});

// ---- 0, 39, 5: the whole app, left open ------------------------------------------------------------------------
test('0 39 5: the app left open for two days keeps "Data fresh", shows what Nexon posted meanwhile, and rolls over at the reset', async () => {
  const t0 = at('2026-11-24T18:43:00Z');
  mem.delete(SYNC);
  startWith(t0);
  // A healthy job: it ran at every 6th hour, and each run's files are what the server holds from then on.
  const lastRun = (t) => Math.floor((t - 17 * MIN) / (6 * HOUR)) * 6 * HOUR + 17 * MIN;
  const posted = t0 + 20 * HOUR;
  let asked = 0;
  globalThis.fetch = async (url) => {
    const name = String(url).split('data/')[1];
    const run = lastRun(clock.t);
    let body;
    if (name === 'meta.json') { asked++; body = metaAt(run); }
    else if (name === 'events.json') body = { events: [event('a', 'Old Event A', t0 - DAY, t0 + 6 * DAY), ...(run >= posted ? [event('b', 'Posted Later B', posted, t0 + 5 * DAY)] : [])], sunny: [] };
    else if (name === 'news.json') body = { items: [] };
    else if (name === 'characters.json') body = { characters: [] };
    else if (name === 'shops.json') body = { source: 'test', shops: [] };
    else body = JSON.parse(readFileSync(siteFile(`data/${name}`), 'utf8'));
    const text = JSON.stringify(body);
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  };
  const root = new FakeNode('div');
  globalThis.document.getElementById = () => root;
  globalThis.history = { replaceState() {} };
  globalThis.location.hash = '#today';
  await import('../../site/app/main.js');
  mounted.add(root);
  await until(() => root.find((n) => n.attrs.class === 'clocks'), 'the app to start');
  const pill = () => root.find((n) => String(n.attrs.class || '').startsWith('status-pill'));
  const bar = () => squash(root.find((n) => n.attrs.class === 'clocks').text);
  assert.equal(squash(pill().text), 'Data fresh · sync off');
  assert.match(textOf(root), /Old Event A/);
  assert.doesNotMatch(textOf(root), /Posted Later B/);
  const boot = asked;
  for (let h = 1; h <= 48; h++) {
    await sleepTo(t0 + h * HOUR + MIN);
    assert.equal(squash(pill().text), 'Data fresh · sync off', `after ${h} h`);
    assert.doesNotMatch(pill().attrs.title, /stopped|hours old/, `after ${h} h`);
  }
  assert.ok(asked - boot >= 40 && asked - boot <= 48, `${asked - boot} checks in 48 hours: about hourly`);
  assert.match(textOf(root), /Posted Later B/, 'the event posted while the tab was open is on Today');

  // The job really stops: now the warning is right, and it names the job.
  const stopAt = clock.t;
  const frozen = lastRun(stopAt);
  const answer = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).endsWith('meta.json') ? { ok: true, status: 200, json: async () => metaAt(frozen) } : answer(url));
  await sleepTo(stopAt + 20 * HOUR);
  assert.equal(squash(pill().text), 'Data fresh · sync off');
  await sleepTo(frozen + 31 * HOUR);
  await sleepTo(frozen + 31 * HOUR + 2 * MIN);
  assert.equal(squash(pill().text), 'Nexon data old');
  assert.match(pill().attrs.title, /The 6-hour refresh job may have stopped/);

  // The top bar and the page roll over together, at the reset.
  const reset = time.nextReset('daily', clock.t);
  await sleepTo(reset - 3 * SEC);
  await setBox(box(root, 'cl-d-coupon'), true);
  await advanceTo(reset - SEC);
  assert.match(bar(), /Daily 0m 01s/);
  assert.match(textOf(root), /Core dailies 1 \/ \d+/);
  await advanceTo(reset);
  assert.match(bar(), /Daily 1d 0h/);
  assert.match(textOf(root), /Core dailies 0 \/ \d+/);
  assert.doesNotMatch(textOf(root), NEVER);
  unmount(root);
});
