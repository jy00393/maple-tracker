// Seventh round, boss rewards and coin shops: Item Burning Plus boss crests, Shadow Bounties coins and the
// Challenger Coin weekly mission, all from Nexon's own posts (news 47305 and 47132, read 27 Nov 2026).
// Every test builds its own state and sets its own clock, and puts both back when it ends. Nothing waits for a
// fixed time: a page test waits until the page listens to the store, then reads it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

installFakeBrowser({});
const { html, render, useEffect } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const { bossCrests, crestWeeks, bountyWeek, bountyRange, bountyTable, bountyCoinOf, nextLevelCoins, weeklyPicks } = await import('../../site/app/calc/rewards.js');
const { coinsToCome, shopPlan, weeksLeft } = await import('../../site/app/calc/shops.js');
const { itemStatus, resetOf } = await import('../../site/app/calc/checklist.js');
const { mergeShops } = await import('../lib/shops.mjs');
const { ShopsView, earnReset, bountyIncome } = await import('../../site/app/pages/shops.js');
const { ProgressPage } = await import('../../site/app/pages/progress.js');
const { ChecklistPage } = await import('../../site/app/pages/checklist.js');
const { dedupeEvents } = await import('../../site/app/calc/events.js');
const { periodKey } = await import('../../site/app/time.js');

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const bosses = load('bosses');
const bossById = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const ibp = load('ibp');
const bounty = load('bounty');
const shops = load('shops');
const checklist = load('checklist');
const shopOf = (id) => shops.shops.find((s) => s.id === id);
const itemOf = (id) => { for (const g of checklist.groups) { const i = g.items.find((x) => x.id === id); if (i) return [i, g]; } return [null, null]; };
const picks = (spec) => ({ picks: Object.fromEntries(Object.entries(spec).map(([id, party]) => [id, { party }])), clears: {} });
const DAY = 86400000;
const FRI = Date.parse('2026-11-27T03:00:00Z'); // Friday 12:00 KST, in the bounty week that ends Wed 2 Dec 09:00 KST

const MAIN = { id: 'a', name: 'Erel', level: 264, world: 'heroic', region: 'na', mainStat: 'STR', challenger: true };
const ALT = { id: 'b', name: 'Mule', level: 210, world: 'heroic', region: 'na', mainStat: 'DEX', challenger: false };

// ---------- the data, against Nexon's tables ----------
test('ibp.json boss crests are Nexon\'s Boss Defeat Mission table, on real boss ids, with the source', () => {
  const want = {
    'lotus-normal': 50, 'lotus-hard': 150, 'damien-normal': 50, 'damien-hard': 150,
    'guardian-angel-slime-normal': 50, 'guardian-angel-slime-chaos': 175,
    'lucid-easy': 50, 'lucid-normal': 100, 'lucid-hard': 175, 'will-easy': 50, 'will-normal': 100, 'will-hard': 175,
    'gloom-normal': 150, 'gloom-chaos': 200, 'darknell-normal': 150, 'darknell-hard': 200,
    'verus-hilla-normal': 175, 'verus-hilla-hard': 200, 'kai-normal': 50, 'mayrin-normal': 200
  };
  assert.deepEqual(ibp.bossCrests, want);
  for (const id of Object.keys(ibp.bossCrests)) assert.equal(bossById[id]?.reset, 'weekly', id);
  assert.match(ibp.source, /47305/);
  assert.match(ibp.source, /2026-11-27/);
  assert.match(ibp.bossCrestsNote, /solo/);
  assert.match(ibp.bossCrestsNote, /Practice Mode/);
  assert.match(ibp.stageNote, /all earlier stages/);
  // Every stage from 2 to 11 now says what it gives.
  for (const st of ibp.stages) assert.ok(st.reward, st.id);
});

