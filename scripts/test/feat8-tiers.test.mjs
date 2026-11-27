// Challenger Points tier planner (data/challenger.json, Nexon notice 47305, read 27 Nov 2026): the data against
// the notice, the maths in calc/challenger.js, saved state (sanitise, merge), the coin shop's "still to earn", and
// the pages. Every test builds its own state and passes its own time; page tests wait until the page listens to
// the store, and wait for a condition after a change, never a fixed time.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

installFakeBrowser({});
const { html, render, useEffect } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const C = await import('../../site/app/calc/challenger.js');
const { sanitiseState } = await import('../../site/app/calc/sanitise.js');
const { mergeStates, stampEdit, units } = await import('../../site/app/calc/merge.js');
const { shopPlan } = await import('../../site/app/calc/shops.js');
const P = await import('../../site/app/pages/challenger.js');
const { ProgressPage } = await import('../../site/app/pages/progress.js');
const { whoFor } = await import('../../site/app/pages/checklist.js');
const { levelPath } = await import('../../site/app/pages/level.js');

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const cw = load('challenger');
const bosses = load('bosses');
const bossById = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const cpData = load('bosscp');
const DAY = 86400000;
const NOW = Date.parse('2026-12-01T03:00:00Z');
const END = Date.parse(cw.ends);

function loadData() {
  const data = {
    bosses, symbols: load('symbols'), liberation: load('liberation'), ibp: load('ibp'), checklist: load('checklist'),
    gear: load('gear'), erda: load('erda'), upgrades: load('upgrades'), potential: load('potential'), gearStats: load('gearstats'),
    events: { events: [], sunny: [] }, news: { items: [] }, nexonCharacters: { characters: [] }, meta: null, tables: load('tables'), season: load('season'),
    pitched: load('pitched'), shops: load('shops'), flames: load('flames'), champions: load('champions'), expSources: load('expsources'),
    upcoming: { items: [] }, bossCp: cpData, classes: load('classes'), bounty: load('bounty'), challenger: cw
  };
  data.bossById = bossById;
  return data;
}
const DATA = loadData();

// The planner's view of a character, built by hand.
const ctxOf = (over = {}) => ({
  level: 264, done: {}, higherCounts: false, cp: 30e6, margin: 1, cpData, bossById,
  who: { challenger: true, level: over.level ?? 264 }, world: 'heroic', erdaLink: true, ...over
});

// ---------- the data, against Nexon's notice ----------
test('challenger.json: source and date, nine tiers in order, Mayrin for Master and Challenger', () => {
  assert.match(cw.source, /47305/);
  assert.equal(cw.checked, '2026-11-27');
  assert.deepEqual(cw.tiers.map((t) => [t.id, t.points]), [['bronze', 5000], ['silver', 10000], ['gold', 15000], ['platinum', 20000], ['emerald', 30000], ['sapphire', 40000], ['diamond', 50000], ['master', 70000], ['challenger', 90000]]);
  assert.equal(cw.tiers.find((t) => t.id === 'master').boss, 'mayrin-normal');
  assert.equal(cw.tiers.find((t) => t.id === 'challenger').boss, 'mayrin-hard');
  assert.equal(cw.ends, load('season').ends);
});

test('challenger.json: every boss mission is a real boss; level table 260-290 sums as in the notice', () => {
  for (const [id] of cw.bosses) assert.ok(bossById[id], id);
  assert.equal(cw.bosses.length, 36);
  assert.equal(C.levelPoints(cw, 290), 36700);
  assert.equal(C.levelCoins(cw, 0, 290), 29200);
  assert.equal(cw.levels.length, 31);
  // A few rows checked one by one against the notice.
  const row = (id) => cw.bosses.find((r) => r[0] === id);
  assert.deepEqual(row('lucid-hard'), ['lucid-hard', 2000, 600, 0]);
  assert.deepEqual(row('kaling-easy'), ['kaling-easy', 9000, 3000, 60]);
  assert.deepEqual(row('mayrin-normal'), ['mayrin-normal', 5000, 1200, 10]);
});

