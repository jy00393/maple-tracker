import { usefulLines } from './upgrades.js';
import { DAY } from '../time.js';

const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ---------- symbols ----------
export function symbolPlan(kindData, area, entry = {}) {
  const max = kindData.maxLevel;
  const level = clamp(Math.floor(entry.level || 0), 0, max);
  const have = Math.max(0, Math.floor(entry.have || 0));
  const daily = Number.isFinite(entry.daily) ? entry.daily : area.daily;
  const weekly = Number.isFinite(entry.weekly) ? entry.weekly : area.weekly;
  const perDay = daily + weekly / 7;
  const power = level ? kindData.powerAtLevel1 + (level - 1) * kindData.powerPerLevel : 0;
  if (level === 0) {
    return { level, have, perDay, power, maxed: false, locked: true, needNext: 0, remainingSymbols: sum(kindData.symbolsPerLevel), remainingMesos: sum(area.mesos), nextMesos: 0, daysToNext: Infinity, daysToMax: Infinity };
  }
  if (level >= max) {
    return { level, have, perDay, power, maxed: true, locked: false, needNext: 0, remainingSymbols: 0, remainingMesos: 0, nextMesos: 0, daysToNext: 0, daysToMax: 0 };
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
  return { level, have, perDay, power, maxed: false, locked: false, needNext, remainingSymbols, remainingMesos, nextMesos, daysToNext, daysToMax, affordable };
}

// ---------- liberation ----------
export function liberationPlan(def, entry = {}, now = Date.now()) {
  const stages = def.stages;
  const stage = clamp(Math.floor(entry.stage || 0), 0, stages.length);
  if (stage >= stages.length) return { done: true, remaining: 0, perWeek: 0, weeks: 0, eta: now, stage, total: sum(stages.map((s) => s.need)) };
  const traces = clamp(Math.floor(entry.traces || 0), 0, stages[stage].need);
  const remaining = stages[stage].need - traces + sum(stages.slice(stage + 1).map((s) => s.need));
  const picks = entry.picks || {};
  const mult = entry.pass ? def.passMultiplier || 1 : 1;
  let weekly = 0;
  let monthly = 0;
  for (const [bossId, on] of Object.entries(picks)) {
    if (!on || !def.sources[bossId]) continue;
    if (bossId.startsWith('black-mage')) monthly += def.sources[bossId];
    else weekly += def.sources[bossId];
  }
  const perWeek = (weekly + monthly / 4.345) * mult;
  const weeks = perWeek > 0 ? Math.ceil(remaining / perWeek) : Infinity;
  const total = sum(stages.map((s) => s.need));
  const doneSoFar = total - remaining;
  return { done: false, stage, traces, remaining, perWeek, weeks, eta: Number.isFinite(weeks) ? now + weeks * 7 * DAY : null, total, pct: total ? doneSoFar / total : 0 };
}

// ---------- 6th job ----------
export function erdaNextSteps(template, entry = {}, count = 3) {
  const levels = entry.levels || {};
  const steps = entry.steps || {};
  const out = [];
  for (const [id, target] of template.order) {
    if (id === 'step') {
      if (!steps[target]) {
        const step = template.steps.find((s) => s.id === target);
        out.push({ id: `step-${target}`, label: step ? step.label : target });
      }
    } else {
      const have = levels[id] || 0;
      if (have < target) {
        const node = template.nodes.find((n) => n.id === id);
        out.push({ id: `${id}-${target}`, node: id, from: have, to: target, label: `${node ? node.name : id}: Lv. ${have} → ${target}` });
      }
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
  if (parts.stars < 1) gaps.push(`+${target.stars - (entry.stars || 0)} stars`);
  if (parts.pot < 1) gaps.push(`potential up to ${['None', 'Rare', 'Epic', 'Unique', 'Legendary'][target.pot]}`);
  if (parts.lines < 1) gaps.push(`${target.lines - (entry.lines || 0)} more useful line${target.lines - (entry.lines || 0) === 1 ? '' : 's'}`);
  if (parts.bpot < 1) gaps.push(`bonus potential up to ${['None', 'Rare', 'Epic', 'Unique', 'Legendary'][target.bpot]}`);
  return { pct, parts, gaps };
}

export function gearSummary(gearData, gearState = {}) {
  const preset = gearData.presets[gearState.preset || 'mid'] || gearData.presets.mid;
  const slots = gearData.slots.map((slot) => {
    const stored = (gearState.slots || {})[slot.id] || {};
    const entry = Array.isArray(stored.potLines) ? { ...stored, lines: usefulLines(slot, stored) } : stored;
    const tierNames = gearData.slotTypes[slot.type].filter(Boolean);
    const target = slotTargets(slot, preset, entry.target || {});
    target.tier = Math.min(target.tier, tierNames.length);
    const progress = slotProgress(entry, target, tierNames);
    return { slot, entry, target, ...progress, weightedGap: slot.weight * (1 - progress.pct) };
  });
  const totalWeight = sum(slots.map((s) => s.slot.weight));
  const overall = sum(slots.map((s) => s.slot.weight * s.pct)) / totalWeight;
  const gaps = slots.filter((s) => s.pct < 1).sort((a, b) => b.weightedGap - a.weightedGap);
  const temporary = slots.filter((s) => s.entry.temporary);
  return { preset, overall, slots, gaps, temporary };
}

// Pace from saved daily snapshots: percentage points per week and the date 100% would arrive.
export function gearProjection(history = [], current, now = Date.now()) {
  if (history.length < 2) return null;
  const first = history[0];
  const spanDays = (now - Date.parse(first.d + 'T00:00:00Z')) / DAY;
  if (spanDays < 3) return null;
  const gained = current - first.pct;
  const perWeek = (gained / spanDays) * 7;
  if (perWeek <= 0) return { perWeek, eta: null };
  const weeks = (1 - current) / perWeek;
  return { perWeek, eta: now + weeks * 7 * DAY };
}

// Which 6th-job template a character starts on: the one that lists its class, otherwise the general one.
export function erdaTemplateFor(erda, char, entry) {
  if (entry && entry.template && erda.templates[entry.template]) return entry.template;
  const cls = String((char && char.cls) || '').trim().toLowerCase();
  for (const [id, t] of Object.entries(erda.templates)) if ((t.classes || []).some((c) => c.toLowerCase() === cls)) return id;
  return erda.templates[erda.defaultTemplate] ? erda.defaultTemplate : Object.keys(erda.templates)[0];
}
