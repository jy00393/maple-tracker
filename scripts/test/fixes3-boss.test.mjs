// Third round, boss area: a crystal cleared on a boss that is no longer picked, the world cap and a character's
// target, the Thursday warning on the same rule as the totals, and "1 week" on Today.
// Every test builds its own state and sets its own clock, and puts both back when it ends.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

installFakeBrowser({});
const { html, render, useEffect } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const { computeIncome, crystalValue, unpickedClears, weeklyOpen } = await import('../../site/app/calc/income.js');
const { resetWarnings } = await import('../../site/app/calc/reminders.js');
const { periodKey } = await import('../../site/app/time.js');
const { dedupeEvents } = await import('../../site/app/calc/events.js');
const { BossesPage } = await import('../../site/app/pages/bosses.js');
const { TodayPage } = await import('../../site/app/pages/today.js');
const { ProgressPage } = await import('../../site/app/pages/progress.js');

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const bosses = load('bosses');
const liberation = load('liberation');
const bossById = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const char = { id: 'a', name: 'Erel', level: 264, world: 'heroic', region: 'na', mainStat: 'STR' };
const heroic = (id, party = 1) => crystalValue(bossById[id], char, bosses, party);
const income = (picks, clears, now, c = char) => computeIncome([c], { bosses: { [c.id]: { picks, clears } } }, bosses, bossById, now).perChar[c.id];
const solo = (...ids) => Object.fromEntries(ids.map((id) => [id, { party: 1 }]));
const DAY = 86400000;
const FRI = Date.parse('2026-11-27T03:00:00Z'); // day 2 of the crystal week that starts Thu 26 Nov
const WED = Date.parse('2026-12-02T20:00:00Z'); // 4 h before the Thursday reset, same crystal week
const week = periodKey('thu', FRI);
// The best difficulty of each weekly boss, best crystal first.
const weeklyBest = bosses.bosses.filter((b) => b.reset === 'weekly' && !b.noCrystal).sort((a, b) => b.price - a.price || (a.id < b.id ? -1 : 1))
  .filter((b, i, all) => all.findIndex((o) => o.boss === b.boss) === i);
const sum = (list) => list.reduce((a, v) => a + v, 0);

