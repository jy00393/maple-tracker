// Second round of tested fixes, interface side: number boxes, the Mesos calculators, the character form,
// countdown wording, day counts, the coin shop's weeks, duplicate events, and the offline worker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

const siteFile = (name) => fileURLToPath(new URL(`../../site/${name}`, import.meta.url));
installFakeBrowser({ files: { 'data/items.json': siteFile('data/items.json') } });

const { html, render, useState } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const { NumberInput, Stepper, Left, parseMesos } = await import('../../site/app/ui.js');
const { DAY, dayKey, kstDays, dayWord, fmtDate } = await import('../../site/app/time.js');
const { dedupeEvents, eventKey } = await import('../../site/app/calc/events.js');
const { comingUp } = await import('../../site/app/calc/upcoming.js');
const { coinsToCome, weeksLeft, shopPlan } = await import('../../site/app/calc/shops.js');
const { crystalWeekStart } = await import('../../site/app/calc/income.js');
const { workerOff, setUpWorker } = await import('../../site/app/offline.js');
const { mergeShops } = await import('../lib/shops.mjs');
const { CharactersPage } = await import('../../site/app/pages/characters.js');
const { MesosPage } = await import('../../site/app/pages/mesos.js');
const { TodayPage } = await import('../../site/app/pages/today.js');
const { EventsPage, EventRow } = await import('../../site/app/pages/events.js');
const { earnReset } = await import('../../site/app/pages/shops.js');

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
const DATA = loadData();

const mounted = [];
const realNow = Date.now;
after(() => { Date.now = realNow; for (const el of mounted) render(null, el); });

function mount(vnode) {
  const el = new FakeNode('div');
  mounted.push(el);
  render(vnode, el);
  return el;
}
async function show(Page, data = DATA) {
  const App = () => html`<${Page} data=${data} state=${store.useStore()} />`;
  const el = mount(html`<${App} />`);
  await tick(5);
  return el;
}
const unmount = (el) => render(null, el);
function setState(mutator) {
  store.resetState();
  store.update(mutator);
}
const twoChars = (s) => {
  s.characters = [
    { id: 'main', name: 'Main', cls: 'Erel Light', level: 264, region: 'na', world: 'heroic', challenger: true, mainStat: 'STR' },
    { id: 'mule', name: 'Mule', cls: 'Bishop', level: 210, region: 'na', world: 'interactive', challenger: false, mainStat: 'INT' }
  ];
  s.activeId = 'main';
};
// The box as a browser has it: a text that keystrokes add to. Preact then reads and writes the same property.
const boxText = (box) => String(box.value ?? box.attrs.value ?? '');
async function type(box, chars) {
  for (const ch of chars) {
    box.value = boxText(box) + ch;
    box.fire('input', { currentTarget: box });
    await tick(5);
  }
}
async function clearBox(box) {
  box.value = '';
  box.fire('input', { currentTarget: box });
  await tick(5);
}
const byLabel = (el, re) => el.find((n) => n.localName === 'input' && re.test(n.attrs['aria-label'] || ''));

// ---- #49 -----------------------------------------------------------------------------------------------------
test('#49 Edit on one character and then on another edits the second one, and an id is never overwritten', async () => {
  setState((s) => { twoChars(s); s.bosses = { main: { picks: {} }, mule: { picks: {} } }; });
  const el = await show(CharactersPage);
  const edits = () => el.findAll((n) => n.localName === 'button' && n.text.trim() === 'Edit');
  edits()[0].fire('click');
  await tick(5);
  assert.equal(edits().length, 1);
  edits()[0].fire('click');
  await tick(5);
  const form = el.find((n) => n.localName === 'form');
  const name = form.find((n) => n.attrs.id === 'char-name');
  assert.equal(boxText(name), 'Mule', 'the form shows the second character');
  form.fire('submit');
  await tick(5);
  const after = store.getState().characters;
  assert.deepEqual(after.map((c) => [c.id, c.name, c.cls, c.level, c.world]), [['main', 'Main', 'Erel Light', 264, 'heroic'], ['mule', 'Mule', 'Bishop', 210, 'interactive']]);
  unmount(el);
});

