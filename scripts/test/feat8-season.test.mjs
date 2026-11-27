// Season counters (Pass, Supply Report, Defense Mission, Etherion) and "use it or lose it" (shop item expiry,
// the season card's expiring list, season-only growth potions). Every time here is fixed: nothing depends on
// today's date.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

const siteFile = (name) => fileURLToPath(new URL(`../../site/${name}`, import.meta.url));
installFakeBrowser({ files: { 'data/items.json': siteFile('data/items.json') } });

const { html, render, useEffect } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const { findShops, mergeShops, parseExpires, parseItemCell } = await import('../lib/shops.mjs');
const sc = await import('../../site/app/calc/seasoncount.js');
const { shopPlan } = await import('../../site/app/calc/shops.js');
const { itemStatus } = await import('../../site/app/calc/checklist.js');
const { mergeStates, units } = await import('../../site/app/calc/merge.js');
const { sanitiseState } = await import('../../site/app/calc/sanitise.js');
const { changedAt, datedPath } = await import('../../site/app/calc/asof.js');
const { TodayPage } = await import('../../site/app/pages/today.js');
const { ChecklistPage } = await import('../../site/app/pages/checklist.js');
const { ShopsView } = await import('../../site/app/pages/shops.js');
const { SeasonalPotions } = await import('../../site/app/pages/seasoncount.js');

const DAY = 86400000;
const load = (name) => JSON.parse(readFileSync(siteFile(`data/${name}.json`), 'utf8'));
function loadData(overrides = {}) {
  const data = {
    bosses: load('bosses'), symbols: load('symbols'), liberation: load('liberation'), ibp: load('ibp'), checklist: load('checklist'),
    gear: load('gear'), erda: load('erda'), upgrades: load('upgrades'), potential: load('potential'), gearStats: load('gearstats'),
    events: { events: [], sunny: [] }, news: { items: [] }, nexonCharacters: { characters: [] }, meta: null, tables: load('tables'), season: load('season'),
    pitched: load('pitched'), shops: { source: 'test', shops: [] }, flames: load('flames'), champions: load('champions'), expSources: load('expsources'),
    upcoming: { items: [] }, bossCp: load('bosscp'), classes: load('classes'), etherion: load('etherion'),
    ...overrides
  };
  data.bossById = Object.fromEntries(data.bosses.bosses.map((b) => [b.id, b]));
  return data;
}
const DATA = loadData();
const C = DATA.season.counters;
const E = DATA.etherion;

// ---- parser -------------------------------------------------------------------------------------------------
test('an item\'s own "expires" date is read; what it contains, permanent items and odd text are not', () => {
  assert.equal(parseExpires('Tradable within world, expires February 10, 2027 at 2:00 AM UTC.'), '2027-02-10T02:00:00.000Z');
  assert.equal(parseExpires('Untradable. Expires on December 16, 2026'), '2026-12-16T23:59:00.000Z', 'a date alone means the end of that day');
  assert.equal(parseExpires('Untradable, expires Jan 5, 2027 at 4:00 PM PST.'), '2027-01-06T00:00:00.000Z');
  assert.equal(parseExpires('Untradable, Permanent. Use to receive: Hat: Untradable, expires February 10, 2027 at 2:00 AM UTC.'), null, 'the contents expire, not the coupon');
  assert.equal(parseExpires('Box: Tradable. Open the box to choose one of the following: Ring: expires March 1, 2027'), null);
  assert.equal(parseExpires('Permanent Car Coupon: Tradable within world, expires February 10, 2027 at 2:00 AM UTC . Use to receive: Car: Untradable, Permanent.'), '2027-02-10T02:00:00.000Z');
  assert.equal(parseExpires('When the buff expires, the wolf howls.'), null);
  assert.equal(parseExpires('7-day duration'), null);
  assert.equal(parseExpires(''), null);
  const cell = parseItemCell('<strong>Sol Erda:</strong> Tradable within world, expires <strong>February 10, 2027 at 2:00 AM UTC</strong>.');
  assert.deepEqual(cell, { name: 'Sol Erda', expires: '2027-02-10T02:00:00.000Z' });
  assert.deepEqual(parseItemCell('<strong>Sol Erda Fragment:</strong> Untradable, Permanent.'), { name: 'Sol Erda Fragment' });
});

