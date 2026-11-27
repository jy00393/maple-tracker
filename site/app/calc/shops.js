// Event coin shop planner: what your picks cost against the coins you hold and can still earn.
// Saved per shop as { have, claims, want: { itemId: qty } }. "want" is what you still plan to buy.
import { DAY, nextReset } from '../time.js';
const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

// Items this character can buy: world-only items for the other world type are left out.
export function shopItems(shop, char) {
  const world = char && char.world === 'interactive' ? 'interactive' : 'heroic';
  return (shop.items || []).filter((it) => !it.only || it.only === world);
}

// Most you can buy of an item in total. Daily and weekly limits, and items with no limit, have no fixed total.
export function itemCap(item) {
  return item.per || !(item.limit > 0) ? undefined : item.limit;
}

export function limitText(item) {
  if (item.limitNote) return item.limitNote;
  if (!(item.limit > 0)) return 'none';
  if (item.per === 'day') return `${item.limit} a day`;
  if (item.per === 'week') return `${item.limit} a week`;
  return String(item.limit);
}

const WEEKLY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Mission weeks still open before `end`, counting the one running now. With a weekly reset day ('mon', 'wed',
// 'thu', as on Checklist) that is 1 + the resets that fall before the end: a week with only a day left still
// counts, so an "up to" figure is never lower than what can be earned. Without a reset day it is 7-day blocks
// counted back from the end.
export function weeksLeft(end, now, resetKind) {
  if (!(end > now)) return 0;
  if (!WEEKLY.includes(resetKind)) return Math.ceil((end - now) / (7 * DAY));
  const first = nextReset(resetKind, now);
  return 1 + (first < end ? Math.floor((end - 1 - first) / (7 * DAY)) + 1 : 0);
}

// Coins still earnable before the shop closes: missions left, at most perWeek for each week that remains.
// A shop paid by a weekly amount instead (`shop.bounty`: Shadow Bounties) takes `weekly` = { perWeek,
// thisWeekDone }: that amount for every week left, less the running week when its coins are already in hand.
export function coinsToCome(shop, claims, now, resetKind, weekly) {
  const end = Date.parse(shop.end);
  if (!(end > now)) return 0;
  if (shop.bounty) {
    const per = weekly ? n(weekly.perWeek) : 0;
    const weeks = Math.max(0, weeksLeft(end, now, resetKind) - (weekly && weekly.thisWeekDone ? 1 : 0));
    return weeks * per;
  }
  const earn = shop.earn;
  if (!earn) return 0;
  const weeks = weeksLeft(end, now, resetKind);
  const left = Math.max(0, earn.max - n(claims));
  return Math.min(left, weeks * earn.perWeek) * earn.perClaim;
}

export function shopPlan(shop, saved, char, now, resetKind, weekly) {
  const s = saved || {};
  const want = s.want || {};
  const rows = shopItems(shop, char).map((item) => {
    const cap = itemCap(item);
    const qty = cap === undefined ? n(want[item.id]) : Math.min(n(want[item.id]), cap);
    return { item, want: qty, cost: qty * item.cost };
  });
  const need = rows.reduce((a, r) => a + r.cost, 0);
  const have = n(s.have);
  const toCome = coinsToCome(shop, s.claims, now, resetKind, weekly);
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
