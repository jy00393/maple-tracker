// Renders every page of the tracker in Node against a small stand-in browser, for many saved states:
// empty, saved by older versions, full, and deliberately damaged. A page must never throw and must never
// print "undefined", "NaN" or "[object".
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
const { periodKey } = await import('../../site/app/time.js');
const PAGES = {
  today: (await import('../../site/app/pages/today.js')).TodayPage,
  events: (await import('../../site/app/pages/events.js')).EventsPage,
  checklist: (await import('../../site/app/pages/checklist.js')).ChecklistPage,
  bosses: (await import('../../site/app/pages/bosses.js')).BossesPage,
  mesos: (await import('../../site/app/pages/mesos.js')).MesosPage,
  gear: (await import('../../site/app/pages/gear.js')).GearPage,
  progress: (await import('../../site/app/pages/progress.js')).ProgressPage,
  settings: (await import('../../site/app/pages/settings.js')).SettingsPage,
  characters: (await import('../../site/app/pages/characters.js')).CharactersPage
};

const load = (name, fallback = null) => { try { return JSON.parse(readFileSync(dataFile(`${name}.json`), 'utf8')); } catch { return fallback; } };
// Nexon's own post titles can contain words the page checks look for (an event called "Infinity Festival"). The
// feed files are refreshed every 6 hours, so those words are blanked out here: the checks are about our code.
const feed = (name) => { const raw = load(name); return raw && JSON.parse(JSON.stringify(raw).replace(/undefined|NaN|Infinity|\[object/g, 'X')); };
// A copy of a data file with every ISO date moved by `ms`.
function shiftDates(obj, ms) {
  return JSON.parse(JSON.stringify(obj), (k, v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(Date.parse(v) + ms).toISOString() : v));
}
function loadData(overrides = {}) {
  const data = {
    bosses: load('bosses'), symbols: load('symbols'), liberation: load('liberation'), ibp: load('ibp'), checklist: load('checklist'),
    gear: load('gear'), erda: load('erda'), upgrades: load('upgrades'), potential: load('potential'), gearStats: load('gearstats'),
    events: feed('events'), news: feed('news'), nexonCharacters: load('characters'), meta: load('meta'), tables: load('tables'), season: load('season'),
    pitched: load('pitched'), shops: load('shops'), flames: load('flames'), champions: load('champions'), expSources: load('expsources'), upcoming: load('upcoming'), bossCp: load('bosscp'), classes: load('classes'),
    ...overrides
  };
  data.events = data.events || { events: [] };
  data.events.events = dedupeEvents(data.events.events || []);
  data.events.sunny = Array.isArray(data.events.sunny) ? data.events.sunny : [];
  data.news = data.news || { items: [] };
  data.nexonCharacters = data.nexonCharacters || { characters: [] };
  data.bossById = Object.fromEntries(data.bosses.bosses.map((b) => [b.id, b]));
  return data;
}
const DATA = loadData();

const BAD = /undefined|NaN|\[object|Infinity/;
// Preact sets a flag like checked/disabled as a property when the node has one and as an attribute otherwise.
const flag = (node, name) => node[name] === true || (name in node.attrs && node.attrs[name] !== 'false');
const mounted = [];
after(() => { for (const el of mounted) render(null, el); });

// Renders one page for the current store state, lets effects run, and returns the root node.
async function show(name, data = DATA) {
  const el = new FakeNode('div');
  mounted.push(el);
  const Page = PAGES[name];
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

async function renderAll(label, data = DATA) {
  for (const name of Object.keys(PAGES)) {
    let el;
    try {
      el = await show(name, data);
    } catch (err) {
      assert.fail(`${label}: ${name} threw: ${err.stack.split('\n').slice(0, 3).join(' | ')}`);
    }
    const text = el.text.replace(/\s+/g, ' ');
    assert.ok(text.length > 40, `${label}: ${name} rendered almost nothing`);
    const bad = text.match(new RegExp(`.{0,70}(${BAD.source}).{0,70}`));
    assert.equal(bad, null, `${label}: ${name} shows "${bad && bad[0]}"`);
    close(el);
  }
}

const now = Date.now();
// The reset keys are recomputed whenever a test state is built, so a run that crosses a reset (00:00 UTC) stays
// consistent. `now` stays fixed so two calls build identical states.
let today = periodKey('daily', now);
let week = periodKey('thu', now);
function freshKeys() {
  today = periodKey('daily', Date.now());
  week = periodKey('thu', Date.now());
}

function richState() {
  freshKeys();
  const pot = DATA.potential;
  const find = (text) => pot.lines.findIndex((l) => l[0] === text);
  return {
    v: 1,
    characters: [
      { id: 'main', name: 'Main', cls: 'Erel Light', level: 264, region: 'na', world: 'heroic', challenger: true, mainStat: 'STR', beyondBurning: true },
      { id: 'mule', name: 'Mule', cls: 'Hero', level: 210, region: 'na', world: 'heroic', challenger: false, mainStat: 'STR' },
      { id: 'da', name: 'Avenger', cls: 'Demon Avenger', level: 262, region: 'na', world: 'interactive', challenger: false, mainStat: 'HP' },
      { id: 'xen', name: 'Xen', cls: 'Xenon', level: null, region: 'eu', world: 'heroic', quanah: true, mainStat: 'XENON' }
    ],
    activeId: 'main',
    checklist: {
      items: { 'main|d-ursus': { p: today, d: 1 }, 'main|d-shadow': { p: today, c: 4, d: 0 }, 'main|d-bosses_cyg': { p: today, d: 1 }, 'w-mayrin': { p: week, d: 1 }, 'mule|d-ursus': { p: today, d: 1 }, 'd-sauna': { p: today, d: 1 } },
      resets: { 'w-mp': 'thu' }, flags: { 'main|arcus': true, 'mule|lvl:d-cernium': true }, owner: 'main',
      history: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [new Date(now - i * 86400000).toISOString().slice(0, 10), { done: i % 3 ? 9 : 4, total: 9 }]))
    },
    bosses: {
      main: { picks: { 'lucid-hard': { party: 1 }, 'will-hard': { party: 2 }, 'zakum-chaos': { party: 1 }, 'cygnus-normal': { party: 1 } }, clears: { 'lucid-hard': { [week]: true }, 'cygnus-normal': { [today]: true } } },
      mule: { picks: { 'zakum-chaos': { party: 1 } }, clears: {} }
    },
    symbols: { main: { cernium: { level: 7, have: 30 }, arcus: { level: 1, have: 0 } }, mule: {} },
    liberation: { main: { genesis: { stage: 2, traces: 300, picks: { 'lotus-hard': true, 'damien-hard': true }, pass: true } } },
    ibp: { main: { stage: 3 } },
    pitch: { main: { drops: [{ id: 'p1', item: 'berserked', d: '2026-10-03' }, { id: 'p2', item: 'dreamy-belt', d: '2026-11-01' }] } },
    shops: { 'alliance-credit': { have: 5000, claims: 10, want: { 'sol-erda': 2, 'black-rebirth-flame': 200 } } },
    champions: { slots: [{ name: 'Main', rank: 2 }, { name: 'Mule', rank: 2 }, { name: 'Third', rank: 0 }], raid: { '2026-10': 900000000, [new Date(now).toISOString().slice(0, 7)]: 1200000000 } },
    erda: { main: { template: 'erel', levels: { lugh: 3, origin: 1 }, steps: {} }, mule: { template: 'erel', levels: {}, steps: {} } },
    gear: {
      main: {
        preset: 'mid', stats: { main: 40000, sub: 5000, att: 5000, mainPct: 300, attPct: 100 },
        history: [{ d: new Date(now - 9 * 86400000).toISOString().slice(0, 10), pct: 0.2 }, { d: new Date(now).toISOString().slice(0, 10), pct: 0.35 }],
        slots: {
          weapon: { tier: 2, note: 'Fafnir Penitent Tears', ilvl: 150, itemId: 1402196, iconVer: '270', stars: 17, pot: 4, potLines: [{ pid: find('Damage to Boss Monsters +40%'), prime: true, text: 'Damage to Boss Monsters +40%', type: 'boss', value: 40 }, { type: 'att', value: 13 }, { type: '' }], flame: { att: 120, boss: 12, dmg: 6 } },
          hat: { tier: 2, note: 'Royal Warrior Helm', ilvl: 150, stars: 17, pot: 4, potLines: [{ type: 'main', stat: 'STR', value: 13 }, { type: 'offstat', value: 13 }], flame: { main: 80, allstat: 5 }, target: { stars: 22 } },
          top: { tier: 2, note: 'Eagle Eye Warrior Armor', ilvl: 150, stars: 22, pot: 3, lines: 2 },
          bottom: { tier: 2, note: 'Trixter Warrior Pants', ilvl: 150, stars: 12, pot: 2 },
          gloves: { tier: 1, ilvl: 140, stars: 10, pot: 1, temporary: true },
          ring1: { tier: 2, note: 'Superior Gollux Ring', ilvl: 150, stars: 12, pot: 4, potLines: [{ type: 'meso', value: 20 }, { type: 'drop', value: 20 }] },
          ring2: { tier: 1, ilvl: 100, stars: 0, pot: 0 },
          face: { tier: 3, note: 'Berserked', ilvl: 160, stars: 22, pot: 4 },
          pocket: { tier: 2, note: 'Pink Holy Cup', ilvl: 140 },
          emblem: { tier: 2, ilvl: 100, pot: 4 },
          heart: { tier: 3, note: 'Black Heart', ilvl: 120, stars: 5, pot: 2 }
        }
      },
      da: { preset: 'late', slots: { hat: { tier: 4, ilvl: 200, stars: 22, pot: 4, potLines: [{ pid: find('MaxHP +{v}%'), prime: true, text: 'MaxHP +12%', type: 'main', stat: 'HP', value: 12 }] }, weapon: { tier: 3, ilvl: 250, stars: 25, pot: 3 } }, stats: { main: 900000, att: 4000 }, history: [] }
    },
    level: { main: { log: [{ t: now - 6 * 86400000, level: 263, pct: 40 }, { t: now - 86400000, level: 264, pct: 12.5 }] }, mule: { log: [{ t: now, level: 210, pct: 0 }] } },
    mesos: { held: 3.2e9, goals: [{ id: 'g1', name: '200 Bright Cubes', cost: 4.4e9 }, { id: 'g2', name: 'Free thing', cost: 0 }], ursus: 9e7, ursusRuns: 3, farmPerHour: 2.5e8, farmHours: 6, other: null },
    incomeHistory: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [new Date(now - i * 7 * 86400000).toISOString().slice(0, 10), { earned: 1e9 * i, planned: 5e9 }])),
    ui: { hideClassic: true, lastSeenNews: now - 86400000, eventsView: 'timeline', sessionMins: 90, todaySales: true, hiddenEvents: {}, seasonDone: { 'spend-coins': true } },
    updatedAt: now - 1000
  };
}

