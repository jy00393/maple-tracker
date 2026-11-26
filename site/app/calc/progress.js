import { usefulLines } from './upgrades.js';
import { DAY } from '../time.js';
import { plural } from './plural.js';
import { shareKey } from './income.js';

const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ---------- figures typed by hand ----------
// A count typed on Progress (symbols held, traces collected) is only true at the moment it was typed, so each
// entry remembers that moment as `at`. An estimate made from it is a date fixed at that moment ("ready about
// 7 Dec"), never "in 11 days" counted from whenever the page is opened. Nothing is added to a count by itself.

// The start of the game day (00:00 UTC, 09:00 KST) that `t` falls in.
const gameDay = (t) => Math.floor(t / DAY) * DAY;

// When a typed entry was typed. One saved before entries were dated, or dated in the future by a wrong clock,
// counts as typed now.
export function typedAt(entry, now) {
  const at = entry && entry.at;
  return Number.isFinite(at) && at > 0 && at <= now ? at : now;
}

// Gives every typed entry that has no date yet the date `now` (saved data from before entries were dated is
// treated as typed on the day it is first loaded). Changes `state` in place; returns true when anything was dated.
export function dateTyped(state, now) {
  let dated = false;
  const stampAll = (part, used) => {
    for (const byChar of Object.values(state[part] || {})) {
      for (const e of Object.values(byChar || {})) {
        if (!e || typeof e !== 'object' || Array.isArray(e) || Number.isFinite(e.at) || !used(e)) continue;
        e.at = now;
        dated = true;
      }
    }
  };
  stampAll('symbols', (e) => e.level > 0 || e.have > 0);
  // A liberation entry starts at stage 0 with 0 traces, which is a typed figure too once bosses are picked.
  stampAll('liberation', () => true);
  return dated;
}

// ---------- symbols ----------
// now: the time the page is drawn. The dates count from when the entry was typed (entry.at):
//   nextAt / maxAt  the game day the next level / the last level should be reached at perDay a day
//   nextDue         that day has come, and the typed count is still short: the count needs updating
export function symbolPlan(kindData, area, entry = {}, now = Date.now()) {
  entry = entry || {};
  const max = kindData.maxLevel;
  const level = clamp(Math.floor(entry.level || 0), 0, max);
  const have = Math.max(0, Math.floor(entry.have || 0));
  const daily = Number.isFinite(entry.daily) ? entry.daily : area.daily;
  const weekly = Number.isFinite(entry.weekly) ? entry.weekly : area.weekly;
  const perDay = daily + weekly / 7;
  const power = level ? kindData.powerAtLevel1 + (level - 1) * kindData.powerPerLevel : 0;
  if (level === 0) {
    return { level, have, perDay, power, maxed: false, locked: true, needNext: 0, remainingSymbols: sum(kindData.symbolsPerLevel), remainingMesos: sum(area.mesos), nextMesos: 0, daysToNext: Infinity, daysToMax: Infinity, nextAt: null, maxAt: null, nextDue: false, maxDue: false };
  }
  if (level >= max) {
    return { level, have, perDay, power, maxed: true, locked: false, needNext: 0, remainingSymbols: 0, remainingMesos: 0, nextMesos: 0, daysToNext: 0, daysToMax: 0, nextAt: null, maxAt: null, nextDue: false, maxDue: false };
  }
  const needNext = kindData.symbolsPerLevel[level - 1];
  const remainingSymbols = Math.max(0, sum(kindData.symbolsPerLevel.slice(level - 1)) - have);
  const remainingMesos = sum(area.mesos.slice(level - 1));
  const nextMesos = area.mesos[level - 1];
  const daysToNext = perDay > 0 ? Math.ceil(Math.max(0, needNext - have) / perDay) : Infinity;
  const daysToMax = perDay > 0 ? Math.ceil(remainingSymbols / perDay) : Infinity;
  // How many levels the symbols you already hold would pay for right now.
  let affordable = 0;
  let pool = have;
  for (let l = level; l < max && pool >= kindData.symbolsPerLevel[l - 1]; l++) {
    pool -= kindData.symbolsPerLevel[l - 1];
    affordable++;
  }
  // daysToNext / daysToMax are days of dailies counted from the day the count was typed, so the dates stay put.
  const at = typedAt(entry, now);
  const dayOf = (days) => (Number.isFinite(days) ? gameDay(at) + days * DAY : null);
  const nextAt = dayOf(daysToNext);
  const maxAt = dayOf(daysToMax);
  return {
    level, have, perDay, power, maxed: false, locked: false, needNext, remainingSymbols, remainingMesos, nextMesos, daysToNext, daysToMax, affordable,
    at, nextAt, maxAt,
    nextDue: affordable === 0 && nextAt !== null && now >= nextAt,
    maxDue: maxAt !== null && now >= maxAt
  };
}

