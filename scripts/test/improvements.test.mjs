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
  const base = edit(blank(), 100, (s) => { s.characters.push({ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }); s.gear.c1 = { slots: {} }; s.gear.c2 = { slots: {} }; });
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
  const old = { ...blank(), updatedAt: 500, characters: [{ id: 'c1', name: 'A' }], mesos: { held: 42, goals: [] }, gear: { c1: { slots: {} } } };
  delete old.stamps;
  assert.equal(seedStamps(old)['gear/c1/@'], 500);
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
  assert.ok(paths.includes('bosses/c1/@'));
  assert.ok(paths.includes('mesos/held') && paths.includes('mesos/goalOrder'));
  assert.ok(!paths.includes('stamps') && !paths.includes('updatedAt') && !paths.includes('activeId'));
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

// ---------- fixes from the 23 Nov 2026 review ----------
test('merge: characters are merged one by one, so a phone set up before pairing keeps the PC characters', () => {
  const pc = edit(blank(), 100, (s) => { s.characters.push({ id: 'A', name: 'Main' }, { id: 'B', name: 'Mule' }); s.activeId = 'A'; s.gear.A = { slots: { hat: { tier: 2 } } }; });
  const phone = edit(blank(), 900, (s) => { s.characters.push({ id: 'P', name: 'Phone' }); s.activeId = 'P'; });
  for (const merged of [mergeStates(phone, pc, 1000), mergeStates(pc, phone, 1000)]) {
    assert.deepEqual(merged.characters.map((c) => c.id).sort(), ['A', 'B', 'P']);
    assert.equal(merged.gear.A.slots.hat.tier, 2);
  }
  // Editing one character on each device keeps both edits; deleting one travels.
  const base = pc;
  const d1 = edit(base, 200, (s) => { s.characters[0].level = 265; });
  const d2 = edit(base, 300, (s) => { s.characters[1].name = 'Renamed'; });
  const both = mergeStates(d1, d2, 1000);
  assert.equal(both.characters.find((c) => c.id === 'A').level, 265);
  assert.equal(both.characters.find((c) => c.id === 'B').name, 'Renamed');
  const gone = edit(base, 400, (s) => { s.characters = s.characters.filter((c) => c.id !== 'B'); });
  assert.deepEqual(mergeStates(d1, gone, 1000).characters.map((c) => c.id), ['A']);
  // A copy stamped while characters were still one unit ("characters": t) is read correctly.
  const legacy = structuredClone(pc);
  legacy.stamps = { characters: 100, activeId: 100, 'gear/A': 100 };
  assert.deepEqual(mergeStates(phone, legacy, 1000).characters.map((c) => c.id).sort(), ['A', 'B', 'P']);
});

test('merge: stamps from the future cannot wipe a device', () => {
  const now = Date.parse('2026-11-24T00:00:00Z');
  const pc = edit(blank(), now - 5000, (s) => { s.characters.push({ id: 'A', name: 'Main' }); s.gear.A = { slots: { hat: { tier: 2 } } }; s.mesos.held = 9e9; });
  const far = now + 400 * 86400000;
  const evil = { ...blank(), updatedAt: far, stamps: { 'characters/A': far, 'gear/A': far, mesos: far } };
  evil.mesos = { held: 0, goals: [] };
  // Far-future stamps are not trusted, so the doctored copy changes nothing, whichever side it is on.
  for (const merged of [mergeStates(pc, evil, now), mergeStates(evil, pc, now)]) {
    assert.deepEqual(merged.characters.map((c) => c.id), ['A']);
    assert.equal(merged.gear.A.slots.hat.tier, 2);
    assert.equal(merged.mesos.held, 9e9);
    assert.ok(Object.values(merged.stamps).every((t) => t <= now + 86400000), 'no far-future stamp survives a merge');
    assert.ok(merged.updatedAt <= now + 86400000);
  }
  // A clock that is only a little fast (under a day) still works normally.
  const slightlyFast = edit(pc, now + 3600000, (s) => { s.mesos.held = 1e9; });
  assert.equal(mergeStates(pc, slightlyFast, now).mesos.held, 1e9);
});

test('merge: removal markers count as a difference, so they are passed on', async () => {
  const { sameStamps } = await import('../../site/app/calc/merge.js');
  const base = edit(blank(), 100, (s) => { s.gear.c1 = { slots: {} }; });
  const removed = edit(base, 200, (s) => { delete s.gear.c1; });
  const neverHad = edit(blank(), 300, (s) => { s.mesos.held = 5; });
  const merged = mergeStates(neverHad, removed, 1000);
  assert.ok(sameEntries(merged, neverHad), 'no entry changes for the device that never had it');
  assert.ok(!sameStamps(merged, neverHad), 'but the removal marker is new to it and must be saved');
  assert.equal(merged.stamps['gear/c1/@'], 200);
  // With the marker carried along, the old copy cannot bring the part back.
  assert.ok(!('c1' in mergeStates(merged, base, 1000).gear));
  assert.ok(sameStamps(merged, structuredClone(merged)));
});