// The state as the very first version saved it: no stamps, no per-character ticks, lines without pid.
function firstVersionState() {
  freshKeys();
  return {
    v: 1,
    characters: [{ id: 'old1', name: 'Oldie', cls: 'Erel Light', level: 264, world: 'heroic', challenger: true }],
    activeId: 'old1',
    checklist: { items: { 'd-ursus': { p: today, d: 1 }, 'd-bosses_cyg': { p: today, d: 1 }, 'w-crest': { p: week, c: 3, d: 0 } }, resets: {}, flags: { arcus: true }, history: {} },
    bosses: { old1: { picks: { 'lucid-hard': { party: 1 } }, clears: {} } },
    symbols: {}, liberation: {}, ibp: {}, erda: { old1: { template: 'erel', levels: {}, steps: {} } },
    gear: { old1: { preset: 'mid', slots: { hat: { tier: 2, stars: 17, pot: 4, potLines: [{ type: 'main', stat: 'STR', value: 13 }, { type: 'cdr', value: 2 }], note: 'my hat' } }, history: [] } },
    level: {}, mesos: { held: 1e9, goals: [], ursus: 3.6e7, ursusRuns: 3 }, incomeHistory: {},
    ui: { hideClassic: true, lastSeenNews: 0, eventsView: 'timeline' },
    updatedAt: now - 5000
  };
}

test('every page renders for an empty tracker', async () => {
  store.replaceState(store.blankState(), true);
  await renderAll('empty');
});

test('every page renders for data saved by the first version, and nothing saved is lost', async () => {
  store.replaceState(firstVersionState(), true);
  const s = store.getState();
  assert.equal(s.characters[0].name, 'Oldie');
  assert.equal(s.checklist.owner, 'old1', 'old ticks are credited to the character that was active');
  assert.equal(s.gear.old1.slots.hat.potLines.length, 2);
  assert.ok(Object.keys(s.stamps).length > 0, 'parts are stamped for sync');
  await renderAll('first version');
  // The old ticks still show as done for that character.
  const el = await show('checklist');
  const done = el.findAll((n) => n.attrs.class && n.attrs.class.split(' ').includes('done')).map((n) => n.text);
  assert.ok(done.some((t) => t.includes('Ursus: one run')), 'the Ursus tick from before the update is still ticked');
  close(el);
  const gear = await show('gear');
  assert.match(gear.text, /my hat/);
  close(gear);
});

test('every page renders for a full tracker, for each character in turn', async () => {
  store.replaceState(richState(), true);
  for (const id of ['main', 'mule', 'da', 'xen']) {
    store.update((s) => { s.activeId = id; });
    await renderAll(`full, as ${id}`);
  }
});

test('every page renders when optional data files are missing', async () => {
  store.replaceState(richState(), true);
  await renderAll('no optional data', loadData({ events: null, news: null, nexonCharacters: null, meta: null, tables: null, season: null }));
  await renderAll('job reported errors', loadData({ meta: { checkedAt: new Date(now - 40 * 3600000).toISOString(), ok: false, errors: ['news: HTTP 403', 'post 1: timeout'], itemsError: 'boom' } }));
});

test('Today shows the right things for the right character', async () => {
  store.replaceState(richState(), true);
  // The season card only shows before the season's last deadline, so this uses a season that is still running.
  const season = load('season');
  const running = loadData({ season: shiftDates(season, Date.now() + 30 * 86400000 - Date.parse(season.ends)) });
  let el = await show('today', running);
  let text = el.text.replace(/\s+/g, ' ');
  assert.match(text, /Today · Main/);
  assert.match(text, /Challenger World Season 4 ends/);
  assert.match(text, /Best next upgrade/i);
  assert.match(text, /Core dailies/i);
  close(el);
  store.update((s) => { s.activeId = 'mule'; });
  el = await show('today', running);
  text = el.text.replace(/\s+/g, ' ');
  assert.match(text, /Today · Mule/);
  assert.doesNotMatch(text, /Season 4 ends/, 'the season card is only for Challenger characters');
  close(el);
});

