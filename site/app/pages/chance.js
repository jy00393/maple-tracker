// Mesos > Star Force, Cubes and Flames: "What your mesos buy". The chance to reach the calculator's target with
// the mesos you have, read from the same runs and odds as the "To be this sure" tables (calc/chance.js).
// The figure typed here is for this calculation only and stays on this device (state.ui.budget, not synced).
import { html } from '../../vendor/htm-preact.mjs';
import { update, activeCharacter, touch } from '../store.js';
import { Card, MesoInput, fmtBig, plural } from '../ui.js';
import { fmtKst, fmtDate, asOf } from '../time.js';
import { changedAt } from '../calc/asof.js';
import { maxStarsFor } from '../calc/starforce.js';
import { hasPotential } from '../calc/upgrades.js';
import { itemLevel } from '../calc/advice.js';
import { starChance, cubeChance, flameChance, fmtChance, sunnyTerms, sunnyOpts, budgetFor, SF_RUNS } from '../calc/chance.js';

const setBudget = (patch) => update((s) => { s.ui.budget = { ...(s.ui.budget || {}), ...patch }; });
const count = (n) => Math.round(n).toLocaleString('en-US');

// "Mesos you have": the planner's figure unless another one is typed here.
function BudgetField({ state, now }) {
  const b = budgetFor(state);
  const held = state.mesos.held || 0;
  const heldAt = changedAt(state, 'mesos/held', now);
  const onChange = (v) => {
    if (v === null) return setBudget({ mesos: null });
    if (!b.own && v === held) return;
    setBudget({ mesos: v });
  };
  return html`<div class="field"><span>Mesos you have</span>
    <${MesoInput} label="Mesos you have for this calculation" placeholder="e.g. 4.1B" value=${b.mesos} onChange=${onChange} />
    ${b.own ? html`<span class="small muted">For this calculation only, on this device. Your planner says ${fmtBig(held)}.${' '}
        <button type="button" class="linkbtn" onClick=${() => setBudget({ mesos: null })}>Use the planner figure</button>${' · '}        <button type="button" class="linkbtn" onClick=${() => { const v = b.mesos; update((s) => { s.mesos.held = v; s.ui.budget = { ...(s.ui.budget || {}), mesos: null }; }); touch('mesos/held'); }}>Save to the planner</button></span>`
      : held > 0 ? html`<span class="small muted">From Mesos → Planner${heldAt ? ` (${asOf(heldAt, now)})` : ''}. Type another figure to try it here only.</span>`
      : html`<span class="small muted">Type the mesos you have, or set them on Mesos → Planner.</span>`}
  </div>`;
}

// Optional: which of the active character's items this is for. Picking one fills in the calculator; an item that
// expires gets no chance at all.
function ItemPick({ data, state, kind, onPick }) {
  const char = activeCharacter(state);
  const gear = (char && state.gear[char.id] && state.gear[char.id].slots) || {};
  const slots = data.gear.slots.filter((s) => gear[s.id] && gear[s.id].tier && (kind === 'sf' ? s.sf : hasPotential(s)));
  if (!slots.length) return null;
  const picked = (state.ui.budget || {})[kind] || '';
  return html`<label class="field"><span>Item (optional)</span><select class="select" aria-label="Item for the chance" value=${slots.some((s) => s.id === picked) ? picked : ''}
    onChange=${(e) => { const id = e.currentTarget.value; setBudget({ [kind]: id }); const slot = slots.find((s) => s.id === id); if (slot && !gear[id].temporary) onPick(slot, gear[id]); }}>
    <option value="">Any item</option>
    ${slots.map((s) => html`<option value=${s.id}>${s.name}${gear[s.id].note ? ': ' + gear[s.id].note : ''}${gear[s.id].temporary ? ' (expires)' : ''}</option>`)}
  </select></label>`;
}

// The picked item, when it is one that expires.
function expiring(data, state, kind) {
  const char = activeCharacter(state);
  const id = (state.ui.budget || {})[kind];
  const entry = char && id && state.gear[char.id] && state.gear[char.id].slots ? state.gear[char.id].slots[id] : null;
  if (!entry || !entry.temporary) return null;
  const slot = data.gear.slots.find((s) => s.id === id);
  return slot ? slot.name : 'This item';
}

const Expires = ({ name, what }) => html`<p class="warnbox">${name} expires, so put no ${what} into it. No chance is shown for it.</p>`;
const NoBudget = () => html`<p class="note">Type the mesos you have to see your chance.</p>`;

