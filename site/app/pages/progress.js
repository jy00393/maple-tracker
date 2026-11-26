import { html } from '../../vendor/htm-preact.mjs';
import { update, activeCharacter, charSlice } from '../store.js';
import { Card, PageHead, Seg, NumberInput, Stepper, Bar, Tile, Empty, useClock } from '../ui.js';
import { symbolPlan, liberationPlan, liberationCounted, liberationFromBosses, erdaNextSteps, erdaTemplateFor } from '../calc/progress.js';
import { fmtMesos, shareKey } from '../calc/income.js';
import { fmtDate, fmtDay, asOf, kstDays, dayWord, nextReset, DAY } from '../time.js';
import { changedAt } from '../calc/asof.js';
import { LevelView, ErdaCosts } from './level.js';
import { ChampionsView } from './champions.js';

function SymbolTable({ kind, kindData, char, entries, now }) {
  // Typing a level or a held count dates the entry: its dates count from that moment (calc/progress.js).
  const set = (areaId, patch) => update((s) => {
    const all = charSlice(s, 'symbols', char.id, () => ({}));
    all[areaId] = { ...(all[areaId] || {}), ...patch, ...('level' in patch || 'have' in patch ? { at: Date.now() } : {}) };
  });
  const small = (text, color) => html`<div class=${'small' + (color ? '' : ' muted')} style=${color ? { color } : null}>${text}</div>`;
  let totalPower = 0;
  let totalMesos = 0;
  const rows = kindData.areas.map((area) => {
    const entry = entries[area.id] || {};
    const plan = symbolPlan(kindData, area, entry, now);
    totalPower += plan.power;
    const next = plan.locked ? 'not unlocked' : plan.maxed ? 'max'
      : plan.affordable ? html`<span style=${{ color: 'var(--ok)' }}>ready now</span>${plan.affordable > 1 ? small(`${plan.affordable} levels`, 'var(--ok)') : null}`
      : plan.nextDue ? html`should be ready${small('update Held', 'var(--warn)')}`
      : plan.nextAt === null ? '—'
      : html`${fmtDay(plan.nextAt, now)}${small(dayWord(kstDays(now, plan.nextAt)))}`;
    const toMax = plan.locked ? '—' : plan.maxed ? 'done'
      : html`${plan.maxAt === null ? '—' : plan.remainingSymbols === 0 ? 'ready now' : plan.maxDue ? 'update Held' : fmtDay(plan.maxAt, now)}${small(fmtMesos(plan.remainingMesos))}`;
    const typedBefore = !plan.locked && !plan.maxed && Number.isFinite(entry.at) && kstDays(entry.at, now) > 0;
    if (!plan.locked) totalMesos += plan.remainingMesos;
    return html`<tr class=${plan.locked ? 'off' : ''}>
      <td>${area.name}<div class="small muted">Lv. ${area.unlockLevel}+</div></td>
      <td><${Stepper} label=${area.name + ' level'} value=${entry.level ?? 0} min=${0} max=${kindData.maxLevel} onChange=${(v) => set(area.id, { level: v ?? 0 })} /></td>
      <td><${NumberInput} label=${area.name + ' symbols held'} value=${entry.have ?? 0} min=${0} max=${9999} onChange=${(v) => set(area.id, { have: v ?? 0 })} />${typedBefore ? small(asOf(entry.at, now)) : null}</td>
      <td><${NumberInput} label=${area.name + ' symbols per day'} value=${entry.daily ?? area.daily} min=${0} max=${999} onChange=${(v) => set(area.id, { daily: v })} /></td>
      <td><${NumberInput} label=${area.name + ' symbols per week'} value=${entry.weekly ?? area.weekly} min=${0} max=${9999} onChange=${(v) => set(area.id, { weekly: v })} /></td>
      <td class="num">${next}</td>
      <td class="num">${plan.locked || plan.maxed ? '—' : fmtMesos(plan.nextMesos)}</td>
      <td class="num">${toMax}</td>
    </tr>`;
  });
  const powerName = kind === 'arcane' ? 'Arcane Power' : 'Sacred Power';
  return html`<${Card} title=${kind === 'arcane' ? 'Arcane symbols' : 'Sacred symbols'} meta=${`${powerName} ${totalPower} · ${fmtMesos(totalMesos)} mesos to max`}>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Area</th><th>Level</th><th>Held</th><th>Per day</th><th>Per week</th><th class="num">Next level</th><th class="num">Next cost</th><th class="num">To max</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="note">Level 0 means not unlocked yet. "Held" is symbols you have but haven't fused. "Per day" starts at the Heroic daily quest amount and "Per week" at the weekly quest amount; both count toward the dates. Change either to match what you really do.</p>
    <p class="note">Dates count from the day you last typed Level or Held, at your per-day amount. The tracker never adds symbols by itself: retype Held after fusing, after a missed day, or when a date has passed.</p>
  <//>`;
}