// ---------- liberation ----------
// The ticked sources that count: difficulties of one boss with the same reset share one clear (bosses.json
// `sharedClear`), so of several ticked ones only the best counts. Without `bossById` every tick counts by itself.
export function liberationCounted(def, picks = {}, bossById = null) {
  const best = new Map();
  for (const [bossId, on] of Object.entries(picks || {})) {
    const amount = def.sources[bossId];
    if (!on || !amount) continue;
    const boss = bossById ? bossById[bossId] : null;
    const key = boss ? shareKey(boss) : bossId;
    const cur = best.get(key);
    if (!cur || amount > cur.amount || (amount === cur.amount && bossId < cur.bossId)) {
      best.set(key, { bossId, amount, monthly: boss ? boss.reset === 'monthly' : bossId.startsWith('black-mage') });
    }
  }
  return [...best.values()];
}

// The Liberation list set from the bosses picked on Bosses: every picked boss that gives traces, one per shared
// clear (the difficulty with the most traces when two are picked). `bossPicks` is state.bosses[charId].picks.
export function liberationFromBosses(def, bossPicks = {}, bossById = null) {
  const on = Object.fromEntries(Object.keys(bossPicks || {}).filter((id) => bossPicks[id] && def.sources[id] && (!bossById || bossById[id])).map((id) => [id, true]));
  return Object.fromEntries(liberationCounted(def, on, bossById).map((c) => [c.bossId, true]));
}

export function liberationPlan(def, entry = {}, now = Date.now(), bossById = null) {
  const stages = def.stages;
  const stage = clamp(Math.floor(entry.stage || 0), 0, stages.length);
  if (stage >= stages.length) return { done: true, remaining: 0, perWeek: 0, weeks: 0, eta: now, stage, total: sum(stages.map((s) => s.need)), at: now, due: false };
  const traces = clamp(Math.floor(entry.traces || 0), 0, stages[stage].need);
  const remaining = stages[stage].need - traces + sum(stages.slice(stage + 1).map((s) => s.need));
  const picks = entry.picks || {};
  const mult = entry.pass ? def.passMultiplier || 1 : 1;
  let weekly = 0;
  let monthly = 0;
  for (const c of liberationCounted(def, picks, bossById)) {
    if (c.monthly) monthly += c.amount;
    else weekly += c.amount;
  }
  const perWeek = (weekly + monthly / 4.345) * mult;
  const weeks = perWeek > 0 ? Math.ceil(remaining / perWeek) : Infinity;
  const total = sum(stages.map((s) => s.need));
  const doneSoFar = total - remaining;
  // The finish date counts from the day the traces were typed (entry.at), so it does not slide a day every day.
  // due: that date has come, so the typed figure is out of date.
  const at = typedAt(entry, now);
  const eta = Number.isFinite(weeks) ? at + weeks * 7 * DAY : null;
  return { done: false, stage, traces, remaining, perWeek, weeks, eta, at, due: eta !== null && eta <= now, total, pct: total ? doneSoFar / total : 0 };
}

