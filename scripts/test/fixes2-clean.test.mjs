// Second round of fixes: the loader (calc/sanitise.js), the checklist and the streak.
// Pages are drawn in Node with the stand-in browser, as in render.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

const dataFile = (name) => fileURLToPath(new URL(`../../site/data/${name}`, import.meta.url));
installFakeBrowser({ files: { 'data/items.json': dataFile('items.json') } });

const { html, render } = await import('../../site/vendor/htm-preact.mjs');
const { dedupeEvents } = await import('../../site/app/calc/events.js');
const store = await import('../../site/app/store.js');
const { periodKey, dayKey, DAY } = await import('../../site/app/time.js');
const { mergeStates } = await import('../../site/app/calc/merge.js');
const { itemStatus, recordKey, streakToday, moveResetDay } = await import('../../site/app/calc/checklist.js');
const { erdaCost } = await import('../../site/app/calc/upgrades.js');
const { ChecklistPage, dailyProgress, setRecord, bumpCount } = await import('../../site/app/pages/checklist.js');
const { streakInfo } = await import('../../site/app/pages/session.js');
const { Counter } = await import('../../site/app/ui.js');
const PAGES = {
  today: (await import('../../site/app/pages/today.js')).TodayPage,
  checklist: ChecklistPage,
  mesos: (await import('../../site/app/pages/mesos.js')).MesosPage,
  gear: (await import('../../site/app/pages/gear.js')).GearPage,
  progress: (await import('../../site/app/pages/progress.js')).ProgressPage
};

const load = (name) => { try { return JSON.parse(readFileSync(dataFile(`${name}.json`), 'utf8')); } catch { return null; } };
// Words in Nexon's own titles must not trip the page checks (see render.test.mjs).
const feed = (name) => { const raw = load(name); return raw && JSON.parse(JSON.stringify(raw).replace(/undefined|NaN|Infinity|\[object/g, 'X')); };
const DATA = {
  bosses: load('bosses'), symbols: load('symbols'), liberation: load('liberation'), ibp: load('ibp'), checklist: load('checklist'),
  gear: load('gear'), erda: load('erda'), upgrades: load('upgrades'), potential: load('potential'), gearStats: load('gearstats'),
  events: feed('events') || { events: [] }, news: feed('news') || { items: [] }, nexonCharacters: { characters: [] }, meta: load('meta'), tables: load('tables'), season: load('season'),
  pitched: load('pitched'), shops: load('shops'), flames: load('flames'), champions: load('champions'), expSources: load('expsources'), upcoming: load('upcoming'), bossCp: load('bosscp'), classes: load('classes')
};
DATA.events.events = dedupeEvents(DATA.events.events || []);
DATA.events.sunny = Array.isArray(DATA.events.sunny) ? DATA.events.sunny : [];
DATA.bossById = Object.fromEntries(DATA.bosses.bosses.map((b) => [b.id, b]));

const BAD = /undefined|NaN|\[object|Infinity/;
const mounted = [];
after(() => { for (const el of mounted) render(null, el); });
async function show(name) {
  const el = new FakeNode('div');
  mounted.push(el);
  const Page = PAGES[name];
  const App = () => html`<${Page} data=${DATA} state=${store.useStore()} />`;
  render(html`<${App} />`, el);
  await tick(5);
  return el;
}
function close(el) { render(null, el); mounted.splice(mounted.indexOf(el), 1); }
async function until(check, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return true; await tick(10); }
  return Boolean(check());
}
// Long enough for a page's effects to have run (they are queued about 100 ms after a draw here).
const settle = () => new Promise((r) => setTimeout(r, 350));

const MAIN = { id: 'main', name: 'Main', cls: 'Erel Light', mainStat: 'STR', level: 264, challenger: true };
const MULE = { id: 'mule', name: 'Mule', cls: 'Hero', mainStat: 'STR', level: 210, challenger: false };
function loadState(extra, chars = [MAIN]) {
  store.replaceState({ ...store.blankState(), characters: structuredClone(chars), activeId: chars[0].id, ...extra }, true);
  return store.getState();
}

test('the loader drops streak days, gear history days and reading times that are not real dates', async () => {
  const now = Date.now();
  const today = dayKey(now);
  const s = loadState({
    checklist: { items: {}, resets: {}, flags: {}, history: { '2026-13-45': { done: 9, total: 9 }, zzz: { done: 2, total: 2 }, '': { done: 1, total: 1 }, '2026-11-25T00:00:00Z': { done: 3, total: 3 }, '2026-02-31': { done: 3, total: 3 }, [today]: { done: 2, total: 9, by: 'main' }, '2026-11-20': { done: 9, total: 9 } } },
    gear: { main: { preset: 'mid', slots: {}, history: [{ d: '0000-00-00', pct: 0.1 }, { d: '2026-13-45', pct: 0.1 }, { d: '2026-11-20', pct: 0.2 }] } },
    level: { main: { log: [{ t: 8.64e15 + 1, level: 264, pct: 10 }, { t: 1e16, level: 264, pct: 10 }, { t: 8.64e15, level: 264, pct: 10 }, { t: now - DAY, level: 264, pct: 12 }] } },
    ui: { progressView: 'level' }
  });
  assert.deepEqual(Object.keys(s.checklist.history).sort(), ['2026-11-20', today].sort(), 'only real days stay');
  assert.deepEqual(s.checklist.history['2026-11-20'], { done: 9, total: 9 }, 'a good entry is untouched');
  assert.deepEqual(s.gear.main.history, [{ d: '2026-11-20', pct: 0.2 }]);
  assert.deepEqual(s.level.main.log.map((r) => r.t), [now - DAY]);
  for (const name of ['today', 'checklist', 'gear', 'progress']) {
    const el = await show(name);
    assert.doesNotMatch(el.text, BAD, `${name} prints no junk`);
    close(el);
  }
});

test('streakInfo skips a key that is not a date instead of throwing', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  const history = { junk: { done: 9, total: 9 }, '2026-13-45': { done: 9, total: 9 }, '2026-11-25': { done: 9, total: 9 }, '2026-11-26': { done: 9, total: 9 } };
  assert.deepEqual(streakInfo(history, now), { streak: 2, best: 2 });
});

