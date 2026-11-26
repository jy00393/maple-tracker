import { html, useState } from '../../vendor/htm-preact.mjs';
import { update, newId } from '../store.js';
import { Card, NumberInput, MesoInput } from '../ui.js';
import { suggestBosses, fmtCp } from '../calc/bosscp.js';
import { applySetup, toggleSetupPick } from '../calc/setup.js';
import { crystalValue, fmtMesos } from '../calc/income.js';
import { CLASSES } from './characters.js';
import { MAIN_STAT_CHOICES, mainStatOnClassChange } from '../calc/upgrades.js';

// First-run setup on Today: one short form fills the character, the boss list and the first level reading.
export function QuickSetup({ data }) {
  const [f, setF] = useState({ name: '', cls: '', level: null, pct: null, region: 'na', world: 'heroic', challenger: false, beyondBurning: false, mainStat: 'STR' });
  const [picked, setPicked] = useState({});
  const set = (patch) => setF((prev) => ({ ...prev, ...patch }));
  const cap = data.bosses.limits.weeklyPerCharacter;
  const weekly = data.bosses.bosses.filter((b) => b.reset === 'weekly' && !b.noCrystal).sort((a, b) => b.price - a.price);
  const ids = Object.keys(picked).filter((id) => picked[id]);
  const total = ids.map((id) => crystalValue(data.bossById[id], f, data.bosses)).sort((a, b) => b - a).slice(0, cap).reduce((a, b) => a + b, 0);
  const valid = f.name.trim().length > 0;
  return html`<${Card} title="Set up in one minute" meta="you can change all of this later" className="span2">
    <form class="grid" onSubmit=${(e) => { e.preventDefault(); if (valid) update((s) => { applySetup(s, f, ids, newId()); }); }}>
      <div class="form-grid">
        <label class="field"><span>Character name</span><input id="qs-name" class="input" value=${f.name} required onInput=${(e) => set({ name: e.currentTarget.value })} /></label>
        <label class="field"><span>Class</span><input id="qs-class" class="input" list="qs-class-list" value=${f.cls} onInput=${(e) => { const cls = e.currentTarget.value; set({ cls, ...mainStatOnClassChange(f.cls, cls, f.mainStat, data.classes && data.classes.mainStat) }); }} /></label>
        <label class="field"><span>Level</span><${NumberInput} id="qs-level" className="input" label="Level" value=${f.level} min=${1} max=${300} onChange=${(v) => set({ level: v })} /></label>
        <label class="field"><span>Combat Power (optional)</span><${MesoInput} label="Combat Power" placeholder="e.g. 45M" value=${f.cp || null} onChange=${(v) => set({ cp: v || null })} /></label>
        <label class="field"><span>EXP % (optional)</span><${NumberInput} id="qs-pct" className="input" label="EXP percent" value=${f.pct} min=${0} max=${99.999} step=${0.001} onChange=${(v) => set({ pct: v })} /></label>
        <label class="field"><span>World type</span><select id="qs-world" class="select" value=${f.world} onChange=${(e) => set({ world: e.currentTarget.value })}><option value="heroic">Heroic (no trading)</option><option value="interactive">Interactive</option></select></label>
        <label class="field"><span>Main stat</span><select id="qs-stat" class="select" value=${f.mainStat} onChange=${(e) => set({ mainStat: e.currentTarget.value })}>${MAIN_STAT_CHOICES.map(([v, label]) => html`<option value=${v}>${label}</option>`)}</select></label>
      </div>
      <div class="toolbar">
        <label class="small"><input id="qs-challenger" type="checkbox" checked=${f.challenger} onChange=${(e) => set({ challenger: e.currentTarget.checked })} /> Challenger World character</label>
        <label class="small"><input id="qs-beyond" type="checkbox" checked=${f.beyondBurning} onChange=${(e) => set({ beyondBurning: e.currentTarget.checked })} /> Beyond Burning</label>
      </div>
      <div class="field"><span>Weekly bosses you clear · ${ids.length} picked${ids.length > cap ? ` (only the best ${cap} crystals count)` : ''}${total ? ` · ${fmtMesos(total)} a week` : ''}</span>
        ${f.cp > 0 && data.bossCp ? html`<div class="toolbar"><button type="button" id="qs-suggest" class="btn" onClick=${() => setPicked(Object.fromEntries(suggestBosses(data.bosses, data.bossCp, f.cp, 1, f).ids.map((id) => [id, true])))}>Pick what ${fmtCp(f.cp)} Combat Power can enter</button><span class="small muted">The best-paying difficulty of each boss, by the game's solo entry minimums. Change it freely.</span></div>` : null}
        <span class="small muted">One clear a week per boss: picking another difficulty replaces the first. Daily bosses are picked later, on Bosses.</span>
        <div class="chipbox">${weekly.map((b) => html`<button type="button" class="chip" aria-pressed=${String(Boolean(picked[b.id]))}
          onClick=${() => setPicked((p) => toggleSetupPick(p, b, data.bosses.bosses))}>${b.difficulty} ${b.boss} · ${fmtMesos(crystalValue(b, f, data.bosses))}</button>`)}</div>
      </div>
      <div class="toolbar"><button type="submit" class="btn primary" disabled=${!valid}>Start tracking</button><span class="small muted">Everything stays in this browser.</span></div>
      <datalist id="qs-class-list">${CLASSES.map((c) => html`<option value=${c} />`)}</datalist>
    </form>
  <//>`;
}