test('bounty.json: every boss row is a weekly boss, caps and reset as in the v.272 notes, with the source', () => {
  assert.deepEqual(bounty.caps, { basic: 3000, intermediate: 2000, advanced: 100 });
  assert.equal(bounty.reset, 'wed');
  assert.match(bounty.source, /47132/);
  assert.equal(bounty.read, '2026-11-27');
  for (const [id, row] of Object.entries(bounty.bosses)) {
    assert.equal(bossById[id]?.reset, 'weekly', id);
    for (const coin of ['basic', 'intermediate', 'advanced']) {
      const [lo, hi] = bountyRange(row, coin);
      assert.ok(lo <= hi && hi <= bounty.caps[coin], `${id} ${coin} within the cap`);
    }
  }
  // Spot checks against the table.
  assert.deepEqual(bountyRange(bounty.bosses['lucid-easy'], 'basic'), [1500, 2000]);
  assert.deepEqual(bountyRange(bounty.bosses['darknell-hard'], 'intermediate'), [1000, 1000]);
  assert.deepEqual(bountyRange(bounty.bosses['lotus-extreme'], 'advanced'), [30, 30]);
  assert.deepEqual(bountyRange(bounty.bosses['lotus-normal'], 'intermediate'), [0, 0]);
});

test('shops.json: Bounty shops name their coin, the Challenger Normal tab has the weekly mission, Special is left alone', () => {
  for (const coin of ['basic', 'intermediate', 'advanced']) {
    const s = shopOf(`bounty-coin-shop-${coin}-bounty-coin`);
    assert.equal(bountyCoinOf(s), coin);
    assert.equal(s.bounty.checklistItem, 'w-bounty-earn');
    assert.equal(s.earn, undefined, 'no claim-shaped earn: an older page would misread it');
  }
  const normal = shopOf('challenger-world-shop-normal');
  assert.deepEqual([normal.earn.perClaim, normal.earn.perWeek, normal.earn.max, normal.earn.checklistItem], [1500, 1, 13, 'w-cwprog']);
  assert.match(normal.earn.source, /47305/);
  assert.equal(normal.earn.levels.find((r) => r[0] === 265)[1], 300);
  assert.equal(normal.earn.levels.find((r) => r[0] === 270)[1], 600);
  assert.equal(normal.earn.levels.find((r) => r[0] === 290)[1], 2500);
  // Nexon's post does not name the Special tab's coin, so nothing was changed there.
  const special = shopOf('challenger-world-shop-special');
  assert.equal(special.currency, 'Challenger Coins');
  assert.equal(special.earn, undefined);
});

test('the job keeps the hand fields: bounty, earn (with levels) and scope survive a re-read of the posts', () => {
  const posts = load('posts').posts;
  const parsed = Object.values(posts).flatMap((p) => p.shops || []);
  assert.ok(parsed.length > 0, 'the cached posts hold parsed shops');
  const out = mergeShops(shops, parsed, FRI);
  for (const before of shops.shops) {
    const after = out.shops.find((s) => s.id === before.id);
    assert.ok(after, before.id);
    for (const k of ['bounty', 'earn', 'scope']) assert.deepEqual(after[k], before[k], `${before.id} keeps ${k}`);
  }
});

// ---------- Item Burning Plus: crests a week ----------
test('bossCrests: solo weekly picks only, one per shared clear at the best-paying difficulty', () => {
  const st = picks({ 'lucid-normal': 1, 'lucid-hard': 1, 'lotus-normal': 1, 'kai-normal': 1, 'will-hard': 2, 'zakum-normal': 1, 'black-mage-hard': 1, 'cygnus-normal': 1 });
  const r = bossCrests(ibp, st, bossById);
  assert.deepEqual(r.rows.map((x) => [x.boss.id, x.crests]), [['lucid-hard', 175], ['kai-normal', 50], ['lotus-normal', 50]]);
  assert.equal(r.total, 275);
  assert.deepEqual(r.party.map((b) => b.id), ['will-hard'], 'a party clear pays no crests and is named');
  assert.deepEqual(r.unlisted, []);
  // A difficulty Nexon's table does not list is not counted, and is named.
  const ext = bossCrests(ibp, picks({ 'lotus-extreme': 1, 'mayrin-hard': 1 }), bossById);
  assert.equal(ext.total, 0);
  assert.deepEqual(ext.unlisted.map((b) => b.id).sort(), ['lotus-extreme', 'mayrin-hard']);
  // Nothing picked, broken saved data, no table: nothing counted, nothing thrown.
  for (const bad of [undefined, null, {}, { picks: null }, { picks: 'x' }, { picks: { 'lucid-hard': null } }]) assert.ok(Number.isFinite(bossCrests(ibp, bad, bossById).total));
  assert.equal(bossCrests(ibp, { picks: { 'lucid-hard': null } }, bossById).total, 175, 'a pick without a party size is solo');
  assert.equal(bossCrests({}, st, bossById).total, 0);
});

