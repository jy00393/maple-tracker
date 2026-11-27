// Where the feat8 branches meet (tiers, daily, season, chance were built apart): Challenger mission ticks go
// through the Undo bar, the Arcane Seal advice hides behind an (i) on phones like other row notes, and the
// folded season line names what expires soon. Every test passes its own time and waits on a condition.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeNode, installFakeBrowser, tick } from './lib/fake-dom.mjs';

installFakeBrowser({});
const { html, render, useEffect } = await import('../../site/vendor/htm-preact.mjs');
const store = await import('../../site/app/store.js');
const { undoLast, dismissUndo, undoTimes } = await import('../../site/app/undo.js');
const P = await import('../../site/app/pages/challenger.js');
const { Item, whoFor } = await import('../../site/app/pages/checklist.js');
const { expiringLine } = await import('../../site/app/pages/daily.js');

const load = (name) => JSON.parse(readFileSync(new URL(`../../site/data/${name}.json`, import.meta.url), 'utf8'));
const bosses = load('bosses');
const DATA = {
  bosses, bossById: Object.fromEntries(bosses.bosses.map((b) => [b.id, b])), symbols: load('symbols'), checklist: load('checklist'),
  erda: load('erda'), upgrades: load('upgrades'), season: load('season'), shops: { shops: [] }, bossCp: load('bosscp'),
  challenger: load('challenger'), etherion: load('etherion'), nexonCharacters: { characters: [] }
};
const NOW = Date.parse('2026-12-01T03:00:00Z');
const DAY = 86400000;
undoTimes.ms = 60000;

const mounted = new Set();
after(() => { for (const el of mounted) render(null, el); dismissUndo(); });
async function show(view) {
  let ready = false;
  const App = () => { const state = store.useStore(); useEffect(() => { ready = true; }, []); return view(state); };
  const el = new FakeNode('div');
  mounted.add(el);
  render(html`<${App} />`, el);
  for (const end = Date.now() + 5000; !ready && Date.now() < end;) await tick(5);
  await tick(5);
  return el;
}
async function until(fn) {
  for (const end = Date.now() + 5000; Date.now() < end;) { if (fn()) return true; await tick(5); }
  return fn();
}
const MAIN = { id: 'm', name: 'Main', cls: 'Erel Light', level: 264, region: 'na', world: 'heroic', challenger: true, mainStat: 'STR', cp: 30e6 };
function setUp() {
  store.resetState();
  store.update((s) => { s.characters = [structuredClone(MAIN)]; s.activeId = 'm'; });
}

test('a Challenger mission tick can be undone, and the undo takes back only that tick', async () => {
  setUp();
  const el = await show((state) => html`<${P.ChallengerView} data=${DATA} state=${state} char=${state.characters[0]} now=${NOW} />`);
  el.find((n) => n.attrs.id === 'cw-lucid-easy').fire('change', { currentTarget: { checked: true } });
  assert.ok(await until(() => (store.getState().challenger.m || {}).done && store.getState().challenger.m.done['lucid-easy'] > 0));
  const r = undoLast();
  assert.equal(r.undone > 0, true);
  assert.equal(Object.hasOwn(((store.getState().challenger || {}).m || {}).done || {}, 'lucid-easy'), false);
  render(null, el);
  mounted.delete(el);
});

test('the Arcane Seal advice sits behind an (i) on a phone and shows on a wide screen', async () => {
  setUp();
  const group = DATA.checklist.groups.find((g) => g.items.some((i) => i.id === 'd-seal'));
  const item = group.items.find((i) => i.id === 'd-seal');
  const draw = (state) => html`<${Item} item=${item} group=${group} cs=${state.checklist} now=${NOW} who=${{ ...whoFor(DATA, state, state.characters[0]), sealNote: () => 'Break them now: test advice.' }} />`;
  globalThis.window.matchMedia = (q) => ({ matches: /max-width:\s*760px/.test(q), addEventListener() {}, removeEventListener() {} });
  let el = await show(draw);
  assert.doesNotMatch(el.text, /test advice/);
  assert.ok(el.find((n) => n.localName === 'button' && /Arcane Seal|advice/.test(n.attrs['aria-label'] || '')), 'an (i) for the advice');
  render(null, el);
  mounted.delete(el);
  globalThis.window.matchMedia = (q) => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  el = await show(draw);
  assert.match(el.text, /test advice/);
  render(null, el);
  mounted.delete(el);
  globalThis.window.matchMedia = null;
});

test('the folded season line names the soonest thing that expires within 3 weeks, or nothing', () => {
  const state = { shops: {} };
  const first = Math.min(...DATA.season.expiring.map((e) => Date.parse(e.at)));
  const line = expiringLine(DATA, state, MAIN, 264, first - 5 * DAY);
  assert.match(line, /^Expiring soon: .+ on .+\.$/);
  assert.equal(expiringLine(DATA, state, MAIN, 264, first - 40 * DAY), null);
  assert.equal(expiringLine(null, state, MAIN, 264, first - 5 * DAY), null);
  assert.equal(expiringLine(DATA, state, null, 264, first - 5 * DAY), null);
});
