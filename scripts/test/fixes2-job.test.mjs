// Second round of fixes to the data job: shop identity across seasons, world variants, merged cells, maintenance
// titles, same-day windows, event ids, feed and post answers that cannot be trusted, and the workflow's save step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findShops, mergeShops } from '../lib/shops.mjs';
import { parsePost, findDateRanges, wantsDetail } from '../lib/nexon-parse.mjs';
import { checkNewsList, readDetail, refreshPosts, EMPTY_RUNS_TO_ACCEPT } from '../lib/job.mjs';
import { shopItems, shopPlan } from '../../site/app/calc/shops.js';

const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());
const post = (id, liveDate, category = 'update') => ({ id, name: `Post ${id}`, category, liveDate });
const row = (name, price, limit) => `<tr><td><strong>${name}:</strong> Untradable.</td><td>${price}</td>${limit === undefined ? '' : `<td>${limit}</td>`}</tr>`;
const shopHtml = (title, range, coin, rows, level = 2) =>
  `<h${level}>${title}</h${level}><p>${range}</p><table><tbody><tr><th>Item</th><th>Price (${coin})</th><th>Qty. Limit</th></tr>${rows.join('')}</tbody></table>`;

const S4 = 'November 11, 2026 12:00 AM UTC - February 9, 2027 11:59 PM UTC';
const S5 = 'February 10, 2027 12:00 AM UTC - May 11, 2027 11:59 PM UTC';

test('39: a shop that comes back next season under the same name is a new shop', () => {
  const rows = [row('Sol Erda', 5, 20), row('Chair', 50, 1)];
  const season4 = findShops(shopHtml('Challenger World Shop', S4, 'Challenger Coin', rows), post(1, '2026-11-10T00:00:00Z'));
  // The file as it is on disk today: a plain id, with fields typed in by hand.
  const hand = { earn: { name: 'Season 4 mission', perClaim: 100, perWeek: 5, max: 60 }, useBy: '2027-02-16T23:59:00Z', event: 'Challenger World Season 4', scope: 'Season 4 characters only.' };
  const file = { shops: [{ ...season4[0], id: 'challenger-world-shop', ...hand }] };

  // The same shop read again from an edited post (the start moved by a day): still the same shop.
  const edited = findShops(shopHtml('Challenger World Shop', 'November 12, 2026 12:00 AM UTC - February 9, 2027 11:59 PM UTC', 'Challenger Coin', rows), post(1, '2026-11-10T00:00:00Z'));
  const same = mergeShops(file, edited, Date.parse('2026-11-24T00:00:00Z')).shops;
  assert.equal(same.length, 1);
  assert.equal(same[0].id, 'challenger-world-shop');
  assert.equal(same[0].earn.max, 60);
  assert.equal(same[0].start, '2026-11-12T00:00:00.000Z');

  // (a) Season 5 opens the day after season 4 closed; the old shop is still in the file.
  const season5 = findShops(shopHtml('Challenger World Shop', S5, 'Challenger Coin', rows), post(2, '2027-02-09T00:00:00Z'));
  const now = Date.parse('2027-02-10T07:00:00Z');
  const next = mergeShops(file, [...season4, ...season5], now);
  assert.equal(next.shops.length, 2);
  const oldShop = next.shops.find((s) => s.id === 'challenger-world-shop');
  const newShop = next.shops.find((s) => s.id !== 'challenger-world-shop');
  assert.equal(oldShop.end, '2027-02-09T23:59:00.000Z', 'the closed shop is left as it was');
  assert.equal(oldShop.earn.max, 60);
  assert.equal(newShop.start, '2027-02-10T00:00:00.000Z');
  assert.equal(newShop.postId, 2);
  for (const key of ['earn', 'useBy', 'event', 'scope']) assert.equal(newShop[key], undefined, `${key} belongs to last season`);
  assert.deepEqual(mergeShops(next, [...season4, ...season5], now), next, 'running it again changes nothing');
  // Fields typed in for the new shop stay on the new shop.
  const typed = { ...next, shops: next.shops.map((s) => (s.id === newShop.id ? { ...s, event: 'Season 5' } : s)) };
  const again = mergeShops(typed, season5, now + 86400000).shops;
  assert.equal(again.find((s) => s.id === newShop.id).event, 'Season 5');
  assert.equal(again.find((s) => s.id === 'challenger-world-shop').event, 'Challenger World Season 4');

  // (b) The old shop left the file weeks ago: the new one still does not reuse its id, so the coins and picks
  // saved for last season are not shown for it.
  const later = findShops(shopHtml('Challenger World Shop', 'March 10, 2027 12:00 AM UTC - June 8, 2027 11:59 PM UTC', 'Challenger Coin', rows), post(3, '2027-03-09T00:00:00Z'));
  const fresh = mergeShops(file, later, Date.parse('2027-03-10T07:00:00Z')).shops;
  assert.equal(fresh.length, 1);
  assert.notEqual(fresh[0].id, 'challenger-world-shop');
  const saved = { 'challenger-world-shop': { have: 7, claims: 60, want: { 'sol-erda': 12 } } };
  const plan = shopPlan(fresh[0], saved[fresh[0].id], { world: 'heroic' }, Date.parse('2027-03-10T07:00:00Z'));
  assert.equal(plan.have, 0);
  assert.equal(plan.need, 0);
});

