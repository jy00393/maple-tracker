#!/usr/bin/env node
// Pulls MapleStory (GMS) news and event windows from Nexon's public news feed and writes
// JSON files the site reads. Runs on a schedule in GitHub Actions; safe to run by hand:
//   node scripts/update-data.mjs
// On any network error it keeps the previous files and records the error in meta.json.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parsePost, postUrl, findRanked, findSunnySchedule, wantsDetail } from './lib/nexon-parse.mjs';
import { buildCalendar } from './lib/ics.mjs';
import { findShops, mergeShops } from './lib/shops.mjs';
import { WZ_URL, ITEMS_URL, MIN_LEVEL, ITEMS_SCHEMA, latestGmsVersion, buildItems, serialiseItems } from './lib/items.mjs';

const LIST_URL = 'https://g.nexonstatic.com/maplestory/cms/v1/news';
const POST_URL = (id) => `https://g.nexonstatic.com/maplestory/cms/v1/news/${id}`;
const RANK_URL = (region, name) =>
  `https://www.nexon.com/api/maplestory/ranking/v1/no-auth/${region}/overall?id=weekly&reboot_index=0&page_index=1&character_name=${encodeURIComponent(name)}`;

const DATA_DIR = new URL('../site/data/', import.meta.url);
const CONFIG_FILE = new URL('../config/characters.json', import.meta.url);
const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'personal-maple-tracker/1.0 (single-user tracker; runs every 6 hours)'
};

const DAY = 86400000;
const MAX_DETAIL_FETCHES = 30;
const NEWS_KEEP = 150;
// Raise this when the parser learns something new, so cached posts are read again (a few per run).
const PARSER_VERSION = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(new URL(name, DATA_DIR), 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeTextIfChanged(name, next) {
  let prev = null;
  try {
    prev = await readFile(new URL(name, DATA_DIR), 'utf8');
  } catch {}
  if (prev === next) return false;
  await writeFile(new URL(name, DATA_DIR), next);
  return true;
}

async function writeJsonIfChanged(name, value) {
  const next = JSON.stringify(value, null, 1) + '\n';
  let prev = null;
  try {
    prev = await readFile(new URL(name, DATA_DIR), 'utf8');
  } catch {}
  if (prev === next) return false;
  await writeFile(new URL(name, DATA_DIR), next);
  return true;
}

async function updateNewsAndEvents(errors) {
  const now = Date.now();
  const list = await getJson(LIST_URL);
  if (!Array.isArray(list) || list.length === 0) throw new Error('News feed returned no posts');

  const news = list
    .slice()
    .sort((a, b) => Date.parse(b.liveDate) - Date.parse(a.liveDate))
    .slice(0, NEWS_KEEP)
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      liveDate: p.liveDate,
      summary: p.summary || '',
      featured: Boolean(p.featured),
      isClassic: Boolean(p.isMSCW),
      url: postUrl(p)
    }));

  const cache = await readJson('posts.json', { posts: {} });
  const posts = cache.posts || {};
  const candidates = list.filter((p) => wantsDetail(p, now));
  // Every request counts toward the cap and is spaced out, failed ones included, so a blocked run backs off
  // instead of firing one request per post; three failures in a row stop the loop.
  let fetched = 0;
  let attempts = 0;
  let failedInRow = 0;
  for (const post of candidates) {
    const cached = posts[post.id];
    const recent = now - Date.parse(post.liveDate) < 10 * DAY;
    const stale = !cached || cached.pv !== PARSER_VERSION || cached.name !== post.name || (recent && now - Date.parse(cached.fetchedAt || 0) > 5 * 3600000);
    if (!stale) continue;
    if (attempts >= MAX_DETAIL_FETCHES || failedInRow >= 3) break;
    try {
      if (attempts > 0) await sleep(500);
      attempts++;
      const detail = await getJson(POST_URL(post.id));
      fetched++;
      failedInRow = 0;
      posts[post.id] = {
        name: post.name,
        category: post.category,
        liveDate: post.liveDate,
        fetchedAt: new Date(now).toISOString(),
        pv: PARSER_VERSION,
        events: parsePost(post, detail.body || ''),
        sunny: post.category === 'maintenance' ? [] : findSunnySchedule(detail.body || ''),
        // Event coin shops (item, price, limit) from patch notes and event posts.
        shops: post.category === 'update' || post.category === 'events' ? findShops(detail.body || '', post) : []
      };
    } catch (err) {
      failedInRow++;
      errors.push(`post ${post.id}: ${err.message}`);
    }
  }
  // Drop posts that fell out of the window so the cache stays small.
  const keepIds = new Set(candidates.map((p) => String(p.id)));
  for (const id of Object.keys(posts)) if (!keepIds.has(String(id))) delete posts[id];

  const events = Object.values(posts)
    .flatMap((p) => p.events || [])
    .filter((e) => Date.parse(e.end) > now - 21 * DAY)
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end));

  // Sunny Sunday perks by date; when two posts list the same Sunday, the newer post wins.
  const sunnyByDate = new Map();
  for (const p of Object.values(posts).sort((a, b) => Date.parse(a.liveDate) - Date.parse(b.liveDate))) {
    for (const d of p.sunny || []) if (Date.parse(`${d.date}T23:59:59Z`) > now - DAY) sunnyByDate.set(d.date, d);
  }
  const sunny = [...sunnyByDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  // Coin shops: what the posts list, merged over the current file so hand-added notes and saved ids survive.
  const shops = mergeShops(await readJson('shops.json', { shops: [] }), Object.values(posts).flatMap((p) => p.shops || []), now);

  const changed = [];
  if (await writeJsonIfChanged('shops.json', shops)) changed.push('shops');
  if (await writeJsonIfChanged('news.json', { items: news })) changed.push('news');
  if (await writeJsonIfChanged('posts.json', { posts })) changed.push('posts');
  if (await writeJsonIfChanged('events.json', { events, sunny })) changed.push('events');
  if (await writeTextIfChanged('calendar.ics', buildCalendar(events, now))) changed.push('calendar');
  return { changed, fetched, posts: list.length, events: events.length, shops: shops.shops.length };
}