test('a tick count of the wrong kind is cleaned on load and never reaches the page', async () => {
  const now = Date.now();
  const p = periodKey('daily', now);
  const s = loadState({ checklist: { items: {
    'main|d-shadow': { p, c: { a: { b: 1 } }, d: 0 },
    a: { p, c: -5 }, b: { p, c: 2.5 }, c: { p, c: 'x' }, d: { p, c: 1e308, d: 1 }, e: { p, c: 4, d: 1, t: now }, f: { p, d: {} }, g: { p, d: true, t: 1e17 }
  }, resets: {}, flags: {}, history: {} } });
  const it = s.checklist.items;
  assert.deepEqual(it['main|d-shadow'], { p, d: 0 }, 'an object is not a count');
  assert.equal(it.a.c, 0);
  assert.equal(it.b.c, 2);
  assert.equal('c' in it.c, false);
  assert.equal(it.d.c, 1e6);
  assert.deepEqual(it.e, { p, c: 4, d: 1, t: now }, 'a good record is untouched');
  assert.equal('d' in it.f, false);
  assert.deepEqual(it.g, { p, d: true });

  // Read side: whatever is saved, the count shown is a whole number from 0 to the target.
  const group = DATA.checklist.groups.find((g) => g.items.some((i) => i.id === 'd-shadow'));
  const item = group.items.find((i) => i.id === 'd-shadow');
  const who = { id: 'main', level: 264, challenger: true };
  const count = (c) => itemStatus(item, group, { items: { 'main|d-shadow': { p, c } }, resets: {}, flags: {} }, now, who);
  assert.equal(count({}).count, 0);
  assert.equal(count('7').count, 0);
  assert.equal(count(-5).count, 0);
  assert.equal(count(2.5).count, 2);
  assert.deepEqual([count(1e9).count, count(1e9).done], [item.target, true]);

  for (const name of ['checklist', 'today']) {
    const el = await show(name);
    assert.doesNotMatch(el.text, BAD);
    close(el);
  }
  assert.doesNotThrow(() => store.update((x) => { x.ui.todaySales = true; }), 'saving still works after the pages were drawn');
  assert.doesNotThrow(() => JSON.stringify(store.getState()));
});