test('40: maintenance posts are read while announced or running, whatever the title starts with', () => {
  const now = Date.parse('2026-11-26T07:00:00Z');
  const wants = (name, category = 'maintenance') => wantsDetail({ name, category, liveDate: '2026-11-26T05:00:00Z' }, now);
  for (const name of [
    'Emergency Maintenance - November 26, 2026',
    '[Update] Scheduled Maintenance - November 26, 2026',
    '[Update Nov 26] Scheduled Game Update - November 26, 2026',
    '[Extended] Scheduled Maintenance - November 26, 2026',
    '[In Progress] Scheduled Maintenance - November 26, 2026',
    'Quanah World Channel Maintenance - November 26, 2026',
    // Titles that were read before still are.
    'Scheduled Maintenance - November 24, 2026',
    'Scheduled Minor Patch - November 26, 2026',
    '[Completed] Scheduled Grand Launch - October 21, 2026',
    '[Completed]Scheduled Minor Patch Maintenance - July 9, 2026',
    '[Completed] Emergency Maintenance - June 20, 2026',
    '[Updated 11/24] Unscheduled Maintenance'
  ]) assert.equal(wants(name), true, name);
  for (const name of ['v.272 Known Issues', 'Mac OS Beta Known Issues and Updates', 'Classic World: Closed Online Test #2 Known Issues', 'Known Issues Notice']) assert.equal(wants(name), false, name);
  // And the post is then read into a window.
  const [e] = parsePost({ id: 5, name: 'Emergency Maintenance - November 26, 2026', category: 'maintenance', liveDate: '2026-11-26T05:00:00Z' },
    '<p>We will be performing an emergency maintenance starting on Thursday, November 26, 2026 at 1:00 AM PST and concluding around 7:00 AM PST.</p>');
  assert.equal(e.start, '2026-11-26T09:00:00.000Z');
  assert.equal(e.end, '2026-11-26T15:00:00.000Z');
});

test('41: one item listed for Interactive and for Heroic worlds keeps both rows', () => {
  const rows = [row('(Interactive Worlds Only) Sol Erda Fragment', 30, 100), row('(Heroic Worlds Only) Sol Erda Fragment', 50, 300), row('Sol Erda', '2,000', 5)];
  const [shop] = findShops(shopHtml('Test Coin Shop', S4, 'Test Coin', rows), post(1, '2026-11-10T00:00:00Z'));
  assert.deepEqual(shop.items.map((i) => [i.id, i.only || '', i.cost, i.limit]), [['sol-erda-fragment', 'interactive', 30, 100], ['sol-erda-fragment-heroic', 'heroic', 50, 300], ['sol-erda', '', 2000, 5]]);
  assert.deepEqual(shopItems(shop, { world: 'heroic' }).map((i) => [i.name, i.cost, i.limit]), [['Sol Erda Fragment', 50, 300], ['Sol Erda', 2000, 5]]);
  assert.deepEqual(shopItems(shop, { world: 'interactive' }).map((i) => [i.name, i.cost, i.limit]), [['Sol Erda Fragment', 30, 100], ['Sol Erda', 2000, 5]]);
  // Merged over a file: each world's row keeps its own id, also when Nexon lists them the other way round.
  const now = Date.parse('2026-11-24T00:00:00Z');
  const file = mergeShops({ shops: [] }, [shop], now);
  const [swapped] = findShops(shopHtml('Test Coin Shop', S4, 'Test Coin', [rows[1], rows[0], rows[2]]), post(1, '2026-11-10T00:00:00Z'));
  const merged = mergeShops(file, [swapped], now).shops[0];
  assert.deepEqual(merged.items.map((i) => [i.id, i.only || '', i.cost]).sort(), [['sol-erda', '', 2000], ['sol-erda-fragment', 'interactive', 30], ['sol-erda-fragment-heroic', 'heroic', 50]]);
});

