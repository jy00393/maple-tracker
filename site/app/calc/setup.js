// First-run setup: one form creates the character and its boss list, and its first level reading when an EXP %
// was typed. With the EXP % left empty only the level is saved: an invented 0% reading would make the first real
// reading look like a whole day's gain and pull every level date far too close.
import { hasSharedTicks } from './checklist.js';
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
  if (level && Number.isFinite(form.pct)) s.level[id] = { ...(s.level[id] || {}), log: [{ t: now, level, pct: form.pct }] };
  return s;
}