// ---------- 6th job ----------
export function erdaNextSteps(template, entry = {}, count = 3) {
  const levels = entry.levels || {};
  const steps = entry.steps || {};
  const out = [];
  // A later step for the same node starts where the earlier one ends (Lv. 10 → 20, not 0 → 20), so costs added
  // up over the steps never count the same levels twice.
  const planned = {};
  for (const [id, target] of template.order) {
    if (id === 'step') {
      if (!steps[target]) {
        const step = template.steps.find((s) => s.id === target);
        out.push({ id: `step-${target}`, label: step ? step.label : target });
      }
    } else {
      const have = Math.max(levels[id] || 0, planned[id] || 0);
      if (have < target) {
        const node = template.nodes.find((n) => n.id === id);
        out.push({ id: `${id}-${target}`, node: id, from: have, to: target, label: `${node ? node.name : id}: Lv. ${have} → ${target}` });
      }
      planned[id] = Math.max(have, target);
    }
    if (out.length >= count) break;
  }
  return out;
}

// ---------- gear ----------
const WSE = new Set(['weapon', 'secondary', 'emblem']);

export function slotTargets(slot, preset, override = {}) {
  const wse = WSE.has(slot.id);
  const starsKey = slot.type === 'weapon' ? 'weapon' : ['hat', 'topbottom', 'armor'].includes(slot.type) ? 'armor' : ['accessory', 'ring'].includes(slot.type) ? 'accessory' : 'misc';
  const base = {
    tier: preset.tier,
    stars: slot.sf ? preset.stars[starsKey] : 0,
    pot: wse ? preset.pot.wse : preset.pot.other,
    lines: wse ? preset.lines.wse : preset.lines.other,
    bpot: wse ? preset.bpot.wse : preset.bpot.other
  };
  if (slot.noPot) base.pot = base.lines = base.bpot = 0;
  for (const k of Object.keys(base)) if (Number.isFinite(override[k])) base[k] = override[k];
  return base;
}

export function slotProgress(entry = {}, target, tierNames = []) {
  const ratio = (have, want) => (want > 0 ? clamp((have || 0) / want, 0, 1) : 1);
  const parts = {
    tier: ratio(entry.tier, target.tier),
    stars: ratio(entry.stars, target.stars),
    pot: ratio(entry.pot, target.pot),
    lines: ratio(entry.lines, target.lines),
    bpot: ratio(entry.bpot, target.bpot)
  };
  const weights = target.stars > 0 ? { tier: 0.3, stars: 0.25, pot: 0.2, lines: 0.15, bpot: 0.1 } : { tier: 0.35, stars: 0, pot: 0.3, lines: 0.2, bpot: 0.15 };
  // Only parts with a target count, and an empty slot is 0% (it used to read 10-15% from targets it trivially met).
  const active = Object.keys(weights).filter((k) => weights[k] > 0 && target[k] > 0);
  const wsum = active.reduce((acc, k) => acc + weights[k], 0) || 1;
  const raw = (entry.tier || 0) > 0 ? active.reduce((acc, k) => acc + weights[k] * parts[k], 0) / wsum : 0;
  const pct = Math.min(1, Math.round(raw * 10000) / 10000);
  const gaps = [];
  if (parts.tier < 1) gaps.push(entry.tier ? `tier: ${tierNames[entry.tier - 1] || 'none'} → ${tierNames[target.tier - 1] || 'tier ' + target.tier}` : `empty: get ${tierNames[target.tier - 1] || 'tier ' + target.tier}`);
  if (parts.stars < 1) gaps.push(`+${target.stars - (entry.stars || 0)} ${plural(target.stars - (entry.stars || 0), 'star')}`);
  if (parts.pot < 1) gaps.push(`potential up to ${['None', 'Rare', 'Epic', 'Unique', 'Legendary'][target.pot]}`);
  if (parts.lines < 1) gaps.push(`${target.lines - (entry.lines || 0)} more useful ${plural(target.lines - (entry.lines || 0), 'line')}`);
  if (parts.bpot < 1) gaps.push(`bonus potential up to ${['None', 'Rare', 'Epic', 'Unique', 'Legendary'][target.bpot]}`);
  return { pct, parts, gaps };
}