// ---- #80 -----------------------------------------------------------------------------------------------------
test('#80 a number box keeps the text being typed: 0.05 is saved as 0.05, and − / + still shows through', async () => {
  const seen = [];
  function Host() {
    const [v, setV] = useState(1);
    return html`<${NumberInput} label="Weight" step=${0.05} value=${v} onChange=${(n) => { seen.push(n); setV(n ?? 0); }} />`;
  }
  const el = mount(html`<${Host} />`);
  await tick(5);
  const box = el.find((n) => n.localName === 'input');
  assert.equal(box.attrs.inputmode, 'decimal', 'a box with a fraction step offers the decimal key');
  await clearBox(box);
  await type(box, '0.05');
  assert.equal(seen[seen.length - 1], 0.05);
  assert.equal(boxText(box), '0.05');
  unmount(el);

  // A Stepper: typing, then a + press, then leaving the box.
  function Steps() {
    const [v, setV] = useState(3);
    return html`<${Stepper} label="Stars" value=${v} max=${10} onChange=${(n) => setV(n ?? 0)} />`;
  }
  const st = mount(html`<${Steps} />`);
  await tick(5);
  const num = st.find((n) => n.localName === 'input');
  assert.equal(num.attrs.inputmode, 'numeric');
  await clearBox(num);
  await type(num, '5');
  st.find((n) => n.localName === 'button' && /One more/.test(n.attrs['aria-label'])).fire('click');
  await tick(5);
  assert.equal(boxText(num), '6', 'a change from outside replaces the typed text');
  await clearBox(num);
  await type(num, '50');
  assert.equal(boxText(num), '50', 'not rewritten while typing');
  num.fire('blur', { currentTarget: num });
  await tick(5);
  assert.equal(boxText(num), '10', 'leaving the box shows the saved, capped number');
  unmount(st);
});

// ---- #15, #79 ------------------------------------------------------------------------------------------------
test('#15 #79 the cube odds box takes "25" as 25%, and shows exactly the odds the sum uses', async () => {
  setState((s) => { twoChars(s); s.ui.mesosView = 'cubes'; });
  const el = await show(MesosPage);
  const box = byLabel(el, /Bright.*tier-up 3 percent/);
  await clearBox(box);
  await type(box, '25');
  assert.equal(store.getState().mesos.cubeRates.bright[2], 0.25);
  assert.equal(boxText(box), '25');
  await clearBox(box);
  await type(box, '3.25');
  const saved = store.getState().mesos.cubeRates.bright[2];
  assert.ok(Math.abs(saved - 0.0325) < 1e-12);
  box.fire('blur', { currentTarget: box });
  await tick(5);
  assert.equal(Number(boxText(box)), 3.25, 'the box shows the saved odds, not a rounded 3.3');
  // An empty box changes nothing.
  await clearBox(box);
  assert.ok(Math.abs(store.getState().mesos.cubeRates.bright[2] - 0.0325) < 1e-12);
  unmount(el);
});

// ---- #82 -----------------------------------------------------------------------------------------------------
test('#82 the income average leaves out the week still running, and an empty chart has no 0 1 1 1 labels', async () => {
  setState((s) => { twoChars(s); s.ui.mesosView = 'history'; });
  let el = await show(MesosPage);
  assert.equal(el.findAll((n) => n.localName === 'text' && n.attrs.x === '4').length, 0, 'no grid labels without data');
  assert.match(el.text, /0 finished weeks recorded/);
  unmount(el);
  const week = (i) => dayKey(crystalWeekStart(Date.now()) - i * 7 * DAY);
  store.update((s) => {
    s.incomeHistory = { [week(0)]: { earned: 4e8, planned: 1e10 }, [week(1)]: { earned: 1e10, planned: 1e10 }, [week(2)]: { earned: 1e10, planned: 1e10 }, [week(3)]: { earned: 1e10, planned: 1e10 } };
  });
  el = await show(MesosPage);
  assert.match(el.text, /Average earned week\s*10B/);
  assert.match(el.text, /3 finished weeks recorded · this week so far: 400M/);
  assert.equal(el.findAll((n) => n.localName === 'text' && n.attrs.x === '4').length, 4);
  unmount(el);
});

