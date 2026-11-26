// When a saved figure was last changed, read from the change times that sync already keeps for every part
// (state.stamps, see calc/merge.js). Used to say "as of 20 Nov" beside an amount that is typed by hand (mesos
// held, coins held, crests), and to count an estimate from that day instead of from whenever the page is opened.
import { stampOf } from './merge.js';

// Earlier than any time the tracker can have saved (it did not exist in 2020).
const KNOWN_FROM = Date.UTC(2020, 0, 1);

// path: the part's path in state.stamps, e.g. "mesos/held" or "shops/<shopId>/have" (ids URI-encoded).
// Returns null when the time is not known: never changed, or stamped more than a day ahead by a wrong clock (the
// same rule the sync merge uses). A time slightly ahead (another device's clock runs a little fast) counts as now.
export function changedAt(state, path, now = Date.now()) {
  const t = stampOf(state && state.stamps, path, now);
  // A copy saved before change times existed, with no time of its own, is stamped 1 (seedStamps): not a real time.
  return t >= KNOWN_FROM ? Math.min(t, now) : null;
}
