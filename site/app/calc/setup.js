// First-run setup: one form creates the character, its boss list and its first level reading.
export function applySetup(s, form, bossIds, id, now = Date.now()) {
  const level = Number.isFinite(form.level) ? form.level : null;
  // Ticks made before any character existed belong to the first one.
  if (s.characters.length === 0 && s.checklist) { s.checklist.owner = id; s.checklist.ownerSet = true; }
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
    beyondBurning: Boolean(form.beyondBurning)
  });
  s.activeId = id;
  const picks = {};
  for (const bossId of bossIds || []) picks[bossId] = { party: 1 };
  s.bosses[id] = { picks, clears: {} };
  if (level) s.level[id] = { ...(s.level[id] || {}), log: [{ t: now, level, pct: Number.isFinite(form.pct) ? form.pct : 0 }] };
  return s;
}
