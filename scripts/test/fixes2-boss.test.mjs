// Second test-everything round, boss area: credited clears, month-end Black Mage, capped reset warnings,
// unticking across a reset, kept picks sharing a clear, liberation shared clears, this-week targets, wording.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

installFakeBrowser({});
const { html, render } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const { characterLines, computeIncome, shareKey, crystalValue } = await import('../../site/app/calc/income.js');
const { resetWarnings } = await import('../../site/app/calc/reminders.js');
const { suggestBosses } = await import('../../site/app/calc/bosscp.js');
const { liberationPlan, liberationCounted } = await import('../../site/app/calc/progress.js');
const { periodKey } = await import('../../site/app/time.js');
const { dedupeEvents } = await import('../../site/app/calc/events.js');
const { BossesPage, toggleClear } = await import('../../site/app/pages/bosses.js');
const { TodayPage } = await import('../../site/app/pages/today.js');
const { ProgressPage } = await import('../../site/app/pages/progress.js');

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const bosses = load('bosses');
const cpData = load('bosscp');
const liberation = load('liberation');
const bossById = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const char = { id: 'a', name: 'Erel', level: 264, world: 'heroic', region: 'na', mainStat: 'STR' };
const heroic = (id, party = 1) => crystalValue(bossById[id], char, bosses, party);
const income = (picks, clears, now) => computeIncome([char], { bosses: { a: { picks, clears } } }, bosses, bossById, now).perChar.a;
const solo = (...ids) => Object.fromEntries(ids.map((id) => [id, { party: 1 }]));
const FRI = Date.parse('2026-11-27T03:00:00Z'); // day 2 of the crystal week that starts Thu 26 Nov
const week = periodKey('thu', FRI);
const day = periodKey('daily', FRI);

// ---- a page in the stand-in browser, with a clock the test moves ----
const realNow = Date.now;
let clock = null;
Date.now = () => (clock === null ? realNow() : clock);
const mounted = [];
after(() => { for (const el of mounted) render(null, el); Date.now = realNow; });
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
  data.nexonCharacters = data.nexonCharacters || { characters: [] };
  data.bossById = bossById;
  return data;
}
const DATA = pageData();
async function show(Page, mutate) {
  const s = store.blankState();
  s.characters = [{ ...char }];
  s.activeId = 'a';
  mutate(s);
  store.replaceState(s);
  const el = new FakeNode('div');
  mounted.push(el);
  const App = () => html`<${Page} data=${DATA} state=${store.useStore()} />`;
  render(html`<${App} />`, el);
  await tick(5);
  return el;
}
const marksOf = () => store.getState().bosses.a.clears;

// ---- finding 0: a clear on a difficulty that is no longer picked ----
test('a crystal earned on a difficulty that is no longer picked is still earned', () => {
  const before = income(solo('lucid-normal'), { 'lucid-normal': { [week]: true } }, FRI);
  assert.equal(before.earned, heroic('lucid-normal'));
  // The pick moves to Hard (by hand or with "Use this list"); the Normal tick stays.
  const moved = income(solo('lucid-hard'), { 'lucid-normal': { [week]: true } }, FRI);
  assert.equal(moved.earned, heroic('lucid-normal'), 'the Normal crystal was sold this week');
  assert.equal(moved.weeklyCleared, 1);
  const line = moved.lines.find((l) => l.bossId === 'lucid-hard');
  assert.equal(line.doneAs, 'Normal');
  assert.equal(line.cleared, 1);
  assert.equal(moved.target, moved.earned, 'nothing more can be cleared for this boss this week');
  // A daily boss the same way.
  const daily = income(solo('zakum-easy'), { 'zakum-normal': { [day]: true } }, FRI);
  assert.equal(daily.earned, heroic('zakum-normal'));
  assert.equal(daily.lines[0].cleared, 1);
});

