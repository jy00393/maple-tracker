// Fixes from the last independent check of the second test round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { moveResetDay } from '../../site/app/calc/checklist.js';
import { stampEdit, mergeStates } from '../../site/app/calc/merge.js';
import { blankState } from '../../site/app/store.js';
import { levelAfterDelete } from '../../site/app/pages/level.js';

const at = (iso) => Date.parse(iso);

test('tapping the reset-day pill leaves ticks from weeks that are over untouched', () => {
  const item = { id: 'w-ultima' };
  const now = at('2026-11-20T10:05:00Z');
  const stale = { 'main|w-ultima': { p: 'thu:2026-11-12', t: at('2026-11-13T10:00:00Z'), c: 5, d: 1 } };
  const items = structuredClone(stale);
  for (const [from, to] of [['thu', 'mon'], ['mon', 'wed'], ['wed', 'thu']]) {
    moveResetDay(items, item, from, to, now);
    assert.deepEqual(items, stale, `${from} -> ${to}`);
  }
});

test('a pill tap on one device does not beat a newer tick from another device', () => {
  const item = { id: 'w-ultima' };
  const old = { p: 'thu:2026-11-12', t: at('2026-11-13T10:00:00Z'), c: 5, d: 1 };
  const edit = (st, now, fn) => { const n = structuredClone(st); fn(n); stampEdit(n.stamps, st, n, now); n.updatedAt = now; return n; };
  const start = blankState();
  start.characters = [{ id: 'main', name: 'M', level: 264 }];
  start.activeId = 'main';
  start.checklist.ownerSet = true;
  const base = edit(start, old.t, (s) => { s.checklist.items['main|w-ultima'] = { ...old }; });
  // B counts this week's 5/5.
  const tB = at('2026-11-20T10:00:00Z');
  const b = edit(base, tB, (s) => { s.checklist.items['main|w-ultima'] = { p: 'thu:2026-11-19', t: tB, c: 5, d: 1 }; });
  // A, not yet synced, taps the pill three times, back to Thursday.
  let a = base;
  const tA = at('2026-11-20T10:05:00Z');
  [['thu', 'mon'], ['mon', 'wed'], ['wed', 'thu']].forEach(([from, to], i) => {
    a = edit(a, tA + i * 2000, (s) => { moveResetDay(s.checklist.items, item, from, to, tA + i * 2000); s.checklist.resets['w-ultima'] = to; });
  });
  for (const merged of [mergeStates(a, b, tA + 60000), mergeStates(b, a, tA + 60000)]) {
    assert.deepEqual(merged.checklist.items['main|w-ultima'], { p: 'thu:2026-11-19', t: tB, c: 5, d: 1 });
  }
});

test('two wrong level rows deleted after a correction: the level follows what is left', () => {
  // From Lv. 264: 274 logged twice by mistake, then 264. The 264 was ignored, so the level stayed 274.
  const r1 = { t: 1000, level: 274, was: 264 };
  const r2 = { t: 2000, level: 274, was: 274 };
  const fix = { t: 3000, level: 264, was: 274 };
  const you = (r) => ({ t: r.t, level: r.level, frac: 0, source: 'you' });
  // Delete the first wrong row: the second still says 274.
  assert.equal(levelAfterDelete([r1, r2, fix], r1, [you(fix)], 274), 274);
  // passOnWas hands r1's `was` to r2; deleting r2 leaves only the 264 row.
  const r2b = { ...r2, was: 264 };
  assert.equal(levelAfterDelete([r2b, fix], r2b, [you(fix)], 274), 264);
  // The other order ends the same.
  assert.equal(levelAfterDelete([r1, r2, fix], r2, [you(fix)], 274), 274);
  assert.equal(levelAfterDelete([r1, fix], r1, [you(fix)], 274), 264);
  // A low slip left after the real rows are deleted never lowers the level.
  const real = { t: 1000, level: 270, was: 270 };
  const slip = { t: 2000, level: 207, was: 270 };
  assert.equal(levelAfterDelete([real, slip], real, [you(slip)], 270), 270);
  // A later reading from Nexon's rankings is newer than anything else.
  assert.equal(levelAfterDelete([real], real, [{ t: 5000, level: 271, frac: 0, source: 'Nexon' }], 270), 271);
});