test('crestWeeks: weeks of hunts and boss crests to the next gate', () => {
  assert.equal(crestWeeks(0, 500), 0);
  assert.equal(crestWeeks(-5, 500), 0);
  assert.equal(crestWeeks(1000, 500), 2);
  assert.equal(crestWeeks(1000, 775), 2);
  assert.equal(crestWeeks(775, 775), 1);
  assert.equal(crestWeeks(1, 0), Infinity);
});

// ---------- Shadow Bounties: coins a week ----------
test('bountyWeek: the best boss of the week, not the sum; ranges count low; caps; party picks pay nothing', () => {
  const st = picks({ 'lotus-hard': 1, 'lucid-hard': 1, 'darknell-normal': 1, 'gloom-chaos': 2 });
  const w = bountyWeek(bounty, [st], bossById);
  assert.equal(w.basic, 3000);
  assert.equal(w.intermediate, 600, 'Hard Lucid, not 200 + 600');
  assert.equal(w.best.intermediate.id, 'lucid-hard');
  assert.equal(w.advanced, 0);
  const easy = bountyWeek(bounty, [picks({ 'lucid-easy': 1, 'will-easy': 1 })], bossById);
  assert.equal(easy.basic, 1500);
  assert.equal(easy.ranged.basic, true);
  // Two characters of one world: the best of both.
  const two = bountyWeek(bounty, [picks({ 'lotus-normal': 1 }), picks({ 'darknell-hard': 1 })], bossById);
  assert.deepEqual([two.basic, two.intermediate], [3000, 1000]);
  // Caps hold even for a table figure above them.
  const big = bountyWeek({ ...bounty, bosses: { 'lotus-hard': { basic: 9000 } } }, [picks({ 'lotus-hard': 1 })], bossById);
  assert.equal(big.basic, 3000);
  assert.deepEqual([bountyWeek(null, [st], bossById).basic, bountyWeek(bounty, [], bossById).basic, bountyWeek(bounty, [undefined], bossById).basic], [0, 0, 0]);
  // The list of what each boss pays starts with the cheapest.
  const table = bountyTable(bounty, 'intermediate', bossById);
  assert.equal(table[0].lo, 200);
  assert.ok(table.every((r, i) => i === 0 || r.lo >= table[i - 1].lo));
});

test('coinsToCome for a Bounty shop: the weekly figure for every bounty week left, less this one when ticked', () => {
  const shop = shopOf('bounty-coin-shop-intermediate-bounty-coin');
  const weeks = weeksLeft(Date.parse(shop.end), FRI, 'wed');
  assert.equal(weeks, 11, 'this week plus the 10 Wednesday resets from 2 Dec to 3 Feb');
  assert.equal(coinsToCome(shop, 0, FRI, 'wed', { perWeek: 600 }), 11 * 600);
  assert.equal(coinsToCome(shop, 0, FRI, 'wed', { perWeek: 600, thisWeekDone: true }), 10 * 600);
  assert.equal(coinsToCome(shop, 0, FRI, 'wed'), 0, 'without a weekly figure nothing is counted');
  assert.equal(coinsToCome(shop, 0, Date.parse('2027-02-10T00:00:00Z'), 'wed', { perWeek: 600 }), 0, 'closed');
  assert.equal(coinsToCome(shop, 0, FRI, 'wed', { perWeek: NaN }), 0);
  const plan = shopPlan(shop, { have: 500, want: {} }, MAIN, FRI, 'wed', { perWeek: 600 });
  assert.equal(plan.total, 500 + 6600);
  // Other shops are unchanged by the new argument.
  const alliance = shopOf('alliance-credit');
  assert.equal(coinsToCome(alliance, 0, FRI, 'thu', { perWeek: 999 }), coinsToCome(alliance, 0, FRI, 'thu'));
});

