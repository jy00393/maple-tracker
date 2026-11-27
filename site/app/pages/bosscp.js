import { html } from '../../vendor/htm-preact.mjs';
import { update, charSlice } from '../store.js';
import { Card, MesoInput } from '../ui.js';
import { fmtMesos, entryBlock, entryBlockText } from '../calc/income.js';
import { undoable } from '../undo.js';
import { suggestBosses, picksOutOfReach, minCpFor, marginOf, fmtCp } from '../calc/bosscp.js';

// Bosses: which weekly bosses the character's Combat Power is enough for, and a one-press way to pick them.
// `who` = { challenger, level }: the Bosses page passes the known level (the same the picker locks by).
export function CombatPowerCard({ data, state, char, who }) {
  const cpData = data.bossCp;
  if (!cpData) return null;
  const cp = char.cp || 0;
  const margin = marginOf(cpData, state.ui.bossMargin);
  const entry = who || { challenger: Boolean(char.challenger), level: Number(char.level) > 0 ? Number(char.level) : undefined };
  const picks = (state.bosses[char.id] || {}).picks || {};
  const over = picksOutOfReach(data.bosses, cpData, picks, cp, margin);
  const weekly = Object.keys(picks).map((id) => data.bossById[id]).filter((b) => b && b.reset === 'weekly');
  // Picks the character cannot enter yet: never suggested, but a pick saved earlier stays picked (and still counts
  // in the week's plan, as income counts it), so the card names them.
  const closed = weekly.filter((b) => !b.noCrystal && entryBlock(b, entry));
  // The picks the suggestion may replace: solo, with a figure, paying a crystal, and open to the character.
  // Everything else stays.
  const replaceable = (b) => (picks[b.id].party || 1) === 1 && minCpFor(cpData, b) !== null && !b.noCrystal && !entryBlock(b, entry);
  const soloWeekly = weekly.filter(replaceable).map((b) => b.id);
  const kept = weekly.filter((b) => !replaceable(b)).map((b) => ({ ...b, party: picks[b.id].party || 1 }));
  const sug = suggestBosses(data.bosses, cpData, cp, margin, char, kept, entry);
  // The next entry level among the weekly crystal bosses left out for level, for "the next opens at Lv. N".
  const nextLevel = sug.locked ? Math.min(...data.bosses.bosses.filter((b) => b.reset === 'weekly' && !b.noCrystal && entryBlock(b, entry) === 'level').map((b) => b.minLevel)) : null;
  // "Matches" means pressing the button would change nothing.
  const same = sug.ids.every((id) => picks[id]) && soloWeekly.every((id) => sug.ids.includes(id));
  const setCp = (v) => update((s) => { const c = s.characters.find((x) => x.id === char.id); if (c) c.cp = v || null; });
  // Replaces the weekly solo picks that have a figure. Party picks, bosses with no figure, and daily and
  // monthly bosses are left as they are.
  const usePicks = () => undoable('Weekly boss list replaced', () => update((s) => {
    const b = charSlice(s, 'bosses', char.id, () => ({ picks: {}, clears: {} }));
    for (const id of soloWeekly) if (!sug.ids.includes(id)) delete b.picks[id];
    for (const id of sug.ids) if (!b.picks[id]) b.picks[id] = { party: 1 };
  }));
  return html`<${Card} title="What your Combat Power can enter" meta="solo, weekly bosses" className="span2">
    <div class="form-grid">
      <label class="field"><span>Your Combat Power</span><${MesoInput} label="Combat Power" placeholder="e.g. 45M" value=${cp || null} onChange=${setCp} /></label>
      <label class="field"><span>How much room you want</span><select id="boss-margin" class="select" value=${String(margin)} onChange=${(e) => { const v = Number(e.currentTarget.value); update((s) => { s.ui.bossMargin = v; }); }}>
        ${cpData.margins.map(([m, label]) => html`<option value=${String(m)}>${label}</option>`)}</select></label>
    </div>
    ${cp > 0 ? html`
      <div class="insight"><span class="k">Suggested weekly list</span>
        <span class="big accent">${sug.ids.length ? `${sug.ids.length} boss${sug.ids.length === 1 ? '' : 'es'} · ${fmtMesos(sug.total)} a week` : sug.reachable ? 'Your kept picks already fill the crystals that sell' : 'No boss within reach yet'}</span>
        <span class="small">${sug.list.map((x) => `${x.boss.difficulty} ${x.boss.boss}`).join(' · ')}</span>
        <span class="small muted">The best-paying difficulty of each boss you can enter at ${fmtCp(cp)}${margin > 1 ? ` with ${margin}× room` : ''}${entry.level > 0 ? ` and Lv. ${entry.level}` : ''}, up to the ${data.bosses.limits.weeklyPerCharacter} crystals that sell${kept.length ? `, next to the ${kept.length} weekly boss${kept.length === 1 ? '' : 'es'} you keep as they are (party runs, bosses with no figure or no crystal${closed.length ? ', bosses not open to you yet' : ''})` : ''}.${sug.beyond ? ` ${sug.beyond} harder ${sug.beyond === 1 ? 'difficulty is' : 'difficulties are'} out of reach for now.` : ''}${sug.locked && Number.isFinite(nextLevel) ? ` ${sug.locked} ${sug.locked === 1 ? 'difficulty needs' : 'difficulties need'} a higher level; the next opens at Lv. ${nextLevel}.` : ''}${char.quanah ? ' Quanah World Leap characters can\'t sell crystals, so the list is ranked by what they would be worth.' : ''}</span></div>
      ${over.length ? html`<p class="warnbox">${over.length} boss${over.length === 1 ? '' : 'es'} you run solo ask${over.length === 1 ? 's' : ''} for more than that: ${over.map((b) => `${b.difficulty} ${b.boss} (${fmtCp(minCpFor(cpData, b) * margin)})`).join(', ')}.</p>` : null}
      ${closed.length ? html`<p class="warnbox">${closed.length} picked boss${closed.length === 1 ? ' is' : 'es are'} not open to ${char.name} yet and still count${closed.length === 1 ? 's' : ''} in the week's plan: ${closed.map((b) => `${b.difficulty} ${b.boss} (${entryBlockText(b, entryBlock(b, entry))})`).join(', ')}. Untick ${closed.length === 1 ? 'it' : 'them'} below if you can't run ${closed.length === 1 ? 'it' : 'them'} this week.</p>` : null}
      <div class="toolbar">
        <button type="button" class="btn primary" disabled=${same || sug.ids.length === 0} onClick=${usePicks}>${same ? 'Your list matches this' : 'Use this list'}</button>
        <span class="small muted">Replaces your weekly solo picks. Party picks, bosses with no figure or no crystal, and daily and monthly bosses stay as they are.</span>
      </div>`
    : html`<p class="note">Type the Combat Power from your Character Info window (for example 45M or 1.2B). The list of bosses below then shows what each one asks for, and this card suggests which to run.</p>`}
    <p class="note">${cpData.marginNote} ${cpData.note}</p>
    <p class="note">${cpData.source}</p>
  <//>`;
}
