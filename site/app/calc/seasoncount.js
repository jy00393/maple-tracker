// Season counters and "use it or lose it" (no DOM).
// - Counters typed in from the game (state.season, account-wide): Challenger Pass level, Supply Report and Defense
//   Mission counts, Etherion Relics completions and the level of the core being raised. The rules come from
//   data/season.json (counters) and data/etherion.json, each with its source.
// - What expires soon: coin shop items that carry an `expires` date (read from Nexon's posts by the job) and the
//   hand list in season.json (expiring).
import { DAY, nextReset } from '../time.js';
import { weeksLeft, shopItems } from './shops.js';

const WEEK = 7 * DAY;
const WEEKLY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const safeKey = (k) => !(k in Object.prototype);

// The saved counters and their ranges. A figure outside its range is dropped (shown as not typed).
export const SEASON_FIELDS = { pass: [0, 30], supply: [0, 60], defense: [0, 60], ether: [0, 12], core: [1, 6] };

// For calc/sanitise.js: whole numbers inside their range; fields this version does not know are kept as they are,
// so a newer version's data survives an older one.
export function cleanSeason(v) {
  const out = {};
  if (!isObj(v)) return out;
  for (const k of Object.keys(v)) {
    if (!safeKey(k)) continue;
    const x = v[k];
    if (Object.hasOwn(SEASON_FIELDS, k)) {
      const [lo, hi] = SEASON_FIELDS[k];
      if (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi) out[k] = Math.floor(x);
    } else if (x !== undefined && x !== null) out[k] = x;
  }
  return out;
}

const counted = (v) => typeof v === 'number' && Number.isFinite(v);

// Coin shops whose claims are a season counter (shops.json earn.counter, e.g. the Alliance Credit Shop's Defense
// Missions): [{ shop, counter }].
export function linkedShops(data) {
  const list = data && data.shops && Array.isArray(data.shops.shops) ? data.shops.shops : [];
  return list.filter((s) => s && s.earn && typeof s.earn.counter === 'string' && Object.hasOwn(SEASON_FIELDS, s.earn.counter)).map((shop) => ({ shop, counter: shop.earn.counter }));
}

// The season counters as the pages read them: one count for a counter that a shop also keeps as its claims. Before
// the two were joined they were typed separately; both only rise during a season, so the larger stands.
export function seasonCounts(data, state) {
  const s = isObj(state && state.season) ? { ...state.season } : {};
  const shops = isObj(state && state.shops) ? state.shops : {};
  for (const { shop, counter } of linkedShops(data)) {
    const saved = Object.hasOwn(shops, shop.id) && isObj(shops[shop.id]) ? shops[shop.id].claims : undefined;
    const c = counted(saved) && saved > 0 ? Math.min(Math.floor(saved), SEASON_FIELDS[counter][1]) : undefined;
    if (c !== undefined && !(counted(s[counter]) && s[counter] >= c)) s[counter] = c;
  }
  return s;
}

// Which season caps are reached: { pass, supply, defense, etherion }. A Checklist item with "seasonCap": "<name>"
// reads as done for the season once its cap is reached (see itemStatus in calc/checklist.js).
export function seasonCaps(data, saved) {
  const c = (data && data.season && data.season.counters) || {};
  const e = data && data.etherion;
  const s = isObj(saved) ? saved : {};
  const hit = (cfg, v) => Boolean(cfg && cfg.max > 0 && counted(v) && v >= cfg.max);
  return { pass: hit(c.pass, s.pass), supply: hit(c.supply, s.supply), defense: hit(c.defense, s.defense), etherion: hit(e, s.ether) };
}

