// Seventh round, checklist rows and symbol data: Epic Dungeon on its Thursday reset, Etherion and Specter Blast on
// Wednesday and account-wide, the Arcane River weekly and Erda's Request rows, dailies that bank up made optional,
// the Sol Erda holding cap, the Etherion Relic symbol hint, and meso offers in sale posts kept apart from NX sales.
// Every time here is fixed; nothing depends on today's date or on a redraw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeNode, installFakeBrowser } from './lib/fake-dom.mjs';

const siteFile = (name) => fileURLToPath(new URL(`../../site/${name}`, import.meta.url));
installFakeBrowser({ files: {} });

const { html, render } = await import('../../site/vendor/htm-preact.mjs');
const { periodKey } = await import('../../site/app/time.js');
const { itemStatus, recordKey, resetOf } = await import('../../site/app/calc/checklist.js');
const { dailyProgress } = await import('../../site/app/pages/checklist.js');
const { solErdaCap } = await import('../../site/app/calc/upgrades.js');
const { endingSoon, isCashSale } = await import('../../site/app/calc/events.js');
const { eventStarts } = await import('../../site/app/calc/upcoming.js');
const { relicNote } = await import('../../site/app/pages/progress.js');
const { ErdaCosts } = await import('../../site/app/pages/level.js');
const { parsePost, isMesoOffer } = await import('../../scripts/lib/nexon-parse.mjs');

const load = (name) => JSON.parse(readFileSync(siteFile(`data/${name}.json`), 'utf8'));
const checklist = load('checklist');
const at = (iso) => Date.parse(iso);
const groupOf = (id) => checklist.groups.find((g) => g.items.some((i) => i.id === id));
const itemOf = (id) => groupOf(id).items.find((i) => i.id === id);
const cs = (items = {}, resets = {}) => ({ items, resets, flags: {}, history: {}, owner: null, ownerSet: true });
const MAIN = { id: 'main', level: 264, challenger: true };