const post = { id: 901, name: 'v.999 Patch Notes', category: 'update', liveDate: '2026-11-10T15:30:00Z' };
const BODY = `
<h2>Moon Coin Shop</h2>
<p>November 11, 2026 (after maintenance) - February 9, 2027 at 11:59 PM UTC</p>
<table><tbody>
<tr><th>Item</th><th>Price (Moon Coin)</th><th>Qty. Limit</th></tr>
<tr><td><strong>Sol Erda:</strong> Tradable within world, expires <strong>February 10, 2027 at 2:00 AM UTC</strong>.</td><td>300</td><td>5</td></tr>
<tr><td><strong>Sol Erda Fragment (x10):</strong> Untradable, Permanent.</td><td>200</td><td>10</td></tr>
<tr><td><strong>Ring Coupon:</strong> Tradable within world, Permanent. <p>Use to receive:</p><ul><li><strong>Ring:</strong> Untradable, expires December 16, 2026 at 2:00 AM UTC.</li></ul></td><td>50</td><td>1</td></tr>
<tr><td><strong>Early Scroll</strong>: Untradable, expires on December 16, 2026 at 2:00 AM UTC.</td><td>10</td><td>3</td></tr>
</tbody></table>`;

test('the shop parser keeps each item\'s expiry date', () => {
  const [shop] = findShops(BODY, post);
  const by = Object.fromEntries(shop.items.map((i) => [i.name, i.expires || null]));
  assert.deepEqual(by, { 'Sol Erda': '2027-02-10T02:00:00.000Z', 'Sol Erda Fragment (x10)': null, 'Ring Coupon': null, 'Early Scroll': '2026-12-16T02:00:00.000Z' });
});

test('mergeShops keeps a hand-typed expiry when the post gives none, and takes the post\'s date otherwise', () => {
  const [parsed] = findShops(BODY, post);
  const now = Date.parse('2026-11-27T00:00:00Z');
  const first = mergeShops({ shops: [] }, [parsed], now);
  const typed = structuredClone(first);
  const ring = typed.shops[0].items.find((i) => i.name === 'Ring Coupon');
  ring.expires = '2027-01-01T00:00:00Z';
  const scroll = typed.shops[0].items.find((i) => i.name === 'Early Scroll');
  scroll.expires = '2030-01-01T00:00:00Z';
  const again = mergeShops(typed, [parsed], now);
  const items = Object.fromEntries(again.shops[0].items.map((i) => [i.name, i]));
  assert.equal(items['Ring Coupon'].expires, '2027-01-01T00:00:00Z', 'the hand field stays');
  assert.equal(items['Early Scroll'].expires, '2026-12-16T02:00:00.000Z', "Nexon's own date wins");
  assert.equal(items['Ring Coupon'].id, ring.id);
});

test('the parser version was raised so cached posts are read again', () => {
  const src = readFileSync(fileURLToPath(new URL('../update-data.mjs', import.meta.url)), 'utf8');
  assert.ok(Number(/const PARSER_VERSION = (\d+)/.exec(src)[1]) >= 7);
});

test('the shipped shops carry the expiry dates from the posts, and Sol Erda Fragments none', () => {
  const shops = load('shops').shops;
  const all = shops.flatMap((s) => s.items);
  assert.ok(all.filter((i) => i.expires).length >= 50);
  for (const i of all) if (/^Sol Erda Fragment/.test(i.name)) assert.equal(i.expires, undefined);
  for (const i of all) if (i.expires) assert.ok(Number.isFinite(Date.parse(i.expires)));
});