test('challenger.json: Arcane Seal stages follow the tiers and each row of odds adds up to 100%', () => {
  const ids = cw.tiers.map((t) => t.id);
  for (const s of cw.seal.stages) {
    if (s.from) assert.ok(ids.includes(s.from), s.from);
    assert.ok(Math.abs(s.odds.reduce((a, x) => a + x, 0) - 100) < 0.02, `stage ${s.stage}`);
  }
  assert.equal(C.sealStage(cw, -1).stage, 1);
  assert.equal(C.sealStage(cw, 1).stage, 1); // Silver
  assert.equal(C.sealStage(cw, 2).stage, 2); // Gold
  assert.equal(C.sealStage(cw, 4).stage, 3); // Emerald
  assert.equal(C.sealStage(cw, 5).stage, 4); // Sapphire
  assert.equal(C.sealStage(cw, 8).stage, 5); // Challenger
});

test('the shop data still lists level coins the same as challenger.json, and is marked for mission coins', () => {
  const shop = load('shops').shops.find((s) => s.id === 'challenger-world-shop-normal');
  assert.equal(shop.earn.missions, 'challenger');
  assert.deepEqual(shop.earn.levels, cw.levels.map(([l, , c]) => [l, c]));
});

// ---------- the maths ----------
test('points now: level missions from the known level plus ticked boss missions', () => {
  const p = C.pointsNow(cw, ctxOf({ done: { 'lucid-easy': 1, 'will-easy': 1 } }));
  assert.equal(p.level, 4200);
  assert.equal(p.boss, 1000);
  assert.equal(p.total, 5200);
  assert.equal(C.pointsNow(cw, ctxOf({ level: undefined })).level, 0);
  assert.equal(C.pointsNow(cw, ctxOf({ level: 259 })).level, 0);
});

test('by default a harder clear does not complete the easier listed missions; the setting makes it so', () => {
  const done = { 'lucid-hard': 1 };
  assert.equal(C.pointsNow(cw, ctxOf({ done })).boss, 2000);
  assert.equal(C.pointsNow(cw, ctxOf({ done, higherCounts: true })).boss, 3500);
  const set = C.doneSet(cw, bossById, done, true);
  assert.ok(set.has('lucid-easy') && set.has('lucid-normal'));
  assert.ok(!set.has('will-easy'));
});

test('tier needs its Mayrin clear on top of the points', () => {
  const set = new Set();
  assert.equal(cw.tiers[C.tierIndex(cw, 75000, set)].id, 'diamond');
  assert.equal(cw.tiers[C.tierIndex(cw, 75000, new Set(['mayrin-normal']))].id, 'master');
  assert.equal(C.tierIndex(cw, 4999, set), -1);
});

test('fewestRuns: the smallest number of runs, then the smallest overshoot', () => {
  const g = (id, gain) => ({ key: id, opts: [{ run: { id }, ids: [id], gain }] });
  const r = C.fewestRuns([g('a', 3000), g('b', 2500), g('c', 1500), g('d', 1000), g('e', 300)], 4000);
  assert.equal(r.runs.length, 2);
  assert.equal(r.short, 0);
  assert.equal(r.gain, 4000); // 3000 + 1000 rather than 3000 + 2500
  const short = C.fewestRuns([g('a', 100)], 500);
  assert.equal(short.short, 400);
  assert.deepEqual(C.fewestRuns([g('a', 100)], 0), { runs: [], gain: 0, short: 0 });
});

test('planPoints counts each listed mission on its own, and bundles a boss when the setting is on', () => {
  const ctx = ctxOf({ cp: 1e12 });
  const plan = C.planPoints(cw, ctx, 3400);
  assert.equal(plan.short, 0);
  for (const r of plan.runs) assert.deepEqual(r.ids, [r.run.id]);
  const on = C.planPoints(cw, { ...ctx, higherCounts: true }, 3400);
  // Hard Lucid with the easier two is 3,500: one run.
  assert.equal(on.runs.length, 1);
  assert.ok(on.runs[0].gain >= 3400);
  assert.ok(on.runs[0].ids.length > 1);
});