test('potential lines: a half-typed item level never deletes a line; off-stat lines are not useful', async () => {
  const P = await import('../../site/app/calc/potential.js');
  const { usefulLines, lineTotals, lineKind } = await import('../../site/app/calc/upgrades.js');
  const pot = load('potential');
  const choose = (slotId, tier, lvl, text, prime, mainStat) => P.makeLine(pot, P.lineChoices(pot, slotId, tier, lvl, mainStat).find((c) => c.text === text && c.prime === prime), lvl, mainStat);
  const boss = choose('weapon', 4, 200, 'Damage to Boss Monsters +40%', true, 'STR');
  const att = choose('weapon', 4, 200, 'Weapon ATT +13%', true, 'STR');
  // Typing 250 over 200 passes through "2" and "25".
  for (const lvl of [2, 25, 250]) {
    const kept = P.refreshLines(pot, 'weapon', 4, lvl, [boss, att], { mainStat: 'STR', keepMissing: true });
    assert.equal(kept[0].text, 'Damage to Boss Monsters +40%', 'level ' + lvl);
    assert.ok(kept[1].text.startsWith('Weapon ATT +'), 'level ' + lvl);
  }
  assert.equal(P.refreshLines(pot, 'weapon', 4, 250, [boss, att], { keepMissing: true })[1].text, 'Weapon ATT +13%');
  // Without keepMissing (a tier change) an impossible line is still dropped.
  assert.equal(P.refreshLines(pot, 'weapon', 2, 200, [boss])[0].type, '');

  const str = choose('hat', 4, 160, 'STR +13%', true, 'STR');
  const int = choose('hat', 4, 160, 'INT +13%', true, 'STR');
  const all = choose('hat', 4, 160, 'All Stats +10%', true, 'STR');
  assert.deepEqual([str.type, int.type, all.type], ['main', 'offstat', 'allstat']);
  const hat = gear.slots.find((s) => s.id === 'hat');
  assert.equal(lineKind(hat, int), 'other');
  assert.equal(usefulLines(hat, { potLines: [str, int, all] }), 2);
  const totals = lineTotals(gear.slots, { slots: { hat: { tier: 1, potLines: [str, int, all] } } }, 'STR');
  assert.deepEqual([totals.main, totals.damageLines], [23, 2]);
  const order = P.lineChoices(pot, 'hat', 4, 160, 'STR').filter((c) => c.prime);
  assert.equal(order[0].text, 'STR +13%');
  assert.ok(!order.find((c) => c.text === 'INT +13%').useful);
});

test('item list: a katara is a secondary', async () => {
  const { slotOfItem } = await import('../lib/items.mjs');
  assert.equal(slotOfItem(1342101), 'secondary');
  assert.equal(slotOfItem(1332225), 'weapon');
});

