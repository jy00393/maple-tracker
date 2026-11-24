import { html } from '../../vendor/htm-preact.mjs';
import { update, charSlice } from '../store.js';
import { Card, MesoInput } from '../ui.js';
import { fmtMesos } from '../calc/income.js';
import { suggestBosses, picksOutOfReach, minCpFor, marginOf, fmtCp } from '../calc/bosscp.js';

// Bosses: which weekly bosses the character's Combat Power is enough for, and a one-press way to pick them.
export function CombatPowerCard({ data, state, char }) {
  const cpData = data.bossCp;
  if (!cpData) return null;
  const cp = char.cp || 0;
  const margin = marginOf(cpData, state.ui.bossMargin);
  const picks = (state.bosses[char.id] || {}).picks || {};
  const sug = suggestBosses(data.bosses, cpData, cp, margin, char);
  const over = picksOutOfReach(data.bosses, cpData, picks, cp, margin);
  const weeklyIds = new Set(data.bosses.bosses.filter((b) => b.reset === 'weekly').map((b) => b.id));
  const soloWeekly = Object.keys(picks).filter((id) => weeklyIds.has(id) && (picks[id].party || 1) === 1 && minCpFor(cpData, data.bossById[id]) !== null);
  const same = soloWeekly.length === sug.ids.length && sug.ids.every((id) => picks[id]);
  const setCp = (v) => update((s) => { const c = s.characters.find((x) => x.id === char.id); if (c) c.cp = v || null; });
  // Replaces the weekly solo picks that have a figure. Party picks, bosses with no figure, and daily and
  // monthly bosses are left as they are.
  const usePicks = () => update((s) => {
    const b = charSlice(s, 'bosses', char.id, () => ({ picks: {}, clears: {} }));
    for (const id of soloWeekly) if (!sug.ids.includes(id)) delete b.picks[id];
    for (const id of sug.ids) if (!b.picks[id]) b.picks[id] = { party: 1 };
  });
  return html`<${Card} title="What your Combat Power can enter" meta="solo, weekly bosses" className="span2">
    <div class="form-grid">
      <label class="field"><span>Your Combat Power</span><${MesoInput} label="Combat Power" placeholder="e.g. 45M" value=${cp || null} onChange=${setCp} /></label>
      <label class="field"><span>How much room you want</span><select id="boss-margin" class="select" value=${String(margin)} onChange=${(e) => { const v = Number(e.currentTarget.value); update((s) => { s.ui.bossMargin = v; }); }}>
        ${cpData.margins.map(([m, label]) => html`<option value=${String(m)}>${label}</option>`)}</select></label>
    </div>
    ${cp > 0 ? html`
      <div class="insight"><span class="k">Suggested weekly list</span>
        <span class="big accent">${sug.ids.length ? `${sug.ids.length} bosses · ${fmtMesos(sug.total)} a week` : 'No boss within reach yet'}</span>
        <span class="small">${sug.list.map((x) => `${x.boss.difficulty} ${x.boss.boss}`).join(' · ')}</span>
        <span class="small muted">The best-paying difficulty of each boss you can enter at ${fmtCp(cp)}${margin > 1 ? ` with ${margin}× room` : ''}, up to the ${data.bosses.limits.weeklyPerCharacter} crystals that sell. ${sug.beyond} harder difficulties are out of reach for now.</span></div>
      ${over.length ? html`<p class="warnbox">${over.length} boss${over.length === 1 ? '' : 'es'} you run solo ask${over.length === 1 ? 's' : ''} for more than that: ${over.map((b) => `${b.difficulty} ${b.boss} (${fmtCp(minCpFor(cpData, b) * margin)})`).join(', ')}.</p>` : null}
      <div class="toolbar">
        <button type="button" class="btn primary" disabled=${same || sug.ids.length === 0} onClick=${usePicks}>${same ? 'Your list matches this' : 'Use this list'}</button>
        <span class="small muted">Replaces your weekly solo picks. Party picks, daily and monthly bosses stay as they are.</span>
      </div>`
    : html`<p class="note">Type the Combat Power from your Character Info window (for example 45M or 1.2B). The list of bosses below then shows what each one asks for, and this card suggests which to run.</p>`}
    <p class="note">${cpData.marginNote} ${cpData.note}</p>
    <p class="note">${cpData.source}</p>
  <//>`;
}