test('a 6th job level with a decimal is rounded down and never breaks the cost', async () => {
  const per = DATA.upgrades.erda.originPerLevel;
  assert.deepEqual(erdaCost(per, 1.5, 10), erdaCost(per, 1, 10));
  assert.deepEqual(erdaCost(per, 29.5, 30), erdaCost(per, 29, 30));
  assert.deepEqual(erdaCost(per, 0.5, 10), erdaCost(per, 1, 10));
  const s = loadState({ erda: { main: { template: 'erel', levels: { lugh: 30, origin: 1.5, other: 9.9, bad: 120 }, steps: { shinestone3: true } } }, ui: { progressView: 'sixth' } });
  assert.deepEqual(s.erda.main.levels, { lugh: 30, origin: 1, other: 9 });
  const el = await show('progress');
  assert.doesNotMatch(el.text, BAD);
  close(el);
});

test('a gear target above what the slot itself can hold is brought down to it', async () => {
  const s = loadState({ gear: { main: { preset: 'mid', slots: {
    hat: { tier: 2, stars: 22, pot: 3, ilvl: 160, target: { pot: 7 } },
    top: { tier: 2, stars: 10, pot: 2, ilvl: 160, target: { pot: 5, lines: 9, bpot: 9, tier: 30, stars: 30 } },
    shoes: { tier: 2, stars: 10, pot: 2, ilvl: 160, target: { pot: 4, lines: 3, bpot: 4, tier: 9, stars: 22, extra: 12, toString: 5 } }
  } } } });
  assert.deepEqual(s.gear.main.slots.hat.target, { pot: 4 });
  assert.deepEqual(s.gear.main.slots.top.target, { pot: 4, lines: 3, bpot: 4, tier: 9, stars: 30 });
  assert.deepEqual(s.gear.main.slots.shoes.target, { pot: 4, lines: 3, bpot: 4, tier: 9, stars: 22, extra: 12, toString: 5 }, 'a good target is untouched');
  for (const name of ['today', 'gear']) {
    const el = await show(name);
    assert.doesNotMatch(el.text, BAD, name);
    close(el);
  }
});

test('a goal above the limit stays at the limit on load, and is never saved or offered', async () => {
  const s = loadState({ mesos: { held: 0, goals: [{ id: 'a', name: 'Huge', cost: 1448642682090035 }, { id: 'b', name: 'Fine', cost: 5e9 }, { id: 'c', name: 'Bad', cost: -1 }, { id: 'd', name: 'Odd', cost: Infinity }] } });
  assert.deepEqual(s.mesos.goals.map((g) => g.cost), [1e15, 5e9, 0, 0]);

  // A 17 -> 30 star target costs more than the limit: the Planner must not offer it as a chip.
  loadState({ gear: { main: { preset: 'mid', slots: { hat: { tier: 2, ilvl: 160, stars: 17, pot: 4, target: { stars: 30 } } } } }, ui: { mesosView: 'planner' } });
  const el = await show('mesos');
  const chips = el.findAll((n) => n.localName === 'button' && (n.attrs.class || '').split(' ').includes('chip')).map((n) => n.text);
  assert.ok(chips.some((t) => /Bright Cubes/.test(t)), 'the Planner and its other chips are drawn');
  assert.equal(chips.filter((t) => /★ \(expected\)/.test(t)).length, 0, 'no chip above the limit');
  close(el);
});

