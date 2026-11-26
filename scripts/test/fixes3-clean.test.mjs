// Third round of fixes: moving an item's reset day never loses a tick, and the Planner's gear suggestion
// passes over a step that costs more than a goal can hold.
// Pages are drawn in Node with the stand-in browser, as in render.test.mjs. Every date here is fixed.
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
const { periodKey, DAY } = await import('../../site/app/time.js');
const { itemStatus, resetOf, moveResetDay, RESET_CYCLE } = await import('../../site/app/calc/checklist.js');
const { ChecklistPage, bumpCount } = await import('../../site/app/pages/checklist.js');
const { MesosPage } = await import('../../site/app/pages/mesos.js');
const PAGES = { checklist: ChecklistPage, mesos: MesosPage };

const load = (name) => { try { return JSON.parse(readFileSync(dataFile(`${name}.json`), 'utf8')); } catch { return null; } };
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

const MAIN = { id: 'main', name: 'Main', cls: 'Erel Light', mainStat: 'STR', level: 264, challenger: true };
function loadState(extra) {
  store.replaceState({ ...store.blankState(), characters: [structuredClone(MAIN)], activeId: 'main', ...extra }, true);
  return store.getState();
}

const at = (iso) => Date.parse(iso);
const GROUP = { reset: 'custom' };
const WHO = { id: 'main', level: 300 };
const nextDay = (d) => RESET_CYCLE[(RESET_CYCLE.indexOf(d) + 1) % RESET_CYCLE.length];
// What the pill does on one tap, on a plain checklist state.
function tap(cs, item, now) {
  const from = resetOf(item, GROUP, cs);
  const to = nextDay(from);
  moveResetDay(cs.items, item, from, to, now);
  cs.resets[item.id] = to;
}
// A checklist where `item` follows `day` and was ticked at `t`, written the way the page writes it.
function ticked(item, day, t, rec = { d: 1 }) {
  return { items: { [`main|${item.id}`]: { p: periodKey(day, t), t, ...rec } }, resets: { [item.id]: day }, flags: {}, history: {} };
}

test('cycling the reset day never loses a tick: through other days, and back to where it started', () => {
  const item = { id: 'w-x', type: 'count', target: 5, def: 'thu' };
  const fri = at('2026-11-20T10:00:00Z');
  const rec = { c: 5, d: 1 };

  // Thursday -> Monday -> Wednesday on Tue 24 Nov: the Wednesday week runs 18 - 25 Nov and holds the Friday tick.
  let now = at('2026-11-24T03:00:00Z');
  let cs = ticked(item, 'thu', fri, rec);
  tap(cs, item, now);
  assert.equal(cs.resets['w-x'], 'mon');
  assert.equal(itemStatus(item, GROUP, cs, now, WHO).count, 0, 'Monday 23 Nov has reset the Friday tick');
  assert.ok(cs.items['main|w-x'], 'but the record is kept');
  tap(cs, item, now);
  assert.equal(cs.resets['w-x'], 'wed');
  assert.equal(itemStatus(item, GROUP, cs, now, WHO).count, 5, 'Wednesday has not reset it');
  assert.deepEqual(cs.items['main|w-x'], { p: 'wed:2026-11-18', t: fri, c: 5, d: 1 });

  // A mistaken tap cycled back to Thursday, on a Tuesday and on a Wednesday: nothing has changed.
  for (const iso of ['2026-11-24T03:00:00Z', '2026-11-25T03:00:00Z']) {
    now = at(iso);
    cs = ticked(item, 'thu', fri, rec);
    const before = structuredClone(cs);
    tap(cs, item, now); tap(cs, item, now); tap(cs, item, now);
    assert.deepEqual(cs, before, iso);
    assert.equal(itemStatus(item, GROUP, cs, now, WHO).count, 5);
  }

  // The same from a Monday item and a Wednesday item.
  cs = ticked(item, 'mon', at('2026-11-17T10:00:00Z'), rec);
  now = at('2026-11-19T03:00:00Z');
  tap(cs, item, now); tap(cs, item, now); tap(cs, item, now);
  assert.equal(itemStatus(item, GROUP, cs, now, WHO).count, 5, 'Monday item');
  cs = ticked(item, 'wed', at('2026-11-18T10:00:00Z'), rec);
  now = at('2026-11-24T03:00:00Z');
  tap(cs, item, now); tap(cs, item, now); tap(cs, item, now);
  assert.equal(itemStatus(item, GROUP, cs, now, WHO).count, 5, 'Wednesday item');
});

