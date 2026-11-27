// Challenger World tiers (data/challenger.json, Nexon notice 47305): points earned, points by the season end,
// the fewest boss missions to the next tier and to a chosen target, the earliest date a tier is possible, the
// coins still to come from missions, and whether to break Arcane Seal barriers now or save the wands.
// Pure maths, no DOM.
//
// Saved per character: state.challenger[charId] = { done: { missionId: t }, target? }. Level missions are never
// ticked: they follow the character's known level.
//
// `ctx` is what the page knows about the character:
//   { level, done, higherCounts, cp, margin, cpData, bossById, who: { challenger, level }, world, erdaLink }
// higherCounts: the player says a clear of a listed difficulty also completes the easier listed missions of that
// boss. Nexon's notice does not say so, so by default (false) every listed mission counts on its own.
import { entryBlock } from './income.js';
import { reach } from './bosscp.js';

const RANK = { easy: 1, normal: 2, hard: 3, chaos: 4, extreme: 5 };
const rankOf = (boss) => RANK[String((boss && boss.difficulty) || '').toLowerCase()] || 0;
const own = (o, k) => Boolean(o) && typeof o === 'object' && Object.hasOwn(o, k);

export const tiersOf = (cw) => (cw && Array.isArray(cw.tiers) ? cw.tiers : []);

// Points from level missions at `level` (every milestone at or below it).
export function levelPoints(cw, level) {
  if (!cw || !Array.isArray(cw.levels) || !Number.isFinite(level)) return 0;
  return cw.levels.reduce((a, r) => a + (r[0] <= level ? r[1] : 0), 0);
}

// Challenger Coins from the level missions above `from` up to and including `to`.
export function levelCoins(cw, from, to) {
  if (!cw || !Array.isArray(cw.levels) || !Number.isFinite(to)) return 0;
  const lo = Number.isFinite(from) ? from : -Infinity;
  return cw.levels.reduce((a, r) => a + (r[0] > lo && r[0] <= to ? r[2] || 0 : 0), 0);
}

// The next level mission above `level`: { level, points, coins } or null.
export function nextLevelMission(cw, level) {
  if (!cw || !Array.isArray(cw.levels)) return null;
  const r = cw.levels.filter((x) => !Number.isFinite(level) || x[0] > level).sort((a, b) => a[0] - b[0])[0];
  return r ? { level: r[0], points: r[1], coins: r[2] || 0 } : null;
}

// The boss missions, joined to bosses.json: [{ id, boss, group, rank, points, coins, adv }]. A row whose boss is
// not in bosses.json is left out.
export function bossMissions(cw, bossById) {
  if (!cw || !Array.isArray(cw.bosses)) return [];
  return cw.bosses.map(([id, points, coins, adv]) => {
    const boss = bossById && own(bossById, id) ? bossById[id] : null;
    return boss ? { id, boss, group: boss.boss, rank: rankOf(boss), points, coins: coins || 0, adv: adv || 0 } : null;
  }).filter(Boolean);
}

// The missions that count as done: the ticked ones, and with `higherCounts` every easier listed mission of a boss
// whose harder listed mission is ticked.
export function doneSet(cw, bossById, done, higherCounts) {
  const out = new Set(Object.keys(done && typeof done === 'object' ? done : {}).filter((k) => done[k]));
  if (higherCounts) {
    const list = bossMissions(cw, bossById);
    for (const m of list) if (out.has(m.id)) for (const x of list) if (x.group === m.group && x.rank < m.rank) out.add(x.id);
  }
  return out;
}

// Points earned: level missions at the known level, and the boss missions done.
export function pointsNow(cw, ctx) {
  const set = doneSet(cw, ctx.bossById, ctx.done, ctx.higherCounts);
  const boss = bossMissions(cw, ctx.bossById).reduce((a, m) => a + (set.has(m.id) ? m.points : 0), 0);
  const level = levelPoints(cw, ctx.level);
  return { level, boss, total: level + boss, set };
}

// Can this character do a boss mission? { status, reach, block }:
// 'done' | 'can' (open, within Combat Power) | 'cp' (needs more Combat Power) | 'level' (below the entry level) |
// 'closed' (not open to this character at all) | 'unknown' (no Combat Power figure for that boss) | 'nocp' (none typed).
export function missionState(m, ctx, set) {
  const r = reach(ctx.cpData, m.boss, ctx.cp, ctx.margin || 1);
  const block = entryBlock(m.boss, ctx.who);
  if (set && set.has(m.id)) return { status: 'done', reach: r, block };
  if (block === 'challenger') return { status: 'closed', reach: r, block };
  if (block === 'level') return { status: 'level', reach: r, block };
  return { status: r === 'yes' ? 'can' : r === 'no' ? 'cp' : r, reach: r, block };
}

