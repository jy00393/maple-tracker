// Third round, data job: the feed guard holds for cut-off, old and half-broken lists (9), the workflow never
// overwrites a hand edit pushed during a run (10), and a shop keeps one identity when its dates are corrected
// or its section moves in the post (11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findShops, mergeShops } from '../lib/shops.mjs';
import { checkNewsList, checkCacheLoss, feedBaseline, nextFeedCount } from '../lib/job.mjs';

const DAY = 86400000;
const HOUR = 3600000;

// ---- 9: the feed guard

const item = (id, liveDate = '2026-11-20T00:00:00Z') => ({ id, name: `Post ${id}`, category: 'general', liveDate });

test('9: a list under half of the last good feed is refused, and an accepted list cannot wear the guard down', () => {
  const full = Array.from({ length: 480 }, (_, i) => item(i + 1));
  assert.equal(checkNewsList(full, 480).length, 480);
  assert.equal(checkNewsList(full.slice(0, 240), 480).length, 240);
  assert.throws(() => checkNewsList(full.slice(0, 239), 480), /only 239 posts/);
  assert.throws(() => checkNewsList(full.slice(0, 38), 480), /only 38 posts/);
  assert.throws(() => checkNewsList(full.slice(0, 3), 39), /only 3 posts/, 'there is no size under which the guard switches off');
  assert.equal(checkNewsList(full.slice(0, 3), 0).length, 3, 'a first run has nothing to compare with');

  // The size to compare with: what the last good run saved, or the kept items of a file written before that.
  assert.equal(feedBaseline({ items: new Array(150).fill(0) }), 150);
  assert.equal(feedBaseline({ feedCount: 480, items: new Array(150).fill(0) }), 480);
  assert.equal(feedBaseline({ feedCount: 'many', items: [] }), 0);
  assert.equal(feedBaseline(null), 0);
  assert.equal(feedBaseline({ feedCount: 38, items: new Array(150).fill(0) }), 38, 'a saved feedCount is used as it is');

  // It follows the feed up by at most double per run, and down slowly.
  assert.equal(nextFeedCount(150, 480), 300);
  assert.equal(nextFeedCount(300, 480), 480);
  // One over-long list does not lock out the normal feed: 480, a 1,080 spike, then 480 again is accepted.
  const spiked = nextFeedCount(480, 1080);
  assert.equal(spiked, 960);
  assert.equal(checkNewsList(full, spiked).length, 480);
  assert.equal(nextFeedCount(0, 60), 60);
  assert.equal(nextFeedCount(480, 240), 432);
  // 480, then the shortest list that is accepted each time: after three such runs a 38-post list is still refused.
  let baseline = 480;
  for (let run = 0; run < 3; run++) {
    const n = Math.ceil(baseline / 2);
    assert.equal(checkNewsList(full.slice(0, n), baseline).length, n);
    baseline = nextFeedCount(baseline, n);
  }
  assert.ok(baseline > 300, `the baseline is still ${baseline}`);
  assert.throws(() => checkNewsList(full.slice(0, 38), baseline), /only 38 posts/);
  // A feed that really got a little shorter is followed all the way down.
  let b = 480;
  for (let run = 0; run < 40; run++) b = nextFeedCount(b, 300);
  assert.equal(b, 300);
});

test('9: a list with more than one broken entry in ten is refused', () => {
  const full = Array.from({ length: 480 }, (_, i) => item(i + 1));
  const halfBroken = full.map((p, i) => (i % 2 ? { id: p.id, name: p.name, category: p.category } : p));
  assert.throws(() => checkNewsList(halfBroken, 480), /240 of 480 posts without an id, a name or a date/);
  assert.throws(() => checkNewsList(halfBroken, 0), /without an id, a name or a date/, 'also on a first run');
  const fewBroken = full.map((p, i) => (i % 10 === 0 ? { id: p.id, name: p.name } : p));
  assert.equal(checkNewsList(fewBroken, 480).length, 432, 'one in ten is dropped, not fatal');
  const tooMany = full.map((p, i) => (i % 10 === 0 || i === 1 ? { id: p.id, name: p.name } : p));
  assert.throws(() => checkNewsList(tooMany, 480), /49 of 480/);
});

