// The twelve findings of the re-check of the six new features (feat/top-six), one or more tests each:
//  0 Arcane Seal advice never says to save past the season end     6 Supply Report counts the login days left
//  1 fewest boss missions: the smallest overshoot, exactly          7 a non-Challenger alt keeps "Use it or lose it"
//  2 Undo never puts back half of a synced record                   8 an emptied "Mesos you have" shows its fallback
//  3 Undo after a reset puts back the streak day and income week   9 Cubes chance: nothing for a Legendary item
//  4 Undo of a removed drop or goal keeps entries synced since     10 an old-version tab keeps new Season edits
//  5 coin shop: being short is not an expiry                       11 one Defense Mission count, Today and shop
// Every test sets its own clock and state. Pages are read once they listen to the store, and after a change a test
// waits for the change itself, never a fixed time.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

const siteFile = (name) => fileURLToPath(new URL(`../../site/${name}`, import.meta.url));
installFakeBrowser({ files: { 'data/items.json': siteFile('data/items.json') } });
const { html, render, useEffect } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const C = await import('../../site/app/calc/challenger.js');
const P = await import('../../site/app/pages/challenger.js');
const sc = await import('../../site/app/calc/seasoncount.js');
const { shopPlan } = await import('../../site/app/calc/shops.js');
const { changesBetween, revertChanges } = await import('../../site/app/calc/undo.js');
const NEW = await import('../../site/app/calc/merge.js');
const LIVE = await import('./fixtures/live-merge.mjs');
const { undoable, undoLast, dismissUndo, undoTimes } = await import('../../site/app/undo.js');
const { periodKey, dayKey } = await import('../../site/app/time.js');
const { crystalWeekStart } = await import('../../site/app/calc/income.js');
const { TodayPage } = await import('../../site/app/pages/today.js');
const { ShopsView } = await import('../../site/app/pages/shops.js');
const { MesosPage } = await import('../../site/app/pages/mesos.js');
const { ExpiryWarning } = await import('../../site/app/pages/seasoncount.js');

undoTimes.ms = 600000;
const DAY = 86400000;
const load = (name) => JSON.parse(readFileSync(siteFile(`data/${name}.json`), 'utf8'));
const cw = load('challenger');
const bosses = load('bosses');
const bossById = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const cpData = load('bosscp');
const END = Date.parse(cw.ends);

// An Alliance Credit-like shop made here (tests never read the live shops.json, which the job rewrites).
const ALLIANCE = {
  id: 'test-credit', name: 'Test Credit Shop', event: 'Operation Test', currency: 'Test Credit', scope: 'Shared by every character on the account.',
  start: '2026-11-11T00:00:00.000Z', end: '2027-02-09T23:59:00.000Z',
  earn: { name: 'Defense Mission', checklistItem: 'w-ultima', counter: 'defense', perClaim: 800, perWeek: 5, max: 60, note: 'Five claims a week.' },
  items: [
    { id: 'cube', name: 'Test Cube', cost: 300, limit: 100, expires: '2027-02-10T02:00:00Z' },
    { id: 'scroll', name: 'Test Scroll', cost: 900, limit: 5, expires: '2027-02-10T02:00:00Z' },
    { id: 'erda', name: 'Test Erda', cost: 50, limit: 20, expires: '2027-02-10T02:00:00Z' },
    { id: 'early', name: 'Early Item', cost: 100, limit: 10, expires: '2027-01-01T00:00:00Z' }
  ]
};