// Challenger Pass: `lv` typed at `at`. With every week maxed (perWeek points), the level cap is reached by the end
// of week n, the week the level was typed in counting as week 1 (its points may already be partly earned, so the
// date is the earliest one).
// Returns null without a level; { done } at the cap; { short, reach } when the cap cannot be reached before the
// season ends; otherwise { by, weeks, need, due } (due: that date has passed, so the level needs updating).
export function passPlan(cfg, lv, at, now) {
  if (!cfg || !counted(lv)) return null;
  if (lv >= cfg.max) return { done: true };
  const from = Number.isFinite(at) && at > 0 ? Math.min(at, now) : now;
  const end = Date.parse(cfg.ends);
  const need = (cfg.max - lv) * cfg.perLevel;
  const weeks = Math.ceil(need / cfg.perWeek);
  const open = weeksLeft(end, from, cfg.reset);
  if (weeks > open) return { short: true, need, reach: Math.min(cfg.max, lv + Math.floor((open * cfg.perWeek) / cfg.perLevel)) };
  const by = Math.min(end, nextReset(cfg.reset, from) + (weeks - 1) * WEEK);
  return { by, weeks, need, due: by <= now };
}

// A count with a weekly and a season cap (Supply Report, Defense Mission): `n` typed at `at`. Weeks are counted
// from the one the figure was typed in, that week included in full.
// Returns null without a count; { done } at the cap; { short, reach } when the cap is out of reach; otherwise
// { left, weeks, spare, spareWeeks }: how many collections can still be missed, and how many whole weeks that is.
// With `perDay` (Supply Report: one collection a day you log in), the days left also cap it: the day the figure was
// typed counts (its collection may not be in the count yet). `byDays` then says the days are the limit.
export function capPlan(cfg, n, at, now, resetKind = cfg && cfg.reset) {
  if (!cfg || !counted(n)) return null;
  if (n >= cfg.max) return { done: true };
  const from = Number.isFinite(at) && at > 0 ? Math.min(at, now) : now;
  const left = cfg.max - n;
  const end = Date.parse(cfg.ends);
  const weeks = weeksLeft(end, from, resetKind);
  const days = Math.max(0, Math.ceil((end - Math.floor(from / DAY) * DAY) / DAY));
  const byWeek = weeks * cfg.perWeek;
  const byDay = cfg.perDay > 0 ? days * cfg.perDay : Infinity;
  const byDays = byDay < byWeek;
  const room = Math.min(byWeek, byDay);
  const extra = byDays ? { byDays, days } : {};
  if (room < left) return { short: true, left, weeks, reach: n + room, ...extra };
  const spare = room - left;
  return { left, weeks, spare, spareWeeks: byDays ? 0 : Math.floor(spare / cfg.perWeek), ...extra };
}

// Expected Etherion for one enhancement from core level `from` (cost / success rate), and to Lv. `to` from `from`.
export function coreStep(e, from) {
  const s = e && Array.isArray(e.enhance) ? e.enhance.find((x) => x.from === from) : null;
  return s && s.rate > 0 ? { ...s, avg: s.cost / s.rate } : null;
}
export function coreCost(e, from, to) {
  let sum = 0;
  for (let l = from; l < to; l++) {
    const s = coreStep(e, l);
    if (!s) return null;
    sum += s.avg;
  }
  return sum;
}

// Etherion Relics: `done` completions, `core` the level of the core being raised.
export function etherionPlan(e, done, core) {
  if (!e) return null;
  const order = Array.isArray(e.order) ? e.order : [];
  const cores = order.filter((o) => o.core).length;
  const out = { max: e.max, cores, known: counted(done) };
  if (counted(done)) {
    out.done = done;
    out.left = Math.max(0, e.max - done);
    out.finished = done >= e.max;
    out.coresOpen = order.filter((o) => o.core && o.n <= done).length;
    out.next = order.find((o) => o.n === done + 1) || null;
  }
  if (counted(core)) {
    out.core = core;
    out.step = coreStep(e, core);
    // Lv. 5 is where every core can go; Lv. 6 is the last step.
    out.toFive = core < 5 ? coreCost(e, core, 5) : null;
  }
  return out;
}