// ---- pages in the stand-in browser ----
const realNow = Date.now;
let clock = null;
Date.now = () => (clock === null ? realNow() : clock);
after(() => { Date.now = realNow; });
function at(t, time) {
  clock = time;
  t.after(() => { clock = null; store.resetState(); });
}
async function until(check, ms = 5000) {
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
  data.nexonCharacters = data.nexonCharacters || { characters: [] };
  data.bossById = bossById;
  return data;
}
const DATA = pageData();
// Mounts a page on its own state and returns once it listens to the store. Taken down when the test ends.
async function show(t, Page, mutate) {
  const s = store.blankState();
  s.characters = [{ ...char }];
  s.activeId = 'a';
  mutate(s);
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
const tileText = (el, name) => {
  const tile = el.find((n) => String(n.attrs.class || n.className || '').split(' ').includes('tile') && n.text.includes(name));
  return tile ? tile.text.replace(/\s+/g, ' ') : '';
};

// ---- findings 0 and 24: a clear on a boss with no difficulty picked any more ----
test('a crystal cleared this week stays earned after the boss is unpicked altogether', () => {
  const before = income(solo('lucid-normal', 'will-hard'), { 'lucid-normal': { [week]: true } }, FRI);
  assert.equal(before.earned, heroic('lucid-normal'));
  // The Lucid pick is removed (by hand, or by "Use this list"); the tick stays saved.
  const r = income(solo('will-hard'), { 'lucid-normal': { [week]: true } }, FRI);
  assert.equal(r.earned, heroic('lucid-normal'), 'the crystal was sold this week');
  assert.equal(r.weeklyCleared, 1);
  assert.equal(r.target, heroic('lucid-normal') + heroic('will-hard'), 'earned plus what is still open');
  assert.equal(r.planned, heroic('will-hard'), 'the plan for an average week holds only what is picked');
  assert.equal(r.weeklyPicked, 1);
  assert.equal(r.weeklyUnpicked, 1);
  assert.deepEqual(r.lines.map((l) => l.bossId), ['will-hard'], 'an unpicked boss is never shown as a pick');
  assert.deepEqual(r.unpicked.map((u) => [u.boss.id, u.kind, u.earned]), [['lucid-normal', 'weekly', [heroic('lucid-normal')]]]);
  // No picks at all.
  const none = income({}, { 'lucid-hard': { [week]: true } }, FRI);
  assert.equal(none.earned, heroic('lucid-hard'));
  assert.equal(none.target, none.earned);
  assert.equal(none.planned, 0);
  // The world totals (and so the income history) keep it too.
  const world = computeIncome([char], { bosses: { a: { picks: {}, clears: { 'lucid-hard': { [week]: true } } } } }, bosses, bossById, FRI).worlds[0];
  assert.equal(world.earnedTotal, heroic('lucid-hard'));
  assert.equal(world.targetTotal, heroic('lucid-hard'));
  assert.equal(world.plannedTotal, 0);
});

test('an unpicked clear is counted once, only in its own week, and only where a crystal sells', () => {
  // Two difficulties ticked for one week (two devices): the better crystal, once.
  const two = income({}, { 'lucid-normal': { [week]: true }, 'lucid-hard': { [week]: true } }, FRI);
  assert.equal(two.earned, heroic('lucid-hard'));
  assert.equal(two.weeklyCleared, 1);
  assert.deepEqual(two.unpicked.map((u) => u.boss.id), ['lucid-hard']);
  // Picked again, on any difficulty: the line has it, the unpicked list does not.
  for (const id of ['lucid-normal', 'lucid-hard', 'lucid-easy']) {
    const again = income(solo(id), { 'lucid-normal': { [week]: true } }, FRI);
    assert.equal(again.earned, heroic('lucid-normal'), id);
    assert.equal(again.unpicked.length, 0, id);
    assert.equal(again.weeklyCleared, 1, id);
  }
  // A tick from last week, or after the reset, earns nothing now.
  assert.equal(income({}, { 'lucid-hard': { [periodKey('thu', FRI - 7 * DAY)]: true } }, FRI).earned, 0);
  assert.equal(income({}, { 'lucid-hard': { [week]: true } }, FRI + 7 * DAY).earned, 0);
  // Chaos Zakum (weekly) and Normal Zakum (daily) are separate clears: a picked daily does not hide the weekly.
  const zak = income(solo('zakum-normal'), { 'zakum-chaos': { [week]: true } }, FRI);
  assert.equal(zak.earned, heroic('zakum-chaos'));
  // A daily boss: one crystal per ticked day of this crystal week.
  const days = [0, 1, 3].map((i) => periodKey('daily', Date.parse('2026-11-26T00:00:00Z') + i * DAY));
  const marks = Object.fromEntries(days.map((k) => [k, true]));
  marks[periodKey('daily', Date.parse('2026-11-25T12:00:00Z'))] = true; // last crystal week
  const daily = income({}, { 'zakum-normal': marks }, WED);
  assert.equal(daily.earned, 3 * heroic('zakum-normal'));
  assert.equal(daily.target, daily.earned);
  assert.equal(daily.weeklyCleared, 0);
  // A monthly boss: in the week it was cleared, not in a later week of the month.
  const month = periodKey('monthly', FRI);
  assert.equal(income({}, { 'black-mage-hard': { [month]: FRI - 3600000 } }, FRI).earned, heroic('black-mage-hard'));
  assert.equal(income({}, { 'black-mage-hard': { [month]: Date.parse('2026-11-10T00:00:00Z') } }, FRI).earned, 0);
  // Either side of a month end, inside one crystal week: two crystals, as for a picked boss.
  const nov = Date.parse('2026-11-30T12:00:00Z');
  const dec = Date.parse('2026-12-01T12:00:00Z');
  assert.equal(income({}, { 'black-mage-hard': { 'monthly:2026-11': nov, 'monthly:2026-12': dec } }, dec).earned, 2 * heroic('black-mage-hard'));
  // No crystal, no entry: a boss without a crystal, and a character who cannot sell.
  const noCrystal = bosses.bosses.find((b) => b.noCrystal && b.reset === 'weekly');
  if (noCrystal) assert.equal(income({}, { [noCrystal.id]: { [week]: true } }, FRI).unpicked.length, 0);
  assert.equal(income({}, { 'lucid-hard': { [week]: true } }, FRI, { ...char, quanah: true }).unpicked.length, 0);
  // Damaged or unknown entries are ignored.
  assert.deepEqual(unpickedClears(char, { picks: { nope: {} }, clears: { nope: { [week]: true }, 'lucid-hard': null, 'will-hard': true } }, bosses, bossById, FRI), []);
  assert.deepEqual(unpickedClears(char, undefined, bosses, bossById, FRI), []);
});

test('unpicked clears keep to the 14-crystal cap', () => {
  const cap = bosses.limits.weeklyPerCharacter;
  const picked = weeklyBest.slice(0, cap);
  const extra = weeklyBest[cap]; // cheaper than every pick
  const clears = Object.fromEntries([...picked, extra].map((b) => [b.id, { [week]: true }]));
  const r = income(solo(...picked.map((b) => b.id)), clears, FRI);
  assert.equal(r.earned, sum(picked.map((b) => heroic(b.id))), 'only the 14 best crystals sell');
  assert.equal(r.target, r.earned);
  // The unpicked one is the best crystal: it takes a place, and the cheapest pick no longer adds to the target.
  const rest = weeklyBest.slice(1, cap + 1);
  const top = income(solo(...rest.map((b) => b.id)), { [weeklyBest[0].id]: { [week]: true } }, FRI);
  assert.equal(top.earned, heroic(weeklyBest[0].id));
  assert.equal(top.target, sum(weeklyBest.slice(0, cap).map((b) => heroic(b.id))));
});

test('Bosses: "Use this list" keeps a crystal already earned on a boss it drops', async (t) => {
  at(t, FRI);
  const el = await show(t, BossesPage, (s) => {
    s.characters[0].cp = 2000000000;
    s.ui.bossMargin = 1;
    s.bosses = { a: { picks: solo('zakum-chaos'), clears: { 'zakum-chaos': { [week]: true } } } };
  });
  const amount = (text) => text.match(/[\d.]+[KMB]?/)[0];
  const before = amount(tileText(el, 'Earned this week'));
  assert.notEqual(before, '0');
  const button = el.find((n) => n.localName === 'button' && /Use this list/.test(n.text));
  assert.ok(button, 'the suggestion has its button');
  button.fire('click');
  const picks = store.getState().bosses.a.picks;
  assert.equal(picks['zakum-chaos'], undefined, 'the suggestion has no Zakum, so the pick is gone');
  assert.ok(Object.keys(picks).length > 1);
  assert.equal(store.getState().bosses.a.clears['zakum-chaos'][week], true, 'the tick is kept');
  assert.ok(await until(() => /no longer picked/.test(el.text)), 'the page says where the earned crystal comes from');
  assert.equal(amount(tileText(el, 'Earned this week')), before, 'earned this week does not fall');
  assert.match(tileText(el, 'Weekly crystals'), /\b1 \/ \d+/);
  assert.match(el.text, /Chaos Zakum cleared this week, no longer picked\. Still counted as earned, as a solo clear\./);
});

test('Bosses: a cleared boss with every pick removed still shows what was earned', async (t) => {
  at(t, FRI);
  const el = await show(t, BossesPage, (s) => { s.bosses = { a: { picks: {}, clears: { 'lucid-hard': { [week]: true } } } }; });
  assert.match(el.text, /Hard Lucid cleared this week, no longer picked/);
  assert.match(tileText(el, 'Weekly crystals'), /1 \/ 1/);
  assert.doesNotMatch(tileText(el, 'Earned this week'), /Earned this week ?0 /);
});

// ---- finding 1: the world cap and one character's target ----
test('a character\'s target is never below what it earned when the world is over its cap', () => {
  const dailies = bosses.bosses.filter((b) => b.reset === 'daily' && !b.noCrystal).sort((a, b) => b.price - a.price)
    .filter((b, i, all) => all.findIndex((o) => o.boss === b.boss) === i);
  const days = Array.from({ length: 7 }, (_, i) => periodKey('daily', Date.parse('2026-11-26T00:00:00Z') + i * DAY));
  const a = { ...char, id: 'a' };
  const b = { ...char, id: 'b', name: 'Mule' };
  const state = { bosses: {
    a: { picks: solo(...dailies.map((d) => d.id)), clears: Object.fromEntries(dailies.map((d) => [d.id, Object.fromEntries(days.map((k) => [k, true]))])) },
    b: { picks: solo(...dailies.map((d) => d.id), ...weeklyBest.slice(0, 14).map((w) => w.id)), clears: {} }
  } };
  const r = computeIncome([a, b], state, bosses, bossById, WED);
  const world = r.worlds[0];
  assert.ok(world.targetDropped > 0, 'the case is over the world cap');
  const alone = computeIncome([a], state, bosses, bossById, WED).perChar.a;
  assert.equal(r.perChar.a.earned, alone.earned);
  assert.ok(r.perChar.a.target >= r.perChar.a.earned, `${r.perChar.a.target} >= ${r.perChar.a.earned}`);
  assert.equal(r.perChar.a.target + r.perChar.b.target, world.targetTotal, 'the characters add up to the world');
  assert.ok(world.targetTotal >= world.earnedTotal);
  assert.equal(world.targetCount, bosses.limits.perWorldPerWeek);
});

test('target >= earned for every character, and the parts add up, over random worlds with tight caps', () => {
  // Small caps (test-only numbers) so both caps bite in most cases.
  let seed = 20261126;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pool = bosses.bosses.filter((b) => !b.noCrystal);
  const days = Array.from({ length: 7 }, (_, i) => periodKey('daily', Date.parse('2026-11-26T00:00:00Z') + i * DAY));
  for (let run = 0; run < 400; run++) {
    const tight = { ...bosses, limits: { ...bosses.limits, weeklyPerCharacter: 1 + Math.floor(rnd() * 4), perWorldPerWeek: 1 + Math.floor(rnd() * 12) } };
    const chars = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => ({ ...char, id: 'c' + i }));
    const state = { bosses: {} };
    for (const c of chars) {
      const picks = {};
      const clears = {};
      for (const b of pool) {
        if (rnd() < 0.15) picks[b.id] = { party: 1 + Math.floor(rnd() * 3) };
        if (rnd() < 0.12) {
          clears[b.id] = b.reset === 'daily' ? Object.fromEntries(days.filter(() => rnd() < 0.5).map((k) => [k, true]))
            : b.reset === 'monthly' ? { [periodKey('monthly', WED)]: rnd() < 0.5 ? WED - 3600000 : true } : { [week]: true };
        }
      }
      state.bosses[c.id] = { picks, clears };
    }
    const r = computeIncome(chars, state, tight, bossById, WED);
    const label = `run ${run}`;
    for (const w of r.worlds) {
      assert.ok(w.targetTotal >= w.earnedTotal, label);
      assert.ok(w.earnedCount <= tight.limits.perWorldPerWeek && w.targetCount <= tight.limits.perWorldPerWeek, label);
    }
    for (const c of chars) assert.ok(r.perChar[c.id].target >= r.perChar[c.id].earned, `${label} ${c.id}: ${r.perChar[c.id].target} >= ${r.perChar[c.id].earned}`);
    assert.equal(sum(chars.map((c) => r.perChar[c.id].target)), sum(r.worlds.map((w) => w.targetTotal)), label);
    assert.equal(sum(chars.map((c) => r.perChar[c.id].earned)), sum(r.worlds.map((w) => w.earnedTotal)), label);
    // One character alone, no world cap in play: the Thursday warning is exactly target less earned (weekly part).
    const one = computeIncome([chars[0]], state, { ...tight, limits: { ...tight.limits, perWorldPerWeek: 9999 } }, bossById, WED).perChar[chars[0].id];
    const weeklyOnly = (kind) => sum(one.units[kind].map((u) => u.value)) - sum(one.lines.filter((l) => l.kind !== 'weekly').flatMap((l) => kind === 'earned' ? l.earned : [...l.earned, ...Array(l.spare ? 0 : l.kind === 'daily' ? Math.max(0, l.planned - l.cleared) : l.clearedNow || l.doneAs ? 0 : 1).fill(l.value)]))
      - sum(one.unpicked.filter((u) => u.kind !== 'weekly').flatMap((u) => u.earned));
    const open = weeklyOpen(one.lines, tight.limits.weeklyPerCharacter, one.unpicked.filter((u) => u.kind === 'weekly').flatMap((u) => u.earned));
    assert.equal(open.value, weeklyOnly('target') - weeklyOnly('earned'), label + ' warning = target - earned');
    assert.equal(open.count > 0, open.value > 0, label);
  }
});

