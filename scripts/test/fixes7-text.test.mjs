// Seventh round, what the screen says:
// - 15: the calendar feed leaves out Cash Shop sales, folds one post's same-minute ends into one entry, and adds
//   Sunny Sundays, the hand-typed dates (upcoming.json) and the season deadlines (season.json).
// - 36: Today's Sunny Sunday card shows every perk (the rest behind "+N more") with the notes that qualify it.
// - 37: slots that cannot have flames get no flame form, and a stray flame there is not counted.
// - 38, 39: no developer notes on screen; text follows the character (level locks, Challenger World only items,
//   HEXA Matrix or Erda Link wording, Beyond Burning only for gates reached while it runs).
// Every test builds its own state and sets its own clock. Nothing waits a fixed time for a redraw: a page is read
// once it listens to the store, and after a click the test waits for the change itself.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';
import { buildCalendar } from '../lib/ics.mjs';

installFakeBrowser({});
const { html, render, useEffect } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const { perkGroups } = await import('../../site/app/calc/sunny.js');
const { flameTotals } = await import('../../site/app/calc/gearstats.js');
const { itemStatus } = await import('../../site/app/calc/checklist.js');
const { TodayPage } = await import('../../site/app/pages/today.js');
const { ProgressPage } = await import('../../site/app/pages/progress.js');
const { GearPage } = await import('../../site/app/pages/gear.js');
const { levelOutlook } = await import('../../site/app/pages/level.js');
const { whoFor } = await import('../../site/app/pages/checklist.js');

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const DAY = 86400000;
const T0 = Date.parse('2026-11-27T03:00:00Z'); // Fri 27 Nov, 12:00 KST

// Game data without what the refresh job rewrites, so the tests read the same on any day.
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
const MAIN = { id: 'a', name: 'Erel', cls: 'Erel Light', level: 264, world: 'heroic', region: 'na', mainStat: 'STR', challenger: true, beyondBurning: true };
const ALT = { id: 'b', name: 'Alt', cls: 'Hero', level: 210, world: 'heroic', region: 'na', mainStat: 'STR', challenger: false, beyondBurning: false };

// A Sunny Sunday like 29 Nov 2026 (ten perks and their notes), dated the Sunday after `now`.
const PERKS = [
  '50% off Ability resets', 'Treasure Hunter EXP x3', '50% off Spell Trace Enhancements',
  '1+1 Star Force upon a successful enhancement at 10-Star or below.', 'Can reach up to 12 Stars. Excludes Superior Equipment.',
  '+250% Monster Park Clear EXP', 'Does not apply to the Extreme Monster Parker quest.',
  '[HEXA Matrix] When Main Stat is Lv. 5+, the enhancement chance is increased 20%.', 'Multiplied by the existing enhancement chance.',
  '5x chance to get Magnificent Soul from Soul Shards', '+100% chance to register a new monster in Monster Collection',
  'Mysterious Monsterbloom (x3): Untradable, Permanent .', 'Can be claimed 1 time per account.', 'Cannot be claimed in Challenger World.',
  'Elite monster appearance increase', 'Elite Monsters summoned by a Rune of Darkness or when an Elite Boss appears are not affected.'
];
const SF_PERKS = ['Shining Star Force Time', '30% off Star Force enhancements', 'Mesos used to safeguard are not eligible for the 30% discount.', '2x Sol Erda when hunting'];
const nextSunday = (now) => {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
};

const realNow = Date.now;
let clock = null;
Date.now = () => (clock === null ? realNow() : clock);
after(() => { Date.now = realNow; });
function at(t, time) {
  clock = time;
  store.resetState();
  t.after(() => { clock = null; store.resetState(); });
}
async function until(check, ms = 5000) {
  for (const end = realNow() + ms; realNow() < end;) { if (check()) return true; await tick(5); }
  return Boolean(check());
}
function start(mutate = () => {}, chars = [MAIN]) {
  store.update((s) => {
    s.characters = chars.map((c) => ({ ...c }));
    s.activeId = chars[0].id;
    mutate(s);
  });
}
async function mount(t, Page, data = DATA) {
  const el = new FakeNode('div');
  let listening = false;
  const App = () => {
    const state = store.useStore();
    useEffect(() => { listening = true; }, []);
    return html`<${Page} data=${data} state=${state} />`;
  };
  t.after(() => render(null, el));
  render(html`<${App} />`, el);
  assert.ok(await until(() => listening), 'the page listens to the store');
  return el;
}
const flat = (el) => el.text.replace(/\s+/g, ' ');
async function textOf(t, Page, data) {
  const el = await mount(t, Page, data);
  const text = flat(el);
  render(null, el);
  return text;
}

