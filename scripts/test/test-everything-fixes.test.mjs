// Regression tests for the findings of the 25 Nov 2026 "test everything" run. Each test names what it guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeStates, units, changedPaths } from '../../site/app/calc/merge.js';
import { sanitiseState } from '../../site/app/calc/sanitise.js';
import { computeIncome, fmtMesos, crystalWeekStart } from '../../site/app/calc/income.js';
import { starPlan, starSpread } from '../../site/app/calc/starforce.js';
import { cubePlan, lineKind, usefulLines, lineTotals, mainStatOnClassChange, mainStatForClass } from '../../site/app/calc/upgrades.js';
import { lineChoices } from '../../site/app/calc/potential.js';
import { withCubeRates, slotOutlook, affordableAt } from '../../site/app/calc/advice.js';
import { erdaNextSteps, erdaTemplateFor } from '../../site/app/calc/progress.js';
import { suggestBosses, fmtCp } from '../../site/app/calc/bosscp.js';
import { detectSets, starStats } from '../../site/app/calc/gearstats.js';
import { dedupeEvents } from '../../site/app/calc/events.js';
import { comingUp } from '../../site/app/calc/upcoming.js';
import { parsePost, findDateRanges, findLabeledRanges, wantsDetail } from '../lib/nexon-parse.mjs';
import { parseItemCell } from '../lib/shops.mjs';
import { slotOfItem } from '../lib/items.mjs';
import { buildCalendar } from '../lib/ics.mjs';

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const bosses = load('bosses');
const byId = Object.fromEntries(bosses.bosses.map((b) => [b.id, b]));
const up = load('upgrades');
const gear = load('gear');
const gearStats = load('gearstats');
const cpData = load('bosscp');
const DAY = 86400000;
const slot = (id) => gear.slots.find((s) => s.id === id);
const base = { v: 1, characters: [], checklist: { items: {}, resets: {}, flags: {}, history: {} }, bosses: {}, symbols: {}, liberation: {}, ibp: {}, erda: {}, gear: {}, level: {}, pitch: {}, shops: {}, champions: { slots: [], raid: {} }, mesos: { held: 0, goals: [] }, incomeHistory: {}, ui: {}, stamps: {}, updatedAt: 0 };
// A device's copy after an edit: every changed part stamped at `at`.
function edit(prev, at, fn) {
  const next = structuredClone(prev);
  fn(next);
  next.stamps = { ...(prev.stamps || {}) };
  for (const p of changedPaths(prev, next)) next.stamps[p] = at;
  next.updatedAt = at;
  return next;
}

test('Clear all data, then reconnecting Sync, downloads the synced copy instead of wiping it', () => {
  const synced = edit(base, 100, (s) => { s.characters.push({ id: 'c1', name: 'A' }); s.gear.c1 = { slots: { hat: { tier: 2 } } }; s.mesos.held = 5e9; s.mesos.goals.push({ id: 'g', name: 'Goal', cost: 1 }); });
  // What resetState leaves: a blank tracker with no change times at all.
  const cleared = { ...structuredClone(base), stamps: {}, updatedAt: 0 };
  for (const merged of [mergeStates(cleared, synced, 1000), mergeStates(synced, cleared, 1000)]) {
    assert.equal(merged.characters.length, 1);
    assert.equal(merged.gear.c1.slots.hat.tier, 2);
    assert.equal(merged.mesos.held, 5e9);
    assert.equal(merged.mesos.goals.length, 1);
  }
});

test('settings and the meso planner merge field by field; view choices stay on each device', () => {
  const start = edit(base, 100, (s) => { s.mesos.held = 1; s.ui.seasonDone = { a: true }; s.ui.mesosView = 'planner'; });
  const phone = edit(start, 300, (s) => { s.mesos.held = 123456789; s.ui.seasonDone.b = true; s.ui.hiddenEvents = { x: 1 }; s.ui.mesosView = 'cubes'; s.ui.lastSeenNews = 5; });
  const pc = edit(start, 200, (s) => { s.mesos.goals.push({ id: 'g1', name: 'Hat', cost: 9 }); s.ui.seasonDone.c = true; s.ui.mesosView = 'starforce'; });
  const m = mergeStates(pc, phone, 1000);
  assert.equal(m.mesos.held, 123456789);
  assert.deepEqual(m.mesos.goals.map((g) => g.id), ['g1']);
  assert.deepEqual(Object.keys(m.ui.seasonDone).sort(), ['a', 'b', 'c']);
  assert.deepEqual(m.ui.hiddenEvents, { x: 1 });
  assert.equal(m.ui.mesosView, 'starforce', 'the PC keeps its own tab');
  assert.equal(mergeStates(phone, pc, 1000).ui.mesosView, 'cubes');
  assert.ok(![...units(m).keys()].some((p) => /mesosView|lastSeenNews|^ui$|^mesos$/.test(p)));
  // A copy stamped before this change ("ui" and "mesos" as whole parts) still merges by those stamps.
  const old = { ...structuredClone(base), mesos: { held: 77, goals: [] }, ui: { seasonDone: { z: true } }, stamps: { mesos: 500, ui: 500 }, updatedAt: 500 };
  const m2 = mergeStates(start, old, 1000);
  assert.equal(m2.mesos.held, 77);
  assert.equal(m2.ui.seasonDone.z, true);
  assert.ok(m2.ui && m2.mesos, 'a whole-part stamp never deletes the part');
});

