import { html } from '../../vendor/htm-preact.mjs';
import { update, activeCharacter, charSlice } from '../store.js';
import { Card, PageHead, Seg, NumberInput, Stepper, Bar, Tile, Empty } from '../ui.js';
import { symbolPlan, liberationPlan, erdaNextSteps, erdaTemplateFor } from '../calc/progress.js';
import { fmtMesos } from '../calc/income.js';
import { fmtDate, nextReset, DAY } from '../time.js';
import { LevelView, ErdaCosts } from './level.js';
import { ChampionsView } from './champions.js';

const days = (n) => (Number.isFinite(n) ? `${n} day${n === 1 ? '' : 's'}` : '—');

function SymbolTable({ kind, kindData, char, entries }) {
  const set = (areaId, patch) => update((s) => {
    const all = charSlice(s, 'symbols', char.id, () => ({}));
    all[areaId] = { ...(all[areaId] || {}), ...patch };
  });
  let totalPower = 0;
  let totalMesos = 0;
  const rows = kindData.areas.map((area) => {
    const entry = entries[area.id] || {};
    const plan = symbolPlan(kindData, area, entry);
    totalPower += plan.power;
    if (!plan.locked) totalMesos += plan.remainingMesos;
    return html`<tr class=${plan.locked ? 'off' : ''}>
      <td>${area.name}<div class="small muted">Lv. ${area.unlockLevel}+</div></td>
      <td><${Stepper} label=${area.name + ' level'} value=${entry.level ?? 0} min=${0} max=${kindData.maxLevel} onChange=${(v) => set(area.id, { level: v ?? 0 })} /></td>
      <td><${NumberInput} label=${area.name + ' symbols held'} value=${entry.have ?? 0} min=${0} max=${9999} onChange=${(v) => set(area.id, { have: v ?? 0 })} /></td>
      <td><${NumberInput} label=${area.name + ' symbols per day'} value=${entry.daily ?? area.daily} min=${0} max=${999} onChange=${(v) => set(area.id, { daily: v })} /></td>
      <td><${NumberInput} label=${area.name + ' symbols per week'} value=${entry.weekly ?? area.weekly} min=${0} max=${9999} onChange=${(v) => set(area.id, { weekly: v })} /></td>
      <td class="num">${plan.locked ? 'not unlocked' : plan.maxed ? 'max' : html`${days(plan.daysToNext)}${plan.affordable ? html`<div class="small" style=${{ color: 'var(--ok)' }}>${plan.affordable} level${plan.affordable === 1 ? '' : 's'} ready now</div>` : null}`}</td>
      <td class="num">${plan.locked || plan.maxed ? '—' : fmtMesos(plan.nextMesos)}</td>
      <td class="num">${plan.locked ? '—' : plan.maxed ? 'done' : html`${days(plan.daysToMax)}<div class="small muted">${fmtMesos(plan.remainingMesos)}</div>`}</td>
    </tr>`;
  });
  const powerName = kind === 'arcane' ? 'Arcane Power' : 'Sacred Power';
  return html`<${Card} title=${kind === 'arcane' ? 'Arcane symbols' : 'Sacred symbols'} meta=${`${powerName} ${totalPower} · ${fmtMesos(totalMesos)} mesos to max`}>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Area</th><th>Level</th><th>Held</th><th>Per day</th><th>Per week</th><th class="num">Next level</th><th class="num">Next cost</th><th class="num">To max</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="note">Level 0 means not unlocked yet. "Held" is symbols you have but haven't fused. "Per day" starts at the Heroic daily quest amount and "Per week" at the weekly quest amount; both count toward the day estimates. Change either to match what you really do.</p>
  <//>`;
}