test('the Challenger weekly mission: 1,500 a week up to 13, weeks from Wednesday', () => {
  const shop = shopOf('challenger-world-shop-normal');
  assert.equal(earnReset(shop, checklist, { resets: {} }), 'wed');
  assert.equal(coinsToCome(shop, 0, FRI, 'wed'), 11 * 1500);
  assert.equal(coinsToCome(shop, 3, FRI, 'wed'), 10 * 1500, 'claims already made leave 10 of 13');
  assert.equal(coinsToCome(shop, 13, FRI, 'wed'), 0);
  assert.deepEqual(nextLevelCoins(shop.earn.levels, 264), { level: 265, coins: 300 });
  assert.deepEqual(nextLevelCoins(shop.earn.levels, 269), { level: 270, coins: 600 });
  assert.equal(nextLevelCoins(shop.earn.levels, 290), null);
  assert.equal(nextLevelCoins(undefined, 264), null);
  assert.equal(nextLevelCoins(shop.earn.levels, NaN), null);
});

// ---------- Checklist rows ----------
test('Checklist: a Wednesday row for earning Bounty Coins, for every character, and the notes say what earns', () => {
  const [earn, g] = itemOf('w-bounty-earn');
  assert.ok(earn);
  assert.equal(resetOf(earn, g, { resets: {} }), 'wed');
  assert.equal(earn.only, undefined, 'not only for Challenger World');
  assert.match(earn.note, /Practice Mode/);
  assert.match(earn.note, /3,000 Basic, 2,000 Intermediate and 100 Advanced/);
  const [shopRow, shopGroup] = itemOf('w-bounty');
  assert.equal(resetOf(shopRow, shopGroup, { resets: {} }), 'thu', 'shop limits still reset Thursday');
  assert.match(itemOf('w-crest')[0].note, /boss clears pay crests/);
  assert.match(itemOf('w-cwprog')[0].note, /One of the three is enough/);
  assert.match(itemOf('w-cwprog')[0].note, /1,500/);
  assert.equal(earnReset(shopOf('bounty-coin-shop-basic-bounty-coin'), checklist, { resets: {} }), 'wed');
});

// ---------- pages in the stand-in browser ----------
const realNow = Date.now;
let clock = null;
Date.now = () => (clock === null ? realNow() : clock);
after(() => { Date.now = realNow; });
function at(t, time) {
  clock = time;
  t.after(() => { clock = null; store.resetState(); });
}
async function until(check, ms = 8000) {
  for (const end = realNow() + ms; realNow() < end;) { if (check()) return true; await tick(5); }
  return Boolean(check());
}
function pageData(extra = {}) {
  const names = { gearstats: 'gearStats', characters: 'nexonCharacters', expsources: 'expSources', bosscp: 'bossCp' };
  const data = {};
  for (const n of ['bosses', 'symbols', 'liberation', 'ibp', 'checklist', 'gear', 'erda', 'upgrades', 'potential', 'gearstats', 'events', 'news', 'characters', 'meta', 'tables', 'season', 'pitched', 'shops', 'flames', 'champions', 'expsources', 'upcoming', 'bosscp', 'classes', 'bounty']) {
    try { data[names[n] || n] = load(n); } catch { data[names[n] || n] = null; }
  }
  data.events = data.events || { events: [] };
  data.events.events = dedupeEvents(data.events.events || []);
  data.events.sunny = Array.isArray(data.events.sunny) ? data.events.sunny : [];
  data.news = data.news || { items: [] };
  data.nexonCharacters = { characters: [] };
  data.bossById = bossById;
  return { ...data, ...extra };
}
const DATA = pageData();
async function show(t, Page, mutate, data = DATA, props = {}) {
  const s = store.blankState();
  s.characters = [{ ...MAIN }, { ...ALT }];
  s.activeId = 'a';
  if (mutate) mutate(s);
  store.replaceState(s);
  const el = new FakeNode('div');
  let listening = false;
  const App = () => {
    const state = store.useStore();
    useEffect(() => { listening = true; }, []);
    return html`<${Page} data=${data} state=${state} now=${Date.now()} ...${props} />`;
  };
  t.after(() => { render(null, el); });
  render(html`<${App} />`, el);
  assert.ok(await until(() => listening), 'the page listens to the store');
  return el;
}
const text = (el) => el.text.replace(/\s+/g, ' ');