test('the gear editor opens for every slot of every character, including old and damaged entries', async () => {
  store.replaceState(richState(), true);
  for (const id of ['main', 'da', 'mule', 'xen']) {
    store.update((s) => { s.activeId = id; });
    const el = await show('gear');
    const tiles = el.findAll((n) => n.localName === 'button' && /: edit$/.test(n.attrs['aria-label'] || ''));
    assert.equal(tiles.length, DATA.gear.slots.length, `${id}: one tile per slot`);
    for (let i = 0; i < tiles.length; i++) {
      const tile = el.findAll((n) => n.localName === 'button' && /: edit$/.test(n.attrs['aria-label'] || ''))[i];
      const label = tile.attrs['aria-label'];
      tile.fire('click');
      await tick(5);
      const modal = el.find((n) => n.attrs.role === 'dialog');
      assert.ok(modal, `${id}: ${label} opened`);
      const text = modal.text.replace(/\s+/g, ' ');
      const bad = text.match(new RegExp(`.{0,70}(${BAD.source}).{0,70}`));
      assert.equal(bad, null, `${id}: ${label} shows "${bad && bad[0]}"`);
      modal.find((n) => n.localName === 'button' && n.attrs['aria-label'] === 'Close').fire('click');
      await tick(5);
      assert.equal(el.find((n) => n.attrs.role === 'dialog'), null, `${id}: ${label} closed`);
    }
    close(el);
  }
});

test('ticking a checklist box saves it for the active character only', async () => {
  store.replaceState(richState(), true);
  store.update((s) => { s.activeId = 'mule'; s.checklist.items = {}; });
  const el = await show('checklist');
  const row = el.find((n) => n.localName === 'input' && n.attrs.id === 'cl-d-coupon');
  assert.ok(row, 'the coupon checkbox is there');
  row.checked = true;
  row.fire('change', { currentTarget: row });
  await tick(5);
  assert.deepEqual(Object.keys(store.getState().checklist.items), ['mule|d-coupon']);
  close(el);
});

test('Today ticks dailies and bosses directly, with the same ticks as Checklist and Bosses', async () => {
  store.replaceState(richState(), true);
  const el = await show('today');
  // The daily boss (Normal Cygnus) is a chip of "Daily bosses", so the boss list holds the three weekly ones.
  assert.match(el.text.replace(/\s+/g, ' '), /Do today \d+ \/ \d+ dailies · 1 \/ 3 bosses/);
  const daily = el.find((n) => n.localName === 'input' && n.attrs.id === 'cl-d-coupon');
  assert.ok(daily, 'a core daily can be ticked on Today');
  daily.checked = true;
  daily.fire('change', { currentTarget: daily });
  const boss = el.find((n) => n.localName === 'input' && n.attrs.id === 'today-boss-will-hard');
  assert.ok(boss && !flag(boss, 'checked'), 'an uncleared boss is listed unticked');
  assert.ok(flag(el.find((n) => n.attrs.id === 'today-boss-lucid-hard'), 'checked'), 'a cleared boss is listed ticked');
  boss.fire('change', { currentTarget: boss });
  await tick(5);
  const s = store.getState();
  assert.equal(s.checklist.items['main|d-coupon'].d, 1);
  assert.equal(s.bosses.main.clears['will-hard'][week], true);
  close(el);
  const again = await show('today');
  assert.match(again.text.replace(/\s+/g, ' '), /2 \/ 3 bosses/);
  close(again);
  // A character with no bosses picked gets a pointer instead of an empty list.
  store.update((x) => { x.activeId = 'da'; });
  const el2 = await show('today');
  assert.match(el2.text.replace(/\s+/g, ' '), /No bosses picked yet/);
  close(el2);
});

test('Gear: the equipment window and the list show the same slots, and the star stepper saves', async () => {
  store.replaceState(richState(), true);
  const el = await show('gear');
  const tilesOf = () => el.findAll((n) => n.localName === 'button' && /: edit$/.test(n.attrs['aria-label'] || ''));
  const inWindow = tilesOf().map((n) => n.attrs['aria-label']).sort();
  assert.ok(tilesOf().every((n) => n.attrs.class.split(' ').includes('wslot')), 'the window is the first view');
  el.find((n) => n.localName === 'button' && n.text.trim() === 'List').fire('click');
  await tick(5);
  assert.ok(tilesOf().every((n) => n.attrs.class.split(' ').includes('equip')));
  assert.deepEqual(tilesOf().map((n) => n.attrs['aria-label']).sort(), inWindow);
  tilesOf().find((n) => n.attrs['aria-label'] === 'Hat: edit').fire('click');
  await tick(5);
  const modal = el.find((n) => n.attrs.role === 'dialog');
  const before = store.getState().gear.main.slots.hat.stars || 0;
  modal.find((n) => n.localName === 'button' && n.attrs['aria-label'] === 'One more: Hat stars').fire('click');
  await tick(5);
  assert.equal(store.getState().gear.main.slots.hat.stars, before + 1);
  await until(() => el.find((n) => n.attrs.role === 'dialog')?.find((n) => n.localName === 'button' && /^Max \d+★$/.test(n.text.trim())));
  const max =el.find((n) => n.attrs.role === 'dialog').find((n) => n.localName === 'button' && /^Max \d+★$/.test(n.text.trim()));
  max.fire('click');
  await tick(5);
  assert.equal(store.getState().gear.main.slots.hat.stars, Number(max.text.match(/\d+/)[0]));
  assert.ok(await until(() => flag(el.find((n) => n.attrs.role === 'dialog').find((n) => n.attrs['aria-label'] === 'One more: Hat stars'), 'disabled')), 'no step past the item’s maximum');
  close(el);
});

test('a change saved in the instant after a page first draws still shows', async () => {
  store.replaceState(richState(), true);
  const el = new FakeNode('div');
  mounted.push(el);
  const App = () => html`<${PAGES.bosses} data=${DATA} state=${store.useStore()} />`;
  render(html`<${App} />`, el);
  // No wait here: the page has drawn but is not listening to the store yet.
  store.update((s) => { s.activeId = 'mule'; });
  assert.ok(await until(() => /Mule: tick clears/.test(el.text)), 'the page redraws for the character picked during that gap');
  close(el);
});

test('Bosses logs pitched drops for the active character, and removes them', async () => {
  store.replaceState(richState(), true);
  const el = await show('bosses');
  assert.match(el.text.replace(/\s+/g, ' '), /2 of 11 Pitched · 0 of 6 Brilliant/);
  el.find((n) => n.localName === 'button' && n.attrs['aria-label'] === 'Got one: Oath of Death').fire('click');
  await tick(5);
  const drops = store.getState().pitch.main.drops;
  assert.equal(drops.length, 3);
  assert.equal(drops[2].item, 'oath-of-death');
  assert.match(drops[2].d, /^\d{4}-\d{2}-\d{2}$/);
  close(el);
  const again = await show('bosses');
  assert.match(again.text.replace(/\s+/g, ' '), /2 of 11 Pitched · 1 of 6 Brilliant/);
  again.find((n) => n.localName === 'button' && /^Remove the Berserked drop/.test(n.attrs['aria-label'] || '')).fire('click');
  await tick(5);
  assert.deepEqual(store.getState().pitch.main.drops.map((d) => d.item), ['dreamy-belt', 'oath-of-death']);
  close(again);
  // Another character starts with an empty log of its own.
  store.update((s) => { s.activeId = 'mule'; });
  const mule = await show('bosses');
  assert.match(mule.text.replace(/\s+/g, ' '), /0 of 11 Pitched · 0 of 6 Brilliant/);
  mule.find((n) => n.localName === 'button' && n.attrs['aria-label'] === 'Got one: Berserked').fire('click');
  await tick(5);
  assert.equal(store.getState().pitch.mule.drops.length, 1);
  assert.equal(store.getState().pitch.main.drops.length, 2);
  close(mule);
});

