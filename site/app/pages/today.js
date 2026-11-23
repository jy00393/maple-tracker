import { html } from '../../vendor/htm-preact.mjs';
import { activeCharacter, update } from '../store.js';
import { Card, PageHead, Tile, Bar, useNow, Empty, fmtBig } from '../ui.js';
import { DAY, fmtDate, fmtKst, fmtLeft } from '../time.js';
import { dailyProgress } from './checklist.js';
import { liveEvents, upcomingMaintenance, EventRow } from './events.js';
import { computeIncome, fmtMesos } from '../calc/income.js';
import { endingSoon, eventKey } from '../calc/events.js';
import { resetWarnings } from '../calc/reminders.js';
import { upgradeOptions, affordableAt } from '../calc/advice.js';
import { weeklyIncome } from './mesos.js';
import { QuickSetup } from './setup.js';
import { sunnyDays, starForceTiming, isStarForcePerk } from '../calc/sunny.js';
import { seasonOutlook } from '../calc/season.js';
import { symbolPlan, liberationPlan, gearSummary, erdaNextSteps } from '../calc/progress.js';
import { SessionPlanner, StreakRecorder, streakInfo } from './session.js';
import { levelOutlook } from './level.js';

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

// Challenger World: what must be claimed, spent or used before the season ends. Ticks are yours; dates are Nexon's.
function SeasonCard({ season, state, now }) {
  const o = seasonOutlook(season, state.ui.seasonDone, now);
  if (!o || o.over) return null;
  const toggle = (id, on) => update((s) => { s.ui.seasonDone = { ...(s.ui.seasonDone || {}), [id]: on }; if (!on) delete s.ui.seasonDone[id]; });
  return html`<${Card} title=${`${season.name} ends`} meta=${o.ended ? 'season over: last deadlines' : `${o.daysLeft} day${o.daysLeft === 1 ? '' : 's'} left`} className="span2">
    <div class="insight"><span class="k">Season ends</span><span class="big accent">${fmtKst(o.ends)}</span>
      <span class="small muted">${o.open} of ${o.total} end-of-season steps still open. Challenger gear stops working then, so spend nothing on it.</span></div>
    ${o.groups.map((g) => html`<details open=${o.daysLeft <= 14 && !g.passed && g.items.some((i) => !i.done) && g === o.groups.find((x) => !x.passed && x.items.some((i) => !i.done))}>
      <summary><b>By ${fmtKst(g.at)}</b> <span class="small muted">· ${g.passed ? 'passed' : `${fmtLeft(g.left)} left`} · ${g.items.filter((i) => !i.done).length} open</span></summary>
      ${g.items.map((i) => html`<div class=${'row' + (i.done ? ' done' : '')}>
        <input type="checkbox" id=${'season-' + i.id} checked=${i.done} onChange=${(e) => toggle(i.id, e.currentTarget.checked)} />
        <label class="lbl" for=${'season-' + i.id}>${i.label}</label>
        <p class="note">${i.detail}</p>
      </div>`)}
    </details>`)}
    <details><summary class="small muted">Good to know (${season.notes.length}) and what Nexon hasn't said yet</summary>
      ${season.notes.map((n) => html`<p class="note"><b>${n.label}.</b> ${n.detail}</p>`)}
      <p class="warnbox">${season.unknown}</p>
    </details>
    <p class="note">${season.source}</p>
  <//>`;
}

const RESET_NAMES = { daily: 'Daily reset', mon: 'Monday reset', wed: 'Wednesday reset', thu: 'Thursday reset', monthly: 'Monthly reset' };

function ResetWarning({ w }) {
  const parts = [];
  if (w.bosses.count) parts.push(`${w.bosses.count} boss${w.bosses.count === 1 ? '' : 'es'} uncleared (${fmtMesos(w.bosses.value)})`);
  parts.push(...w.items.slice(0, 3));
  const more = w.items.length - 3;
  return html`<p class="warnbox reset-warn" role="status"><b>${RESET_NAMES[w.kind] || 'Reset'} in ${fmtLeft(w.left)}</b> (${fmtKst(w.at)}). Still open: ${parts.join(' · ')}${more > 0 ? ` · +${more} more` : ''}.
    <a href=${w.bosses.count ? '#bosses' : '#checklist'}>Open</a></p>`;
}