test('a tick the new reset day has not reset yet comes back, whichever week it was filed under', () => {
  const item = { id: 'w-x', def: 'thu' };
  const cases = [
    // [old day, new day (taps), tick, now]
    ['thu', 1, '2026-11-24T10:00:00Z', '2026-11-26T01:00:00Z'], // Thu -> Mon, just after the Thursday reset
    ['thu', 1, '2026-11-24T03:00:00Z', '2026-11-27T03:00:00Z'],
    ['mon', 1, '2026-11-19T10:00:00Z', '2026-11-24T10:00:00Z'], // Mon -> Wed
    ['mon', 1, '2026-11-29T10:00:00Z', '2026-12-01T10:00:00Z'],
    ['wed', 1, '2026-11-20T10:00:00Z', '2026-11-25T03:00:00Z'] // Wed -> Thu
  ];
  for (const [day, taps, tickIso, nowIso] of cases) {
    const now = at(nowIso);
    const cs = ticked(item, day, at(tickIso));
    assert.equal(itemStatus(item, GROUP, cs, now, WHO).done, false, `${day}: the old day has reset it`);
    for (let i = 0; i < taps; i++) tap(cs, item, now);
    assert.equal(itemStatus(item, GROUP, cs, now, WHO).done, true, `${day} -> ${cs.resets['w-x']}, tick ${tickIso}, now ${nowIso}`);
  }
});

const noP = (c) => JSON.parse(JSON.stringify(c, (k, v) => (k === 'p' ? undefined : v)));