// ---- findings 2 and 27: the Thursday warning and the totals follow one rule ----
test('the Thursday warning is what the totals say is still open', () => {
  const cap = bosses.limits.weeklyPerCharacter;
  const best = weeklyBest.slice(0, cap + 2);
  const picks = solo(...best.map((b) => b.id));
  const cheapest = [...best].reverse();
  const run = (cleared, extra = {}) => {
    const clears = { ...Object.fromEntries(cleared.map((b) => [b.id, { [periodKey('thu', WED)]: true }])), ...extra };
    const r = income(picks, clears, WED);
    const w = resetWarnings({ groups: [] }, {}, r.lines, WED, { weeklyCap: cap, weeklyEarned: r.unpicked.filter((u) => u.kind === 'weekly').flatMap((u) => u.earned) }).find((x) => x.kind === 'thu');
    return { r, w };
  };
  // The 14 cheapest cleared, the two best still open: both would sell, each in place of a cheaper crystal.
  const a = run(cheapest.slice(0, cap));
  assert.ok(a.r.target > a.r.earned);
  assert.equal(a.w.bosses.count, 2);
  assert.equal(a.w.bosses.value, a.r.target - a.r.earned);
  // The 13 cheapest cleared, three open.
  const b = run(cheapest.slice(0, cap - 1));
  assert.equal(b.w.bosses.count, 3);
  assert.equal(b.w.bosses.value, b.r.target - b.r.earned);
  // The 14 best cleared: the two open ones are worth less than every crystal that sells. Nothing to lose.
  const c = run(best.slice(0, cap));
  assert.equal(c.r.target, c.r.earned);
  assert.equal(c.w, undefined);
  // Everything cleared, and nothing cleared.
  assert.equal(run(best).w, undefined);
  const d = run([]);
  assert.equal(d.w.bosses.count, cap);
  assert.equal(d.w.bosses.value, d.r.target);
  // A crystal earned on a boss that is no longer picked takes its place under the cap too.
  const others = weeklyBest.slice(1, cap + 1);
  const r = income(solo(...others.map((x) => x.id)), { [weeklyBest[0].id]: { [periodKey('thu', WED)]: true } }, WED);
  const w = resetWarnings({ groups: [] }, {}, r.lines, WED, { weeklyCap: cap, weeklyEarned: r.unpicked.flatMap((u) => u.earned) }).find((x) => x.kind === 'thu');
  assert.equal(w.bosses.count, cap - 1);
  assert.equal(w.bosses.value, r.target - r.earned);
  // Without a cap every open boss counts in full, as before.
  const free = resetWarnings({ groups: [] }, {}, a.r.lines, WED).find((x) => x.kind === 'thu');
  assert.equal(free.bosses.count, 2);
  assert.equal(free.bosses.value, heroic(best[0].id) + heroic(best[1].id));
  // Lines made by hand without an `earned` list (older callers) still work.
  const plain = weeklyOpen([{ kind: 'weekly', value: 5, cleared: 1 }, { kind: 'weekly', value: 9, cleared: 0 }, { kind: 'daily', value: 50, cleared: 0 }], 1);
  assert.deepEqual(plain, { count: 1, value: 4 });
  assert.deepEqual(weeklyOpen(undefined, 14), { count: 0, value: 0 });
});

