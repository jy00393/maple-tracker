// The careful parts of the data job, kept apart from the network and the disk so tests can run them:
// is the news list believable, is a post's answer usable, and which posts are read in which order.
import { parsePost, findSunnySchedule, wantsDetail } from './nexon-parse.mjs';
import { findShops } from './shops.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;

// The news list as Nexon sent it -> the posts that can be used. Throws when the answer cannot be trusted, so the
// job keeps the files it has: the feed is undocumented, and an error page or a cut-off list can still be a
// non-empty JSON array. `baseline` is the size of the last good feed (feedBaseline below), 0 on a first run.
// - More than one entry in ten without an id, a name or a date: the list is broken, not just untidy.
// - Fewer than half as many posts as the last good feed: the list is cut off.
export function checkNewsList(list, baseline = 0) {
  if (!Array.isArray(list) || list.length === 0) throw new Error('News feed returned no posts');
  const good = list.filter((p) => p && typeof p === 'object'
    && ((typeof p.id === 'number' && Number.isFinite(p.id)) || (typeof p.id === 'string' && p.id !== ''))
    && typeof p.name === 'string' && p.name.trim() !== ''
    && Number.isFinite(Date.parse(p.liveDate)));
  if (good.length === 0 || (list.length - good.length) * 10 > list.length) {
    throw new Error(`News feed returned ${list.length - good.length} of ${list.length} posts without an id, a name or a date; kept the previous files`);
  }
  if (baseline > 0 && good.length * 2 < baseline) {
    throw new Error(`News feed returned only ${good.length} posts (the last good feed had about ${baseline}); kept the previous files. If Nexon's feed really is like this now, add "acceptFeed": true to site/data/news.json by hand; the next run then takes the list as it is, once.`);
  }
  return good;
}

// The size the next list is compared with, from the saved news.json. `feedCount` is written by every good run;
// a file from before that only has the (at most 150) items it kept.
export function feedBaseline(lastNews) {
  const n = lastNews && Number.isFinite(lastNews.feedCount) && lastNews.feedCount > 0 ? Math.floor(lastNews.feedCount) : 0;
  const kept = lastNews && Array.isArray(lastNews.items) ? lastNews.items.length : 0;
  return n > 0 ? n : kept;
}

// The `feedCount` a good run saves. It comes down by at most a tenth per run, so one accepted shorter list
// cannot open the door to a much shorter one on the next run. It goes up to at most twice the last figure, so one
// over-long list (repeated entries, a doubled page) cannot set a size the normal feed then fails against.
export function nextFeedCount(baseline, count) {
  const up = baseline > 0 ? Math.min(count, baseline * 2) : count;
  return Math.max(up, Math.floor(baseline * 0.9));
}

// A list that passed the size check can still be the wrong list (an old page, or one missing the posts that
// matter). Saved posts only leave by growing too old to be read; when many that are still inside their window
// are missing from the list, the list is refused and every file stays as it was.
export function checkCacheLoss(posts, list, now) {
  const listed = new Set(list.map((p) => String(p.id)));
  const inWindow = Object.entries(posts || {}).filter(([id, p]) => p && wantsDetail({ id, name: p.name, category: p.category, liveDate: p.liveDate }, now));
  const missing = inWindow.filter(([id]) => !listed.has(String(id)));
  if (missing.length >= 5 && missing.length * 4 > inWindow.length) {
    throw new Error(`News feed is missing ${missing.length} of the ${inWindow.length} saved posts that are still current; kept the previous files. If Nexon's feed really is like this now, add "acceptFeed": true to site/data/news.json by hand; the next run then takes the list as it is, once.`);
  }
}

// How many runs in a row a post must come back with nothing in it before that is believed.
export const EMPTY_RUNS_TO_ACCEPT = 3;

