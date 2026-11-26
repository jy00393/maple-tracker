import { html } from '../../vendor/htm-preact.mjs';
import { update, activeCharacter } from '../store.js';
import { Card, Fold, Seg, NumberInput, fmtBig, plural } from '../ui.js';
import { scoreDist, chanceAtLeast, flamesNeeded, chanceWithin, flameScore, flameWeights, flamesSupported, bestScore, bandValue, SECONDARY_DEFAULT } from '../calc/flames.js';
import { itemLevel } from '../calc/advice.js';
import { mainStatLabel } from '../calc/upgrades.js';

// Very small chances read as "1 in N" rather than in exponent form (2.1e-11%).
const pct = (p) => (p >= 0.1 ? (p * 100).toFixed(1) + '%' : p >= 0.001 ? (p * 100).toFixed(2) + '%' : p >= 1e-6 ? (p * 100).toPrecision(2) + '%' : p > 0 ? `1 in ${count(1 / p)}` : '0%');
const count = (n) => Math.round(n).toLocaleString('en-US');
// "1 flame", "2 flames": the noun follows the rounded number that is shown.
const flames = (n) => `${count(n)} ${plural(Math.round(n), 'flame')}`;

// Mesos > Flames: flames and mesos to reach a flame score on one armour or accessory item.
export function Flames({ data, state }) {
  const fl = data.flames;
  const char = activeCharacter(state);
  const mainStat = (char && char.mainStat) || 'STR';
  const o = { slot: '', level: 160, adv: true, type: 'reset', target: 100, have: null, ...(state.ui.flameCalc || {}) };
  const set = (patch) => update((s) => { s.ui.flameCalc = { ...o, ...patch }; });
  if (!flamesSupported(mainStat)) {
    return html`<${Card} title="Flame calculator"><p class="note">Flame score is not worked out for Max HP characters: there is no sourced formula for it yet.</p><//>`;
  }
  const weights = flameWeights(fl, o.weights);
  const secondary = o.secondary && o.secondary !== mainStat ? o.secondary : SECONDARY_DEFAULT[mainStat];
  const type = fl.types.find((t) => t.id === o.type) || fl.types[0];
  const slots = data.gear.slots.filter((s) => s.id !== 'weapon' && !fl.noFlameSlots.includes(s.id));
  const gear = (char && state.gear[char.id] && state.gear[char.id].slots) || {};
  const mine = slots.find((s) => s.id === o.slot);
  const current = mine && gear[mine.id] && gear[mine.id].flame ? flameScore(gear[mine.id].flame, weights) : null;
  // An item that expires gets no spending advice anywhere in the tracker: warn, and set no "beat this" target.
  const temp = Boolean(mine && gear[mine.id] && gear[mine.id].temporary);
  const pickSlot = (id) => {
    const slot = slots.find((s) => s.id === id);
    const entry = slot && gear[slot.id];
    if (!slot || !entry) return set({ slot: id });
    const patch = { slot: id, level: itemLevel(slot, entry) || o.level, adv: entry.flameAdv !== false };
    if (entry.flame && !entry.temporary) patch.target = Math.floor(flameScore(entry.flame, weights)) + 1;
    set(patch);
  };
  const dist = scoreDist(fl, { level: o.level, mainStat, secondary, type: type.id, advantaged: o.adv, weights });
  const best = bestScore(dist);
  const need = flamesNeeded(chanceAtLeast(dist, o.target));
  const mesos = (n) => (type.price ? fmtBig(n * type.price) : null);
  const within = need && o.have ? chanceWithin(need.chance, o.have) : null;
  const setWeight = (k, v) => set({ weights: { ...(o.weights || {}), [k]: v } });
  const single = bandValue(fl.single, o.level);
  const double = bandValue(fl.double, o.level);
  return html`<div class="grid wide-left">
    <${Card} title="Flame calculator" meta="armour and accessories">
      <div class="form-grid">
        <label class="field"><span>Item</span><select id="flame-slot" class="select" value=${o.slot} onChange=${(e) => pickSlot(e.currentTarget.value)}>
          <option value="">Any item</option>
          ${slots.map((s) => html`<option value=${s.id}>${s.name}${gear[s.id] && gear[s.id].note ? ': ' + gear[s.id].note : ''}${gear[s.id] && gear[s.id].temporary ? ' (expires)' : ''}</option>`)}
        </select></label>
        <label class="field"><span>Item level</span><${NumberInput} id="flame-level" className="input" label="Item level" value=${o.level} max=${300} onChange=${(v) => set({ level: v || 0 })} /></label>
        <label class="field"><span>Target flame score</span><${NumberInput} id="flame-target" className="input" label="Target flame score" value=${o.target} max=${9999} onChange=${(v) => set({ target: v || 0 })} /></label>
        <label class="field"><span>Flames you have (optional)</span><${NumberInput} id="flame-have" className="input" label="Flames you have" value=${o.have} max=${100000} onChange=${(v) => set({ have: v })} /></label>
      </div>
      <div class="toolbar">
        <${Seg} label="Flame type" value=${type.id} onChange=${(v) => set({ type: v })} options=${fl.types.map((t) => [t.id, t.name])} />
        <label class="toggle"><input id="flame-adv" type="checkbox" checked=${o.adv} onChange=${(e) => set({ adv: e.currentTarget.checked })} /> Boss item (flame advantage)</label>
      </div>
      ${temp ? html`<p class="warnbox">This item expires, so put no mesos or flames into it. The figures below are for a permanent item of this level.</p>` : null}
      ${current !== null ? html`<p class="note">Your ${mine.name.toLowerCase()} flame scores ${current} now.${temp ? '' : ' Picking an item sets the target one point above its flame.'}</p>` : null}
      ${!need ? html`<p class="warnbox">No flame can reach ${o.target} on this item. The best possible score is ${best}.</p>` : html`
        <div class="tiles">
          <div class="tile accent"><span class="k">Typical</span><span class="v">${mesos(need.p50) || flames(need.p50)}</span><span class="s">${flames(need.p50)}: half of all tries are done by then</span></div>
          <div class="tile"><span class="k">Bad luck</span><span class="v">${mesos(need.p90) || flames(need.p90)}</span><span class="s">1 in 10 tries needs more than ${flames(need.p90)}</span></div>
          <div class="tile"><span class="k">Chance per flame</span><span class="v">${pct(need.chance)}</span><span class="s">${within !== null ? `${pct(within)} with your ${flames(o.have)}` : `${flames(need.expected)} on average`}</span></div>
        </div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>To be this sure</th><th class="num">Flames</th>${type.price ? html`<th class="num">Mesos</th>` : null}</tr></thead>
          <tbody>${[['50%', need.p50], ['75%', need.p75], ['90%', need.p90], ['95%', need.p95]].map(([label, n]) => html`<tr><td>${label}</td><td class="num">${count(n)}</td>${type.price ? html`<td class="num">${mesos(n)}</td>` : null}</tr>`)}</tbody>
        </table></div>
        <p class="note">${type.price ? `${type.name}: ${fmtBig(type.price)} mesos each. ${type.note || ''}` : `${type.name}s come from events and shops, so no meso cost is shown.`} Best possible score on this item: ${best}.</p>`}
      <details>
        <summary class="small muted">Flame score weights (community values, editable)</summary>
        <div class="form-grid">
          <label class="field"><span>1 ATT counts as</span><${NumberInput} className="input" label="Points per ATT" step=${0.5} value=${weights.att} max=${100} onChange=${(v) => setWeight('att', v ?? 0)} /></label>
          <label class="field"><span>1% All Stats counts as</span><${NumberInput} className="input" label="Points per 1% All Stats" step=${0.5} value=${weights.allstat} max=${100} onChange=${(v) => setWeight('allstat', v ?? 0)} /></label>
          <label class="field"><span>1 secondary stat counts as</span><${NumberInput} className="input" label="Points per secondary stat" step=${0.05} value=${weights.secondary} max=${100} onChange=${(v) => setWeight('secondary', v ?? 0)} /></label>
          ${mainStat === 'XENON' ? null : html`<label class="field"><span>Secondary stat</span><select class="select" value=${secondary} onChange=${(e) => set({ secondary: e.currentTarget.value })}>${['STR', 'DEX', 'INT', 'LUK'].filter((s) => s !== mainStat).map((s) => html`<option value=${s}>${s}</option>`)}</select></label>`}
        </div>
        <button type="button" class="btn ghost" onClick=${() => set({ weights: null, secondary: null })}>Reset to the defaults</button>
      </details>
    <//>
    <${Fold} title="How it's worked out" meta="tap to open">
      <p class="note">Flame score = ${mainStatLabel(mainStat)} + ATT × ${weights.att} + All Stats % × ${weights.allstat}${mainStat === 'XENON' ? '' : ` + ${secondary} × ${weights.secondary}`}. ${fl.weightsNote}</p>
      <p class="note">At item level ${o.level}, each tier gives ${single} of one stat, or ${double} of each on a two-stat line. ${fl.oddsNote} ${fl.lineCountNote}</p>
      <p class="note">${fl.linesNote} The chance is exact: every mix of lines and tiers is counted.</p>
      <p class="note">${fl.noFlameNote}</p>
      <p class="note">${fl.source}</p>
    <//>
  </div>`;
}