function loadData(over = {}) {
  const data = {
    bosses, symbols: load('symbols'), liberation: load('liberation'), ibp: load('ibp'), checklist: load('checklist'),
    gear: load('gear'), erda: load('erda'), upgrades: load('upgrades'), potential: load('potential'), gearStats: load('gearstats'),
    events: { events: [], sunny: [] }, news: { items: [] }, nexonCharacters: { characters: [] }, meta: null, tables: load('tables'), season: load('season'),
    pitched: load('pitched'), shops: { source: 'test', shops: [ALLIANCE] }, flames: load('flames'), champions: load('champions'), expSources: load('expsources'),
    upcoming: { items: [] }, bossCp: cpData, classes: load('classes'), etherion: load('etherion'), bounty: load('bounty'), challenger: cw, ...over
  };
  data.bossById = bossById;
  return data;
}
const DATA = loadData();
const MAIN = { id: 'main', name: 'Main', cls: 'Erel Light', level: 264, region: 'na', world: 'heroic', challenger: true, mainStat: 'STR', beyondBurning: true };
const ALT = { id: 'alt', name: 'Alt', cls: 'Bishop', level: 210, region: 'na', world: 'interactive', challenger: false, mainStat: 'INT' };

const realNow = Date.now;
let clock = null;
Date.now = () => (clock === null ? realNow() : clock);
const mounted = new Set();
after(() => { Date.now = realNow; for (const el of mounted) render(null, el); store.resetState(); dismissUndo(); });
function at(t, time) {
  clock = typeof time === 'string' ? Date.parse(time) : time;
  store.resetState();
  dismissUndo();
  t.after(() => { clock = null; store.resetState(); dismissUndo(); });
  return clock;
}
function start(mutate = () => {}, chars = [MAIN]) {
  store.update((s) => {
    s.characters = chars.map((c) => ({ ...c }));
    s.activeId = chars.length ? chars[0].id : null;
    mutate(s);
  });
}
async function until(check, what, ms = 5000) {
  for (const end = realNow() + ms; realNow() < end;) { if (check()) return true; await tick(5); }
  assert.ok(check(), `waited for ${what}`);
  return true;
}
async function show(Page, data = DATA, extra = {}) {
  let ready = false;
  const App = () => { const state = store.useStore(); useEffect(() => { ready = true; }, []); return html`<${Page} data=${data} state=${state} ...${extra} />`; };
  const el = new FakeNode('div');
  mounted.add(el);
  render(html`<${App} />`, el);
  await until(() => ready, 'the page to listen');
  await tick(5);
  return el;
}
const close = (el) => { render(null, el); mounted.delete(el); };
const flat = (el) => el.text.replace(/\s+/g, ' ');
const ctxOf = (over = {}) => ({
  level: 264, done: {}, higherCounts: false, cp: 30e6, margin: 1, cpData, bossById,
  who: { challenger: true, level: 264 }, world: 'heroic', erdaLink: true, ...over
});

