// Shops whose tabs take different coins, or whose price column does not name the coin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findShops } from '../lib/shops.mjs';

const post = { id: 901, name: 'Patch Notes', category: 'update', liveDate: '2026-11-10T15:30:00Z' };
const dates = '<p>November 11, 2026 (after maintenance) - February 9, 2027 at 11:59 PM UTC</p>';
const row = (name, price, limit) => `<tr><td><strong>${name}:</strong> Tradable.</td><td>${price}</td><td>${limit}</td></tr>`;

test('a shop whose tabs take different coins becomes one shop per coin', () => {
  const body = `<h2>Bounty Coin Shop</h2>${dates}
    <table><tr><th>Item (Basic Tab)</th><th>Price (Basic Bounty Coin)</th><th>Qty. Limit</th></tr>${row('VIP Buff', 10, 'Unlimited')}${row('EXP Coupon', 500, '2 weekly')}</table>
    <table><tr><th>Item (Advanced Tab)</th><th>Price (Advanced Bounty Coin)</th><th>Qty. Limit</th></tr>${row('Sol Erda', 10, 30)}</table>
    <table><tr><th>Item (Extra Basic Tab)</th><th>Price (Basic Bounty Coin)</th><th>Qty. Limit</th></tr>${row('Chair', 5, 1)}</table>
    <table><tr><th>Item (Meso Tab)</th><th>Meso Price</th><th>Qty. Limit</th></tr>${row('Bag', '15,000,000', 10)}</table>`;
  const shops = findShops(body, post);
  assert.deepEqual(shops.map((s) => [s.id, s.name, s.currency, s.items.map((i) => i.name)]), [
    ['bounty-coin-shop-basic-bounty-coin', 'Bounty Coin Shop: Basic Bounty Coin', 'Basic Bounty Coin', ['VIP Buff', 'EXP Coupon', 'Chair']],
    ['bounty-coin-shop-advanced-bounty-coin', 'Bounty Coin Shop: Advanced Bounty Coin', 'Advanced Bounty Coin', ['Sol Erda']]
  ]);
  assert.ok(shops.every((s) => !s.note));
  assert.deepEqual(shops[0].items[0], { id: 'vip-buff', name: 'VIP Buff', cost: 10, limit: null });
});

test('tabs that only say "Price" take the coin named in the text and are planned one tab at a time', () => {
  const body = `<h2>Challenger World Shop</h2>${dates}
    <p>Spend Challenger Coins earned from completing missions in the Challenger World Shop for items that support your progression!</p>
    <table><tr><th>Normal</th><th>Price</th><th>Qty. Limit</th></tr>${row('Sol Erda', '2,000', 5)}${row('EXP Coupon', 100, '7 weekly')}</table>
    <table><tr><th>Special</th><th>Price</th><th>Qty. Limit</th></tr>${row('Sol Erda', 3, 20)}</table>`;
  const shops = findShops(body, post);
  assert.deepEqual(shops.map((s) => [s.id, s.name, s.currency]), [
    ['challenger-world-shop-normal', 'Challenger World Shop: Normal', 'Challenger Coins'],
    ['challenger-world-shop-special', 'Challenger World Shop: Special', 'Challenger Coins']
  ]);
  // The same item at two prices stays apart.
  assert.equal(shops[0].items.find((i) => i.id === 'sol-erda').cost, 2000);
  assert.equal(shops[1].items.find((i) => i.id === 'sol-erda').cost, 3);
  assert.equal(shops[0].note, undefined);
  assert.match(shops[1].note, /does not say whether the Special tab uses a different one/);
  // One such table is simply the shop.
  const single = findShops(`<h2>Mini Shop</h2>${dates}<p>Spend Festival Tokens here.</p><table><tr><th>Normal</th><th>Price</th><th>Qty. Limit</th></tr>${row('Hat', 3, 1)}</table>`, post);
  assert.deepEqual(single.map((s) => [s.name, s.currency, s.note]), [['Mini Shop', 'Festival Tokens', undefined]]);
  // No coin named anywhere: nothing to plan with, so the shop is left out.
  assert.deepEqual(findShops(`<h2>Mystery Shop</h2>${dates}<table><tr><th>Normal</th><th>Price</th><th>Qty. Limit</th></tr>${row('Hat', 3, 1)}</table>`, post), []);
});
