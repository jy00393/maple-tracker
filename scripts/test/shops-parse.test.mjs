// The job reads event coin shops out of Nexon's patch notes and merges them over the existing file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findShops, mergeShops, parseLimit, parseItemCell } from '../lib/shops.mjs';
import { shopPlan, itemCap, limitText } from '../../site/app/calc/shops.js';
import { eventStarts, comingUp } from '../../site/app/calc/upcoming.js';

const post = { id: 900, name: 'v.999 Patch Notes', category: 'update', liveDate: '2026-11-10T15:30:00Z' };
// Shaped like Nexon's markup: a heading, the dates, some prose, then one table per shop tab.
const BODY = `
<h2><a id="x"></a>Winter Events</h2>
<p>November 11, 2026 (after maintenance) - February 9, 2027 at 11:59 PM UTC</p>
<ul><li><strong>Star Coin Shop:</strong> Open it from the Event List.</li></ul>
<!-- a comment <h2>Hidden Shop</h2> -->
<h2 style="text-align:center"><a id="StarCoinShop"></a>Star Coin Shop</h2>
<p>November 11, 2026 (after maintenance) - February 9, 2027 at 11:59 PM UTC</p>
<div><p>Requirements</p><ul><li>Lv. 101 and above.</li></ul></div>
<table border="1"><tbody>
<tr><th>Item (Enhancement Tab)</th><th>Price<br>(Star Coin)</th><th>Qty. Limit</th></tr>
<tr><td><strong>(Interactive Worlds Only) Karma Bonus Cube:</strong> Tradable within account, expires <strong>February 10, 2027 at 2:00 AM UTC</strong>.</td><td>100</td><td>100</td></tr>
<tr><td><strong>(Heroic Worlds)</strong> <strong>Black Rebirth Flame:</strong> Tradable within account.</td><td>10</td><td>200</td></tr>
<tr><td><strong>Event Ring Coupon:</strong> Tradable.
<p>Use to choose one of the following:</p><ul><li><strong>Ring A:</strong> Untradable.</li><li><strong>Ring B</strong>: Untradable.</li></ul></td><td>3,000</td><td>3</td></tr>
</tbody></table>
<table border="1"><tbody>
<tr><th>Item (Growth Tab)</th><th>Price<br>(Star Coin)</th><th>Qty. Limit</th></tr>
<tr><td><strong>Mysterious Monsterbloom:</strong> Untradable, Permanent.<p>Note: Not available in Challenger World.</p></td><td>300</td><td>40 per World</td></tr>
<tr><td><strong>Infinite Revitalizer</strong>: Tradable within account.</td><td>10</td><td>5 daily</td></tr>
<tr><td><strong>(Not available in Challenger World) Character Slot Coupon:</strong> Untradable.</td><td>200</td><td>5</td></tr>
<tr><td><strong>Farm Entry Pass:</strong> Tradable.<p>Note: Can only be used by characters Lv. 101 - Lv. 259.</p></td><td>200</td><td>5 weekly</td></tr>
<tr><td><strong>Growth Potion (200 - 249):</strong> Tradable. Can be used by Burning characters.</td><td>5,000</td><td>2</td></tr>
<tr><td><strong>VIP Buff (EXP)</strong>: Lasts 30 minutes.</td><td>10</td><td>-</td></tr>
<tr><td><strong>Event Ring Coupon:</strong> Listed twice.</td><td>9,999</td><td>1</td></tr>
<tr><td><strong>Broken Row:</strong> no price.</td><td>TBD</td><td>1</td></tr>
</tbody></table>
<h2>Winter Meso Shop</h2>
<p>November 11, 2026 (after maintenance) - February 9, 2027 at 11:59 PM UTC</p>
<table><tbody><tr><th>Item (Normal Tab)</th><th>Meso Price</th><th>Qty. Limit</th></tr>
<tr><td><strong>Plasma Heart:</strong> Untradable.</td><td>3,000,000,000</td><td>5 per Account</td></tr></tbody></table>
<h2>Maple Point Shop</h2>
<p>November 11, 2026 - February 9, 2027 at 11:59 PM UTC</p>
<table><tbody><tr><th>Item</th><th>Price (Maple Points)</th><th>Qty. Limit</th></tr><tr><td><strong>Thing:</strong> x.</td><td>100</td><td>1</td></tr></tbody></table>
<h2>Undated Coin Shop</h2>
<table><tbody><tr><th>Item</th><th>Price (Odd Coin)</th><th>Qty. Limit</th></tr><tr><td><strong>Thing:</strong> x.</td><td>100</td><td>1</td></tr></tbody></table>
<h2>Cash Shop Update</h2>
<p>November 11, 2026 - February 9, 2027 at 11:59 PM UTC</p>
<table><tbody><tr><th>Item</th><th>Price (NX)</th></tr><tr><td><strong>Hat:</strong> x.</td><td>100</td></tr></tbody></table>
<h2>Tiny Coin Shop</h2>
<p>December 1, 2026 12:00 AM UTC - December 15, 2026 11:59 PM UTC</p>
<h3>Rewards</h3>
<table><tbody><tr><th>Item</th><th>Price (Tiny Coin)</th></tr><tr><td><strong>Chair</strong>: Permanent.</td><td>50</td></tr></tbody></table>
<h2>Back to Top</h2>`;