// ---- 0: Arcane Seal ---------------------------------------------------------------------------------------------
test('0. Arcane Seal: the save window is the wands kept (cap / per day) and never runs past the season end', () => {
  assert.equal(C.sealDays(cw), Math.floor(cw.seal.cap / cw.seal.perDay));
  const ctx = ctxOf({ cp: 30e6 });
  const early = C.sealAdvice(cw, ctx, 'diamond', END - Date.parse('2026-12-01T03:00:00Z'));
  assert.equal(early.kind, 'save');
  assert.equal(early.days, C.sealDays(cw));
  assert.match(P.sealText(cw, ctx, 'diamond', END - Date.parse('2026-12-01T03:00:00Z')), new RegExp(`within ${C.sealDays(cw)} days.*Only ${cw.seal.cap} wands are kept`));
  // Four days and a bit before the end: at most 4 days.
  const left = END - Date.parse('2027-02-05T00:00:00Z');
  const late = C.sealAdvice(cw, ctx, 'diamond', left);
  assert.equal(late.kind, 'save');
  assert.ok(late.days <= 4, `days ${late.days}`);
  assert.match(P.sealText(cw, ctx, 'diamond', left), /within 4 days: .*The season ends Wed 10 Feb, 08:59 KST, so don't save longer\./);
  // Under four hours left: break them now.
  for (const t of ['2027-02-09T20:00:00Z', '2027-02-09T23:50:00Z']) {
    const a = C.sealAdvice(cw, ctx, 'diamond', END - Date.parse(t));
    assert.equal(a.kind, 'break', t);
    assert.equal(a.why, 'ending', t);
    assert.match(P.sealText(cw, ctx, 'diamond', END - Date.parse(t)), /^Break them now: the Arcane Seal ends Wed 10 Feb, 08:59 KST, and wands still saved then are lost\.$/);
  }
});

test('0. Arcane Seal: the Checklist note uses the time left', () => {
  const state = store.blankState();
  state.characters = [{ ...MAIN, cp: 30e6 }];
  state.activeId = 'main';
  const note = (iso) => P.sealNoteFor(DATA, state, state.characters[0], Date.parse(iso));
  assert.match(note('2027-02-09T20:00:00Z'), /^Break them now: the Arcane Seal ends/);
  assert.doesNotMatch(note('2027-02-09T20:00:00Z'), /within \d+ days?/);
});

// ---- 1: fewest boss missions ------------------------------------------------------------------------------------
test('1. with "a harder clear counts" on, the plan takes the smallest overshoot among the fewest runs', () => {
  const ctx = ctxOf({ cp: 25e6, higherCounts: true });
  const sum = (p) => p.runs.reduce((a, r) => a + r.gain, 0);
  const silver = C.planPoints(cw, ctx, 5800);
  assert.equal(silver.runs.length, 2);
  assert.equal(sum(silver), 5900);
  assert.deepEqual(silver.runs.map((r) => r.run.id).sort(), ['damien-hard', 'darknell-hard']);
  const big = C.planPoints(cw, ctx, 14300);
  assert.equal(big.runs.length, 4);
  assert.equal(sum(big), 14400);
});

test('1. fewestRuns matches an exhaustive search on random groups', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let round = 0; round < 400; round++) {
    const groups = [];
    const nGroups = 1 + rnd(6);
    for (let g = 0; g < nGroups; g++) {
      const opts = [];
      let gain = 0;
      for (let o = 0, n = 1 + rnd(3); o < n; o++) { gain += 100 * (1 + rnd(30)); opts.push({ run: { id: `g${g}o${o}` }, ids: [`g${g}o${o}`], gain }); }
      groups.push({ key: `g${g}`, opts });
    }
    const need = 100 * (1 + rnd(80));
    // Every choice of at most one option per group.
    let best = null;
    const walk = (i, runs, gain) => {
      if (i === groups.length) {
        if (gain >= need && (!best || runs < best.runs || (runs === best.runs && gain < best.gain))) best = { runs, gain };
        return;
      }
      walk(i + 1, runs, gain);
      for (const o of groups[i].opts) walk(i + 1, runs + 1, gain + o.gain);
    };
    walk(0, 0, 0);
    const r = C.fewestRuns(groups, need);
    if (!best) { assert.ok(r.short > 0, `round ${round}`); continue; }
    assert.equal(r.short, 0, `round ${round}`);
    assert.equal(r.runs.length, best.runs, `round ${round}: runs`);
    assert.equal(r.gain, best.gain, `round ${round}: gain`);
    assert.equal(new Set(r.runs.map((o) => o.run.id.split('o')[0])).size, r.runs.length, 'one option per group');
  }
});

// ---- 2-4: Undo --------------------------------------------------------------------------------------------------
// How sync lands an edit made on another device: merged, then saved as this device's state.
function syncIn(mutate, when) {
  const other = structuredClone(store.getState());
  const before = structuredClone(other);
  mutate(other);
  NEW.stampEdit(other.stamps, before, other, when);
  other.updatedAt = when;
  store.replaceState(NEW.mergeStates(store.getState(), other, when), true);
}