// ---------- 15: calendar feed ----------
const NOW = Date.parse('2026-11-27T03:00:00Z');
const ev = (o) => ({ id: 'p-x', title: 'Winter Countdown', start: '2026-11-11T00:00:00.000Z', end: '2026-12-10T23:59:00.000Z', startApprox: true, endApprox: false, resets: [],
  postId: 1, postName: 'Winter Countdown Event', liveDate: '2026-10-06T17:00:30Z', category: 'events', isClassic: false, url: 'https://www.nexon.com/maplestory/news/events/1', ...o });
const unfold = (ics) => ics.replace(/\r\n /g, '');
const vevents = (ics) => unfold(ics).split('BEGIN:VEVENT').slice(1).map((v) => v.split('END:VEVENT')[0]);
const field = (v, name) => (v.split('\r\n').find((l) => l.startsWith(name + ':') || l.startsWith(name + ';')) || '').replace(/^[^:]*:/, '');

test('calendar: Cash Shop sales are left out and one post\'s same-minute ends share one entry', () => {
  const ics = buildCalendar([
    ev({ id: 'sale-1', title: 'Black Friday Lucky Box', category: 'sale', postId: 9, postName: 'Cash Shop Update' }),
    ev({ id: 'season-a', title: 'Challenger World', postId: 5, postName: '[Update] Challenger World and Burning Events', end: '2027-02-09T23:59:00.000Z' }),
    ev({ id: 'season-b', title: 'Challenger Pass', postId: 5, postName: '[Update] Challenger World and Burning Events', end: '2027-02-09T23:59:00.000Z' }),
    ev({ id: 'season-c', title: 'Hyper Burning MAX', postId: 5, postName: '[Update] Challenger World and Burning Events', end: '2027-02-09T23:59:00.000Z' }),
    ev({ id: 'lone', title: 'Luxe Sauna', postId: 6, postName: 'v.272 notes', category: 'update' })
  ], NOW);
  assert.doesNotMatch(ics, /Lucky Box|Cash Shop Update/);
  const all = vevents(ics);
  const grouped = all.filter((v) => /UID:post-5-20270209T235900Z-end@maple-tracker/.test(v));
  assert.equal(grouped.length, 1, 'one entry for the three ends');
  assert.equal(field(grouped[0], 'SUMMARY'), 'Ends: 3 things from Challenger World and Burning Events');
  for (const title of ['Challenger World', 'Challenger Pass', 'Hyper Burning MAX']) assert.ok(field(grouped[0], 'DESCRIPTION').includes(title), title);
  assert.equal((grouped[0].match(/BEGIN:VALARM/g) || []).length, 1);
  // A lone end keeps the UID it always had, so subscribed calendars do not get a second copy.
  assert.ok(all.some((v) => /UID:lone-end@maple-tracker/.test(v) && field(v, 'SUMMARY') === 'Ends: Luxe Sauna'));
});