// ---- counters -----------------------------------------------------------------------------------------------
test('Challenger Pass: the Lv. 30 date at 500 points a week, counting the week the level was typed', () => {
  const at = Date.parse('2026-11-26T01:00:00Z'); // just after the Thursday reset
  const p = sc.passPlan(C.pass, 14, at, at + DAY);
  assert.equal(p.need, 1600);
  assert.equal(p.weeks, 4);
  assert.equal(new Date(p.by).toISOString(), '2026-12-24T00:00:00.000Z');
  assert.equal(p.due, false);
  assert.equal(sc.passPlan(C.pass, 14, at, Date.parse('2026-12-25T00:00:00Z')).due, true, 'past the date: type it again');
  assert.deepEqual(sc.passPlan(C.pass, 30, at, at), { done: true });
  const late = Date.parse('2027-01-28T01:00:00Z');
  const s = sc.passPlan(C.pass, 2, late, late);
  assert.equal(s.short, true);
  assert.ok(s.reach < 30 && s.reach > 2);
  assert.equal(sc.passPlan(C.pass, undefined, at, at), null);
  // The last week runs past the season's end: the date is the end itself.
  const p2 = sc.passPlan(C.pass, 25, Date.parse('2027-02-05T00:00:00Z'), Date.parse('2027-02-05T00:00:00Z'));
  assert.equal(p2.by, Date.parse(C.pass.ends));
});

test('Supply and Defense: how many more weeks can be missed, and when 60 is out of reach', () => {
  const at = Date.parse('2026-11-27T00:00:00Z');
  const s = sc.capPlan(C.supply, 14, at, at);
  assert.equal(s.weeks, 11);
  assert.equal(s.left, 46);
  assert.equal(s.spare, 9);
  assert.equal(s.spareWeeks, 1);
  assert.deepEqual(sc.capPlan(C.supply, 60, at, at), { done: true });
  const late = sc.capPlan(C.supply, 10, Date.parse('2027-01-20T00:00:00Z'), Date.parse('2027-01-20T00:00:00Z'));
  assert.equal(late.short, true);
  assert.equal(late.reach, 10 + late.weeks * 5);
  // Defense follows the reset day of its Checklist row: Thursday weeks from a Friday.
  const fri = Date.parse('2026-11-27T05:00:00Z');
  const d = sc.capPlan(C.defense, 20, fri, fri, 'thu');
  assert.equal(d.weeks, 11);
  assert.equal(d.spare, 15);
  assert.equal(d.spareWeeks, 3);
  // Counted from the day it was typed: the answer does not drift while the page stays open.
  assert.deepEqual(sc.capPlan(C.defense, 20, fri, fri + 20 * DAY, 'thu'), d);
});

test('Etherion: completions, the next unlock and the expected cost of a core level', () => {
  const p = sc.etherionPlan(E, 3, 3);
  assert.equal(p.left, 9);
  assert.equal(p.coresOpen, 2);
  assert.equal(p.cores, 6);
  assert.equal(p.next.n, 4);
  assert.equal(p.next.core, true);
  assert.equal(Math.round(p.step.avg), 250);
  assert.equal(Math.round(p.toFive), 917);
  assert.equal(Math.round(sc.coreCost(E, 1, 5)), 988);
  assert.equal(Math.round(sc.coreCost(E, 5, 6)), 3000);
  assert.equal(sc.etherionPlan(E, 12, 6).finished, true);
  assert.equal(sc.etherionPlan(E, 12, 6).step, null);
  assert.equal(sc.etherionPlan(E, undefined, undefined).known, false);
  // The table's combined level: every core at Lv. 5.
  assert.equal(E.medal.combinedLevel, p.cores * 5);
});