test('2. Undo after a sync changed the same row keeps the synced record whole and says it was not undone', (t) => {
  const T = at(t, '2026-11-27T11:00:00Z');
  const key = 'main|d-coupon';
  const yesterday = { p: periodKey('daily', T - DAY), t: T - DAY, d: 1 };
  start((s) => { s.checklist.items[key] = yesterday; });
  undoable('Ticked a row', () => store.update((s) => { s.checklist.items[key] = { p: periodKey('daily', T), t: T, d: 1 }; }));
  clock = T + 2000;
  syncIn((s) => { s.checklist.items[key] = { p: periodKey('daily', T), t: T + 1000, d: 1 }; }, T + 1000);
  const synced = structuredClone(store.getState().checklist.items[key]);
  assert.equal(synced.t, T + 1000);
  clock = T + 3000;
  assert.deepEqual(undoLast(), { undone: 0, skipped: 1 });
  assert.deepEqual(store.getState().checklist.items[key], synced, 'never a mix of two records');
  // Without the sync, Undo puts back yesterday's record whole.
  dismissUndo();
  undoable('Unticked', () => store.update((s) => { s.checklist.items[key] = { p: periodKey('daily', T), t: T + 3000, d: 0 }; }));
  assert.deepEqual(undoLast(), { undone: 1, skipped: 0 });
  assert.deepEqual(store.getState().checklist.items[key], synced);
});

test('2. changesBetween stops at sync units: a record is one change, a character rest field is one change', () => {
  const before = { checklist: { items: { 'a|x': { p: 'daily:1', t: 1, d: 1 } } }, gear: { a: { slots: { hat: { stars: 1, pot: 1 } }, target: 1 } } };
  const after = structuredClone(before);
  after.checklist.items['a|x'] = { p: 'daily:2', t: 2, d: 1 };
  after.gear.a.slots.hat.stars = 2;
  after.gear.a.target = 2;
  const ch = changesBetween(before, after);
  assert.deepEqual(ch.map((c) => c.path.join('/')).sort(), ['checklist/items/a|x', 'gear/a/slots/hat', 'gear/a/target']);
  // Sync changed only `t` of the record: the record is left alone.
  const now = structuredClone(after);
  now.checklist.items['a|x'].t = 3;
  assert.deepEqual(revertChanges(now, ch), { undone: 2, skipped: 1 });
  assert.deepEqual(now.checklist.items['a|x'], { p: 'daily:2', t: 3, d: 1 });
  assert.deepEqual(now.gear.a, before.gear.a);
});

test('3. Undo pressed after the daily reset puts back the earlier day\'s streak entry', (t) => {
  const T = at(t, '2026-12-02T23:59:58Z'); // Thu 3 Dec, 08:59:58 KST
  const day = dayKey(T);
  start((s) => { s.checklist.history = { [day]: { done: 1, total: 4, by: 'main' } }; });
  undoable('Ticked 3 rows: Daily', () => store.update((s) => {
    for (const id of ['d-coupon', 'd-cernium', 'd-ursus']) s.checklist.items[`main|${id}`] = { p: periodKey('daily', T), t: T, d: 1 };
  }));
  // The streak recorder then saves the finished day.
  store.update((s) => { s.checklist.history[day] = { done: 4, total: 4, by: 'main' }; });
  clock = T + 4000; // 09:00:02 KST, the next day
  assert.notEqual(dayKey(clock), day);
  assert.deepEqual(undoLast(), { undone: 3, skipped: 0 });
  assert.deepEqual(store.getState().checklist.history[day], { done: 1, total: 4, by: 'main' });
});

