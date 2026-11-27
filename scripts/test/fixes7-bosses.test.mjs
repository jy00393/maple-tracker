// Seventh round, boss area: entry levels for bosses (sourced), suggestions that never name a boss the character
// cannot enter, Kai as a mission clear, and "as of" dates that survive Import backup and Restore.
// Every test builds its own state and sets its own clock, and puts both back when it ends. Nothing sleeps for a
// fixed time: a test waits on the condition it needs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

installFakeBrowser({});
const { html, render, useEffect } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const { entryBlock } = await import('../../site/app/calc/income.js');
const { suggestBosses } = await import('../../site/app/calc/bosscp.js');
const { changedAt, carryAsOf, datedPath } = await import('../../site/app/calc/asof.js');
const { mergeStates, liveAsOf, stampOf } = await import('../../site/app/calc/merge.js');
const { sanitiseState } = await import('../../site/app/calc/sanitise.js');
const { itemStatus } = await import('../../site/app/calc/checklist.js');
const { dedupeEvents } = await import('../../site/app/calc/events.js');
const { BossesPage } = await import('../../site/app/pages/bosses.js');
const { whoFor: whoForState } = await import('../../site/app/pages/checklist.js');

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const bosses = load('bosses');
const cpData = load('bosscp');
const checklist = load('checklist');
const bossById = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const main = { id: 'a', name: 'Erel', level: 264, world: 'heroic', region: 'na', mainStat: 'STR', challenger: true, cp: 60e6 };
const alt = { id: 'b', name: 'Mule', level: 210, world: 'heroic', region: 'na', mainStat: 'STR', challenger: false, cp: 60e6 };
const DAY = 86400000;
const T0 = Date.parse('2026-11-27T03:00:00Z');
const itemOf = (id) => { for (const g of checklist.groups) { const i = g.items.find((x) => x.id === id); if (i) return [i, g]; } throw new Error('no item ' + id); };

const realNow = Date.now;
let clock = null;
Date.now = () => (clock === null ? realNow() : clock);
after(() => { Date.now = realNow; });
function at(t, time) {
  clock = time;
  t.after(() => { clock = null; store.resetState(); });
}
const setClock = (time) => { clock = time; };
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
  data.nexonCharacters = { characters: [] };
  data.bossById = bossById;
  return data;
}
const DATA = pageData();
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
const text = (el) => el.text.replace(/\s+/g, ' ');

// ---- entry levels (finding 27) ----

test('entry levels are in the data with their source', () => {
  for (const d of ['easy', 'normal', 'chaos', 'extreme']) assert.equal(bossById[`kalos-the-guardian-${d}`].minLevel, 265);
  for (const d of ['easy', 'normal', 'hard', 'extreme']) assert.equal(bossById[`first-adversary-${d}`].minLevel, 270);
  assert.equal(bossById['kai-normal'].minLevel, 235);
  assert.match(bosses.entryNote, /maplestorywiki\.net\/w\/Bosses/);
  assert.match(bosses.entryNote, /2026-11-27/);
  for (const b of bosses.bosses) {
    if (b.minLevel === undefined) continue;
    assert.ok(Number.isInteger(b.minLevel) && b.minLevel >= 1 && b.minLevel <= 300, b.id);
  }
  // Difficulties of one boss that share a clear never ask a lower level for a harder difficulty here.
  assert.ok(bossById['papulatus-chaos'].minLevel >= bossById['papulatus-normal'].minLevel);
});

test('suggestions never name a boss the character cannot enter', () => {
  const s = suggestBosses(bosses, cpData, 60e6, 1, main);
  assert.ok(s.ids.length > 0);
  for (const id of s.ids) assert.equal(entryBlock(bossById[id], main), null, id);
  assert.ok(!s.ids.some((id) => /^(kalos-the-guardian|first-adversary)-/.test(id)));
  assert.ok(s.locked > 0, 'the bosses left out for level are counted');
  // The total is what the listed crystals pay.
  const sum = s.list.reduce((a, x) => a + x.value, 0);
  assert.equal(s.total, sum);
  // At Lv. 270 with the same Combat Power, First Adversary opens if the Combat Power reaches it.
  const high = suggestBosses(bosses, cpData, 60e6, 1, { ...main, level: 270 });
  const unlocked = suggestBosses(bosses, cpData, 60e6, 1, { ...main, level: undefined });
  assert.deepEqual(high.ids.filter((id) => /^first-adversary-/.test(id)), unlocked.ids.filter((id) => /^first-adversary-/.test(id)));
  assert.equal(unlocked.locked, 0, 'an unknown level never locks');
});

