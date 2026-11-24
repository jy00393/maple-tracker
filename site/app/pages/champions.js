import { html } from '../../vendor/htm-preact.mjs';
import { update } from '../store.js';
import { Card, Seg, MesoInput, fmtBig, useNow } from '../ui.js';
import { championSummary, cleanChampions, insigniaLabel, raidMonth } from '../calc/champions.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (key) => `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`;

// Progress > Champions: Legion Champion slots, ranks, the next trial for each, and the monthly raid score.
export function ChampionsView({ data, state }) {
  const now = useNow(60000);
  const ch = data.champions;
  const saved = cleanChampions(state.champions, ch.maxSlots);
  const sum = championSummary(ch, saved);
  const set = (fn) => update((s) => {
    const c = cleanChampions(s.champions, ch.maxSlots);
    while (c.slots.length < ch.maxSlots) c.slots.push({ name: '', rank: 0 });
    fn(c);
    // Empty slots at the end are not kept.
    while (c.slots.length && !c.slots[c.slots.length - 1].name.trim() && !c.slots[c.slots.length - 1].rank) c.slots.pop();
    s.champions = c;
  });
  const month = raidMonth(now);
  const last = Object.keys(saved.raid).filter((k) => k < month).sort().pop();
  const bonus = insigniaLabel(sum.insignia);
  return html`<div class="grid wide-left">
    <${Card} title="Legion Champions" meta=${`${sum.registered} of ${sum.open} open slots used`}>
      <div class="insight"><span class="k">Insignia bonus on every Champion</span><span class="big">${bonus || 'None yet'}</span>
        <span class="small muted">${sum.nextRule ? `Slot ${sum.nextRule.slot} opens when your first ${sum.nextRule.need.champions} Champions are all rank ${sum.nextRule.need.rank} or higher.` : `All ${ch.maxSlots} slots are open.`}</span></div>
      ${sum.slots.map((s) => html`<div class=${'champ' + (s.open ? '' : ' locked')}>
        <div class="champ-h"><b>Slot ${s.i + 1}</b>${s.open ? null : html`<span class="small muted">locked</span>`}</div>
        ${s.open ? html`
          <input class="input" list="champion-names" aria-label=${`Champion in slot ${s.i + 1}`} placeholder="Character name" value=${s.name} onInput=${(e) => { const v = e.currentTarget.value; set((c) => { c.slots[s.i].name = v; }); }} />
          <${Seg} label=${`Rank of slot ${s.i + 1}`} value=${String(s.rank)} onChange=${(v) => set((c) => { c.slots[s.i].rank = Number(v); })} options=${ch.ranks.map((r, i) => [String(i), r.id])} />
          <div class="small">${!s.name.trim() ? html`<span class="muted">Empty. Type the character you registered.</span>` : s.next ? html`Next, rank ${s.next.id}: ${s.next.trial}` : html`<span style=${{ color: 'var(--ok)' }}>Top rank reached.</span>`}</div>`
        : html`<div class="small muted">${(() => { const rule = ch.slots.find((r) => r.slot === s.i + 1); return rule && rule.need ? `Opens when your first ${rule.need.champions} Champions are all rank ${rule.need.rank} or higher.` : ''; })()}</div>`}
      </div>`)}
      <datalist id="champion-names">${state.characters.map((c) => html`<option value=${c.name} />`)}</datalist>
      <p class="note">${ch.requirement} ${ch.rules}</p>
    <//>
    <div class="grid">
      <${Card} title=${ch.raid.name} meta=${monthName(month)}>
        <label class="field"><span>This month's raid score</span><${MesoInput} label="Champion Raid score this month" placeholder="e.g. 1.2B" value=${saved.raid[month] || null} onChange=${(v) => set((c) => { if (v) c.raid[month] = v; else delete c.raid[month]; })} /></label>
        ${last ? html`<p class="note">${monthName(last)}: ${fmtBig(saved.raid[last])}${saved.raid[month] ? ` · ${saved.raid[month] >= saved.raid[last] ? 'up' : 'down'} ${fmtBig(Math.abs(saved.raid[month] - saved.raid[last]))} since then` : ''}.</p>` : null}
        <p class="note">${ch.raid.note}</p>
      <//>
      <${Card} title="Rank trials">
        ${ch.ranks.slice(1).map((r) => html`<div class="small"><b>${r.id}</b>: ${r.trial} ${insigniaLabel(r.insignia || {})}.</div>`)}
        <p class="note">${ch.insigniaNote}</p>
        <p class="note">${ch.source}</p>
      <//>
    </div>
  </div>`;
}