test('a reached cap marks its checklist rows done for the season, from the item\'s own field', () => {
  const groups = DATA.checklist.groups;
  const capped = groups.flatMap((g) => g.items.filter((i) => i.seasonCap).map((i) => [i.seasonCap, i.id]));
  assert.ok(capped.length >= 3);
  for (const [cap] of capped) assert.ok(['pass', 'supply', 'defense', 'etherion'].includes(cap));
  const caps = sc.seasonCaps(DATA, { pass: 30, defense: 60, ether: 12, supply: 59 });
  assert.deepEqual(caps, { pass: true, supply: false, defense: true, etherion: true });
  const now = Date.parse('2026-12-01T00:00:00Z');
  const cs = { items: {}, resets: {}, flags: {}, history: {}, owner: null, ownerSet: true };
  const who = { id: 'main', level: 264, challenger: true, caps };
  for (const g of groups) for (const item of g.items) {
    if (!item.seasonCap) continue;
    const st = itemStatus(item, g, cs, now, who);
    assert.equal(st.done, caps[item.seasonCap], item.id);
    if (st.seasonDone && item.type === 'count') assert.equal(st.count, item.target);
    const off = itemStatus(item, g, cs, now, { ...who, caps: { ...caps, [item.seasonCap]: false } });
    assert.ok(!off.seasonDone, item.id);
  }
});

// ---- saved data ---------------------------------------------------------------------------------------------
test('saved counters are cleaned: in range, whole numbers, unknown fields kept, junk dropped', () => {
  assert.deepEqual(sc.cleanSeason({ pass: 14.7, supply: 61, defense: -1, ether: '3', core: 0, later: { x: 1 }, __proto__: { bad: 1 } }), { pass: 14, later: { x: 1 } });
  assert.deepEqual(sc.cleanSeason(null), {});
  assert.deepEqual(sc.cleanSeason([1, 2]), {});
  const s = sanitiseState({ season: { pass: 3, core: 6 } }, store.blankState());
  assert.deepEqual(s.season, { pass: 3, core: 6 });
  assert.deepEqual(sanitiseState({}, store.blankState()).season, {});
  assert.ok(datedPath('season/pass'));
});

test('two devices that each typed a different counter both keep theirs; the same counter goes to the newer edit', () => {
  const base = { ...store.blankState(), updatedAt: 1000, stamps: {} };
  const a = { ...structuredClone(base), season: { pass: 10, supply: 20 }, stamps: { 'season/pass': 2000, 'season/supply': 2000 }, updatedAt: 2000 };
  const b = { ...structuredClone(base), season: { pass: 12, ether: 4 }, stamps: { 'season/pass': 3000, 'season/ether': 3000 }, updatedAt: 3000 };
  const now = 10000;
  const m1 = mergeStates(a, b, now);
  const m2 = mergeStates(b, a, now);
  assert.deepEqual(m1.season, { pass: 12, supply: 20, ether: 4 });
  assert.deepEqual(m2.season, m1.season);
  // A counter cleared on one device after it was typed on the other is gone on both.
  const c = { ...structuredClone(m1), season: { pass: 12, ether: 4 }, stamps: { ...m1.stamps, 'season/supply': 4000 }, updatedAt: 4000 };
  assert.deepEqual(mergeStates(m1, c, now).season, { pass: 12, ether: 4 });
  assert.deepEqual([...units({ season: { pass: 1, x: null } }).keys()], ['season/pass']);
});

test('a typed counter gets its own "as of" date, and retyping the same number moves only that date', async () => {
  const realNow = Date.now;
  try {
    let t = Date.parse('2026-12-01T00:00:00Z');
    Date.now = () => t;
    store.resetState();
    store.update((s) => { s.season.supply = 20; s.season.pass = 9; });
    assert.equal(changedAt(store.getState(), 'season/supply', t), t);
    t += 3 * DAY;
    store.touch('season/supply');
    assert.equal(changedAt(store.getState(), 'season/supply', t), t);
    assert.equal(changedAt(store.getState(), 'season/pass', t), t - 3 * DAY);
  } finally { Date.now = realNow; store.resetState(); }
});

