// End-of-season outlook for a Challenger World character, from data/season.json (Nexon's notice).
const DAY = 86400000;

// done: { actionId: true }. Returns the countdown and the actions grouped by deadline, soonest first.
// open: steps not ticked whose deadline is still ahead. missed: steps not ticked whose deadline has passed.
// After the last deadline: { over: true, last } (last = that deadline).
export function seasonOutlook(season, done, now) {
  if (!season || !season.ends) return null;
  const ends = Date.parse(season.ends);
  const last = Math.max(ends, ...(season.actions || []).map((a) => Date.parse(a.by)).filter(Number.isFinite));
  if (now > last) return { over: true, ends, last, open: 0, missed: 0, total: 0, groups: [], daysLeft: 0 };
  const groups = [];
  for (const a of season.actions || []) {
    const at = Date.parse(a.by);
    if (!Number.isFinite(at)) continue;
    let g = groups.find((x) => x.at === at);
    if (!g) { g = { at, left: at - now, passed: at <= now, items: [] }; groups.push(g); }
    g.items.push({ ...a, done: Boolean(done && done[a.id]) });
  }
  groups.sort((a, b) => a.at - b.at);
  const all = groups.flatMap((g) => g.items);
  const notDone = (list) => list.flatMap((g) => g.items).filter((i) => !i.done).length;
  const open = notDone(groups.filter((g) => !g.passed));
  return { over: false, ends, last, ended: now >= ends, daysLeft: Math.max(0, Math.ceil((ends - now) / DAY)), groups, open, missed: notDone(groups) - open, total: all.length };
}
