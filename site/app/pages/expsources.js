import { html } from '../../vendor/htm-preact.mjs';
import { Card, Empty, fmtBig } from '../ui.js';
import { expSourcesAt } from '../calc/expsources.js';
import { expToNext } from '../calc/upgrades.js';

const pct = (share) => (share >= 0.1 ? (share * 100).toFixed(1) : (share * 100).toFixed(2)) + '%';

// Progress > Level: what Monster Park and growth potions are worth at the character's level.
export function ExpSourcesCard({ data, level }) {
  const src = data.expSources;
  const toNext = level ? expToNext(data.upgrades.exp, level) : null;
  const o = src ? expSourcesAt(src, level, toNext) : null;
  if (!o) return html`<${Card} title="Where EXP comes from" className="span2"><${Empty}>Log your level to see what Monster Park and growth potions are worth.<//><//>`;
  const mp = src.monsterPark;
  const p = o.park;
  return html`<${Card} title="Where EXP comes from" meta=${`at Lv. ${o.level}`} className="span2">
    <div class="tiles">
      ${p ? html`<div class="tile accent"><span class="k">Monster Park, free clears</span>
        <span class="v">${p.weekShare !== null ? pct(p.weekShare) + ' a week' : fmtBig(p.perWeek) + ' a week'}</span>
        <span class="s">${mp.freePerDay} clears a day of ${p.best.name}: ${fmtBig(p.best.exp)} EXP each${p.best.share !== null ? ` (${pct(p.best.share)} of a level)` : ''}</span></div>
        <div class="tile"><span class="k">On a Sunday</span><span class="v">${fmtBig(p.sundayExp)}</span><span class="s">per clear, ${Math.round(mp.sundayBonus * 100)}% more than other days</span></div>`
      : html`<div class="tile"><span class="k">Monster Park</span><span class="v">—</span><span class="s">no dungeon for this level</span></div>`}
      <div class=${'tile' + (o.potions.length ? ' ok' : '')}><span class="k">Growth potions that work</span><span class="v">${o.potions.length}</span>
        <span class="s">${o.potions.length ? 'each gives one full level now' : 'none give a full level at this level'}</span></div>
    </div>
    ${o.dungeons.length > 1 ? html`<p class="note">Dungeons for your level: ${o.dungeons.map((d) => `${d.name} ${fmtBig(d.exp)}${d.needs ? ` (${d.needs})` : ''}`).join(' · ')}.</p>` : p && p.best.needs ? html`<p class="note">${p.best.name} needs: ${p.best.needs}.</p>` : null}
    ${o.potions.length ? html`<p class="note">Usable now: ${o.potions.map((x) => x.name).join(', ')}. ${src.potions.note}</p>` : null}
    <p class="note">${mp.note}${toNext ? '' : ' Shares of a level are shown from Lv. 260, where the EXP table starts.'}</p>
    <p class="note">${src.note} ${src.source}</p>
  <//>`;
}