// ---- expiring -----------------------------------------------------------------------------------------------
const SHOP = {
  id: 'moon', name: 'Moon Coin Shop', currency: 'Moon Coin', start: '2026-11-11T00:00:00Z', end: '2027-02-09T23:59:00Z',
  earn: { name: 'Moon mission', perClaim: 100, perWeek: 2, max: 30 },
  items: [
    { id: 'sol-erda', name: 'Sol Erda', cost: 300, limit: 5, expires: '2027-02-10T02:00:00Z' },
    { id: 'frag', name: 'Sol Erda Fragment (x10)', cost: 200, limit: 10 },
    { id: 'early', name: 'Early Scroll', cost: 10, limit: 3, expires: '2026-12-16T02:00:00Z' }
  ]
};

test('picks are paid for at the pace the planner counts; a pick that expires first is flagged', () => {
  const now = Date.parse('2026-12-01T00:00:00Z'); // a Tuesday
  const plan = shopPlan(SHOP, { have: 0, claims: 0, want: { 'sol-erda': 2, early: 3 } }, null, now, 'thu');
  assert.equal(plan.need, 630);
  const by = sc.picksPaidBy(SHOP, plan, now, 'thu');
  // 200 coins a week: 4 weeks counting this one, so by the Thursday reset of the 4th week.
  assert.equal(new Date(by).toISOString(), '2026-12-24T00:00:00.000Z');
  assert.deepEqual(sc.expiringPicks(plan, by).map((r) => r.item.id), ['early']);
  const rich = shopPlan(SHOP, { have: 1000, claims: 0, want: { 'sol-erda': 2, early: 3 } }, null, now, 'thu');
  assert.equal(sc.picksPaidBy(SHOP, rich, now, 'thu'), now);
  assert.deepEqual(sc.expiringPicks(rich, now), []);
  const greedy = shopPlan(SHOP, { have: 0, claims: 29, want: { 'sol-erda': 5 } }, null, now, 'thu');
  assert.equal(sc.picksPaidBy(SHOP, greedy, now, 'thu'), Infinity);
  // No weekly reset day: 7-day blocks counted back from the close.
  const blocks = sc.picksPaidBy(SHOP, plan, now, null);
  assert.ok(blocks > now && blocks <= Date.parse(SHOP.end));
});

test('what expires within 3 weeks: the hand list and shop items, filtered by character', () => {
  const data = loadData({ shops: { source: 't', shops: [SHOP, { ...SHOP, id: 'cw', name: 'Challenger World Shop: Normal' }] } });
  const now = Date.parse('2026-12-01T00:00:00Z');
  const main = { level: 264, challenger: true, world: 'heroic' };
  const g = sc.expiringSoon(data, { moon: { have: 0, claims: 0, want: { early: 2 } } }, main, now);
  assert.equal(g.length, 1);
  assert.equal(new Date(g[0].at).toISOString(), '2026-12-16T02:00:00.000Z');
  assert.deepEqual(g[0].hand.map((h) => h.id).sort(), ['reset-scrolls', 'specter-coupons']);
  assert.deepEqual(g[0].picks.map((p) => [p.shop.id, p.item.id, p.want]), [['moon', 'early', 2]]);
  assert.deepEqual(g[0].shops.map((x) => x.name), ['Challenger World Shop: Normal']);
  // A Lv. 210 alt outside Challenger World: no Lv. 260 entries, no Challenger shop.
  const alt = sc.expiringSoon(data, {}, { level: 210, challenger: false, world: 'interactive' }, now);
  assert.equal(alt.length, 1);
  assert.deepEqual(alt[0].hand, []);
  assert.deepEqual(alt[0].shops.map((x) => x.name), ['Moon Coin Shop']);
  // Three weeks before the season's last day the February items appear; after it nothing does.
  const feb = sc.expiringSoon(data, {}, main, Date.parse('2027-01-25T00:00:00Z'));
  assert.ok(feb.some((x) => x.hand.some((h) => h.id === 'supply-rewards')));
  assert.deepEqual(sc.expiringSoon(data, {}, main, Date.parse('2027-02-11T00:00:00Z')), []);
  for (const e of data.season.expiring) assert.ok(e.source && e.quote && Number.isFinite(Date.parse(e.at)), e.id);
});

