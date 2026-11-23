import { html } from '../../vendor/htm-preact.mjs';
import { activeCharacter } from '../store.js';
import { Card, PageHead, Tile, Bar, useNow, Empty, fmtBig } from '../ui.js';
import { DAY, fmtDate, fmtKst, fmtLeft } from '../time.js';
import { dailyProgress } from './checklist.js';
import { liveEvents, upcomingMaintenance, EventRow } from './events.js';
import { computeIncome, fmtMesos } from '../calc/income.js';
import { symbolPlan, liberationPlan, gearSummary, erdaNextSteps } from '../calc/progress.js';
import { SessionPlanner, StreakRecorder, streakInfo } from './session.js';
import { levelOutlook } from './level.js';
import { slotOutlook } from './gear.js';

function nextSymbolLevels(data, state, charId) {
  const entries = state.symbols[charId] || {};
  const out = [];
  for (const kind of ['sacred', 'arcane']) {
    const kd = data.symbols[kind];
    for (const area of kd.areas) {
      const plan = symbolPlan(kd, area, entries[area.id]);
      if (plan.locked || plan.maxed || !Number.isFinite(plan.daysToNext)) continue;
      out.push({ name: area.name, kind, ...plan });
    }
  }
  // Sacred symbols first (they carry progression past 260), then Arcane to fill the space.
  const bySoonest = (a, b) => a.daysToNext - b.daysToNext;
  return [...out.filter((s) => s.kind === 'sacred').sort(bySoonest), ...out.filter((s) => s.kind === 'arcane').sort(bySoonest)].slice(0, 3);
}

export function TodayPage({ data, state }) {
  const now = useNow(30000);
  const char = activeCharacter(state);
  const prog = dailyProgress(data.checklist, state.checklist, now);
  const { streak } = streakInfo(state.checklist.history || {}, now);
  const ending = liveEvents(data, state, now)
    .filter((e) => Date.parse(e.end) - now < 7 * DAY)
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end));
  const maint = upcomingMaintenance(data, now)[0];
  const income = char ? computeIncome(state.characters, state, data.bosses, data.bossById, now).perChar[char.id] : null;
  const gear = char ? gearSummary(data.gear, state.gear[char.id]) : null;
  const genesis = char ? liberationPlan(data.liberation.genesis, state.liberation[char.id]?.genesis, now) : null;
  const erdaState = char ? state.erda[char.id] : null;
  const erdaNext = char ? erdaNextSteps(data.erda.templates[erdaState?.template || 'erel'], erdaState || {}, 2) : [];
  const symbols = char ? nextSymbolLevels(data, state, char.id) : [];
  const level = char ? levelOutlook(data, state, char, now) : null;
  const gate = level && level.gates[0];
  const gearGap = gear ? gear.gaps.find((r) => !r.entry.temporary) : null;
  const gapCost = gearGap ? slotOutlook(gearGap.slot, gearGap.entry, gearGap.target, data.upgrades) : null;

  return html`
    <${StreakRecorder} data=${data} state=${state} now=${now} />
    <${PageHead} title=${char ? `Today · ${char.name}` : 'Today'}>${char ? `${char.cls || 'Character'}${char.level ? ' · Lv. ' + char.level : ''}` : 'Add a character to see boss income, gear and level dates here.'}<//>
    <div class="tiles">
      <div class=${'tile' + (prog.total && prog.done >= prog.total ? ' ok' : '')}><span class="k">Core dailies</span><span class="v">${prog.done} / ${prog.total}</span><${Bar} pct=${prog.total ? prog.done / prog.total : 0} />
        <span class="s">${streak ? `${streak}-day streak` : 'start a streak today'} · <a href="#checklist">checklist</a></span></div>
      ${income ? html`<${Tile} k="Crystals this week" v=${fmtMesos(income.earned)} s=${`of ${fmtMesos(income.planned)} planned · resets Thu 09:00 KST`} accent />` : null}
      ${gate ? html`<${Tile} k=${`Next gate · Lv. ${gate.level}`} v=${gate.at ? (gate.days < 1 ? 'today' : `${Math.ceil(gate.days)} days`) : '—'} s=${gate.at ? `${fmtDate(gate.at)} · ${gate.what}` : 'log your level on Progress for a date'} />` : null}
      <${Tile} k="Events ending this week" v=${String(ending.length)} s=${ending[0] ? `next: ${ending[0].title} in ${fmtLeft(Date.parse(ending[0].end) - now)}` : 'none'} />
      ${maint ? html`<${Tile} k="Next maintenance" v=${fmtKst(Date.parse(maint.start), false)} s=${`${fmtKst(Date.parse(maint.start))} → ${fmtKst(Date.parse(maint.end))}`} />` : null}
    </div>
    <div class="grid wide-left">
      <${SessionPlanner} data=${data} state=${state} now=${now} />
      <div class="grid">
        <${Card} title="Ending soon" meta="next 7 days" bodyClass="card-b tight">
          ${ending.length ? ending.slice(0, 5).map((e) => html`<${EventRow} key=${e.id} e=${e} now=${now} showPost=${true} />`) : html`<div style=${{ padding: '0 8px' }}><${Empty}>Nothing live ends in the next 7 days.<//></div>`}
          <p class="note" style=${{ padding: '6px 8px' }}><a href="#events">Event timeline</a></p>
        <//>
        ${char ? html`<${Card} title="Next up">
          ${symbols.length ? html`<div><b>Symbols</b>${symbols.map((s) => html`<div class="small">${s.name} Lv. ${s.level} → ${s.level + 1} in ${s.daysToNext} day${s.daysToNext === 1 ? '' : 's'} · ${fmtMesos(s.nextMesos)} mesos</div>`)}</div>` : html`<p class="note">Enter your symbol levels on <a href="#progress">Progress</a> to see level-up dates.</p>`}
          ${erdaNext.length ? html`<div><b>6th job</b>${erdaNext.map((s) => html`<div class="small">${s.label}</div>`)}</div>` : null}
          ${gearGap ? html`<div><b>Gear</b><div class="small">${gearGap.slot.name}: ${gearGap.gaps.slice(0, 2).join(', ')}${gapCost && gapCost.sf ? ` · Star Force ≈ ${fmtBig(gapCost.sf.plain.cost)}` : ''}</div></div>` : null}
          ${genesis && !genesis.done && Number.isFinite(genesis.weeks) ? html`<div><b>Genesis</b><div class="small">${genesis.remaining.toLocaleString()} traces left · about ${genesis.weeks} weeks</div></div>` : null}
        <//>` : html`<${Card} title="Get started"><p class="note">1. <a href="#characters">Add your character</a>. 2. Pick your bosses on <a href="#bosses">Bosses</a>. 3. Fill in your gear on <a href="#gear">Gear</a> and your level on <a href="#progress">Progress</a>.</p><//>`}
      </div>
    </div>`;
}
