// "You are about to lose this": unticked tasks and uncleared bosses whose reset is close.
import { nextReset } from '../time.js';
import { itemStatus } from './checklist.js';

const HOUR = 3600000;

// bossLines: characterLines() for the active character (may be empty).
// Returns one entry per reset that is close, soonest first:
// { kind, at, left, items: [label], bosses: { count, value } }
export function resetWarnings(checklistData, checklistState, bossLines, now, opts = {}) {
  const dailyWindow = (opts.dailyHours ?? 3) * HOUR;
  const weeklyWindow = (opts.weeklyHours ?? 24) * HOUR;
  const byKind = new Map();
  const slot = (kind) => {
    if (!byKind.has(kind)) byKind.set(kind, { kind, at: nextReset(kind, now), items: [], bosses: { count: 0, value: 0 } });
    return byKind.get(kind);
  };
  const close = (kind) => nextReset(kind, now) - now <= (kind === 'daily' ? dailyWindow : weeklyWindow);

  for (const group of checklistData.groups) {
    if (group.optional) continue;
    for (const item of group.items) {
      if (item.optional) continue;
      const st = itemStatus(item, group, checklistState, now, opts.who ?? opts.level);
      if (st.done || st.locked || st.expired || st.link) continue;
      if (!close(st.kind)) continue;
      slot(st.kind).items.push(item.label);
    }
  }
  // Only so many weekly crystals sell (opts.weeklyCap, from bosses.json): once that many are cleared nothing more
  // can be lost, and before that only the best open ones count.
  const weeklyCap = opts.weeklyCap > 0 ? opts.weeklyCap : Infinity;
  let room = weeklyCap - (bossLines || []).filter((l) => l.kind === 'weekly' && l.value > 0 && l.cleared).length;
  const byValue = [...(bossLines || [])].sort((a, b) => b.value - a.value);
  for (const line of byValue) {
    // Done on another difficulty, or a second pick for the same clear: nothing left to lose.
    if (!(line.value > 0) || line.doneAs || line.spare) continue;
    if (line.kind === 'weekly' && !line.cleared && close('thu')) {
      if (room <= 0) continue;
      room--;
      const w = slot('thu');
      w.bosses.count++;
      w.bosses.value += line.value;
    } else if (line.kind === 'daily' && !line.clearedNow && close('daily')) {
      const w = slot('daily');
      w.bosses.count++;
      w.bosses.value += line.value;
    }
  }
  return [...byKind.values()]
    .filter((w) => w.items.length || w.bosses.count)
    .map((w) => ({ ...w, left: w.at - now }))
    .sort((a, b) => a.at - b.at);
}