// "Not for me": hides one event from Today. Entries are dropped once the event has ended.
function hideEvent(e, now) {
  update((s) => {
    const hidden = s.ui.hiddenEvents || {};
    for (const [k, end] of Object.entries(hidden)) if (end < now) delete hidden[k];
    hidden[eventKey(e)] = Date.parse(e.end);
    s.ui.hiddenEvents = hidden;
  });
}

export function TodayPage({ data, state }) {
  const now = useNow(30000);
  const char = activeCharacter(state);
  const prog = dailyProgress(data.checklist, state.checklist, now, char?.level);
  const { streak } = streakInfo(state.checklist.history || {}, now);
  const soon = endingSoon(liveEvents(data, state, now), now, { showSales: state.ui.todaySales, hidden: state.ui.hiddenEvents });
  const ending = soon.shown;
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
  const best = char ? upgradeOptions(data.gear, state.gear[char.id], data.upgrades)[0] : null;
  const weekly = weeklyIncome(data, state, now).total;
  const bestAt = best ? affordableAt(best.cost, state.mesos.held, weekly, now) : null;
  const warnings = resetWarnings(data.checklist, state.checklist, income ? income.lines : [], now, { level: char?.level });
  const timing = best && best.kind === 'sf' ? starForceTiming(data.events.sunny, best.cost, best.sunnyCost, now) : null;
  const sunday = sunnyDays(data.events.sunny, now)[0];

  return html`
    <${StreakRecorder} data=${data} state=${state} now=${now} />
    <${PageHead} title=${char ? `Today · ${char.name}` : 'Today'}>${char ? `${char.cls || 'Character'}${char.level ? ' · Lv. ' + char.level : ''}` : 'Add a character to see boss income, gear and level dates here.'}<//>
    ${warnings.map((w) => html`<${ResetWarning} w=${w} />`)}
    <div class="tiles">
      <div class=${'tile' + (prog.total && prog.done >= prog.total ? ' ok' : '')}><span class="k">Core dailies</span><span class="v">${prog.done} / ${prog.total}</span><${Bar} pct=${prog.total ? prog.done / prog.total : 0} />
        <span class="s">${streak ? `${streak}-day streak` : 'start a streak today'} · <a href="#checklist">checklist</a></span></div>
      ${income ? html`<${Tile} k="Crystals this week" v=${fmtMesos(income.earned)} s=${`of ${fmtMesos(income.planned)} planned · resets Thu 09:00 KST`} accent />` : null}
      ${gate ? html`<${Tile} k=${`Next gate · Lv. ${gate.level}`} v=${gate.at ? (gate.days < 1 ? 'today' : `${Math.ceil(gate.days)} days`) : '—'} s=${gate.at ? `${fmtDate(gate.at)} · ${gate.what}` : 'log your level on Progress for a date'} />` : null}
      <${Tile} k="Events ending this week" v=${String(ending.length)} s=${ending[0] ? `next: ${ending[0].title} in ${fmtLeft(Date.parse(ending[0].end) - now)}` : soon.salesHidden ? 'only Cash Shop sales' : 'none'} />
      ${maint ? html`<${Tile} k="Next maintenance" v=${fmtKst(Date.parse(maint.start), false)} s=${`${fmtKst(Date.parse(maint.start))} → ${fmtKst(Date.parse(maint.end))}`} />` : null}
    </div>
    ${char ? null : html`<div class="grid two" style=${{ marginBottom: '14px' }}><${QuickSetup} data=${data} /></div>`}
    ${best ? html`<div class="insight best"><span class="k">Best next upgrade</span><span class="big accent">${best.label}</span>
      <span>Expected ${fmtBig(best.cost)}${best.kind === 'sf' ? ` · ${fmtBig(best.sunnyCost)} on a Star Force Sunny Sunday` : ` · ${fmtBig(best.cost90)} with bad luck (9 in 10)`} · <b>${bestAt === null ? 'add your income on Mesos for a date' : bestAt <= now ? 'affordable now' : `affordable ${fmtDate(bestAt)}`}</b></span>
      ${timing && timing.kind === 'now' ? html`<span class="small" style=${{ color: 'var(--ok)' }}>A Star Force Sunny Sunday is on now, until ${fmtKst(timing.day.end)}. Do it today and save about ${fmtBig(timing.saves)}.</span>` : null}
      ${timing && timing.kind === 'wait' ? html`<span class="small" style=${{ color: 'var(--warn)' }}>Wait for the Star Force Sunny Sunday on ${fmtKst(timing.day.start)}: it saves about ${fmtBig(timing.saves)}.</span>` : null}
      ${timing && timing.kind === 'none' ? html`<span class="small muted">No Star Force Sunny Sunday is announced through ${fmtDate(timing.through)}, so there is no discount to wait for.</span>` : null}
      <span class="small muted">Most gear score per meso among your permanent items (+${(best.gain * 100).toFixed(1)}% of your gear target). The score is this tracker's own, not a damage number. <a href="#gear">Gear</a> · <a href="#mesos">Mesos</a></span></div>` : null}
    ${char && char.challenger && data.season ? html`<div class="grid two" style=${{ marginBottom: '14px' }}><${SeasonCard} season=${data.season} state=${state} now=${now} /></div>` : null}
    <div class="grid wide-left">
      <${SessionPlanner} data=${data} state=${state} now=${now} />
      <div class="grid">
        <${Card} title="Ending soon" meta="next 7 days" bodyClass="card-b tight">
          ${ending.length ? ending.slice(0, 5).map((e) => html`<${EventRow} key=${e.id} e=${e} now=${now} showPost=${true} onHide=${() => hideEvent(e, now)} />`) : html`<div style=${{ padding: '0 8px' }}><${Empty}>${soon.salesHidden ? 'No gameplay event ends in the next 7 days.' : 'Nothing live ends in the next 7 days.'}<//></div>`}
          <p class="note" style=${{ padding: '6px 8px' }}><a href="#events">Event timeline</a>
            ${state.ui.todaySales ? html` · <button type="button" class="linkbtn" onClick=${() => update((s) => { s.ui.todaySales = false; })}>Hide Cash Shop sales</button>` : soon.salesHidden ? html` · ${soon.salesHidden} Cash Shop sale${soon.salesHidden === 1 ? '' : 's'} hidden · <button type="button" class="linkbtn" onClick=${() => update((s) => { s.ui.todaySales = true; })}>Show</button>` : null}
            ${soon.dismissed ? html` · ${soon.dismissed} hidden by you · <button type="button" class="linkbtn" onClick=${() => update((s) => { s.ui.hiddenEvents = {}; })}>Restore</button>` : null}</p>
        <//>
        ${sunday ? html`<${Card} title=${sunday.active ? 'Sunny Sunday is on' : 'Next Sunny Sunday'} meta=${sunday.active ? `until ${fmtKst(sunday.end)}` : fmtKst(sunday.start)}>
          ${sunday.perks.filter((p) => !/^(Does not|Mesos used|Sol Erda obtained|Can be|Can reach|Select|Cannot|Multiplied|Elite Monsters summoned)/i.test(p)).slice(0, 6).map((p) => html`<div class="small" style=${isStarForcePerk(p) ? { color: 'var(--ok)', fontWeight: 600 } : null}>${p}</div>`)}
          <p class="note">From Nexon's patch notes. Runs Sunday 09:00 KST to Monday 08:59 KST.</p>
        <//>` : null}
        ${char ? html`<${Card} title="Next up">
          ${symbols.length ? html`<div><b>Symbols</b>${symbols.map((s) => html`<div class="small">${s.name} Lv. ${s.level} → ${s.level + 1} in ${s.daysToNext} day${s.daysToNext === 1 ? '' : 's'} · ${fmtMesos(s.nextMesos)} mesos</div>`)}</div>` : html`<p class="note">Enter your symbol levels on <a href="#progress">Progress</a> to see level-up dates.</p>`}
          ${erdaNext.length ? html`<div><b>6th job</b>${erdaNext.map((s) => html`<div class="small">${s.label}</div>`)}</div>` : null}
          ${gearGap && !best ? html`<div><b>Gear</b><div class="small">${gearGap.slot.name}: ${gearGap.gaps.slice(0, 2).join(', ')}</div></div>` : null}
          ${genesis && !genesis.done && Number.isFinite(genesis.weeks) ? html`<div><b>Genesis</b><div class="small">${genesis.remaining.toLocaleString()} traces left · about ${genesis.weeks} weeks</div></div>` : null}
        <//>` : null}
      </div>
    </div>`;
}