function Liberation({ which, def, char, entry, bossById }) {
  const plan = liberationPlan(def, entry);
  const set = (patch) => update((s) => {
    const lib = charSlice(s, 'liberation', char.id, () => ({}));
    lib[which] = { ...(lib[which] || {}), ...patch };
  });
  const picks = entry.picks || {};
  const sources = Object.entries(def.sources).sort((a, b) => a[1] - b[1]);
  return html`<${Card} title=${def.name} meta=${plan.done ? 'Done' : `${plan.remaining.toLocaleString()} left`}>
    <${Bar} pct=${plan.done ? 1 : plan.pct} big />
    <div class="form-grid">
      <label class="field"><span>Current stage</span>
        <select class="select" value=${String(entry.stage || 0)} onChange=${(e) => set({ stage: Number(e.currentTarget.value), traces: 0 })}>
          ${def.stages.map((st, i) => html`<option value=${i}>${st.name} (${st.need.toLocaleString()})</option>`)}
          <option value=${def.stages.length}>Finished</option>
        </select></label>
      <label class="field"><span>Collected in this stage</span><${NumberInput} className="input" label="Collected in this stage" value=${entry.traces || 0} min=${0} max=${99999} onChange=${(v) => set({ traces: v || 0 })} /></label>
      ${def.passMultiplier > 1 ? html`<label class="field"><span>Pass (×${def.passMultiplier})</span><label class="small"><input type="checkbox" checked=${Boolean(entry.pass)} onChange=${(e) => set({ pass: e.currentTarget.checked })} /> I have the pass</label></label>` : null}
    </div>
    ${!plan.done ? html`<p class=${Number.isFinite(plan.weeks) ? 'okbox' : 'note'}>${Number.isFinite(plan.weeks)
      ? `About ${plan.weeks} weeks at ${Math.round(plan.perWeek)} a week: around ${fmtDate(plan.eta)}.`
      : 'Tick the bosses you clear each week to see a finish date.'}</p>` : null}
    <div class="chips" style=${{ gridColumn: 'auto' }}>
      ${sources.map(([bossId, amount]) => {
        const b = bossById[bossId];
        if (!b) return null;
        return html`<button type="button" class="chip" aria-pressed=${String(Boolean(picks[bossId]))}
          onClick=${() => set({ picks: { ...picks, [bossId]: !picks[bossId] } })}>${b.difficulty} ${b.boss} · ${amount}${b.reset === 'monthly' ? '/mo' : ''}</button>`;
      })}
    </div>
    <p class="note">Each stage also needs its quest kill (shown in the stage list). ${def.passMultiplier > 1 ? 'The Genesis Pass triples traces.' : ''}</p>
  <//>`;
}

// A dated note in a data file: a heads-up before the date, a warning to re-check after it.
export function reviewNotice(review, now) {
  if (!review || !review.after) return null;
  const due = now >= Date.parse(review.after);
  return { due, text: `${due ? 'Check these numbers in game: ' : 'Coming up: '}${review.note}` };
}

function SixthJob({ data, char, entry }) {
  const notice = reviewNotice(data.erda.review, Date.now());
  const templateId = erdaTemplateFor(data.erda, char, entry);
  const template = data.erda.templates[templateId];
  const levels = entry.levels || {};
  const steps = entry.steps || {};
  const set = (fn) => update((s) => {
    const e = charSlice(s, 'erda', char.id, () => ({ template: templateId, levels: {}, steps: {} }));
    e.levels = e.levels || {};
    e.steps = e.steps || {};
    fn(e);
  });
  const next = erdaNextSteps(template, entry, 4);
  return html`<div class="grid two">
    <${Card} title="6th job levels" meta=${template.name}>
      ${notice ? html`<p class=${notice.due ? 'warnbox' : 'note'}>${notice.text}</p>` : null}
      <div class="toolbar">
        <${Seg} label="6th job system" value=${templateId} onChange=${(v) => set((e) => { e.template = v; e.templateChosen = true; })}
          options=${Object.entries(data.erda.templates).map(([id, t]) => [id, id === 'erel' ? 'Erda Link (Erel)' : 'HEXA Matrix'])} />
      </div>
      ${template.steps.map((st) => html`<label class="small"><input type="checkbox" checked=${Boolean(steps[st.id])} onChange=${(e) => set((x) => { x.steps[st.id] = e.currentTarget.checked; })} /> ${st.label}</label>`)}
      <div class="tbl-wrap"><table class="tbl"><tbody>
        ${template.nodes.map((n) => html`<tr><td>${n.name}</td><td class="num"><${Stepper} label=${n.name + ' level'} value=${levels[n.id] || 0} min=${0} max=${30} onChange=${(v) => set((e) => { e.levels[n.id] = v || 0; })} /></td></tr>`)}
      </tbody></table></div>
      <div class="form-grid">
        <label class="field"><span>Sol Erda</span><${NumberInput} className="input" label="Sol Erda" value=${entry.solErda || 0} max=${99999} onChange=${(v) => set((e) => { e.solErda = v || 0; })} /></label>
        <label class="field"><span>Fragments</span><${NumberInput} className="input" label="Sol Erda Fragments" value=${entry.fragments || 0} max=${999999} onChange=${(v) => set((e) => { e.fragments = v || 0; })} /></label>
      </div>
    <//>
    <${Card} title="Next upgrades">
      ${next.length ? html`<ol class="small" style=${{ margin: 0, paddingLeft: '20px' }}>${next.map((s) => html`<li>${s.label}</li>`)}</ol>` : html`<${Empty}>Everything in the order is done.<//>`}
      <p class="note">${template.lockedNote}</p>
      <p class="note">${data.erda.note}</p>
    <//>
    <div class="span2"><${ErdaCosts} data=${data} char=${char} entry=${entry} template=${template} /></div>
  </div>`;
}

function ItemBurning({ data, char, entry }) {
  const done = entry.done || {};
  const crests = entry.crests || 0;
  const set = (fn) => update((s) => {
    const e = charSlice(s, 'ibp', char.id, () => ({ done: {}, crests: 0 }));
    e.done = e.done || {};
    fn(e);
  });
  const finished = data.ibp.stages.filter((st) => done[st.id]).length;
  const nextNeed = data.ibp.stages.find((st) => !done[st.id] && st.crests > crests);
  const weeks = nextNeed ? Math.ceil((nextNeed.crests - crests) / data.ibp.weeklyCrests) : 0;
  // Crests come in with the Thursday reset; only the resets before the event ends can still pay out.
  const end = Date.parse(data.ibp.endsAt);
  const now = Date.now();
  const over = now > end;
  // This week's hunts plus one more week for every Thursday reset still before the end.
  const nextThu = nextReset('thu', now);
  const thursdaysLeft = over ? 0 : 1 + (nextThu > end ? 0 : Math.floor((end - nextThu) / (7 * DAY)) + 1);
  const gate = !nextNeed ? 'covered' : over ? 'the event has ended' : weeks > thursdaysLeft
    ? `${nextNeed.crests.toLocaleString()} for stage ${nextNeed.id.slice(1)} · needs ~${weeks} weeks of hunts, ${thursdaysLeft} left before it ends: out of reach`
    : `${nextNeed.crests.toLocaleString()} for stage ${nextNeed.id.slice(1)} · ~${weeks} week${weeks === 1 ? '' : 's'} of hunts`;
  return html`<${Card} title="Item Burning Plus stages" meta=${`${finished} / ${data.ibp.stages.length} done`}>
    <div class="form-grid">
      <label class="field"><span>Challenge Crests held</span><${NumberInput} className="input" label="Challenge Crests" value=${crests} max=${99999} onChange=${(v) => set((e) => { e.crests = v || 0; })} /></label>
      <div class="field"><span>Next crest gate</span><b>${gate}</b></div>
    </div>
    <div>
      ${data.ibp.stages.map((st) => html`<div class=${'row' + (done[st.id] ? ' done' : '')}>
        <input type="checkbox" id=${'ibp-' + st.id} checked=${Boolean(done[st.id])} onChange=${(e) => set((x) => { x.done[st.id] = e.currentTarget.checked; })} />
        <label class="lbl" for=${'ibp-' + st.id}>${st.id.slice(1)} · ${st.boss}</label>
        <div class="right"><span class="min">Lv. ${st.level}${st.crests ? ` · ${st.crests.toLocaleString()} crests` : ''}</span></div>
        ${st.reward ? html`<p class="note">${st.reward}</p>` : null}
      </div>`)}
    </div>
    <p class="note">${over ? `Item Burning Plus ended on ${fmtDate(end)}; its gear has expired.` : `Stages can be cleared in any order and cash in once Stage 1 is done. The Challenger gear expires ${fmtDate(end)}, so don't spend mesos or cubes on it.`}</p>
  <//>`;
}

