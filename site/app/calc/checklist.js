// Checklist status maths (no DOM): which reset an item follows and whether it is done for the current period.
//
// Ticks are kept per character. `who` is the character being looked at: { id, level, challenger }.
// (A bare number is still accepted as the level, and no id means "no character yet": one shared list.)
// - An item with "scope": "account" is ticked once for the whole account.
// - An item with "only": "challenger" is hidden for characters that are not in Challenger World.
// - An item with "minLevel" stays locked until the character reaches it.
import { periodKey, weekStart } from '../time.js';

export const RESET_CYCLE = ['mon', 'wed', 'thu'];

export function asWho(who) {
  return who && typeof who === 'object' ? who : { level: who };
}

// Where an item's tick is stored in checklist.items.
export function recordKey(item, who, suffix = '') {
  const w = asWho(who);
  return (item.scope === 'account' || !w.id ? item.id : `${w.id}|${item.id}`) + suffix;
}

// Where a per-character unlock flag is stored in checklist.flags.
export function flagKey(name, who) {
  const w = asWho(who);
  return w.id ? `${w.id}|${name}` : name;
}

// Ticks and flags saved before they were per character belong to checklist.owner (the character that was
// active when the tracker was updated), so nothing that was ticked that day is lost.
function isOwner(checklistState, w) {
  return !w.id || checklistState.owner === w.id;
}

function flagOn(checklistState, name, w) {
  return Boolean(checklistState.flags[flagKey(name, w)] || (w.id && isOwner(checklistState, w) && checklistState.flags[name]));
}

export function resetOf(item, group, checklistState) {
  if (group.reset !== 'custom') return group.reset;
  const r = checklistState.resets[item.id];
  return RESET_CYCLE.includes(r) ? r : item.def || 'mon';
}

function record(checklistState, item, suffix, kind, now, w) {
  const p = periodKey(kind, now);
  const r = checklistState.items[recordKey(item, w, suffix)];
  if (r && r.p === p) return r;
  if (w.id && item.scope !== 'account' && isOwner(checklistState, w)) {
    const old = checklistState.items[item.id + suffix];
    if (old && old.p === p) return old;
  }
  return null;
}

export function itemStatus(item, group, checklistState, now, who) {
  const w = asWho(who);
  const kind = resetOf(item, group, checklistState);
  // "lvl:<id>" is the player's own override ("Mark unlocked"), e.g. when the tracker's level is behind.
  const tooLow = Boolean(item.minLevel && Number.isFinite(w.level) && w.level < item.minLevel && !flagOn(checklistState, `lvl:${item.id}`, w));
  const gated = Boolean(item.gate && !flagOn(checklistState, item.gate, w));
  const locked = gated || tooLow;
  const notForChar = Boolean(item.only === 'challenger' && w.id && !w.challenger);
  const expired = Boolean((item.until && Date.parse(item.until) < now) || notForChar);
  if (item.type === 'count') {
    const r = record(checklistState, item, '', kind, now, w);
    // A whole number from 0 to the target, whatever was saved.
    const count = r && typeof r.c === 'number' && Number.isFinite(r.c) ? Math.max(0, Math.min(item.target, Math.floor(r.c))) : 0;
    return { kind, locked, tooLow, gated, expired, count, done: count >= item.target };
  }
  if (item.type === 'chips') {
    const on = item.chips.map(([cid]) => Boolean(record(checklistState, item, `_${cid}`, kind, now, w)?.d));
    return { kind, locked, tooLow, gated, expired, on, done: on.every(Boolean) };
  }
  if (item.type === 'link') return { kind, locked, tooLow, gated, expired, done: false, link: true };
  const r = record(checklistState, item, '', kind, now, w);
  return { kind, locked, tooLow, gated, expired, done: Boolean(r && r.d) };
}

// The account's streak calendar has one entry per day. Decide what today's entry should be when character
// `by` has done `done` of `total`: the same character's progress replaces it (up or down); another character
// only replaces it by doing better, so looking at an alt never breaks the main's streak. Returns null for "leave it".
export function streakEntry(existing, done, total, by) {
  if (!total) return null;
  const next = { done, total, ...(by ? { by } : {}) };
  if (!existing || !existing.total) return next;
  if (existing.done === done && existing.total === total && (existing.by || null) === (by || null)) return null;
  if (!existing.by || !by || existing.by === by) return existing.done === done && existing.total === total ? null : next;
  return done / total > existing.done / existing.total ? next : null;
}

const ratio = (e) => (e && e.total > 0 ? e.done / e.total : 0);

// What today's streak entry should be, worked out from every character's ticks: `list` holds one
// { by, done, total } per character. The ticks are what sync carries between devices, so every device that has
// them arrives at the same entry, whichever character it shows. The furthest-along character is recorded; on a
// tie the one already recorded stays, then the one on screen (`activeId`). Returns null for "leave it".
export function streakToday(existing, list, activeId) {
  const rank = (p) => (existing && existing.by && p.by === existing.by ? 2 : p.by === activeId ? 1 : 0);
  let best = null;
  for (const p of list) {
    if (!p || !(p.total > 0)) continue;
    if (!best || ratio(p) > ratio(best) || (ratio(p) === ratio(best) && rank(p) > rank(best))) best = p;
  }
  if (!best) return null;
  // An entry made by a character that is no longer in the list cannot be re-counted: it only gives way to a better one.
  if (existing && existing.total && existing.by && !list.some((p) => p && p.by === existing.by)) return streakEntry(existing, best.done, best.total, best.by);
  if (existing && existing.done === best.done && existing.total === best.total && (existing.by || null) === (best.by || null)) return null;
  return { done: best.done, total: best.total, ...(best.by ? { by: best.by } : {}) };
}

const WEEKDAY = { mon: 1, wed: 3, thu: 4 };

// Moves an item's ticks of the current week from reset day `from` to reset day `to` (the reset day is one setting
// for everyone, so every character's tick moves). A tick made before the new day's latest reset is cleared: with
// the new day, that reset has wiped it. Ticks saved before they carried a time (`t`) are kept, since nothing
// says when they were made. Changes `items` in place.
export function moveResetDay(items, item, from, to, now) {
  const oldP = periodKey(from, now);
  const newP = periodKey(to, now);
  const oldStart = weekStart(now, WEEKDAY[from]);
  const newStart = weekStart(now, WEEKDAY[to]);
  const tails = ['', ...(item.chips || []).map(([cid]) => `_${cid}`)].map((s) => item.id + s);
  for (const [k, r] of Object.entries(items)) {
    if (!r || r.p !== oldP || !tails.some((tail) => k === tail || k.endsWith(`|${tail}`))) continue;
    if (newStart > oldStart && Number.isFinite(r.t) && r.t < newStart) delete items[k];
    else r.p = newP;
  }
}