async function updateCharacters(errors) {
  let config = [];
  try {
    config = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  } catch {
    return { characters: 0 };
  }
  if (!Array.isArray(config) || config.length === 0) {
    await writeJsonIfChanged('characters.json', { characters: [] });
    return { characters: 0 };
  }
  const previous = await readJson('characters.json', { characters: [] });
  const byName = new Map((previous.characters || []).map((c) => [c.name.toLowerCase(), c]));
  const out = [];
  for (const entry of config.slice(0, 20)) {
    const name = String(entry.name || '').trim();
    const region = String(entry.region || 'na').toLowerCase() === 'eu' ? 'eu' : 'na';
    if (!name) continue;
    try {
      await sleep(400);
      const data = await getJson(RANK_URL(region, name));
      const hit = findRanked(data, name);
      if (!hit) {
        errors.push(`character ${name}: not found in Nexon rankings`);
        if (byName.has(name.toLowerCase())) out.push(byName.get(name.toLowerCase()));
        continue;
      }
      // Keep a level/EXP history (one point per change) so the tracker can work out EXP per day.
      const prev = byName.get(name.toLowerCase());
      const history = Array.isArray(prev?.history) ? prev.history.slice(-499) : [];
      const last = history[history.length - 1];
      const changedPoint = !last || last.level !== hit.level || last.exp !== hit.exp;
      if (changedPoint) history.push({ t: Date.now(), level: hit.level, exp: hit.exp });
      out.push({
        name: hit.name,
        region,
        level: hit.level,
        exp: hit.exp,
        jobName: hit.jobName,
        worldID: hit.worldID,
        imageUrl: hit.imageUrl,
        checkedAt: changedPoint || !prev ? new Date().toISOString() : prev.checkedAt,
        history
      });
    } catch (err) {
      errors.push(`character ${name}: ${err.message}`);
      if (byName.has(name.toLowerCase())) out.push(byName.get(name.toLowerCase()));
    }
  }
  await writeJsonIfChanged('characters.json', { characters: out });
  return { characters: out.length };
}

// Equipment names, levels and slots for the Gear tab's autocomplete, from maplestory.io (community API).
// One small request a day to see which GMS version it has; the full list (about 2 MB) only when that changes.
async function updateItems() {
  const prev = await readJson('items.json', null);
  const fresh = prev && prev.schema === ITEMS_SCHEMA && Array.isArray(prev.items) && prev.items.length > 0;
  if (fresh && Date.now() - Date.parse(prev.checkedAt) < DAY) return { items: prev.items.length, itemsVersion: prev.version };
  const version = latestGmsVersion(await getJson(WZ_URL));
  if (!version) throw new Error('maplestory.io lists no ready GMS version');
  let items = fresh ? prev.items : [];
  let fetchedAt = fresh ? prev.fetchedAt : null;
  if (!fresh || prev.version !== version) {
    await sleep(500);
    const built = buildItems(await getJson(ITEMS_URL(version, MIN_LEVEL)));
    if (built.length < 500) throw new Error(`maplestory.io returned only ${built.length} items for GMS v.${version}`);
    items = built;
    fetchedAt = new Date().toISOString();
  }
  await writeTextIfChanged('items.json', serialiseItems({
    source: `maplestory.io community API, GMS v.${version} game data: non-cash equipment Lv. ${MIN_LEVEL}+. Unofficial; it can lag behind the live game, so newer items may be missing.`,
    sourceUrl: 'https://maplestory.io',
    schema: ITEMS_SCHEMA,
    version,
    fetchedAt,
    checkedAt: new Date().toISOString(),
    items
  }));
  return { items: items.length, itemsVersion: version };
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const errors = [];
  const meta = { checkedAt: new Date().toISOString(), ok: true, errors };
  try {
    Object.assign(meta, await updateNewsAndEvents(errors));
  } catch (err) {
    meta.ok = false;
    errors.push(`news: ${err.message}`);
  }
  try {
    Object.assign(meta, await updateCharacters(errors));
  } catch (err) {
    errors.push(`characters: ${err.message}`);
  }
  try {
    Object.assign(meta, await updateItems());
  } catch (err) {
    // Kept apart from `errors`: the item list is a convenience and the old copy stays in place.
    meta.itemsError = err.message;
  }
  await writeFile(new URL('meta.json', DATA_DIR), JSON.stringify(meta, null, 1) + '\n');
  console.log(JSON.stringify(meta, null, 1));
}

main();