test('42: two shops with the same heading in one post are two shops', () => {
  const body = `<h1>Event A</h1>${shopHtml('Coin Shop', 'November 11, 2026 12:00 AM UTC - December 8, 2026 11:59 PM UTC', 'A Coin', [row('Chair A', 10, 1)])}`
    + `<h1>Event B</h1>${shopHtml('Coin Shop', 'December 9, 2026 12:00 AM UTC - January 5, 2027 11:59 PM UTC', 'B Coin', [row('Chair B', 20, 1)])}`;
  const shops = findShops(body, post(1, '2026-11-10T00:00:00Z'));
  assert.deepEqual(shops.map((s) => [s.name, s.currency]), [['Coin Shop', 'A Coin'], ['Event B: Coin Shop', 'B Coin']]);
  assert.equal(new Set(shops.map((s) => s.id)).size, 2);
  const now = Date.parse('2026-11-26T00:00:00Z');
  const file = mergeShops({ shops: [] }, shops, now);
  assert.deepEqual(file.shops.map((s) => s.currency), ['A Coin', 'B Coin']);
  assert.equal(new Set(file.shops.map((s) => s.id)).size, 2);
  assert.deepEqual(mergeShops(file, shops, now), file);
  // Without an event heading above them, the coin tells them apart.
  const flat = findShops(shopHtml('Coin Shop', S4, 'A Coin', [row('Chair A', 10, 1)]) + shopHtml('Coin Shop', S4, 'B Coin', [row('Chair B', 20, 1)]), post(1, '2026-11-10T00:00:00Z'));
  assert.deepEqual(flat.map((s) => s.name), ['Coin Shop', 'Coin Shop (B Coin)']);
});

test('43: a same-day window can run past midnight and can take its zone from a label; a window that ends before it starts is dropped', () => {
  const [hot] = findDateRanges('Hot Time: November 28, 2026 10:00 PM - 2:00 AM PST');
  assert.equal(iso(hot.start), '2026-11-29T06:00:00.000Z');
  assert.equal(iso(hot.end), '2026-11-29T10:00:00.000Z');
  const [utc] = findDateRanges('November 28, 2026 10:00 PM - 2:00 AM UTC');
  assert.equal(iso(utc.end), '2026-11-29T02:00:00.000Z');
  const [day] = findDateRanges('PST (UTC -8): Saturday, November 28, 2026 12:00 AM - 11:59 PM');
  assert.equal(iso(day.start), '2026-11-28T08:00:00.000Z');
  assert.equal(iso(day.end), '2026-11-29T07:59:00.000Z');
  // An ordinary same-day window is read as before.
  const [plain] = findDateRanges('Wednesday, November 25, 2026 4:00 AM - 9:00 AM PST (12:00 - 17:00 UTC)');
  assert.deepEqual([iso(plain.start), iso(plain.end)], ['2026-11-25T12:00:00.000Z', '2026-11-25T17:00:00.000Z']);
  assert.deepEqual(findDateRanges('February 9, 2027 12:00 AM UTC - November 11, 2026 12:00 AM UTC'), []);
  assert.deepEqual(findDateRanges('December 16, 2026 - January 12, 2026'), []);
  // Through a whole post: no event ends before it starts, and the typo section is not an event.
  const events = parsePost({ id: 9, name: 'Events', category: 'events', liveDate: '2026-11-20T00:00:00Z' },
    '<h3>Hot Time</h3><p>November 28, 2026 10:00 PM - 2:00 AM PST</p><h3>Typo Event</h3><p>December 16, 2026 - January 12, 2026</p><h3>Fine Event</h3><p>December 16, 2026 12:00 AM UTC - January 12, 2027 11:59 PM UTC</p>');
  assert.deepEqual(events.map((e) => e.title), ['Hot Time', 'Fine Event']);
  for (const e of events) assert.ok(Date.parse(e.end) > Date.parse(e.start), e.title);
  // A shop whose dates are the wrong way round is not planned against a window that never opens.
  assert.deepEqual(findShops(shopHtml('Odd Coin Shop', 'February 9, 2027 12:00 AM UTC - November 11, 2026 12:00 AM UTC', 'Odd Coin', [row('Chair', 10, 1)]), post(1, '2026-11-10T00:00:00Z')), []);
});