// ---- #83 -----------------------------------------------------------------------------------------------------
test('#83 a goal under a day away reads "today" or "tomorrow", never "1 days"', async () => {
  setState((s) => { twoChars(s); s.ui.mesosView = 'planner'; s.mesos.other = 7e9; s.mesos.goals = [{ id: 'g', name: 'Soon', cost: 5e8 }]; });
  const el = await show(MesosPage);
  const row = el.find((n) => n.attrs.class === 'goal');
  assert.doesNotMatch(row.text, /\b1 days\b/);
  const at = Date.now() + 0.5 * DAY;
  assert.ok(row.text.includes(fmtDate(at) === fmtDate(Date.now()) ? 'today' : 'tomorrow'), row.text);
  unmount(el);
  assert.deepEqual([dayWord(0), dayWord(1), dayWord(2)], ['today', 'tomorrow', '2 days']);
});

// ---- #84 -----------------------------------------------------------------------------------------------------
test('#84 Star Force with nothing to do says so, and the boxes show the stars the sum uses', async () => {
  setState((s) => { twoChars(s); s.ui.mesosView = 'starforce'; s.ui.sfCalc = { level: 100, from: 17, to: 22 }; });
  let el = await show(MesosPage);
  assert.match(el.text, /Pick a target above the current stars/);
  assert.doesNotMatch(el.text, /thousands of attempts|attempts on average/);
  const max = Number(/To stars \(max (\d+)\)/.exec(el.text)[1]);
  assert.ok(max < 17);
  assert.equal(Number(boxText(byLabel(el, /^Current stars$/))), max);
  assert.equal(Number(boxText(byLabel(el, /^Target stars$/))), max);
  // The saved stars are untouched, so raising the level again brings them back.
  assert.deepEqual([store.getState().ui.sfCalc.from, store.getState().ui.sfCalc.to], [17, 22]);
  unmount(el);
  store.update((s) => { s.ui.sfCalc = { level: 160, from: 17, to: 22 }; });
  el = await show(MesosPage);
  assert.match(el.text, /attempts on average/);
  assert.doesNotMatch(el.text, /Pick a target/);
  unmount(el);
});

// ---- #85 -----------------------------------------------------------------------------------------------------
test('#85 a bare fraction is not a meso amount; blank goal names and unreadable costs are refused with a reason', async () => {
  assert.equal(parseMesos('1.5'), null);
  assert.equal(parseMesos('0.4'), null);
  assert.equal(parseMesos('5.'), 5);
  assert.equal(parseMesos('2000000.0'), 2000000);
  assert.equal(parseMesos('1.5b'), 1.5e9);
  assert.equal(parseMesos('0.5k'), 500);

  setState((s) => { twoChars(s); s.ui.mesosView = 'planner'; });
  const el = await show(MesosPage);
  const form = el.find((n) => n.localName === 'form');
  const realFormData = globalThis.FormData;
  globalThis.FormData = class { constructor(f) { this.f = f.fields; } get(k) { return this.f[k]; } };
  try {
    let resets = 0;
    const submit = async (fields) => { form.fire('submit', { currentTarget: { fields, reset() { resets++; } } }); await tick(5); };
    await submit({ name: '   ', cost: '5m' });
    assert.equal(store.getState().mesos.goals.length, 0, 'a blank name adds nothing');
    assert.match(el.text, /Give the goal a name/);
    await submit({ name: 'Arcus', cost: '5 mil' });
    assert.equal(store.getState().mesos.goals.length, 0);
    assert.match(el.text, /Type the cost like 750m or 2\.4b/);
    assert.equal(resets, 0, 'the typed text stays to be corrected');
    await submit({ name: '  Arcus  ', cost: '750m' });
    assert.deepEqual(store.getState().mesos.goals.map((g) => [g.name, g.cost]), [['Arcus', 750e6]]);
    assert.doesNotMatch(el.text, /Type the cost like/);
    assert.equal(resets, 1);
  } finally { globalThis.FormData = realFormData; }
  unmount(el);
});