test('a credited clear is counted once, and only on the planned line', () => {
  // Three Lucid difficulties: two picked, the tick on the one that is not.
  const three = income(solo('lucid-normal', 'lucid-hard'), { 'lucid-easy': { [week]: true } }, FRI);
  assert.equal(three.earned, heroic('lucid-easy'));
  assert.equal(three.lines.find((l) => l.bossId === 'lucid-hard').cleared, 1);
  assert.equal(three.lines.find((l) => l.bossId === 'lucid-normal').cleared, 0);
  // Picked and unpicked both ticked (two devices): the better crystal, once.
  const both = income(solo('lucid-normal'), { 'lucid-normal': { [week]: true }, 'lucid-hard': { [week]: true } }, FRI);
  assert.equal(both.earned, heroic('lucid-hard'));
  assert.equal(both.weeklyCleared, 1);
  // A party pick: the unpicked difficulty is valued at the same party size.
  const party = income({ 'lucid-hard': { party: 2 } }, { 'lucid-normal': { [week]: true } }, FRI);
  assert.equal(party.earned, heroic('lucid-normal', 2));
  // A tick from another week earns nothing now.
  const old = income(solo('lucid-hard'), { 'lucid-normal': { [periodKey('thu', FRI - 7 * 86400000)]: true } }, FRI);
  assert.equal(old.earned, 0);
  assert.equal(old.lines[0].doneAs, null);
});

// ---- findings 1 and 6: Black Mage cleared either side of a month end, in one crystal week ----
test('two monthly clears in one crystal week are two crystals', () => {
  const nov = Date.parse('2026-11-30T12:00:00Z');
  const dec = Date.parse('2026-12-01T12:00:00Z');
  const picks = solo('black-mage-hard');
  const value = heroic('black-mage-hard');
  const one = { 'black-mage-hard': { 'monthly:2026-11': nov } };
  const two = { 'black-mage-hard': { 'monthly:2026-11': nov, 'monthly:2026-12': dec } };
  assert.equal(income(picks, one, nov).earned, value);
  assert.equal(income(picks, one, dec).earned, value, 'the November clear still belongs to this crystal week on 1 Dec');
  const both = income(picks, two, dec);
  assert.equal(both.earned, 2 * value);
  assert.equal(both.lines[0].cleared, 2);
  assert.equal(income(picks, two, Date.parse('2026-12-03T00:01:00Z')).earned, 0, 'the next crystal week starts empty');
  // A week inside one month never counts its mark twice.
  const mid = Date.parse('2026-12-10T12:00:00Z');
  assert.equal(income(picks, { 'black-mage-hard': { 'monthly:2026-12': mid } }, mid + 3600000).earned, value);
  // Marks saved before the tick time was kept (true) count once, in the current week.
  assert.equal(income(picks, { 'black-mage-hard': { 'monthly:2026-11': true, 'monthly:2026-12': true } }, dec).earned, value);
});

// ---- finding 54: "earned of planned" on one basis ----
test('this week\'s target counts a monthly crystal the way earned does', () => {
  const picks = solo('lucid-hard', 'zakum-chaos', 'black-mage-hard');
  const month = periodKey('monthly', FRI);
  const full = heroic('lucid-hard') + heroic('zakum-chaos') + heroic('black-mage-hard');
  const none = income(picks, {}, FRI);
  assert.equal(none.target, full, 'the monthly boss can still be cleared this week');
  assert.ok(none.planned < none.target, 'the weekly plan spreads the monthly crystal over the month');
  const some = income(picks, { 'lucid-hard': { [week]: true }, 'black-mage-hard': { [month]: FRI } }, FRI);
  assert.equal(some.target, full);
  assert.ok(some.earned < some.target, 'Chaos Zakum is still open, so earned is under the target');
  const all = income(picks, { 'lucid-hard': { [week]: true }, 'zakum-chaos': { [week]: true }, 'black-mage-hard': { [month]: FRI } }, FRI);
  assert.equal(all.earned, all.target);
  // Cleared in an earlier week of the month: not part of this week's target any more.
  const later = Date.parse('2026-12-17T03:00:00Z');
  const early = income(picks, { 'black-mage-hard': { [periodKey('monthly', later)]: Date.parse('2026-12-05T03:00:00Z') } }, later);
  assert.equal(early.target, heroic('lucid-hard') + heroic('zakum-chaos'));
  // The weekly plan (Mesos: income a week, goal dates) is unchanged by any of this.
  assert.equal(none.planned, some.planned);
  assert.equal(none.planned, all.planned);
  const worlds = computeIncome([char], { bosses: { a: { picks, clears: {} } } }, bosses, bossById, FRI).worlds;
  assert.equal(worlds[0].plannedTotal, none.planned);
  assert.equal(worlds[0].targetTotal, none.target);
});