test('calendar: Sunny Sundays, announced dates and season deadlines, with stable UIDs', () => {
  const extra = {
    sunny: [
      { date: '2026-11-29', perks: PERKS },
      { date: '2026-12-06', perks: SF_PERKS },
      { date: '2026-11-22', perks: ['long gone'] }
    ],
    upcoming: load('upcoming'),
    season: load('season')
  };
  const ics = buildCalendar([], NOW, extra);
  const all = vevents(ics);
  const sunny = all.filter((v) => /UID:sunny-/.test(v));
  assert.equal(sunny.length, 2, 'past Sundays are dropped');
  const sf = sunny.find((v) => /UID:sunny-2026-12-06@/.test(v));
  assert.equal(field(sf, 'SUMMARY'), 'Sunny Sunday: 30% off Star Force enhancements');
  assert.equal(field(sf, 'DTSTART'), '20261206T000000Z');
  assert.equal(field(sf, 'DTEND'), '20261207T000000Z');
  assert.match(sf, /BEGIN:VALARM/, 'the Star Force Sunday has a reminder');
  const plain = sunny.find((v) => /UID:sunny-2026-11-29@/.test(v));
  assert.equal(field(plain, 'SUMMARY'), 'Sunny Sunday', 'no discount: no Star Force title');
  assert.doesNotMatch(plain, /VALARM/);
  assert.match(field(plain, 'DESCRIPTION'), /Cannot be claimed in Challenger World/, 'every perk and note is in the description');
  // upcoming.json: one entry per item, by its id; a day item is an all-day entry.
  for (const it of extra.upcoming.items) if (Date.parse(it.at) > NOW) assert.ok(all.some((v) => v.includes(`UID:upcoming-${it.id}@maple-tracker`)), it.id);
  const leap = all.find((v) => v.includes('UID:upcoming-world-leap-1@'));
  assert.match(leap, /DTSTART;VALUE=DATE:20261216/);
  assert.match(all.find((v) => v.includes('UID:upcoming-reset-scrolls@')), /DTSTART:20261216T020000Z/);
  // season.json: one entry per deadline.
  const deadlines = [...new Set(extra.season.actions.map((a) => a.by))];
  const season = all.filter((v) => /UID:season-/.test(v));
  assert.equal(season.length, deadlines.length);
  assert.ok(season.every((v) => /TRIGGER:-P3D/.test(v)));
  // Nothing in the feed depends on when it is built, as long as the same things are still ahead.
  assert.equal(buildCalendar([], NOW, extra), buildCalendar([], NOW + 3600000, extra));
  // Bad entries are skipped, not thrown on.
  assert.doesNotThrow(() => buildCalendar([], NOW, { sunny: [null, { date: 'x' }], upcoming: { items: [null, { id: 'q' }] }, season: { actions: [null, { label: 'x', by: 'never' }] } }));
});

test('calendar: RFC 5545 lines (CRLF only, at most 75 octets, folded with a space)', () => {
  const long = 'A very long Korean-friendly title with accents é and symbols ★ '.repeat(4);
  const ics = buildCalendar([ev({ title: long }), ev({ id: 'g1', title: long + '1', postId: 3, postName: long }), ev({ id: 'g2', title: long + '2', postId: 3, postName: long })], NOW,
    { sunny: [{ date: '2026-12-06', perks: [long, '30% off Star Force enhancements'] }], upcoming: { items: [{ id: 'x', at: '2026-12-20T00:00:00Z', title: long, note: long }] } });
  assert.ok(ics.endsWith('\r\n'));
  assert.doesNotMatch(ics.replace(/\r\n/g, ''), /[\r\n]/, 'no bare CR or LF');
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
  assert.ok(ics.split('\r\n').some((l) => l.startsWith(' ')), 'long lines are folded');
  // Unfolding gives back the whole text, with no character split.
  assert.ok(unfold(ics).includes('SUMMARY:Ends: ' + long.replace(/,/g, '\\,')));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, (ics.match(/END:VEVENT/g) || []).length);
});

// ---------- 36: Sunny Sunday card ----------
test('perkGroups: notes stay with their perk and Star Force discounts come first', () => {
  const g = perkGroups(PERKS);
  assert.equal(g.length, 10);
  const bloom = g.find((x) => /Monsterbloom/.test(x.text));
  assert.deepEqual(bloom.notes, ['Can be claimed 1 time per account.', 'Cannot be claimed in Challenger World.']);
  assert.ok(g.find((x) => /^1\+1 Star Force/.test(x.text)).notes[0].startsWith('Can reach up to 12 Stars'));
  const sf = perkGroups(SF_PERKS);
  assert.equal(sf[0].text, '30% off Star Force enhancements');
  assert.equal(sf[0].notes.length, 1);
  assert.deepEqual(perkGroups(['Cannot be claimed in Challenger World.']).map((x) => x.text), ['Cannot be claimed in Challenger World.'], 'a lone note is kept');
  assert.deepEqual(perkGroups(null), []);
});

