// Dated things announced by Nexon that have not happened yet, soonest first. From data/upcoming.json.
const DAY = 86400000;

// char: the active character (or null). Items marked only: 'challenger' are for Challenger World characters.
export function comingUp(upcoming, now, char, limit = 6) {
  const items = (upcoming && Array.isArray(upcoming.items) ? upcoming.items : [])
    .map((it) => ({ ...it, t: Date.parse(it.at) }))
    .filter((it) => Number.isFinite(it.t) && it.t > now)
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
    out.push({ ...it, days: Math.max(0, Math.ceil((it.t - now) / DAY)) });
  }
  return out.slice(0, limit);
}