// ---- #8, #64 -------------------------------------------------------------------------------------------------
test('#8 #64 Coming to GMS counts Korean calendar days for every entry, and a day-only entry lasts through Nexon\'s day', () => {
  const list = { items: [
    { id: 'timed', at: '2026-12-17T00:00:00Z', title: 'Thu 09:00 KST', note: 'x' },
    { id: 'end', at: '2027-02-09T23:59:00Z', title: 'Wed 10 Feb 08:59 KST', note: 'x' },
    { id: 'leap', at: '2027-02-10T00:00:00Z', day: true, title: '10 Feb, day only', note: 'x' },
    { id: 'patch', at: '2026-12-16T00:00:00Z', day: true, title: 'Patch', note: 'x' }
  ] };
  const at = (iso) => Object.fromEntries(comingUp(list, Date.parse(iso), null, 10).map((c) => [c.id, c]));
  // Wed 16 Dec 08:30 KST: Thu 09:00 KST is tomorrow, not "in 2 days".
  let got = at('2026-12-15T23:30:00Z');
  assert.equal(got.timed.days, 1);
  assert.equal(got.timed.when, 'tomorrow');
  // Thu 17 Dec 00:30 KST: both 10 Feb entries are the same number of days away.
  got = at('2026-12-16T15:30:00Z');
  assert.equal(got.end.days, got.leap.days);
  assert.equal(got.end.when, got.leap.when);
  assert.equal(got.timed.when, 'today');
  // The day-only patch: tomorrow on Tue night, never a plain "today", still listed after Korean midnight while
  // maintenance runs, gone when Nexon's day is over (09:00 KST the next morning).
  assert.equal(at('2026-12-15T14:00:00Z').patch.when, 'tomorrow');
  assert.equal(at('2026-12-15T15:00:00Z').patch.when, 'today or overnight');
  assert.equal(at('2026-12-16T10:00:00Z').patch.when, 'today or overnight');
  got = at('2026-12-16T15:00:00Z');
  assert.ok(got.patch, 'still listed at 00:00 KST on 17 Dec');
  assert.equal(got.patch.days, 0);
  assert.equal(got.patch.when, 'by Thu 17 Dec, 09:00 KST');
  assert.equal(at('2026-12-17T00:00:00Z').patch, undefined);
  // A timed entry leaves the list at its time.
  assert.equal(at('2026-12-17T00:00:00Z').timed, undefined);
});

// ---- #11 -----------------------------------------------------------------------------------------------------
test('#11 a countdown never reads "now left" or "starts in now" after its moment passes', async () => {
  const t0 = realNow();
  const iso = (ms) => new Date(t0 + ms).toISOString();
  const ending = { id: 'a', title: 'Ending', start: iso(-DAY), end: iso(20000), url: '#', postName: 'p' };
  const starting = { id: 'b', title: 'Starting', start: iso(20000), end: iso(DAY), url: '#', postName: 'p' };
  // The page's own clock (the `now` prop) stays where it was, as it does for up to 30 s on the real page.
  const el = mount(html`<div><${EventRow} e=${ending} now=${t0} /><${EventRow} e=${starting} now=${t0} /></div>`);
  await tick(5);
  assert.match(el.text, /0m \d\ds left/);
  assert.match(el.text, /starts in 0m \d\ds/);
  Date.now = () => realNow() + 30000;
  try {
    await tick(1200);
    assert.doesNotMatch(el.text, /now left|starts in now/);
    assert.match(el.text, /ended/);
    assert.match(el.text, /23h 59m left/, 'a started event counts down to its end');
  } finally { Date.now = realNow; }
  unmount(el);
  // Without `done` a countdown whose moment has passed disappears; it never prints "now" (which read "in now").
  const plain = mount(html`<p><${Left} until=${realNow() - 5} /></p>`);
  assert.equal(plain.text.trim(), '');
  unmount(plain);
});