// A plan, not a record: the list says which trace bosses the character clears each week, and the traces are
// typed in. It can be set from the bosses picked on Bosses, and then changed freely.
function Liberation({ which, def, char, entry, bossById, bossPicks, now }) {
  const plan = liberationPlan(def, entry, now, bossById);
  // Typing the stage or the traces dates the entry (and so does its first change of any kind): the finish date
  // counts from that moment (calc/progress.js).
  const set = (patch) => update((s) => {
    const lib = charSlice(s, 'liberation', char.id, () => ({}));
    const typed = 'stage' in patch || 'traces' in patch || !Number.isFinite((lib[which] || {}).at);
    lib[which] = { ...(lib[which] || {}), ...patch, ...(typed ? { at: Date.now() } : {}) };
  });
  const picks = entry.picks || {};
  const sources = Object.entries(def.sources).sort((a, b) => a[1] - b[1]);
  // Difficulties of one boss share one clear: ticking one un-ticks the others. Lists saved with several ticked
  // still count only the best one (liberationPlan).
  const toggle = (bossId) => {
    const next = { ...picks, [bossId]: !picks[bossId] };
    const b = bossById[bossId];
    if (next[bossId] && b) for (const id of Object.keys(def.sources)) if (id !== bossId && next[id] && bossById[id] && shareKey(bossById[id]) === shareKey(b)) next[id] = false;
    set({ picks: next });
  };
  const fromBosses = liberationFromBosses(def, bossPicks, bossById);
  const mine = Object.keys(picks).filter((id) => picks[id] && def.sources[id] && bossById[id]).sort().join(',');
  const theirs = Object.keys(fromBosses).sort().join(',');
  const doubled = liberationCounted(def, picks, bossById).length < Object.keys(picks).filter((id) => picks[id] && def.sources[id] && bossById[id]).length;
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
    ${!plan.done ? html`<p class=${!Number.isFinite(plan.weeks) ? 'note' : plan.due ? 'warnbox' : 'okbox'}>${!Number.isFinite(plan.weeks)
      ? 'Choose the bosses you clear each week to see a finish date.'
      : plan.due ? `At ${Math.round(plan.perWeek)} a week this should be finished by now. The figures are ${asOf(plan.at, now)}: update the stage and what you collected.`
      : `About ${plan.weeks} ${plan.weeks === 1 ? 'week' : 'weeks'} at ${Math.round(plan.perWeek)} a week, counted from what you had ${asOf(plan.at, now)}: around ${fmtDate(plan.eta)}.`}</p>` : null}
    <div class="toolbar">
      <button type="button" class="btn" id=${`lib-from-bosses-${which}`} disabled=${!theirs || theirs === mine} onClick=${() => set({ picks: fromBosses })}>${theirs && theirs === mine ? 'Matches your Bosses picks' : 'Use the bosses I picked on Bosses'}</button>
      <span class="small muted">${theirs ? 'Sets this list to your picked bosses that give traces.' : html`None of the bosses you picked on <a href="#bosses">Bosses</a> gives traces.`}</span>
    </div>
    <div class="chips" style=${{ gridColumn: 'auto' }}>
      ${sources.map(([bossId, amount]) => {
        const b = bossById[bossId];
        if (!b) return null;
        return html`<button type="button" class="chip" aria-pressed=${String(Boolean(picks[bossId]))}
          onClick=${() => toggle(bossId)}>${b.difficulty} ${b.boss} · ${amount}${b.reset === 'monthly' ? '/mo' : ''}</button>`;
      })}
    </div>
    ${doubled ? html`<p class="note">Difficulties of one boss share one clear, so only the best ticked one counts.</p>` : null}
    <p class="note">This is a plan, not a record of clears. Ticking a boss on Bosses or Today does not add traces: retype "Collected in this stage" after your clears. The finish date counts from the day you last typed it.</p>
    <p class="note">Each stage also needs its quest kill (shown in the stage list). ${def.passMultiplier > 1 ? 'The Genesis Pass triples traces.' : ''}</p>
  <//>`;
}

// A dated note in a data file: a heads-up before the date, a warning to re-check after it.
export function reviewNotice(review, now) {
  if (!review || !review.after) return null;
  const due = now >= Date.parse(review.after);
  return { due, text: `${due ? 'Check these numbers in game: ' : 'Coming up: '}${review.note}` };
}