// Star Force: now (the calculator's settings) and on the next Sunny Sunday's terms.
export function StarChance({ data, state, now, level, from, to, opts, spare }) {
  const sfData = data.upgrades.starforce;
  const b = budgetFor(state);
  const temp = expiring(data, state, 'sf');
  const pick = (slot, entry) => update((s) => {
    const o = { level: 160, from: 17, to: 22, ...(s.ui.sfCalc || {}) };
    const lvl = itemLevel(slot, entry);
    const max = maxStarsFor(sfData, lvl);
    const f = Math.min(entry.stars || 0, max);
    s.ui.sfCalc = { ...o, level: lvl, from: f, to: Math.min(max, Math.max(o.to, f + 1)) };
  });
  const terms = sunnyTerms(data.events.sunny, now);
  const sOpts = sunnyOpts(opts, terms);
  const same = sOpts.discount === Boolean(opts.discount) && sOpts.lessBoom === Boolean(opts.lessBoom);
  const plain = starChance(sfData, level, from, to, opts, spare, b.mesos);
  const sunny = starChance(sfData, level, from, to, sOpts, spare, b.mesos);
  const perks = (t) => [t.discount ? '30% off' : '', t.lessBoom ? `30% less destruction at ${sfData.sunny.destroyUpToStar}★ or below` : ''].filter(Boolean).join(', ');
  const sunnyK = terms.kind === 'now' ? `Sunny Sunday · on now` : terms.kind === 'wait' ? 'Next Sunny Sunday' : 'If a Sunny Sunday comes';
  const sunnyS = terms.kind === 'now' ? `until ${fmtKst(terms.day.end)} · ${perks(terms)}`
    : terms.kind === 'wait' ? `${fmtKst(terms.day.start)} · ${perks(terms)}`
    : terms.kind === 'none' ? `none announced through ${fmtDate(terms.through)} · usual terms: 30% off, 30% less destruction`
    : 'no schedule loaded · usual terms: 30% off, 30% less destruction';
  const v = (c) => (c.kind === 'chance' ? fmtChance(c.chance, true) : '—');
  const s = (c, rest) => (c.kind === 'far' ? 'too far to estimate: the upgrade takes thousands of attempts' : rest);
  return html`<${Card} title="What your mesos buy" meta=${`to reach ${to}★`}>
    <div class="form-grid">
      <${BudgetField} state=${state} now=${now} />
      <${ItemPick} data=${data} state=${state} kind="sf" onPick=${pick} />
    </div>
    ${temp ? html`<${Expires} name=${temp} what="mesos" />`
      : !(from < to) ? html`<p class="note">Pick a target above the current stars.</p>`
      : !b.mesos ? html`<${NoBudget} />`
      : html`<div class="tiles">
        <div class="tile accent"><span class="k">With your settings</span><span class="v">${v(plain)}</span><span class="s">${s(plain, `chance to reach ${to}★ with ${fmtBig(b.mesos)}`)}</span></div>
        <div class=${'tile' + (terms.kind === 'now' ? ' ok' : '')}><span class="k">${sunnyK}</span><span class="v">${v(sunny)}</span><span class="s">${s(sunny, same ? `${sunnyS} · your settings already include these` : sunnyS)}</span></div>
      </div>
      <p class="note">From ${count(SF_RUNS)} simulated runs, booms included${spare ? ' with the spare item cost' : ''}: the same runs as the "To be this sure" table. Rounded to a whole percent, so it stays the same for the same settings.</p>`}
  <//>`;
}

// Cubes: the exact chance for each cube type the shop sells.
export function CubeChance({ data, state, now, from, to, types }) {
  const b = budgetFor(state);
  const char = activeCharacter(state);
  const temp = expiring(data, state, 'cubes');
  const pick = (slot, entry) => update((s) => {
    const o = { from: 3, to: 4, ...(s.ui.cubeCalc || {}) };
    const f = Math.max(1, Math.min(3, entry.pot || 1));
    s.ui.cubeCalc = { ...o, from: f, to: Math.max(o.to, f + 1) };
  });
  const interactive = Boolean(char && char.world === 'interactive');
  return html`<${Card} title="What your mesos buy" meta="exact odds">
    <div class="form-grid">
      <${BudgetField} state=${state} now=${now} />
      <${ItemPick} data=${data} state=${state} kind="cubes" onPick=${pick} />
    </div>
    ${temp ? html`<${Expires} name=${temp} what="mesos or cubes" />`
      : interactive ? html`<p class="note">These are Heroic Cube Shop prices, and ${char.name || 'this character'} is on an Interactive world, so no chance is shown.</p>`
      : !(to > from) ? html`<p class="note">Pick a target above the current tier.</p>`
      : !b.mesos ? html`<${NoBudget} />`
      : html`<div class="tiles">${types.map((cube) => {
        const c = cubeChance(cube, from, to, b.mesos);
        return html`<div class="tile"><span class="k">${cube.name}s</span><span class="v">${c.kind === 'chance' ? fmtChance(c.chance) : '—'}</span>
          <span class="s">${c.kind === 'chance' ? `${count(c.cubes)} ${plural(c.cubes, 'cube')} with ${fmtBig(b.mesos)}` : 'no price'}</span></div>`;
      })}</div>
      <p class="note">Exact, from the tier-up odds used above (community estimates). Cube prices don't change on Sunny Sunday in this tracker's data, so there is no second figure.</p>`}
  <//>`;
}

// Flames: the exact chance from one flame's odds (perFlame) and the flame's meso price.
export function FlameChance({ state, now, type, perFlame, target, temp }) {
  const b = budgetFor(state);
  const c = flameChance(perFlame, type.price, b.mesos);
  return html`<${Card} title="What your mesos buy" meta="exact odds">
    <${BudgetField} state=${state} now=${now} />
    ${temp ? html`<${Expires} name="This item" what="mesos or flames" />`
      : c.kind === 'noprice' ? html`<p class="note">${type.name}s come from events and shops, so mesos don't buy them. Use "Flames you have" for those.</p>`
      : c.kind === 'never' ? html`<div class="tiles"><div class="tile"><span class="k">Chance</span><span class="v">0%</span><span class="s">no flame can reach ${target} on this item</span></div></div>`
      : !b.mesos ? html`<${NoBudget} />`
      : html`<div class="tiles"><div class="tile accent"><span class="k">Chance to reach score ${target}</span><span class="v">${fmtChance(c.chance)}</span>
          <span class="s">${count(c.flames)} ${plural(c.flames, type.name.toLowerCase())} with ${fmtBig(b.mesos)}</span></div></div>
        <p class="note">Exact: every mix of lines and tiers is counted, then each try is independent.</p>`}
  <//>`;
}