test('streakToday: the entry follows every character, not only the one on screen', () => {
  const main = (done) => ({ by: 'main', done, total: 9 });
  const mule = (done) => ({ by: 'mule', done, total: 6 });
  assert.deepEqual(streakToday(undefined, [main(0), mule(0)], 'mule'), { done: 0, total: 6, by: 'mule' }, 'nothing done: the character on screen');
  assert.deepEqual(streakToday({ done: 0, total: 6, by: 'mule' }, [main(9), mule(0)], 'mule'), { done: 9, total: 9, by: 'main' }, "the main's finished day wins while an alt is on screen");
  assert.equal(streakToday({ done: 9, total: 9, by: 'main' }, [main(9), mule(0)], 'mule'), null, 'looking at an alt leaves it');
  assert.deepEqual(streakToday({ done: 9, total: 9, by: 'main' }, [main(8), mule(0)], 'main'), { done: 8, total: 9, by: 'main' }, 'unticking lowers it');
  assert.deepEqual(streakToday({ done: 6, total: 6, by: 'mule' }, [main(5), mule(0)], 'mule'), { done: 5, total: 9, by: 'main' }, 'the alt unticked everything: the next best counts');
  assert.equal(streakToday({ done: 0, total: 9, by: 'main' }, [main(0), mule(0)], 'mule'), null, 'a tie keeps the recorded character (no back and forth between devices)');
  assert.equal(streakToday({ done: 9, total: 9, by: 'gone' }, [main(5), mule(0)], 'main'), null, 'a removed character keeps its day unless someone does better');
  assert.deepEqual(streakToday({ done: 2, total: 9, by: 'gone' }, [main(5), mule(0)], 'main'), { done: 5, total: 9, by: 'main' });
  assert.deepEqual(streakToday({ done: 2, total: 9 }, [main(5)], 'main'), { done: 5, total: 9, by: 'main' }, 'an entry from before entries had a character is taken over');
  assert.deepEqual(streakToday(undefined, [{ done: 3, total: 9 }], undefined), { done: 3, total: 9 }, 'no characters yet: one shared list');
  assert.equal(streakToday(undefined, [{ by: 'main', done: 0, total: 0 }], 'main'), null);
});

// Two devices. The PC's main has finished every core daily; the phone shows an alt and has not synced today.
function twoDevices(now) {
  const today = dayKey(now);
  loadState({ checklist: { items: {}, resets: {}, flags: {}, history: { [dayKey(now - 2 * DAY)]: { done: 9, total: 9, by: 'main' }, [dayKey(now - DAY)]: { done: 9, total: 9, by: 'main' } }, owner: null, ownerSet: true } }, [MAIN, MULE]);
  const base = structuredClone(store.getState());
  for (const k of Object.keys(base.stamps || {})) base.stamps[k] = now - DAY;
  base.stamps = base.stamps || {};
  base.updatedAt = now - DAY;
  const pc = structuredClone(base);
  const group = DATA.checklist.groups.find((g) => g.key === 'daily');
  const who = { id: 'main', level: 264, challenger: true };
  const at = now - 2 * 3600000;
  const put = (k, rec) => { pc.checklist.items[k] = rec; pc.stamps[`checklist/items/${k}`] = at; };
  for (const item of group.items) {
    const st = itemStatus(item, group, pc.checklist, now, who);
    if (st.locked || st.expired || st.link || item.optional) continue;
    const p = periodKey(st.kind, now);
    if (item.type === 'chips') for (const [cid] of item.chips) put(recordKey(item, who, `_${cid}`), { p, d: 1 });
    else put(recordKey(item, who), item.type === 'count' ? { p, c: item.target, d: 1 } : { p, d: 1 });
  }
  const prog = dailyProgress(DATA.checklist, pc.checklist, now, who);
  assert.ok(prog.total > 0 && prog.done === prog.total, 'the PC copy has a finished day');
  const full = { done: prog.done, total: prog.total, by: 'main' };
  pc.checklist.history[today] = full;
  pc.stamps[`checklist/history/${today}`] = at;
  pc.updatedAt = at;
  const phone = structuredClone(base);
  phone.activeId = 'mule';
  return { today, pc, phone, full };
}