test('Progress, Item Burning: the weekly rate adds the solo weekly bosses picked on Bosses', async (t) => {
  at(t, FRI);
  const el = await show(t, ProgressPage, (s) => {
    s.ui.progressView = 'ibp';
    s.ibp = { a: { done: { s1: true, s2: true, s3: true }, crests: 500 } };
    s.bosses = { a: picks({ 'lotus-normal': 1, 'damien-normal': 1, 'lucid-normal': 1, 'will-normal': 1, 'kai-normal': 1, 'gloom-normal': 2 }) };
  });
  const x = text(el);
  // 500 hunts + Lotus 50 + Damien 50 + Lucid 100 + Will 100 + Kai 50 = 850; 250 short of 750 → 1 week.
  assert.match(x, /About 850 crests a week: 500 from the 5 weekly hunts and 350 from the solo weekly bosses picked on Bosses/);
  assert.match(x, /750 for stage 4 · ~1 week of hunts and boss crests/);
  assert.match(x, /Party clears pay no crests: Normal Gloom is set as a party/);
  assert.match(x, /a stage only completes after all earlier stages/);
  assert.doesNotMatch(x, /any order/);
  assert.match(x, /Crests per boss/);
  assert.match(x, /hunts ticked on Checklist do not add to it/);
});

test('Progress, Item Burning: no picks says hunts only and how to count bosses; an alt and a new player draw', async (t) => {
  at(t, FRI);
  let el = await show(t, ProgressPage, (s) => { s.ui.progressView = 'ibp'; s.ibp = { a: { done: {}, crests: 0 } }; });
  let x = text(el);
  assert.match(x, /500 crests a week from the 5 weekly hunts\. Solo weekly bosses pay crests too/);
  assert.match(x, /250 for stage 3 · ~1 week of hunts(?! and)/);
  render(null, el);
  el = await show(t, ProgressPage, (s) => { s.ui.progressView = 'ibp'; s.activeId = 'b'; s.characters[1].world = 'interactive'; s.characters[1].challenger = true; });
  x = text(el);
  assert.match(x, /Interactive: scroll stats raised/, 'the Interactive stage 2 reward for an Interactive character');
  render(null, el);
  el = await show(t, ProgressPage, (s) => { s.characters = []; s.activeId = null; });
  assert.match(text(el), /Add a character first/);
});