export function ProgressPage({ data, state }) {
  const char = activeCharacter(state);
  if (!char) return html`<${PageHead} title="Progress" /><${Card} title="Add a character first"><p class="note"><a href="#characters">Add your character</a> to track symbols, liberation and 6th job.</p><//>`;
  const view = state.ui.progressView || 'level';
  const setView = (v) => update((s) => { s.ui.progressView = v; });
  let body;
  if (view === 'level') {
    body = html`<${LevelView} data=${data} state=${state} char=${char} now=${Date.now()} />`;
  } else if (view === 'symbols') {
    const entries = state.symbols[char.id] || {};
    body = html`<div class="grid">
      <${SymbolTable} kind="sacred" kindData=${data.symbols.sacred} char=${char} entries=${entries} />
      <${SymbolTable} kind="arcane" kindData=${data.symbols.arcane} char=${char} entries=${entries} />
      <p class="note">${data.symbols.source}</p>
    </div>`;
  } else if (view === 'liberation') {
    const lib = state.liberation[char.id] || {};
    body = html`<div class="grid two">
      <${Liberation} which="genesis" def=${data.liberation.genesis} char=${char} entry=${lib.genesis || {}} bossById=${data.bossById} />
      <${Liberation} which="destiny" def=${data.liberation.destiny} char=${char} entry=${lib.destiny || {}} bossById=${data.bossById} />
      <p class="note span2">${data.liberation.source}</p>
    </div>`;
  } else if (view === 'champions') {
    body = html`<${ChampionsView} data=${data} state=${state} />`;
  } else if (view === 'sixth') {
    body = html`<${SixthJob} data=${data} char=${char} entry=${state.erda[char.id] || {}} />`;
  } else {
    body = html`<${ItemBurning} data=${data} char=${char} entry=${state.ibp[char.id] || {}} />`;
  }
  return html`
    <${PageHead} title="Progress">${char.name}: level gates, symbols, weapon liberation, 6th job, Legion Champions and Item Burning.<//>
    <div class="toolbar"><${Seg} label="Progress section" value=${view} onChange=${setView}
      options=${[['level', 'Level'], ['symbols', 'Symbols'], ['liberation', 'Liberation'], ['sixth', '6th job'], ['champions', 'Champions'], ['ibp', 'Item Burning']]} /></div>
    ${body}`;
}
