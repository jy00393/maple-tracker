// Checklist status maths (no DOM): which reset an item follows and whether it is done for the current period.
//
// Ticks are kept per character. `who` is the character being looked at: { id, level, challenger }.
// (A bare number is still accepted as the level, and no id means "no character yet": one shared list.)
// - An item with "scope": "account" is ticked once for the whole account.
// - An item with "only": "challenger" is hidden for characters that are not in Challenger World.
// - An item with "minLevel" stays locked until the character reaches it.
import { periodKey } from '../time.js';

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
  let r = checklistState.items[recordKey(item, w, suffix)];
  if (!r && w.id && item.scope !== 'account' && isOwner(checklistState, w)) r = checklistState.items[item.id + suffix];
  return r && r.p === periodKey(kind, now) ? r : null;
}

export function itemStatus(item, group, checklistState, now, who) {
  const w = asWho(who);
  const kind = resetOf(item, group, checklistState);
  // "lvl:<id>" is the player's own override ("Mark unlocked"), e.g. when the tracker's level is behind.
  const tooLow = Boolean(item.minLevel && Number.isFinite(w.level) && w.level < item.minLevel && !flagOn(checklistState, `lvl:${item.id}`, w));
  const locked = Boolean(item.gate && !flagOn(checklistState, item.gate, w)) || tooLow;
  const notForChar = Boolean(item.only === 'challenger' && w.id && !w.challenger);
  const expired = Boolean((item.until && Date.parse(item.until) < now) || notForChar);
  if (item.type === 'count') {
    const r = record(checklistState, item, '', kind, now, w);
    const count = r ? r.c || 0 : 0;
    return { kind, locked, expired, count, done: count >= item.target };
  }
  if (item.type === 'chips') {
    const on = item.chips.map(([cid]) => Boolean(record(checklistState, item, `_${cid}`, kind, now, w)?.d));
    return { kind, locked, expired, on, done: on.every(Boolean) };
  }
  if (item.type === 'link') return { kind, locked, expired, done: false, link: true };
  const r = record(checklistState, item, '', kind, now, w);
  return { kind, locked, expired, done: Boolean(r && r.d) };
}
