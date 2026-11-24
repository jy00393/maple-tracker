// Event coin shop planner: what your picks cost against the coins you hold and can still earn.
// Saved per shop as { have, claims, want: { itemId: qty } }. "want" is what you still plan to buy.
const DAY = 86400000;
const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

// Items this character can buy: world-only items for the other world type are left out.
export function shopItems(shop, char) {
  const world = char && char.world === 'interactive' ? 'interactive' : 'heroic';
  return (shop.items || []).filter((it) => !it.only || it.only === world);
}

// Most you can buy of an item in total. Daily and weekly limits have no fixed total.
export function itemCap(item) {
  return item.per ? undefined : item.limit;
}

export function limitText(item) {
  if (item.limitNote) return item.limitNote;
  if (item.per === 'day') return `${item.limit} a day`;
  if (item.per === 'week') return `${item.limit} a week`;
  return String(item.limit);
}

// Coins still earnable before the shop closes: missions left, at most perWeek for each week that remains.
export function coinsToCome(shop, claims, now) {
  const earn = shop.earn;
  if (!earn) return 0;
  const end = Date.parse(shop.end);
  if (!(end > now)) return 0;
  const weeks = Math.ceil((end - now) / (7 * DAY));
  const left = Math.max(0, earn.max - n(claims));
  return Math.min(left, weeks * earn.perWeek) * earn.perClaim;
}

export function shopPlan(shop, saved, char, now) {
  const s = saved || {};
  const want = s.want || {};
  const rows = shopItems(shop, char).map((item) => {
    const cap = itemCap(item);
    const qty = cap === undefined ? n(want[item.id]) : Math.min(n(want[item.id]), cap);
    return { item, want: qty, cost: qty * item.cost };
  });
  const need = rows.reduce((a, r) => a + r.cost, 0);
  const have = n(s.have);
  const toCome = coinsToCome(shop, s.claims, now);
  const open = Date.parse(shop.end) > now;
  return {
    rows, need, have, toCome, open,
    total: have + toCome,
    short: Math.max(0, need - have - toCome),
    spare: Math.max(0, have + toCome - need),
    picked: rows.filter((r) => r.want > 0).length,
    daysLeft: open ? Math.ceil((Date.parse(shop.end) - now) / DAY) : 0
  };
}