test('44: every event of a post has its own id, and long headings that differ late are both kept', () => {
  const section = (title, range) => `<h3>${title}</h3><p>UTC: ${range}</p>`;
  const p = { id: 777, name: 'Patch', category: 'update', liveDate: '2026-11-10T00:00:00Z' };
  const a = parsePost(p, section('Burning Express', 'November 11, 2026 12:00 AM - November 24, 2026 11:59 PM')
    + section('Burning Express', 'December 9, 2026 12:00 AM - December 22, 2026 11:59 PM')
    + section('Burning Express 2', 'January 6, 2027 12:00 AM - January 19, 2027 11:59 PM')
    + section('Burning Express', 'November 11, 2026 12:00 AM - November 24, 2026 11:59 PM'));
  assert.deepEqual(a.map((e) => e.id), ['777-burning-express', '777-burning-express-2', '777-burning-express-2-2'], 'the repeat with the same window is one event');
  assert.deepEqual(a.map((e) => e.title), ['Burning Express', 'Burning Express', 'Burning Express 2']);
  const window = 'November 27, 2026 12:00 AM - November 30, 2026 11:59 PM';
  const long = 'Radiant Glowing, Brilliant Bright, and Dazzling Bonus Glowing Cube Packs';
  const b = parsePost(p, section(`${long} (Friday Only Special)`, window) + section(`${long} (Monday Only Special)`, window));
  assert.deepEqual(b.map((e) => e.title), [`${long} (Friday Only Special)`, `${long} (Monday Only Special)`]);
  assert.equal(new Set(b.map((e) => e.id)).size, 2);
});

// ---- the job: which posts are read, and what counts as an answer

const eventBody = (title) => `<h3>${title}</h3><p>UTC: November 11, 2026 12:00 AM - February 9, 2027 11:59 PM</p>`;

test('45: posts that cannot be read no longer stop the posts behind them', async () => {
  const candidates = [300, 299, 298, 200, 199, 198, 197, 196, 195].map((id) => post(id, '2026-11-01T00:00:00Z', 'events'));
  const posts = {};
  const run = async (now) => {
    const asked = [];
    const errors = [];
    const out = await refreshPosts({
      candidates, posts, pv: 5, now, max: 30, errors, wait: async () => {},
      fetchDetail: async (p) => { asked.push(p.id); if (p.id >= 298) throw new Error('HTTP 404'); return { body: eventBody(`Event ${p.id}`) }; }
    });
    return { asked, errors, ...out };
  };
  const t0 = Date.parse('2026-11-26T00:17:00Z');
  const first = await run(t0);
  assert.deepEqual(first.asked, [300, 299, 298], 'three failures in a row end the run');
  assert.equal(first.errors.length, 3);
  assert.equal(posts[300].fails, 1);
  assert.equal(posts[300].pv, undefined, 'a post that failed still counts as unread');
  const second = await run(t0 + 6 * 3600000);
  assert.deepEqual(second.asked.slice(0, 6), [200, 199, 198, 197, 196, 195], 'the readable posts go first');
  assert.equal(second.fetched, 6);
  assert.equal(Object.values(posts).filter((p) => p.events.length === 1).length, 6);
  assert.equal(posts[300].fails, 2);
  // A post that keeps failing is asked for less and less often.
  const third = await run(t0 + 12 * 3600000 + 5 * 60000);
  assert.deepEqual(third.asked, [300, 299, 298]);
  const fourth = await run(t0 + 18 * 3600000);
  assert.deepEqual(fourth.asked, [], 'after three failures a post waits');
  const fifth = await run(t0 + 24 * 3600000 + 10 * 60000);
  assert.deepEqual(fifth.asked, [300, 299, 298]);
  // A failure keeps what was saved, and a later good answer clears the marks.
  posts[200].name = 'Old title';
  await refreshPosts({ candidates: [candidates[3]], posts, pv: 5, now: t0, max: 30, errors: [], wait: async () => {}, fetchDetail: async () => { throw new Error('HTTP 503'); } });
  assert.equal(posts[200].events.length, 1);
  assert.equal(posts[200].fails, 1);
  await refreshPosts({ candidates: [candidates[3]], posts, pv: 5, now: t0 + 6 * 3600000, max: 30, errors: [], wait: async () => {}, fetchDetail: async () => ({ body: eventBody('Event 200') }) });
  assert.equal(posts[200].fails, undefined);
  assert.equal(posts[200].name, 'Post 200');
});