test('a character deleted on one device takes its data with it, whatever the other device edited', () => {
  const both = edit(base, 100, (s) => { s.characters.push({ id: 'k', name: 'K' }, { id: 'j', name: 'J' }); s.gear.k = { slots: {} }; s.bosses.k = { picks: {}, clears: {} }; s.pitch.k = { drops: [{ id: 'd', item: 'berserked', d: '2026-11-01' }] }; s.checklist.items['k|d-ursus'] = { p: 'x', d: 1 }; s.checklist.items['j|d-ursus'] = { p: 'x', d: 1 }; });
  const deleted = edit(both, 200, (s) => { s.characters = s.characters.filter((c) => c.id !== 'k'); delete s.gear.k; delete s.bosses.k; delete s.pitch.k; delete s.checklist.items['k|d-ursus']; });
  const edited = edit(both, 300, (s) => { s.gear.k.slots.hat = { tier: 3 }; s.checklist.items['k|d-ursus'].d = 0; s.pitch.k.drops.push({ id: 'e', item: 'dreamy-belt', d: '2026-11-02' }); });
  for (const m of [mergeStates(deleted, edited, 1000), mergeStates(edited, deleted, 1000)]) {
    assert.deepEqual(m.characters.map((c) => c.id), ['j']);
    assert.equal(m.gear.k, undefined);
    assert.equal(m.pitch.k, undefined);
    assert.deepEqual(Object.keys(m.checklist.items), ['j|d-ursus']);
  }
});

test('follow-ups: goals from two devices, a character edited after another device deleted it, an old tab', () => {
  // Goals added on two devices before syncing are both kept, in a sensible order.
  const start = edit(base, 100, (s) => { s.mesos.goals.push({ id: 'g0', name: 'First', cost: 1 }); });
  const phone = edit(start, 300, (s) => { s.mesos.goals.push({ id: 'gp', name: 'Phone', cost: 2 }); });
  const pc = edit(start, 200, (s) => { s.mesos.goals.push({ id: 'gc', name: 'PC', cost: 3 }); });
  for (const m of [mergeStates(pc, phone, 1000), mergeStates(phone, pc, 1000)]) assert.deepEqual(m.mesos.goals.map((g) => g.id).sort(), ['g0', 'gc', 'gp']);
  const reordered = edit(start, 400, (s) => { s.mesos.goals.push({ id: 'g1', name: 'Second', cost: 1 }); });
  const swapped = edit(reordered, 500, (s) => { s.mesos.goals.reverse(); });
  assert.deepEqual(mergeStates(reordered, swapped, 1000).mesos.goals.map((g) => g.id), ['g1', 'g0']);
  const removed = edit(reordered, 600, (s) => { s.mesos.goals = s.mesos.goals.filter((g) => g.id !== 'g0'); });
  assert.deepEqual(mergeStates(reordered, removed, 1000).mesos.goals.map((g) => g.id), ['g1']);
  // Deleted on A, then the character itself edited on B: it comes back with all of its data, and stays so.
  const both = edit(base, 100, (s) => { s.characters.push({ id: 'alt', name: 'Alt', level: 220 }); s.gear.alt = { slots: { hat: { tier: 2 } } }; s.pitch.alt = { drops: [{ id: 'd1', item: 'berserked', d: '2026-11-01' }] }; s.checklist.items['alt|d-ursus'] = { p: 'x', d: 1 }; });
  const gone = edit(both, 200, (s) => { s.characters = []; delete s.gear.alt; delete s.pitch.alt; delete s.checklist.items['alt|d-ursus']; });
  const leveled = edit(both, 300, (s) => { s.characters[0].level = 221; });
  for (const m of [mergeStates(gone, leveled, 1000), mergeStates(leveled, gone, 1000)]) {
    assert.equal(m.characters[0].level, 221);
    assert.equal(m.gear.alt.slots.hat.tier, 2);
    assert.equal(m.pitch.alt.drops.length, 1);
    assert.ok(m.checklist.items['alt|d-ursus']);
    // The device that deleted it pulls this and keeps it.
    const again = mergeStates(gone, m, 1000);
    assert.equal(again.gear.alt.slots.hat.tier, 2);
  }
});

