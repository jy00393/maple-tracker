// Dated things announced by Nexon that have not happened yet, soonest first. From data/upcoming.json.
const DAY = 86400000;
// The calendar day in Korea (the app shows KST), as a UTC midnight timestamp.
const kstDay = (t) => Date.parse(new Date(t + 9 * 3600000).toISOString().slice(0, 10));

// Events from Nexon's posts that have not started yet (data/events.json), as list entries. Cash Shop sales,
// maintenance and Classic World posts are left out.
export function eventStarts(events) {
  return (Array.isArray(events) ? events : [])
    .filter((e) => e && e.start && e.title && e.category !== 'sale' && e.category !== 'maintenance' && !e.isClassic)
    .map((e) => ({ id: `event-${e.id}`, at: e.start, day: Boolean(e.startApprox || e.afterMaintenance), title: `${e.title} starts`, note: e.postName ? `From Nexon's post: ${e.postName}.` : 'From a Nexon post.', auto: true }));
}

// char: the active character (or null). Items marked only: 'challenger' are for Challenger World characters.
// events: the parsed Nexon events, whose future start dates are added to the hand-typed list.
export function comingUp(upcoming, now, char, limit = 6, events = []) {
  const items = [...(upcoming && Array.isArray(upcoming.items) ? upcoming.items : []), ...eventStarts(events)]
    .map((it) => ({ ...it, t: Date.parse(it.at) }))
    // A day-only entry ("arrives with that day's maintenance") is listed through its Korean day, the date shown.
    .filter((it) => Number.isFinite(it.t) && (it.day ? kstDay(it.t) >= kstDay(now) : it.t > now))
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
    const days = it.day ? Math.round((kstDay(it.t) - kstDay(now)) / DAY) : Math.max(0, Math.ceil((it.t - now) / DAY));
    out.push({ ...it, days });
  }
  return out.slice(0, limit);
}