// When the coins for every pick are in hand, at the pace the planner counts (calc/shops.js coinsToCome): now when
// the coins held cover them, Infinity when they cannot be reached before the shop closes. Coins of a week are
// counted at that week's end (the reset day set on Checklist, or 7-day blocks counted back from the close).
export function picksPaidBy(shop, plan, now, resetKind, weekly) {
  if (!shop || !plan) return Infinity;
  const need = plan.need - plan.have;
  if (need <= 0) return now;
  if (plan.short > 0 || !plan.open) return Infinity;
  const end = Date.parse(shop.end);
  let per = 0;
  let skip = 0;
  if (shop.bounty) { per = weekly ? Number(weekly.perWeek) || 0 : 0; skip = weekly && weekly.thisWeekDone ? 1 : 0; }
  else if (shop.earn) per = (Number(shop.earn.perWeek) || 0) * (Number(shop.earn.perClaim) || 0);
  if (!(per > 0)) return Infinity;
  const k = Math.ceil(need / per) + skip;
  const weeks = weeksLeft(end, now, resetKind);
  const weekEnd = WEEKLY.includes(resetKind) ? nextReset(resetKind, now) + (k - 1) * WEEK : end - (weeks - k) * WEEK;
  return Math.min(end, weekEnd);
}

// The picked items (still to buy) that expire before the picks can all be paid for. Nothing is bought after the shop
// closes (`closes`, ms), so an item that expires after that is never flagged: being short is not an expiry.
export function expiringPicks(plan, paidBy, closes = Infinity) {
  if (!plan) return [];
  const by = Math.min(paidBy, Number.isFinite(closes) ? closes : Infinity);
  return plan.rows.filter((r) => r.want > 0 && r.item.expires && Date.parse(r.item.expires) <= by);
}

// What expires within `days` days: grouped by date, soonest first. Each group: { at, hand: [season.json entries],
// picks: [{ shop, item, want }] (coin shop items you still plan to buy), shops: [{ name, count }] (other items
// with that date). `who`: { level, challenger } of the character on screen (null: everything is listed).
export function expiringSoon(data, saved, who, now, days = 21) {
  const groups = new Map();
  const near = (at) => Number.isFinite(at) && at > now && at - now <= days * DAY;
  const group = (at) => {
    if (!groups.has(at)) groups.set(at, { at, hand: [], picks: [], shops: [] });
    return groups.get(at);
  };
  const w = who || {};
  const season = data && data.season;
  for (const e of (season && Array.isArray(season.expiring) ? season.expiring : [])) {
    const at = Date.parse(e.at);
    if (!near(at)) continue;
    if (e.only === 'challenger' && w.challenger === false) continue;
    if (e.minLevel && Number.isFinite(w.level) && w.level < e.minLevel) continue;
    group(at).hand.push(e);
  }
  const shops = data && data.shops && Array.isArray(data.shops.shops) ? data.shops.shops : [];
  const shopState = isObj(saved) ? saved : {};
  for (const shop of shops) {
    if (/^challenger world/i.test(shop.name || '') && w.challenger === false) continue;
    const want = (isObj(shopState[shop.id]) && isObj(shopState[shop.id].want)) ? shopState[shop.id].want : {};
    const others = new Map();
    for (const item of shopItems(shop, w.world ? w : null)) {
      const at = Date.parse(item.expires);
      if (!near(at)) continue;
      const n = Object.hasOwn(want, item.id) ? Number(want[item.id]) || 0 : 0;
      if (n > 0) group(at).picks.push({ shop, item, want: n });
      else others.set(at, (others.get(at) || 0) + 1);
    }
    for (const [at, count] of others) group(at).shops.push({ name: shop.name, count });
  }
  return [...groups.values()].sort((a, b) => a.at - b.at);
}

// Season-only growth potions (expsources.json "seasonal") that work at `level` and have not expired.
export function seasonalPotions(src, level, now) {
  const list = src && Array.isArray(src.seasonal) ? src.seasonal : [];
  return list.filter((p) => Number.isFinite(level) && level >= p.from && level <= p.to && Date.parse(p.expires) > now);
}