test('ids containing "/" survive a merge for drops and shop picks', () => {
  const a = edit(base, 100, (s) => { s.characters.push({ id: 'a/b', name: 'Slash' }); s.pitch['a/b'] = { drops: [{ id: 'x/y', item: 'berserked', d: '2026-11-01' }] }; s.shops['shop/1'] = { have: 5, claims: 0, want: { 'item/2': 3 } }; });
  const m = mergeStates(structuredClone(base), a, 1000);
  assert.deepEqual(m.pitch['a/b'].drops.map((d) => d.id), ['x/y']);
  assert.deepEqual(m.shops['shop/1'], { have: 5, claims: 0, want: { 'item/2': 3 } });
});

test('a monthly crystal is earned in the week it was cleared, not every week of the month', () => {
  const char = { id: 'c', world: 'heroic', region: 'na' };
  const clearedAt = Date.parse('2026-12-04T10:00:00Z'); // a Friday: crystal week of Thu 3 Dec
  const state = { bosses: { c: { picks: { 'black-mage-extreme': { party: 1 } }, clears: { 'black-mage-extreme': { 'monthly:2026-12': clearedAt } } } } };
  const value = 5 * byId['black-mage-extreme'].price;
  const weekOf = (iso) => computeIncome([char], state, bosses, byId, Date.parse(iso)).perChar.c;
  assert.equal(weekOf('2026-12-05T00:00:00Z').earned, value);
  assert.equal(weekOf('2026-12-11T00:00:00Z').earned, 0);
  assert.equal(weekOf('2026-12-18T00:00:00Z').earned, 0);
  // Planned as its average weekly share, never the full crystal every week.
  const planned = weekOf('2026-12-11T00:00:00Z').planned;
  assert.ok(planned > 0 && planned < value / 4, `${planned}`);
  // An old mark (true, no time) still counts once, in the current week.
  const old = { bosses: { c: { picks: { 'black-mage-extreme': {} }, clears: { 'black-mage-extreme': { 'monthly:2026-12': true } } } } };
  assert.equal(computeIncome([char], old, bosses, byId, Date.parse('2026-12-11T00:00:00Z')).perChar.c.earned, value);
  assert.equal(crystalWeekStart(clearedAt), Date.parse('2026-12-03T00:00:00Z'));
});

test('Star Force to 29 and 30 stars is solved exactly', () => {
  const p = starPlan(up.starforce, 160, 22, 30);
  assert.ok(Math.abs(p.cost / 1.4486e15 - 1) < 1e-3, `${p.cost}`);
  // The plan satisfies its own equation at every star: cost = (attempt + success*next + boom*restore) / (success + boom).
  const q = starPlan(up.starforce, 200, 17, 25, { discount: true, lessBoom: true }, 1e9);
  assert.ok(q.cost > 0 && Number.isFinite(q.cost) && q.booms > 0 && q.attempts > 0);
  // Small ranges agree with simulation.
  const s = starPlan(up.starforce, 160, 12, 17);
  const sim = starSpread(up.starforce, 160, 12, 17, {}, 0, 6000);
  assert.ok(sim.p50 <= s.cost * 1.2 && sim.p90 >= s.cost * 0.8);
});

test('magicians count Magic ATT lines and not Weapon ATT lines', () => {
  const pot = load('potential');
  const w = slot('weapon');
  assert.equal(lineKind(w, { type: 'matt' }, 'INT'), 'damage');
  assert.equal(lineKind(w, { type: 'att' }, 'INT'), 'other');
  assert.equal(lineKind(w, { type: 'att' }, 'STR'), 'damage');
  assert.equal(lineKind(w, { type: 'matt' }, 'STR'), 'other');
  const entry = { potLines: [{ type: 'matt', value: 13 }, { type: 'matt', value: 10 }, { type: 'att', value: 13 }] };
  assert.equal(usefulLines(w, entry, 'INT'), 2);
  assert.equal(usefulLines(w, entry, 'LUK'), 1);
  assert.equal(lineTotals(gear.slots, { slots: { weapon: { tier: 3, ...entry } } }, 'INT').att, 23);
  const choices = lineChoices(pot, 'weapon', 4, 200, 'INT');
  assert.ok(choices.some((c) => /Magic ATT/.test(c.text) && c.useful));
  assert.ok(!choices.some((c) => /^Weapon ATT/.test(c.text) && c.useful));
});

