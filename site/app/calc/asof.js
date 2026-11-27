// When a saved figure was last changed, read from the change times that sync already keeps for every part
// (state.stamps, see calc/merge.js). Used to say "as of 20 Nov" beside an amount that is typed by hand (mesos
// held, coins held, crests), and to count an estimate from that day instead of from whenever the page is opened.
import { stampOf, units, liveAsOf } from './merge.js';

// Earlier than any time the tracker can have saved (it did not exist in 2020).
const KNOWN_FROM = Date.UTC(2020, 0, 1);

// The parts an "as of" date is shown for (the paths the pages pass to changedAt). Only these keep their own
// time through an import or a restore (state.asOf), so that map stays small.
export function datedPath(path) {
  return path === 'mesos/held' || /^shops\/[^/]+\/(have|claims)$/.test(path) || /^(erda|ibp)\/[^/]+\/@$/.test(path) || /^season\/[^/]+$/.test(path);
}

// path: the part's path in state.stamps, e.g. "mesos/held" or "shops/<shopId>/have" (ids URI-encoded).
// Returns null when the time is not known: never changed, or stamped more than a day ahead by a wrong clock (the
// same rule the sync merge uses). A time slightly ahead (another device's clock runs a little fast) counts as now.
// A part that nothing but an import or a restore has changed since keeps the time it had in that copy (state.asOf,
// see liveAsOf in calc/merge.js): the import moved its stamp, not the figure.
export function changedAt(state, path, now = Date.now()) {
  let t = stampOf(state && state.stamps, path, now);
  const asOf = state && state.asOf && typeof state.asOf === 'object' ? state.asOf : null;
  const kept = asOf && Object.hasOwn(asOf, path) ? asOf[path] : null;
  if (kept && kept.s === t && kept.t > 0) t = kept.t;
  // A copy saved before change times existed, with no time of its own, is stamped 1 (seedStamps): not a real time.
  return t >= KNOWN_FROM ? Math.min(t, now) : null;
}

// For an import or a restore (store.js replaceState): `copy` is the copy being taken, with its own stamps and
// asOf; `stamps` are the new stamps it is given. Returns the asOf map that keeps each dated part's own time.
export function carryAsOf(copy, stamps, now = Date.now()) {
  const out = {};
  for (const path of units(copy).keys()) {
    if (!datedPath(path)) continue;
    const own = changedAt(copy, path, now);
    const s = stampOf(stamps, path, now);
    if (own !== null && s > own) out[path] = { t: own, s };
  }
  return liveAsOf(out, stamps, now);
}