// The tier a character holds: the best whose points are reached and whose boss (Master, Challenger) is done.
// Returns the index into tiers, -1 below Bronze.
export function tierIndex(cw, points, set) {
  const tiers = tiersOf(cw);
  let at = -1;
  tiers.forEach((t, i) => { if (points >= t.points && (!t.boss || (set && set.has(t.boss)))) at = i; });
  return at;
}

// The fewest runs whose points reach `need`, then the smallest overshoot (which leans to easier bosses), then the
// first ids in order. `groups`: [{ key, opts: [{ run, ids, gain }] }]; at most one option per group is taken.
// Exact: a knapsack over the groups keyed by the points so far (below the need), so a pair of easier options is
// found even when it replaces two bigger ones at once.
export function fewestRuns(groups, need) {
  if (!(need > 0)) return { runs: [], gain: 0, short: 0 };
  const byGain = (a, b) => b.gain - a.gain || (a.run.id < b.run.id ? -1 : 1);
  const live = groups.filter((g) => g.opts.length);
  // Not enough even with the best option of every group: all of them, as many points as there are.
  const tops = live.map((g) => g.opts.slice().sort(byGain)[0]).sort(byGain);
  const most = tops.reduce((a, o) => a + o.gain, 0);
  if (most < need) return { runs: tops, gain: most, short: need - most };
  const idsOf = (list) => list.map((o) => o.run.id).sort();
  const lexLess = (a, b) => {
    const x = idsOf(a);
    const y = idsOf(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i];
    return x.length < y.length;
  };
  // A pick list is better with fewer runs, then fewer points, then the first ids.
  const better = (a, b) => !b || a.list.length < b.list.length || (a.list.length === b.list.length && (a.gain < b.gain || (a.gain === b.gain && lexLess(a.list, b.list))));
  let open = new Map([[0, { gain: 0, list: [] }]]);
  let done = null;
  for (const g of live) {
    const next = new Map(open);
    for (const s of open.values()) {
      for (const o of g.opts) {
        if (!(o.gain > 0)) continue;
        const c = { gain: s.gain + o.gain, list: [...s.list, o] };
        if (c.gain >= need) { if (better(c, done)) done = c; continue; }
        if (better(c, next.get(c.gain))) next.set(c.gain, c);
      }
    }
    open = next;
  }
  return { runs: done.list.slice().sort(byGain), gain: done.gain, short: 0 };
}

// Run options from a list of missions still to do. Counted separately, each mission is a run of its own. With
// higherCounts, a run of one difficulty also completes the easier listed missions of that boss not yet done.
export function runGroups(missions, all, set, higherCounts) {
  if (!higherCounts) return missions.map((m) => ({ key: m.id, opts: [{ run: m, ids: [m.id], gain: m.points }] }));
  const groups = new Map();
  for (const m of missions) {
    const lower = all.filter((x) => x.group === m.group && x.rank <= m.rank && !set.has(x.id));
    if (!groups.has(m.group)) groups.set(m.group, { key: m.group, opts: [] });
    groups.get(m.group).opts.push({ run: m, ids: lower.map((x) => x.id), gain: lower.reduce((a, x) => a + x.points, 0) });
  }
  return [...groups.values()];
}

// The cheapest boss missions for `need` more points: first from what the character can do now ('can'), then,
// if that is short, also from missions it can enter but has no Combat Power figure for ('unknown', 'nocp').
// `extra(m, st)` may allow more (the target plan lets in bosses opened by the level reached by the season end).
// A tier boss (Mayrin for Master) not yet done is always in the list (`forced`).
export function planPoints(cw, ctx, need, { forced = null, extra = null } = {}) {
  const { set } = pointsNow(cw, ctx);
  const all = bossMissions(cw, ctx.bossById);
  const states = new Map(all.map((m) => [m.id, missionState(m, ctx, set)]));
  const forcedM = forced && !set.has(forced) ? all.find((m) => m.id === forced) || null : null;
  // With higherCounts, a forced Hard run completes the easier missions as well.
  const forcedIds = forcedM ? (ctx.higherCounts ? all.filter((x) => x.group === forcedM.group && x.rank <= forcedM.rank && !set.has(x.id)) : [forcedM]) : [];
  const forcedGain = forcedIds.reduce((a, x) => a + x.points, 0);
  const taken = new Set(forcedIds.map((x) => x.id));
  const after = Math.max(0, need - forcedGain);
  const open = (ok) => all.filter((m) => !taken.has(m.id) && !(forcedM && m.group === forcedM.group && ctx.higherCounts) && ok(m, states.get(m.id)));
  const sure = (m, st) => st.status === 'can' || Boolean(extra && extra(m, st));
  const first = fewestRuns(runGroups(open(sure), all, set, ctx.higherCounts), after);
  let maybe = { runs: [], gain: 0, short: first.short };
  if (first.short > 0) {
    const used = new Set(first.runs.flatMap((o) => o.ids));
    const unsure = open((m, st) => !used.has(m.id) && !sure(m, st) && (st.status === 'unknown' || st.status === 'nocp'));
    maybe = fewestRuns(runGroups(unsure, all, new Set([...set, ...used]), ctx.higherCounts), first.short);
  }
  return {
    need,
    forced: forcedM ? { mission: forcedM, gain: forcedGain, ...states.get(forcedM.id) } : null,
    runs: first.runs.map((o) => ({ ...o, ...states.get(o.run.id) })),
    maybe: maybe.runs.map((o) => ({ ...o, ...states.get(o.run.id) })),
    short: maybe.short
  };
}