test('the target keeps to the weekly cap and to days still in the plan', () => {
  const weekly = bosses.bosses.filter((b) => b.reset === 'weekly' && !b.noCrystal).sort((a, b) => b.price - a.price)
    .filter((b, i, all) => all.findIndex((o) => o.boss === b.boss) === i).slice(0, 16);
  const picks = solo(...weekly.map((b) => b.id));
  const r = income(picks, {}, FRI);
  assert.equal(r.target, r.planned, 'weekly bosses only: target and plan are the same 14 crystals');
  const d = income(solo('zakum-normal'), { 'zakum-normal': { [day]: true } }, FRI);
  assert.equal(d.target, 7 * heroic('zakum-normal'));
  assert.equal(d.earned, heroic('zakum-normal'));
});

// ---- finding 3: the Thursday warning and the 14-crystal cap ----
test('the Thursday warning never counts more bosses than crystals that sell', () => {
  const wed = Date.parse('2026-12-02T20:00:00Z');
  const key = periodKey('thu', wed);
  const cap = bosses.limits.weeklyPerCharacter;
  const best = bosses.bosses.filter((b) => b.reset === 'weekly' && !b.noCrystal).sort((a, b) => b.price - a.price)
    .filter((b, i, all) => all.findIndex((o) => o.boss === b.boss) === i).slice(0, cap + 2);
  const picks = solo(...best.map((b) => b.id));
  const warn = (clears) => {
    const r = income(picks, clears, wed);
    const w = resetWarnings({ groups: [] }, {}, r.lines, wed, { weeklyCap: cap }).find((x) => x.kind === 'thu');
    return { r, w };
  };
  const open = warn({});
  assert.equal(open.w.bosses.count, cap);
  assert.equal(open.w.bosses.value, open.r.planned, 'what is at stake is what is planned');
  const done = warn(Object.fromEntries(best.slice(0, cap).map((b) => [b.id, { [key]: true }])));
  assert.equal(done.w, undefined, 'all the crystals that sell are cleared: nothing left to lose');
  const part = warn(Object.fromEntries(best.slice(0, cap - 1).map((b) => [b.id, { [key]: true }])));
  assert.equal(part.w.bosses.count, 1);
  assert.equal(part.w.bosses.value, heroic(best[cap - 1].id), 'the best open boss is the one counted');
  // Without a cap passed in, every open boss is counted as before.
  assert.equal(resetWarnings({ groups: [] }, {}, open.r.lines, wed).find((x) => x.kind === 'thu').bosses.count, cap + 2);
});

test('Today passes the cap to the reset warning', async () => {
  clock = Date.parse('2026-12-02T20:00:00Z');
  const key = periodKey('thu', clock);
  const cap = bosses.limits.weeklyPerCharacter;
  const best = bosses.bosses.filter((b) => b.reset === 'weekly' && !b.noCrystal).sort((a, b) => b.price - a.price)
    .filter((b, i, all) => all.findIndex((o) => o.boss === b.boss) === i).slice(0, cap + 2);
  const el = await show(TodayPage, (s) => {
    s.bosses = { a: { picks: solo(...best.map((b) => b.id)), clears: Object.fromEntries(best.slice(0, cap).map((b) => [b.id, { [key]: true }])) } };
  });
  assert.doesNotMatch(el.text, /bosses? uncleared/);
  clock = null;
});

// ---- finding 4: a box drawn ticked before a reset, clicked after it ----
test('unticking never adds a clear for a new period', async () => {
  for (const [Page, prefix] of [[BossesPage, 'clear-'], [TodayPage, 'today-boss-']]) {
    clock = Date.parse('2026-12-02T23:59:50Z');
    const el = await show(Page, (s) => { s.bosses = { a: { picks: solo('lucid-hard'), clears: { 'lucid-hard': { 'thu:2026-11-26': true } } } }; });
    const box = el.find((n) => n.localName === 'input' && n.attrs.id === prefix + 'lucid-hard');
    assert.ok(box, 'the boss has a tick box');
    clock = Date.parse('2026-12-03T00:00:05Z'); // the weekly reset passed without a redraw
    box.checked = false; // what the browser does before it calls the handler
    box.fire('change');
    await tick(5);
    assert.deepEqual(Object.keys(marksOf()['lucid-hard']), ['thu:2026-11-26'], `${prefix}: no clear in the new week`);
    assert.equal(income(solo('lucid-hard'), marksOf(), clock).earned, 0);
  }
  clock = null;
});