test('Today: the Sunny Sunday card shows every perk once "+N more" is pressed', async (t) => {
  at(t, T0);
  start();
  const data = { ...DATA, events: { events: [], sunny: [{ date: nextSunday(T0), perks: PERKS }] } };
  const el = await mount(t, TodayPage, data);
  let text = flat(el);
  assert.match(text, /Next Sunny Sunday/);
  assert.match(text, /\+4 more/);
  assert.match(text, /Can reach up to 12 Stars/, 'notes are shown with their perk');
  const more = el.find((n) => n.localName === 'button' && n.text.trim() === '+4 more');
  more.fire('click');
  assert.ok(await until(() => /Elite monster appearance increase/.test(flat(el))), 'the rest appear');
  text = flat(el);
  for (const g of perkGroups(PERKS)) assert.ok(text.includes(g.text.replace(/\s+/g, ' ')), g.text);
  assert.match(text, /Cannot be claimed in Challenger World/);
  assert.doesNotMatch(text, /\+\d+ more/);
});

// ---------- 37: flames ----------
test('flameTotals skips slots that cannot have flames', () => {
  const g = { slots: { ring1: { tier: 2, flame: { main: 40, att: 5 } }, hat: { tier: 2, flame: { main: 20 } } } };
  const no = DATA.flames.noFlameSlots;
  assert.deepEqual(flameTotals(DATA.gear.slots, g, no), { main: 20, sub: 0, att: 0, allstat: 0, boss: 0, dmg: 0, items: 1 });
  assert.equal(flameTotals(DATA.gear.slots, g).items, 2, 'without a list, every slot counts as before');
});

