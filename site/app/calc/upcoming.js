// Dated things announced by Nexon that have not happened yet, soonest first. From data/upcoming.json.
import { DAY, kstDays, fmtKst } from '../time.js';
import { isCashSale } from './events.js';

// Events from Nexon's posts that have not started yet (data/events.json), as list entries. Cash Shop sales,
// maintenance and Classic World posts are left out.
export function eventStarts(events) {
  return (Array.isArray(events) ? events : [])
    .filter((e) => e && e.start && e.title && !isCashSale(e) && e.category !== 'maintenance' && !e.isClassic)
    .map((e) => ({ id: `event-${e.id}`, at: e.start, day: Boolean(e.startApprox || e.afterMaintenance), title: `${e.title} starts`, note: e.postName ? `From Nexon's post: ${e.postName}.` : 'From a Nexon post.', auto: true }));
}

// The words beside an entry's date. A day-only entry never says a plain "today": it arrives some time in
// Nexon's server day, which runs into the next Korean morning.
export function comingWhen(c) {
  if (c.late) return `by ${fmtKst(c.t + DAY)}`;
  if (c.days < 1) return c.day ? 'today or overnight' : 'today';
  return c.days === 1 ? 'tomorrow' : `in ${c.days} days`;
}

// char: the active character (or null). Items marked only: 'challenger' are for Challenger World characters.
// events: the parsed Nexon events, whose future start dates are added to the hand-typed list.
export function comingUp(upcoming, now, char, limit = 6, events = []) {
  const items = [...(upcoming && Array.isArray(upcoming.items) ? upcoming.items : []), ...eventStarts(events)]
    .map((it) => ({ ...it, t: Date.parse(it.at) }))
    // A day-only entry ("arrives with that day's maintenance") is Nexon's server day: 09:00 KST on the date shown
    // to 09:00 KST the next morning. It stays listed until that day is over, which covers the maintenance.
    .filter((it) => Number.isFinite(it.t) && (it.day ? it.t + DAY > now : it.t > now))
    .filter((it) => it.only !== 'challenger' || Boolean(char && char.challenger))
    .sort((a, b) => a.t - b.t);
  // Repeating entries of one kind (the weekly pass missions) show only their next date.
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (it.group) {
      if (seen.has(it.group)) continue;
      seen.add(it.group);
    }
    // Every entry counts Korean calendar days to the date shown, so two entries on one date read the same.
    const d = kstDays(now, it.t);
    // late: the Korean date shown has passed, but Nexon's server day (and its maintenance) has not.
    const row = { ...it, days: Math.max(0, d), late: Boolean(it.day && d < 0) };
    out.push({ ...row, when: comingWhen(row) });
  }
  return out.slice(0, limit);
}