test('toggleClear: ticking sets, unticking clears, a tick moves between difficulties', () => {
  clock = FRI;
  const s = store.blankState();
  s.characters = [{ ...char }];
  s.activeId = 'a';
  s.bosses = { a: { picks: solo('lucid-hard'), clears: {} } };
  store.replaceState(s);
  const line = { shared: ['lucid-easy', 'lucid-normal'] };
  toggleClear('a', bossById['lucid-hard'], line, true);
  assert.equal(marksOf()['lucid-hard'][week], true);
  toggleClear('a', bossById['lucid-hard'], line, true);
  assert.equal(marksOf()['lucid-hard'][week], true, 'a second tick keeps the mark');
  toggleClear('a', bossById['lucid-hard'], line, false);
  assert.equal(marksOf()['lucid-hard'][week], undefined);
  toggleClear('a', bossById['lucid-hard'], line, false);
  assert.equal(marksOf()['lucid-hard'][week], undefined, 'a second untick adds nothing');
  // Ticking Normal after Hard moves the one clear.
  toggleClear('a', bossById['lucid-hard'], line, true);
  toggleClear('a', bossById['lucid-normal'], { shared: ['lucid-easy', 'lucid-hard'] }, true);
  assert.equal(marksOf()['lucid-hard'][week], undefined);
  assert.equal(marksOf()['lucid-normal'][week], true);
  // Unticking Hard while it is done on Normal takes the Normal tick away.
  toggleClear('a', bossById['lucid-hard'], line, false);
  assert.equal(marksOf()['lucid-normal'][week], undefined);
  // Without the box's value it toggles, as before.
  toggleClear('a', bossById['lucid-hard'], line);
  assert.equal(marksOf()['lucid-hard'][week], true);
  toggleClear('a', bossById['lucid-hard'], line);
  assert.equal(marksOf()['lucid-hard'][week], undefined);
  // A monthly tick keeps its time and a second tick does not move it.
  toggleClear('a', bossById['black-mage-hard'], { shared: ['black-mage-extreme'] }, true);
  clock = FRI + 60000;
  toggleClear('a', bossById['black-mage-hard'], { shared: ['black-mage-extreme'] }, true);
  assert.equal(marksOf()['black-mage-hard'][periodKey('monthly', FRI)], FRI);
  clock = null;
});

// ---- finding 5: two kept party picks of one boss ----
test('two kept difficulties of one boss take one place in the suggestion', () => {
  const keep = (...ids) => ids.map((id) => ({ ...bossById[id], party: 2 }));
  assert.equal(shareKey(bossById['kaling-hard']), shareKey(bossById['kaling-normal']));
  const cp = 6e9;
  const one = suggestBosses(bosses, cpData, cp, 1, char, keep('kaling-hard'));
  const two = suggestBosses(bosses, cpData, cp, 1, char, keep('kaling-hard', 'kaling-normal'));
  assert.deepEqual(two.ids, one.ids);
  const picks = { 'kaling-hard': { party: 2 }, 'kaling-normal': { party: 2 }, ...solo(...two.ids) };
  const r = income(picks, {}, FRI);
  assert.equal(Math.min(r.weeklyPicked, bosses.limits.weeklyPerCharacter), Math.min(two.reachable + 1, bosses.limits.weeklyPerCharacter), 'every crystal that sells is planned');
  // Kept picks of different bosses still take a place each (here: the best suggested boss, kept as it is).
  const other = suggestBosses(bosses, cpData, cp, 1, char, [...keep('kaling-hard'), { ...one.list[0].boss, party: 1 }]);
  assert.equal(other.ids.length, one.ids.length - 1);
});