const contentCount = (p) => (p && Array.isArray(p.events) ? p.events.length : 0) + (p && Array.isArray(p.sunny) ? p.sunny.length : 0) + (p && Array.isArray(p.shops) ? p.shops.length : 0);

// One post's answer -> its cache entry. Throws when the answer has no usable body, or when it parses to nothing
// although the saved copy has events or shops (a placeholder page): the saved copy is then kept. A post that
// really was emptied is believed on the third run in a row.
export function readDetail(post, detail, cached, pv, now) {
  if (!detail || typeof detail.body !== 'string' || !detail.body.trim()) throw new Error('the answer has no body');
  const entry = {
    name: post.name,
    category: post.category,
    liveDate: post.liveDate,
    fetchedAt: new Date(now).toISOString(),
    pv,
    events: parsePost(post, detail.body),
    sunny: post.category === 'maintenance' ? [] : findSunnySchedule(detail.body),
    // Event coin shops (item, price, limit) from patch notes and event posts.
    shops: post.category === 'update' || post.category === 'events' ? findShops(detail.body, post) : []
  };
  if (contentCount(cached) > 0 && contentCount(entry) === 0) {
    const emptyRuns = (Number(cached.emptyRuns) || 0) + 1;
    if (emptyRuns < EMPTY_RUNS_TO_ACCEPT) {
      const err = new Error('the body has no events or shops but the saved copy does; kept the saved copy');
      err.emptyRuns = emptyRuns;
      throw err;
    }
  }
  return entry;
}

// A cached post needs reading again: never read, read by an older parser, renamed, or recent (Nexon edits new posts).
export function isStale(post, cached, pv, now) {
  const recent = now - Date.parse(post.liveDate) < 10 * DAY;
  return !cached || cached.pv !== pv || cached.name !== post.name || (recent && now - Date.parse(cached.fetchedAt || 0) > 5 * HOUR);
}

// A post that failed is tried again on the next run, then less and less often (up to every 42 hours).
function waitingAfterFailure(cached, now) {
  if (!cached || !cached.failedAt) return false;
  const fails = Math.min(Math.max(Number(cached.fails) || 1, 1), 8);
  return now - Date.parse(cached.failedAt) < (fails - 1) * 6 * HOUR - HOUR / 2;
}

// Reads the stale posts into `posts` (the cache, changed in place). Every request counts toward the cap, failed
// ones included, and three failures in a row stop the run, so a blocked run backs off. A failure is remembered
// on the post (failedAt, fails) with whatever was saved before: next time the posts that have not failed go
// first, so a few posts that can never be read do not stop the ones behind them.
export async function refreshPosts({ candidates, posts, pv, now, max, fetchDetail, wait, errors }) {
  const stale = candidates.filter((post) => isStale(post, posts[post.id], pv, now) && !waitingAfterFailure(posts[post.id], now));
  const failedAt = (post) => { const t = Date.parse((posts[post.id] || {}).failedAt); return Number.isFinite(t) ? t : -Infinity; };
  const order = stale.map((post, i) => ({ post, i, t: failedAt(post) })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.post);
  let fetched = 0;
  let attempts = 0;
  let failedInRow = 0;
  for (const post of order) {
    if (attempts >= max || failedInRow >= 3) break;
    const cached = posts[post.id];
    try {
      if (attempts > 0) await wait(500);
      attempts++;
      posts[post.id] = readDetail(post, await fetchDetail(post), cached, pv, now);
      fetched++;
      failedInRow = 0;
    } catch (err) {
      failedInRow++;
      errors.push(`post ${post.id}: ${err.message}`);
      const base = cached || { name: post.name, category: post.category, liveDate: post.liveDate, events: [], sunny: [], shops: [] };
      posts[post.id] = { ...base, failedAt: new Date(now).toISOString(), fails: (Number(base.fails) || 0) + 1 };
      if (err.emptyRuns) posts[post.id].emptyRuns = err.emptyRuns;
    }
  }
  return { fetched, attempts };
}