test('limits and item names are read from a shop table cell', () => {
  assert.deepEqual(parseLimit('100'), { limit: 100 });
  assert.deepEqual(parseLimit('3,000'), { limit: 3000 });
  assert.deepEqual(parseLimit('5 daily'), { limit: 5, per: 'day' });
  assert.deepEqual(parseLimit('5 weekly'), { limit: 5, per: 'week' });
  assert.deepEqual(parseLimit('40 per World'), { limit: 40, limitNote: '40 per world' });
  assert.deepEqual(parseLimit('5 per Account'), { limit: 5 });
  for (const none of ['-', '', 'Unlimited', '0', null]) assert.deepEqual(parseLimit(none), { limit: null }, String(none));
  assert.deepEqual(parseItemCell('<strong>(Interactive Worlds Only) Karma Bonus Cube:</strong> Tradable.'), { name: 'Karma Bonus Cube', only: 'interactive' });
  assert.deepEqual(parseItemCell('<strong>(Heroic Worlds)</strong> <strong>Black Rebirth Flame:</strong> x'), { name: 'Black Rebirth Flame', only: 'heroic' });
  assert.deepEqual(parseItemCell('<strong>Growth Potion (200 - 249):</strong> Tradable.'), { name: 'Growth Potion (200 - 249)' });
  assert.deepEqual(parseItemCell('<strong>VIP Buff (EXP)</strong>: Lasts.'), { name: 'VIP Buff (EXP)' });
  assert.deepEqual(parseItemCell('<strong>Bloom:</strong> Untradable.<p>Note: Not available in Challenger World.</p>'), { name: 'Bloom', notChallenger: true });
  assert.deepEqual(parseItemCell('<strong>Pass:</strong> x.<p>Note: Only for Lv. 101 - Lv. 259.</p>'), { name: 'Pass', note: 'Only for Lv. 101 - Lv. 259.' });
});

