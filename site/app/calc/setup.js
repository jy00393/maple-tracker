// First-run setup: one form creates the character, its boss list and its first level reading.
import { hasSharedTicks } from './checklist.js';
import { shareKey } from './income.js';

// The setup's boss chips: pressing one picks it or takes it back. Difficulties of one boss share one clear
// (bosses.json `sharedClear`), so picking a second difficulty replaces the first. `picked` is { bossId: true }.
export function toggleSetupPick(picked, boss, bosses) {
  const next = { ...picked, [boss.id]: !picked[boss.id] };
  if (next[boss.id]) for (const o of bosses) if (o.id !== boss.id && next[o.id] && shareKey(o) === shareKey(boss)) next[o.id] = false;
  return next;
}

export function applySetup(s, form, bossIds, id, now = Date.now()) {
  const level = Number.isFinite(form.level) ? form.level : null;
  // Ticks made before any character existed belong to the first one.
  // Only when there are such ticks: on a fresh device the owner stays unset, so pairing it with a device that
  // has old ticks never moves them to this character.
  if (s.characters.length === 0 && s.checklist) { if (hasSharedTicks(s.checklist)) s.checklist.owner = id; s.checklist.ownerSet = true; }
  s.characters.push({
    id,
    name: String(form.name || '').trim(),
    cls: form.cls || '',
    level,
    region: form.region || 'na',
    world: form.world || 'heroic',
    challenger: Boolean(form.challenger),
    quanah: Boolean(form.quanah),
    mainStat: form.mainStat || 'STR',
    beyondBurning: Boolean(form.beyondBurning),
    ...(form.cp > 0 ? { cp: Math.floor(form.cp) } : {})
  });
  s.activeId = id;
  const picks = {};
  for (const bossId of bossIds || []) picks[bossId] = { party: 1 };
  s.bosses[id] = { picks, clears: {} };
  if (level) s.level[id] = { ...(s.level[id] || {}), log: [{ t: now, level, pct: Number.isFinite(form.pct) ? form.pct : 0 }] };
  return s;
}