test('missionState: entry level, Combat Power, no figure, nothing typed', () => {
  const m = (id) => C.bossMissions(cw, bossById).find((x) => x.id === id);
  const ctx = ctxOf();
  const set = new Set();
  assert.equal(C.missionState(m('lucid-easy'), ctx, set).status, 'can');
  assert.equal(C.missionState(m('black-mage-hard'), ctx, set).status, 'cp');
  assert.equal(C.missionState(m('kalos-the-guardian-easy'), ctx, set).status, 'level');
  assert.equal(C.missionState(m('mayrin-normal'), ctxOf({ level: 270 }), set).status, 'unknown');
  assert.equal(C.missionState(m('lucid-easy'), ctxOf({ cp: 0 }), set).status, 'nocp');
  assert.equal(C.missionState(m('lucid-easy'), ctxOf({ who: { challenger: false, level: 264 } }), set).status, 'can');
  assert.equal(C.missionState(m('kai-normal'), ctxOf({ who: { challenger: false, level: 264 } }), set).status, 'closed');
  assert.equal(C.missionState(m('lucid-easy'), ctx, new Set(['lucid-easy'])).status, 'done');
});

test('standing: the next tier and the fewest missions the character can do now', () => {
  const st = C.standing(cw, ctxOf({ done: { 'lucid-easy': 1 } }));
  assert.equal(st.points, 4700);
  assert.equal(st.tier, null);
  assert.equal(st.next.id, 'bronze');
  assert.equal(st.plan.runs.length, 1);
  assert.ok(st.plan.runs.every((r) => r.status === 'can'));
  assert.ok(st.plan.runs[0].gain >= 300);
});

test('targetPlan: levels by the season end first, then bosses, including ones a reached level opens', () => {
  const path = [{ level: 266, at: NOW + 3 * DAY }, { level: 270, at: NOW + 20 * DAY }, { level: 276, at: END + DAY }];
  const ctx = ctxOf({ cp: 1e12 });
  const tp = C.targetPlan(cw, ctx, 'emerald', path, END);
  assert.equal(tp.endLevel, 270);
  assert.equal(tp.fromLevels, C.levelPoints(cw, 270) - C.levelPoints(cw, 264));
  assert.equal(tp.need, 30000 - 4200 - tp.fromLevels);
  assert.equal(tp.short, 0);
  // Kalos (Lv. 265) and First Adversary (Lv. 270) open in time and are within this Combat Power.
  assert.ok(tp.runs.some((r) => r.status === 'level'));
  // Master asks for Normal Mayrin: always in the plan, and Mayrin has no Combat Power figure.
  const master = C.targetPlan(cw, ctx, 'master', path, END);
  assert.equal(master.forced.mission.id, 'mayrin-normal');
  assert.equal(master.forced.status, 'level');
  assert.equal(C.targetPlan(cw, ctx, 'nope', path, END), null);
});

test('earliestTier: now when the open missions are enough, else the first level that makes it possible', () => {
  const path = [{ level: 266, at: NOW + 3 * DAY }, { level: 270, at: NOW + 20 * DAY }];
  const strong = ctxOf({ cp: 1e12 });
  assert.equal(C.earliestTier(cw, strong, 'bronze', path, NOW).now, true);
  const m = C.earliestTier(cw, strong, 'master', path, NOW);
  assert.equal(m.level, 270);
  assert.equal(m.at, NOW + 20 * DAY);
  assert.equal(m.bossUnsure, true);
  // Too weak for anything but the easiest bosses, and no projection: not possible.
  assert.equal(C.earliestTier(cw, ctxOf({ cp: 1 }), 'diamond', [], NOW), null);
});

test('missionCoins: once each; HEXA left out for Erda Link; world-type missions; level coins to the end level', () => {
  const ctx = ctxOf({ cp: 0 });
  const c = C.missionCoins(cw, ctx, 266);
  assert.equal(c.level, 600);
  assert.equal(c.boss, 0); // no Combat Power typed: no boss counted
  assert.equal(c.hexaLeftOut, 3000);
  const hexa = C.missionCoins(cw, { ...ctx, erdaLink: false }, 264);
  assert.equal(hexa.hexaLeftOut, 0);
  assert.equal(hexa.seasonal - c.seasonal, 3000);
  // Heroic worlds: two equipment missions of 1,500; Interactive: two of 1,000 and two of 500.
  const equip = (world) => C.seasonalFor(cw, { world }).filter((s) => s.group === 'Equipment').map((s) => s.coins);
  assert.deepEqual(equip('heroic'), [1500, 1500]);
  assert.deepEqual(equip('interactive'), [1000, 1000, 500, 500]);
  const ticked = C.missionCoins(cw, { ...ctx, done: { 'emblem-legendary': 1 } }, 264);
  assert.equal(c.seasonal - ticked.seasonal, 1500);
  const strong = C.missionCoins(cw, ctxOf({ cp: 1e12, done: { 'lucid-easy': 1 } }), 264);
  assert.ok(strong.boss > 0 && strong.adv > 0);
});

