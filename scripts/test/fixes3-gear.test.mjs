// Third round, gear area: fixes to the second round's fixes. Level readings (which ones stand, what "Log it" and
// deleting do to the level), day counts beside level gates, Brilliant Boss item tiers, and totals under an overall.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

const dataFile = (name) => fileURLToPath(new URL(`../../site/data/${name}`, import.meta.url));
installFakeBrowser({ files: { 'data/items.json': dataFile('items.json') } });
const load = (name) => JSON.parse(readFileSync(dataFile(`${name}.json`), 'utf8'));

const { html, render } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const U = await import('../../site/app/calc/upgrades.js');
const A = await import('../../site/app/calc/advice.js');
const I = await import('../../site/app/calc/items.js');
const G = await import('../../site/app/calc/progress.js');
const GS = await import('../../site/app/calc/gearstats.js');
const L = await import('../../site/app/pages/level.js');
const { GearPage } = await import('../../site/app/pages/gear.js');
const { ProgressPage } = await import('../../site/app/pages/progress.js');
const { TodayPage } = await import('../../site/app/pages/today.js');

const DATA = {
  bosses: load('bosses'), symbols: load('symbols'), liberation: load('liberation'), ibp: load('ibp'), checklist: load('checklist'),
  gear: load('gear'), erda: load('erda'), upgrades: load('upgrades'), potential: load('potential'), gearStats: load('gearstats'),
  events: { events: [], sunny: [] }, news: { items: [] }, nexonCharacters: { characters: [] }, meta: null, tables: load('tables'), season: load('season'),
  pitched: load('pitched'), shops: { source: 'test', shops: [] }, flames: load('flames'), champions: load('champions'), expSources: load('expsources'),
  upcoming: { items: [] }, bossCp: load('bosscp'), classes: load('classes')
};
DATA.bossById = Object.fromEntries(DATA.bosses.bosses.map((b) => [b.id, b]));
const DAY = 86400000;
const HOUR = 3600000;
const T0 = Date.parse('2026-11-20T00:00:00Z');

const mounted = [];
const realNow = Date.now;
const RealFormData = globalThis.FormData;
after(() => { Date.now = realNow; globalThis.FormData = RealFormData; for (const el of mounted) render(null, el); });
async function show(Page, data = DATA, props = {}) {
  const el = new FakeNode('div');
  mounted.push(el);
  const App = () => html`<${Page} data=${data} state=${store.useStore()} ...${props} />`;
  render(html`<${App} />`, el);
  await tick(5);
  return el;
}
async function until(check, ms = 3000) {
  for (const end = realNow() + ms; realNow() < end;) { if (check()) return true; await tick(10); }
  return Boolean(check());
}
function close(el) { render(null, el); mounted.splice(mounted.indexOf(el), 1); }
const char = (over = {}) => ({ id: 'c', name: 'Tester', cls: 'Hero', level: 264, region: 'na', world: 'heroic', mainStat: 'STR', ...over });
function setState(over, c = {}) {
  const s = store.blankState();
  store.replaceState({ ...s, characters: [char(c)], activeId: 'c', ...over, ui: { ...s.ui, progressView: 'level', ...(over.ui || {}) } }, true);
}
const flat = (el) => el.text.replace(/\s+/g, ' ');
const levelNow = () => store.getState().characters[0].level;
const known = (data = DATA) => L.knownLevel(data, store.getState(), store.getState().characters[0]);
const logNow = () => store.getState().level.c.log;