function SixthJob({ data, char, entry, now, since }) {
  const notice = reviewNotice(data.erda.review, now);
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
    <div class="span2"><${ErdaCosts} data=${data} char=${char} entry=${entry} template=${template} since=${since} now=${now} /></div>
  </div>`;
}

function ItemBurning({ data, char, entry, now, crestsAt }) {
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
  const over = now > end;
  // This week's hunts plus one more week for every Thursday reset still before the end.
  const nextThu = nextReset('thu', now);
  const thursdaysLeft = over ? 0 : 1 + (nextThu > end ? 0 : Math.floor((end - nextThu) / (7 * DAY)) + 1);
  const gate = !nextNeed ? 'covered' : over ? 'the event has ended' : weeks > thursdaysLeft
    ? `${nextNeed.crests.toLocaleString()} for stage ${nextNeed.id.slice(1)} · needs ~${weeks} weeks of hunts, ${thursdaysLeft} left before it ends: out of reach`
    : `${nextNeed.crests.toLocaleString()} for stage ${nextNeed.id.slice(1)} · ~${weeks} week${weeks === 1 ? '' : 's'} of hunts`;
  return html`<${Card} title="Item Burning Plus stages" meta=${`${finished} / ${data.ibp.stages.length} done`}>
    <div class="form-grid">
      <label class="field"><span>Challenge Crests held${crestsAt ? ` (${asOf(crestsAt, now)})` : ''}</span><${NumberInput} className="input" label="Challenge Crests" value=${crests} max=${99999} onChange=${(v) => set((e) => { e.crests = v || 0; })} /></label>
      <div class="field"><span>Next crest gate</span><b>${gate}</b></div>
    </div>
    <p class="note">The crest count is the one you typed: hunts ticked on Checklist do not add to it. Retype it after each week's hunts.</p>
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
  // Dates and day counts here move with the day: redrawn every minute and at each reset, like the other pages.
  const now = useClock({ every: 60000 });
  const char = activeCharacter(state);
  if (!char) return html`<${PageHead} title="Progress" /><${Card} title="Add a character first"><p class="note"><a href="#characters">Add your character</a> to track symbols, liberation and 6th job.</p><//>`;
  const view = state.ui.progressView || 'level';
  const part = (name) => `${name}/${encodeURIComponent(char.id)}/@`;
  const setView = (v) => update((s) => { s.ui.progressView = v; });
  let body;
  if (view === 'level') {
    body = html`<${LevelView} data=${data} state=${state} char=${char} now=${now} />`;
  } else if (view === 'symbols') {
    const entries = state.symbols[char.id] || {};
    body = html`<div class="grid">
      <${SymbolTable} kind="sacred" kindData=${data.symbols.sacred} char=${char} entries=${entries} now=${now} />
      <${SymbolTable} kind="arcane" kindData=${data.symbols.arcane} char=${char} entries=${entries} now=${now} />
      <p class="note">${data.symbols.source}</p>
    </div>`;
  } else if (view === 'liberation') {
    const lib = state.liberation[char.id] || {};
    const bossPicks = (state.bosses[char.id] || {}).picks || {};
    body = html`<div class="grid two">
      <${Liberation} which="genesis" def=${data.liberation.genesis} char=${char} entry=${lib.genesis || {}} bossById=${data.bossById} bossPicks=${bossPicks} now=${now} />
      <${Liberation} which="destiny" def=${data.liberation.destiny} char=${char} entry=${lib.destiny || {}} bossById=${data.bossById} bossPicks=${bossPicks} now=${now} />
      <p class="note span2">${data.liberation.source}</p>
    </div>`;
  } else if (view === 'champions') {
    body = html`<${ChampionsView} data=${data} state=${state} />`;
  } else if (view === 'sixth') {
    body = html`<${SixthJob} data=${data} char=${char} entry=${state.erda[char.id] || {}} now=${now} since=${changedAt(state, part('erda'), now)} />`;
  } else {
    body = html`<${ItemBurning} data=${data} char=${char} entry=${state.ibp[char.id] || {}} now=${now} crestsAt=${changedAt(state, part('ibp'), now)} />`;
  }
  return html`
    <${PageHead} title="Progress">${char.name}: level gates, symbols, weapon liberation, 6th job, Legion Champions and Item Burning.<//>
    <div class="toolbar"><${Seg} label="Progress section" value=${view} onChange=${setView}
      options=${[['level', 'Level'], ['symbols', 'Symbols'], ['liberation', 'Liberation'], ['sixth', '6th job'], ['champions', 'Champions'], ['ibp', 'Item Burning']]} /></div>
    ${body}`;
}