test('sealAdvice: best at Diamond, break when the target stays below the next stage, save when it is close', () => {
  const lv290 = ctxOf({ level: 290, cp: 1e12, done: Object.fromEntries(C.bossMissions(cw, bossById).filter((m) => !/mayrin/.test(m.id)).map((m) => [m.id, 1])) });
  assert.equal(C.sealAdvice(cw, lv290, 'diamond').kind, 'best');
  // 4,200 points (no tier): Gold opens Stage 2. A Bronze target stays at Stage 1.
  assert.equal(C.sealAdvice(cw, ctxOf(), 'bronze').kind, 'break');
  assert.equal(C.sealAdvice(cw, ctxOf(), 'bronze').why, 'target');
  const strong = C.sealAdvice(cw, ctxOf({ cp: 1e12 }), 'diamond');
  assert.equal(strong.kind, 'save');
  assert.equal(strong.nextTier.id, 'gold');
  const weak = C.sealAdvice(cw, ctxOf({ cp: 1 }), 'diamond');
  assert.equal(weak.kind, 'break');
  assert.equal(weak.why, 'far');
  assert.match(P.sealText(cw, ctxOf({ cp: 1e12 }), 'diamond'), /^Save them/);
  assert.match(P.sealText(cw, ctxOf({ cp: 1 }), 'diamond'), /^Break them now/);
});

test('levelPath: one row per level reached before the end, none without a rate', () => {
  const data = DATA;
  const char = { id: 'm', name: 'M', level: 264, challenger: true, beyondBurning: false };
  const state = { ...store.blankState(), characters: [char], level: { m: { log: [{ t: NOW - 6 * DAY, level: 262, pct: 10 }, { t: NOW - DAY, level: 264, pct: 20 }] } } };
  const path = levelPath(data, state, char, NOW, END);
  assert.ok(path.length > 0);
  for (let i = 1; i < path.length; i++) assert.ok(path[i].level > path[i - 1].level && path[i].at >= path[i - 1].at);
  assert.ok(path.every((p) => p.at <= END && p.at >= NOW));
  const none = levelPath(data, { ...state, level: {} }, char, NOW, END);
  assert.deepEqual(none, []);
});

// ---------- saved state ----------
test('saved state: blank has challenger; the cleaner keeps good ticks and drops bad ones', () => {
  assert.deepEqual(store.blankState().challenger, {});
  const base = store.blankState();
  const out = sanitiseState({ challenger: { m: { done: { 'lucid-easy': 5, bad: 'x', neg: -1, inf: Infinity }, target: 'gold', extra: 1 }, n: 'oops', constructor: { done: {} } }, ui: { cwHigherCounts: 'yes' } }, base);
  assert.deepEqual(out.challenger, { m: { done: { 'lucid-easy': 5 }, target: 'gold', extra: 1 } });
  assert.ok(!('cwHigherCounts' in out.ui));
  assert.equal(sanitiseState({ ui: { cwHigherCounts: true } }, base).ui.cwHigherCounts, true);
  assert.ok(!('target' in sanitiseState({ challenger: { m: { target: 5 } } }, base).challenger.m));
  // A copy saved before this version has no challenger part: it loads as empty.
  assert.deepEqual(sanitiseState({ characters: [] }, base).challenger, {});
});