test('Today: the reset warning and the crystals tile agree with more than 14 weekly picks', async (t) => {
  at(t, WED);
  const cap = bosses.limits.weeklyPerCharacter;
  const best = weeklyBest.slice(0, cap + 2);
  const picks = solo(...best.map((b) => b.id));
  const clears = Object.fromEntries(best.slice(2).map((b) => [b.id, { [periodKey('thu', WED)]: true }]));
  const el = await show(t, TodayPage, (s) => { s.bosses = { a: { picks, clears } }; });
  const r = income(picks, clears, WED);
  assert.ok(r.target > r.earned);
  const warn = el.find((n) => String(n.attrs.class || '').includes('reset-warn') && /Thursday reset/.test(n.text));
  assert.ok(warn, 'the tile shows crystals still open, so the Thursday warning is there');
  assert.match(warn.text, /2 bosses uncleared/);
});

// ---- finding 20: "1 week" on Today, as on Progress ----
test('Today and Progress both say "1 week" for Genesis', async (t) => {
  at(t, FRI);
  const g = liberation.genesis;
  const last = g.stages.length - 1;
  const genesis = { stage: last, traces: g.stages[last].need - 1, picks: { 'lucid-hard': true }, pass: false };
  const today = await show(t, TodayPage, (s) => { s.liberation = { a: { genesis: structuredClone(genesis) } }; });
  assert.match(today.text, /traces? left · about 1 week(?!s)/);
  assert.doesNotMatch(today.text, /1 weeks/);
  render(null, today);
  const progress = await show(t, ProgressPage, (s) => { s.ui.progressView = 'liberation'; s.liberation = { a: { genesis: structuredClone(genesis) } }; });
  assert.match(progress.text, /About 1 week at /);
  // Several weeks stay plural on Today.
  render(null, progress);
  const far = await show(t, TodayPage, (s) => { s.liberation = { a: { genesis: { ...genesis, stage: 0, traces: 0 } } }; });
  assert.match(far.text, /about \d+ weeks/);
});