for (const page of ['today', 'checklist']) {
  test(`opening ${page} on a second device that shows an alt keeps the main's finished streak day`, async () => {
    const now = Date.now();
    const { today, pc, phone, full } = twoDevices(now);
    store.replaceState(phone, true);
    const el = await show(page);
    await settle();
    assert.equal(store.getState().checklist.history[today], undefined, 'only opening the page records nothing');
    // One daily ticked on the alt before the first sync: the phone records the alt's unfinished day, stamped now.
    setRecord('mule|d-ursus', 'daily', { d: 1 });
    assert.ok(await until(() => store.getState().checklist.history[today]?.by === 'mule'), 'the alt has a daily to tick');
    // What sync does: merge with the other copy, then load the result.
    store.replaceState(mergeStates(store.getState(), pc), true);
    assert.ok(await until(() => store.getState().checklist.history[today]?.by === 'main'), 'the phone puts the day right from the ticks it received');
    await settle();
    const s = structuredClone(store.getState());
    assert.deepEqual(s.checklist.history[today], full);
    assert.equal(s.activeId, 'mule', 'the phone still shows its alt');
    assert.equal(streakInfo(s.checklist.history, now).streak, 3);
    assert.deepEqual(mergeStates(pc, s).checklist.history[today], full, 'and the PC keeps it after syncing back');
    close(el);
  });
}

test("a PC that has the main's page open repairs the day when another device's empty entry arrives", async () => {
  const now = Date.now();
  const { today, pc, phone, full } = twoDevices(now);
  store.replaceState(pc, true);
  const el = await show('today');
  await settle();
  assert.deepEqual(store.getState().checklist.history[today], full);
  const stale = structuredClone(phone);
  stale.checklist.history[today] = { done: 0, total: 6, by: 'mule' };
  stale.stamps[`checklist/history/${today}`] = now;
  stale.updatedAt = now;
  const merged = mergeStates(store.getState(), stale);
  assert.equal(merged.checklist.history[today].by, 'mule', 'the merge itself takes the newer entry');
  store.replaceState(merged, true);
  assert.ok(await until(() => store.getState().checklist.history[today]?.by === 'main'));
  assert.deepEqual(store.getState().checklist.history[today], full);
  close(el);
});

test('changing a reset day clears a tick the new day has already reset, and keeps one made since', () => {
  const item = { id: 'w-ultima' };
  const now = Date.parse('2026-11-25T03:00:00Z'); // a Wednesday
  const fri = Date.parse('2026-11-20T10:00:00Z');
  const tue = Date.parse('2026-11-24T10:00:00Z');
  const run = (items, from, to) => { moveResetDay(items, item, from, to, now); return items; };
  // Thursday -> Monday: Monday 23 Nov has reset since the Friday tick, not since the Tuesday one.
  assert.deepEqual(run({ 'main|w-ultima': { p: 'thu:2026-11-19', c: 5, d: 1, t: fri }, 'alt|w-ultima': { p: 'thu:2026-11-19', c: 2, t: tue } }, 'thu', 'mon'),
    { 'alt|w-ultima': { p: 'mon:2026-11-23', c: 2, t: tue } });
  assert.deepEqual(run({ 'main|w-ultima': { p: 'thu:2026-11-19', c: 5, d: 1 } }, 'thu', 'mon'), { 'main|w-ultima': { p: 'mon:2026-11-23', c: 5, d: 1 } }, 'a tick saved without a time is kept');
  // Wednesday -> Thursday: the Thursday week began earlier, so nothing has been reset in between.
  assert.deepEqual(run({ 'w-ultima': { p: 'wed:2026-11-25', d: 1, t: now } }, 'wed', 'thu'), { 'w-ultima': { p: 'thu:2026-11-19', d: 1, t: now } });
  // Other items, other weeks and look-alike ids are left alone.
  const others = { 'main|w-ultima2': { p: 'thu:2026-11-19', d: 1, t: fri }, 'main|xw-ultima': { p: 'thu:2026-11-19', d: 1, t: fri }, 'main|w-ultima': { p: 'thu:2026-11-12', d: 1, t: fri } };
  assert.deepEqual(run(structuredClone(others), 'thu', 'mon'), others);
  // An item with chips moves its chip records too.
  const chips = { 'main|w-x_a': { p: 'thu:2026-11-19', d: 1, t: tue }, 'main|w-x_b': { p: 'thu:2026-11-19', d: 1, t: fri } };
  moveResetDay(chips, { id: 'w-x', chips: [['a', 'A'], ['b', 'B']] }, 'thu', 'mon', now);
  assert.deepEqual(chips, { 'main|w-x_a': { p: 'mon:2026-11-23', d: 1, t: tue } });
});

