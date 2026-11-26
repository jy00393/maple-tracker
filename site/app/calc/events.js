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
  const fold = (keep, drop) => {
    const ids = new Set([String(keep.postId)]);
    keep.alsoIn = [...(keep.alsoIn || []), { postId: drop.postId, postName: drop.postName, url: drop.url }, ...(drop.alsoIn || [])].filter((p) => !ids.has(String(p.postId)) && ids.add(String(p.postId)));
    keep.resets = [...new Set([...(keep.resets || []), ...(drop.resets || [])])];
    return keep;
  };
  const titleOf = (e) => eventKey({ ...e, start: '', end: '' });
  let list = [...byKey.values()];
  // One post can give a start ("(End of Maintenance)") where another gives none: same title and end, so the same
  // event; the copy with the start is kept.
  const withStart = new Map(list.filter((e) => e.start).map((e) => [`${titleOf(e)}|${e.end}`, e]));
  list = list.filter((e) => {
    if (e.start) return true;
    const twin = withStart.get(`${titleOf(e)}|${e.end}`);
    if (!twin) return true;
    fold(twin, e);
    return false;
  });
  // A later post that corrects an end date gives the same event (title and start) a second window: only the
  // newest post's window is kept. That is only done when every post in the group has one window for it; a post
  // with two windows for one title and start (a 2-week and a season-long pass) lists different offers, so the
  // group is left alone. Recurring events have different starts and never meet here.
  const groups = new Map();
  for (const e of list) {
    const key = e.start ? `${titleOf(e)}|${e.start}` : Symbol('no start');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const out = [];
  for (const g of groups.values()) {
    // Posts behind each window, including copies already folded into it above.
    const seen = new Set();
    let repeated = false;
    for (const e of g) for (const id of new Set([String(e.postId), ...(e.alsoIn || []).map((p) => String(p.postId))])) { if (seen.has(id)) repeated = true; seen.add(id); }
    if (g.length === 1 || repeated) { out.push(...g); continue; }
    // Across kinds the dedicated post wins (as above); within a kind the newer post, which carries the correction.
    const winner = g.reduce((w, e) => (rank(e) !== rank(w) ? (better(e, w) ? e : w) : Date.parse(e.liveDate || 0) > Date.parse(w.liveDate || 0) ? e : w));
    for (const e of g) if (e !== winner) fold(winner, e);
    out.push(winner);
  }
  // A post can name the same offer in the plural ("Genesis Pass" in the patch notes, "Genesis Passes" in the
  // sale post). Same window and a title that differs only by a plural ending: one offer, from different posts.
  // eventKey itself stays as it is: hidden events are saved under it.
  const loose = (e) => {
    let t = titleOf(e).split('|')[0];
    while (t.endsWith('s')) t = t.slice(0, t.endsWith('es') ? -2 : -1);
    return `${t}|${e.start || ''}|${e.end}`;
  };
  const byLoose = new Map();
  for (const e of out) {
    const key = loose(e);
    const prev = byLoose.get(key);
    if (!prev) byLoose.set(key, e);
    else if (String(prev.postId) === String(e.postId)) byLoose.set(Symbol('same post'), e);
    else if (better(e, prev)) byLoose.set(key, fold(e, prev));
    else fold(prev, e);
  }
  return [...byLoose.values()];
}

// Today's "Ending soon" list: live events ending within the horizon, soonest first. Cash Shop sales and events
// you dismissed stay out unless asked for; the counts say how many were left out.
export function endingSoon(live, now, opts = {}) {
  const horizon = opts.horizon ?? 7 * 86400000;
  const hidden = opts.hidden || {};
  const within = (live || []).filter((e) => Date.parse(e.end) > now && Date.parse(e.end) - now < horizon);
  const kept = within.filter((e) => !hidden[eventKey(e)]);
  const sales = kept.filter((e) => e.category === 'sale');
  const shown = (opts.showSales ? kept : kept.filter((e) => e.category !== 'sale')).sort((a, b) => Date.parse(a.end) - Date.parse(b.end));
  return { shown, salesHidden: opts.showSales ? 0 : sales.length, dismissed: within.length - kept.length };
}
