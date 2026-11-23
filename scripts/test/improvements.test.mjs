import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeStates, changedPaths, seedStamps, units, sameEntries } from '../../site/app/calc/merge.js';
import { qrEncode, qrPath, pickVersion, codewords } from '../../site/app/calc/qr.js';
import { endingSoon, eventKey } from '../../site/app/calc/events.js';
import { resetWarnings } from '../../site/app/calc/reminders.js';
import { upgradeOptions, affordableAt, slotOutlook } from '../../site/app/calc/advice.js';
import { applySetup } from '../../site/app/calc/setup.js';
import { characterLines } from '../../site/app/calc/income.js';
import { periodKey } from '../../site/app/time.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const checklist = load('checklist');
const gear = load('gear');
const upgrades = load('upgrades');
const bosses = load('bosses');
const bossById = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const DAY = 86400000;

const blank = () => ({
  v: 1, characters: [], activeId: null, checklist: { items: {}, resets: {}, flags: {}, history: {} },
  bosses: {}, symbols: {}, liberation: {}, ibp: {}, erda: {}, gear: {}, level: {},
  mesos: { held: 0, goals: [] }, incomeHistory: {}, ui: { hideClassic: true }, stamps: {}, updatedAt: 0
});
// Mimics store.update(): apply a change and stamp the parts that changed.
const edit = (state, at, fn) => {
  const next = structuredClone(state);
  fn(next);
  for (const p of changedPaths(state, next)) next.stamps[p] = at;
  next.updatedAt = at;
  return next;
};

// ---------- sync merge ----------
test('merge keeps a tick from the phone and a gear edit from the PC', () => {
  const base = edit(blank(), 100, (s) => { s.characters.push({ id: 'c1', name: 'A' }); s.activeId = 'c1'; });
  const pc = edit(base, 200, (s) => { s.gear.c1 = { slots: { hat: { tier: 3, stars: 17 } } }; });
  const phone = edit(base, 300, (s) => { s.checklist.items['d-ursus'] = { p: 'daily:2026-11-23', d: 1 }; });
  for (const merged of [mergeStates(pc, phone), mergeStates(phone, pc)]) {
    assert.equal(merged.gear.c1.slots.hat.stars, 17);
    assert.equal(merged.checklist.items['d-ursus'].d, 1);
    assert.equal(merged.characters.length, 1);
    assert.equal(merged.updatedAt, 300);
  }
  assert.ok(sameEntries(mergeStates(pc, phone), mergeStates(phone, pc)));
});

test('merge: the newer edit of the same part wins, whichever side it is on', () => {
  const base = edit(blank(), 100, (s) => { s.mesos.held = 1e9; });
  const older = edit(base, 200, (s) => { s.mesos.held = 2e9; });
  const newer = edit(base, 300, (s) => { s.mesos.held = 3e9; });
  assert.equal(mergeStates(older, newer).mesos.held, 3e9);
  assert.equal(mergeStates(newer, older).mesos.held, 3e9);
});

test('merge: a removal travels, and is not undone by the other device', () => {
  const base = edit(blank(), 100, (s) => { s.gear.c1 = { slots: {} }; s.gear.c2 = { slots: {} }; });
  const removed = edit(base, 200, (s) => { delete s.gear.c2; });
  const other = edit(base, 150, (s) => { s.mesos.held = 5; });
  const merged = mergeStates(other, removed);
  assert.ok(!('c2' in merged.gear));
  assert.ok('c1' in merged.gear);
  assert.equal(merged.mesos.held, 5);
});

test('merge: a fresh phone never wipes the copy in the gist', () => {
  // The phone has only today's streak record (written on first open), stamped later than anything on the PC.
  const pc = edit(blank(), 100, (s) => { s.characters.push({ id: 'c1', name: 'A' }); s.gear.c1 = { slots: { hat: { tier: 2 } } }; s.mesos.held = 7e9; });
  const phone = edit(blank(), 900, (s) => { s.checklist.history['2026-11-23'] = { done: 0, total: 9 }; });
  const merged = mergeStates(phone, pc);
  assert.equal(merged.characters.length, 1);
  assert.equal(merged.gear.c1.slots.hat.tier, 2);
  assert.equal(merged.mesos.held, 7e9);
  assert.deepEqual(merged.checklist.history['2026-11-23'], { done: 0, total: 9 });
});