test('cube odds typed on Mesos are used for gear costs too', () => {
  const rates = { bright: [0.17, 0.11, 0.01] };
  const hat = { tier: 2, ilvl: 150, pot: 3 };
  const target = { pot: 4 };
  const plain = slotOutlook(slot('hat'), hat, target, up).cube.bright.cost;
  const edited = slotOutlook(slot('hat'), hat, target, withCubeRates(up, rates)).cube.bright.cost;
  assert.ok(edited > plain * 4);
  assert.equal(withCubeRates(up, null), up);
  assert.equal(withCubeRates(up, { nope: [1, 1, 1] }).cubes.types.bright, up.cubes.types.bright);
});

test('the 6th job planner never counts the same levels twice', () => {
  const erda = load('erda');
  const tpl = erda.templates[erdaTemplateFor(erda, { cls: 'Hero' }, {})];
  const steps = erdaNextSteps(tpl, { levels: {} }, 12);
  const byNode = {};
  for (const st of steps.filter((x) => x.node)) {
    if (byNode[st.node] !== undefined) assert.equal(st.from, byNode[st.node], `${st.label} starts where the last ended`);
    byNode[st.node] = st.to;
  }
  assert.ok(Object.keys(byNode).length > 0);
});

test('Combat Power suggestions: Quanah ranks by value it would have, kept picks are respected', () => {
  const quanah = suggestBosses(bosses, cpData, 45e6, 1, { world: 'heroic', quanah: true });
  const normal = suggestBosses(bosses, cpData, 45e6, 1, { world: 'heroic' });
  assert.deepEqual(quanah.ids, normal.ids);
  assert.equal(quanah.total, 0);
  const keep = [byId['lotus-hard'], byId['kai-normal'], byId['mayrin-normal']];
  const s = suggestBosses(bosses, cpData, 45e6, 1, { world: 'heroic' }, keep);
  assert.ok(!s.ids.some((id) => byId[id].boss === 'Lotus'));
  assert.equal(s.ids.length, bosses.limits.weeklyPerCharacter - 1, 'the kept Lotus crystal takes one place; Kai and Mayrin pay none');
  // Fourteen cheap party picks: each sells for little, so the bosses within reach still fill the list.
  const cheap = bosses.bosses.filter((b) => b.reset === 'weekly' && !b.noCrystal && b.price > 0).slice(0, 14).map((b) => ({ ...b, party: 6 }));
  const t = suggestBosses(bosses, cpData, 45e6, 1, { world: 'heroic' }, cheap);
  assert.ok(t.ids.length > 0, 'not "No boss within reach yet"');
  assert.ok(t.ids.length + cheap.length >= bosses.limits.weeklyPerCharacter);
});

test('large numbers switch unit after rounding', () => {
  assert.equal(fmtMesos(999999), '1M');
  assert.equal(fmtMesos(999999999), '1B');
  assert.equal(fmtMesos(999499), '999K');
  assert.equal(fmtCp(999999), '1M');
  assert.equal(fmtCp(999999999), '1B');
});

test('far-off dates and damaged calculator settings', () => {
  assert.equal(affordableAt(1e15, 0, 1, Date.now()), Infinity, 'too far away: not the same as no income');
  assert.equal(affordableAt(1e9, 0, 0, Date.now()), null);
  assert.ok(affordableAt(1e9, 0, 1e9, 0) === 7 * DAY);
  const s = sanitiseState({ ui: { sfCalc: { level: 'x', from: 2.5, to: 99, mvp: 'platinum', spare: -1, discount: 1 }, cubeCalc: { from: 9, to: 0 }, flameCalc: { level: 160, weights: { att: 'x', allstat: 12 }, secondary: 'HP', have: null }, bossMargin: 7 } }, base);
  assert.deepEqual(s.ui.sfCalc, { from: 2, discount: false });
  assert.deepEqual(s.ui.cubeCalc, {});
  assert.deepEqual(s.ui.flameCalc, { level: 160, weights: { allstat: 12 }, have: null });
  assert.equal('bossMargin' in s.ui, false);
  assert.deepEqual(cubePlan(up.cubes.types.bright, 9, 99).legs, []);
});