test('Coin shop, Bounty: coins to come from the best solo weekly boss of the world, less a week once ticked', async (t) => {
  at(t, FRI);
  const mutate = (s) => {
    s.ui.eventsView = 'shops';
    s.ui.shopId = 'bounty-coin-shop-intermediate-bounty-coin';
    s.shops = { 'bounty-coin-shop-intermediate-bounty-coin': { have: 100, claims: 0, want: {} } };
    // The alt is in another world (not Challenger), so its Hard Darknell does not count for the main's world.
    s.bosses = { a: picks({ 'lotus-hard': 1, 'lucid-hard': 1 }), b: picks({ 'darknell-hard': 1 }) };
  };
  let el = await show(t, ShopsView, mutate);
  let x = text(el);
  assert.match(x, /100 held as of today \+ about 6,600 still to earn/);
  assert.match(x, /Your best solo weekly boss on Bosses is Hard Lucid: 600 Intermediate Bounty Coin a week/);
  assert.match(x, /each of the 11 weeks left/);
  assert.match(x, /Wednesday 09:00 KST/);
  assert.match(x, /What each boss pays/);
  assert.doesNotMatch(x, /is not listed here/);
  render(null, el);
  // Ticked on Checklist this bounty week: this week's coins are in hand.
  const [item] = itemOf('w-bounty-earn');
  el = await show(t, ShopsView, (s) => { mutate(s); s.checklist.items[`a|${item.id}`] = { p: periodKey('wed', FRI), d: 1, t: FRI }; });
  x = text(el);
  assert.match(x, /\+ about 6,000 still to earn/);
  assert.match(x, /not this one: it is ticked on Checklist/);
});

test('bountyIncome: characters of the same world add their picks; another world does not; no data, no figure', () => {
  const state = { ...store.blankState(), characters: [MAIN, { ...MAIN, id: 'c', name: 'Two' }, ALT], bosses: { a: picks({ 'lotus-hard': 1 }), c: picks({ 'darknell-hard': 1 }), b: picks({ 'kalos-the-guardian-chaos': 1 }) } };
  const shop = shopOf('bounty-coin-shop-intermediate-bounty-coin');
  const r = bountyIncome(DATA, state, MAIN, shop, FRI);
  assert.equal(r.perWeek, 1000);
  assert.equal(r.best.id, 'darknell-hard');
  assert.equal(r.thisWeekDone, false);
  assert.equal(bountyIncome({ ...DATA, bounty: null }, state, MAIN, shop, FRI), null);
  assert.equal(bountyIncome(DATA, state, MAIN, shopOf('alliance-credit'), FRI), null);
  assert.equal(bountyIncome(DATA, state, null, shop, FRI), null);
});

test('Coin shop, Bounty without picks or data says so; Challenger Normal shows the weekly mission and next level', async (t) => {
  at(t, FRI);
  let el = await show(t, ShopsView, (s) => { s.ui.shopId = 'bounty-coin-shop-advanced-bounty-coin'; s.bosses = { a: picks({ 'lucid-hard': 1 }) }; });
  let x = text(el);
  assert.match(x, /None of the solo weekly bosses picked on Bosses pays Advanced Bounty Coin/);
  render(null, el);
  el = await show(t, ShopsView, (s) => { s.ui.shopId = 'bounty-coin-shop-basic-bounty-coin'; }, pageData({ bounty: null }));
  assert.match(text(el), /How to earn Basic Bounty Coin is not listed here/, 'without bounty.json the page falls back');
  render(null, el);
  el = await show(t, ShopsView, (s) => { s.ui.shopId = 'challenger-world-shop-normal'; });
  x = text(el);
  assert.match(x, /\+ up to 16,500 still to earn/);
  assert.match(x, /Weekly Progression Mission: 1,500 Challenger Coins per claim/);
  assert.match(x, /your next one, Lv\. 265, gives 300 Challenger Coins/);
  assert.match(x, /Weeks start on Wednesday at 09:00 KST/);
});

test('Checklist draws the bounty row on Wednesday for the main and the alt, and not for a Lv. 90', async (t) => {
  at(t, FRI);
  let el = await show(t, ChecklistPage);
  assert.match(text(el), /Shadow Bounties: beat one weekly boss solo/);
  render(null, el);
  el = await show(t, ChecklistPage, (s) => { s.activeId = 'b'; });
  assert.match(text(el), /Shadow Bounties: beat one weekly boss solo/);
  const [item, g] = itemOf('w-bounty-earn');
  assert.equal(itemStatus(item, g, store.blankState().checklist, FRI, { id: 'z', level: 90 }).locked, true);
  assert.equal(itemStatus(item, g, store.blankState().checklist, FRI, { id: 'a', level: 264 }).locked, false);
  assert.ok(weeklyPicks(undefined, bossById).solo.length === 0);
});