test('season-only growth potions: worth most at the top of their range, gone after they expire', () => {
  const src = DATA.expSources;
  const now = Date.parse('2026-12-01T00:00:00Z');
  assert.deepEqual(sc.seasonalPotions(src, 264, now).map((p) => p.to), [279, 269]);
  assert.deepEqual(sc.seasonalPotions(src, 275, now).map((p) => p.to), [279]);
  assert.deepEqual(sc.seasonalPotions(src, 280, now), []);
  assert.deepEqual(sc.seasonalPotions(src, 264, Date.parse('2027-02-11T00:00:00Z')), []);
  const el = new FakeNode('div');
  render(html`<${SeasonalPotions} data=${DATA} level=${264} now=${now} />`, el);
  const text = el.text.replace(/\s+/g, ' ');
  assert.match(text, /Growth Potion \(200 - 279\) \(Supply Report level 60\) expires Wed 10 Feb, 11:00 KST\. It is worth the most at Lv\. 279/);
  assert.match(text, /Beyond Burning/);
  render(null, el);
});

// ---- pages --------------------------------------------------------------------------------------------------
const mounted = [];
const realNow = Date.now;
after(() => { Date.now = realNow; for (const el of mounted) render(null, el); store.resetState(); });

async function show(Page, data = DATA, extra = {}) {
  let ready = false;
  const App = () => { const state = store.useStore(); useEffect(() => { ready = true; }, []); return html`<${Page} data=${data} state=${state} ...${extra} />`; };
  const el = new FakeNode('div');
  mounted.push(el);
  render(html`<${App} />`, el);
  for (const end = realNow() + 5000; !ready && realNow() < end;) await tick(5);
  await tick(5);
  return el;
}
async function until(fn, ms = 3000) {
  for (const end = realNow() + ms; realNow() < end; await tick(5)) if (fn()) return true;
  return fn();
}
const flat = (el) => el.text.replace(/\s+/g, ' ');
const MAIN = { id: 'main', name: 'Main', cls: 'Erel Light', level: 264, region: 'na', world: 'heroic', challenger: true, mainStat: 'STR', beyondBurning: true };
const ALT = { id: 'alt', name: 'Alt', cls: 'Bishop', level: 210, region: 'na', world: 'interactive', challenger: false, mainStat: 'INT' };

function at(iso) { const t = Date.parse(iso); Date.now = () => t; return t; }

test('Today: the Lv. 264 Challenger main sees each counter as a number and an answer', async () => {
  at('2026-11-27T00:00:00Z');
  store.resetState();
  store.update((s) => { s.characters = [MAIN, ALT]; s.activeId = 'main'; s.season = { pass: 14, supply: 14, defense: 20, ether: 3, core: 3 }; });
  const el = await show(TodayPage);
  const text = flat(el);
  assert.match(text, /Season counters/);
  assert.match(text, /Pass Lv\. 14: Lv\. 30 by 24 Dec if each week is maxed/);
  assert.match(text, /Supply 14 \/ 60: you can miss 1 more login week/);
  assert.match(text, /Defense 20 \/ 60: you can miss 3 more hunting weeks/);
  assert.match(text, /Etherion 3 of 12: 9 to go/);
  assert.match(text, /Core Lv\. 3: Lv\. 4 needs about 250 Etherion on average/);
  assert.match(text, /as of today/);
  // The season card is folded to one line this far from its first deadline (feat8/daily); the line names the
  // soonest thing that expires, and opening it shows the whole "Use it or lose it" list.
  assert.match(text, /Expiring soon: HEXA Matrix and Erda Link Reset Scrolls on /);
  assert.doesNotMatch(text, /undefined|NaN|null/);
  el.find((n) => n.localName === 'button' && /^Show all \d+ steps$/.test(n.text.trim())).fire('click');
  assert.ok(await until(() => /Use it or lose it/.test(flat(el))), 'the opened season card lists what expires');
  assert.match(flat(el), /HEXA Matrix and Erda Link Reset Scrolls/);
  assert.doesNotMatch(flat(el), /undefined|NaN|null/);
});