test('9: a list that is missing many saved posts still inside their window is refused', () => {
  const now = Date.parse('2026-11-26T00:00:00Z');
  const saved = (days, category = 'events', name = 'An event') => ({ name, category, liveDate: new Date(now - days * DAY).toISOString(), events: [] });
  const posts = {};
  for (let i = 0; i < 12; i++) posts[100 + i] = saved(i + 1);
  // Posts that are leaving anyway do not count: too old, old maintenance, a category that is not read.
  posts[200] = saved(151);
  posts[201] = saved(30, 'maintenance', 'Scheduled Maintenance - October 27, 2026');
  posts[202] = saved(3, 'community');
  const listOf = (ids) => ids.map((id) => item(id));
  const all = Object.keys(posts).filter((id) => Number(id) < 200).map(Number);
  assert.doesNotThrow(() => checkCacheLoss(posts, listOf(all), now), 'the three that left their window are not missed');
  assert.doesNotThrow(() => checkCacheLoss(posts, listOf(all.map(String)), now), 'ids may come as text');
  assert.doesNotThrow(() => checkCacheLoss(posts, listOf(all.slice(3)), now), 'three posts Nexon took down');
  assert.doesNotThrow(() => checkCacheLoss(posts, listOf(all.slice(4)), now), 'four of twelve');
  assert.throws(() => checkCacheLoss(posts, listOf(all.slice(5)), now), /missing 5 of the 12 saved posts/);
  assert.throws(() => checkCacheLoss(posts, listOf([900, 901, 902]), now), /missing 12 of the 12/);
  assert.doesNotThrow(() => checkCacheLoss({}, listOf([1]), now));
  assert.doesNotThrow(() => checkCacheLoss(undefined, listOf([1]), now));
  // A large cache that loses a few: under a quarter is not a broken list.
  const big = {};
  for (let i = 0; i < 60; i++) big[i + 1] = saved(1 + i / 2);
  assert.doesNotThrow(() => checkCacheLoss(big, listOf(Object.keys(big).map(Number).slice(15)), now));
  assert.throws(() => checkCacheLoss(big, listOf(Object.keys(big).map(Number).slice(16)), now), /missing 16 of the 60/);
});