test('merge: a copy saved before stamps existed is dated by its updatedAt', () => {
  const old = { ...blank(), updatedAt: 500, mesos: { held: 42, goals: [] }, gear: { c1: { slots: {} } } };
  delete old.stamps;
  assert.equal(seedStamps(old)['gear/c1'], 500);
  const phone = edit(blank(), 900, (s) => { s.checklist.history['2026-11-23'] = { done: 1, total: 9 }; });
  const merged = mergeStates(phone, old);
  assert.equal(merged.mesos.held, 42);
  assert.ok('c1' in merged.gear);
  const laterLocal = edit(blank(), 600, (s) => { s.mesos.held = 99; });
  assert.equal(mergeStates(laterLocal, old).mesos.held, 99);
});

test('units split the checklist per item and per-character data per character', () => {
  const s = edit(blank(), 1, (x) => { x.checklist.items.a = { d: 1 }; x.bosses.c1 = { picks: {} }; });
  const paths = [...units(s).keys()];
  assert.ok(paths.includes('checklist/items/a'));
  assert.ok(paths.includes('bosses/c1'));
  assert.ok(paths.includes('mesos'));
  assert.ok(!paths.includes('stamps') && !paths.includes('updatedAt'));
});

// ---------- QR ----------
test('QR: version choice, size and fixed patterns', () => {
  assert.equal(pickVersion(17), 1);
  assert.equal(pickVersion(18), 2);
  assert.equal(pickVersion(154), 7);
  assert.equal(pickVersion(271), 10);
  assert.equal(pickVersion(272), null);
  assert.equal(qrEncode('x'.repeat(300)), null);
  const qr = qrEncode('https://example.github.io/maple-tracker/#pair=ghp_' + 'a1B2'.repeat(9));
  assert.equal(qr.size, 17 + 4 * qr.version);
  const m = qr.modules;
  const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
  for (const [ox, oy] of [[0, 0], [qr.size - 7, 0], [0, qr.size - 7]]) {
    for (let y = 0; y < 7; y++) assert.equal(m[oy + y].slice(ox, ox + 7).map((v) => (v ? 1 : 0)).join(''), finder[y]);
  }
  for (let i = 8; i < qr.size - 8; i++) assert.equal(m[6][i], i % 2 === 0);
  assert.equal(m[qr.size - 8][8], true);
  assert.deepEqual(qrEncode('same text').modules, qrEncode('same text').modules);
  const { d, box } = qrPath(qr);
  assert.equal(box, qr.size + 8);
  assert.match(d, /^M\d+ \d+h\d+v1h-\d+z/);
});

test('QR: format bits match the published table for level L', () => {
  // ISO/IEC 18004 format information strings for error correction level L, masks 0 to 7.
  const table = ['111011111000100', '111001011110011', '111110110101010', '111100010011101', '110011000101111', '110001100011000', '110110001000001', '110100101110110'];
  const qr = qrEncode('HELLO');
  const m = qr.modules;
  // Bits 14..0 read from the copy beside the top-left finder.
  const at = (i) => (i <= 5 ? m[i][8] : i === 6 ? m[7][8] : i === 7 ? m[8][8] : i === 8 ? m[8][7] : m[8][14 - i]);
  let bits = '';
  for (let i = 14; i >= 0; i--) bits += at(i) ? '1' : '0';
  assert.equal(bits, table[qr.mask]);
});