// ---- #12, #71 ------------------------------------------------------------------------------------------------
test('#12 #71 hand-typed World Leap notes give their deadlines in KST', () => {
  const upcoming = load('upcoming');
  const season = load('season');
  const texts = [...upcoming.items.filter((i) => /^world-leap/.test(i.id)).map((i) => i.note), season.actions.find((a) => a.id === 'world-leap').detail];
  assert.equal(texts.length, 3);
  for (const text of texts) {
    assert.doesNotMatch(text, /until 9 Feb|until 23 Feb|to 2027-02-09|to 2027-02-23/, text);
    assert.match(text, /08:59 KST/, text);
  }
  // The typed dates are the data's own deadlines, shown in Korea time.
  const kst = (iso) => fmtDate(Date.parse(iso));
  assert.ok(texts[0].includes(kst(season.leapWindows[0].to).replace(/ 20\d\d$/, '')));
  assert.ok(texts[2].includes(kst(season.actions.find((a) => a.id === 'world-leap').by).replace(/ 20\d\d$/, '')));
});

// ---- #55 -----------------------------------------------------------------------------------------------------
test('#55 the season card and the coin shop count the same deadline the same way', async () => {
  assert.equal(kstDays(Date.parse('2027-02-08T23:00:00Z'), Date.parse('2027-02-09T23:59:00Z')), 1);
  assert.equal(kstDays(Date.parse('2027-02-09T14:59:00Z'), Date.parse('2027-02-09T23:59:00Z')), 1);
  assert.equal(kstDays(Date.parse('2027-02-09T15:00:00Z'), Date.parse('2027-02-09T23:59:00Z')), 0);
  assert.equal(kstDays(Date.parse('2027-02-10T15:00:00Z'), Date.parse('2027-02-09T23:59:00Z')), -1);
  const season = load('season');
  const shop = { id: 's', name: 'Test Shop', currency: 'Coin', start: '2026-11-11T00:00:00Z', end: season.ends, items: [{ id: 'i', name: 'Thing', cost: 10, limit: 1 }] };
  const data = loadData({ season, shops: { source: 'test', shops: [shop] } });
  const ends = Date.parse(season.ends);
  // 08:00 KST two days before, the day before, and on the closing day (the deadline is 08:59 KST).
  const cases = [[ends - 59 * 60000 - 2 * DAY, /2 days left/, /2 days left/], [ends - 59 * 60000 - DAY, /ends tomorrow/, /closes tomorrow/], [ends - 59 * 60000, /ends today/, /closes today/]];
  try {
    for (const [now, seasonText, shopText] of cases) {
      Date.now = () => now;
      setState((s) => { twoChars(s); s.ui.eventsView = 'shops'; });
      const today = await show(TodayPage, data);
      const card = today.findAll((n) => n.localName === 'section').find((n) => n.text.includes(`${season.name} ends`));
      assert.match(card.find((n) => n.attrs.class === 'meta').text, seasonText);
      unmount(today);
      const events = await show(EventsPage, data);
      const shopCard = events.findAll((n) => n.localName === 'section').find((n) => n.text.includes('Test Shop'));
      assert.match(shopCard.find((n) => n.attrs.class === 'meta').text, shopText);
      unmount(events);
    }
  } finally { Date.now = realNow; }
});