test('the level passed by the page wins over the one on the character', () => {
  const byChar = suggestBosses(bosses, cpData, 1e12, 1, { ...main, level: 200 });
  const byWho = suggestBosses(bosses, cpData, 1e12, 1, { ...main, level: 200 }, [], { challenger: true, level: 300 });
  assert.ok(byChar.ids.every((id) => !bossById[id].minLevel || bossById[id].minLevel <= 200));
  assert.ok(byWho.ids.some((id) => bossById[id].minLevel > 264), 'at Lv. 300 the top bosses are suggested');
});

test('a Lv. 210 alt is offered only bosses open at 210', () => {
  const s = suggestBosses(bosses, cpData, 1e12, 1, alt);
  assert.ok(s.ids.length > 0);
  for (const id of s.ids) assert.ok(!bossById[id].minLevel || bossById[id].minLevel <= 210, id);
});

test('Bosses: the Combat Power card leaves out bosses above the level, and keeps an earlier pick', async (t) => {
  at(t, T0);
  const el = await show(t, BossesPage, (s) => {
    s.ui.bossMargin = 1;
    s.bosses = { a: { picks: { 'kalos-the-guardian-easy': { party: 1 } }, clears: {} } };
  });
  const card = text(el);
  const list = card.match(/Suggested weekly list(.*?)The best-paying/);
  assert.ok(list, 'the suggestion is shown');
  assert.doesNotMatch(list[1], /Kalos|First Adversary/);
  assert.match(card, /need a higher level; the next opens at Lv\. 265/);
  assert.match(card, /not open to Erel yet .*Easy Kalos the Guardian \(From Lv\. 265\)/);
  const button = el.find((n) => n.localName === 'button' && /Use this list/.test(n.text));
  assert.ok(button);
  button.fire('click');
  const picks = store.getState().bosses.a.picks;
  assert.ok(picks['kalos-the-guardian-easy'], 'a pick saved earlier stays picked');
  assert.equal(picks['first-adversary-easy'], undefined);
  for (const id of Object.keys(picks)) if (id !== 'kalos-the-guardian-easy') assert.equal(entryBlock(bossById[id], main), null, id);
  assert.ok(await until(() => /Your list matches this/.test(el.text)), 'pressing it once settles the list');
});

// ---- Kai (findings 3, 11) ----

test('Kai is a mission clear: optional, from Lv. 235, with Nexon\'s wording', () => {
  const [item, group] = itemOf('w-kai');
  assert.equal(item.optional, true);
  assert.equal(item.minLevel, 235);
  assert.match(item.note, /47305/);
  assert.match(item.note, /check in game/);
  assert.match(bossById['kai-normal'].note, /not stated/);
  const cs = { items: {}, resets: {}, flags: {}, history: {} };
  const who = (c) => whoForState(DATA, { ...store.blankState(), characters: [c] }, c);
  assert.equal(itemStatus(item, group, cs, T0, who(main)).locked, false);
  assert.ok(itemStatus(item, group, cs, T0, who({ ...main, level: 230 })).locked, 'locked below Lv. 235');
});

// ---- "as of" through Import and Restore (finding 28) ----

function typedAt(t, time, held = 3e9) {
  setClock(time);
  store.replaceState({ ...store.blankState(), characters: [{ ...main }], activeId: 'a' });
  store.update((s) => { s.mesos.held = held; s.shops.x = { have: 120, claims: {}, want: {} }; s.ibp.a = { crests: 500 }; });
  // The time the edit was given (a stamp never goes backwards, so it can be a step past the clock).
  return stampOf(store.getState().stamps, 'mesos/held');
}

test('Import backup keeps the day a figure was typed, and the import still wins for sync', (t) => {
  at(t, T0);
  const typed = typedAt(t, T0);
  const own = (p) => stampOf(store.getState().stamps, p);
  const typedShop = own('shops/x/have');
  const typedIbp = own('ibp/a/@');
  assert.ok(typedShop >= T0 && typedShop < T0 + DAY && typedIbp >= T0 && typedIbp < T0 + DAY);
  const exported = JSON.parse(JSON.stringify(store.getState()));
  setClock(T0 + 6 * DAY);
  store.replaceState(exported);
  const s = store.getState();
  assert.equal(changedAt(s, 'mesos/held'), typed);
  assert.equal(changedAt(s, 'shops/x/have'), typedShop);
  assert.equal(changedAt(s, 'ibp/a/@'), typedIbp);
  assert.ok(stampOf(s.stamps, 'mesos/held') >= T0 + 6 * DAY, 'the sync stamp moved, so the import wins');
  // An edit after it moves "as of" and drops the kept time.
  setClock(T0 + 7 * DAY);
  store.update((x) => { x.mesos.held = 4e9; });
  assert.equal(changedAt(store.getState(), 'mesos/held'), T0 + 7 * DAY);
  assert.equal(Object.hasOwn(store.getState().asOf, 'mesos/held'), false);
  assert.equal(changedAt(store.getState(), 'shops/x/have'), typedShop, 'other figures keep theirs');
  // Confirming the same figure moves it too.
  setClock(T0 + 8 * DAY);
  store.touch('shops/x/have');
  assert.equal(changedAt(store.getState(), 'shops/x/have'), T0 + 8 * DAY);
});