test('set effects ignore lookalike names and accept the plain pitched names', () => {
  const g = { slots: {
    hat: { tier: 2, note: 'Royal Von Leon Helmet', ilvl: 130 },
    top: { tier: 2, note: 'Eagle Eye Warrior Armor', ilvl: 150 },
    ring1: { tier: 2, note: 'Eternal Flame Ring', ilvl: 120 },
    emblem: { tier: 2, note: "Mitra's Rage" },
    pocket: { tier: 2, note: 'Cursed Spellbook' },
    face: { tier: 3, note: 'Berserked', ilvl: 160 }
  } };
  const sets = detectSets(gearStats.sets, gear.slots, g);
  const of = (id) => (sets.find((s) => s.id === id) || {}).worn || 0;
  assert.equal(of('cra'), 1);
  assert.equal(of('eternal'), 0);
  assert.equal(of('pitchedBoss'), 3);
});

test('Lv. 250 weapon star gains are marked as a lower bound', () => {
  assert.equal(starStats(gearStats.starforce, slot('weapon'), 250, 22, 17).partial, true);
  assert.equal(starStats(gearStats.starforce, slot('hat'), 250, 22, 17).partial, false);
});

test('a sale whose end a later post corrected is listed once, with the newer end', () => {
  const ev = (postId, end, liveDate) => ({ id: `${postId}-genesis-passes`, title: 'Genesis Passes', start: '2026-11-12T00:00:00.000Z', end, postId, postName: `p${postId}`, liveDate, category: 'sale' });
  const out = dedupeEvents([ev(1, '2027-02-08T23:59:00.000Z', '2026-11-10T00:00:00Z'), ev(2, '2027-02-15T23:59:00.000Z', '2026-11-12T00:00:00Z')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].end, '2027-02-15T23:59:00.000Z');
  assert.deepEqual(out[0].alsoIn.map((p) => p.postId), [1]);
  // Different starts are different runs and stay apart.
  assert.equal(dedupeEvents([ev(1, '2027-02-08T23:59:00.000Z', 'a'), { ...ev(2, '2027-02-15T23:59:00.000Z', 'b'), start: '2026-12-01T00:00:00.000Z' }]).length, 2);
});

test('day-only announcements follow the Korean calendar day', () => {
  const list = { items: [{ id: 'p', at: '2026-12-16T00:00:00Z', day: true, title: 'Patch', note: 'x' }] };
  const at = (iso) => comingUp(list, Date.parse(iso), null, 5);
  assert.equal(at('2026-12-15T16:00:00Z')[0].days, 0, '01:00 KST on 16 Dec: today');
  assert.equal(at('2026-12-15T14:00:00Z')[0].days, 1, '23:00 KST on 15 Dec: tomorrow');
  assert.equal(at('2026-12-16T14:59:00Z')[0].days, 0, '23:59 KST on 16 Dec: still today');
  // Nexon's day runs to 09:00 KST the next morning (maintenance ends then), so the entry stays until that.
  assert.equal(at('2026-12-16T15:01:00Z')[0].late, true, '00:01 KST on 17 Dec: still listed, the patch has not landed');
  assert.deepEqual(at('2026-12-17T00:00:00Z'), [], '09:00 KST on 17 Dec: gone');
});

