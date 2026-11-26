// Preload for tests that run the whole data job (node --import this-file scripts/update-data.mjs): no network.
// MAPLE_TEST_FEED is a JSON file { list, posts: { <id>: { status?, json? } } }; anything else answers 503.
// MAPLE_TEST_LOG gets one line per post asked for. Short waits (the job's spacing between requests) are skipped.
import { readFileSync, appendFileSync } from 'node:fs';

const answer = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });

globalThis.fetch = async (url) => {
  const feed = JSON.parse(readFileSync(process.env.MAPLE_TEST_FEED, 'utf8'));
  const m = /\/cms\/v1\/news(?:\/([^/?]+))?$/.exec(String(url));
  if (!m) return answer(503, {});
  if (!m[1]) return answer(200, feed.list);
  if (process.env.MAPLE_TEST_LOG) appendFileSync(process.env.MAPLE_TEST_LOG, `${m[1]}\n`);
  const post = (feed.posts || {})[m[1]];
  return post ? answer(post.status || 200, post.json) : answer(404, {});
};

const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => realTimeout(fn, ms <= 1000 ? 0 : ms, ...rest);
