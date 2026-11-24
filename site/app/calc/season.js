// End-of-season outlook for a Challenger World character, from data/season.json (Nexon's notice).
const DAY = 86400000;

// done: { actionId: true }. Returns the countdown and the actions grouped by deadline, soonest first.
export function seasonOutlook(season, done, now) {
  if (!season || !season.ends) return null;
  const ends = Date.parse(season.ends);
  const last = Math.max(ends, ...(season.actions || []).map((a) => Date.parse(a.by)).filter(Number.isFinite));
  if (now > last) return { over: true, ends, open: 0, total: 0, groups: [], daysLeft: 0 };
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
  return { over: false, ends, ended: now >= ends, daysLeft: Math.max(0, Math.ceil((ends - now) / DAY)), groups, open: all.filter((i) => !i.done).length, total: all.length };
}
