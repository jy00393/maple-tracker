import { html, useState } from '../../vendor/htm-preact.mjs';
import { update, newId } from '../store.js';
import { Card, Fold, PageHead, NumberInput, MesoInput, Empty } from '../ui.js';
import { worldLabel } from '../calc/income.js';
import { MAIN_STAT_CHOICES, mainStatForClass, mainStatLabel } from '../calc/upgrades.js';
import { reclassifyLines } from '../calc/potential.js';
import { mainStatOnClassChange } from '../calc/upgrades.js';
import { fmtKst } from '../time.js';

export const CLASSES = ['Hero', 'Paladin', 'Dark Knight', 'Bowmaster', 'Marksman', 'Pathfinder', 'Fire/Poison Mage', 'Ice/Lightning Mage', 'Bishop',
  'Night Lord', 'Shadower', 'Dual Blade', 'Buccaneer', 'Corsair', 'Cannoneer', 'Dawn Warrior', 'Blaze Wizard', 'Wind Archer', 'Night Walker',
  'Thunder Breaker', 'Mihile', 'Aran', 'Evan', 'Mercedes', 'Phantom', 'Luminous', 'Shade', 'Battle Mage', 'Wild Hunter', 'Mechanic', 'Blaster',
  'Demon Slayer', 'Demon Avenger', 'Xenon', 'Kaiser', 'Angelic Buster', 'Cadena', 'Kain', 'Hayato', 'Kanna', 'Beast Tamer', 'Adele', 'Khali',
  'Illium', 'Ark', 'Lara', 'Hoyoung', 'Ren', 'Lynn', 'Mo Xuan', 'Sia Astelle', 'Erel Light', 'Zero', 'Kinesis', 'Lethe'];

const blankForm = () => ({ name: '', cls: '', level: null, region: 'na', world: 'heroic', challenger: false, quanah: false, mainStat: 'STR', beyondBurning: false });

function CharacterForm({ initial, onSave, onCancel, saveLabel, classStats }) {
  const [f, setF] = useState(initial);
  const set = (patch) => setF((prev) => ({ ...prev, ...patch }));
  const valid = f.name.trim().length > 0;
  return html`<form class="card-b" onSubmit=${(e) => { e.preventDefault(); if (valid) onSave({ ...f, name: f.name.trim() }); }}>
    <div class="form-grid">
      <label class="field"><span>Name (in-game)</span><input id="char-name" class="input" value=${f.name} required onInput=${(e) => set({ name: e.currentTarget.value })} /></label>
      <label class="field"><span>Class</span><input id="char-class" class="input" list="class-list" value=${f.cls} onInput=${(e) => { const cls = e.currentTarget.value; set({ cls, ...mainStatOnClassChange(f.cls, cls, f.mainStat, classStats) }); }} /></label>
      <label class="field"><span>Level</span><${NumberInput} id="char-level" className="input" label="Level" value=${f.level} min=${1} max=${300} onChange=${(v) => set({ level: v })} /></label>
      <label class="field"><span>Combat Power (optional)</span><${MesoInput} label="Combat Power" placeholder="e.g. 45M" value=${f.cp || null} onChange=${(v) => set({ cp: v || null })} /></label>
      <label class="field"><span>Region</span><select id="char-region" class="select" value=${f.region} onChange=${(e) => set({ region: e.currentTarget.value })}><option value="na">North America</option><option value="eu">Europe</option></select></label>
      <label class="field"><span>World type</span><select id="char-world" class="select" value=${f.world} onChange=${(e) => set({ world: e.currentTarget.value })}><option value="heroic">Heroic (no trading)</option><option value="interactive">Interactive</option></select></label>
      <label class="field"><span>Main stat</span><select id="char-stat" class="select" value=${f.mainStat || 'STR'} onChange=${(e) => set({ mainStat: e.currentTarget.value })}>${MAIN_STAT_CHOICES.map(([v, label]) => html`<option value=${v}>${label}</option>`)}</select></label>
    </div>
    <div class="toolbar">
      <label class="small"><input id="char-challenger" type="checkbox" checked=${f.challenger} onChange=${(e) => set({ challenger: e.currentTarget.checked })} /> Challenger World character</label>
      <label class="small"><input id="char-quanah" type="checkbox" checked=${f.quanah} onChange=${(e) => set({ quanah: e.currentTarget.checked })} /> Quanah World Leap (can't sell crystals)</label>
      <label class="small"><input id="char-beyond" type="checkbox" checked=${Boolean(f.beyondBurning)} onChange=${(e) => set({ beyondBurning: e.currentTarget.checked })} /> Beyond Burning (extra level per level-up to 280)</label>
    </div>
    <div class="toolbar">
      <button type="submit" class="btn primary" disabled=${!valid}>${saveLabel}</button>
      ${onCancel ? html`<button type="button" class="btn" onClick=${onCancel}>Cancel</button>` : null}
    </div>
    <datalist id="class-list">${CLASSES.map((c) => html`<option value=${c} />`)}</datalist>
  </form>`;
}

