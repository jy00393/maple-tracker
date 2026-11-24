// Checklist status maths (no DOM): which reset an item follows and whether it is done for the current period.
import { periodKey } from '../time.js';

export const RESET_CYCLE = ['mon', 'wed', 'thu'];

export function resetOf(item, group, checklistState) {
  if (group.reset !== 'custom') return group.reset;
  const r = checklistState.resets[item.id];
  return RESET_CYCLE.includes(r) ? r : item.def || 'mon';
}

function record(checklistState, id, kind, now) {
  const r = checklistState.items[id];
  return r && r.p === periodKey(kind, now) ? r : null;
}

// level: the active character's level, if known. Items with a minLevel stay locked until it is reached.
export function itemStatus(item, group, checklistState, now, level) {
  const kind = resetOf(item, group, checklistState);
  // "lvl:<id>" in flags is the player's own override ("Mark unlocked"), e.g. when the tracker's level is behind.
  const tooLow = Boolean(item.minLevel && Number.isFinite(level) && level < item.minLevel && !checklistState.flags[`lvl:${item.id}`]);
  const locked = Boolean(item.gate && !checklistState.flags[item.gate]) || tooLow;
  const expired = item.until && Date.parse(item.until) < now;
  if (item.type === 'count') {
    const r = record(checklistState, item.id, kind, now);
    const count = r ? r.c || 0 : 0;
    return { kind, locked, expired, count, done: count >= item.target };
  }
  if (item.type === 'chips') {
    const on = item.chips.map(([cid]) => Boolean(record(checklistState, `${item.id}_${cid}`, kind, now)?.d));
    return { kind, locked, expired, on, done: on.every(Boolean) };
  }
  if (item.type === 'link') return { kind, locked, expired, done: false, link: true };
  const r = record(checklistState, item.id, kind, now);
  return { kind, locked, expired, done: Boolean(r && r.d) };
}