test('after any number of taps an item reads as if it had followed that day all along', () => {
  const item = { id: 'w-x', def: 'thu' };
  const base = at('2026-11-16T00:00:00Z'); // a Monday
  let checked = 0;
  for (const start of RESET_CYCLE) {
    for (let th = 1; th < 9 * 24; th += 7) {
      for (let nh = th; nh < th + 9 * 24; nh += 11) {
        const t = base + th * 3600e3;
        const now = base + nh * 3600e3;
        const cs = ticked(item, start, t);
        const original = structuredClone(cs);
        let day = start;
        for (let n = 1; n <= 4; n++) {
          tap(cs, item, now);
          day = nextDay(day);
          const want = periodKey(day, t) === periodKey(day, now);
          assert.equal(itemStatus(item, GROUP, cs, now, WHO).done, want, `${start} +${n} taps, tick +${th}h, now +${nh}h`);
          // Three taps end on the starting day with nothing lost. A tick from a week that is over may sit under
          // another key (it is never re-filed, so its sync stamp stays), so the keys are not compared.
          if (n === 3) assert.deepEqual(noP(cs), noP(original), 'three taps put everything back');
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 1000);
});

test('moving the reset day: ticks without a usable time stay in the running week, and nothing else is touched', () => {
  const item = { id: 'w-x', chips: [['a', 'A'], ['b', 'B']] };
  const now = at('2026-11-25T03:00:00Z'); // a Wednesday
  const fri = at('2026-11-20T10:00:00Z');
  const items = {
    'main|w-x': { p: 'thu:2026-11-19', d: 1 }, // saved before ticks carried a time
    'w-x': { p: 'thu:2026-11-19', d: 1 }, // the old shared list
    'alt|w-x': { p: 'thu:2026-11-19', d: 1, t: at('2026-10-01T00:00:00Z') }, // a time that does not fit its week
    'far|w-x': { p: 'thu:2026-11-19', d: 1, t: now + 30 * DAY }, // a clock that ran ahead
    'main|w-x_a': { p: 'thu:2026-11-19', d: 1, t: fri },
    'main|w-x_b': { p: 'thu:2026-11-19', d: 1 },
    'old|w-x': { p: 'thu:2026-11-05', d: 1 }, // an earlier week, no time: left alone
    'main|w-x2': { p: 'thu:2026-11-19', d: 1, t: fri },
    'main|xw-x': { p: 'thu:2026-11-19', d: 1, t: fri },
    'main|w-x_c': { p: 'thu:2026-11-19', d: 1, t: fri }, // not one of this item's chips
    'bad|w-x': null
  };
  const before = structuredClone(items);
  moveResetDay(items, item, 'thu', 'mon', now);
  for (const k of ['main|w-x', 'w-x', 'alt|w-x', 'far|w-x', 'main|w-x_b']) assert.equal(items[k].p, 'mon:2026-11-23', k);
  assert.equal(items['main|w-x_a'].p, 'thu:2026-11-19', 'a chip ticked on Friday was reset on Monday: left as it was, which no longer counts');
  for (const k of ['old|w-x', 'main|w-x2', 'main|xw-x', 'main|w-x_c', 'bad|w-x']) assert.deepEqual(items[k], before[k], k);
  // On through Wednesday and back to Thursday: every tick is where it began.
  moveResetDay(items, item, 'mon', 'wed', now);
  moveResetDay(items, item, 'wed', 'thu', now);
  for (const k of Object.keys(before)) assert.equal(items[k]?.p, before[k]?.p, k);
  assert.equal(Object.keys(items).length, Object.keys(before).length);
});

test('the reset pill on the Checklist page keeps a counted weekly through every tap', async () => {
  const realNow = Date.now;
  try {
    let fake = at('2026-11-20T10:00:00Z');
    Date.now = () => fake;
    loadState({});
    const group = DATA.checklist.groups.find((g) => g.items.some((it) => it.id === 'w-ultima'));
    const item = group.items.find((it) => it.id === 'w-ultima');
    assert.equal(group.reset, 'custom');
    assert.equal(item.def, 'thu');
    for (let i = 0; i < item.target; i++) bumpCount(item, group, { id: 'main', level: 264 }, 1);
    const saved = structuredClone(store.getState().checklist.items['main|w-ultima']);
    assert.deepEqual(saved, { p: 'thu:2026-11-19', t: fake, c: item.target, d: 1 });

    fake = at('2026-11-24T03:00:00Z');
    const el = await show('checklist');
    const pillTap = async () => {
      const pill = el.find((n) => n.localName === 'button' && /^Resets on /.test(n.attrs['aria-label'] || '') && n.parentNode && /Ultima/.test(n.parentNode.parentNode.text));
      assert.ok(pill, 'the Ultima row has a reset pill');
      pill.fire('click');
      await tick(5);
    };
    const count = () => itemStatus(item, group, store.getState().checklist, fake, { id: 'main', level: 264 }).count;
    await pillTap();
    assert.equal(store.getState().checklist.resets['w-ultima'], 'mon');
    assert.equal(count(), 0);
    await pillTap();
    assert.equal(store.getState().checklist.resets['w-ultima'], 'wed');
    assert.equal(count(), item.target, 'Thursday to Wednesday goes through Monday without losing the count');
    await pillTap();
    assert.equal(store.getState().checklist.resets['w-ultima'], 'thu');
    assert.equal(count(), item.target);
    assert.deepEqual(store.getState().checklist.items['main|w-ultima'], saved, 'back on Thursday the record is as it was');
    close(el);
  } finally { Date.now = realNow; }
});

test('the Planner offers the next gear step when the first one costs more than a goal can hold', async () => {
  const chipsFor = async (slots) => {
    loadState({ gear: { main: { preset: 'mid', slots } }, ui: { mesosView: 'planner' } });
    const el = await show('mesos');
    const chips = el.findAll((n) => n.localName === 'button' && (n.attrs.class || '').split(' ').includes('chip')).map((n) => n.text);
    close(el);
    return chips.filter((t) => /★ \(expected\)/.test(t));
  };
  const top = { tier: 2, ilvl: 160, stars: 21, pot: 4, lines: 3 };
  const alone = await chipsFor({ top });
  assert.equal(alone.length, 1);
  assert.match(alone[0], /Top 21→22★/);
  // A 0 -> 30 star hat comes first among the gaps and is above the limit: it is passed over, not the end of the search.
  const withHat = await chipsFor({ top, hat: { tier: 2, ilvl: 160, stars: 0, pot: 0, target: { stars: 30 } } });
  assert.deepEqual(withHat, alone);
  // A hat step a goal can hold is still the one offered.
  const reachable = await chipsFor({ top, hat: { tier: 2, ilvl: 160, stars: 0, pot: 0, target: { stars: 25 } } });
  assert.equal(reachable.length, 1);
  assert.match(reachable[0], /Hat 0→25★/);
});