test('the job parser: maintenance titles, year-less end dates, "(End of Maintenance)", zone labels, Sunny Sunday, long headings', () => {
  const now = Date.parse('2026-11-25T00:00:00Z');
  const post = (name, category = 'maintenance') => ({ name, category, liveDate: '2026-11-23T00:00:00Z' });
  assert.equal(wantsDetail(post('Scheduled Maintenance - November 24, 2026'), now), true);
  assert.equal(wantsDetail(post('Scheduled Minor Patch - November 26, 2026'), now), true);
  assert.equal(wantsDetail(post('[Completed] Scheduled Maintenance - November 24, 2026'), now), true);
  assert.equal(wantsDetail(post('[Updated 11/24] Unscheduled Maintenance'), now), true);
  assert.equal(wantsDetail(post('Known Issues Notice'), now), false);
  const [r] = findDateRanges('Countdown Gifts: October 7, 2026 12:00 AM UTC - November 10 11:59 PM UTC');
  assert.equal(new Date(r.start).toISOString(), '2026-10-07T00:00:00.000Z');
  assert.equal(new Date(r.end).toISOString(), '2026-11-10T23:59:00.000Z');
  const [y] = findDateRanges('December 20, 2026 - January 5 11:59 PM UTC');
  assert.equal(new Date(y.end).toISOString(), '2027-01-05T23:59:00.000Z');
  const [m] = findDateRanges('UTC: Wednesday, November 11, 2026 (End of Maintenance) - Wednesday, May 26, 2027 7:59 AM');
  assert.equal(m.afterMaintenance, true);
  assert.equal(new Date(m.end).toISOString(), '2027-05-26T07:59:00.000Z');
  const [l] = findLabeledRanges('UTC: Wednesday, November 11 (End of Maintenance) - Wednesday, December 9 7:59 AM', '2026-11-10T00:00:00Z');
  assert.equal(new Date(l.end).toISOString(), '2026-12-09T07:59:00.000Z');
  const [pst] = findDateRanges('PST: Thursday, November 12, 2026 12:00 AM - Monday, February 15, 2027 11:59 PM');
  assert.equal(new Date(pst.start).toISOString(), '2026-11-12T08:00:00.000Z');
  const body = `<h2>Sunny Sunday</h2><p>Can be claimed until November 29, 2026 at 11:59 PM UTC.</p>
    <h2>${'A very long event heading that goes on and on for quite a while, part one'}</h2><p>December 1, 2026 12:00 AM UTC - December 8, 2026 11:59 PM UTC</p>
    <h2>${'A very long event heading that goes on and on for quite a while, part two'}</h2><p>December 9, 2026 12:00 AM UTC - December 15, 2026 11:59 PM UTC</p>`;
  const events = parsePost({ id: 5, name: 'Post', category: 'update', liveDate: '2026-11-20T00:00:00Z' }, body);
  assert.ok(!events.some((e) => /sunny/i.test(e.title)));
  assert.equal(events.length, 2);
  assert.notEqual(events[0].id, events[1].id);
});

test('shop names with their own colon, every emblem id, and a calendar that drops ended reset wording', () => {
  assert.equal(parseItemCell('<strong>Heart Upgrade Module: Plasma</strong>: Untradable.').name, 'Heart Upgrade Module: Plasma');
  assert.equal(parseItemCell('<strong>(Heroic Worlds)</strong> <strong>Black Rebirth Flame:</strong> x').name, 'Black Rebirth Flame');
  assert.equal(parseItemCell('Plain Item: no bold').name, 'Plain Item');
  assert.equal(slotOfItem(1190555), 'emblem');
  assert.equal(slotOfItem(1190100), 'emblem');
  assert.equal(slotOfItem(1200000), null);
  const before = buildCalendar([], Date.parse('2026-11-25T00:00:00Z'));
  const after = buildCalendar([], Date.parse('2027-03-01T00:00:00Z'));
  assert.match(before, /Specter Blast/);
  assert.doesNotMatch(after, /Specter Blast|Challenger|Item Burning/);
  assert.match(after, /Weekly reset: bosses\\, crystals/);
});

test('second round: month-end Black Mage, Demon Avenger lines, stat names, lookalike tiers, numbers', async () => {
  // A Black Mage clear on Fri 27 Nov still counts in that crystal week (Thu 26 Nov to Wed 2 Dec) on 1 Dec.
  const char = { id: 'c', world: 'heroic', region: 'na' };
  const st = { bosses: { c: { picks: { 'black-mage-extreme': {} }, clears: { 'black-mage-extreme': { 'monthly:2026-11': Date.parse('2026-11-27T10:00:00Z') } } } } };
  assert.equal(computeIncome([char], st, bosses, byId, Date.parse('2026-12-01T12:00:00Z')).perChar.c.earned, 5 * byId['black-mage-extreme'].price);
  assert.equal(computeIncome([char], st, bosses, byId, Date.parse('2026-12-04T12:00:00Z')).perChar.c.earned, 0);
  // Demon Avenger: Magic ATT is not offered as useful.
  const pot = load('potential');
  assert.ok(!lineChoices(pot, 'weapon', 4, 200, 'HP').some((c) => /Magic ATT/.test(c.text) && c.useful));
  // A reclassified hand line keeps its stat in the label.
  const { lineLabel } = await import('../../site/app/calc/upgrades.js');
  assert.equal(lineLabel({ type: 'offstat', stat: 'STR', value: 13 }, 'DEX'), 'STR +13%');
  assert.equal(lineLabel({ type: 'offstat', value: 13 }, 'DEX'), 'Other stat +13%');
  // Lookalike names don't pre-select a tier.
  const { tierFromName } = await import('../../site/app/calc/items.js');
  const hatTiers = gear.slotTypes.hat.filter(Boolean);
  assert.equal(tierFromName('Royal Von Leon Helmet', hatTiers, gear.tierHints), 0);
  assert.ok(tierFromName('Royal Warrior Helm', hatTiers, gear.tierHints) > 0);
  // Numbers just under 1K, and comma decimals.
  const { fmtBig, parseMesos } = await import('../../site/app/ui.js');
  assert.equal(fmtBig(999.6), '1K');
  assert.equal(fmtBig(999.4), '999');
  assert.equal(fmtMesos(999.6), '1K');
  assert.equal(parseMesos('3,2b'), 3.2e9);
  assert.equal(parseMesos('45,5m'), 45.5e6);
  assert.equal(parseMesos('2,000,000'), 2e6);
  assert.equal(parseMesos('1,2,3'), null);
});