// True when the Top slot holds an overall, which fills Bottom too (gear.json "overall" names the two slots).
export function wearsOverall(gearData, gearState) {
  const rule = gearData && gearData.overall;
  const top = rule && gearState && gearState.slots && gearState.slots[rule.slot];
  return Boolean(top && top.tier && top.overall);
}

export function gearSummary(gearData, gearState = {}, mainStat = 'STR') {
  const preset = gearData.presets[gearState.preset || 'mid'] || gearData.presets.mid;
  const coveredId = wearsOverall(gearData, gearState) ? gearData.overall.hides : null;
  const all = gearData.slots.map((slot) => {
    const stored = (gearState.slots || {})[slot.id] || {};
    const entry = Array.isArray(stored.potLines) ? { ...stored, lines: usefulLines(slot, stored, mainStat) } : stored;
    const tierNames = gearData.slotTypes[slot.type].filter(Boolean);
    const target = slotTargets(slot, preset, entry.target || {});
    target.tier = Math.min(target.tier, tierNames.length);
    const progress = slotProgress(entry, target, tierNames);
    // covered: the Bottom under an overall. It stays in `slots` so pages can draw it, but it is not scored.
    return { slot, entry, target, ...progress, weightedGap: slot.weight * (1 - progress.pct), ...(slot.id === coveredId ? { covered: true } : {}) };
  });
  const slots = all.filter((s) => !s.covered);
  const totalWeight = sum(slots.map((s) => s.slot.weight));
  const overall = sum(slots.map((s) => s.slot.weight * s.pct)) / totalWeight;
  const gaps = slots.filter((s) => s.pct < 1).sort((a, b) => b.weightedGap - a.weightedGap);
  const temporary = slots.filter((s) => s.entry.temporary);
  return { preset, overall, slots: all, gaps, temporary, totalWeight };
}

// The saved points that were scored against `preset`. Points carry the target they were scored against (p);
// ones saved before that (no p) count for every target.
export function historyFor(history, preset) {
  return (Array.isArray(history) ? history : []).filter((h) => h && (!preset || !h.p || h.p === preset));
}

// Pace from saved daily snapshots: percentage points per week and the date 100% would arrive. Only points scored
// against the current target are compared. Saved points are rounded to 0.1%, so the live score is rounded the
// same way and a gain smaller than that is no progress.
export function gearProjection(history = [], current, now = Date.now(), preset = null) {
  history = historyFor(history, preset);
  if (history.length < 2) return null;
  const first = history[0];
  const spanDays = (now - Date.parse(first.d + 'T00:00:00Z')) / DAY;
  if (spanDays < 3) return null;
  const gained = Math.round((Math.round(current * 1000) / 1000 - first.pct) * 1000) / 1000;
  if (gained === 0) return { perWeek: 0, eta: null };
  const perWeek = (gained / spanDays) * 7;
  if (perWeek <= 0) return { perWeek, eta: null };
  const weeks = (1 - current) / perWeek;
  return { perWeek, eta: now + weeks * 7 * DAY };
}

// Which 6th-job template a character starts on: the one that lists its class, otherwise the general one.
export function erdaTemplateFor(erda, char, entry) {
  const saved = entry && entry.template && erda.templates[entry.template] ? entry.template : null;
  if (saved && entry.templateChosen) return saved;
  const cls = String((char && char.cls) || '').trim().toLowerCase();
  let byClass = null;
  for (const [id, t] of Object.entries(erda.templates)) if ((t.classes || []).some((c) => c.toLowerCase() === cls)) byClass = byClass || id;
  // With no class typed in there is nothing to go on, so a saved template stays as it is.
  if (saved && !cls) return saved;
  if (byClass) return byClass;
  return erda.templates[erda.defaultTemplate] ? erda.defaultTemplate : saved || Object.keys(erda.templates)[0];
}