// ---- finding 50: liberation and shared clears ----
test('liberation counts one difficulty per boss clear', () => {
  const g = liberation.genesis;
  const plan = (picks) => liberationPlan(g, { stage: 0, traces: 0, picks }, FRI, bossById);
  const hard = plan({ 'lucid-hard': true });
  const all = plan({ 'lucid-easy': true, 'lucid-normal': true, 'lucid-hard': true });
  assert.equal(all.perWeek, hard.perWeek);
  assert.equal(all.perWeek, g.sources['lucid-hard']);
  assert.equal(all.weeks, hard.weeks);
  const bm = plan({ 'black-mage-hard': true, 'black-mage-extreme': true });
  assert.equal(bm.perWeek, plan({ 'black-mage-hard': true }).perWeek);
  // Different bosses still add up, and an unticked difficulty does not count.
  const mix = plan({ 'lucid-hard': true, 'lotus-normal': true, 'lucid-normal': false });
  assert.equal(mix.perWeek, g.sources['lucid-hard'] + g.sources['lotus-normal']);
  assert.deepEqual(liberationCounted(g, { 'lucid-easy': true, 'lucid-hard': true }, bossById).map((c) => c.bossId), ['lucid-hard']);
  // Every source in the data file is a known boss, so the grouping can be trusted.
  for (const def of [liberation.genesis, liberation.destiny]) for (const id of Object.keys(def.sources)) assert.ok(bossById[id], id);
});

test('Liberation: ticking a difficulty un-ticks the others of that boss; "1 week" is singular', async () => {
  clock = FRI;
  const g = liberation.genesis;
  const last = g.stages.length - 1;
  const el = await show(ProgressPage, (s) => {
    s.ui.progressView = 'liberation';
    s.liberation = { a: { genesis: { stage: last, traces: g.stages[last].need - 1, picks: { 'lucid-easy': true, 'lucid-normal': true } } } };
  });
  assert.match(el.text, /About 1 week at [0-9]+ a week: around /);
  assert.doesNotMatch(el.text, /1 weeks/);
  assert.match(el.text, /only the best ticked one counts/);
  const chip = el.find((n) => n.localName === 'button' && /Hard Lucid/.test(n.text));
  assert.ok(chip, 'Hard Lucid has a chip');
  chip.fire('click');
  await tick(5);
  const picks = store.getState().liberation.a.genesis.picks;
  assert.equal(picks['lucid-hard'], true);
  assert.equal(Boolean(picks['lucid-easy']), false);
  assert.equal(Boolean(picks['lucid-normal']), false);
  assert.doesNotMatch(el.text, /only the best ticked one counts/);
  clock = null;
});

// ---- finding 56: singular counts on Bosses ----
test('Bosses: one boss over the cap and one difficulty out of reach read as singular', async () => {
  clock = FRI;
  const cap = bosses.limits.weeklyPerCharacter;
  const distinct = bosses.bosses.filter((b) => b.reset === 'weekly' && !b.noCrystal).sort((a, b) => a.price - b.price)
    .filter((b, i, all) => all.findIndex((o) => o.boss === b.boss) === i).slice(0, cap + 1);
  // A Combat Power that leaves exactly one harder difficulty out of reach.
  const needs = bosses.bosses.filter((b) => b.reset === 'weekly' && !b.noCrystal && cpData.minCp[b.id] > 0).map((b) => cpData.minCp[b.id]).sort((a, b) => a - b);
  const cp = needs.map((n) => n).reverse().find((n) => suggestBosses(bosses, cpData, n, 1, char).beyond === 1);
  assert.ok(cp, 'some Combat Power leaves exactly one difficulty out of reach');
  const el = await show(BossesPage, (s) => {
    s.characters[0].cp = cp;
    s.bosses = { a: { picks: solo(...distinct.map((b) => b.id)), clears: {} } };
  });
  assert.match(el.text, /1 picked boss falls outside the cap/);
  assert.match(el.text, /1 harder difficulty is out of reach for now\./);
  assert.doesNotMatch(el.text, /\b1 (picked bosses|harder difficulties|bosses)\b/);
  clock = null;
});

test('Bosses: the tile compares earned with this week\'s target', async () => {
  clock = FRI;
  const picks = solo('lucid-hard', 'black-mage-hard');
  const clears = { 'lucid-hard': { [week]: true }, 'black-mage-hard': { [periodKey('monthly', FRI)]: FRI } };
  const el = await show(BossesPage, (s) => { s.bosses = { a: { picks, clears } }; });
  const r = income(picks, clears, FRI);
  assert.equal(r.earned, r.target);
  const tile = el.find((n) => String(n.attrs.class || n.className || '').split(' ').includes('tile') && /Earned this week/.test(n.text));
  const amounts = tile.text.match(/[\d.]+[KMB]/g);
  assert.equal(amounts[0], amounts[1], `earned and planned agree when everything is cleared: ${tile.text}`);
  clock = null;
});