test('46, 78: the Characters page does not call the last level change a check', () => {
  const src = readFileSync(new URL('../../site/app/pages/characters.js', import.meta.url), 'utf8');
  const line = src.split('\n').find((l) => l.includes('n.checkedAt'));
  assert.ok(line, 'the Nexon line is still there');
  assert.doesNotMatch(line, /\bchecked \$\{/);
  assert.match(line, /last change seen \$\{fmtKst\(Date\.parse\(n\.checkedAt\), false\)\}/);
});

test('47: a price cell shared by two rows, a price with its coin, and a struck-through old price are read', () => {
  const body = `<h2>Test Coin Shop</h2><p>${S4}</p><table><tbody>
    <tr><th>Item</th><th>Price (Star Coin)</th><th>Qty. Limit</th></tr>
    <tr><td><strong>Cube A:</strong> x.</td><td rowspan="2">100</td><td>5</td></tr>
    <tr><td><strong>Cube B:</strong> x.</td><td>7</td></tr>
    <tr><td><strong>Cube C:</strong> x.</td><td>100 Star Coins</td><td>5</td></tr>
    <tr><td><strong>Cube D:</strong> x.</td><td><s>200</s> 100</td><td>5</td></tr>
    <tr><td><strong>Cube E:</strong> x.</td><td>50</td><td>5</td></tr>
    <tr><td colspan="3">Growth</td></tr>
    <tr><td><strong>Cube F:</strong> x.</td><td>1,000 Mesos</td><td>5</td></tr>
    <tr><td><strong>Cube G:</strong> x.</td><td>10 or 20</td><td>5</td></tr>
    <tr><td><strong>Cube H:</strong> x.</td><td>60</td><td rowspan=2>3</td></tr>
    <tr><td><strong>Cube I:</strong> x.</td><td>70</td></tr>
  </tbody></table>`;
  const [shop] = findShops(body, post(1, '2026-11-10T00:00:00Z'));
  assert.deepEqual(shop.items.map((i) => [i.name, i.cost, i.limit]), [
    ['Cube A', 100, 5], ['Cube B', 100, 7], ['Cube C', 100, 5], ['Cube D', 100, 5], ['Cube E', 50, 5], ['Cube H', 60, 3], ['Cube I', 70, 3]
  ], 'a price in mesos or an unclear price is left out, never guessed');
});

test('48: two fuller names that match one old short name do not share its id', () => {
  const now = Date.parse('2026-11-24T00:00:00Z');
  const base = { name: 'Test Shop', currency: 'Coin', start: '2026-11-11T00:00:00.000Z', end: '2027-02-09T23:59:00.000Z' };
  const file = { shops: [{ ...base, id: 'test', items: [{ id: 'heart-upgrade-module', name: 'Heart Upgrade Module', cost: 5, limit: 3, note: 'Mine.' }] }] };
  const parsed = [{ ...base, id: 'test-shop', postId: 1, liveDate: '2026-11-10T00:00:00Z', items: [
    { id: 'heart-upgrade-module-plasma', name: 'Heart Upgrade Module: Plasma', cost: 5, limit: 3 },
    { id: 'heart-upgrade-module-titanium', name: 'Heart Upgrade Module: Titanium', cost: 5, limit: 3 }
  ] }];
  const [shop] = mergeShops(file, parsed, now).shops;
  assert.deepEqual(shop.items.map((i) => i.id), ['heart-upgrade-module', 'heart-upgrade-module-titanium'], 'the first keeps the old id and its picks');
  assert.equal(shop.items[0].note, 'Mine.');
  const plan = shopPlan(shop, { have: 0, want: { 'heart-upgrade-module': 1 } }, { world: 'heroic' }, now);
  assert.equal(plan.need, 5);
  assert.equal(plan.picked, 1);
  assert.deepEqual(mergeShops({ shops: [shop] }, parsed, now).shops[0].items.map((i) => i.id), ['heart-upgrade-module', 'heart-upgrade-module-titanium']);
});

test('72: a news list that is malformed or far too short is refused', () => {
  const item = (id) => ({ id, name: `Post ${id}`, category: 'general', liveDate: '2026-11-20T00:00:00Z' });
  const full = Array.from({ length: 480 }, (_, i) => item(i + 1));
  assert.equal(checkNewsList(full, 150).length, 480);
  assert.equal(checkNewsList(full.slice(0, 3), 0).length, 3, 'a first run has nothing to compare with');
  assert.equal(checkNewsList(full.slice(0, 75), 150).length, 75);
  assert.throws(() => checkNewsList(full.slice(0, 40), 150), /only 40 posts/, 'under half of the last good feed');
  assert.throws(() => checkNewsList(full.slice(0, 3), 150), /only 3 posts/);
  assert.throws(() => checkNewsList([{ error: 'rate limited' }], 150), /without an id, a name or a date/);
  assert.throws(() => checkNewsList([{ error: 'rate limited' }], 0), /without an id/);
  assert.throws(() => checkNewsList([], 150), /no posts/);
  assert.throws(() => checkNewsList({ items: full }, 150), /no posts/);
  // A few broken entries among good ones are dropped, not fatal.
  assert.equal(checkNewsList([...full, null, { id: 5 }, { id: 6, name: 'x', liveDate: 'soon' }], 150).length, 480);
});

test('73: a post answer without a usable body never replaces what was read before', () => {
  const p = post(10, '2026-11-20T00:00:00Z', 'events');
  const now = Date.parse('2026-11-26T00:00:00Z');
  const good = readDetail(p, { body: eventBody('Winter Event') }, undefined, 5, now);
  assert.equal(good.events.length, 1);
  assert.equal(good.pv, 5);
  for (const bad of [{}, null, { body: '' }, { body: '   ' }, { body: 5 }, { content: '<p>x</p>' }]) assert.throws(() => readDetail(p, bad, good, 5, now), /no body/);
  const placeholder = { body: '<p>Service temporarily unavailable</p>' };
  assert.throws(() => readDetail(p, placeholder, good, 5, now), /kept the saved copy/);
  assert.throws(() => readDetail(p, placeholder, { ...good, pv: 4 }, 5, now), /kept the saved copy/, 'also when the parser version moved on');
  // A post never read before has nothing to protect; one that really was emptied is believed on the third run.
  assert.deepEqual(readDetail(p, placeholder, undefined, 5, now).events, []);
  assert.deepEqual(readDetail(p, placeholder, { ...good, emptyRuns: EMPTY_RUNS_TO_ACCEPT - 1 }, 5, now).events, []);
});

test('73: through the read loop, the saved copy survives and the failure is reported', async () => {
  const p = post(10, '2026-11-25T00:00:00Z', 'events');
  const t0 = Date.parse('2026-11-26T00:00:00Z');
  const posts = {};
  const run = (now, fetchDetail) => { const errors = []; return refreshPosts({ candidates: [p], posts, pv: 5, now, max: 30, errors, wait: async () => {}, fetchDetail }).then((r) => ({ ...r, errors })); };
  await run(t0, async () => ({ body: eventBody('Winter Event') }));
  const r1 = await run(t0 + 6 * 3600000, async () => ({}));
  assert.equal(r1.fetched, 0);
  assert.match(r1.errors[0], /post 10: the answer has no body/);
  assert.equal(posts[10].events.length, 1);
  const r2 = await run(t0 + 12 * 3600000, async () => ({ body: '<p>Service temporarily unavailable</p>' }));
  assert.equal(r2.fetched, 0);
  assert.equal(posts[10].events.length, 1);
  assert.equal(posts[10].emptyRuns, 1);
  const r3 = await run(t0 + 18 * 3600000, async () => ({ body: eventBody('Winter Event') }));
  assert.equal(r3.fetched, 1);
  assert.equal(posts[10].emptyRuns, undefined);
  assert.equal(posts[10].fails, undefined);
});

// ---- the whole job, run against a scratch folder with a stand-in for Nexon (no network)

const JOB = fileURLToPath(new URL('../update-data.mjs', import.meta.url));
const PRELOAD = new URL('./lib/fake-nexon.mjs', import.meta.url).href;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (ms) => { const d = new Date(ms); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };

function scratchJob() {
  const dir = mkdtempSync(join(tmpdir(), 'maple-job-'));
  const data = join(dir, 'data');
  mkdirSync(data);
  writeFileSync(join(dir, 'characters.json'), '[]');
  const read = (name) => readFileSync(join(data, name), 'utf8');
  const run = (feed) => {
    writeFileSync(join(dir, 'feed.json'), JSON.stringify(feed));
    rmSync(join(dir, 'asked.log'), { force: true });
    const out = spawnSync(process.execPath, ['--import', PRELOAD, JOB], {
      encoding: 'utf8',
      env: { ...process.env, MAPLE_DATA_DIR: data, MAPLE_CONFIG_FILE: join(dir, 'characters.json'), MAPLE_TEST_FEED: join(dir, 'feed.json'), MAPLE_TEST_LOG: join(dir, 'asked.log') }
    });
    assert.equal(out.status, 0, out.stderr);
    const asked = existsSync(join(dir, 'asked.log')) ? readFileSync(join(dir, 'asked.log'), 'utf8').trim().split('\n').map(Number) : [];
    return { meta: JSON.parse(read('meta.json')), asked };
  };
  return { dir, data, read, run, files: () => ['news.json', 'posts.json', 'events.json', 'calendar.ics', 'shops.json'].map(read), done: () => rmSync(dir, { recursive: true, force: true }) };
}

function sampleFeed(now) {
  const DAY = 86400000;
  const list = [];
  const posts = {};
  for (let i = 0; i < 60; i++) {
    const id = 1000 - i;
    const isEvent = i < 6;
    list.push({ id, name: `Post ${id}`, category: isEvent ? 'events' : 'community', liveDate: new Date(now - (i + 1) * 3600000).toISOString() });
    if (isEvent) posts[id] = { json: { body: `<h3>Event ${id}</h3><p>${longDate(now - DAY)} 12:00 AM UTC - ${longDate(now + 30 * DAY)} 11:59 PM UTC</p>` } };
  }
  return { list, posts };
}

test('72: the whole job keeps every file when the news list comes back short or malformed', () => {
  const job = scratchJob();
  try {
    const feed = sampleFeed(Date.now());
    const first = job.run(feed);
    assert.equal(first.meta.ok, true);
    assert.deepEqual(first.meta.errors, []);
    assert.equal(first.meta.events, 6);
    assert.equal(JSON.parse(job.read('news.json')).items.length, 60);
    const before = job.files();
    for (const list of [feed.list.slice(0, 3), [{ error: 'rate limited' }], [feed.list[0]]]) {
      const bad = job.run({ ...feed, list });
      assert.equal(bad.meta.ok, false);
      assert.match(bad.meta.errors.join(' '), /^news: News feed returned/);
      assert.deepEqual(bad.asked, []);
      assert.deepEqual(job.files(), before);
    }
    assert.equal(job.run(feed).meta.ok, true, 'and it carries on when the list is whole again');
  } finally { job.done(); }
});

test('73, 45: the whole job keeps events when post answers have no body, and gets past posts that cannot be read', () => {
  const job = scratchJob();
  try {
    const feed = sampleFeed(Date.now());
    job.run(feed);
    const events = job.read('events.json');
    assert.equal(JSON.parse(events).events.length, 6);
    // Six hours later the recent posts are due again, and every post answers 200 with no body.
    const age = () => { const c = JSON.parse(job.read('posts.json')); for (const p of Object.values(c.posts)) p.fetchedAt = new Date(Date.now() - 6 * 3600000).toISOString(); writeFileSync(join(job.data, 'posts.json'), JSON.stringify(c, null, 1) + '\n'); };
    age();
    const empty = job.run({ ...feed, posts: Object.fromEntries(Object.keys(feed.posts).map((id) => [id, { json: {} }])) });
    assert.equal(empty.meta.fetched, 0);
    assert.equal(empty.meta.errors.length, 3, 'three unusable answers end the run');
    assert.match(empty.meta.errors[0], /the answer has no body/);
    assert.equal(job.read('events.json'), events);
    const placeholder = job.run({ ...feed, posts: Object.fromEntries(Object.keys(feed.posts).map((id) => [id, { json: { body: '<p>Service temporarily unavailable</p>' } }])) });
    assert.equal(placeholder.meta.fetched, 0);
    assert.equal(job.read('events.json'), events);
  } finally { job.done(); }

  const blocked = scratchJob();
  try {
    const feed = sampleFeed(Date.now());
    // Three newer posts that always answer 404 sit in front of the six readable ones.
    for (const id of [2003, 2002, 2001]) feed.list.unshift({ id, name: `Gone ${id}`, category: 'general', liveDate: new Date(Date.now() - 60000).toISOString() });
    const first = blocked.run(feed);
    assert.deepEqual(first.asked, [2001, 2002, 2003]);
    assert.equal(first.meta.events, 0);
    const second = blocked.run(feed);
    assert.deepEqual(second.asked.slice(0, 6), [1000, 999, 998, 997, 996, 995]);
    assert.equal(second.meta.events, 6);
  } finally { blocked.done(); }
});

// ---- the workflow's save step, run for real against a stand-in remote on this disk

const WORKFLOW = readFileSync(new URL('../../.github/workflows/update-and-deploy.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function saveStepScript() {
  const lines = WORKFLOW.split('\n');
  const at = lines.findIndex((l) => l.includes('name: Save changed data back to the repo'));
  assert.ok(at >= 0 && /run: \|/.test(lines[at + 1]), 'the save step is a run block');
  const indent = /^ */.exec(lines[at + 2])[0].length;
  const body = [];
  for (const l of lines.slice(at + 2)) {
    if (l.trim() && /^ */.exec(l)[0].length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

const sh = (cwd, script) => spawnSync('bash', ['-ec', script], { cwd, encoding: 'utf8' });
const canRun = (() => { try { return sh(tmpdir(), 'git --version').status === 0; } catch { return false; } })();

test('77: the run starts from the newest main', () => {
  const lines = WORKFLOW.split('\n');
  const at = lines.findIndex((l) => /uses: actions\/checkout@/.test(l));
  assert.match(lines.slice(at + 1, at + 4).join('\n'), /with:\s*\n\s*ref: main/);
});

test('77: the data commit is saved when main moved during the run', { skip: canRun ? false : 'needs bash and git' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'maple-race-'));
  const FILES = ['news', 'events', 'posts', 'characters', 'items', 'shops'].map((n) => `site/data/${n}.json`).concat('site/data/calendar.ics');
  const ok = (cwd, script) => { const r = sh(cwd, script); assert.equal(r.status, 0, `${script}\n${r.stdout}\n${r.stderr}`); return r.stdout; };
  const identity = 'git config user.name Test && git config user.email test@example.test && git config commit.gpgsign false && git config core.autocrlf false';
  try {
    ok(dir, 'git init -q --bare -b main remote.git && git clone -q -c core.autocrlf=false remote.git dev 2>/dev/null');
    mkdirSync(join(dir, 'dev', 'site', 'data'), { recursive: true });
    for (const f of FILES) writeFileSync(join(dir, 'dev', f), 'first\n');
    writeFileSync(join(dir, 'dev', 'code.txt'), 'X\n');
    ok(join(dir, 'dev'), `${identity} && git checkout -q -B main && git add -A && git commit -q -m X && git push -q origin main`);
    // The run checks out main at X.
    ok(dir, 'git clone -q -c core.autocrlf=false remote.git run');
    ok(join(dir, 'run'), identity);
    // While it works, a push lands on main: new code, and a data file this run does not change, edited by hand.
    writeFileSync(join(dir, 'dev', 'code.txt'), 'Y\n');
    writeFileSync(join(dir, 'dev', 'site', 'data', 'shops.json'), 'from the computer\n');
    ok(join(dir, 'dev'), 'git commit -q -am Y && git push -q origin main');
    // The run has fresh data and saves it with the workflow's own commands.
    writeFileSync(join(dir, 'run', 'site', 'data', 'events.json'), 'from the run\n');
    writeFileSync(join(dir, 'run', 'site', 'data', 'news.json'), 'from the run\n');
    const step = sh(join(dir, 'run'), saveStepScript());
    assert.equal(step.status, 0, `${step.stdout}\n${step.stderr}`);
    assert.deepEqual(ok(join(dir, 'remote.git'), 'git log --format=%s main').trim().split('\n'), ['Update Nexon data', 'Y', 'X']);
    const show = (f) => ok(join(dir, 'remote.git'), `git show main:${f}`).trim();
    assert.equal(show('code.txt'), 'Y');
    assert.equal(show('site/data/events.json'), 'from the run');
    assert.equal(show('site/data/news.json'), 'from the run');
    assert.equal(show('site/data/shops.json'), 'from the computer', 'the hand edit is kept');
    // The files that get deployed are the run's too.
    assert.equal(readFileSync(join(dir, 'run', 'site', 'data', 'events.json'), 'utf8').trim(), 'from the run');
    assert.equal(readFileSync(join(dir, 'run', 'code.txt'), 'utf8').trim(), 'Y');
    // Nothing to save: the step still succeeds.
    const idle = sh(join(dir, 'run'), saveStepScript());
    assert.equal(idle.status, 0);
    assert.match(idle.stdout, /No data changes/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('47, 48: a title row stretched over a table is not its header, and a carried-over id is never taken by a new item', () => {
  const body = `<h2>Star Coin Shop</h2><p>${S4}</p><table><tbody>
    <tr><th colspan="3">Growth Tab</th></tr>
    <tr><th>Item</th><th>Price (Star Coin)</th><th>Qty. Limit</th></tr>
    <tr><td><strong>Chair:</strong> x.</td><td>50</td><td>1</td></tr></tbody></table>`;
  assert.deepEqual(findShops(body, post(1, '2026-11-10T00:00:00Z'))[0].items, [{ id: 'chair', name: 'Chair', cost: 50, limit: 1 }]);
  const base = { name: 'T', currency: 'C', start: '2026-11-11T00:00:00.000Z', end: '2027-02-09T23:59:00.000Z' };
  const file = { shops: [{ ...base, id: 't', items: [{ id: 'x', name: 'Old Name', cost: 5 }] }] };
  const parsed = [{ ...base, id: 't2', postId: 1, items: [{ id: 'x', name: 'X', cost: 9 }, { id: 'old-name', name: 'Old Name', cost: 5 }] }];
  assert.deepEqual(mergeShops(file, parsed, Date.parse('2026-11-24T00:00:00Z')).shops[0].items.map((i) => [i.id, i.name]), [['x-2', 'X'], ['x', 'Old Name']]);
});