test('QR: every block passes its Reed-Solomon check', () => {
  const exp = new Array(255);
  let x = 1;
  for (let i = 0; i < 255; i++) { exp[i] = x; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  const log = new Array(256).fill(0);
  exp.forEach((v, i) => { log[v] = i; });
  const mul = (a, b) => (a && b ? exp[(log[a] + log[b]) % 255] : 0);
  const check = (bytes, version, ecLen, blocks) => {
    const cw = codewords(bytes, version);
    for (let b = 0; b < blocks.length; b++) {
      // Undo the interleave for block b.
      const data = [];
      const max = Math.max(...blocks);
      let pos = 0;
      for (let i = 0; i < max; i++) for (let k = 0; k < blocks.length; k++) if (i < blocks[k]) { if (k === b) data.push(cw[pos]); pos++; }
      for (let i = 0; i < ecLen; i++) for (let k = 0; k < blocks.length; k++) { if (k === b) data.push(cw[pos]); pos++; }
      for (let r = 0; r < ecLen; r++) {
        let acc = 0;
        for (const byte of data) acc = mul(acc, exp[r]) ^ byte;
        assert.equal(acc, 0, `v${version} block ${b} root ${r}`);
      }
    }
  };
  const bytes = (n) => Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
  check(bytes(10), 1, 7, [19]);
  check(bytes(120), 6, 18, [68, 68]);
  check(bytes(260), 10, 18, [68, 68, 69, 69]);
});

// ---------- Today: ending soon ----------
test('ending soon hides Cash Shop sales and dismissed events unless asked', () => {
  const now = Date.parse('2026-11-23T03:00:00Z');
  const ev = (title, category, days) => ({ title, category, end: new Date(now + days * DAY).toISOString() });
  const live = [ev('Sale box', 'sale', 1), ev('Winter Countdown', 'events', 2), ev('Sunny Sunday', 'update', 6), ev('Far away', 'events', 30), ev('Skip me', 'events', 3)];
  const hidden = { [eventKey(live[4])]: 1 };
  const def = endingSoon(live, now, { hidden });
  assert.deepEqual(def.shown.map((e) => e.title), ['Winter Countdown', 'Sunny Sunday']);
  assert.equal(def.salesHidden, 1);
  assert.equal(def.dismissed, 1);
  const all = endingSoon(live, now, { showSales: true });
  assert.deepEqual(all.shown.map((e) => e.title), ['Sale box', 'Winter Countdown', 'Skip me', 'Sunny Sunday']);
  assert.equal(all.salesHidden, 0);
});

// ---------- reset warnings ----------
test('reset warnings: weekly tasks and bosses inside the last day, dailies inside the last three hours', () => {
  const cs = { items: {}, resets: {}, flags: {}, history: {} };
  const char = { id: 'c1', world: 'heroic' };
  const bossState = { picks: { 'lucid-hard': { party: 1 }, 'zakum-chaos': { party: 1 } }, clears: {} };
  // Wednesday 02:00 UTC: 22 h before the Thursday reset, 22 h before the daily reset, a week before the Wednesday one.
  const wed = Date.parse('2026-11-25T02:00:00Z');
  let w = resetWarnings(checklist, cs, characterLines(char, bossState, bosses, bossById, wed), wed);
  assert.deepEqual(w.map((x) => x.kind), ['thu']);
  assert.equal(w[0].bosses.count, 2);
  assert.equal(w[0].bosses.value, (100800000 + 16200000) * 5);
  assert.ok(w[0].items.includes('Challenger Pass weekly missions'));
  assert.ok(!w[0].items.includes('Weekly bosses'), 'link rows are not tasks');
  assert.equal(w[0].left, 22 * 3600000);

  // Clear a boss and tick the pass: both drop out.
  bossState.clears['lucid-hard'] = { [periodKey('thu', wed)]: true };
  cs.items['w-pass'] = { p: periodKey('thu', wed), d: 1 };
  w = resetWarnings(checklist, cs, characterLines(char, bossState, bosses, bossById, wed), wed);
  assert.equal(w[0].bosses.count, 1);
  assert.ok(!w[0].items.includes('Challenger Pass weekly missions'));

  // Saturday 22:00 UTC: two hours before the daily reset, nothing weekly is close.
  const sat = Date.parse('2026-11-28T22:00:00Z');
  w = resetWarnings(checklist, cs, [], sat);
  assert.deepEqual(w.map((x) => x.kind), ['daily']);
  assert.ok(w[0].items.includes('Ursus: one run'));
  assert.ok(!w[0].items.some((l) => l.startsWith('Hotel Arcus')), 'locked items are left out');
  assert.ok(!w[0].items.includes('Gollux'), 'optional items are left out');

  // Saturday noon: nothing is close.
  assert.deepEqual(resetWarnings(checklist, cs, [], Date.parse('2026-11-28T12:00:00Z')), []);
});

// ---------- best next upgrade ----------
test('upgrade options are ranked by gear score per meso and skip temporary items', () => {
  const state = { preset: 'mid', slots: {} };
  const preset = gear.presets.mid;
  const hat = gear.slots.find((s) => s.id === 'hat');
  const ring = gear.slots.find((s) => s.id === 'ring1');
  state.slots.hat = { tier: preset.tier, stars: Math.max(0, preset.stars.armor - 2), pot: preset.pot.other, lines: preset.lines.other };
  state.slots.ring1 = { tier: preset.tier, stars: Math.max(0, preset.stars.accessory - 5), pot: Math.max(1, preset.pot.other - 1), lines: 0 };
  state.slots.cape = { tier: preset.tier, stars: 0, pot: 0, temporary: true };
  const opts = upgradeOptions(gear, state, upgrades);
  assert.ok(opts.length >= 2);
  assert.ok(opts.every((o) => o.slotId !== 'cape'), 'temporary gear is never suggested');
  assert.ok(opts.every((o) => o.cost > 0 && o.gain > 0));
  for (let i = 1; i < opts.length; i++) assert.ok(opts[i - 1].value >= opts[i].value);
  const hatSf = opts.find((o) => o.slotId === 'hat' && o.kind === 'sf');
  assert.ok(hatSf && hatSf.sunnyCost < hatSf.cost);
  // The costs are the same ones the Gear page shows.
  const out = slotOutlook(hat, state.slots.hat, { tier: preset.tier, stars: preset.stars.armor, pot: preset.pot.other }, upgrades);
  assert.equal(hatSf.cost, out.sf.plain.cost);
  assert.ok(opts.some((o) => o.slotId === ring.id && o.kind === 'cube'));
});

test('affordable date from mesos held and weekly income', () => {
  const now = Date.parse('2026-11-23T00:00:00Z');
  assert.equal(affordableAt(1e9, 2e9, 0, now), now);
  assert.equal(affordableAt(3e9, 1e9, 1e9, now), now + 14 * DAY);
  assert.equal(affordableAt(3e9, 1e9, 0, now), null);
});

// ---------- first-run setup ----------
test('setup creates the character, its bosses and a first level reading', () => {
  const s = applySetup(blank(), { name: '  Hero  ', cls: 'Erel Light', level: 264, pct: 12.5, world: 'heroic', challenger: true, beyondBurning: true, mainStat: 'STR' }, ['lucid-hard', 'zakum-chaos'], 'abc', 1000);
  assert.equal(s.characters[0].name, 'Hero');
  assert.equal(s.activeId, 'abc');
  assert.deepEqual(Object.keys(s.bosses.abc.picks), ['lucid-hard', 'zakum-chaos']);
  assert.deepEqual(s.level.abc.log, [{ t: 1000, level: 264, pct: 12.5 }]);
  const lines = characterLines(s.characters[0], s.bosses.abc, bosses, bossById, Date.parse('2026-11-23T00:00:00Z'));
  assert.equal(lines.length, 2);
  const noLevel = applySetup(blank(), { name: 'X' }, [], 'z');
  assert.equal(noLevel.level.z, undefined);
});

// ---------- top-bar status ----------
test('status: worst problem wins, and new patch notes flag the game tables', async () => {
  const { appStatus, latestPatchNotes } = await import('../../site/app/calc/status.js');
  const now = Date.parse('2026-11-24T00:00:00Z');
  const meta = { checkedAt: '2026-11-23T19:39:38Z', ok: true, errors: [] };
  const news = [
    { name: 'v.272 - Maplayer One Patch Notes', category: 'update', liveDate: '2026-11-10T15:30:00Z' },
    { name: 'Classic World Patch Notes', category: 'update', liveDate: '2026-11-30T00:00:00Z', isClassic: true },
    { name: 'Cash Shop Update', category: 'sale', liveDate: '2026-11-22T00:00:00Z' }
  ];
  const base = { syncOn: true, sync: { state: 'ok', message: 'Up to date' }, meta, news, tablesChecked: '2026-11-23T00:00:00Z', now };
  assert.equal(latestPatchNotes(news).name, 'v.272 - Maplayer One Patch Notes');
  assert.deepEqual([appStatus(base).level, appStatus(base).label], ['ok', 'All synced']);
  assert.equal(appStatus({ ...base, syncOn: false, sync: { state: 'off' } }).label, 'Data fresh · sync off');
  assert.equal(appStatus({ ...base, sync: { state: 'busy' } }).label, 'Syncing…');

  const stale = appStatus({ ...base, now: now + 40 * 3600000 });
  assert.deepEqual([stale.level, stale.label], ['warn', 'Nexon data old']);
  assert.equal(appStatus({ ...base, meta: null }).label, 'No Nexon data');
  assert.equal(appStatus({ ...base, meta: { ...meta, ok: false, errors: ['news: HTTP 403'] } }).label, 'Nexon problem');

  const patched = appStatus({ ...base, news: [...news, { name: 'v.273 - Maplayer One Part 2 Patch Notes', category: 'update', liveDate: '2026-12-15T16:00:00Z', url: 'https://example.test/p' }] });
  assert.deepEqual([patched.level, patched.label], ['warn', 'New patch: check tables']);
  assert.equal(patched.parts.find((p) => p.key === 'tables').url, 'https://example.test/p');

  const broken = appStatus({ ...base, meta: null, sync: { state: 'error', message: 'GitHub answered 500' } });
  assert.deepEqual([broken.level, broken.label], ['error', 'Sync error']);
  assert.equal(broken.parts.length, 3);
});

// ---------- item list ----------
test('item list: version pick, slot from id, compact rows', async () => {
  const { latestGmsVersion, slotOfItem, buildItems, serialiseItems } = await import('../lib/items.mjs');
  assert.equal(latestGmsVersion([{ region: 'GMS', isReady: true, mapleVersionId: '269' }, { region: 'GMS', isReady: true, mapleVersionId: '270' }, { region: 'GMS', isReady: false, mapleVersionId: '272' }, { region: 'KMS', isReady: true, mapleVersionId: '400' }, { region: 'GMS', isReady: true, mapleVersionId: '83.1' }]), '270');
  assert.equal(latestGmsVersion('nope'), null);
  // Ids taken from live answers on 23 Nov 2026.
  assert.equal(slotOfItem(1004808), 'hat');        // Arcane Umbra Knight Hat
  assert.equal(slotOfItem(1113075), 'ring');       // Superior Gollux Ring
  assert.equal(slotOfItem(1012632), 'face');       // Berserked
  assert.equal(slotOfItem(1022278), 'eye');        // Magic Eyepatch
  assert.equal(slotOfItem(1122430), 'pendant');    // Source of Suffering
  assert.equal(slotOfItem(1032316), 'earrings');   // Commanding Force Earring
  assert.equal(slotOfItem(1132308), 'belt');       // Dreamy Belt
  assert.equal(slotOfItem(1162080), 'pocket');     // Cursed Red Spellbook
  assert.equal(slotOfItem(1182285), 'badge');      // Genesis Badge
  assert.equal(slotOfItem(1672076), 'heart');      // Black Heart
  assert.equal(slotOfItem(1098006), 'secondary');  // Princess No's Soul Shield
  assert.equal(slotOfItem(1212129), 'weapon');     // Genesis Shining Rod
  assert.equal(slotOfItem(1190301), 'emblem');
  assert.equal(slotOfItem(1143348), null);         // a medal
  assert.equal(slotOfItem('x'), null);
  const rows = buildItems([
    { id: 1004808, name: 'Arcane Umbra Knight Hat', requiredLevel: 200, isCash: false },
    { id: 1004999, name: 'Arcane  Umbra Knight Hat ', requiredLevel: 200, isCash: false },
    { id: 1005980, name: 'Eternal Knight Helm', requiredLevel: 250 },
    { id: 1000001, name: 'Cash Hat', requiredLevel: 150, isCash: true },
    { id: 1143348, name: 'The Legend of Mitra', requiredLevel: 200 },
    { id: 1113075, name: '', requiredLevel: 150 },
    null
  ]);
  assert.deepEqual(rows, [[1005980, 'Eternal Knight Helm', 250, 'hat'], [1004808, 'Arcane Umbra Knight Hat', 200, 'hat']]);
  const doc = JSON.parse(serialiseItems({ source: 's', version: '270', items: rows }));
  assert.deepEqual(doc, { source: 's', version: '270', items: rows });
});

test('item search is per slot, matches every word, and maps names to a tier rung', async () => {
  const { searchItems, itemSlotKey, iconUrl, tierFromName } = await import('../../site/app/calc/items.js');
  const items = [[1, 'Arcane Umbra Knight Hat', 200, 'hat'], [2, 'Arcane Umbra Mage Hat', 200, 'hat'], [3, 'Eternal Knight Helm', 250, 'hat'], [4, 'Superior Gollux Ring', 150, 'ring'], [5, 'Knight Ring', 100, 'ring']];
  assert.equal(itemSlotKey('ring3'), 'ring');
  assert.equal(itemSlotKey('pendant1'), 'pendant');
  assert.equal(itemSlotKey('top'), 'top');
  assert.deepEqual(searchItems(items, 'hat', 'knight').map((h) => h.id), [3, 1]);
  assert.deepEqual(searchItems(items, 'hat', 'umbra KNIGHT').map((h) => h.id), [1]);
  assert.deepEqual(searchItems(items, 'hat', 'arcane').map((h) => h.id), [1, 2]);
  assert.deepEqual(searchItems(items, 'ring', 'knight').map((h) => h.id), [5]);
  assert.deepEqual(searchItems(items, 'hat', 'ring'), []);
  assert.deepEqual(searchItems(items, 'hat', '  '), []);
  assert.equal(searchItems(items, 'hat', 'a', 1).length, 1);
  assert.equal(iconUrl('270', 1004808), 'https://maplestory.io/api/GMS/270/item/1004808/icon');
  assert.equal(iconUrl(null, 1), null);
  const hatTiers = gear.slotTypes.hat.filter(Boolean);
  assert.equal(hatTiers[tierFromName('Arcane Umbra Knight Hat', hatTiers, gear.tierHints) - 1], 'Arcane Umbra');
  assert.equal(hatTiers[tierFromName('Royal Warrior Helm', hatTiers, gear.tierHints) - 1], 'Chaos Root Abyss');
  assert.equal(hatTiers[tierFromName('Eternal Knight Helm', hatTiers, gear.tierHints) - 1], 'Eternal');
  assert.equal(tierFromName('Lionheart Battle Helm', hatTiers, gear.tierHints), 0);
  const ringTiers = gear.slotTypes.ring.filter(Boolean);
  assert.match(ringTiers[tierFromName('Superior Gollux Ring', ringTiers, gear.tierHints) - 1], /Superior Gollux/);
});

// ---------- real potential lines ----------
test('potential lines: data is consistent and matches the rules already in the tracker', async () => {
  const P = await import('../../site/app/calc/potential.js');
  const pot = load('potential');
  // Every pool entry points at a line; every group has five pools.
  for (const [group, pools] of Object.entries(pot.pools)) {
    assert.equal(pools.length, 5, group);
    for (const pool of pools) for (const pid of pool) assert.ok(pot.lines[pid], `${group} -> ${pid}`);
  }
  for (const slot of gear.slots) {
    const group = P.groupOf(pot, slot.id);
    if (slot.id === 'pocket' || slot.id === 'badge') continue;
    assert.ok(group && pot.pools[group], `slot ${slot.id} has a line group`);
  }
  const texts = (slotId, tier, lvl, prime) => P.lineChoices(pot, slotId, tier, lvl).filter((c) => c.prime === prime).map((c) => c.text);

  // Lv. 151+ Legendary main stat is 13% prime and 10% non-prime; 12% and 9% below Lv. 151.
  assert.ok(texts('hat', 4, 160, true).includes('STR +13%'));
  assert.ok(texts('hat', 4, 160, false).includes('STR +10%'));
  assert.ok(texts('hat', 4, 150, true).includes('STR +12%'));
  assert.ok(texts('hat', 4, 150, false).includes('STR +9%'));
  assert.ok(texts('hat', 4, 160, true).includes('All Stats +10%'));
  // Meso and Item Drop +20% are Legendary prime lines on accessories only.
  for (const s of ['face', 'eye', 'earrings', 'ring1', 'ring4', 'pendant2']) {
    assert.ok(texts(s, 4, 160, true).includes('Mesos Obtained +20%'), s);
    assert.ok(texts(s, 4, 160, true).includes('Item Drop Rate +20%'), s);
    assert.ok(!texts(s, 3, 160, true).includes('Mesos Obtained +20%'), s);
  }
  assert.ok(!texts('belt', 4, 160, true).includes('Mesos Obtained +20%'));
  // Hat cooldown, glove crit damage, weapon boss damage; no boss damage on emblems.
  assert.ok(texts('hat', 4, 160, true).includes('Skill Cooldown -2 seconds'));
  assert.ok(!texts('hat', 4, 100, true).includes('Skill Cooldown -2 seconds'), 'needs Lv. 120+');
  assert.ok(texts('hat', 4, 100, true).includes('Skill Cooldown -1 second'));
  assert.ok(texts('gloves', 4, 160, true).includes('Critical Damage +8%'));
  assert.ok(texts('weapon', 4, 200, true).includes('Damage to Boss Monsters +40%'));
  assert.ok(texts('weapon', 4, 200, true).includes('Damage to Boss Monsters +35%'));
  assert.ok(texts('weapon', 4, 200, false).includes('Damage to Boss Monsters +30%'));
  assert.ok(texts('weapon', 3, 200, true).includes('Damage to Boss Monsters +30%'));
  assert.ok(texts('weapon', 4, 200, true).includes('Weapon ATT +13%'));
  assert.ok(texts('secondary', 4, 160, true).includes('Damage to Boss Monsters +40%'));
  assert.ok(!P.lineChoices(pot, 'emblem', 4, 200).some((c) => c.text.startsWith('Damage to Boss')));
  assert.ok(texts('emblem', 4, 200, true).includes("Ignore 40% of Monster's DEF when attacking"));
  assert.deepEqual(P.lineChoices(pot, 'pocket', 4, 160), []);
  assert.deepEqual(P.lineChoices(pot, 'hat', 0, 160), []);
  // Useful lines come first within each group.
  const hat = P.lineChoices(pot, 'hat', 4, 160).filter((c) => c.prime);
  assert.ok(hat.findIndex((c) => !c.useful) > hat.map((c) => c.useful).lastIndexOf(true));
});

test('potential lines: saved lines feed the totals and survive tier and level changes', async () => {
  const P = await import('../../site/app/calc/potential.js');
  const { lineTotals, lineLabel, usefulLines } = await import('../../site/app/calc/upgrades.js');
  const pot = load('potential');
  const pick = (slotId, tier, lvl, text, prime = true) => P.makeLine(pot, P.lineChoices(pot, slotId, tier, lvl).find((c) => c.text === text && c.prime === prime), lvl);
  const str = pick('hat', 4, 160, 'STR +13%');
  assert.deepEqual({ type: str.type, stat: str.stat, value: str.value, prime: str.prime, text: str.text }, { type: 'main', stat: 'STR', value: 13, prime: true, text: 'STR +13%' });
  const cdr = pick('hat', 4, 160, 'Skill Cooldown -2 seconds');
  assert.deepEqual([cdr.type, cdr.value], ['cdr', 2]);
  const junk = pick('hat', 4, 160, 'DEF +12%');
  assert.equal(junk.type, 'other');
  const boss = pick('weapon', 4, 200, 'Damage to Boss Monsters +40%');
  const ied = pick('weapon', 4, 200, "Ignore 30% of Monster's DEF when attacking", false);
  const meso = pick('ring1', 4, 160, 'Mesos Obtained +20%');
  assert.equal(lineLabel(str), 'STR +13%');
  assert.equal(lineLabel(junk), 'DEF +12%');
  const state = { slots: { hat: { tier: 1, pot: 4, potLines: [str, cdr, junk] }, weapon: { tier: 1, pot: 4, potLines: [boss, ied] }, ring1: { tier: 1, pot: 4, potLines: [meso] } } };
  const totals = lineTotals(gear.slots, state, 'STR');
  assert.deepEqual([totals.main, totals.cdr, totals.boss, totals.ied, totals.meso], [13, 2, 40, 30, 20]);
  assert.equal(usefulLines(gear.slots.find((s) => s.id === 'hat'), state.slots.hat), 2);

  // Item level drops below 151: 13% becomes 12%. Tier drops to Unique: the Legendary prime line goes, STR stays at the Unique value.
  const lower = P.refreshLines(pot, 'hat', 4, 150, [str, cdr]);
  assert.deepEqual(lower.map((l) => l.text), ['STR +12%', 'Skill Cooldown -2 seconds']);
  const unique = P.refreshLines(pot, 'hat', 3, 160, [str, cdr]);
  assert.deepEqual(unique.map((l) => l.text || ''), ['', '']);
  const nonPrimeStr = pick('hat', 4, 160, 'STR +10%', false);
  assert.deepEqual(P.refreshLines(pot, 'hat', 3, 160, [nonPrimeStr]).map((l) => [l.text, l.prime]), [['STR +10%', true]]);
  // Lines entered before the real tables existed are left alone.
  const old = { type: 'main', stat: 'STR', value: 13 };
  assert.deepEqual(P.refreshLines(pot, 'hat', 4, 160, [old, null]), [old, { type: '' }]);
});