// ---- #65 -----------------------------------------------------------------------------------------------------
test('#65 coins still to earn count mission weeks on the mission\'s reset day, not 7-day blocks', () => {
  const shop = { end: '2027-02-09T23:59:00Z', earn: { name: 'Mission', perClaim: 800, perWeek: 5, max: 60 } };
  const t = (iso) => Date.parse(iso);
  const end = t(shop.end);
  // Wed 3 Feb, Thursday reset: the week ending Thu 4 Feb and the week 4-9 Feb are both open.
  assert.equal(weeksLeft(end, t('2027-02-03T12:00:00Z'), 'thu'), 2);
  assert.equal(coinsToCome(shop, 0, t('2027-02-03T12:00:00Z'), 'thu'), 8000);
  assert.equal(shopPlan({ ...shop, items: [] }, { claims: 0 }, null, t('2027-02-03T12:00:00Z'), 'thu').toCome, 8000);
  // After that Thursday's reset only one week is left; a Wednesday reset matches the shop's own last day.
  assert.equal(weeksLeft(end, t('2027-02-04T00:00:00Z'), 'thu'), 1);
  assert.equal(weeksLeft(end, t('2027-02-03T12:00:00Z'), 'wed'), 1);
  assert.equal(weeksLeft(end, t('2027-02-02T12:00:00Z'), 'wed'), 2);
  assert.equal(weeksLeft(end, t('2027-02-08T12:00:00Z'), 'mon'), 1);
  assert.equal(weeksLeft(end, t('2027-02-07T12:00:00Z'), 'mon'), 2);
  assert.equal(weeksLeft(end, end, 'thu'), 0);
  // The total cap still holds, and without a reset day the count is the old one.
  assert.equal(coinsToCome(shop, 58, t('2027-02-03T12:00:00Z'), 'thu'), 1600);
  assert.equal(coinsToCome(shop, 0, t('2027-02-03T12:00:00Z')), 4000);
  assert.equal(coinsToCome(shop, 0, t('2027-02-03T12:00:00Z'), 'daily'), 4000);
  // An "up to" figure with a reset day is never below the 7-day-block count.
  for (let now = t('2026-11-11T00:00:00Z'); now < end; now += 5 * 3600000) {
    for (const kind of ['mon', 'wed', 'thu']) assert.ok(weeksLeft(end, now, kind) >= weeksLeft(end, now), `${kind} ${new Date(now).toISOString()}`);
  }

  // The reset day comes from the Checklist entry the shop names, with the player's own choice applied.
  const checklist = load('checklist');
  const linked = { earn: { checklistItem: 'w-ultima' } };
  const def = checklist.groups.flatMap((g) => g.items).find((i) => i.id === 'w-ultima').def;
  assert.equal(earnReset(linked, checklist, { resets: {} }), def);
  assert.equal(earnReset(linked, checklist, { resets: { 'w-ultima': 'wed' } }), 'wed');
  assert.equal(earnReset({ earn: { checklistItem: 'gone' } }, checklist, { resets: {} }), null);
  assert.equal(earnReset({ earn: {} }, checklist, { resets: {} }), null);
  assert.equal(earnReset({}, checklist, { resets: {} }), null);
  // Every link in the live shop file points at a real checklist entry.
  const ids = new Set(checklist.groups.flatMap((g) => g.items).map((i) => i.id));
  for (const s of load('shops').shops) if (s.earn && s.earn.checklistItem) assert.ok(ids.has(s.earn.checklistItem), s.id);
  // The 6-hourly job keeps the hand-typed link when it rewrites the shop.
  const old = { shops: [{ id: 'a', name: 'A Shop', end: '2027-02-09T23:59:00Z', items: [], earn: { name: 'M', perClaim: 1, perWeek: 1, max: 1, checklistItem: 'w-ultima' } }] };
  const merged = mergeShops(old, [{ id: 'x', name: 'A Shop', end: '2027-02-09T23:59:00Z', items: [], liveDate: '2026-11-20T00:00:00Z' }], t('2026-11-26T00:00:00Z'));
  assert.equal(merged.shops[0].earn.checklistItem, 'w-ultima');
});