test('3. a day that had no entry before the action loses the one the action raised; the same day is left to the recorder', (t) => {
  const T = at(t, '2026-12-02T23:59:58Z');
  const day = dayKey(T);
  start();
  undoable('Ticked a row', () => store.update((s) => { s.checklist.items['main|d-coupon'] = { p: periodKey('daily', T), t: T, d: 1 }; }));
  store.update((s) => { s.checklist.history[day] = { done: 1, total: 4, by: 'main' }; });
  clock = T + 1000; // still the same day: the recorder rewrites it, Undo does not touch it
  undoLast();
  assert.deepEqual(store.getState().checklist.history[day], { done: 1, total: 4, by: 'main' });
  dismissUndo();
  undoable('Ticked a row', () => store.update((s) => { s.checklist.items['main|d-cernium'] = { p: periodKey('daily', T), t: T, d: 1 }; }));
  store.update((s) => { s.checklist.history[day] = { done: 2, total: 4, by: 'main' }; });
  clock = T + 4000;
  undoLast();
  assert.deepEqual(store.getState().checklist.history[day], { done: 1, total: 4, by: 'main' });
});

test('3. Undo of "All cleared" pressed after the Thursday reset puts back that week\'s income', (t) => {
  const T = at(t, '2026-12-02T23:59:58Z'); // Thu 08:59:58 KST
  const week = dayKey(crystalWeekStart(T));
  start((s) => { s.incomeHistory = { [week]: { earned: 253828125, planned: 900000000 } }; });
  undoable('Cleared 2 weekly bosses', () => store.update((s) => { s.bosses.main = { picks: {}, clears: { 'lucid-hard': { k: T } } }; }));
  store.update((s) => { s.incomeHistory[week] = { earned: 464765625, planned: 900000000 }; });
  clock = T + 4000;
  assert.notEqual(dayKey(crystalWeekStart(clock)), week);
  const r = undoLast();
  assert.ok(r.undone >= 1 && r.skipped === 0, JSON.stringify(r));
  assert.deepEqual(store.getState().incomeHistory[week], { earned: 253828125, planned: 900000000 });
});

test('4. Undo of a removed pitched drop brings it back next to a drop synced in since', (t) => {
  const T = at(t, '2026-11-27T11:00:00Z');
  const d = (id, n) => ({ id, item: 'black-heart', d: `2026-11-2${n}` });
  start((s) => { s.pitch = { main: { drops: [d('d1', 1), d('d2', 2)] } }; });
  undoable('Removed a drop', () => store.update((s) => { s.pitch.main.drops = s.pitch.main.drops.filter((x) => x.id !== 'd1'); }));
  clock = T + 2000;
  syncIn((s) => { s.pitch.main.drops.push(d('d3', 3)); }, T + 1000);
  assert.deepEqual(store.getState().pitch.main.drops.map((x) => x.id), ['d2', 'd3']);
  clock = T + 3000;
  assert.deepEqual(undoLast(), { undone: 1, skipped: 0 });
  assert.deepEqual(store.getState().pitch.main.drops.map((x) => x.id), ['d1', 'd2', 'd3']);
});

test('4. Undo of a removed goal brings it back and keeps another goal changed by sync', (t) => {
  const T = at(t, '2026-11-27T11:00:00Z');
  start((s) => { s.mesos.goals = [{ id: 'g1', name: 'One', cost: 1e9 }, { id: 'g2', name: 'Two', cost: 2e9 }]; });
  undoable('Removed the goal One', () => store.update((s) => { s.mesos.goals.splice(0, 1); }));
  clock = T + 2000;
  syncIn((s) => { s.mesos.goals[0].cost = 999; }, T + 1000);
  clock = T + 3000;
  assert.deepEqual(undoLast(), { undone: 1, skipped: 0 });
  assert.deepEqual(store.getState().mesos.goals.map((g) => [g.id, g.cost]), [['g1', 1e9], ['g2', 999]]);
  // A goal the action added goes again; one changed since stays.
  dismissUndo();
  undoable('Added', () => store.update((s) => { s.mesos.goals.push({ id: 'g3', name: 'Three', cost: 3 }); }));
  undoLast();
  assert.deepEqual(store.getState().mesos.goals.map((g) => g.id), ['g1', 'g2']);
});