export function CharactersPage({ data, state }) {
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const nexon = data.nexonCharacters.characters || [];
  const nexonFor = (c) => nexon.find((n) => n.name.toLowerCase() === c.name.toLowerCase());
  const classStats = data.classes && data.classes.mainStat;
  return html`
    <${PageHead} title="Characters">Each character keeps its own bosses, symbols, liberation and gear. The one picked at the top is the one every page shows.<//>
    <div class="grid two">
      <${Card} title="Your characters" meta=${state.characters.length + ' saved'} bodyClass="card-b tight">
        ${state.characters.length === 0 ? html`<${Empty}>None yet. Add one on the right.<//>` : state.characters.map((c) => {
          const n = nexonFor(c);
          if (editing === c.id) {
            return html`<${CharacterForm} initial=${c} classStats=${classStats} saveLabel="Save" onCancel=${() => setEditing(null)}
              onSave=${(f) => { update((s) => {
                const i = s.characters.findIndex((x) => x.id === c.id);
                s.characters[i] = { ...c, ...f };
                if ((c.mainStat || 'STR') !== (f.mainStat || 'STR')) reclassifyLines(data, s.gear[c.id], f.mainStat || 'STR', c.mainStat || 'STR');
              }); setEditing(null); }} />`;
          }
          return html`<div class="row">
            <input type="radio" name="active-char" id=${'act-' + c.id} checked=${state.activeId === c.id} aria-label=${'Show ' + c.name}
              onChange=${() => update((s) => { s.activeId = c.id; })} />
            <label class="lbl" for=${'act-' + c.id}>${c.name} <span class="small muted">${c.cls || ''}${c.level ? ' · Lv. ' + c.level : ''}</span></label>
            <div class="right">
              <button type="button" class="btn" onClick=${() => setEditing(c.id)}>Edit</button>
              ${confirmDelete === c.id
                ? html`<button type="button" class="btn danger" onClick=${() => { update((s) => {
                    s.characters = s.characters.filter((x) => x.id !== c.id);
                    for (const k of ['bosses', 'symbols', 'liberation', 'ibp', 'erda', 'gear', 'level', 'pitch']) delete s[k][c.id];
                    // Its checklist ticks and unlock flags go too.
                    for (const part of ['items', 'flags']) for (const k of Object.keys(s.checklist[part])) if (k.startsWith(`${c.id}|`)) delete s.checklist[part][k];
                    // Ticks and unlocks saved before they were per character belong to the owner: they go with it,
                    // except account-wide items, which belong to everyone.
                    if (s.checklist.owner === c.id) {
                      const account = data.checklist.groups.flatMap((g) => g.items).filter((i) => i.scope === 'account').map((i) => i.id);
                      const shared = (k) => account.some((id) => k === id || k.startsWith(`${id}_`));
                      for (const k of Object.keys(s.checklist.flags)) if (!k.includes('|')) delete s.checklist.flags[k];
                      for (const k of Object.keys(s.checklist.items)) if (!k.includes('|') && !shared(k)) delete s.checklist.items[k];
                      s.checklist.owner = null;
                    }
                    if (s.activeId === c.id) s.activeId = s.characters[0]?.id ?? null;
                  }); setConfirmDelete(null); }}>Delete for good</button>
                  <button type="button" class="btn" onClick=${() => setConfirmDelete(null)}>Keep</button>`
                : html`<button type="button" class="btn" onClick=${() => setConfirmDelete(c.id)}>Delete</button>`}
            </div>
            ${(() => { const want = mainStatForClass(c.cls, classStats); return want && want !== (c.mainStat || 'STR') ? html`<p class="warnbox">${c.cls} uses ${mainStatLabel(want)}, but this character is set to ${mainStatLabel(c.mainStat || 'STR')}. Press Edit and pick the class again (or the main stat) to fix potential lines and flame scores.</p>` : null; })()}
            <p class="note">${worldLabel(c)}${c.quanah ? ' · Quanah' : ''}
              ${n ? html` · Nexon: Lv. ${n.level}${n.jobName ? ' ' + n.jobName : ''}, last change seen ${fmtKst(Date.parse(n.checkedAt), false)}
                ${n.level !== c.level ? html` <button type="button" class="btn" onClick=${() => update((s) => { const x = s.characters.find((y) => y.id === c.id); x.level = n.level; })}>Use Lv. ${n.level}</button>` : null}` : null}</p>
          </div>`;
        })}
      <//>
      <${Card} title="Add a character" bodyClass="">
        <${CharacterForm} key=${state.characters.length} initial=${blankForm()} classStats=${classStats} saveLabel="Add character"
          onSave=${(f) => update((s) => { const id = newId(); if (s.characters.length === 0) { s.checklist.owner = id; s.checklist.ownerSet = true; } s.characters.push({ id, ...f }); s.activeId = id; })} />
      <//>
      <${Fold} title="Automatic level updates" meta="optional · tap to open" className="span2">
        <p class="note">To have your level and class refreshed from Nexon's rankings every 6 hours, list the character in <code>config/characters.json</code> in your GitHub repo, like <code>[{"name": "YourName", "region": "na"}]</code>. The next run adds it here with a button to copy the level across. Names you list there are visible to anyone who can see the repo; Nexon's own rankings already show them publicly.</p>
        ${nexon.length ? html`<p class="note">Found on Nexon: ${nexon.map((n) => `${n.name} (Lv. ${n.level})`).join(', ')}.</p>` : null}
      <//>
    </div>`;
}