test('second round: parser zones, year-less dates in sentences, same-post offers, shop names that run on', () => {
  // A PDT line followed by a UTC line: the UTC label belongs to the next range, not to the first one's end.
  const two = findDateRanges('PDT: October 13, 2026 6:00 PM - October 27, 2026 5:59 PM\nUTC: October 14, 2026 1:00 AM - October 28, 2026 12:59 AM');
  assert.equal(new Date(two[0].end).toISOString(), '2026-10-28T00:59:00.000Z');
  assert.equal(new Date(two[1].start).toISOString(), '2026-10-14T01:00:00.000Z');
  // Maintenance times keep their zone with the "(UTC -8)" note after it.
  const [m] = findDateRanges('November 25, 2026 4:00 AM PST (UTC -8) - November 25, 2026 9:00 AM PST (UTC -8)');
  assert.equal(new Date(m.start).toISOString(), '2026-11-25T12:00:00.000Z');
  // A month word inside a sentence is not an end date, and impossible days are not dates.
  assert.equal(findDateRanges('Event: November 11, 2026 12:00 AM UTC - may 3 times a day').length, 0);
  assert.equal(findDateRanges('November 11, 2026 - November 31 11:59 PM UTC').length, 0);
  // Two offers of one post with the same title and start but different ends stay apart.
  const offer = (end) => ({ id: `9-pass-${end}`, title: 'Premium Pass', start: '2026-11-12T00:00:00.000Z', end, postId: 9, postName: 'p', liveDate: 'x', category: 'sale' });
  assert.equal(dedupeEvents([offer('2026-11-26T00:00:00.000Z'), offer('2027-02-09T23:59:00.000Z')]).length, 2);
  // A bold that runs on into the description gives just the name.
  assert.equal(parseItemCell('<strong>Karma Bright Cube: Tradable within world,</strong> expires <strong>February 10, 2027</strong>.').name, 'Karma Bright Cube');
  assert.equal(parseItemCell('<strong>Heart Upgrade Module: Plasma</strong>: Untradable.').name, 'Heart Upgrade Module: Plasma');
});