// ---- #68 -----------------------------------------------------------------------------------------------------
test('#68 the same offer named in the plural by another post is one event', () => {
  const ev = (id, title, category, postId, extra = {}) => ({ id, title, category, postId, postName: `post ${postId}`, url: `u${postId}`, liveDate: '2026-11-10T00:00:00Z', start: '2026-11-12T00:00:00.000Z', end: '2027-02-15T23:59:00.000Z', ...extra });
  const out = dedupeEvents([ev('a', 'Genesis Pass', 'update', 47132), ev('b', 'Genesis Passes', 'sale', 47292)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].category, 'sale', 'the dedicated sale post wins, so Today treats it as a sale');
  assert.deepEqual(out[0].alsoIn.map((p) => p.postId), [47132]);
  // Either order gives the same answer.
  assert.equal(dedupeEvents([ev('b', 'Genesis Passes', 'sale', 47292), ev('a', 'Genesis Pass', 'update', 47132)])[0].id, 'b');
  // A different window, or the same post listing both, are different offers and stay apart.
  assert.equal(dedupeEvents([ev('a', 'Genesis Pass', 'update', 1), ev('b', 'Genesis Passes', 'sale', 2, { end: '2027-02-08T23:59:00.000Z', start: '2026-12-01T00:00:00.000Z' })]).length, 2);
  assert.equal(dedupeEvents([ev('a', 'Genesis Pass', 'update', 1), ev('b', 'Genesis Passes', 'update', 1)]).length, 2);
  assert.equal(dedupeEvents([ev('a', 'Genesis Pass', 'update', 1), ev('b', 'Genesis Path', 'sale', 2)]).length, 2);
  // The saved key for hidden events is unchanged.
  assert.equal(eventKey({ title: 'Genesis Passes', start: 's', end: 'e' }), 'genesispasses|s|e');
});

