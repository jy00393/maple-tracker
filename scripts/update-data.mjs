#!/usr/bin/env node
// Pulls MapleStory (GMS) news and event windows from Nexon's public news feed and writes
// JSON files the site reads. Runs on a schedule in GitHub Actions; safe to run by hand:
//   node scripts/update-data.mjs
// On any network error it keeps the previous files and records the error in meta.json.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parsePost, postUrl } from './lib/nexon-parse.mjs';
import { buildCalendar } from './lib/ics.mjs';

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
const DETAIL_CATEGORIES = new Set(['events', 'update', 'sale', 'general', 'maintenance']);
const MAX_DETAIL_FETCHES = 30;
const NEWS_KEEP = 150;

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

function wantsDetail(post, now) {
  if (!DETAIL_CATEGORIES.has(post.category)) return false;
  if (post.isMSCW) return false; // Classic World posts are listed but not parsed
  const age = now - Date.parse(post.liveDate);
  if (post.category === 'maintenance') return age < 21 * DAY && /^\[(scheduled|completed|updated|unscheduled)/i.test(post.name);
  return age < 150 * DAY;
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
  let fetched = 0;
  for (const post of candidates) {
    const cached = posts[post.id];
    const recent = now - Date.parse(post.liveDate) < 10 * DAY;
    const stale = !cached || cached.name !== post.name || (recent && now - Date.parse(cached.fetchedAt || 0) > 5 * 3600000);
    if (!stale) continue;
    if (fetched >= MAX_DETAIL_FETCHES) break;
    try {
      if (fetched > 0) await sleep(500);
      const detail = await getJson(POST_URL(post.id));
      fetched++;
      posts[post.id] = {
        name: post.name,
        category: post.category,
        liveDate: post.liveDate,
        fetchedAt: new Date(now).toISOString(),
        events: parsePost(post, detail.body || '')
      };
    } catch (err) {
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

  const changed = [];
  if (await writeJsonIfChanged('news.json', { items: news })) changed.push('news');
  if (await writeJsonIfChanged('posts.json', { posts })) changed.push('posts');
  if (await writeJsonIfChanged('events.json', { events })) changed.push('events');
  if (await writeTextIfChanged('calendar.ics', buildCalendar(events, now))) changed.push('calendar');
  return { changed, fetched, posts: list.length, events: events.length };
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
      const hit = (data.ranks || []).find((r) => String(r.characterName).toLowerCase() === name.toLowerCase());
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
      if (changedPoint && Number.isFinite(Number(hit.level))) history.push({ t: Date.now(), level: Number(hit.level), exp: Number(hit.exp) || 0 });
      out.push({
        name: hit.characterName,
        region,
        level: hit.level,
        exp: hit.exp,
        jobName: hit.jobName,
        worldID: hit.worldID,
        imageUrl: hit.characterImgURL || null,
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
  await writeFile(new URL('meta.json', DATA_DIR), JSON.stringify(meta, null, 1) + '\n');
  console.log(JSON.stringify(meta, null, 1));
}

main();
