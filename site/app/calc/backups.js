// Local safety copies: one snapshot of your entries per game day, kept in this browser, so a bad edit, a bad
// merge or a bug can be undone. Pure list handling; store.js does the reading and writing.
import { dayKey } from '../time.js';

export const BACKUP_KEEP = 7;

// Adds a snapshot unless today already has an automatic one. A labelled snapshot (e.g. "before restore") is
// always added. Keeps the newest `keep` automatic ones and the newest 3 labelled ones.
export function addBackup(list, state, now, label = null, keep = BACKUP_KEEP) {
  const prev = Array.isArray(list) ? list.filter((b) => b && b.state && Number.isFinite(b.at)) : [];
  if (!state || !state.updatedAt) return prev;
  const d = dayKey(now);
  if (!label && prev.some((b) => !b.label && b.d === d)) return prev;
  const all = [...prev, { d, at: now, label, state }].sort((a, b) => a.at - b.at);
  const auto = all.filter((b) => !b.label).slice(-keep);
  const labelled = all.filter((b) => b.label).slice(-3);
  return [...auto, ...labelled].sort((a, b) => a.at - b.at);
}

// One line about what a snapshot holds, for the restore list.
export function describeBackup(b) {
  const s = b.state || {};
  const chars = Array.isArray(s.characters) ? s.characters.length : 0;
  const gear = Object.values(s.gear || {}).reduce((n, g) => n + Object.keys((g && g.slots) || {}).length, 0);
  return `${chars} character${chars === 1 ? '' : 's'}, ${gear} gear slot${gear === 1 ? '' : 's'} filled`;
}