test('Today: typing a count saves it for the account and the line answers', async () => {
  at('2026-11-27T00:00:00Z');
  store.resetState();
  store.update((s) => { s.characters = [MAIN]; s.activeId = 'main'; });
  const el = await show(TodayPage);
  assert.match(flat(el), /type your count below/);
  const box = el.find((n) => n.localName === 'input' && n.attrs['aria-label'] === 'Supply Report collections');
  box.value = '59';
  box.fire('input', { currentTarget: box });
  assert.ok(await until(() => store.getState().season.supply === 59));
  assert.ok(await until(() => /Supply 59 \/ 60/.test(flat(el))));
  box.value = '60';
  box.fire('input', { currentTarget: box });
  assert.ok(await until(() => /Supply 60 \/ 60: done for the season/.test(flat(el))));
  box.value = '';
  box.fire('input', { currentTarget: box });
  assert.ok(await until(() => !Object.hasOwn(store.getState().season, 'supply')));
});

test('Today: a Lv. 210 alt outside Challenger World gets no Pass line; a new player gets no card', async () => {
  at('2026-12-01T00:00:00Z');
  store.resetState();
  store.update((s) => { s.characters = [ALT]; s.activeId = 'alt'; s.season = { pass: 14, supply: 30 }; });
  let el = await show(TodayPage);
  let text = flat(el);
  assert.match(text, /Season counters/);
  assert.doesNotMatch(text, /Pass Lv\./);
  assert.match(text, /Supply 30 \/ 60/);
  assert.doesNotMatch(text, /Reset Scrolls/, 'the alt is below Lv. 260');
  render(null, el);
  store.resetState();
  el = await show(TodayPage);
  text = flat(el);
  assert.doesNotMatch(text, /Season counters/);
  assert.doesNotMatch(text, /undefined|NaN/);
  render(null, el);
  // After the season the card is gone.
  at('2027-02-11T00:00:00Z');
  store.update((s) => { s.characters = [MAIN]; s.activeId = 'main'; s.season = { pass: 14 }; });
  el = await show(TodayPage);
  assert.doesNotMatch(flat(el), /Season counters/);
});

test('Checklist: rows whose cap is reached read done for the season', async () => {
  at('2026-12-01T00:00:00Z');
  store.resetState();
  store.update((s) => { s.characters = [MAIN]; s.activeId = 'main'; s.season = { pass: 30, defense: 60 }; });
  const el = await show(ChecklistPage);
  const isRow = (n) => typeof n.attrs.class === 'string' && n.attrs.class.split(' ').includes('row');
  const rows = el.findAll((n) => isRow(n) && /Challenger Pass weekly missions|Ultima weekly hunt|Spend new Training Cards/.test(n.text));
  assert.equal(rows.length, 3);
  for (const r of rows) assert.match(r.text, /done for the season/);
  const eth = el.find((n) => isRow(n) && /Etherion Relics/.test(n.text));
  assert.doesNotMatch(eth.text, /done for the season/);
});

test('Coin shop: expiring items are marked, and a pick that expires before it is paid for is flagged', async () => {
  at('2026-12-01T00:00:00Z');
  store.resetState();
  store.update((s) => { s.characters = [MAIN]; s.activeId = 'main'; s.shops = { moon: { have: 0, claims: 0, want: { 'sol-erda': 2, early: 3 } } }; });
  const data = loadData({ shops: { source: 't', shops: [SHOP] } });
  const el = await show(ShopsView, data, { now: Date.parse('2026-12-01T00:00:00Z') });
  const text = flat(el);
  assert.match(text, /expires 10 Feb/);
  assert.match(text, /expires 16 Dec/);
  assert.match(text, /Early Scroll expires before your picks are paid for/);
  assert.match(text, /2 of your picks expire, the first on Wed 16 Dec, 11:00 KST/);
});