// ---------- batch 2 ----------
test('backups: one automatic copy a day, newest seven kept, labelled copies kept apart', async () => {
  const { addBackup, describeBackup } = await import('../../site/app/calc/backups.js');
  const day = (n) => Date.parse('2026-11-01T03:00:00Z') + n * DAY;
  const st = (n) => ({ ...blank(), updatedAt: day(n), characters: [{ id: 'a' }], gear: { a: { slots: { hat: {}, top: {} } } } });
  let list = [];
  list = addBackup(list, blank(), day(0));
  assert.equal(list.length, 0, 'an untouched tracker is not worth a copy');
  for (let n = 0; n < 10; n++) { list = addBackup(list, st(n), day(n)); list = addBackup(list, st(n), day(n) + 3600000); }
  assert.equal(list.length, 7);
  assert.deepEqual(list.map((b) => b.d), ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
  for (let n = 0; n < 5; n++) list = addBackup(list, st(10), day(10) + n, 'before restore');
  assert.equal(list.filter((b) => b.label).length, 3);
  assert.equal(list.filter((b) => !b.label).length, 7);
  assert.equal(describeBackup(list[0]), '1 character, 2 gear slots filled');
  assert.deepEqual(addBackup('junk', null, day(0)), []);
});

test('checklist: an item with a minimum level stays locked until the character reaches it', async () => {
  const { itemStatus } = await import('../../site/app/calc/checklist.js');
  const cs = { items: {}, resets: {}, flags: {}, history: {} };
  const thu = checklist.groups.find((g) => g.key === 'thu');
  const mayrin = thu.items.find((i) => i.id === 'w-mayrin');
  const wed = Date.parse('2026-11-25T02:00:00Z');
  assert.equal(mayrin.minLevel, 270);
  assert.equal(itemStatus(mayrin, thu, cs, wed, 264).locked, true);
  assert.equal(itemStatus(mayrin, thu, cs, wed, 270).locked, false);
  assert.equal(itemStatus(mayrin, thu, cs, wed, undefined).locked, false, 'unknown level never hides anything');
  const low = resetWarnings(checklist, cs, [], wed, { level: 264 })[0].items;
  const high = resetWarnings(checklist, cs, [], wed, { level: 271 })[0].items;
  assert.ok(!low.includes('Mayrin (from Lv. 270)'));
  assert.ok(high.includes('Mayrin (from Lv. 270)'));
  assert.ok(!high.some((l) => l.startsWith("Arthur's")), 'optional items are not warned about');
});

test('status: a sync token close to its expiry date warns, an expired one is an error', async () => {
  const { appStatus } = await import('../../site/app/calc/status.js');
  const now = Date.parse('2026-12-10T00:00:00Z');
  const base = { syncOn: true, sync: { state: 'ok', message: 'Up to date' }, meta: { checkedAt: '2026-12-09T20:00:00Z', ok: true, errors: [] }, news: [], tablesChecked: '2026-11-23T00:00:00Z', now };
  assert.equal(appStatus({ ...base, tokenExpires: '2027-03-01' }).label, 'All synced');
  assert.deepEqual([appStatus({ ...base, tokenExpires: '2026-12-14' }).level, appStatus({ ...base, tokenExpires: '2026-12-14' }).label], ['warn', 'Sync token: 4 days left']);
  assert.equal(appStatus({ ...base, tokenExpires: '2026-12-18' }).label, 'All synced', '8 days out: no warning yet');
  assert.deepEqual([appStatus({ ...base, tokenExpires: '2026-12-10' }).level, appStatus({ ...base, tokenExpires: '2026-12-10' }).label], ['error', 'Sync token expires today']);
  assert.equal(appStatus({ ...base, now: Date.parse('2026-12-09T23:00:00Z'), meta: { checkedAt: '2026-12-09T20:00:00Z', ok: true, errors: [] }, tokenExpires: '2026-12-10' }).label, 'Sync token: 1 day left');
  assert.deepEqual([appStatus({ ...base, tokenExpires: '2026-12-08' }).level, appStatus({ ...base, tokenExpires: '2026-12-08' }).label], ['error', 'Sync token expired']);
  assert.equal(appStatus({ ...base, syncOn: false, tokenExpires: '2026-12-08' }).level, 'ok', 'no warning when sync is off');
  assert.equal(appStatus({ ...base, tokenExpires: 'soon' }).label, 'All synced');
});

test('Sunny Sunday: schedule is read from the patch notes table and drives Star Force timing', async () => {
  const { findSunnySchedule } = await import('../lib/nexon-parse.mjs');
  const { sunnyDays, starForceTiming } = await import('../../site/app/calc/sunny.js');
  // Shape of the v.272 patch notes section (read 23 Nov 2026), shortened.
  const body = '<h2>Other</h2><p>Text</p><h2 style="x"><span> Sunny Sunday</span></h2><p>Log in each Sunday to enjoy various perks!</p><table><tr><td>Date (UTC)</td><td>Perks</td></tr>'
    + '<tr><td>November 29, 2026</td><td><ul><li>50% off Ability resets</li><li>Treasure Hunter EXP x3</li></ul></td></tr>'
    + '<tr><td>December 6, 2026</td><td><ul><li>Shining Star Force Time<ul><li>30% off Star Force enhancements</li><li>Mesos used to safeguard are not eligible for the 30% discount.</li></ul></li><li>2x Sol Erda when hunting</li></ul></td></tr>'
    + '<tr><td>December 8, 2026</td><td><ul><li>Not a Sunday</li></ul></td></tr></table><h2>Next section</h2><p>December 13, 2026</p><p>Unrelated</p>';
  const sched = findSunnySchedule(body);
  assert.deepEqual(sched.map((d) => d.date), ['2026-11-29', '2026-12-06']);
  assert.deepEqual(sched[0].perks, ['50% off Ability resets', 'Treasure Hunter EXP x3']);
  assert.ok(sched[1].perks.some((p) => p.includes('30% off Star Force enhancements')));
  assert.deepEqual(findSunnySchedule('<h2>Events</h2><p>November 29, 2026</p>'), []);

  const mon = Date.parse('2026-11-23T03:00:00Z');
  assert.deepEqual(sunnyDays(sched, mon).map((d) => [d.date, d.starForce, d.active]), [['2026-11-29', false, false], ['2026-12-06', true, false]]);
  const wait = starForceTiming(sched, 3e9, 2e9, mon);
  assert.deepEqual([wait.kind, wait.day.date, wait.saves], ['wait', '2026-12-06', 1e9]);
  assert.equal(starForceTiming(sched, 3e9, 2e9, Date.parse('2026-12-06T10:00:00Z')).kind, 'now');
  assert.equal(starForceTiming(sched.slice(0, 1), 3e9, 2e9, mon).kind, 'none');
  assert.equal(starForceTiming([], 3e9, 2e9, mon).kind, 'unknown');
  assert.equal(starForceTiming(sched, 3e9, 2e9, Date.parse('2026-12-07T00:00:00Z')).kind, 'unknown', 'past Sundays are ignored');
});

test('season end: actions are grouped by Nexon deadline and counted until the last one passes', async () => {
  const { seasonOutlook } = await import('../../site/app/calc/season.js');
  const season = load('season');
  assert.equal(season.ends, '2027-02-09T23:59:00Z');
  assert.ok(season.actions.every((a) => a.id && a.label && a.detail && a.quote && Number.isFinite(Date.parse(a.by))), 'every action has a date and Nexon wording');
  assert.equal(new Set(season.actions.map((a) => a.id)).size, season.actions.length);
  const now = Date.parse('2026-11-24T00:00:00Z');
  const o = seasonOutlook(season, { 'spend-coins': true }, now);
  assert.equal(o.daysLeft, 78);
  assert.deepEqual(o.groups.map((g) => new Date(g.at).toISOString()), ['2027-02-09T23:59:00.000Z', '2027-02-10T02:00:00.000Z', '2027-02-23T23:59:00.000Z']);
  assert.equal(o.total, season.actions.length);
  assert.equal(o.open, season.actions.length - 1);
  assert.ok(o.groups[0].items.find((i) => i.id === 'spend-coins').done);
  const after = seasonOutlook(season, {}, Date.parse('2027-02-10T01:00:00Z'));
  assert.deepEqual([after.ended, after.over, after.groups[0].passed, after.groups[1].passed], [true, false, true, false]);
  assert.equal(seasonOutlook(season, {}, Date.parse('2027-02-24T00:00:00Z')).over, true);
  assert.equal(seasonOutlook(null, {}, now), null);
});

test('flames: typed-in bonus stats are cleaned, labelled and totalled over equipped slots', async () => {
  const { cleanFlame, flameLabel, flameTotals } = await import('../../site/app/calc/gearstats.js');
  assert.equal(cleanFlame(null), null);
  assert.equal(cleanFlame({ main: 0, att: '', boss: -3 }), null);
  assert.deepEqual(cleanFlame({ main: 80, att: '6', allstat: 5, junk: 9 }), { main: 80, att: 6, allstat: 5 });
  assert.equal(flameLabel({ main: 80, att: 6, allstat: 5, boss: 12 }, 'STR'), 'STR +80 · ATT +6 · All Stats +5% · Boss +12%');
  const state = { slots: { hat: { tier: 2, flame: { main: 80, allstat: 5 } }, weapon: { tier: 2, flame: { att: 120, boss: 12, dmg: 6 } }, cape: { flame: { main: 999 } } } };
  assert.deepEqual(flameTotals(gear.slots, state), { main: 80, sub: 0, att: 120, allstat: 5, boss: 12, dmg: 6, items: 2 });
  assert.equal(flameLabel({ main: 80, sub: 20 }, 'STR'), 'STR +80 · Secondary +20');
});

test('gear stats: Star Force stat gains match the wiki table', async () => {
  const { starStats, starDelta } = await import('../../site/app/calc/gearstats.js');
  const gs = load('gearstats');
  const sf = gs.starforce;
  const slot = (id) => gear.slots.find((s) => s.id === id);
  // Stars 1-15 on armor: +2 for five stars, +3 for ten = 40. Star 16 at Lv. 160: stat +13, ATT +10; at Lv. 200: +15 and +12.
  assert.deepEqual(starStats(sf, slot('hat'), 160, 15), { stat: 40, att: 0, partial: false });
  assert.deepEqual(starDelta(sf, slot('hat'), 160, 15, 16), { stat: 13, att: 10, partial: false });
  assert.deepEqual(starDelta(sf, slot('hat'), 200, 15, 16), { stat: 15, att: 12, partial: false });
  assert.deepEqual(starDelta(sf, slot('hat'), 160, 21, 22), { stat: 13, att: 17, partial: false });
  assert.deepEqual(starDelta(sf, slot('hat'), 250, 21, 22), { stat: 17, att: 21, partial: false });
  assert.deepEqual(starDelta(sf, slot('hat'), 200, 24, 25), { stat: 0, att: 25, partial: false });
  // Gloves: ATT +1 at stars 5, 7, 9, 11, 13, 14 and 15.
  assert.equal(starStats(sf, slot('gloves'), 160, 15).att, 7);
  assert.equal(starStats(sf, slot('gloves'), 160, 6).att, 1);
  // Weapons: ATT at stars 1-15 needs the base ATT, so it is flagged; star 16 at Lv. 200 gives ATT +13.
  assert.equal(starStats(sf, slot('weapon'), 200, 15).partial, true);
  assert.deepEqual(starDelta(sf, slot('weapon'), 200, 15, 16), { stat: 15, att: 13, partial: false });
  assert.equal(starDelta(sf, slot('weapon'), 200, 12, 16).partial, true);
  // A Lv. 130 item cannot go past 20 stars in the table; under Lv. 128 nothing is known.
  assert.equal(starStats(sf, slot('hat'), 130, 21).partial, true);
  assert.equal(starStats(sf, slot('hat'), 100, 10).partial, true);
  assert.deepEqual(starStats(sf, slot('emblem'), 200, 10), { stat: 0, att: 0, partial: false });
});

test('gear stats: sets are recognised from item names and bonuses add up as the wiki states', async () => {
  const { detectSets, setBonusLabel } = await import('../../site/app/calc/gearstats.js');
  const gs = load('gearstats');
  const worn = (names) => ({ slots: Object.fromEntries(Object.entries(names).map(([id, note]) => [id, { tier: 2, note }])) });
  const arcane7 = detectSets(gs.sets, gear.slots, worn({ hat: 'Arcane Umbra Knight Hat', top: 'Arcane Umbra Knight Suit', shoes: 'Arcane Umbra Knight Shoes', gloves: 'Arcane Umbra Knight Gloves', cape: 'Arcane Umbra Knight Cape', shoulder: 'Arcane Umbra Knight Shoulder', weapon: 'Arcane Umbra Two-handed Sword' }));
  // Wiki running total at 7 pieces: All Stats +50, ATT +195, Boss 30%, IED 19%.
  assert.deepEqual(arcane7.map((s) => [s.id, s.count, s.bonus]), [['arcane', 7, { allStats: 50, att: 195, boss: 30, ied: 19, critDmg: 0 }]]);
  assert.equal(arcane7[0].nextAt, null);
  const mixed = detectSets(gs.sets, gear.slots, worn({ hat: 'Royal Warrior Helm', top: 'Eagle Eye Warrior Armor', bottom: 'Trixter Warrior Pants', ring1: 'Superior Gollux Ring', pendant1: 'Superior Engraved Gollux Pendant', face: 'Berserked', eye: 'Magic Eyepatch', belt: 'Some Other Belt' }));
  const by = Object.fromEntries(mixed.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(by).sort(), ['cra', 'pitchedBoss', 'superiorGollux']);
  assert.equal(by.cra.count, 3);
  assert.equal(by.cra.nextAt, 4);
  assert.equal(by.cra.bonus.att, 50);
  assert.equal(by.cra.bonus.boss, 0, 'Boss +30% needs the 4th piece');
  assert.equal(by.pitchedBoss.count, 2);
  assert.deepEqual([by.pitchedBoss.bonus.allStats, by.pitchedBoss.bonus.att, by.pitchedBoss.bonus.boss], [10, 10, 10]);
  assert.equal(setBonusLabel(by.pitchedBoss.bonus), 'All Stats +10 · ATT +10 · Boss +10%');
  assert.deepEqual(detectSets(gs.sets, gear.slots, { slots: { hat: { tier: 0, note: 'Arcane Umbra Knight Hat' } } }), [], 'an empty slot is not a set piece');
});

test('damage estimate: flat stat and ATT gains scale with your percentages, and rank Star Force upgrades', async () => {
  const { damageGain } = await import('../../site/app/calc/gearstats.js');
  const { upgradeOptions: opts, bestUpgrade } = await import('../../site/app/calc/advice.js');
  const stats = { main: 40000, sub: 5000, att: 5000, mainPct: 300, attPct: 100 };
  assert.equal(damageGain({}, { stat: 10, att: 10 }), null);
  assert.equal(damageGain(stats, { stat: 0, att: 0 }), 0);
  // +50 ATT at 100% ATT is +100 on 5000: exactly 2%.
  assert.ok(Math.abs(damageGain(stats, { stat: 0, att: 50 }) - 0.02) < 1e-12);
  // +100 stat at 300%: main +400 and secondary +100, on 4*40000+5000 = 165000 -> 1700/165000.
  assert.ok(Math.abs(damageGain(stats, { stat: 100, att: 0 }) - 1700 / 165000) < 1e-12);
  const gs = load('gearstats');
  const state = { preset: 'mid', slots: { hat: { tier: 2, ilvl: 150, stars: 17, pot: 3, lines: 2 }, ring1: { tier: 2, ilvl: 150, stars: 12, pot: 3, lines: 2 }, top: { tier: 3, ilvl: 150, stars: 22, pot: 2, lines: 2 } } };
  const plain = opts(gear, state, upgrades);
  assert.ok(plain.every((o) => o.dmg === undefined));
  assert.equal(bestUpgrade(plain).by, 'score');
  const ranked = opts(gear, state, upgrades, gs, stats);
  const sf = ranked.filter((o) => o.kind === 'sf');
  assert.ok(sf.length >= 2 && sf.every((o) => o.dmg > 0 && o.sfGain));
  assert.ok(ranked.filter((o) => o.kind === 'cube').every((o) => o.dmg === undefined), 'cube tier-ups get no damage number');
  const best = bestUpgrade(ranked);
  assert.equal(best.by, 'damage');
  assert.ok(sf.every((o) => best.dmg / best.cost >= o.dmg / o.cost));
  assert.equal(bestUpgrade([]), null);
});

// ---------- fixes from the 24 Nov 2026 review ----------
test('sets: an item listed by name in one set is never counted in another by prefix', async () => {
  const { detectSets } = await import('../../site/app/calc/gearstats.js');
  const gs = load('gearstats');
  const worn = (names) => ({ slots: Object.fromEntries(Object.entries(names).map(([id, note]) => [id, { tier: 2, note }])) });
  const a = Object.fromEntries(detectSets(gs.sets, gear.slots, worn({ hat: 'Royal Warrior Helm', top: 'Eagle Eye Warrior Armor', bottom: 'Trixter Warrior Pants', shoulder: 'Royal Black Metal Shoulder' })).map((s) => [s.id, s]));
  assert.equal(a.cra.count, 3, 'the Boss Accessory shoulder is not a Root Abyss piece');
  assert.equal(a.cra.bonus.boss, 0);
  assert.equal(a.bossAccessory.worn, 1);
  const b = Object.fromEntries(detectSets(gs.sets, gear.slots, worn({ badge: 'Genesis Badge', hat: 'Eternal Knight Helm', weapon: 'Genesis Two-handed Sword' })).map((s) => [s.id, s]));
  assert.equal(b.eternal.count, 2, 'Eternal hat plus Genesis weapon; the badge is a Pitched Boss piece');
  assert.equal(b.pitchedBoss.worn, 1);
});

test('checklist: the level lock can be overridden by the player', async () => {
  const { itemStatus } = await import('../../site/app/calc/checklist.js');
  const thu = checklist.groups.find((g) => g.key === 'thu');
  const mayrin = thu.items.find((i) => i.id === 'w-mayrin');
  const now = Date.parse('2026-11-25T02:00:00Z');
  const cs = { items: {}, resets: {}, flags: {}, history: {} };
  assert.equal(itemStatus(mayrin, thu, cs, now, 264).locked, true);
  cs.flags['lvl:w-mayrin'] = true;
  assert.equal(itemStatus(mayrin, thu, cs, now, 264).locked, false);
});

test('Sunny Sunday: text after the schedule table is not a perk', async () => {
  const { findSunnySchedule } = await import('../lib/nexon-parse.mjs');
  const body = '<h2>Sunny Sunday</h2><p>Log in each Sunday.</p><table><tr><td>Date (UTC)</td><td>Perks</td></tr><tr><td>December 13, 2026</td><td><ul><li>Treasure Hunter EXP x3</li></ul></td></tr></table><p>Reminder: 30% off Star Force returns next month.</p><h2>Other</h2>';
  assert.deepEqual(findSunnySchedule(body), [{ date: '2026-12-13', perks: ['Treasure Hunter EXP x3'] }]);
  // A layout without a table still works, and the section still ends at the next heading.
  const flat = '<h3>Sunny Sunday</h3><p>December 13, 2026</p><p>Combo Kill EXP +300%</p><h3>Next</h3><p>December 20, 2026</p><p>Not this</p>';
  assert.deepEqual(findSunnySchedule(flat), [{ date: '2026-12-13', perks: ['Combo Kill EXP +300%'] }]);
  assert.deepEqual(findSunnySchedule(null), []);
});

test('best upgrade ignores options without a usable cost', async () => {
  const { bestUpgrade } = await import('../../site/app/calc/advice.js');
  assert.equal(bestUpgrade([{ dmg: 0.01, cost: 0, label: 'free' }, { dmg: 0.5, cost: 100, label: 'real' }]).label, 'real');
  assert.equal(bestUpgrade([{ dmg: 0.2, cost: NaN, label: 'nan' }, { dmg: 0.1, cost: 100, label: 'real' }]).label, 'real');
});

// ---------- any class, any number of characters ----------
test('checklist: each character has its own ticks; account items are shared; Challenger items follow the character', async () => {
  const { itemStatus, recordKey, flagKey } = await import('../../site/app/calc/checklist.js');
  const daily = checklist.groups.find((g) => g.key === 'daily');
  const thu = checklist.groups.find((g) => g.key === 'thu');
  const item = (id) => checklist.groups.flatMap((g) => g.items).find((i) => i.id === id);
  const now = Date.parse('2026-11-25T02:00:00Z');
  const main = { id: 'A', level: 264, challenger: true };
  const mule = { id: 'B', level: 210, challenger: false };
  const cs = { items: {}, resets: {}, flags: {}, history: {}, owner: null };

  // A tick on the main is not a tick on the mule.
  assert.equal(recordKey(item('d-ursus'), main), 'A|d-ursus');
  cs.items[recordKey(item('d-ursus'), main)] = { p: periodKey('daily', now), d: 1 };
  assert.equal(itemStatus(item('d-ursus'), daily, cs, now, main).done, true);
  assert.equal(itemStatus(item('d-ursus'), daily, cs, now, mule).done, false);
  // Chips and counters too.
  cs.items[recordKey(item('d-bosses'), mule, '_cyg')] = { p: periodKey('daily', now), d: 1 };
  assert.deepEqual(itemStatus(item('d-bosses'), daily, cs, now, mule).on, [true, false, false]);
  assert.deepEqual(itemStatus(item('d-bosses'), daily, cs, now, main).on, [false, false, false]);

  // Account-wide items are one tick for everyone; Challenger-only items are hidden for a regular-world mule.
  assert.equal(item('w-mayrin').scope, 'account');
  assert.equal(recordKey(item('w-mayrin'), main), 'w-mayrin');
  assert.equal(itemStatus(item('w-pass'), thu, cs, now, main).expired, false);
  assert.equal(itemStatus(item('w-pass'), thu, cs, now, mule).expired, true);
  assert.equal(itemStatus(item('w-pass'), thu, cs, now, {}).expired, false, 'with no character yet, everything shows');

  // Level locks: Cernium needs 260, so the mule's core dailies are fewer.
  assert.equal(itemStatus(item('d-cernium'), daily, cs, now, mule).locked, true);
  assert.equal(itemStatus(item('d-cernium'), daily, cs, now, main).locked, false);
  // Unlock flags are per character.
  cs.flags[flagKey('arcus', { id: 'A', level: 270 })] = true;
  assert.equal(itemStatus(item('d-arcus'), daily, cs, now, { id: 'A', level: 270 }).locked, false);
  assert.equal(itemStatus(item('d-arcus'), daily, cs, now, { id: 'B', level: 270 }).locked, true);

  // Ticks saved before this change (plain keys) stay with the character that owned the list.
  const old = { items: { 'd-sauna': { p: periodKey('daily', now), d: 1 } }, resets: {}, flags: { arcus: true }, history: {}, owner: 'A' };
  assert.equal(itemStatus(item('d-sauna'), daily, old, now, main).done, true);
  assert.equal(itemStatus(item('d-sauna'), daily, old, now, mule).done, false);
  assert.equal(itemStatus(item('d-arcus'), daily, old, now, { id: 'A', level: 270 }).locked, false);
  assert.equal(itemStatus(item('d-arcus'), daily, old, now, { id: 'B', level: 270 }).locked, true);
  // A bare level (the old call style) still works.
  assert.equal(itemStatus(item('d-cernium'), daily, cs, now, 210).locked, true);

  // Reset warnings follow the character.
  const wMain = resetWarnings(checklist, cs, [], now, { who: main })[0].items;
  const wMule = resetWarnings(checklist, cs, [], now, { who: mule })[0]?.items || [];
  assert.ok(wMain.includes('Challenger Pass weekly missions'));
  assert.ok(!wMule.includes('Challenger Pass weekly missions'));
});

test('6th job: a character starts on the template for its class', async () => {
  const { erdaTemplateFor } = await import('../../site/app/calc/progress.js');
  const erda = load('erda');
  assert.equal(erdaTemplateFor(erda, { cls: 'Erel Light' }, null), 'erel');
  assert.equal(erdaTemplateFor(erda, { cls: ' erel light ' }, {}), 'erel');
  assert.equal(erdaTemplateFor(erda, { cls: 'Hero' }, null), 'hexa');
  assert.equal(erdaTemplateFor(erda, { cls: '' }, undefined), 'hexa');
  assert.equal(erdaTemplateFor(erda, { cls: 'Hero' }, { template: 'erel', templateChosen: true }), 'erel', 'a choice the player made is kept');
  assert.equal(erdaTemplateFor(erda, { cls: 'Hero' }, { template: 'erel' }), 'hexa', 'a template an older version filled in gives way to the class');
  assert.equal(erdaTemplateFor(erda, { cls: '' }, { template: 'erel' }), 'erel', 'with no class typed in, the saved one stays');
  assert.equal(erdaTemplateFor(erda, { cls: 'Erel Light' }, { template: 'hexa' }), 'erel');
  assert.equal(erdaTemplateFor(erda, { cls: 'Erel Light' }, { template: 'hexa', templateChosen: true }), 'hexa');
  assert.equal(erdaTemplateFor(erda, { cls: 'Hero' }, { template: 'gone' }), 'hexa');
});

test('main stat: Demon Avenger counts Max HP lines, Xenon counts STR, DEX and LUK', async () => {
  const P = await import('../../site/app/calc/potential.js');
  const U = await import('../../site/app/calc/upgrades.js');
  const pot = load('potential');
  const pick = (text, ms) => P.makeLine(pot, P.lineChoices(pot, 'hat', 4, 160, ms).find((c) => c.text === text && c.prime), 160, ms);
  assert.deepEqual([U.mainStatForClass('Demon Avenger'), U.mainStatForClass('xenon'), U.mainStatForClass('Hero')], ['HP', 'XENON', null]);
  assert.deepEqual([U.mainStatLabel('HP'), U.mainStatLabel('XENON'), U.mainStatLabel('LUK'), U.mainStatLabel(undefined)], ['Max HP', 'STR+DEX+LUK', 'LUK', 'STR']);
  assert.deepEqual([U.damageEstimateSupported('STR'), U.damageEstimateSupported('HP'), U.damageEstimateSupported('XENON')], [true, false, false]);
  const hat = gear.slots.find((s) => s.id === 'hat');

  // Demon Avenger
  const hp = pick('MaxHP +12%', 'HP');
  const str = pick('STR +13%', 'HP');
  const all = pick('All Stats +10%', 'HP');
  assert.deepEqual([hp.type, hp.stat, str.type, all.type], ['main', 'HP', 'offstat', 'offstat']);
  assert.equal(U.usefulLines(hat, { potLines: [hp, str, all] }), 1);
  assert.equal(U.lineTotals(gear.slots, { slots: { hat: { tier: 1, potLines: [hp, str, all] } } }, 'HP').main, 12);
  const daOrder = P.lineChoices(pot, 'hat', 4, 160, 'HP').filter((c) => c.prime);
  assert.ok(daOrder.find((c) => c.text === 'MaxHP +12%').useful);
  assert.ok(!daOrder.find((c) => c.text === 'STR +13%').useful);

  // Xenon
  const xs = ['STR +13%', 'DEX +13%', 'LUK +13%', 'INT +13%'].map((t) => pick(t, 'XENON'));
  assert.deepEqual(xs.map((l) => l.type), ['main', 'main', 'main', 'offstat']);
  assert.equal(U.lineTotals(gear.slots, { slots: { hat: { tier: 1, potLines: xs.slice(0, 3) } } }, 'XENON').main, 39);
  assert.equal(U.usefulLines(hat, { potLines: xs }), 3);

  // An ordinary class is unchanged.
  assert.deepEqual([pick('STR +13%', 'STR').type, pick('DEX +13%', 'STR').type, pick('MaxHP +12%', 'STR').type], ['main', 'offstat', 'hp']);
});

// ---------- fixes from the second 24 Nov 2026 review ----------
test('streak: looking at an alt never lowers the day the main already earned', async () => {
  const { streakEntry } = await import('../../site/app/calc/checklist.js');
  assert.deepEqual(streakEntry(undefined, 3, 9, 'A'), { done: 3, total: 9, by: 'A' });
  assert.deepEqual(streakEntry({ done: 3, total: 9, by: 'A' }, 9, 9, 'A'), { done: 9, total: 9, by: 'A' });
  assert.equal(streakEntry({ done: 9, total: 9, by: 'A' }, 9, 9, 'A'), null, 'no change, no write');
  assert.equal(streakEntry({ done: 9, total: 9, by: 'A' }, 0, 6, 'B'), null, 'the alt has done less: the entry stays');
  assert.deepEqual(streakEntry({ done: 4, total: 9, by: 'A' }, 6, 6, 'B'), { done: 6, total: 6, by: 'B' }, 'the alt finished everything: that counts');
  assert.deepEqual(streakEntry({ done: 9, total: 9, by: 'A' }, 8, 9, 'A'), { done: 8, total: 9, by: 'A' }, 'unticking on the same character lowers it');
  assert.deepEqual(streakEntry({ done: 2, total: 9 }, 5, 9, 'A'), { done: 5, total: 9, by: 'A' }, 'an entry from before this change is taken over');
  assert.equal(streakEntry({ done: 2, total: 9 }, 5, 0, 'A'), null);
});

test('checklist: a leftover record from an earlier period does not hide a current tick from an older version', async () => {
  const { itemStatus } = await import('../../site/app/calc/checklist.js');
  const daily = checklist.groups.find((g) => g.key === 'daily');
  const coupon = daily.items.find((i) => i.id === 'd-coupon');
  const now = Date.parse('2026-11-25T02:00:00Z');
  const cs = { items: { 'X|d-coupon': { p: 'daily:2026-11-24', d: 1 }, 'd-coupon': { p: periodKey('daily', now), d: 1 } }, resets: {}, flags: {}, history: {}, owner: 'X' };
  assert.equal(itemStatus(coupon, daily, cs, now, { id: 'X' }).done, true);
  assert.equal(itemStatus(coupon, daily, cs, now, { id: 'Y' }).done, false);
  cs.items['X|d-coupon'] = { p: periodKey('daily', now), d: 0 };
  assert.equal(itemStatus(coupon, daily, cs, now, { id: 'X' }).done, false, 'a current per-character record wins');
});

test('main stat: class changes and main-stat changes keep saved lines consistent', async () => {
  const U = await import('../../site/app/calc/upgrades.js');
  const P = await import('../../site/app/calc/potential.js');
  assert.deepEqual(U.mainStatOnClassChange('', 'Xenon', 'STR'), { mainStat: 'XENON' });
  assert.deepEqual(U.mainStatOnClassChange('Xenon', 'Hero', 'XENON'), { mainStat: 'STR' });
  assert.deepEqual(U.mainStatOnClassChange('Hero', 'Paladin', 'DEX'), {}, 'an ordinary choice is left alone');
  assert.deepEqual(U.mainStatOnClassChange('Hero', 'Bishop', 'HP'), {}, 'HP picked by hand on an ordinary class is left alone');
  const data = { gear, potential: load('potential') };
  const pick = (text, ms) => P.makeLine(data.potential, P.lineChoices(data.potential, 'hat', 4, 160, ms).find((c) => c.text === text && c.prime), 160, ms);
  // Saved while the character was still set to STR.
  const g = { slots: { hat: { tier: 2, ilvl: 160, pot: 4, potLines: [pick('MaxHP +12%', 'STR'), pick('STR +13%', 'STR'), pick('All Stats +10%', 'STR')] }, top: { tier: 2, pot: 4, potLines: [{ type: 'main', stat: 'STR', value: 13 }] } } };
  assert.equal(U.lineTotals(gear.slots, g, 'STR').main, 36);
  // Even before re-reading, an old Max HP line counts once the character is HP.
  assert.equal(U.lineTotals(gear.slots, { slots: { hat: { tier: 2, potLines: [{ type: 'hp', value: 12 }] } } }, 'HP').main, 12);
  P.reclassifyLines(data, g, 'HP');
  assert.deepEqual(g.slots.hat.potLines.map((l) => l.type), ['main', 'offstat', 'offstat']);
  assert.equal(U.lineTotals(gear.slots, { slots: { hat: g.slots.hat } }, 'HP').main, 12);
  assert.equal(U.usefulLines(gear.slots.find((s) => s.id === 'hat'), g.slots.hat), 1);
  // A line entered by hand before the tables follows its stat too: STR is not the main stat of an HP character.
  assert.deepEqual(g.slots.top.potLines, [{ type: 'offstat', stat: 'STR', value: 13 }]);
  P.reclassifyLines(data, g, 'STR', 'HP');
  assert.deepEqual(g.slots.hat.potLines.map((l) => l.type), ['hp', 'main', 'allstat']);
  assert.deepEqual(g.slots.top.potLines, [{ type: 'main', stat: 'STR', value: 13 }], 'and counts again after switching back');
  // A stat-less hand line was entered for the old main stat, so it keeps that stat.
  const bare = { slots: { top: { tier: 2, pot: 4, potLines: [{ type: 'main', value: 9 }] } } };
  P.reclassifyLines(data, bare, 'INT', 'LUK');
  assert.deepEqual(bare.slots.top.potLines, [{ type: 'offstat', stat: 'LUK', value: 9 }]);
  P.reclassifyLines(data, undefined, 'STR');
});

// ---------- found by the full walk-through on 24 Nov 2026 ----------
test('sync leaves each device on its own character', () => {
  const base = edit(blank(), 100, (s) => { s.characters.push({ id: 'A', name: 'Main' }, { id: 'B', name: 'Alt' }); s.activeId = 'A'; });
  const pc = edit(base, 200, (s) => { s.mesos.held = 1; });
  const phone = edit(base, 900, (s) => { s.activeId = 'B'; s.mesos.held = 2; });
  assert.equal(mergeStates(pc, phone, 1000).activeId, 'A');
  assert.equal(mergeStates(phone, pc, 1000).activeId, 'B');
  assert.equal(mergeStates(pc, phone, 1000).mesos.held, 2);
  assert.ok(sameEntries(pc, { ...pc, activeId: 'B' }), 'a different character on screen is not a difference to sync');
  // A copy stamped by an earlier version (which did merge activeId) no longer moves it.
  const old = structuredClone(phone);
  old.stamps.activeId = 950;
  const merged = mergeStates(pc, old, 1000);
  assert.equal(merged.activeId, 'A');
  assert.ok(!('activeId' in merged.stamps));
});

test('checklist status says why an item is locked', async () => {
  const { itemStatus } = await import('../../site/app/calc/checklist.js');
  const daily = checklist.groups.find((g) => g.key === 'daily');
  const arcus = daily.items.find((i) => i.id === 'd-arcus');
  const now = Date.parse('2026-11-25T02:00:00Z');
  const cs = { items: {}, resets: {}, flags: {}, history: {}, owner: null };
  const who = (level) => ({ id: 'A', level });
  assert.deepEqual([itemStatus(arcus, daily, cs, now, who(264)).tooLow, itemStatus(arcus, daily, cs, now, who(264)).gated], [true, true]);
  cs.flags['A|lvl:d-arcus'] = true;
  const half = itemStatus(arcus, daily, cs, now, who(264));
  assert.deepEqual([half.tooLow, half.gated, half.locked], [false, true, true], 'level override set: only the quest lock is left');
  cs.flags['A|arcus'] = true;
  assert.equal(itemStatus(arcus, daily, cs, now, who(264)).locked, false);
  assert.deepEqual([itemStatus(arcus, daily, { ...cs, flags: {} }, now, who(270)).tooLow, itemStatus(arcus, daily, { ...cs, flags: {} }, now, who(270)).gated], [false, true]);
});
