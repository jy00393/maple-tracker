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
function loadData(overrides = {}) {
  const data = {
    bosses: load('bosses'), symbols: load('symbols'), liberation: load('liberation'), ibp: load('ibp'), checklist: load('checklist'),
    gear: load('gear'), erda: load('erda'), upgrades: load('upgrades'), potential: load('potential'), gearStats: load('gearstats'),
    events: load('events'), news: load('news'), nexonCharacters: load('characters'), meta: load('meta'), tables: load('tables'), season: load('season'),
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
const today = periodKey('daily', now);
const week = periodKey('thu', now);

function richState() {
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
  let el = await show('today');
  let text = el.text.replace(/\s+/g, ' ');
  assert.match(text, /Today · Main/);
  assert.match(text, /Challenger World Season 4 ends/);
  assert.match(text, /Best next upgrade/i);
  assert.match(text, /Core dailies/i);
  close(el);
  store.update((s) => { s.activeId = 'mule'; });
  el = await show('today');
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
  assert.match(el.text.replace(/\s+/g, ' '), /Do today \d+ \/ \d+ dailies · 2 \/ 4 bosses/);
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
  assert.match(again.text.replace(/\s+/g, ' '), /3 \/ 4 bosses/);
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
  store.update((x) => { x.checklist.items['d-coupon'] = { p: today, d: 1 }; });
  store.update((x) => { applySetup(x, { name: 'First', level: 264 }, [], 'first'); });
  assert.equal(store.getState().checklist.owner, 'first');
  const el = await show('checklist');
  const box = el.find((n) => n.localName === 'input' && n.attrs.id === 'cl-d-coupon');
  assert.equal(flag(box, 'checked'), true, 'the tick made before setup is still shown');
  close(el);
});