test('sync: missions ticked on two devices are both kept; the higher-clear setting is not synced', () => {
  const char = { id: 'm', name: 'M' };
  const s0 = { ...store.blankState(), characters: [char], stamps: {}, updatedAt: 1 };
  const edit = (prev, fn, t) => {
    const next = structuredClone(prev);
    fn(next);
    stampEdit(next.stamps, prev, next, t);
    next.updatedAt = t;
    return next;
  };
  const a = edit(s0, (s) => { s.challenger.m = { done: { 'lucid-easy': 100 } }; s.ui.cwHigherCounts = true; }, 1000);
  const b = edit(s0, (s) => { s.challenger.m = { done: { 'will-easy': 200 }, target: 'diamond' }; }, 2000);
  for (const m of [mergeStates(a, b, 5000), mergeStates(b, a, 5000)]) {
    assert.deepEqual(Object.keys(m.challenger.m.done).sort(), ['lucid-easy', 'will-easy']);
    assert.equal(m.challenger.m.target, 'diamond');
  }
  assert.ok(![...units(a).keys()].some((k) => k.includes('cwHigherCounts')));
  // Unticking on one device later removes it on the other.
  const a2 = edit(a, (s) => { delete s.challenger.m.done['lucid-easy']; }, 3000);
  assert.deepEqual(Object.keys(mergeStates(b, a2, 5000).challenger.m.done), ['will-easy']);
  // A deleted character takes its missions with it.
  const gone = edit(a, (s) => { s.characters = []; delete s.challenger.m; }, 4000);
  assert.ok(!mergeStates(b, gone, 5000).challenger.m);
});

test('shopPlan adds mission coins once, only while the shop is open', () => {
  const shop = { end: '2027-02-09T23:59:00Z', items: [] };
  assert.equal(shopPlan(shop, {}, null, NOW, null, undefined, 2500).toCome, 2500);
  assert.equal(shopPlan(shop, {}, null, END + DAY, null, undefined, 2500).toCome, 0);
  assert.equal(shopPlan(shop, {}, null, NOW).toCome, 0);
});

// ---------- the pages ----------
const mounted = [];
after(() => { for (const el of mounted) render(null, el); });
async function show(vnodeOf) {
  let ready = false;
  const App = () => { const state = store.useStore(); useEffect(() => { ready = true; }, []); return vnodeOf(state); };
  const el = new FakeNode('div');
  mounted.push(el);
  render(html`<${App} />`, el);
  for (const end = Date.now() + 5000; !ready && Date.now() < end;) await tick(5);
  await tick(5);
  return el;
}
async function until(fn) {
  for (const end = Date.now() + 5000; Date.now() < end;) { if (fn()) return true; await tick(5); }
  return fn();
}
const flat = (el) => el.text.replace(/\s+/g, ' ');
function setUp(extra = () => {}) {
  store.resetState();
  store.update((s) => {
    s.characters = [
      { id: 'm', name: 'Main', cls: 'Erel Light', level: 264, region: 'na', world: 'heroic', challenger: true, mainStat: 'STR', cp: 30e6 },
      { id: 'a', name: 'Alt', cls: 'Bishop', level: 210, region: 'na', world: 'interactive', challenger: false, mainStat: 'INT' }
    ];
    s.activeId = 'm';
    extra(s);
  });
}
const char = (id) => store.getState().characters.find((c) => c.id === id);

test('Progress → Challenger: tier, the check-in-game question, and a tick that adds the points', async () => {
  setUp();
  const el = await show((state) => html`<${P.ChallengerView} data=${DATA} state=${state} char=${state.characters[0]} now=${NOW} />`);
  let t = flat(el);
  assert.match(t, /4,200 points: 4,200 from levels, 0 from bosses/);
  assert.match(t, /Check in game: does a Hard clear also complete the Normal mission\?/);
  assert.match(t, /Next · Bronze 800 to go/);
  assert.match(t, /May not apply to Erda Link/);
  const box = el.find((n) => n.attrs.id === 'cw-lucid-easy');
  box.fire('change', { currentTarget: { checked: true } });
  assert.ok(await until(() => /4,700 points: 4,200 from levels, 500 from bosses/.test(flat(el))), flat(el).slice(0, 400));
  assert.ok(store.getState().challenger.m.done['lucid-easy'] > 0);
  // The rule toggle is saved on this device.
  el.find((n) => n.attrs.id === 'cw-higher').fire('change', { currentTarget: { checked: true } });
  assert.ok(await until(() => store.getState().ui.cwHigherCounts === true));
  // A target tier is saved per character.
  el.find((n) => n.attrs.id === 'cw-target').fire('change', { currentTarget: { value: 'diamond' } });
  assert.ok(await until(() => store.getState().challenger.m.target === 'diamond'));
  render(null, el);
});