// ---- 5: coin shop expiry ----------------------------------------------------------------------------------------
test('5. picks a little short whose items expire after the shop closes are not flagged as expiring', async (t) => {
  const now = at(t, '2026-11-27T03:00:00Z');
  const saved = { have: 2000, claims: 20, want: { cube: 100, scroll: 5, erda: 20 } };
  const plan = shopPlan(ALLIANCE, saved, MAIN, now, 'thu');
  assert.ok(plan.short > 0, `short ${plan.short}`);
  const paidBy = sc.picksPaidBy(ALLIANCE, plan, now, 'thu');
  assert.equal(paidBy, Infinity);
  assert.deepEqual(sc.expiringPicks(plan, paidBy, Date.parse(ALLIANCE.end)), []);
  // An item that really expires while the shop is still open is still named.
  const withEarly = shopPlan(ALLIANCE, { ...saved, want: { ...saved.want, early: 1 } }, MAIN, now, 'thu');
  assert.deepEqual(sc.expiringPicks(withEarly, Infinity, Date.parse(ALLIANCE.end)).map((r) => r.item.id), ['early']);
  const el = new FakeNode('div');
  mounted.add(el);
  render(html`<${ExpiryWarning} shop=${ALLIANCE} plan=${plan} now=${now} resetKind="thu" />`, el);
  await tick(5);
  assert.doesNotMatch(flat(el), /before your picks are paid for/);
  assert.match(flat(el), /3 of your picks expire/);
  close(el);
});

// ---- 6: Supply Report and the days left -------------------------------------------------------------------------
test('6. Supply Report: one a day you log in, so the last days cap it (season.json perDay, sourced)', () => {
  const cfg = load('season').counters.supply;
  assert.equal(cfg.perDay, 1);
  assert.match(cfg.perDayQuote, /collected upon daily login.*47132/);
  const sun = Date.parse('2027-02-07T00:00:00Z');
  const p = sc.capPlan(cfg, 57, sun, sun);
  assert.equal(p.spare, 0);
  assert.equal(p.byDays, true);
  assert.equal(p.days, 3);
  const last = Date.parse('2027-02-09T12:00:00Z');
  const q = sc.capPlan(cfg, 57, last, last);
  assert.equal(q.short, true);
  assert.equal(q.reach, 58);
  // Early in the season the weeks are the limit, as before.
  const early = Date.parse('2026-11-27T00:00:00Z');
  const e = sc.capPlan(cfg, 14, early, early);
  assert.ok(!e.byDays && e.spareWeeks >= 1);
});

test('6. Today: Supply 57 on 7 Feb says to log in every day left', async (t) => {
  at(t, '2027-02-07T00:00:00Z');
  start((s) => { s.season = { supply: 57 }; }, [MAIN]);
  const el = await show(TodayPage);
  await until(() => /Supply 57 \/ 60/.test(flat(el)), 'the Supply line');
  assert.match(flat(el), /Supply 57 \/ 60: log in every day left to reach 60/);
  assert.doesNotMatch(flat(el), /Supply 57 \/ 60: you can miss/);
  close(el);
});

// ---- 7: the alt's list after the counters close -----------------------------------------------------------------
test('7. a Lv. 210 alt still sees "Use it or lose it" after the counters close, until the rewards expire', async (t) => {
  at(t, '2027-02-10T01:00:00Z');
  start(() => {}, [ALT, MAIN]);
  const el = await show(TodayPage);
  await until(() => /Supply Report and Ultima Archive rewards/.test(flat(el)), 'the expiring list');
  assert.match(flat(el), /Use it or lose it/);
  assert.doesNotMatch(flat(el), /Season counters/);
  close(el);
});

