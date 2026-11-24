// What Monster Park and growth potions are worth at a level. Numbers come from data/expsources.json.
// toNext is the EXP from this level to the next (null when the level is outside the tracker's EXP table).
export function expSourcesAt(src, level, toNext) {
  const lvl = Number(level);
  if (!Number.isFinite(lvl) || lvl <= 0) return null;
  const mp = src.monsterPark;
  const fits = mp.dungeons.filter((d) => lvl >= d.from && lvl <= d.to).sort((a, b) => b.exp - a.exp);
  const share = (exp) => (toNext > 0 ? exp / toNext : null);
  const dungeons = fits.map((d) => ({ ...d, share: share(d.exp) }));
  const best = dungeons[0] || null;
  let park = null;
  if (best) {
    // A week of the free clears: six ordinary days and one Sunday with the bonus.
    const perDay = best.exp * mp.freePerDay;
    const perWeek = perDay * (6 + 1 + mp.sundayBonus);
    park = { best, perDay, perWeek, dayShare: share(perDay), weekShare: share(perWeek), sundayExp: best.exp * (1 + mp.sundayBonus) };
  }
  const potions = src.potions.list.filter((p) => lvl >= p.from && lvl <= p.to);
  return { level: lvl, dungeons, park, potions };
}