test('after the season the card says it has ended and Today shows no tier line', async () => {
  setUp();
  const later = END + 2 * DAY;
  const el = await show((state) => html`<div>${html`<${P.ChallengerView} data=${DATA} state=${state} char=${state.characters[0]} now=${later} />`}<${P.ChallengerToday} data=${DATA} state=${state} char=${state.characters[0]} now=${later} /></div>`);
  const t = flat(el);
  assert.match(t, /Season 4 has ended/);
  assert.doesNotMatch(t, /Fewest boss missions/);
  render(null, el);
});

test('Today line for a Challenger character only: next tier, points to go, the fewest missions', async () => {
  setUp();
  const el = await show((state) => html`<div><${P.ChallengerToday} data=${DATA} state=${state} char=${state.characters[0]} now=${NOW} />|<${P.ChallengerToday} data=${DATA} state=${state} char=${state.characters[1]} now=${NOW} /></div>`);
  const [main, alt] = flat(el).split('|');
  assert.match(main, /Challenger tier/);
  assert.match(main, /Bronze needs 800 more\. Fewest boss missions: \w+ \w+/);
  assert.equal(alt.trim(), '');
  render(null, el);
});

test('Progress shows the Challenger view only for a Challenger character', async () => {
  setUp((s) => { s.ui.progressView = 'challenger'; });
  const el = await show((state) => html`<${ProgressPage} data=${DATA} state=${state} />`);
  // The page uses today's clock: before the season end the card, after it the ended note.
  assert.match(flat(el), Date.now() < END ? /Challenger tier .*days? left/ : /Season 4 has ended/);
  store.update((s) => { s.activeId = 'a'; });
  assert.ok(await until(() => !/Boss missions \d+ of 36/.test(flat(el)) && /Level and EXP/.test(flat(el))));
  render(null, el);
});

test('Checklist Arcane Seal row gets the advice for a Challenger character, none for others', () => {
  setUp();
  const state = store.getState();
  const who = whoFor(DATA, state, char('m'));
  assert.equal(typeof who.sealNote, 'function');
  assert.match(P.sealNoteFor(DATA, state, char('m'), NOW), /^(Save them|Break them now)/);
  assert.equal(P.sealNoteFor(DATA, state, char('a'), NOW), null);
  assert.equal(P.sealNoteFor(DATA, state, char('m'), END + DAY), null);
  assert.equal(P.sealNoteFor({ ...DATA, challenger: null }, state, char('m'), NOW), null);
});

test('damaged saved Challenger data loads cleanly and every view still draws', async () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const junk = () => [null, 0, -5, 1e300, NaN, 'x', [], {}, { done: 'no' }, { done: { 'lucid-hard': 'x', 'will-easy': 3 } }, { target: {} }, true][Math.floor(rnd() * 12)];
  for (let i = 0; i < 40; i++) {
    const raw = { ...store.blankState(), characters: [{ id: 'm', name: 'M', cls: 'Erel Light', level: [264, null, 300, 1][i % 4], challenger: true, cp: [0, 5e7, 'x'][i % 3] }], activeId: 'm' };
    raw.challenger = rnd() < 0.2 ? junk() : { m: junk(), other: junk() };
    raw.ui = { ...raw.ui, cwHigherCounts: junk(), bossMargin: junk() };
    store.replaceState(raw);
    const s = store.getState();
    assert.ok(s.challenger && typeof s.challenger === 'object');
    const el = await show((state) => html`<div><${P.ChallengerView} data=${DATA} state=${state} char=${state.characters[0]} now=${NOW} /><${P.ChallengerToday} data=${DATA} state=${state} char=${state.characters[0]} now=${NOW} /></div>`);
    assert.match(flat(el), /Challenger tier/);
    assert.doesNotMatch(flat(el), /NaN|undefined|Infinity/);
    P.sealNoteFor(DATA, s, s.characters[0], NOW);
    render(null, el);
  }
});

test('coin shop: mission coins for a Challenger character, never per week', () => {
  setUp();
  const state = store.getState();
  const c = P.challengerCoins(DATA, state, char('m'), NOW);
  assert.equal(c.total, c.level + c.boss + c.seasonal);
  assert.equal(c.hexaLeftOut, 3000); // Erel Light: Erda Link
  assert.equal(P.challengerCoins(DATA, state, char('a'), NOW), null);
  assert.equal(P.challengerCoins(DATA, state, char('m'), END + DAY), null);
});