// ---- 8, 9: What your mesos buy ----------------------------------------------------------------------------------
test('8. emptying "Mesos you have" shows the planner figure it falls back to', async (t) => {
  at(t, '2026-11-27T03:00:00Z');
  start((s) => { s.ui.mesosView = 'starforce'; s.ui.sfCalc = { level: 160, from: 17, to: 22 }; s.mesos.held = 2e9; });
  const el = await show(MesosPage);
  const box = el.find((n) => n.localName === 'input' && /Mesos you have for this calculation/.test(n.attrs['aria-label'] || ''));
  const text = () => String(box.value ?? box.attrs.value ?? '');
  assert.equal(text(), '2B');
  box.value = '';
  box.fire('input', { currentTarget: box });
  box.fire('change', { currentTarget: box });
  await until(() => text() === '2B', 'the box to show the planner figure');
  assert.equal(store.getState().ui.budget.mesos, null);
  assert.match(flat(el), /with 2B/);
  close(el);
});

test('9. picking an item that is already Legendary, or has no tier, shows no tier-up chance', async (t) => {
  at(t, '2026-11-27T03:00:00Z');
  start((s) => {
    s.ui.mesosView = 'cubes';
    s.ui.cubeCalc = { from: 1, to: 2 };
    s.mesos.held = 1e9;
    s.gear = { main: { preset: 'mid', slots: { hat: { tier: 2, ilvl: 160, stars: 17, pot: 4 }, top: { tier: 2, ilvl: 150, stars: 15, pot: 0 } } } };
  });
  const el = await show(MesosPage);
  const card = () => el.findAll((n) => n.localName === 'section' && /What your mesos buy/.test(n.text))[0];
  const sel = el.find((n) => n.localName === 'select' && n.attrs['aria-label'] === 'Item for the chance');
  sel.value = 'hat';
  sel.fire('change', { currentTarget: sel });
  await until(() => /already Legendary/.test(flat(card())), 'the Legendary note');
  assert.deepEqual(store.getState().ui.cubeCalc, { from: 1, to: 2 }, 'the calculator is left as it was');
  assert.doesNotMatch(flat(card()), /\d%|under 1%|over 99%/);
  sel.value = 'top';
  sel.fire('change', { currentTarget: sel });
  await until(() => /no potential tier on Gear/.test(flat(card())), 'the no-tier note');
  assert.doesNotMatch(flat(card()), /\d%|under 1%|over 99%/);
  close(el);
});

// ---- 10: a tab still on the live version ------------------------------------------------------------------------
// A device: its saved state. An edit stamps like store.update does, with that device's own merge code.
function editOn(lib, dev, mutate, when) {
  const next = structuredClone(dev);
  mutate(next);
  next.stamps = { ...(dev.stamps || {}) };
  lib.stampEdit(next.stamps, dev, next, when);
  next.updatedAt = when;
  return next;
}
const syncOn = (lib, dev, gist, when) => (gist ? lib.mergeStates(dev, gist, when) : structuredClone(dev));

test('10. an old-version tab that edits something else does not undo Season counter and mission edits', () => {
  const T = Date.parse('2026-11-27T05:00:00Z');
  let pc = store.blankState();
  pc.characters = [{ ...MAIN }];
  pc.activeId = 'main';
  pc = editOn(NEW, pc, (s) => { s.season = { pass: 14 }; s.challenger = { main: { done: { 'will-normal': T } } }; }, T);
  let gist = syncOn(NEW, pc, null, T);
  let phone = syncOn(LIVE, store.blankState(), gist, T + 10);
  gist = phone;
  pc = syncOn(NEW, pc, gist, T + 20);
  gist = pc;
  // The new version changes both; the live one then edits something unrelated and syncs.
  pc = editOn(NEW, pc, (s) => { s.season.pass = 20; delete s.challenger.main.done['will-normal']; }, T + 60000);
  gist = pc = syncOn(NEW, pc, gist, T + 61000);
  phone = editOn(LIVE, phone, (s) => { s.mesos.held = 5e9; }, T + 120000);
  gist = phone = syncOn(LIVE, phone, gist, T + 121000);
  assert.deepEqual(phone.season, { pass: 20 }, 'the live tab takes the newer copy');
  pc = syncOn(NEW, pc, gist, T + 180000);
  assert.deepEqual(pc.season, { pass: 20 });
  assert.equal(pc.challenger.main.done['will-normal'], undefined);
  assert.equal(pc.mesos.held, 5e9, 'the live tab\'s own edit is kept');
  // Both sync again: still the same everywhere.
  gist = pc;
  phone = syncOn(LIVE, phone, gist, T + 240000);
  pc = syncOn(NEW, pc, phone, T + 241000);
  assert.deepEqual([phone.season, pc.season], [{ pass: 20 }, { pass: 20 }]);
  assert.equal(phone.challenger.main.done['will-normal'], undefined);
});