test('Events > Coin shop plans picks against coins, and hides items for the other world type', async () => {
  const s = richState();
  s.ui = { ...(s.ui || {}), eventsView: 'shops' };
  store.replaceState(s, true);
  // A fixed copy of one shop first (the live file changes with Nexon's posts); several shops are tested below.
  const every = loadData().shops.shops;
  const data = loadData({ shops: JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/shops.json', import.meta.url)), 'utf8')) });
  data.shops.shops[0].end = new Date(Date.now() + 30 * 86400000).toISOString(); // keep the shop open whenever the test runs
  const el = await show('events', data);
  const text = el.text.replace(/\s+/g, ' ');
  assert.match(text, /Alliance Credit Shop/);
  assert.match(text, /your picks cost 18,000 Alliance Credit/); // 2 Sol Erda + 200 Black Rebirth Flames
  assert.match(text, /Black Rebirth Flame/);
  assert.doesNotMatch(text, /Innocence Scroll/); // Interactive only; the active character is Heroic
  assert.equal(text.match(BAD), null);
  el.find((n) => n.localName === 'button' && n.attrs['aria-label'] === 'One more: Still to buy: Sol Erda').fire('click');
  await tick(5);
  assert.equal(store.getState().shops['alliance-credit'].want['sol-erda'], 3);
  close(el);
  const again = await show('events', data);
  assert.ok(flag(again.find((n) => n.attrs['aria-label'] === 'One more: Still to buy: Sol Erda'), 'disabled'), 'the shop limit of 3 is the most you can pick');
  close(again);
  // A closed shop says so instead of planning.
  data.shops.shops[0].end = '2020-01-01T00:00:00Z';
  const closed = await show('events', data);
  assert.match(closed.text.replace(/\s+/g, ' '), /This shop closed on/);
  close(closed);
  // An Interactive character sees the Interactive-only items.
  store.update((x) => { x.activeId = 'da'; });
  data.shops.shops[0].end = new Date(Date.now() + 30 * 86400000).toISOString();
  const inter = await show('events', data);
  assert.match(inter.text.replace(/\s+/g, ' '), /Innocence Scroll/);
  assert.doesNotMatch(inter.text.replace(/\s+/g, ' '), /Black Rebirth Flame/);
  close(inter);
  // Several shops open at once: a picker switches between them, and Challenger World shops are only
  // offered to a Challenger World character.
  const soon = new Date(Date.now() + 30 * 86400000).toISOString();
  const shop = (id, name, extra = {}) => ({ id, name, currency: 'Test Coin', start: '2020-01-01T00:00:00Z', end: soon, items: [{ id: 'thing', name: `${name} item`, cost: 7, limit: null }], ...extra });
  const many = loadData({ shops: { source: 'Test.', shops: [shop('a', 'First Shop'), shop('b', 'Second Shop', { note: 'Check this tab in game.' }), shop('c', 'Challenger World Shop: Normal'), shop('old', 'Old Shop', { end: '2020-02-01T00:00:00Z' })] } });
  store.update((x) => { x.activeId = 'mule'; x.ui.shopId = null; });
  let el2 = await show('events', many);
  let t2 = el2.text.replace(/\s+/g, ' ');
  assert.match(t2, /Shop \(2 open\)/);
  assert.match(t2, /First Shop item/);
  assert.match(t2, /limit none/);
  assert.match(t2, /How Test Coin is earned is not listed here/);
  assert.doesNotMatch(t2, /Challenger World Shop|Old Shop/);
  assert.equal(t2.match(BAD), null);
  const pick = el2.find((n) => n.attrs.id === 'shop-pick');
  pick.value = 'b';
  pick.fire('change', { currentTarget: pick });
  await tick(5);
  assert.equal(store.getState().ui.shopId, 'b');
  close(el2);
  el2 = await show('events', many);
  t2 = el2.text.replace(/\s+/g, ' ');
  assert.match(t2, /Second Shop item/);
  assert.match(t2, /Check this tab in game\./);
  close(el2);
  store.update((x) => { x.activeId = 'main'; });
  el2 = await show('events', many);
  assert.match(el2.text.replace(/\s+/g, ' '), /Shop \(3 open\)/);
  close(el2);
  // The real file as the job writes it draws for every shop in it.
  for (const s of every) {
    store.update((x) => { x.ui.shopId = s.id; });
    const real = await show('events', loadData());
    assert.equal(real.text.replace(/\s+/g, ' ').match(BAD), null, s.id);
    close(real);
  }
});

test('Mesos > Flames gives an answer for every character and every setting, and never prints junk', async () => {
  for (const id of ['main', 'mule', 'da', 'xen']) {
    for (const calc of [undefined, { slot: 'hat', level: 150, adv: true, type: 'reset', target: 100, have: 200 }, { type: 'burning', adv: false, level: 30, target: 5 },
      { type: 'abyssal', level: 250, target: 9999 }, { type: 'nope', level: null, target: null, weights: { att: 'x', allstat: -3 }, secondary: 7 }, { level: 0, target: 0, have: 0, weights: null }]) {
      const s = richState();
      s.activeId = id;
      s.ui = { ...(s.ui || {}), mesosView: 'flames', flameCalc: calc };
      store.replaceState(s, true);
      const el = await show('mesos');
      const text = el.text.replace(/\s+/g, ' ');
      const bad = text.match(new RegExp(`.{0,70}(${BAD.source}).{0,70}`));
      assert.equal(bad, null, `${id} ${JSON.stringify(calc)} shows "${bad && bad[0]}"`);
      assert.match(text, /Flame calculator/);
      if (id === 'da') assert.match(text, /not worked out for Max HP/);
      else if (calc && calc.target === 9999) assert.match(text, /No flame can reach 9999/);
      else assert.match(text, /Chance per flame/);
      close(el);
    }
  }
  // Picking your own item fills in its level and aims one point above its flame (hat: 80 STR + 5% All Stats = 130).
  const s = richState();
  s.ui = { ...(s.ui || {}), mesosView: 'flames' };
  store.replaceState(s, true);
  const el = await show('mesos');
  const pick = el.find((n) => n.attrs.id === 'flame-slot');
  pick.value = 'hat';
  pick.fire('change', { currentTarget: pick });
  await tick(5);
  assert.deepEqual([store.getState().ui.flameCalc.slot, store.getState().ui.flameCalc.level, store.getState().ui.flameCalc.target], ['hat', 150, 131]);
  close(el);
});

test('Bosses suggests a weekly list from Combat Power and marks what is out of reach', async () => {
  store.replaceState(richState(), true);
  let el = await show('bosses');
  let text = el.text.replace(/\s+/g, ' ');
  assert.match(text, /What your Combat Power can enter/);
  assert.match(text, /Type the Combat Power from your Character Info window/);
  assert.match(text, /Entry from 18M Combat Power/); // every boss with a figure shows it
  assert.doesNotMatch(text, /Above your Combat Power/);
  close(el);
  // 5M: Hard Lucid (18M) and Hard Will (20M) are picked but out of reach. Will is a party pick, so only Lucid is called out.
  store.update((s) => { s.characters.find((c) => c.id === 'main').cp = 5000000; });
  el = await show('bosses');
  text = el.text.replace(/\s+/g, ' ');
  assert.match(text, /1 boss you run solo asks for more than that: Hard Lucid \(18M\)/);
  assert.match(text, /Above your Combat Power: asks for 18M/);
  assert.match(text, /Suggested weekly list \d+ bosses · [\d.]+[MB] a week/);
  assert.match(text, /Hard Lotus/); // 5M is exactly Hard Lotus's minimum
  assert.equal(text.match(BAD), null);
  el.find((n) => n.localName === 'button' && n.text.trim() === 'Use this list').fire('click');
  await tick(5);
  const picks = store.getState().bosses.main.picks;
  assert.ok(picks['lotus-hard'] && picks['lucid-normal'], 'the reachable difficulties are picked');
  assert.equal(picks['lucid-hard'], undefined, 'the solo pick above your power is dropped');
  assert.deepEqual(picks['will-hard'], { party: 2 }, 'a party pick is left alone');
  assert.ok(picks['cygnus-normal'], 'a daily boss is left alone');
  close(el);
  el = await show('bosses');
  text = el.text.replace(/\s+/g, ' ');
  assert.match(text, /Your list matches this/);
  assert.doesNotMatch(text, /you run solo ask/);
  // Asking for more room shrinks the list, and the filter hides what is above your power.
  const margin = el.find((n) => n.attrs.id === 'boss-margin');
  margin.value = '2';
  margin.fire('change', { currentTarget: margin });
  await tick(5);
  assert.equal(store.getState().ui.bossMargin, 2);
  close(el);
  el = await show('bosses');
  assert.match(el.text.replace(/\s+/g, ' '), /with 2× room/);
  assert.match(el.text.replace(/\s+/g, ' '), /asks for 10M/); // Hard Lotus: 5M × 2
  const rowsBefore = el.findAll((n) => n.localName === 'input' && /^pick-/.test(n.attrs.id || '')).length;
  const only = el.find((n) => n.attrs.id === 'only-reach');
  only.checked = true;
  only.fire('change', { currentTarget: only });
  await tick(5);
  const rowsAfter = el.findAll((n) => n.localName === 'input' && /^pick-/.test(n.attrs.id || '')).length;
  assert.ok(rowsAfter < rowsBefore, `${rowsAfter} rows are fewer than ${rowsBefore}`);
  close(el);
  // Another character has no Combat Power typed in and gets no suggestion.
  store.update((s) => { s.activeId = 'mule'; });
  el = await show('bosses');
  assert.match(el.text.replace(/\s+/g, ' '), /Type the Combat Power from your Character Info window/);
  close(el);
});

test('a decimal typed into a stars box is saved as a whole number and no page breaks', async () => {
  store.replaceState(richState(), true);
  const el = await show('gear');
  el.find((n) => n.localName === 'button' && n.attrs['aria-label'] === 'Hat: edit').fire('click');
  await tick(5);
  const box = el.find((n) => n.attrs.role === 'dialog').find((n) => n.localName === 'input' && n.attrs['aria-label'] === 'Hat stars');
  box.value = '2.5';
  box.fire('input', { currentTarget: box });
  await tick(5);
  assert.equal(store.getState().gear.main.slots.hat.stars, 3);
  close(el);
  // Even if a decimal is already in saved data (an older copy, an import), every page still draws.
  const s = richState();
  s.gear.main.slots.hat.stars = 2.5;
  s.gear.main.slots.hat.target = { stars: 21.5 };
  s.ui = { ...(s.ui || {}), sfCalc: { level: 160, from: 2.5, to: 12.5 }, mesosView: 'starforce' };
  store.replaceState(s, true);
  assert.equal(store.getState().gear.main.slots.hat.stars, 2);
  await renderAll('decimal stars');
});

test('Progress > Champions tracks slots, ranks and the raid score for the whole account', async () => {
  const s = richState();
  s.ui = { ...(s.ui || {}), progressView: 'champions' };
  store.replaceState(s, true);
  const el = await show('progress');
  const text = el.text.replace(/\s+/g, ' ');
  assert.match(text, /3 of 3 open slots used/); // two rank-A Champions open the third slot
  assert.match(text, /All Stats \+40 · Max HP\/MP \+2,000 · ATT \+20/);
  assert.match(text, /Slot 4 opens when your first 3 Champions are all rank A or higher/);
  assert.match(text, /Next, rank B: Solo Hard Lotus/);
  assert.match(text, /October 2026: 900M/);
  assert.equal(text.match(BAD), null);
  // Raising the third Champion to rank A opens the fourth slot.
  el.find((n) => n.attrs.role === 'group' && n.attrs['aria-label'] === 'Rank of slot 3' || n.attrs['aria-label'] === 'Rank of slot 3').find((n) => n.localName === 'button' && n.text.trim() === 'A').fire('click');
  await tick(5);
  assert.equal(store.getState().champions.slots[2].rank, 2);
  close(el);
  const again = await show('progress');
  assert.match(again.text.replace(/\s+/g, ' '), /3 of 4 open slots used/);
  close(again);
  // Same list whichever character is on screen.
  store.update((x) => { x.activeId = 'mule'; });
  const mule = await show('progress');
  assert.match(mule.text.replace(/\s+/g, ' '), /3 of 4 open slots used/);
  close(mule);
});

test('Progress > Level shows what Monster Park and potions are worth, and Today lists what is coming', async () => {
  const s = richState();
  s.ui = { ...(s.ui || {}), progressView: 'level' };
  store.replaceState(s, true);
  const el = await show('progress');
  const text = el.text.replace(/\s+/g, ' ');
  assert.match(text, /Where EXP comes from at Lv\. 264/);
  assert.match(text, /2 clears a day of Cernium: 37\.5B EXP each/);
  assert.match(text, /Growth Potion \(200 - 269\), Growth Potion \(200 - 279\)/);
  assert.equal(text.match(BAD), null);
  close(el);
  // A level-210 character has no share of a level (the EXP table starts at 260) but still gets the dungeon.
  store.update((x) => { x.activeId = 'mule'; });
  const mule = await show('progress');
  assert.match(mule.text.replace(/\s+/g, ' '), /Chu Chu Island/);
  assert.equal(mule.text.replace(/\s+/g, ' ').match(BAD), null);
  close(mule);
  // Today: dates that have not passed are listed; a list with nothing left shows no card.
  const future = new Date(Date.now() + 9 * 86400000).toISOString();
  const data = loadData({ upcoming: { source: 'Test source.', items: [{ id: 'a', at: future, title: 'Test patch arrives', note: 'A note.' }, { id: 'b', at: future, title: 'Challenger thing', note: 'Only there.', only: 'challenger' }, { id: 'c', at: '2020-01-01T00:00:00Z', title: 'Long gone', note: 'Old.' }] } });
  const today = await show('today', data);
  const t = today.text.replace(/\s+/g, ' ');
  assert.match(t, /Coming to GMS/);
  assert.match(t, /Test patch arrives/);
  assert.match(t, /in 9 days/);
  assert.doesNotMatch(t, /Challenger thing|Long gone/); // the active character is not in Challenger World
  close(today);
  store.update((x) => { x.activeId = 'main'; });
  const main = await show('today', data);
  assert.match(main.text.replace(/\s+/g, ' '), /Challenger thing/);
  close(main);
  const none = await show('today', loadData({ upcoming: { items: [] }, events: { events: [] } }));
  assert.doesNotMatch(none.text.replace(/\s+/g, ' '), /Coming to GMS/);
  close(none);
  // An event from Nexon's posts that has not started yet is listed without anyone typing it in.
  const soon = new Date(Date.now() + 3 * 86400000).toISOString();
  const later = new Date(Date.now() + 30 * 86400000).toISOString();
  const ev = (id, title, category, extra = {}) => ({ id, title, start: soon, end: later, category, postName: 'A Nexon post', ...extra });
  const auto = await show('today', loadData({ upcoming: { items: [] }, events: { events: [ev('1', 'Winter Festival', 'events'), ev('2', 'Lucky Box Sale', 'sale'), ev('3', 'Server check', 'maintenance'), ev('4', 'Classic thing', 'events', { isClassic: true })] } }));
  const a = auto.text.replace(/\s+/g, ' ');
  assert.match(a, /Coming to GMS/);
  assert.match(a, /Winter Festival starts/);
  assert.match(a, /in 3 days/);
  assert.doesNotMatch(a, /Lucky Box Sale starts|Server check starts|Classic thing starts/);
  close(auto);
});

test('Mesos calculators show the 50 to 95% spread, and Gear ranks a flame reroll once stats are entered', async () => {
  for (const view of ['starforce', 'cubes']) {
    const s = richState();
    s.ui = { ...(s.ui || {}), mesosView: view };
    store.replaceState(s, true);
    const el = await show('mesos');
    const text = el.text.replace(/\s+/g, ' ');
    assert.match(text, /To be this sure/);
    assert.match(text, /95%/);
    assert.equal(text.match(BAD), null, view);
    close(el);
  }
  store.replaceState(richState(), true);
  const gear = await show('gear');
  const text = gear.text.replace(/\s+/g, ' ');
  assert.match(text, /Star Force and flames by damage per meso/);
  assert.match(text, /Hat: reroll the flame \(score 130 now\): about \+/);
  assert.equal(text.match(BAD), null);
  close(gear);
});

test('a setting edit stamps only that setting, so entries added on another device are kept', async () => {
  const { mergeStates } = await import('../../site/app/calc/merge.js');
  store.replaceState(richState(), true);
  const start = structuredClone(store.getState());
  store.update((s) => { s.ui.bossMargin = 2; s.mesos.held = 7; });
  const st = store.getState().stamps;
  assert.ok(st['ui/bossMargin'] > 0 && st['mesos/held'] > 0);
  assert.notEqual(st.ui, st['ui/bossMargin'], 'the old whole-part stamp is not moved');
  // The other device added a goal and hid an event before this device's edit: both survive the merge.
  const other = structuredClone(start);
  other.mesos.goals.push({ id: 'gx', name: 'Other', cost: 5 });
  other.ui.hiddenEvents = { ...(other.ui.hiddenEvents || {}), ex: true };
  other.stamps = { ...other.stamps, 'mesos/goals/gx': st['mesos/held'] - 1000, 'mesos/goalOrder': st['mesos/held'] - 1000, 'ui/hiddenEvents/ex': st['mesos/held'] - 1000 };
  other.updatedAt = st['mesos/held'] - 1000;
  for (const m of [mergeStates(store.getState(), other), mergeStates(other, store.getState())]) {
    assert.ok(m.mesos.goals.some((g) => g.id === 'gx'));
    assert.equal(m.ui.hiddenEvents.ex, true);
    assert.equal(m.mesos.held, 7);
    assert.equal(m.ui.bossMargin, 2);
  }
  // Clear all data leaves no change times at all, so a reconnect downloads the synced copy.
  store.resetState();
  assert.deepEqual(store.getState().stamps, {});
  assert.equal(store.getState().updatedAt, 0);
  assert.equal(store.getState().characters.length, 0);
});

test('meso boxes keep the exact amount unless you type, and put it back when the text makes no sense', async () => {
  const { MesoInput, parseMesos } = await import('../../site/app/ui.js');
  const got = [];
  const el = new FakeNode('div');
  mounted.push(el);
  render(html`<${MesoInput} label="Amount" value=${44960000} onChange=${(v) => got.push(v)} />`, el);
  await tick(5);
  const box = el.find((n) => n.localName === 'input');
  assert.equal(box.attrs.value ?? box.value, '45M');
  box.fire('blur', { currentTarget: box });
  await tick(5);
  assert.deepEqual(got, [], 'leaving without typing saves nothing');
  for (const same of ['45m', '45 M', '45M']) {
    box.value = same;
    box.fire('input', { currentTarget: box });
    box.fire('blur', { currentTarget: box });
    await tick(5);
  }
  assert.deepEqual(got, [], 'retyping the shown amount in any form keeps the exact one');
  box.value = 'abc';
  box.fire('input', { currentTarget: box });
  box.fire('blur', { currentTarget: box });
  await tick(5);
  assert.deepEqual(got, [], 'unreadable text is not saved');
  box.value = '1.5 billion';
  box.fire('input', { currentTarget: box });
  box.fire('blur', { currentTarget: box });
  await tick(5);
  assert.deepEqual(got, [1.5e9]);
  box.value = '';
  box.fire('input', { currentTarget: box });
  box.fire('blur', { currentTarget: box });
  await tick(5);
  assert.deepEqual(got, [1.5e9, null], 'an emptied box clears the amount');
  close(el);
  assert.equal(parseMesos('.5b'), 5e8);
  assert.equal(parseMesos('5.'), 5);
  assert.equal(parseMesos('1e9'), null);
});

test('Use this list respects party picks and no-crystal bosses, and matches once pressed', async () => {
  const s = richState();
  s.characters.find((c) => c.id === 'main').cp = 45e6;
  s.bosses.main.picks = { 'lotus-normal': { party: 3 }, 'kai-normal': { party: 1 }, 'lucid-hard': { party: 1 } };
  store.replaceState(s, true);
  let el = await show('bosses');
  el.find((n) => n.localName === 'button' && n.text.trim() === 'Use this list').fire('click');
  await tick(5);
  const picks = store.getState().bosses.main.picks;
  assert.deepEqual(picks['lotus-normal'], { party: 3 }, 'the party Lotus stays');
  assert.equal(picks['lotus-hard'], undefined, 'and no second Lotus is added');
  assert.ok(picks['kai-normal'], 'Kai (no crystal) is left alone');
  close(el);
  el = await show('bosses');
  assert.match(el.text.replace(/\s+/g, ' '), /Your list matches this/);
  close(el);
});

test('Progress pages: weekly symbols shown, level from Characters, gates from today, and below Lv. 260', async () => {
  const s = richState();
  s.ui = { ...(s.ui || {}), progressView: 'symbols' };
  store.replaceState(s, true);
  let el = await show('progress');
  assert.match(el.text.replace(/\s+/g, ' '), /Per week/);
  assert.ok(el.find((n) => n.attrs['aria-label'] === 'Chu Chu Island symbols per week'));
  close(el);
  // The main character is Lv. 264 with no log; a level typed later is used for the gates.
  store.update((x) => { x.ui.progressView = 'level'; x.characters.find((c) => c.id === 'main').level = 268; });
  el = await show('progress');
  let t = el.text.replace(/\s+/g, ' ');
  assert.match(t, /Now Lv\. 268 up to /); // no EXP % is shown for a level that came without one
  assert.match(t, /from Characters/);
  close(el);
  // A Lv. 210 character is told where the EXP figures start, not that it is past them.
  store.update((x) => { x.activeId = 'mule'; });
  el = await show('progress');
  t = el.text.replace(/\s+/g, ' ');
  assert.match(t, /EXP figures start at Lv\. 260/);
  assert.doesNotMatch(t, /past the EXP table/);
  close(el);
});

test('level gates: days count from today, a passed date says "due", and Beyond Burning stops at its end', async () => {
  const { levelOutlook } = await import('../../site/app/pages/level.js');
  const nowT = Date.parse('2026-11-25T00:00:00Z');
  const char = { id: 'c', level: 264, beyondBurning: true };
  const reading = (daysAgo, level, pct) => ({ t: nowT - daysAgo * 86400000, level, pct });
  const st = { level: { c: { log: [reading(10, 264, 10), reading(8, 264, 70)] } } };
  const data = { ...DATA, events: { events: [{ title: 'Beyond Burning', end: '2027-02-09T23:59:00Z' }] } };
  const o = levelOutlook(data, st, char, nowT);
  const g265 = o.gates.find((g) => g.level === 265);
  assert.ok(g265.due, 'the reading eight days ago says Lv. 265 should already be reached');
  assert.equal(g265.days, 0);
  assert.equal(o.burnUntil, Date.parse('2027-02-09T23:59:00Z'));
  // After the event ends, gates are worked out without the free levels.
  const later = levelOutlook(data, { level: { c: { log: [reading(-80, 266, 0), reading(-81, 266, 50)] } } }, char, Date.parse('2027-02-20T00:00:00Z'));
  assert.equal(later.beyond, false);
});

test('deleting a mistyped reading puts the level back to the latest real one, Nexon readings included', async () => {
  const s = richState();
  const main = s.characters.find((c) => c.id === 'main');
  main.level = 284; // the typo, set by "Log it"
  s.level = { main: { log: [{ t: Date.now() - 1000, level: 284, pct: 10 }] } };
  s.ui = { ...(s.ui || {}), progressView: 'level' };
  store.replaceState(s, true);
  const data = loadData({ nexonCharacters: { characters: [{ name: 'Main', level: 264, history: [{ t: Date.now() - 86400000, level: 263, exp: 0 }, { t: Date.now() - 3600000, level: 264, exp: 0 }] }] } });
  const el = await show('progress', data);
  el.find((n) => n.localName === 'button' && n.attrs['aria-label'] === 'Delete this reading').fire('click');
  await tick(5);
  assert.equal(store.getState().characters.find((c) => c.id === 'main').level, 264);
  close(el);
});

test('Today saves the week to income history through the app-wide keeper', async () => {
  const { IncomeKeeper } = await import('../../site/app/pages/bosses.js');
  const s = richState();
  s.incomeHistory = {};
  store.replaceState(s, true);
  const el = new FakeNode('div');
  mounted.push(el);
  render(html`<${IncomeKeeper} data=${DATA} state=${store.getState()} />`, el);
  assert.ok(await until(() => Object.keys(store.getState().incomeHistory).length === 1), 'a week is saved without opening Bosses');
  close(el);
});

test('deleting the only character removes its old-format ticks but keeps account-wide ones', async () => {
  const s = firstVersionState();
  s.checklist.items['w-mayrin'] = { p: week, d: 1 }; // account-wide
  store.replaceState(s, true);
  assert.equal(store.getState().checklist.owner, 'old1');
  const el = await show('characters');
  el.find((n) => n.localName === 'button' && n.text.trim() === 'Delete').fire('click');
  await tick(5);
  el.find((n) => n.localName === 'button' && n.text.trim() === 'Delete for good').fire('click');
  await tick(5);
  const after = store.getState().checklist;
  assert.deepEqual(Object.keys(after.items), ['w-mayrin']);
  assert.deepEqual(after.flags, {});
  assert.equal(after.owner, null);
  close(el);
});

test('small wording fixes: Item Burning out of reach, last shop day, tiny flame chances, Demon Avenger stars', async () => {
  const s = richState();
  s.ui = { ...(s.ui || {}), progressView: 'ibp', eventsView: 'shops', mesosView: 'flames', flameCalc: { level: 200, target: 400, type: 'black', adv: true } };
  s.ibp = { main: { done: {}, crests: 0 } };
  store.replaceState(s, true);
  const soon = new Date(Date.now() + 10 * 86400000).toISOString();
  let el = await show('progress', loadData({ ibp: { ...load('ibp'), endsAt: soon, weeklyCrests: 10 } }));
  assert.match(el.text.replace(/\s+/g, ' '), /left before it ends: out of reach/);
  close(el);
  const shops = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/shops.json', import.meta.url)), 'utf8'));
  shops.shops[0].end = new Date(Date.now() + 5 * 3600000).toISOString();
  el = await show('events', loadData({ shops }));
  const t = el.text.replace(/\s+/g, ' ');
  assert.match(t, /closes (today|tomorrow)/);
  assert.doesNotMatch(t, /1 days/);
  close(el);
  el = await show('mesos');
  const f = el.text.replace(/\s+/g, ' ');
  assert.doesNotMatch(f, /\de-\d/, 'no exponent form');
  close(el);
  store.update((x) => { x.activeId = 'da'; x.ui.mesosView = 'planner'; });
  el = await show('gear');
  el.find((n) => n.localName === 'button' && n.attrs['aria-label'] === 'Hat: edit').fire('click');
  await tick(5);
  assert.match(el.text.replace(/\s+/g, ' '), /Stars give each stat \(not Max HP\)/);
  close(el);
});

// A seeded generator so a failure can be reproduced.
function rng(seed) { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }
const JUNK = [null, undefined, -1, 0, 1e15, NaN, 'abc', '', [], {}, true];
function damage(obj, rand, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return;
  for (const key of Object.keys(obj)) {
    const roll = rand();
    if (roll < 0.04) delete obj[key];
    else if (roll < 0.09) obj[key] = JUNK[Math.floor(rand() * JUNK.length)];
    else damage(obj[key], rand, depth + 1);
  }
}

test('damaged saved data never crashes a page (120 random cases)', async () => {
  const failures = [];
  let current = 0;
  const onUncaught = (err) => { failures.push(`seed ${current}: an effect threw: ${err.message} @ ${(String(err.stack).split('\n')[1] || '').trim().slice(0, 110)}`); };
  process.on('uncaughtException', onUncaught);
  const cases = Number(process.env.FUZZ) || 120; // FUZZ=1000 node --test ... for a longer hunt
  for (let seed = 1; seed <= cases; seed++) {
    current = seed;
    const rand = rng(seed);
    const raw = seed % 2 ? richState() : firstVersionState();
    damage(raw, rand);
    raw.v = 1;
    // Every third case opens the flame calculator and the coin shop instead of the default views.
    if (seed % 3 === 0 && raw.ui && typeof raw.ui === 'object' && !Array.isArray(raw.ui)) { raw.ui.mesosView = 'flames'; raw.ui.eventsView = 'shops'; raw.ui.progressView = 'champions'; }
    if (seed % 3 === 1 && raw.ui && typeof raw.ui === 'object' && !Array.isArray(raw.ui)) { raw.ui.mesosView = seed % 2 ? 'cubes' : 'starforce'; }
    try {
      store.replaceState(structuredClone(raw), true);
    } catch (err) {
      failures.push(`seed ${seed}: loading threw: ${err.message}`);
      continue;
    }
    for (const name of Object.keys(PAGES)) {
      let el;
      try {
        el = await show(name);
        const bad = el.text.replace(/\s+/g, ' ').match(new RegExp(`.{0,50}(${BAD.source}).{0,50}`));
        if (bad) failures.push(`seed ${seed}: ${name} shows "${bad[0]}"`);
      } catch (err) {
        failures.push(`seed ${seed}: ${name} threw: ${err.message} @ ${(err.stack.split('\n')[1] || '').trim().slice(0, 110)}`);
      } finally {
        if (el) close(el);
      }
    }
  }
  await tick(20);
  process.off('uncaughtException', onUncaught);
  assert.deepEqual(failures.slice(0, 25), [], `${failures.length} failures`);
});

test('the loader leaves good data alone and repairs bad data', async () => {
  const { sanitiseState } = await import('../../site/app/calc/sanitise.js');
  const base = store.blankState();
  for (const make of [richState, firstVersionState]) {
    const once = sanitiseState(make(), base);
    const twice = sanitiseState(structuredClone(once), base);
    assert.deepEqual(twice, once, 'cleaning is stable');
    const raw = make();
    // Everything the user entered is still there.
    assert.deepEqual(once.characters.map((c) => [c.id, c.name, c.cls, c.level]), raw.characters.map((c) => [c.id, c.name, c.cls, c.level ?? null]));
    assert.deepEqual(once.checklist.items, raw.checklist.items);
    assert.deepEqual(once.bosses, raw.bosses);
    assert.deepEqual(once.symbols, raw.symbols);
    assert.deepEqual(once.liberation, raw.liberation);
    assert.deepEqual(once.erda, raw.erda);
    assert.deepEqual(once.level, raw.level);
    assert.deepEqual(once.incomeHistory, raw.incomeHistory);
    assert.deepEqual(once.mesos.goals, raw.mesos.goals);
    for (const [cid, g] of Object.entries(raw.gear)) {
      assert.deepEqual(once.gear[cid].stats, g.stats);
      assert.deepEqual(once.gear[cid].history, g.history);
      for (const [sid, e] of Object.entries(g.slots)) {
        const got = once.gear[cid].slots[sid];
        for (const k of ['tier', 'stars', 'pot', 'ilvl', 'note', 'itemId', 'flame', 'target', 'lines']) assert.deepEqual(got[k], e[k], `${cid}.${sid}.${k}`);
        assert.deepEqual((got.potLines || []).filter((l) => l.type), (e.potLines || []).filter((l) => l && l.type), `${cid}.${sid} lines`);
      }
    }
  }
  // Wrong kinds of values are reset, not passed on.
  const bad = sanitiseState({ v: 1, characters: [{ id: 'a', name: 5, level: 9999 }, { id: 'a', name: 'dupe' }, 'x', { name: 'no id' }], activeId: 'zzz', checklist: { items: true, history: [1], flags: 'no' }, gear: { a: { slots: { hat: { stars: 'many', potLines: 'none', flame: { main: -5, att: 'x' } }, top: 7 }, history: 'x' }, b: 3 }, mesos: { goals: 'none', held: -1 }, ui: 'x', bosses: [], level: { a: { log: [{ t: 'now' }, 5] } }, updatedAt: 'yesterday', stamps: { x: 'y', ok: 5 } }, base);
  assert.deepEqual(bad.characters.map((c) => [c.id, c.name, c.level]), [['a', '', null]]);
  assert.equal(bad.activeId, 'a');
  assert.deepEqual([bad.checklist.items, bad.checklist.history, bad.checklist.flags], [{}, {}, {}]);
  assert.deepEqual(bad.gear, { a: { preset: 'mid', slots: { hat: { potLines: [] } }, history: [] } });
  assert.deepEqual([bad.mesos.goals, bad.mesos.held, bad.bosses, bad.level.a.log, bad.updatedAt, bad.stamps], [[], 0, {}, [], 0, { ok: 5 }]);
  assert.equal(bad.ui.hideClassic, true);
  assert.deepEqual(sanitiseState('junk', base), base);
});

test('a character with no level typed in is not locked out of level-gated dailies', async () => {
  const { knownLevel } = await import('../../site/app/pages/level.js');
  assert.equal(knownLevel(DATA, { level: {} }, { id: 'x', name: 'X', level: null }), undefined);
  assert.equal(knownLevel(DATA, { level: {} }, { id: 'x', name: 'X', level: '' }), undefined);
  assert.equal(knownLevel(DATA, { level: { x: { log: [{ t: 1, level: 262, pct: 0 }] } } }, { id: 'x', name: 'X', level: 260 }), 262);
  const raw = richState();
  raw.activeId = 'xen'; // the test Xenon has no level
  store.replaceState(raw, true);
  const el = await show('checklist');
  const cernium = el.find((n) => n.localName === 'input' && n.attrs.id === 'cl-d-cernium');
  assert.ok(cernium, 'Cernium daily is listed');
  assert.equal(flag(cernium, 'disabled'), false, 'and is not locked');
  // The same box is locked for a character known to be under Lv. 260, so the check above means something.
  close(el);
  store.update((x) => { x.activeId = 'mule'; x.checklist.flags = {}; });
  const el2 = await show('checklist');
  assert.equal(flag(el2.find((n) => n.localName === 'input' && n.attrs.id === 'cl-d-cernium'), 'disabled'), true);
  close(el2);
});

test('the old shared checklist gets one owner, once', async () => {
  // First load after the update: the active character takes the old ticks.
  store.replaceState(firstVersionState(), true);
  assert.deepEqual([store.getState().checklist.owner, store.getState().checklist.ownerSet], ['old1', true]);
  // Deleting the owner clears it, and a reload does not hand its ticks to someone else.
  const s = structuredClone(store.getState());
  s.characters.push({ id: 'alt', name: 'Alt' });
  s.characters = s.characters.filter((c) => c.id !== 'old1');
  s.activeId = 'alt';
  s.checklist.owner = null;
  store.replaceState(s, true);
  assert.equal(store.getState().checklist.owner, null);
  // An owner that no longer exists (for example after a sync) is dropped.
  const t = structuredClone(store.getState());
  t.checklist.owner = 'ghost';
  store.replaceState(t, true);
  assert.equal(store.getState().checklist.owner, null);
  // A brand-new tracker: ticks made before the first character belong to that character.
  const { applySetup } = await import('../../site/app/calc/setup.js');
  store.replaceState(store.blankState(), true);
  freshKeys();
  store.update((x) => { x.checklist.items['d-coupon'] = { p: today, d: 1 }; });
  store.update((x) => { applySetup(x, { name: 'First', level: 264 }, [], 'first'); });
  assert.equal(store.getState().checklist.owner, 'first');
  const el = await show('checklist');
  const box = el.find((n) => n.localName === 'input' && n.attrs.id === 'cl-d-coupon');
  assert.equal(flag(box, 'checked'), true, 'the tick made before setup is still shown');
  close(el);
});
