// Sunny Sunday planner. The data job reads each Sunday's perks from Nexon's patch notes into events.json
// ({ date: 'YYYY-MM-DD', perks: [...] }, dates in UTC). A Sunday runs 00:00 to 23:59 UTC (09:00 KST to 08:59 KST Monday).
const DAY = 86400000;

export const isStarForcePerk = (p) => /off Star Force/i.test(p);

export function sunnyDays(sunny, now) {
  return (sunny || [])
    .map((s) => ({ ...s, start: Date.parse(`${s.date}T00:00:00Z`) }))
    .filter((s) => Number.isFinite(s.start) && Array.isArray(s.perks))
    .map((s) => ({ ...s, end: s.start + DAY, active: now >= s.start && now < s.start + DAY, starForce: s.perks.some(isStarForcePerk) }))
    .filter((s) => s.end > now)
    .sort((a, b) => a.start - b.start);
}

// What to do about a Star Force upgrade: { kind: 'now' | 'wait' | 'none' | 'unknown', day?, saves?, through? }
// - now: a Star Force Sunday is on; wait: one is announced; none: Sundays are announced but none has the discount;
// - unknown: no schedule loaded.
export function starForceTiming(sunny, cost, sunnyCost, now) {
  const days = sunnyDays(sunny, now);
  if (!days.length) return { kind: 'unknown' };
  const saves = Math.max(0, (cost || 0) - (sunnyCost || 0));
  const sf = days.find((d) => d.starForce);
  if (!sf) return { kind: 'none', through: days[days.length - 1].start };
  return { kind: sf.active ? 'now' : 'wait', day: sf, saves };
}