// The Level page with its real buttons. logIt types into the real form; del clicks the row's own delete button.
async function levelPage(data = DATA) {
  const el = await show(ProgressPage, data);
  const dels = () => el.findAll((n) => n.localName === 'button' && n.attrs['aria-label'] === 'Delete this reading');
  return {
    el,
    async logIt(level, pct = 5) {
      const before = (store.getState().level.c || { log: [] }).log.length;
      globalThis.FormData = class { get(k) { return { level: String(level), pct: String(pct) }[k]; } };
      try { el.find((n) => n.localName === 'form').fire('submit', { currentTarget: { reset() {} } }); } finally { globalThis.FormData = RealFormData; }
      assert.ok(await until(() => logNow().length === before + 1), `logged ${level}`);
      await tick(5);
    },
    // i counts from the oldest reading (0). Every reading in these tests is on screen (six or fewer).
    async del(i) {
      const n = logNow().length;
      assert.ok(await until(() => dels().length === n), 'every reading has a delete button');
      dels()[n - 1 - i].fire('click'); // the table lists the newest first
      assert.ok(await until(() => logNow().length === n - 1), 'the reading is gone');
      await tick(5);
    }
  };
}

// ---------- 13: which readings stand ----------
test('level log: the readings that stand are the longest run that never goes down', () => {
  const rows = (levels) => levels.map((level, i) => ({ t: T0 + i * DAY, level, pct: i }));
  const stand = (levels) => L.standingLog(rows(levels)).map((r) => r.pct);
  // One slip, too high or too low, with the right level logged before or after it.
  assert.deepEqual(stand([264, 284, 264, 264]), [0, 2, 3]);
  assert.deepEqual(stand([284, 264]), [1], 'two readings that disagree: the newer one stands');
  assert.deepEqual(stand([264, 284, 264]), [0, 2]);
  assert.deepEqual(stand([270, 270, 290, 270]), [0, 1, 3]);
  assert.deepEqual(stand([270, 270, 207]), [0, 1], 'a low slip does not push out the real readings');
  assert.deepEqual(stand([270, 270, 207, 270]), [0, 1, 3], 'and logging the right level again keeps them all');
  assert.deepEqual(stand([264, 207, 264]), [0, 2], 'a low slip is not kept as a step on the way up');
  assert.deepEqual(stand([264, 207]), [1], 'one reading against one: the newer one, as for a high slip');
  // Nothing wrong: everything stands, in time order, whatever order it is stored in.
  assert.deepEqual(stand([264, 264, 265, 266]), [0, 1, 2, 3]);
  assert.deepEqual(L.standingLog(rows([264, 284, 264]).reverse()).map((r) => r.pct), [0, 2]);
  assert.deepEqual(L.standingLog(undefined), []);
  assert.deepEqual(L.standingLog([null, { t: 'x', level: 264 }, { t: 5, level: NaN }]), []);

  // Every real history of 2 to 5 readings, with one slip (207 or 284) logged anywhere it contradicts a real
  // reading and the right level logged after it: exactly the real readings stand.
  const histories = [];
  const grow = (h) => { if (h.length >= 2) histories.push(h); if (h.length < 5) for (let l = h[h.length - 1] || 264; l <= 266; l++) grow([...h, l]); };
  grow([]);
  let checked = 0;
  for (const h of histories) {
    for (const slip of [207, 284]) {
      // k real readings come before the slip. A low slip needs one before it, both need one after it.
      for (let k = slip === 207 ? 1 : 0; k < h.length; k++) {
        const mixed = [...h.slice(0, k).map((level) => ({ level, real: true })), { level: slip, real: false }, ...h.slice(k).map((level) => ({ level, real: true }))]
          .map((r, i) => ({ ...r, t: T0 + i * DAY, pct: i }));
        assert.deepEqual(L.standingLog(mixed), mixed.filter((r) => r.real), `${h.join(',')} with ${slip} after ${k}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 200);
});

test('level log: a mistyped low reading keeps the level, and the rate is back once the right level is logged', () => {
  const now = Date.parse('2026-11-26T03:00:00Z');
  const c = char({ level: 270 });
  const real = [{ t: now - 6 * DAY, level: 270, pct: 10 }, { t: now - 3 * DAY, level: 270, pct: 20 }];
  const slip = { t: now - HOUR, level: 207, pct: 30 };
  const fixed = { t: now - HOUR / 2, level: 270, pct: 30 };
  const at = (log, level = 270) => {
    const st = { level: { c: { log } } };
    const who = { ...c, level };
    return { known: L.knownLevel(DATA, st, who), o: L.levelOutlook(DATA, st, who, now) };
  };
  const clean = at(real);
  assert.ok(clean.o.rate && clean.o.gates[0].at, 'two real readings give a rate and dates');

  // After the slip (the level on Characters may have followed it or not): still Lv. 270, same rate, same dates.
  for (const level of [270, 207]) {
    const s = at([...real, slip], level);
    assert.equal(s.known, 270);
    assert.equal(s.o.last.level, 270);
    assert.equal(s.o.rate.perDay, clean.o.rate.perDay);
    assert.deepEqual(s.o.gates.map((g) => [g.level, g.at]), clean.o.gates.map((g) => [g.level, g.at]));
  }
  // After logging the right level again: all three real readings count.
  const f = at([...real, slip, fixed]);
  assert.equal(f.known, 270);
  assert.deepEqual(f.o.readings.map((r) => r.level), [270, 270, 270]);
  const want = U.expRate(DATA.upgrades.exp, [...real, fixed].map((r) => ({ t: r.t, level: r.level, frac: r.pct / 100 })), false, 14, now);
  assert.ok(want && want.perDay > 0);
  assert.equal(f.o.rate.perDay, want.perDay);
  assert.ok(f.o.gates.every((g) => g.at != null), 'every gate has a date');
  // Deleting the slip instead gives the clean result.
  assert.equal(at(real).o.rate.perDay, clean.o.rate.perDay);
});

// ---------- 12, 13: what "Log it" and deleting do to the level ----------
test('level log: the pure rules for the level after logging and after deleting', () => {
  const r = (d, level, was) => ({ t: T0 + d * DAY, level, pct: 0, ...(was === undefined ? {} : { was }) });
  const own = (log) => L.standingLog(log).map((x) => ({ t: x.t, level: x.level }));
  // Logging: a reading that stands sets the level; an ignored one does not.
  const slip = r(2, 207, 270);
  assert.equal(L.levelAfterLog([r(0, 270), r(1, 270), slip], slip, 270), 270);
  const up = r(2, 271, 270);
  assert.equal(L.levelAfterLog([r(0, 270), r(1, 270), up], up, 270), 271);
  const fix = r(2, 264, 284);
  assert.equal(L.levelAfterLog([r(0, 264), r(1, 284), fix], fix, 284), 264);

  const del = (log, row, current, nexon = []) => {
    const left = [...own(log.filter((x) => x !== row)), ...nexon].sort((a, b) => a.t - b.t);
    return L.levelAfterDelete(log, row, left, current);
  };
  // Not the newest reading: nothing changes, whatever `was` says.
  const a = r(0, 284, 264), b = r(1, 264, 284), c3 = r(2, 264, 264);
  assert.equal(del([a, b, c3], b, 264), 264);
  assert.equal(del([a, b, c3], a, 264), 264);
  const r1 = r(0, 264, 280), r2 = r(1, 264, 264);
  assert.equal(del([r1, r2], r1, 264), 264);
  // The newest reading: its effect is undone.
  assert.equal(del([a, b, c3], c3, 264), 264);
  const only = r(0, 284, 264);
  assert.equal(del([only], only, 284), 264);
  const first = r(0, 264, null);
  assert.equal(del([first], first, 264), null, 'the level was blank before the reading');
  const old = r(0, 264); // written by the live version: no `was`
  assert.equal(del([old], old, 264), 264);
  // The level was changed on Characters after the reading: deleting leaves it alone.
  assert.equal(del([only], only, 290), 290);
  // A reading from Nexon's rankings later than the deleted one is newer than `was`.
  const typo = r(1, 284, 264);
  assert.equal(del([r(0, 264, 264), typo], typo, 284, [{ t: T0 + 2 * DAY, level: 265 }]), 265);
  const high = r(1, 264, 290); // Characters said 290 by mistake; Nexon later says 264
  assert.equal(del([high], high, 264, [{ t: T0 + 2 * DAY, level: 264 }]), 264);
  // A Nexon reading from before it: the higher of that and `was`.
  assert.equal(del([typo], typo, 284, [{ t: T0, level: 266 }]), 266);
});

test('level log: deleting a reading never sets a level that a later reading contradicts (stored states)', async () => {
  const now = realNow();
  const row = (daysAgo, level, was) => ({ t: now - daysAgo * DAY, level, pct: 1, was });
  // Case 1: the state a high slip and its correction leave. Delete the correction in the middle.
  setState({ level: { c: { log: [row(5, 284, 264), row(4, 264, 284), row(3, 264, 264)] } } });
  let page = await levelPage();
  await page.del(1);
  assert.deepEqual([levelNow(), known()], [264, 264]);
  close(page.el);
  // Case 2: Characters said 280 by mistake before the first reading. Delete the older row.
  setState({ level: { c: { log: [row(4, 264, 280), row(3, 264, 264)] } } });
  page = await levelPage();
  await page.del(0);
  assert.deepEqual([levelNow(), known()], [264, 264]);
  close(page.el);
  // The same two states, deleting each of the other rows instead.
  for (const i of [0, 2]) {
    setState({ level: { c: { log: [row(5, 284, 264), row(4, 264, 284), row(3, 264, 264)] } } });
    page = await levelPage();
    await page.del(i);
    assert.deepEqual([levelNow(), known()], [264, 264], `case 1, row ${i}`);
    close(page.el);
  }
  setState({ level: { c: { log: [row(4, 264, 280), row(3, 264, 264)] } } });
  page = await levelPage();
  await page.del(1);
  assert.deepEqual([levelNow(), known()], [264, 264]);
  close(page.el);
});

test('level log: a high slip, corrected, then any reading deleted (through the form)', async () => {
  // Log 284 by mistake, then 264, then 264 again; then delete each row in turn, in every order.
  const orders = [[0], [1], [2], [0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [0, 0, 0], [1, 1, 0], [2, 1, 0], [1, 0, 0], [0, 1, 0], [2, 0, 0]];
  for (const order of orders) {
    setState({ level: {} });
    const page = await levelPage();
    await page.logIt(284);
    assert.equal(levelNow(), 284, 'a high reading with nothing after it stands');
    await page.logIt(264);
    assert.deepEqual([levelNow(), known()], [264, 264], 'the correction wins');
    assert.ok(await until(() => /Ignored: the level does not fit your other readings/.test(flat(page.el))), 'the slip is marked');
    await page.logIt(264);
    assert.deepEqual(logNow().map((x) => [x.level, x.was]), [[284, 264], [264, 284], [264, 264]]);
    let rows = ['slip', 'fix', 'again'];
    for (const i of order) {
      const gone = rows[i];
      const wasNewest = i === rows.length - 1;
      await page.del(i);
      rows = rows.filter((_, j) => j !== i);
      // Only undoing the newest row may bring the slip's level back, and only while the slip is all that is left
      // after the correction: then 284 is what the log says.
      const onlySlipLeft = rows.length === 1 && rows[0] === 'slip';
      const want = wasNewest && gone !== 'slip' && onlySlipLeft ? 284 : 264;
      assert.equal(levelNow(), want, `order ${order.join(',')}: after deleting ${gone}`);
      assert.equal(known(), want, `order ${order.join(',')}: known level after deleting ${gone}`);
    }
    close(page.el);
  }
});

test('level log: a low slip, with and without the correction, then any reading deleted (through the form)', async () => {
  const start = () => {
    const now = realNow();
    setState({ level: { c: { log: [{ t: now - 6 * DAY, level: 270, pct: 10, was: 270 }, { t: now - 3 * DAY, level: 270, pct: 20, was: 270 }] } } }, { level: 270 });
  };
  for (const corrected of [false, true]) {
    const n = corrected ? 4 : 3;
    const orders = [];
    for (let i = 0; i < n; i++) { orders.push([i]); for (let j = 0; j < n - 1; j++) orders.push([i, j]); }
    for (const order of orders) {
      start();
      const page = await levelPage();
      await page.logIt(207, 30);
      assert.deepEqual([levelNow(), known()], [270, 270], 'the slip is ignored and the level stays');
      assert.equal(logNow()[2].was, 270);
      assert.ok(await until(() => flat(page.el).includes('Ignored: the level does not fit your other readings. If this one is right, delete the wrong ones.')), 'the slip is marked');
      assert.match(flat(page.el), /Now Lv\. 270/);
      if (corrected) {
        await page.logIt(270, 30);
        assert.deepEqual([levelNow(), known()], [270, 270]);
        assert.ok(await until(() => /About [\d.]+[A-Za-z]* EXP a day/.test(flat(page.el))), 'the rate is back');
      }
      let rows = ['a', 'b', 'slip', ...(corrected ? ['fix'] : [])];
      for (const i of order) {
        const gone = rows[i];
        await page.del(i);
        rows = rows.filter((_, j) => j !== i);
        // The stored level never moves. The known level follows the slip only when the slip is the newest row
        // and at most one real reading is left to speak against it (one against one: the newer stands).
        assert.equal(levelNow(), 270, `${corrected ? 'corrected' : 'slip'} ${order.join(',')}: after deleting ${gone}`);
        assert.equal(known(), 270, `${corrected ? 'corrected' : 'slip'} ${order.join(',')}: known level after deleting ${gone}`);
      }
      close(page.el);
    }
  }
});

test('level log: deleting the reading that set the level puts back what it replaced', async () => {
  // A real level-up logged by mistake one level too high, with older readings behind it.
  const now = realNow();
  setState({ level: { c: { log: [{ t: now - 2 * DAY, level: 264, pct: 50, was: 264 }] } } });
  let page = await levelPage();
  await page.logIt(266);
  assert.equal(levelNow(), 266);
  await page.del(1);
  assert.deepEqual([levelNow(), known()], [264, 264]);
  close(page.el);

  // The level typed on Characters was above the old reading; a slip replaces it; deleting the slip restores it.
  setState({ level: { c: { log: [{ t: now - 2 * DAY, level: 264, pct: 50 }] } } }, { level: 268 });
  page = await levelPage();
  await page.logIt(286);
  assert.equal(levelNow(), 286);
  await page.del(1);
  assert.deepEqual([levelNow(), known()], [268, 268]);
  close(page.el);

  // Nexon's rankings saw the character after the slip: that reading is the newest thing known.
  const nexon = { ...DATA, nexonCharacters: { characters: [{ name: 'Tester', history: [{ t: now + HOUR, level: 265, exp: 0 }] }] } };
  setState({ level: {} });
  page = await levelPage(nexon);
  await page.logIt(284);
  await page.del(0);
  assert.equal(levelNow(), 265);
  close(page.el);

  // Two readings logged in the same millisecond are still two rows.
  setState({ level: {} });
  page = await levelPage();
  Date.now = () => now;
  try {
    await page.logIt(264);
    await page.logIt(264, 6);
  } finally { Date.now = realNow; }
  assert.equal(new Set(logNow().map((x) => x.t)).size, 2);
  await page.del(1);
  assert.equal(logNow().length, 1);
  close(page.el);
});

// ---------- 21: the level gate counts Korean calendar days ----------
test('level gates: the day count beside a gate date is in Korean calendar days, on Progress and on Today', async () => {
  const now = Date.parse('2026-11-26T08:00:00Z'); // Thu 26 Nov, 17:00 KST
  const exp = DATA.upgrades.exp;
  const need = U.expToNext(exp, 264);
  // 5.1 days to Lv. 265 at the rate of the last two days: 1 Dec, 19:24 KST. Five Korean days away, not six.
  const perDay = (need * 0.5) / 5.1;
  const log = [{ t: now - 2 * DAY, level: 264, pct: 50 - (perDay * 2 / need) * 100 }, { t: now, level: 264, pct: 50 }];
  const c = char();
  const o = L.levelOutlook(DATA, { level: { c: { log } } }, c, now);
  const gate = o.gates[0];
  assert.equal(gate.level, 265);
  assert.ok(Math.abs(gate.days - 5.1) < 0.01, `5.1 days, got ${gate.days}`);

  Date.now = () => now;
  try {
    setState({ level: { c: { log } } });
    let el = await show(ProgressPage);
    assert.match(flat(el), /Lv\. 265.{0,80}1 Dec 2026 5 days/);
    assert.doesNotMatch(flat(el), /1 Dec 2026 6 days/);
    close(el);
    el = await show(TodayPage);
    const tile = el.findAll((n) => n.attrs && n.attrs.class === 'tile').find((n) => /Next gate/.test(n.text));
    assert.match(tile.text.replace(/\s+/g, ' '), /Next gate · Lv\. 265\s*5 days\s*1 Dec 2026/);
    close(el);

    // A gate later the same Korean day says "today"; one after midnight says "tomorrow".
    for (const [hours, word] of [[3, '26 Nov 2026 today'], [10, '27 Nov 2026 tomorrow']]) {
      // At 95% now, with the last 5% taking `hours` at the rate of the six hours before.
      const quick = [{ t: now - 6 * HOUR, level: 264, pct: 95 - 5 * 6 / hours }, { t: now, level: 264, pct: 95 }];
      setState({ level: { c: { log: quick } } });
      el = await show(ProgressPage);
      assert.ok(flat(el).includes(word), `${word}: ${(flat(el).match(/Lv[.] 265 .{0,90}/) || [''])[0]}`);
      close(el);
    }
  } finally { Date.now = realNow; }
});

// ---------- 25: Brilliant Boss items ----------
test('item picker: Brilliant Boss set items land on the Brilliant boss rung, not the starter one', async () => {
  const gear = DATA.gear;
  const slotFor = { Ring: 'ring1', Pendant: 'pendant1', Face: 'face', Eye: 'eye' };
  const brilliant = DATA.pitched.sets.find((s) => s.id === 'brilliant').items;
  let checked = 0;
  for (const item of brilliant) {
    const slot = gear.slots.find((s) => s.id === slotFor[item.slot]) || gear.slots.find((s) => s.name.toLowerCase().startsWith(String(item.slot).toLowerCase()));
    if (!slot) continue; // a slot the tracker has no place for (Medal)
    const tiers = gear.slotTypes[slot.type];
    const tier = I.tierFromName(item.name, tiers, gear.tierHints);
    assert.ok(tier > 0, `${item.name} has a tier`);
    assert.match(tiers[tier - 1], /Brilliant boss/, item.name);
    // The slot is not marked "replace this" against the Endgame target.
    const g = { preset: 'end', slots: { [slot.id]: { tier, note: item.name, ilvl: 250 } } };
    const row = G.gearSummary(gear, g).slots.find((r) => r.slot.id === slot.id);
    assert.ok(tier >= row.target.tier, `${item.name} meets the Endgame tier`);
    checked++;
  }
  assert.ok(checked >= 5, 'the ring, pendant, face and eye items were checked');
  // Names the hints already knew still map to the same rungs.
  const acc = gear.slotTypes.accessory;
  assert.match(acc[I.tierFromName('Source of Suffering', acc, gear.tierHints) - 1], /Pitched/);
  assert.match(acc[I.tierFromName('Superior Gollux Pendant', acc, gear.tierHints) - 1], /Superior Gollux/);
  assert.equal(I.tierFromName('Some Unknown Ring', gear.slotTypes.ring, gear.tierHints), 0);

  // Through the picker: an empty Ring 1 on the Endgame target.
  setState({ gear: { c: { preset: 'end', slots: {}, history: [] } } });
  const el = await show(GearPage);
  el.find((n) => n.localName === 'button' && n.attrs['aria-label'] === 'Ring 1: edit').fire('click');
  await tick(20);
  const dialog = () => el.find((n) => n.attrs.role === 'dialog');
  const box = dialog().find((n) => n.attrs['aria-label'] === 'Item name');
  box.fire('focus');
  box.value = 'Whisper of the Source';
  box.fire('input', { currentTarget: box });
  assert.ok(await until(() => dialog().find((n) => n.attrs.role === 'option')), 'the item list has it');
  dialog().find((n) => n.attrs.role === 'option').fire('mousedown');
  await tick(5);
  const saved = store.getState().gear.c.slots.ring1;
  assert.equal(saved.note, 'Whisper of the Source');
  assert.match(gear.slotTypes.ring[saved.tier - 1], /Brilliant boss/);
  assert.doesNotMatch(flat(dialog()), /replace this one rather than spending on it/);
  assert.doesNotMatch(flat(dialog()), /Could not tell the tier/);
  close(el);
});

// ---------- 26: a Bottom left under an overall ----------
test('gear totals: a Bottom left under an overall adds no lines, flame or set piece', async () => {
  const str = (value) => ({ pid: 1, prime: true, text: `STR +${value}%`, type: 'main', stat: 'STR', value });
  const slots = (withBottom) => ({
    top: { tier: 2, note: 'Arcane Umbra Knight Suit', ilvl: 200, overall: true, pot: 4, potLines: [str(13)], flame: { main: 100 } },
    hat: { tier: 4, note: 'Arcane Umbra Knight Hat', ilvl: 200 },
    shoes: { tier: 3, note: 'Arcane Umbra Knight Shoes', ilvl: 200 },
    ...(withBottom ? { bottom: { tier: 2, note: 'Arcane Umbra Knight Pants', ilvl: 200, pot: 4, potLines: [str(13), str(10)], flame: { main: 150, allstat: 6 } } } : {})
  });
  const totalsText = async (withBottom, overall = true) => {
    const s = slots(withBottom);
    if (!overall) delete s.top.overall;
    setState({ gear: { c: { preset: 'mid', slots: s, history: [] } } });
    const el = await show(GearPage);
    const text = flat(el);
    const out = {
      main: (text.match(/STR % from potential (\d+)%/) || [])[1],
      lines: (text.match(/(\d+) damage lines?/) || [])[1],
      flames: (text.match(/Flames · (\d+) items?/) || [])[1],
      flameMain: (text.match(/Flames · \d+ items?.{0,40}?STR \+(\d+)/) || [])[1],
      set: (text.match(/Arcane Umbra Set ?(\d+) \/ \d+ pieces/) || [])[1],
      allStat: /All Stats \+6%/.test(text)
    };
    close(el);
    return out;
  };
  const without = await totalsText(false);
  assert.deepEqual(without, { main: '13', lines: '1', flames: '1', flameMain: '100', set: '3', allStat: false });
  assert.deepEqual(await totalsText(true), without, 'the leftover Bottom changes nothing');
  // With the overall mark off, the Bottom is worn and counts again: nothing was deleted.
  assert.deepEqual(await totalsText(true, false), { main: '36', lines: '3', flames: '2', flameMain: '250', set: '4', allStat: true });

  // The Bottom's own window says so.
  setState({ gear: { c: { preset: 'mid', slots: slots(true), history: [] } } });
  const el = await show(GearPage);
  el.find((n) => n.localName === 'button' && n.attrs['aria-label'] === 'Bottom: edit').fire('click');
  await tick(20);
  assert.match(flat(el.find((n) => n.attrs.role === 'dialog')), /its potential lines, flame and set piece are left out of the totals/);
  assert.equal(store.getState().gear.c.slots.bottom.potLines.length, 2, 'the saved Bottom is kept');
  close(el);

  // The calc functions still count whatever slots they are given (other callers pass the full list).
  const g = { slots: slots(true) };
  assert.equal(U.lineTotals(DATA.gear.slots, g, 'STR').main, 36);
  assert.equal(GS.flameTotals(DATA.gear.slots, g).items, 2);
  assert.deepEqual(A.upgradeOptions(DATA.gear, { preset: 'mid', ...g }, DATA.upgrades).filter((o) => o.slotId === 'bottom'), []);
});