test('Gear: a ring has no flame form; a hat and a weapon keep it; a stray ring flame can be cleared', async (t) => {
  at(t, T0);
  start((s) => { s.gear.a = { preset: 'mid', slots: { ring1: { tier: 2, flame: { main: 40 } }, hat: { tier: 2 }, weapon: { tier: 2 } }, history: [] }; });
  const el = await mount(t, GearPage);
  const dialog = () => el.find((n) => n.attrs.role === 'dialog');
  const open = async (label) => {
    el.find((n) => n.localName === 'button' && n.attrs['aria-label'] === `${label}: edit`).fire('click');
    assert.ok(await until(() => dialog() && dialog().text.includes(label)), `${label} opens`);
    return flat(dialog());
  };
  assert.doesNotMatch(flat(el), /Flames · 1 item/, 'the ring flame is not in the totals');
  let text = await open('Ring 1');
  assert.doesNotMatch(text, /Bonus stats \(flame\)|Boss item \(flame advantage/);
  assert.match(text, /This slot cannot have flames/);
  dialog().find((n) => n.localName === 'button' && n.text.trim() === 'Clear them').fire('click');
  assert.ok(await until(() => !store.getState().gear.a.slots.ring1.flame), 'the stray flame is gone');
  for (const label of ['Hat', 'Weapon']) {
    const close = dialog() && dialog().find((n) => n.localName === 'button' && /close|done/i.test(n.attrs['aria-label'] || n.text || ''));
    if (close) close.fire('click');
    await until(() => !dialog());
    text = await open(label);
    assert.match(text, /Bonus stats \(flame\)/, label);
  }
});

// ---------- 38: developer notes ----------
test('data notes shown on screen carry no developer wording', () => {
  const shown = [DATA.gearStats.sets.note, DATA.season.source, DATA.ibp.source, DATA.checklist.source, DATA.erda.note,
    ...Object.values(DATA.erda.templates).map((x) => x.costNote), load('shops').source, DATA.symbols.source, DATA.bosses.limits.note, DATA.upgrades.starforce.mvp.note];
  for (const s of shown) {
    assert.ok(s, 'present');
    assert.doesNotMatch(s, /minLevel|exclude"|pitched\.json|research|<area>|"earn"|"useBy"|the quote is|Limit of 180|up to 16 to 17/, s);
  }
  assert.ok(Object.values(DATA.gear.slotTypes).flat().every((n) => !/Absolab/.test(n)), 'AbsoLab is spelt the game\'s way');
});

// ---------- 39: text for the character on screen ----------
test('Checklist: Extreme Monster Parker and High Mountain lock below Lv. 260', () => {
  const group = DATA.checklist.groups.find((g) => g.items.some((i) => i.id === 'w-mp'));
  for (const id of ['w-mp', 'w-high']) {
    const item = group.items.find((i) => i.id === id);
    const cs = store.blankState().checklist;
    assert.equal(itemStatus(item, group, cs, T0, { id: 'b', level: 210, challenger: false }).locked, true, `${id} at 210`);
    assert.ok(!itemStatus(item, group, cs, T0, { id: 'a', level: 264, challenger: true }).locked, `${id} at 264`);
  }
});

test('level gates: Challenger World parts only for a Challenger character; Beyond Burning only before it ends', () => {
  const state = store.blankState();
  const alt = levelOutlook(DATA, state, { ...ALT, level: 262 }, T0);
  assert.ok(alt.gates.length);
  assert.ok(alt.gates.every((g) => !/Item Burning|Mayrin/.test(g.what)), alt.gates.map((g) => g.what).join(' | '));
  const main = levelOutlook(DATA, state, MAIN, T0);
  assert.match(main.gates.find((g) => g.level === 270).what, /^Odium, Mayrin, Item Burning stages 7-8/);
  // A main whose readings put Lv. 280 after Beyond Burning ends: no "end of Beyond Burning" on that gate.
  const slow = { ...MAIN, id: 'slow' };
  const log = [{ t: T0 - 10 * DAY, level: 264, pct: 0 }, { t: T0, level: 264, pct: 2 }];
  const o = levelOutlook(DATA, { ...state, level: { slow: { log } } }, slow, T0);
  const g280 = o.gates.find((g) => g.level === 280);
  assert.ok(o.beyond, 'Beyond Burning runs on this day');
  assert.ok(g280.at != null && g280.at >= o.burnUntil, 'the slow main reaches 280 after it ends');
  assert.doesNotMatch(g280.what, /Beyond Burning/);
  // With no rate there is no date, so the gate still says where Beyond Burning stops.
  assert.match(main.gates.find((g) => g.level === 280).what, /end of Beyond Burning$/);
});

test('Today and Progress for a Lv. 210 non-Challenger alt: no 6th job steps, no Item Burning', async (t) => {
  at(t, T0);
  start(() => {}, [ALT]);
  const today = await textOf(t, TodayPage);
  assert.doesNotMatch(today, /6th job/);
  assert.doesNotMatch(today, /Item Burning/);
  start((s) => { s.ui.progressView = 'ibp'; }, [ALT]);
  const progress = await textOf(t, ProgressPage);
  assert.doesNotMatch(progress, /Item Burning/);
  assert.match(progress, /Level gates/, 'a saved Item Burning view opens on Level');
  // The main still has both.
  start((s) => { s.ui.progressView = 'ibp'; }, [MAIN]);
  assert.match(await textOf(t, ProgressPage), /Item Burning Plus stages/);
  start(() => {}, [MAIN]);
  assert.match(await textOf(t, TodayPage), /6th job/);
});

test('6th job notes follow the system: Erda Link and HEXA Matrix wording', async (t) => {
  at(t, T0);
  start((s) => { s.ui.progressView = 'sixth'; }, [MAIN]);
  let text = await textOf(t, ProgressPage);
  assert.match(text, /Erda Link costs aren't published/);
  start((s) => { s.ui.progressView = 'sixth'; }, [{ ...ALT, level: 265, cls: 'Hero' }]);
  text = await textOf(t, ProgressPage);
  assert.doesNotMatch(text, /Erda Link costs/);
  assert.match(text, /Only the Origin skill's costs are in this tracker/);
  assert.equal(whoFor(DATA, store.getState(), null).id, undefined);
});