test('the reset pill uses the tick time that every new tick now carries', async () => {
  const realNow = Date.now;
  try {
    let fake = Date.parse('2026-11-20T10:00:00Z');
    Date.now = () => fake;
    loadState({});
    setRecord('main|w-ultima', 'thu', { c: 5, d: 1 });
    assert.deepEqual(store.getState().checklist.items['main|w-ultima'], { p: 'thu:2026-11-19', t: fake, c: 5, d: 1 });
    fake = Date.parse('2026-11-25T03:00:00Z');
    const el = await show('checklist');
    const pill = el.find((n) => n.localName === 'button' && /^Resets on Thursday/.test(n.attrs['aria-label'] || '') && n.parentNode && /Ultima/.test(n.parentNode.parentNode.text));
    assert.ok(pill, 'the Ultima row has a Thursday pill');
    pill.fire('click');
    await tick(5);
    assert.equal(store.getState().checklist.resets['w-ultima'], 'mon');
    assert.equal(store.getState().checklist.items['main|w-ultima'], undefined, 'the Friday tick was reset on Monday');
    close(el);
  } finally { Date.now = realNow; }
});

test('a counter clicked just after a reset starts the new period from zero', async () => {
  const realNow = Date.now;
  try {
    for (const page of ['checklist', 'today']) {
      let fake = Date.parse('2026-11-26T23:59:50Z');
      Date.now = () => fake;
      loadState({ checklist: { items: { 'main|d-shadow': { p: 'daily:2026-11-26', c: 9 } }, resets: {}, flags: {}, history: {} } });
      const el = await show(page);
      const btn = (re) => el.find((n) => n.localName === 'button' && re.test(n.attrs['aria-label'] || ''));
      assert.ok(btn(/^One more: Shadow/), `${page} draws the counter`);
      fake = Date.parse('2026-11-27T00:00:03Z');
      btn(/^One more: Shadow/).fire('click');
      await tick(5);
      assert.deepEqual(store.getState().checklist.items['main|d-shadow'], { p: 'daily:2026-11-27', t: fake, c: 1, d: 0 }, page);
      close(el);
    }
    // Inside one period the buttons count up and down from the saved value, within 0 and the target.
    let fake = Date.parse('2026-11-26T12:00:00Z');
    Date.now = () => fake;
    loadState({ checklist: { items: { 'main|d-shadow': { p: 'daily:2026-11-26', c: 9 } }, resets: {}, flags: {}, history: {} } });
    const group = DATA.checklist.groups.find((g) => g.items.some((i) => i.id === 'd-shadow'));
    const item = group.items.find((i) => i.id === 'd-shadow');
    const who = { id: 'main', level: 264, challenger: true };
    const rec = () => store.getState().checklist.items['main|d-shadow'];
    bumpCount(item, group, who, 1);
    assert.deepEqual([rec().c, rec().d], [item.target, 1]);
    bumpCount(item, group, who, 1);
    assert.equal(rec().c, item.target, 'never above the target');
    bumpCount(item, group, who, -1);
    assert.deepEqual([rec().c, rec().d], [item.target - 1, 0]);
  } finally { Date.now = realNow; }
});

test('Counter reports steps when asked to, and whole values otherwise', () => {
  const press = (props, label) => {
    const el = new FakeNode('div');
    render(html`<${Counter} label="X" target=${10} ...${props} />`, el);
    el.find((n) => n.localName === 'button' && (n.attrs['aria-label'] || '').startsWith(label)).fire('click');
    render(null, el);
  };
  const seen = [];
  press({ value: 10, onStep: (d) => seen.push(['step', d]) }, 'One more');
  press({ value: 0, onStep: (d) => seen.push(['step', d]) }, 'One fewer');
  press({ value: 10, onChange: (v) => seen.push(['value', v]) }, 'One more');
  press({ value: 4, onChange: (v) => seen.push(['value', v]) }, 'One fewer');
  assert.deepEqual(seen, [['step', 1], ['step', -1], ['value', 10], ['value', 3]]);
});
