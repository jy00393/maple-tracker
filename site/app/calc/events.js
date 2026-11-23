// Patch notes repeat the sections of the event posts, so one event can arrive from two or three posts.
// Keep one copy per title and window, preferring the dedicated post, and remember where else it appeared.
const RANK = { events: 0, sale: 1, update: 2, general: 3, community: 4, maintenance: 5 };
const rank = (e) => (e.category in RANK ? RANK[e.category] : 9);

export function eventKey(e) {
  const title = String(e.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/events?$/, '');
  return `${title}|${e.start || ''}|${e.end}`;
}

function better(a, b) {
  if (rank(a) !== rank(b)) return rank(a) < rank(b);
  return Date.parse(a.liveDate || 0) > Date.parse(b.liveDate || 0);
}

export function dedupeEvents(events) {
  const byKey = new Map();
  for (const e of events || []) {
    const key = eventKey(e);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...e, alsoIn: [] });
      continue;
    }
    const [keep, drop] = better(e, prev) ? [{ ...e, alsoIn: prev.alsoIn }, prev] : [prev, e];
    const seen = new Set([String(keep.postId)]);
    keep.alsoIn = [...keep.alsoIn, { postId: drop.postId, postName: drop.postName, url: drop.url }].filter((p) => {
      if (seen.has(String(p.postId))) return false;
      seen.add(String(p.postId));
      return true;
    });
    keep.resets = [...new Set([...(keep.resets || []), ...(drop.resets || [])])];
    byKey.set(key, keep);
  }
  return [...byKey.values()];
}
