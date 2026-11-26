// Checklist status maths (no DOM): which reset an item follows and whether it is done for the current period.
//
// Ticks are kept per character. `who` is the character being looked at: { id, level, challenger }.
// (A bare number is still accepted as the level, and no id means "no character yet": one shared list.)
// - An item with "scope": "account" is ticked once for the whole account.
// - An item with "only": "challenger" is hidden for characters that are not in Challenger World.
// - An item with "minLevel" stays locked until the character reaches it.
// - An item with "gate" (the id of a symbol area in symbols.json) stays locked until that area is unlocked:
//   either Progress holds a symbol level above 0 for it (who.open lists those areas), which also proves the
//   level, or the player pressed "Mark unlocked" (a flag, which can be taken back).
//
// One record per boss clear: the ticks on the Bosses page (state.bosses[charId].clears) are the only record.
// - An item with "bosses": "daily" (or "weekly") follows the bosses of that reset the character picked on Bosses:
//   one row per shared clear, done when all are cleared. With none picked it is only a pointer to Bosses and is
//   not counted anywhere (`link`).
// - An item with "boss": [ids] is the clear of that boss (its difficulties): the same tick as its Bosses row,
//   also when the boss is not picked. With "scope": "account" a clear on any character counts.
// For these `who.bosses` carries what is needed: { data, byId, all, char, chars } (see whoFor in pages/checklist.js).
import { periodKey } from '../time.js';
import { characterLines, bossRows, bossClear } from './income.js';

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

// True when the checklist holds ticks or unlock flags that are not tied to a character (saved before they were
// per character, or before any character existed). Only then does the list need an owner.
export function hasSharedTicks(checklistState) {
  const shared = (m) => Object.keys(m || {}).some((k) => !k.includes('|'));
  return shared(checklistState.items) || shared(checklistState.flags);
}

// Ticks and flags saved before they were per character belong to checklist.owner (the character that was
// active when the tracker was updated), so nothing that was ticked that day is lost.
function isOwner(checklistState, w) {
  return !w.id || checklistState.owner === w.id;
}

// The areas a character has unlocked according to Progress: every symbol entry with a level above 0.
export function openAreas(symbolEntries) {
  return Object.entries(symbolEntries || {}).filter(([, e]) => e && e.level > 0).map(([id]) => id);
}

// The unlock flags "Mark unlocked" sets for an item, and "Lock again" takes back.
export function unlockFlags(item) {
  return [...(item.minLevel ? [`lvl:${item.id}`] : []), ...(item.gate ? [item.gate] : [])];
}