test('rows: Epic Dungeon resets Thursday per character, Etherion and Specter Blast are Wednesday and account-wide', () => {
  assert.equal(groupOf('w-high').reset, 'thu');
  const high = itemOf('w-high');
  assert.equal(high.minLevel, 260, 'Nexon: Epic Dungeons open at Lv. 260');
  assert.notEqual(high.scope, 'account', 'one clear a week per character (wiki), not one per account');
  assert.match(high.note, /Angler Company \(from Lv\. 270/);
  assert.match(high.note, /Nightmare Paradise \(from Lv\. 280/);
  assert.doesNotMatch(high.note, /only one of/i);
  assert.doesNotMatch(high.note, /multiplier/i, 'the bonus tiers are Interactive only');
  for (const id of ['w-etherion', 'w-specter']) {
    assert.equal(groupOf(id).reset, 'wed', id);
    assert.equal(itemOf(id).scope, 'account', id);
  }
  assert.equal(itemOf('w-specter').minLevel, 260);
  assert.equal(itemOf('w-mp').minLevel, 260);
  assert.equal(itemOf('w-pass').minLevel, 260);
  assert.equal(itemOf('d-sauna').until, '2027-06-08T23:59:00Z');
});

test('rows: the Arcane River weekly and Erda\'s Request rows exist with a pill reset day, and no id repeats', () => {
  const ids = checklist.groups.flatMap((g) => g.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length, 'every id once');
  const arcane = itemOf('w-arcane-weekly');
  assert.equal(groupOf('w-arcane-weekly').reset, 'custom');
  assert.equal(arcane.def, 'mon');
  assert.equal(arcane.optional, true);
  assert.match(arcane.note, /240/);
  const erda = itemOf('w-erda-request');
  assert.equal(groupOf('w-erda-request').reset, 'custom');
  assert.notEqual(erda.scope, 'account', 'the once-per-account limit is not confirmed');
  assert.match(erda.note, /9 Sol Erda/);
  assert.match(erda.note, /player reports/, 'the Fragments figure is labelled');
  assert.equal(load('upgrades').erda.weeklyDefault.sol, 9, 'the planner and the row agree');
  // The symbol data agrees: one completion for 240 in the five areas that name a weekly.
  for (const area of load('symbols').arcane.areas) {
    assert.doesNotMatch(area.note, /up to 3 a week/, area.id);
    if (area.id !== 'vj') assert.equal(area.weekly, 240, area.id);
  }
});

test('rows: banked and self-collecting dailies are optional, so they never cost the streak', () => {
  const core = checklist.groups.find((g) => g.key === 'daily');
  for (const id of ['d-claim', 'd-shadow', 'd-seal', 'd-cards']) {
    assert.ok(!core.items.some((i) => i.id === id), `${id} is not a core daily`);
    assert.ok(groupOf(id).optional, `${id} is in an optional group`);
    assert.equal(groupOf(id).reset, 'daily', `${id} still resets daily, so today's tick stays`);
  }
  assert.match(itemOf('d-shadow').note, /up to 50/);
  assert.match(itemOf('d-seal').note, /up to 20/);
  assert.match(itemOf('d-claim').note, /5 times a week/);
  // Daily bosses still stay out of the core count.
  assert.ok(core.items.some((i) => i.bosses === 'daily'));

  const now = at('2026-11-27T12:00:00Z');
  const p = periodKey('daily', now);
  const tick = { p, t: now - 3600000, d: 1 };
  const coreIds = core.items.filter((i) => !i.bosses && !i.gate && !(i.minLevel > 264)).map((i) => i.id);
  // A day the live version saw complete (every old core daily ticked, the moved ones too) is still complete.
  const all = Object.fromEntries([...coreIds, 'd-seal', 'd-cards'].map((id) => [`main|${id}`, tick]));
  all['main|d-shadow'] = { p, t: now, c: 10, d: 1 };
  all['d-claim'] = tick;
  const full = dailyProgress(checklist, cs(all), now, MAIN);
  assert.ok(full.total > 0 && full.done === full.total, JSON.stringify(full));
  // A day that skips the wands, the cards, the supplies and the Supply Report is complete too.
  const skipped = Object.fromEntries(coreIds.map((id) => [`main|${id}`, tick]));
  const part = dailyProgress(checklist, cs(skipped), now, MAIN);
  assert.deepEqual(part, full);
});

test('ticks: an Epic Dungeon clear filed under the old Monday default still counts until Thursday\'s reset', () => {
  const group = groupOf('w-high');
  const item = itemOf('w-high');
  assert.equal(resetOf(item, group, cs()), 'thu');
  // Ticked Friday 27 Nov under the old default (Monday), as the live version saved it.
  const t = at('2026-11-27T10:00:00Z');
  const items = { 'main|w-high': { p: periodKey('mon', t), t, d: 1 } };
  for (const [when, done] of [['2026-11-29T12:00:00Z', true], ['2026-11-30T01:00:00Z', true], ['2026-12-02T23:59:00Z', true], ['2026-12-03T00:00:00Z', false]]) {
    assert.equal(itemStatus(item, group, cs(items), at(when), MAIN).done, done, when);
  }
  // A Monday pill the player had set no longer applies: the reset is Thursday now.
  assert.equal(itemStatus(item, group, cs(items, { 'w-high': 'mon' }), at('2026-11-30T01:00:00Z'), MAIN).done, true);
  // A tick from before the last Thursday reset does not count, and nor does one without a time.
  const before = at('2026-11-25T10:00:00Z');
  assert.equal(itemStatus(item, group, cs({ 'main|w-high': { p: periodKey('mon', before), t: before, d: 1 } }), at('2026-11-27T12:00:00Z'), MAIN).done, false);
  assert.equal(itemStatus(item, group, cs({ 'main|w-high': { p: periodKey('mon', t), d: 1 } }), at('2026-11-27T12:00:00Z'), MAIN).done, false);
  // A time that does not agree with the key it is filed under is not trusted.
  assert.equal(itemStatus(item, group, cs({ 'main|w-high': { p: 'mon:2026-11-02', t, d: 1 } }), at('2026-11-27T12:00:00Z'), MAIN).done, false);
  // A tick from the future (a device clock ahead) is not counted early.
  const later = at('2026-12-01T10:00:00Z');
  assert.equal(itemStatus(item, group, cs({ 'main|w-high': { p: periodKey('mon', later), t: later, d: 1 } }), at('2026-11-27T12:00:00Z'), MAIN).done, false);
  // Unticking writes the Thursday key, which wins.
  const now = at('2026-11-29T12:00:00Z');
  const unticked = { ...items, [recordKey(item, MAIN)]: { p: periodKey('thu', now), t: now, d: 0 } };
  assert.equal(itemStatus(item, group, cs(unticked), now, MAIN).done, false);
});

test('ticks: an Etherion or Specter Blast tick made on a character still counts once the row is account-wide', () => {
  for (const id of ['w-etherion', 'w-specter']) {
    const group = groupOf(id);
    const item = itemOf(id);
    const t = at('2026-11-26T10:00:00Z');
    const now = at('2026-11-28T10:00:00Z');
    const items = { [`main|${id}`]: { p: periodKey('wed', t), t, d: 1 } };
    assert.equal(recordKey(item, MAIN), id);
    assert.equal(itemStatus(item, group, cs(items), now, MAIN).done, true, `${id}: the main's tick`);
    assert.equal(itemStatus(item, group, cs(items), now, { id: 'alt', level: 264, challenger: true }).done, true, `${id}: shared with an alt`);
    assert.equal(itemStatus(item, group, cs(items), at('2026-12-02T00:00:00Z'), MAIN).done, false, `${id}: cleared at the Wednesday reset`);
    // The account's own tick for this week (here an untick) replaces it.
    const off = { ...items, [id]: { p: periodKey('wed', now), t: now, d: 0 } };
    assert.equal(itemStatus(item, group, cs(off), now, MAIN).done, false, `${id}: unticked`);
  }
});

test('Sol Erda: the most a character can hold, by level (v.272)', () => {
  const table = load('upgrades').erda.holdCap;
  assert.deepEqual(table, [[260, 20], [275, 25], [290, 30]]);
  assert.equal(solErdaCap(259, table), null);
  assert.equal(solErdaCap(260, table), 20);
  assert.equal(solErdaCap(264, table), 20);
  assert.equal(solErdaCap(274, table), 20);
  assert.equal(solErdaCap(275, table), 25);
  assert.equal(solErdaCap(289, table), 25);
  assert.equal(solErdaCap(300, table), 30);
  assert.equal(solErdaCap(NaN, table), null);
  assert.equal(solErdaCap(264, undefined), null);
});

test('Sol Erda planner warns at the holding cap and says the cap otherwise', () => {
  const data = { upgrades: load('upgrades'), erda: load('erda') };
  const template = Object.values(data.erda.templates)[0];
  const draw = (char, entry) => {
    const el = new FakeNode('div');
    render(html`<${ErdaCosts} data=${data} char=${char} entry=${entry} template=${template} now=${at('2026-11-27T12:00:00Z')} />`, el);
    const text = el.text.replace(/\s+/g, ' ');
    render(null, el);
    return text;
  };
  assert.match(draw({ id: 'main', level: 264 }, { solErda: 20 }), /You hold 20 Sol Erda, the most a Lv\. 264 character can hold \(20\)/);
  assert.match(draw({ id: 'main', level: 264 }, { solErda: 15 }), /A week's Sol Erda would take you past 20/);
  assert.match(draw({ id: 'main', level: 264 }, { solErda: 2 }), /A Lv\. 264 character can hold up to 20 Sol Erda/);
  assert.match(draw({ id: 'main', level: 276 }, { solErda: 2 }), /up to 25 Sol Erda/);
  assert.doesNotMatch(draw({ id: 'alt', level: 210 }, {}), /can hold/);
});

test('symbols: the Etherion Relic hint shows only while the event runs', () => {
  const bonus = load('symbols').relicBonus;
  assert.deepEqual([bonus.arcane, bonus.sacred], [4, 3]);
  const el = new FakeNode('div');
  render(relicNote(bonus, at('2026-12-01T00:00:00Z')), el);
  assert.match(el.text, /4 Arcane and 3 Sacred symbols a day/);
  assert.match(el.text, /KST/);
  render(null, el);
  assert.equal(relicNote(bonus, at('2027-02-10T00:00:00Z')), null);
  assert.equal(relicNote(undefined, at('2026-12-01T00:00:00Z')), null);
});

test('events: a meso-priced offer in a sale post is not hidden with the Cash Shop sales', () => {
  const post = { id: 90001, name: 'Black Friday', category: 'sale', liveDate: '2026-11-22T16:00:00Z' };
  const body = `<h3>Glowing and Bright Cubes</h3><p>UTC: Friday, November 27 8:00 AM - Saturday, November 28 7:59 AM</p>
    <p>Available in Heroic worlds only:</p><p>Glowing Cube (30)</p><p>Price: 360,000,000 mesos 270,000,000 mesos</p>
    <h3>Outfit Package</h3><p>UTC: Friday, November 27 8:00 AM - Saturday, November 28 7:59 AM</p><p>Price: 5,900 NX</p>
    <h3>Meso Pack Deal</h3><p>UTC: Friday, November 27 8:00 AM - Saturday, November 28 7:59 AM</p><p>Price: 3,000 NX for 100,000,000 mesos</p>`;
  const events = parsePost(post, body);
  assert.deepEqual(events.map((e) => [e.title, Boolean(e.mesos)]), [['Glowing and Bright Cubes', true], ['Outfit Package', false], ['Meso Pack Deal', false]]);
  assert.ok(!('mesos' in events[1]), 'other events keep their shape');
  assert.equal(isMesoOffer({ category: 'events' }, 'Price: 100 mesos'), false, 'only sale posts');
  const [cubes, outfit] = events;
  assert.equal(isCashSale(cubes), false);
  assert.equal(isCashSale(outfit), true);
  const soon = endingSoon(events, at('2026-11-27T10:00:00Z'));
  assert.deepEqual(soon.shown.map((e) => e.title), ['Glowing and Bright Cubes']);
  assert.equal(soon.salesHidden, 2);
  assert.deepEqual(eventStarts(events).map((e) => e.title), ['Glowing and Bright Cubes starts']);
});