// The whole job against a scratch folder with a stand-in for Nexon (no network).
const JOB = fileURLToPath(new URL('../update-data.mjs', import.meta.url));
const PRELOAD = new URL('./lib/fake-nexon.mjs', import.meta.url).href;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (ms) => { const d = new Date(ms); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
const TRACKED = ['news.json', 'posts.json', 'events.json', 'calendar.ics', 'shops.json'];

function scratchJob() {
  const dir = mkdtempSync(join(tmpdir(), 'maple-job3-'));
  const data = join(dir, 'data');
  mkdirSync(data);
  writeFileSync(join(dir, 'characters.json'), '[]');
  const read = (name) => readFileSync(join(data, name), 'utf8');
  const run = (feed) => {
    writeFileSync(join(dir, 'feed.json'), JSON.stringify(feed));
    rmSync(join(dir, 'asked.log'), { force: true });
    const out = spawnSync(process.execPath, ['--import', PRELOAD, JOB], {
      encoding: 'utf8',
      env: { ...process.env, MAPLE_DATA_DIR: data, MAPLE_CONFIG_FILE: join(dir, 'characters.json'), MAPLE_TEST_FEED: join(dir, 'feed.json'), MAPLE_TEST_LOG: join(dir, 'asked.log') }
    });
    assert.equal(out.status, 0, out.stderr);
    const asked = existsSync(join(dir, 'asked.log')) ? readFileSync(join(dir, 'asked.log'), 'utf8').trim().split('\n').map(Number) : [];
    return { meta: JSON.parse(read('meta.json')), asked };
  };
  return { dir, data, read, run, files: () => TRACKED.map(read), done: () => rmSync(dir, { recursive: true, force: true }) };
}

// 480 posts, newest first, one an hour; every 40th is an event post with a running event (12 in all).
function bigFeed(now) {
  const list = [];
  const posts = {};
  for (let i = 0; i < 480; i++) {
    const id = 5000 - i;
    const isEvent = i % 40 === 0;
    list.push({ id, name: `Post ${id}`, category: isEvent ? 'events' : 'community', liveDate: new Date(now - (i + 1) * HOUR).toISOString() });
    if (isEvent) posts[id] = { json: { body: `<h3>Event ${id}</h3><p>${longDate(now - DAY)} 12:00 AM UTC - ${longDate(now + 30 * DAY)} 11:59 PM UTC</p>` } };
  }
  return { list, posts };
}

test('9: the whole job keeps every file for a cut-off list, the oldest page, a half-broken list and a list without the saved posts', () => {
  const job = scratchJob();
  try {
    const feed = bigFeed(Date.now());
    const first = job.run(feed);
    assert.equal(first.meta.ok, true);
    assert.equal(first.meta.events, 12);
    const news = JSON.parse(job.read('news.json'));
    assert.equal(news.items.length, 150);
    assert.equal(news.feedCount, 480, 'the size of the whole feed is saved, not only of the items kept');
    const before = job.files();
    const eventIds = new Set(Object.keys(feed.posts).map(Number));
    const cases = {
      'the 38 newest': feed.list.slice(0, 38),
      'the 3 newest': feed.list.slice(0, 3),
      'the oldest 100': feed.list.slice(-100),
      'every second post without a date': feed.list.map((p, i) => (i % 2 ? { id: p.id, name: p.name, category: p.category } : p)),
      'a long list without the posts read before': feed.list.filter((p) => !eventIds.has(p.id) || p.id === 5000),
      'the oldest 250': feed.list.slice(-250)
    };
    for (const [what, list] of Object.entries(cases)) {
      const bad = job.run({ ...feed, list });
      assert.equal(bad.meta.ok, false, what);
      assert.match(bad.meta.errors.join(' '), /^news: News feed (returned|is missing)/, what);
      assert.deepEqual(bad.asked, [], `${what}: no post is asked for`);
      assert.deepEqual(job.files(), before, `${what}: every file is as it was`);
    }
    // 38 and then 3: neither run gets through, so the second has the same baseline as the first.
    assert.equal(JSON.parse(job.read('news.json')).feedCount, 480);

    // A file written before feedCount existed (the live site's): the kept items are the baseline.
    writeFileSync(join(job.data, 'news.json'), JSON.stringify({ items: news.items }, null, 1) + '\n');
    const legacy = job.files();
    const short = job.run({ ...feed, list: feed.list.slice(0, 38) });
    assert.equal(short.meta.ok, false);
    assert.deepEqual(job.files(), legacy);

    // Two posts taken down by Nexon are not a broken feed.
    const twoGone = job.run({ ...feed, list: feed.list.filter((p) => p.id !== 4960 && p.id !== 4920) });
    assert.equal(twoGone.meta.ok, true);
    assert.equal(twoGone.meta.events, 10);
    const whole = job.run(feed);
    assert.equal(whole.meta.ok, true, 'and it carries on when the list is whole again');
    assert.equal(JSON.parse(job.read('news.json')).feedCount, 480);
  } finally { job.done(); }
});

// ---- 10: the workflow's save step, run for real against a stand-in remote on this disk

const WORKFLOW = readFileSync(new URL('../../.github/workflows/update-and-deploy.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function saveStepScript() {
  const lines = WORKFLOW.split('\n');
  const at = lines.findIndex((l) => l.includes('name: Save changed data back to the repo'));
  assert.ok(at >= 0 && /run: \|/.test(lines[at + 1]), 'the save step is a run block');
  const indent = /^ */.exec(lines[at + 2])[0].length;
  const body = [];
  for (const l of lines.slice(at + 2)) {
    if (l.trim() && /^ */.exec(l)[0].length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

const sh = (cwd, script) => spawnSync('bash', ['-ec', script], { cwd, encoding: 'utf8' });
const canRun = (() => { try { return sh(tmpdir(), 'git --version').status === 0; } catch { return false; } })();

test('10: the save step never settles a conflict in favour of one side', () => {
  const commands = saveStepScript().split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(commands, /(^|\s)-X\s*\S|--strategy-option|--strategy\b|-s\s+(ours|theirs)|--ours|--theirs|--force|(^|\s)-f(\s|$)|\+HEAD/m);
  assert.match(commands, /git rebase --abort/);
});

test('10: a hand edit to shops.json pushed during a run is never removed by the run', { skip: canRun ? false : 'needs bash and git' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'maple-race3-'));
  const ok = (cwd, script) => { const r = sh(cwd, script); assert.equal(r.status, 0, `${script}\n${r.stdout}\n${r.stderr}`); return r.stdout; };
  const identity = 'git config user.name Test && git config user.email test@example.test && git config commit.gpgsign false && git config core.autocrlf false';
  const json = (v) => JSON.stringify(v, null, 1) + '\n';
  const shop = (over = {}) => ({ id: 'a-shop', name: 'A Shop', currency: 'A Coin', start: '2026-11-11T00:00:00.000Z', end: '2027-02-09T23:59:00.000Z', ...over, items: [{ id: 'chair', name: 'Chair', cost: 5, limit: 1 }], postId: 1 });
  const earn = { name: 'Weekly mission', perClaim: 100, perWeek: 5, max: 60 };
  const remoteShops = () => JSON.parse(ok(join(dir, 'remote.git'), 'git show main:site/data/shops.json'));
  const log = () => ok(join(dir, 'remote.git'), 'git log --format=%s main').trim().split('\n');
  try {
    ok(dir, 'git init -q --bare -b main remote.git && git clone -q -c core.autocrlf=false remote.git dev 2>/dev/null');
    const dev = join(dir, 'dev');
    mkdirSync(join(dev, 'site', 'data'), { recursive: true });
    for (const n of ['news', 'events', 'posts', 'characters', 'items']) writeFileSync(join(dev, 'site', 'data', `${n}.json`), 'first\n');
    writeFileSync(join(dev, 'site', 'data', 'calendar.ics'), 'first\n');
    writeFileSync(join(dev, 'site', 'data', 'shops.json'), json({ shops: [shop()] }));
    ok(dev, `${identity} && git checkout -q -B main && git add -A && git commit -q -m X && git push -q origin main`);

    // Run 1 checks out main. While it works, the owner types "earn" into the shop and pushes; the run itself
    // re-read the post and moved the end date, the line right above where "earn" went in.
    ok(dir, 'git clone -q -c core.autocrlf=false remote.git run1');
    const run1 = join(dir, 'run1');
    ok(run1, identity);
    writeFileSync(join(dev, 'site', 'data', 'shops.json'), json({ shops: [shop({ earn })] }));
    ok(dev, 'git commit -q -am "Add earn by hand" && git push -q origin main');
    writeFileSync(join(run1, 'site', 'data', 'shops.json'), json({ shops: [shop({ end: '2027-02-16T23:59:00.000Z' })] }));
    writeFileSync(join(run1, 'site', 'data', 'news.json'), 'from the run\n');
    const step = sh(run1, saveStepScript());
    assert.equal(step.status, 0, `the step does not fail the run\n${step.stdout}\n${step.stderr}`);
    assert.match(step.stdout, /::warning::/, 'and it says the data was not saved');
    assert.deepEqual(log(), ['Add earn by hand', 'X'], 'nothing was pushed over the hand edit');
    assert.deepEqual(remoteShops().shops[0].earn, earn);
    // The run's own files are whole (they are what gets deployed), with no half-finished rebase left behind.
    assert.equal(JSON.parse(readFileSync(join(run1, 'site', 'data', 'shops.json'), 'utf8')).shops[0].end, '2027-02-16T23:59:00.000Z');
    assert.equal(ok(run1, 'git status --porcelain').trim(), '');
    assert.equal(existsSync(join(run1, '.git', 'rebase-merge')) || existsSync(join(run1, '.git', 'rebase-apply')), false);

    // The next run starts from the new main: the job's merge keeps "earn" and the fresh date is saved.
    ok(dir, 'git clone -q -c core.autocrlf=false remote.git run2');
    const run2 = join(dir, 'run2');
    ok(run2, identity);
    const file = JSON.parse(readFileSync(join(run2, 'site', 'data', 'shops.json'), 'utf8'));
    const merged = mergeShops(file, [shop({ end: '2027-02-16T23:59:00.000Z' })], Date.parse('2026-11-26T00:00:00Z'));
    writeFileSync(join(run2, 'site', 'data', 'shops.json'), json(merged));
    const saved = sh(run2, saveStepScript());
    assert.equal(saved.status, 0, `${saved.stdout}\n${saved.stderr}`);
    assert.deepEqual(log(), ['Update Nexon data', 'Add earn by hand', 'X']);
    assert.deepEqual(remoteShops().shops[0].earn, earn);
    assert.equal(remoteShops().shops[0].end, '2027-02-16T23:59:00.000Z');

    // A hand edit that does not touch the lines the run changed is put together with the run's data at once.
    ok(dir, 'git clone -q -c core.autocrlf=false remote.git run3');
    const run3 = join(dir, 'run3');
    ok(run3, identity);
    ok(dev, 'git pull -q origin main');
    const withNote = JSON.parse(readFileSync(join(dev, 'site', 'data', 'shops.json'), 'utf8'));
    withNote.shops[0].items[0].note = 'Mine.';
    writeFileSync(join(dev, 'site', 'data', 'shops.json'), json(withNote));
    ok(dev, 'git commit -q -am "Add a note by hand" && git push -q origin main');
    const moved = JSON.parse(readFileSync(join(run3, 'site', 'data', 'shops.json'), 'utf8'));
    moved.shops[0].start = '2026-11-12T00:00:00.000Z';
    writeFileSync(join(run3, 'site', 'data', 'shops.json'), json(moved));
    const both = sh(run3, saveStepScript());
    assert.equal(both.status, 0, `${both.stdout}\n${both.stderr}`);
    assert.match(both.stdout, /Saved after catching up with main/);
    const end = remoteShops().shops[0];
    assert.equal(end.items[0].note, 'Mine.');
    assert.equal(end.start, '2026-11-12T00:00:00.000Z');
    assert.deepEqual(end.earn, earn);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- 11: one shop, one identity

const post = (id, liveDate, category = 'update') => ({ id, name: `Post ${id}`, category, liveDate });
const row = (name, price, limit) => `<tr><td><strong>${name}:</strong> Untradable.</td><td>${price}</td>${limit === undefined ? '' : `<td>${limit}</td>`}</tr>`;
const shopHtml = (title, range, coin, rows) =>
  `<h2>${title}</h2><p>${range}</p><table><tbody><tr><th>Item</th><th>Price (${coin})</th><th>Qty. Limit</th></tr>${rows.join('')}</tbody></table>`;
const EARN = { name: 'Weekly mission', perClaim: 100, perWeek: 5, max: 60 };

test('11: a shop whose dates are corrected in the post it came from stays one shop', () => {
  const rows = [row('Sol Erda', 5, 20), row('Chair', 50, 1)];
  const p = post(50000, '2027-01-28T00:00:00Z');
  const now = Date.parse('2027-02-01T00:00:00Z');
  const wrong = findShops(shopHtml('Challenger World Shop', 'February 10, 2027 12:00 AM UTC - February 16, 2027 11:59 PM UTC', 'Challenger Coin', rows), p);
  const first = mergeShops({ shops: [] }, wrong, now);
  assert.equal(first.shops.length, 1);
  const id = first.shops[0].id;
  const typed = { ...first, shops: [{ ...first.shops[0], earn: EARN, items: first.shops[0].items.map((it) => ({ ...it, note: 'Mine.' })) }] };
  // Nexon corrects the window to one that does not touch the old one.
  const right = findShops(shopHtml('Challenger World Shop', 'February 17, 2027 12:00 AM UTC - May 11, 2027 11:59 PM UTC', 'Challenger Coin', rows), p);
  const second = mergeShops(typed, right, now + 6 * HOUR);
  assert.equal(second.shops.length, 1, 'no dead copy is left beside it');
  assert.equal(second.shops[0].id, id, 'saved coins and picks are keyed by the id');
  assert.equal(second.shops[0].start, '2027-02-17T00:00:00.000Z');
  assert.equal(second.shops[0].end, '2027-05-11T23:59:00.000Z');
  assert.deepEqual(second.shops[0].earn, EARN);
  assert.deepEqual(second.shops[0].items.map((it) => it.note), ['Mine.', 'Mine.']);
  assert.deepEqual(mergeShops(second, right, now + 12 * HOUR), second, 'running it again changes nothing');

  // The live file's shop has a plain id; the same correction keeps it.
  const live = { shops: [{ ...wrong[0], id: 'challenger-world-shop', earn: EARN }] };
  const kept = mergeShops(live, right, now).shops;
  assert.deepEqual(kept.map((s) => s.id), ['challenger-world-shop']);
  assert.deepEqual(kept[0].earn, EARN);

  // Corrected dates and a renamed coin at once, in the same post: still the same shop.
  const recoined = findShops(shopHtml('Challenger World Shop', 'February 16, 2027 12:00 AM UTC - May 11, 2027 11:59 PM UTC', 'Challenger Token', rows), p);
  assert.deepEqual(mergeShops(live, recoined, now).shops.map((s) => s.id), ['challenger-world-shop']);

  // Another post with the same name and a window that does not touch: next season's shop, a new one.
  const next = findShops(shopHtml('Challenger World Shop', 'May 12, 2027 12:00 AM UTC - August 10, 2027 11:59 PM UTC', 'Challenger Coin', rows), post(50001, '2027-02-01T00:00:00Z'));
  const two = mergeShops(live, next, now).shops;
  assert.equal(two.length, 2);
  assert.equal(two.find((s) => s.postId === 50001).earn, undefined);
});

function swapCase(rangeA, rangeB, coinA = 'A Coin', coinB = 'B Coin') {
  const a = `<h1>Event A</h1>${shopHtml('Coin Shop', rangeA, coinA, [row('Chair A', 10, 1), row('Hat A', 20, 1)])}`;
  const b = `<h1>Event B</h1>${shopHtml('Coin Shop', rangeB, coinB, [row('Chair B', 20, 1), row('Hat B', 30, 1)])}`;
  const p = post(60000, '2026-11-10T00:00:00Z');
  const now = Date.parse('2026-11-24T00:00:00Z');
  const first = mergeShops({ shops: [] }, findShops(a + b, p), now);
  assert.equal(first.shops.length, 2);
  const has = (s, name) => s.items.some((it) => it.name === name);
  const typed = { ...first, shops: first.shops.map((s) => ({ ...s, earn: { ...EARN, name: has(s, 'Chair A') ? 'Event A mission' : 'Event B mission' } })) };
  const idA = typed.shops.find((s) => has(s, 'Chair A')).id;
  const idB = typed.shops.find((s) => has(s, 'Chair B')).id;
  assert.notEqual(idA, idB);
  // Nexon swaps the two sections: the parser now names them the other way round.
  const swapped = mergeShops(typed, findShops(b + a, p), now + 6 * HOUR);
  assert.equal(swapped.shops.length, 2, 'two shops, not four');
  const shopA = swapped.shops.find((s) => has(s, 'Chair A'));
  const shopB = swapped.shops.find((s) => has(s, 'Chair B'));
  assert.equal(shopA.id, idA);
  assert.equal(shopB.id, idB);
  assert.equal(shopA.earn.name, 'Event A mission');
  assert.equal(shopB.earn.name, 'Event B mission');
  assert.equal(shopA.currency, coinA);
  assert.equal(shopB.currency, coinB);
  assert.deepEqual(shopA.items.map((it) => it.name), ['Chair A', 'Hat A']);
  assert.deepEqual(mergeShops(swapped, findShops(b + a, p), now + 12 * HOUR), swapped, 'running it again changes nothing');
  // And back again.
  const back = mergeShops(swapped, findShops(a + b, p), now + 18 * HOUR);
  assert.deepEqual(back.shops.map((s) => [s.id, s.earn.name]).sort(), [[idA, 'Event A mission'], [idB, 'Event B mission']].sort());
}

test('11: two shops with the same heading keep their ids and hand fields when their sections swap', () => {
  const nov = 'November 11, 2026 12:00 AM UTC - December 8, 2026 11:59 PM UTC';
  const dec = 'December 9, 2026 12:00 AM UTC - January 5, 2027 11:59 PM UTC';
  swapCase(nov, dec);
  // The same with both events on the same dates, and with both using one coin.
  swapCase(nov, nov);
  swapCase(nov, dec, 'Event Coin', 'Event Coin');
  swapCase(nov, nov, 'Event Coin', 'Event Coin');
});

test('11: a shop found under the same name in a newer post, with dates that touch, is still matched by name', () => {
  const rows = [row('Sol Erda', 5, 20)];
  const now = Date.parse('2026-11-24T00:00:00Z');
  const s4 = 'November 11, 2026 12:00 AM UTC - February 9, 2027 11:59 PM UTC';
  const notes = findShops(shopHtml('Challenger World Shop', s4, 'Challenger Coin', rows), post(1, '2026-11-10T00:00:00Z'));
  const file = { shops: [{ ...notes[0], id: 'challenger-world-shop', earn: EARN }] };
  const eventPost = findShops(shopHtml('Challenger World Shop', s4, 'Challenger Coin', [...rows, row('Chair', 50, 1)]), post(2, '2026-11-20T00:00:00Z', 'events'));
  const out = mergeShops(file, [...notes, ...eventPost], now).shops;
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'challenger-world-shop');
  assert.equal(out[0].postId, 2, 'the newer post wins');
  assert.deepEqual(out[0].earn, EARN);
  // A hand-typed shop with no post is matched by name too, and one the job did not find stays.
  const hand = { shops: [{ id: 'my-shop', name: 'Challenger World Shop', currency: 'Challenger Coin', start: '2026-11-11T00:00:00.000Z', end: '2027-02-09T23:59:00.000Z', items: [], scope: 'Mine.' }, { id: 'other', name: 'Other Shop', currency: 'X', start: null, end: '2027-01-01T00:00:00.000Z', items: [] }] };
  const kept = mergeShops(hand, notes, now).shops;
  assert.deepEqual(kept.map((s) => s.id).sort(), ['my-shop', 'other']);
  assert.equal(kept.find((s) => s.id === 'my-shop').scope, 'Mine.');
});

// ---- final check: the hand switch for a feed that really changed, and a swap with a date fix in one edit

test('final: "acceptFeed": true in news.json takes a much shorter list once, and is not written back', () => {
  const job = scratchJob();
  try {
    const feed = bigFeed(Date.now());
    assert.equal(job.run(feed).meta.ok, true);
    const short = { ...feed, list: feed.list.slice(0, 60) };
    const refused = job.run(short);
    assert.equal(refused.meta.ok, false);
    assert.match(refused.meta.errors.join(' '), /"acceptFeed": true/, 'the message names the hand switch');
    const news = JSON.parse(job.read('news.json'));
    writeFileSync(join(job.data, 'news.json'), JSON.stringify({ ...news, acceptFeed: true }, null, 1) + '\n');
    const taken = job.run(short);
    assert.equal(taken.meta.ok, true, taken.meta.errors.join(' '));
    const after = JSON.parse(job.read('news.json'));
    assert.equal(after.feedCount, 60);
    assert.equal('acceptFeed' in after, false, 'it applies once');
    assert.equal(job.run({ ...feed, list: feed.list.slice(0, 20) }).meta.ok, false, 'the guard is back on the next run');
  } finally { job.done(); }
});

test('final: two same-heading shops stay two shops when the sections swap and a date is corrected in one edit', () => {
  const nov = 'November 11, 2026 12:00 AM UTC - December 8, 2026 11:59 PM UTC';
  const fixed = 'November 11, 2026 12:00 AM UTC - December 15, 2026 11:59 PM UTC';
  const part = (ev, range, coin, x) => `<h1>Event ${ev}</h1>${shopHtml('Coin Shop', range, coin, [row(`Chair ${x}`, 10, 1), row(`Hat ${x}`, 20, 1)])}`;
  const p = post(60001, '2026-11-10T00:00:00Z');
  const now = Date.parse('2026-11-24T00:00:00Z');
  const has = (s, name) => s.items.some((it) => it.name === name);
  for (const both of [false, true]) {
    const first = mergeShops({ shops: [] }, findShops(part('A', nov, 'A Coin', 'A') + part('B', nov, 'B Coin', 'B'), p), now);
    const typed = { ...first, shops: first.shops.map((s) => ({ ...s, earn: { ...EARN, name: has(s, 'Chair A') ? 'A mission' : 'B mission' } })) };
    const idA = typed.shops.find((s) => has(s, 'Chair A')).id;
    const idB = typed.shops.find((s) => has(s, 'Chair B')).id;
    const next = mergeShops(typed, findShops(part('B', both ? fixed : nov, 'B Coin', 'B') + part('A', fixed, 'A Coin', 'A'), p), now + 6 * HOUR);
    assert.equal(next.shops.length, 2, 'two shops, not three or four');
    const a = next.shops.find((s) => has(s, 'Chair A'));
    const b = next.shops.find((s) => has(s, 'Chair B'));
    assert.deepEqual([a.id, a.earn.name, b.id, b.earn.name], [idA, 'A mission', idB, 'B mission']);
    assert.equal(a.end, '2026-12-15T23:59:00.000Z');
  }
});