test('third round: section windows, event merging, Beyond Burning runs, tier hints, kept picks', async () => {
  // A section whose first range has a year-less end keeps the fully dated window it was read with before.
  const ev = parsePost({ id: 45393, name: 'Winter Countdown', category: 'events', liveDate: '2026-10-07T00:00:00Z' },
    '<h2>Winter Countdown Event</h2><p>Countdown Gifts: October 7, 2026 12:00 AM UTC - November 10 11:59 PM UTC</p><p>Winter Gifts: November 11, 2026 (after maintenance) - November 24, 2026 11:59 PM UTC</p>');
  assert.equal(ev[0].end, '2026-11-24T23:59:00.000Z');
  // A section with only a year-less range still gets it.
  const only = parsePost({ id: 1, name: 'P', category: 'events', liveDate: '2026-10-07T00:00:00Z' }, '<h2>Gifts</h2><p>October 7, 2026 12:00 AM UTC - November 10 11:59 PM UTC</p>');
  assert.equal(only[0].end, '2026-11-10T23:59:00.000Z');
  // Event merging: two sections of one post stay apart in any order; a post giving a start merges with one that gave none.
  const e = (postId, start, end, liveDate) => ({ id: `${postId}-${end}`, title: 'Premium Pass', start, end, postId, postName: `p${postId}`, liveDate, category: 'events' });
  const a1 = e(1, '2026-11-11T00:00:00.000Z', '2026-11-25T00:00:00.000Z', '2026-11-01T00:00:00Z');
  const a2 = e(1, '2026-11-11T00:00:00.000Z', '2027-02-09T23:59:00.000Z', '2026-11-01T00:00:00Z');
  const b = e(2, '2026-11-11T00:00:00.000Z', '2027-02-09T23:59:00.000Z', '2026-11-10T00:00:00Z');
  for (const order of [[a1, b, a2], [b, a1, a2], [a2, a1, b]]) {
    const out = dedupeEvents(order.map((x) => ({ ...x })));
    assert.ok(out.some((x) => x.end === '2026-11-25T00:00:00.000Z'), 'the 2-week offer stays');
    assert.ok(out.some((x) => x.end === '2027-02-09T23:59:00.000Z'), 'the season offer stays');
  }
  const noStart = dedupeEvents([{ ...e(3, null, '2027-02-09T23:59:00.000Z', '2026-11-05T00:00:00Z'), title: 'Challenger EXP and Premium Passes' }, { ...e(4, '2026-11-11T00:00:00.000Z', '2027-02-09T23:59:00.000Z', '2026-11-12T00:00:00Z'), title: 'Challenger EXP and Premium Passes' }]);
  assert.equal(noStart.length, 1);
  assert.equal(noStart[0].postId, 4);
  // Beyond Burning: the run on now, else the latest one.
  const { beyondBurningEnd } = await import('../../site/app/pages/level.js');
  const data = { events: { events: [{ title: 'Beyond Burning', start: '2026-11-11T00:00:00Z', end: '2027-02-09T23:59:00Z' }, { title: 'Beyond Burning', start: '2027-03-17T00:00:00Z', end: '2027-07-20T23:59:00Z' }] } };
  assert.equal(beyondBurningEnd(data, Date.parse('2026-12-01T00:00:00Z')), Date.parse('2027-02-09T23:59:00Z'));
  assert.equal(beyondBurningEnd(data, Date.parse('2027-04-01T00:00:00Z')), Date.parse('2027-07-20T23:59:00Z'));
  // Lionheart Painful Destiny is not a Destiny weapon.
  const { tierFromName } = await import('../../site/app/calc/items.js');
  assert.equal(tierFromName('Lionheart Painful Destiny', gear.slotTypes.weapon.filter(Boolean), gear.tierHints), 0);
  assert.ok(tierFromName('Destiny Hero Two-handed Sword', gear.slotTypes.weapon.filter(Boolean), gear.tierHints) > 0);
  // Kept picks that fill every crystal: the suggestion is empty, but bosses are within reach.
  // (One difficulty per boss: two kept difficulties of one boss share a clear and take one place.)
  const priciest = bosses.bosses.filter((x) => x.reset === 'weekly' && !x.noCrystal).sort((x, y) => y.price - x.price)
    .filter((x, i, all) => all.findIndex((o) => o.boss === x.boss) === i).slice(0, 14).map((x) => ({ ...x, party: 1 }));
  const s = suggestBosses(bosses, cpData, 5e6, 1, { world: 'heroic' }, priciest);
  assert.equal(s.ids.length, 0);
  assert.ok(s.reachable > 0);
});

test('picking a class sets its main stat from the class list', () => {
  const classes = load('classes').mainStat;
  assert.deepEqual(mainStatOnClassChange('', 'Bishop', 'STR', classes), { mainStat: 'INT' });
  assert.deepEqual(mainStatOnClassChange('', 'mo xuan', 'STR', classes), { mainStat: 'DEX' });
  assert.deepEqual(mainStatOnClassChange('', 'Night Lord', 'STR', classes), { mainStat: 'LUK' });
  assert.deepEqual(mainStatOnClassChange('', 'Demon Avenger', 'STR', classes), { mainStat: 'HP' });
  assert.deepEqual(mainStatOnClassChange('Xenon', 'Somebody New', 'XENON', classes), { mainStat: 'STR' });
  assert.deepEqual(mainStatOnClassChange('Hero', 'Somebody New', 'DEX', classes), {});
  assert.equal(mainStatForClass('Erel Light', classes), 'STR');
  for (const v of Object.values(classes)) assert.ok(['STR', 'DEX', 'INT', 'LUK', 'HP', 'XENON'].includes(v));
});