test('Import onto a cleared device, and an import of an import, keep the typed day', (t) => {
  at(t, T0);
  const typed = typedAt(t, T0);
  const first = JSON.parse(JSON.stringify(store.getState()));
  store.resetState();
  setClock(T0 + 3 * DAY);
  store.replaceState(first);
  const second = JSON.parse(JSON.stringify(store.getState()));
  setClock(T0 + 9 * DAY);
  store.replaceState(second);
  assert.equal(changedAt(store.getState(), 'mesos/held'), typed);
});

test('Restore of a safety copy keeps the typed day', (t) => {
  at(t, T0);
  const typed = typedAt(t, T0);
  setClock(T0 + 2 * DAY);
  store.snapshotNow('test copy');
  const copy = store.listBackups().find((b) => b.label === 'test copy');
  assert.ok(copy);
  setClock(T0 + 4 * DAY);
  assert.ok(store.restoreBackup(copy.at));
  assert.equal(changedAt(store.getState(), 'mesos/held'), typed);
});

test('"as of" kept by an import travels with sync and gives way to a newer edit elsewhere', (t) => {
  at(t, T0);
  const typed = typedAt(t, T0);
  const exported = JSON.parse(JSON.stringify(store.getState()));
  setClock(T0 + 5 * DAY);
  store.replaceState(exported);
  const imported = structuredClone(store.getState());
  // Another device, unchanged since the typing day: the import wins and its date comes along.
  const other = structuredClone(exported);
  const merged = mergeStates(other, imported, T0 + 5 * DAY);
  assert.equal(changedAt(merged, 'mesos/held', T0 + 5 * DAY), typed);
  assert.deepEqual(mergeStates(imported, other, T0 + 5 * DAY).asOf, merged.asOf, 'both directions agree');
  // A device that typed a new figure after the import: its edit wins, and so does its date.
  const edited = structuredClone(imported);
  edited.mesos.held = 5e9;
  edited.stamps['mesos/held'] = T0 + 6 * DAY;
  edited.asOf = liveAsOf(edited.asOf, edited.stamps, T0 + 6 * DAY);
  const after = mergeStates(imported, edited, T0 + 6 * DAY);
  assert.equal(after.mesos.held, 5e9);
  assert.equal(changedAt(after, 'mesos/held', T0 + 6 * DAY), T0 + 6 * DAY);
  assert.equal(Object.hasOwn(after.asOf, 'mesos/held'), false);
});

test('the asOf map is cleaned and bounded', () => {
  const clean = sanitiseState({ asOf: { 'mesos/held': { t: 'x', s: 2 }, __proto__: { t: 1, s: 2 }, ok: { t: 5, s: 9 }, bad: 3 } }, store.blankState());
  assert.deepEqual(clean.asOf, { ok: { t: 5, s: 9 } });
  // Entries that no longer match their stamp, or say the figure is newer than the import, are dropped.
  assert.deepEqual(liveAsOf({ a: { t: 5, s: 9 }, b: { t: 9, s: 5 } }, { a: 10, b: 5 }, T0), {});
  // Only the parts that show an "as of" date are kept.
  assert.equal(datedPath('mesos/held'), true);
  assert.equal(datedPath('shops/x/want/y'), false);
  assert.equal(datedPath('bosses/a/picks/zakum-easy'), false);
  const copy = { ...store.blankState(), characters: [{ ...main }], bosses: { a: { picks: { 'lucid-hard': { party: 1 } }, clears: {} } }, mesos: { ...store.blankState().mesos, held: 1 }, stamps: { 'mesos/held': T0, 'bosses/a/picks/lucid-hard': T0 } };
  const kept = carryAsOf(copy, { 'mesos/held': T0 + DAY, 'bosses/a/picks/lucid-hard': T0 + DAY }, T0 + DAY);
  assert.deepEqual(Object.keys(kept), ['mesos/held']);
});

test('a saved copy from the live version (no asOf) loads unchanged', (t) => {
  at(t, T0);
  const s = { ...store.blankState(), characters: [{ ...main }], activeId: 'a', stamps: { 'mesos/held': T0 }, updatedAt: T0 };
  delete s.asOf;
  s.mesos.held = 7;
  store.replaceState(s, true);
  assert.deepEqual(store.getState().asOf, {});
  assert.equal(changedAt(store.getState(), 'mesos/held'), T0);
});