// Where the character stands: points now, the tier held and the next one, and what the next tier asks for now.
export function standing(cw, ctx) {
  const pts = pointsNow(cw, ctx);
  const tiers = tiersOf(cw);
  const idx = tierIndex(cw, pts.total, pts.set);
  const next = tiers[idx + 1] || null;
  const plan = next ? planPoints(cw, ctx, Math.max(0, next.points - pts.total), { forced: next.boss || null }) : null;
  return { points: pts.total, levelPoints: pts.level, bossPoints: pts.boss, set: pts.set, idx, tier: tiers[idx] || null, next, plan };
}

// The points the character reaches at the end of a list of projected level-ups. `path`: [{ level, at }],
// ascending, the levels the level planner expects (empty without a rate).
export function levelAtTime(path, level, t) {
  let l = level;
  for (const p of path || []) if (p.at <= t && p.level > l) l = p.level;
  return l;
}

// The plan to the target tier by `end` (the season end): the level points the projection adds by then, and the
// fewest boss missions for the rest. Bosses opened by a level reached in time count when the Combat Power is
// already enough.
export function targetPlan(cw, ctx, targetId, path, end) {
  const tiers = tiersOf(cw);
  const target = tiers.find((t) => t.id === targetId);
  if (!target) return null;
  const pts = pointsNow(cw, ctx);
  const endLevel = levelAtTime(path, ctx.level, end);
  const fromLevels = levelPoints(cw, endLevel) - pts.level;
  const need = Math.max(0, target.points - pts.total - fromLevels);
  const extra = (m, st) => st.status === 'level' && st.reach === 'yes' && m.boss.minLevel <= endLevel;
  const plan = planPoints(cw, ctx, need, { forced: target.boss || null, extra });
  const reached = tierIndex(cw, pts.total, pts.set) >= tiers.indexOf(target);
  return { target, endLevel, fromLevels, points: pts.total, ...plan, reached };
}

// The earliest time a tier is possible: the first projected level at which the level points, the boss missions
// done and every not-done boss mission the character could then enter and has the Combat Power for reach its
// points, and its boss (Master, Challenger) is open. Assumes those bosses are cleared at once, so it is the
// soonest, not a forecast. { at, level, now: true } when it is possible already; null when the projection never
// gets there (or there is no projection and it is not possible now).
export function earliestTier(cw, ctx, tierId, path, now) {
  const tier = tiersOf(cw).find((t) => t.id === tierId);
  if (!tier) return null;
  const pts = pointsNow(cw, ctx);
  const all = bossMissions(cw, ctx.bossById);
  const steps = [{ level: ctx.level, at: now }, ...(path || []).filter((p) => p.level > (ctx.level || 0))];
  for (const s of steps) {
    const who = { ...ctx.who, level: s.level };
    let total = pts.boss + levelPoints(cw, s.level);
    for (const m of all) {
      if (pts.set.has(m.id)) continue;
      if (!entryBlock(m.boss, who) && reach(ctx.cpData, m.boss, ctx.cp, ctx.margin || 1) === 'yes') total += m.points;
    }
    let bossOk = true;
    let bossUnsure = false;
    if (tier.boss && !pts.set.has(tier.boss)) {
      const m = all.find((x) => x.id === tier.boss);
      const r = m ? reach(ctx.cpData, m.boss, ctx.cp, ctx.margin || 1) : 'unknown';
      bossOk = Boolean(m) && !entryBlock(m.boss, who) && r !== 'no';
      // With no figure for that boss, its points are added here and the date is "if you can clear it".
      if (bossOk && r !== 'yes') { total += m.points; bossUnsure = true; }
    }
    if (bossOk && total >= tier.points) return { at: s.at, level: s.level, now: s.at === now, bossUnsure };
  }
  return null;
}

