// "All done" and "All cleared": which rows a one-press tick covers. No DOM.
import { itemStatus, recordKey } from './checklist.js';
import { entryBlock } from './income.js';

// The rows of one checklist group that "All done" ticks for character `who`: open (not done yet), not locked,
// not ended, plain ticks only. Counters, chip rows, links and rows that stand for a boss clear are left out (a
// boss is ticked on its own, so shared difficulties move the right tick), and so are rows marked optional inside
// a group that is not optional ("if you do it"). An account-wide row is counted once.
export function bulkTargets(group, items, cs, now, who) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (item.type === 'count' || item.type === 'chips' || item.type === 'link') continue;
    if (item.optional && !group.optional) continue;
    const st = itemStatus(item, group, cs, now, who);
    if (st.expired || st.locked || st.done || st.link || st.rows || st.prompt || st.clear) continue;
    const key = recordKey(item, who);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ item, key, kind: st.kind });
  }
  return out;
}

// This week's weekly bosses that "All cleared" ticks: picked, not cleared yet (on any difficulty that shares the
// clear), not a spare pick of a boss already counted, and open to the character. `lines` are characterLines.
export function weeklyTargets(lines, who) {
  return (lines || []).filter((l) => l.kind === 'weekly' && !l.clearedNow && !l.doneAs && !l.spare && !entryBlock(l.boss, who || {}));
}

// Today's boss list with the cleared ones moved to the bottom, each part in its old order.
export function clearedLast(lines) {
  const done = (l) => Boolean(l.clearedNow || l.doneAs);
  return [...lines.filter((l) => !done(l)), ...lines.filter(done)];
}

// Whether the Challenger season card shows folded to one line: until 14 days before its first deadline, while
// the season is on. `o` is seasonOutlook(). Returns the next deadline to name, or null when the card shows whole.
export const SEASON_FOLD_DAYS = 14;
export function seasonFold(o, now) {
  if (!o || o.over || o.ended || !o.groups.length) return null;
  const first = o.groups[0].at;
  if (now >= first - SEASON_FOLD_DAYS * 86400000) return null;
  const next = o.groups.find((g) => !g.passed && g.items.some((i) => !i.done)) || o.groups.find((g) => !g.passed);
  return next ? { at: next.at, open: next.items.filter((i) => !i.done).length, first } : null;
}

// Whether Checklist notes are shown on this device: the switch when it was used, otherwise shown on screens
// wider than 760px and hidden behind an (i) on phones.
export function notesShown(ui, narrow) {
  return ui && typeof ui.showNotes === 'boolean' ? ui.showNotes : !narrow;
}