// ---- #75 -----------------------------------------------------------------------------------------------------
test('#75 when the app\'s files fail to start, the loading line says so', () => {
  const page = readFileSync(siteFile('index.html'), 'utf8');
  const guard = /<script>([\s\S]*?)<\/script>/.exec(page);
  assert.ok(guard, 'index.html has the inline guard');
  assert.ok(guard.index < page.indexOf('<script type="module"'), 'it runs before the app is asked for');
  const run = () => {
    const boot = { textContent: 'Loading your tracker…' };
    const handlers = {};
    const window = { addEventListener: (type, fn) => { handlers[type] = fn; } };
    const ctx = { window, document: { querySelector: () => ctx.boot }, boot };
    vm.runInNewContext(guard[1], ctx);
    return { ctx, boot, handlers, window };
  };
  let g = run();
  g.handlers.error({ target: { nodeName: 'IMG' } });
  g.handlers.error({ target: { nodeName: 'LINK' } });
  assert.equal(g.boot.textContent, 'Loading your tracker…', 'a failed picture or style sheet is not a failed start');
  g.handlers.error({ target: { nodeName: 'SCRIPT' } });
  assert.match(g.boot.textContent, /didn't load properly\. Reload the page/);
  g = run();
  g.handlers.error({ target: g.window }); // a module that does not fit the others (old and new files mixed)
  assert.match(g.boot.textContent, /Reload the page/);
  g = run();
  g.handlers.unhandledrejection({});
  assert.match(g.boot.textContent, /Reload the page/);
  // Once the app is drawn, or shows its own message, the guard leaves the page alone.
  g = run();
  g.ctx.boot = null;
  g.handlers.error({ target: { nodeName: 'SCRIPT' } });
  g = run();
  g.boot.textContent = "The tracker couldn't load its data files (x).";
  g.handlers.unhandledrejection({});
  assert.match(g.boot.textContent, /data files/);
  assert.doesNotMatch(readFileSync(siteFile('sw.js'), 'utf8'), /never mix/);
});

// ---- #76 -----------------------------------------------------------------------------------------------------
function loadWorker({ pages = {}, cached = {}, answer }) {
  const listeners = {};
  const puts = [];
  const fetched = [];
  const ctx = {
    URL,
    self: {
      location: { origin: 'https://x.test' },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting() {},
      clients: { get: async (id) => pages[id] || null, claim: async () => {} }
    },
    caches: {
      open: async () => ({ put: async (req) => { puts.push(req.url); }, addAll: async () => {} }),
      match: async (req) => cached[typeof req === 'string' ? req : req.url] || null,
      keys: async () => [],
      delete: async () => true
    },
    fetch: async (req) => { fetched.push(req.url); return answer(req); }
  };
  vm.runInNewContext(readFileSync(siteFile('sw.js'), 'utf8'), ctx);
  const get = async (url, { clientId = '', mode = 'cors' } = {}) => {
    let reply;
    listeners.fetch({ request: { method: 'GET', url, mode }, clientId, respondWith: (p) => { reply = p; } });
    return { handled: reply !== undefined, res: reply === undefined ? undefined : await reply };
  };
  return { get, puts, fetched };
}

test('#76 ?nosw switches the offline worker off: it is removed, and meanwhile passes that page straight through', async () => {
  assert.equal(workerOff('?nosw'), true);
  assert.equal(workerOff('?a=1&nosw'), true);
  assert.equal(workerOff('?nosw=1'), true);
  assert.equal(workerOff(''), false);
  assert.equal(workerOff('?noswitch=1'), false);

  // The page: with ?nosw an earlier registration is removed and the stored copies deleted; nothing is registered.
  const calls = [];
  const nav = { serviceWorker: {
    register: async (path) => { calls.push(`register ${path}`); },
    getRegistrations: async () => [{ unregister: async () => { calls.push('unregister'); } }, { unregister: async () => { calls.push('unregister'); } }]
  } };
  const cacheStore = { keys: async () => ['maple-tracker-v4', 'someone-else'], delete: async (k) => { calls.push(`delete ${k}`); } };
  assert.equal(setUpWorker(nav, '?nosw', cacheStore), 'off');
  await tick(5);
  assert.deepEqual(calls.sort(), ['delete maple-tracker-v4', 'unregister', 'unregister']);
  calls.length = 0;
  assert.equal(setUpWorker(nav, '', cacheStore), 'on');
  await tick(5);
  assert.deepEqual(calls, ['register ./sw.js']);
  assert.equal(setUpWorker({}, '?nosw', null), 'none');
  assert.equal(setUpWorker({ serviceWorker: { getRegistrations: async () => { throw new Error('blocked'); } } }, '?nosw', undefined), 'off');
  await tick(5);

  // The worker: a ?nosw page and the files it asks for are not answered from the cache and not stored.
  const stale = { ok: true, status: 200, cachedCopy: true };
  const down = { ok: false, status: 503, type: 'basic', clone() { return this; } };
  const w = loadWorker({
    pages: { off: { url: 'https://x.test/?nosw' }, normal: { url: 'https://x.test/' } },
    cached: { 'https://x.test/app/main.js': stale, 'https://x.test/': stale },
    answer: () => down
  });
  assert.equal((await w.get('https://x.test/?nosw', { mode: 'navigate' })).handled, false, 'the ?nosw address is left to the browser');
  const viaOff = await w.get('https://x.test/app/main.js', { clientId: 'off' });
  assert.equal(viaOff.res, down, 'the server\'s own answer, not the stored copy');
  // A normal page keeps the old behaviour: the last good copy instead of a server error.
  const viaNormal = await w.get('https://x.test/app/main.js', { clientId: 'normal' });
  assert.equal(viaNormal.res, stale);
  assert.equal((await w.get('https://x.test/', { mode: 'navigate' })).res, stale);

  const fresh = { ok: true, status: 200, type: 'basic', clone() { return this; } };
  const w2 = loadWorker({ pages: { off: { url: 'https://x.test/?nosw' }, normal: { url: 'https://x.test/' } }, answer: () => fresh });
  await w2.get('https://x.test/app/ui.js', { clientId: 'off' });
  await tick(5);
  assert.deepEqual(w2.puts, [], 'nothing is stored for a ?nosw page');
  await w2.get('https://x.test/app/ui.js', { clientId: 'normal' });
  await tick(5);
  assert.deepEqual(w2.puts, ['https://x.test/app/ui.js']);
});