test('coin shops are found in a patch-notes post; meso, point, cash and undated shops are not', () => {
  const shops = findShops(BODY, post);
  assert.deepEqual(shops.map((s) => s.name), ['Star Coin Shop', 'Tiny Coin Shop']);
  const s = shops[0];
  assert.equal(s.id, 'star-coin-shop');
  assert.equal(s.currency, 'Star Coin');
  assert.equal(s.start, '2026-11-11T00:00:00.000Z');
  assert.equal(s.end, '2027-02-09T23:59:00.000Z');
  assert.equal(s.postId, 900);
  assert.equal(s.url, 'https://www.nexon.com/maplestory/news/update/900');
  assert.deepEqual(s.items, [
    { id: 'karma-bonus-cube', name: 'Karma Bonus Cube', only: 'interactive', cost: 100, limit: 100 },
    { id: 'black-rebirth-flame', name: 'Black Rebirth Flame', only: 'heroic', cost: 10, limit: 200 },
    { id: 'event-ring-coupon', name: 'Event Ring Coupon', cost: 3000, limit: 3 },
    { id: 'mysterious-monsterbloom', name: 'Mysterious Monsterbloom', notChallenger: true, cost: 300, limit: 40, limitNote: '40 per world' },
    { id: 'infinite-revitalizer', name: 'Infinite Revitalizer', cost: 10, limit: 5, per: 'day' },
    { id: 'character-slot-coupon', name: 'Character Slot Coupon', notChallenger: true, cost: 200, limit: 5 },
    { id: 'farm-entry-pass', name: 'Farm Entry Pass', note: 'Can only be used by characters Lv. 101 - Lv. 259.', cost: 200, limit: 5, per: 'week' },
    { id: 'growth-potion-200-249', name: 'Growth Potion (200 - 249)', cost: 5000, limit: 2 },
    { id: 'vip-buff-exp', name: 'VIP Buff (EXP)', cost: 10, limit: null }
  ]);
  // A table with no limit column, under a sub-heading of the shop.
  assert.deepEqual(shops[1].items, [{ id: 'chair', name: 'Chair', cost: 50, limit: null }]);
  assert.deepEqual(findShops('', post), []);
  assert.deepEqual(findShops('<h2>Coin Shop</h2><p>no table</p>', post), []);
  assert.deepEqual(findShops(null, post), []);
});

test('an item with no limit can be picked freely in the planner', () => {
  const [shop] = findShops(BODY, post);
  const vip = shop.items.find((i) => i.id === 'vip-buff-exp');
  assert.equal(itemCap(vip), undefined);
  assert.equal(limitText(vip), 'none');
  const plan = shopPlan(shop, { have: 500, want: { 'vip-buff-exp': 30, 'event-ring-coupon': 9 } }, { world: 'heroic' }, Date.parse('2026-11-24T00:00:00Z'));
  assert.equal(plan.need, 30 * 10 + 3 * 3000);
  assert.equal(plan.toCome, 0); // how the coins are earned is not in the post
  assert.equal(plan.short, 9300 - 500);
});