test('10. the whole-part stamps move on edits inside only, and a merge keeps the newer one', () => {
  const s0 = store.blankState();
  const s1 = structuredClone(s0);
  s1.season = { supply: 3 };
  const st = NEW.stampEdit({}, s0, s1, 1000);
  assert.ok(st.season >= 1000);
  assert.equal(st.challenger, undefined);
  const s2 = structuredClone(s1);
  s2.mesos.held = 1;
  assert.equal(NEW.stampEdit({}, s1, s2, 2000).season, undefined);
  const a = { ...structuredClone(s1), stamps: { 'season/supply': 1000, season: 1000 }, updatedAt: 1000 };
  const b = { ...structuredClone(s0), stamps: { season: 500 }, updatedAt: 3000 };
  const m = NEW.mergeStates(a, b, 4000);
  assert.deepEqual(m.season, { supply: 3 });
  assert.equal(m.stamps.season, 1000);
});

// ---- 11: one Defense Mission count ------------------------------------------------------------------------------
test('11. the shop reads the Defense Missions typed on Today: 20 done leaves 32,000 to earn, 60 leaves none', async (t) => {
  const now = at(t, '2026-11-27T03:00:00Z');
  const counts = (st) => sc.seasonCounts(DATA, st);
  start((s) => { s.season = { defense: 20 }; });
  assert.equal(counts(store.getState()).defense, 20);
  let el = await show(ShopsView, DATA, { now });
  await until(() => /up to 32,000 still to earn/.test(flat(el)), 'the shop to count 40 claims left');
  close(el);
  store.update((s) => { s.season.defense = 60; });
  el = await show(ShopsView, DATA, { now });
  await until(() => /up to 0 still to earn/.test(flat(el)), 'nothing left to earn');
  close(el);
});

test('11. a count typed in either place is the same count; older separate figures take the larger', async (t) => {
  const now = at(t, '2026-11-27T03:00:00Z');
  // Saved before the two were joined: claims 30 in the shop, 20 on Today.
  start((s) => { s.season = { defense: 20 }; s.shops = { [ALLIANCE.id]: { have: 0, claims: 30, want: {} } }; });
  assert.equal(sc.seasonCounts(DATA, store.getState()).defense, 30);
  // Checklist's "done for the season" reads the same count.
  assert.equal(sc.seasonCaps(DATA, sc.seasonCounts(DATA, { season: {}, shops: { [ALLIANCE.id]: { claims: 60 } } })).defense, true);
  const today = await show(TodayPage);
  await until(() => /Defense 30 \/ 60/.test(flat(today)), 'Today to show 30');
  close(today);
  // Lowered in the shop: both go down.
  const el = await show(ShopsView, DATA, { now });
  const box = el.find((n) => n.localName === 'input' && /Defense Missions claimed/.test(n.attrs['aria-label'] || ''));
  assert.ok(box, 'the claims stepper');
  box.value = '25';
  box.fire('input', { currentTarget: box });
  box.fire('blur', { currentTarget: box });
  await until(() => store.getState().season.defense === 25, 'the season count to follow');
  assert.equal(store.getState().shops[ALLIANCE.id].claims, 25);
  assert.equal(sc.seasonCounts(DATA, store.getState()).defense, 25);
  close(el);
});