// "Mark unlocked" / "Lock again": sets every unlock flag of an item for character `who`. Flags are set to
// false, not removed, so the change is carried to other devices like any other. Changes `checklistState` in place.
export function setUnlocked(checklistState, item, who, on) {
  const w = asWho(who);
  for (const name of unlockFlags(item)) {
    checklistState.flags[flagKey(name, w)] = Boolean(on);
    // A flag saved before flags were per character still counts for the list's owner: it goes too.
    if (!on && w.id && isOwner(checklistState, w) && checklistState.flags[name]) checklistState.flags[name] = false;
  }
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

// The boss lines of the character being looked at (empty without a character).
function bossLines(w, now) {
  const b = w.bosses;
  return b && b.char && b.data && b.byId ? characterLines(b.char, (b.all || {})[b.char.id], b.data, b.byId, now) : [];
}

// The clear an item with `boss` stands for: `own` is the character's (where a tick goes); `on` also counts a
// clear on another character when the item is account-wide; `others` lists those characters' clears.
function bossItemClear(item, w, now) {
  const b = w.bosses;
  if (!b || !b.char || !b.byId) return null;
  const all = b.all || {};
  const own = bossClear(item.boss, all[b.char.id], b.byId, now);
  if (!own) return null;
  const others = item.scope === 'account'
    ? (b.chars || []).filter((c) => c && c.id !== b.char.id).map((c) => ({ id: c.id, name: c.name, ...bossClear(item.boss, all[c.id], b.byId, now) })).filter((c) => c.on)
    : [];
  return { ...own, own: own.on, on: own.on || others.length > 0, others };
}

export function itemStatus(item, group, checklistState, now, who) {
  const w = asWho(who);
  const kind = resetOf(item, group, checklistState);
  // "lvl:<id>" is the player's own override ("Mark unlocked"), e.g. when the tracker's level is behind.
  // proven: Progress holds a symbol level for the item's area, so the area is open whatever else is known.
  const proven = Boolean(item.gate && Array.isArray(w.open) && w.open.includes(item.gate));
  const below = Boolean(item.minLevel && Number.isFinite(w.level) && w.level < item.minLevel);
  const tooLow = !proven && below && !flagOn(checklistState, `lvl:${item.id}`, w);
  const gated = Boolean(!proven && item.gate && !flagOn(checklistState, item.gate, w));
  const locked = gated || tooLow;
  // byHand: open only because the player said so (nothing the tracker knows proves it), so it can be locked again.
  const byHand = !locked && !proven && Boolean(below || item.gate);
  const notForChar = Boolean(item.only === 'challenger' && w.id && !w.challenger);
  const expired = Boolean((item.until && Date.parse(item.until) < now) || notForChar);
  if (item.type === 'count') {
    const r = record(checklistState, item, '', kind, now, w);
    // A whole number from 0 to the target, whatever was saved.
    const count = r && typeof r.c === 'number' && Number.isFinite(r.c) ? Math.max(0, Math.min(item.target, Math.floor(r.c))) : 0;
    return { kind, locked, tooLow, gated, byHand, expired, count, done: count >= item.target };
  }
  if (item.type === 'chips') {
    const on = item.chips.map(([cid]) => Boolean(record(checklistState, item, `_${cid}`, kind, now, w)?.d));
    return { kind, locked, tooLow, gated, byHand, expired, on, done: on.every(Boolean) };
  }
  if (item.bosses) {
    const rows = bossRows(bossLines(w, now), item.bosses);
    const count = rows.filter((r) => r.on).length;
    const pointer = item.type === 'link';
    // `prompt`: nothing is picked, so the row only says where to pick.
    return { kind, locked, tooLow, gated, byHand, expired, rows, count, total: rows.length, done: rows.length > 0 && count === rows.length, link: pointer || rows.length === 0, prompt: !pointer && rows.length === 0 };
  }
  if (item.type === 'link') return { kind, locked, tooLow, gated, byHand, expired, done: false, link: true };
  const r = record(checklistState, item, '', kind, now, w);
  const clear = item.boss ? bossItemClear(item, w, now) : null;
  // `old`: a tick made on the checklist before the row became the boss's own tick. It still shows for its week.
  if (clear) return { kind, locked, tooLow, gated, byHand, expired, done: Boolean(clear.on || (r && r.d)), clear, old: Boolean(r && r.d) };
  return { kind, locked, tooLow, gated, byHand, expired, done: Boolean(r && r.d) };
}

// The rows of a group the Checklist page draws. The symbol-area dailies form a ladder (Arcus, then Odium, ...).
// A locked area is listed when the character's level has reached it; of the locked areas further up (or of all
// of them while no level is known) only the first is listed, and the rest appear as the character gets there.
export function listedItems(group, checklistState, now, who) {
  const levelKnown = Number.isFinite(asWho(who).level);
  let lockedBefore = false;
  return group.items.filter((item) => {
    if (!item.gate) return true;
    const st = itemStatus(item, group, checklistState, now, who);
    if (!st.locked) return true;
    const show = (levelKnown && !st.tooLow) || !lockedBefore;
    lockedBefore = true;
    return show;
  });
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

// Files an item's ticks under reset day `to` instead of `from` (the reset day is one setting for everyone, so
// every character's tick moves). Nothing is ever deleted here: the pill steps through the days one tap at a time,
// so a day passed on the way must not cost a tick that the day finally chosen still counts.
// - A tick that carries its time (`t`) is filed under the week that time falls in with the new day. If the new
//   day has reset since, that is a past week and the item shows as not done; if a later tap lands on a day that
//   has not reset it, it shows again. A tick from the old day's last week that the new day has not reset yet
//   comes back the same way.
// - A tick saved before ticks carried a time stays in the running week, since nothing says when it was made.
// A counter's time is its last change. Changes `items` in place.
export function moveResetDay(items, item, from, to, now) {
  const oldP = periodKey(from, now);
  const newP = periodKey(to, now);
  const tails = ['', ...(item.chips || []).map(([cid]) => `_${cid}`)].map((s) => item.id + s);
  for (const [k, r] of Object.entries(items)) {
    if (!r || typeof r !== 'object' || !tails.some((tail) => k === tail || k.endsWith(`|${tail}`))) continue;
    // The time is only trusted when it agrees with the week the tick is filed under.
    // A timed tick is only re-filed when the new day still counts it in the running week. One from a week that
    // is over stays as it is (its key names another day or week, so it reads as not done), which also leaves
    // its sync stamp alone: re-filing it would make this device's old tick beat a newer one from another device.
    if (Number.isFinite(r.t) && r.t <= now && RESET_CYCLE.some((d) => r.p === periodKey(d, r.t))) { if (periodKey(to, r.t) === newP) r.p = newP; }
    else if (r.p === oldP) r.p = newP;
  }
}