test('parsed shops are merged over the existing file: ids, hand-added fields and notes survive', () => {
  const now = Date.parse('2026-11-24T00:00:00Z');
  const parsed = findShops(BODY, post);
  const existing = { source: 'old', sourceUrl: 'https://example.test/old', shops: [
    { id: 'star', name: 'Star Coin Shop', event: 'Winter', currency: 'Star Coin', scope: 'Shared by the account.', start: '2026-11-11T00:00:00Z', end: '2027-02-09T23:59:00Z', useBy: '2027-02-10T02:00:00Z',
      earn: { name: 'Mission', perClaim: 800, perWeek: 5, max: 60, note: 'x' },
      items: [{ id: 'ring', name: 'Event Ring Coupon', cost: 2500, limit: 3, note: 'Pick ring A or B.' }, { id: 'gone', name: 'Removed Item', cost: 5, limit: 1 }, { id: 'pass', name: 'Farm Entry Pass', cost: 200, limit: 5, per: 'week', note: 'My note.' }] },
    { id: 'hand', name: 'Hand Typed Shop', currency: 'Gem', start: '2026-11-01T00:00:00Z', end: '2026-12-31T00:00:00Z', items: [{ id: 'a', name: 'A', cost: 1, limit: 1 }] },
    { id: 'ended', name: 'Long Closed Shop', currency: 'Old', start: '2026-08-01T00:00:00Z', end: '2026-10-01T00:00:00Z', items: [] }
  ] };
  const out = mergeShops(existing, parsed, now);
  assert.deepEqual(out.shops.map((s) => s.id), ['tiny-coin-shop-2026-12-01', 'hand', 'star']); // soonest to close first; a new shop's id carries its start date
  const star = out.shops.find((s) => s.id === 'star');
  assert.equal(star.event, 'Winter');
  assert.equal(star.scope, 'Shared by the account.');
  assert.equal(star.useBy, '2027-02-10T02:00:00Z');
  assert.equal(star.earn.max, 60);
  assert.equal(star.postId, 900);
  assert.equal(star.items.length, 9);
  const ring = star.items.find((i) => i.name === 'Event Ring Coupon');
  assert.deepEqual(ring, { id: 'ring', name: 'Event Ring Coupon', cost: 3000, limit: 3, note: 'Pick ring A or B.' }); // id and note kept, price from the post
  assert.equal(star.items.find((i) => i.name === 'Farm Entry Pass').note, 'Can only be used by characters Lv. 101 - Lv. 259.'); // the post's own note wins
  assert.ok(!star.items.some((i) => i.id === 'gone'));
  assert.match(out.source, /news id 900/);
  assert.equal(out.sourceUrl, 'https://www.nexon.com/maplestory/news/update/900');
  // Running it again changes nothing.
  assert.deepEqual(mergeShops(out, parsed, now), out);
  // Nothing parsed (the post left the cache): the file keeps what it has until each shop closes.
  assert.deepEqual(mergeShops(out, [], now).shops.map((s) => s.id), ['tiny-coin-shop-2026-12-01', 'hand', 'star']);
  assert.deepEqual(mergeShops(out, [], Date.parse('2027-06-01T00:00:00Z')).shops, []);
  // Two posts with the same shop: the newer post's version is used.
  const older = { ...parsed[0], liveDate: '2026-10-01T00:00:00Z', postId: 800, items: [{ id: 'x', name: 'Only In Old Post', cost: 1, limit: 1 }] };
  assert.equal(mergeShops({ shops: [] }, [parsed[0], older], now).shops.find((s) => s.name === 'Star Coin Shop').postId, 900);
  assert.equal(mergeShops({ shops: [] }, [older, parsed[0]], now).shops.find((s) => s.name === 'Star Coin Shop').items.length, 9);
  assert.deepEqual(mergeShops(null, null, now).shops, []);
});

test('event start dates from Nexon posts join the upcoming list', () => {
  const now = Date.parse('2026-11-24T00:00:00Z');
  const events = [
    { id: 'a', title: 'Winter Festival', start: '2026-12-09T00:00:00.000Z', end: '2027-01-05T23:59:00.000Z', category: 'events', postName: 'Winter Post', startApprox: false },
    { id: 'b', title: 'Lucky Box', start: '2026-11-25T08:00:00.000Z', end: '2026-11-26T08:00:00.000Z', category: 'sale' },
    { id: 'c', title: 'Maintenance', start: '2026-12-01T00:00:00.000Z', end: '2026-12-01T08:00:00.000Z', category: 'maintenance' },
    { id: 'd', title: 'Classic Event', start: '2026-12-02T00:00:00.000Z', end: '2026-12-20T00:00:00.000Z', category: 'events', isClassic: true },
    { id: 'e', title: 'Already Running', start: '2026-11-01T00:00:00.000Z', end: '2026-12-20T00:00:00.000Z', category: 'events' },
    { id: 'f', title: 'No Start', start: null, end: '2026-12-20T00:00:00.000Z', category: 'events' },
    null
  ];
  assert.deepEqual(eventStarts(events).map((e) => e.id), ['event-a', 'event-e']);
  const hand = { items: [{ id: 'h', at: '2026-12-16T00:00:00Z', day: true, title: 'Typed by hand', note: 'x' }] };
  const list = comingUp(hand, now, null, 10, events);
  assert.deepEqual(list.map((x) => x.id), ['event-a', 'h']);
  assert.equal(list[0].title, 'Winter Festival starts');
  assert.equal(list[0].days, 15);
  assert.match(list[0].note, /Winter Post/);
  assert.deepEqual(comingUp(hand, now, null, 10).map((x) => x.id), ['h']);
  assert.deepEqual(comingUp(null, now, null, 10, 'junk'), []);
});