// Coins still to come from missions, once each (not per week): level missions up to `endLevel`, boss missions the
// character can do now, and seasonal missions not ticked (for its world type; HEXA ones are left out for an Erda
// Link character, since they may not apply).
export function missionCoins(cw, ctx, endLevel) {
  if (!cw) return { level: 0, boss: 0, adv: 0, seasonal: 0, total: 0, hexaLeftOut: 0 };
  const { set } = pointsNow(cw, ctx);
  const level = levelCoins(cw, ctx.level, Math.max(endLevel || 0, ctx.level || 0));
  let boss = 0;
  let adv = 0;
  for (const m of bossMissions(cw, ctx.bossById)) {
    if (set.has(m.id) || missionState(m, ctx, set).status !== 'can') continue;
    boss += m.coins;
    adv += m.adv;
  }
  let seasonal = 0;
  let hexaLeftOut = 0;
  for (const s of seasonalFor(cw, ctx)) {
    if (set.has(s.id)) continue;
    if (s.hexa && ctx.erdaLink) { hexaLeftOut += s.coins; continue; }
    seasonal += s.coins;
  }
  return { level, boss, adv, seasonal, total: level + boss + seasonal, hexaLeftOut };
}

// Seasonal missions for this character's world type.
export function seasonalFor(cw, ctx) {
  const world = ctx && ctx.world === 'interactive' ? 'interactive' : 'heroic';
  return (cw && Array.isArray(cw.seasonal) ? cw.seasonal : []).filter((s) => !s.world || s.world === world);
}

// Arcane Seal: the barrier stage a tier breaks (Nexon: Stage 1 below Gold, 2 from Gold, 3 from Emerald, 4 from
// Sapphire, 5 from Diamond).
export function sealStage(cw, tierIdx) {
  const stages = (cw && cw.seal && cw.seal.stages) || [];
  const tiers = tiersOf(cw);
  let out = stages[0] || null;
  for (const s of stages) {
    const i = s.from ? tiers.findIndex((t) => t.id === s.from) : -1;
    if (i <= tierIdx) out = s;
  }
  return out;
}

// Share of Epic or better cores at a stage, in percent.
export const epicPlus = (stage) => (stage && Array.isArray(stage.odds) ? stage.odds.slice(2).reduce((a, x) => a + x, 0) : 0);

// How many days of wands are kept: the cap over the wands a day (20 / 3 = 6 whole days), from the data.
export function sealDays(cw) {
  const s = cw && cw.seal;
  return s && s.cap > 0 && s.perDay > 0 ? Math.floor(s.cap / s.perDay) : 0;
}

// Break now or save the wands? Saving only helps when the next barrier stage is at or below the tier the player is
// heading for and the bosses the character can do now are enough to get there, and only for as long as the wands
// are kept and the season lasts: `left` is the time to the season end in ms (wands still saved then are lost).
// { kind: 'best' | 'break' | 'save', stage, next?, nextTier?, need?, runs?, days? }; why 'ending' when under a
// day is left.
export function sealAdvice(cw, ctx, targetId, left = Infinity) {
  const st = standing(cw, ctx);
  const stage = sealStage(cw, st.idx);
  if (!stage) return null;
  const stages = cw.seal.stages;
  const next = stages.find((s) => s.stage === stage.stage + 1) || null;
  if (!next) return { kind: 'best', stage };
  const days = Math.min(sealDays(cw) || Infinity, Number.isFinite(left) ? Math.floor(Math.max(0, left) / 86400000) : Infinity);
  if (!(days >= 1)) return { kind: 'break', why: 'ending', stage, next, nextTier: tiersOf(cw).find((t) => t.id === next.from) || null };
  const tiers = tiersOf(cw);
  const nextIdx = tiers.findIndex((t) => t.id === next.from);
  const nextTier = tiers[nextIdx];
  const targetIdx = tiers.findIndex((t) => t.id === targetId);
  if (targetIdx >= 0 && targetIdx < nextIdx) return { kind: 'break', why: 'target', stage, next, nextTier };
  const need = Math.max(0, nextTier.points - st.points);
  const plan = planPoints(cw, ctx, need);
  if (plan.short === 0 && plan.maybe.length === 0) return { kind: 'save', stage, next, nextTier, need, runs: plan.runs, days };
  return { kind: 'break', why: 'far', stage, next, nextTier, need };
}

// The tier a player is heading for when none is chosen: the best one the projection and the bosses the character
// can do by the season end reach.
export function likelyTarget(cw, ctx, path, end) {
  const tiers = tiersOf(cw);
  for (let i = tiers.length - 1; i >= 0; i--) {
    const p = targetPlan(cw, ctx, tiers[i].id, path, end);
    if (p && p.short === 0 && p.maybe.length === 0 && (!p.forced || p.forced.status === 'can' || (p.forced.status === 'level' && p.forced.reach === 'yes' && p.forced.mission.boss.minLevel <= p.endLevel))) return tiers[i].id;
  }
  return tiers[0] ? tiers[0].id : null;
}
