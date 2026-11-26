import { html } from '../../vendor/htm-preact.mjs';
import { activeCharacter, update } from '../store.js';
import { Card, PageHead, Tile, Bar, useNow, Empty, fmtBig, Left, plural } from '../ui.js';
import { DAY, fmtDate, fmtKst, fmtLeft, kstDays, dayWord } from '../time.js';
import { dailyProgress, whoOf, Item, itemStatus } from './checklist.js';
import { toggleClear } from './bosses.js';
import { liveEvents, upcomingMaintenance, EventRow } from './events.js';
import { computeIncome, fmtMesos } from '../calc/income.js';
import { endingSoon, eventKey } from '../calc/events.js';
import { resetWarnings } from '../calc/reminders.js';
import { upgradeOptions, affordableAt, bestUpgrade, withCubeRates } from '../calc/advice.js';
import { comingUp } from '../calc/upcoming.js';
import { damageEstimateSupported } from '../calc/upgrades.js';
import { weeklyIncome } from './mesos.js';
import { QuickSetup } from './setup.js';
import { sunnyDays, starForceTiming, isStarForcePerk } from '../calc/sunny.js';
import { seasonOutlook } from '../calc/season.js';
import { symbolPlan, liberationPlan, gearSummary, erdaNextSteps, erdaTemplateFor } from '../calc/progress.js';
import { SessionPlanner, StreakRecorder, streakInfo } from './session.js';
import { levelOutlook, knownLevel } from './level.js';

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
  // Korean calendar days, the same count the coin shop uses for the same deadline.
  const d = kstDays(now, o.ends);
  const toggle = (id, on) => update((s) => { s.ui.seasonDone = { ...(s.ui.seasonDone || {}), [id]: on }; if (!on) delete s.ui.seasonDone[id]; });
  return html`<${Card} title=${`${season.name} ends`} meta=${o.ended ? 'season over: last deadlines' : d <= 1 ? `ends ${dayWord(d)}` : `${d} days left`} className="span2">
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

// Everything you tick on a normal day, without leaving Today: core dailies, then the bosses you run.
// The ticks are the same ones as on Checklist and Bosses.
function TodoCard({ data, state, now, who, char, lines, prog }) {
  const cs = state.checklist;
  const group = data.checklist.groups.find((g) => g.key === 'daily');
  const items = group.items.filter((item) => {
    const st = itemStatus(item, group, cs, now, who);
    return !item.optional && !st.locked && !st.expired && !st.link;
  });
  // A boss cleared on another difficulty is done too: the difficulties share one clear.
  const cleared = lines.filter((l) => l.clearedNow || l.doneAs).length;
  return html`<${Card} title="Do today" meta=${`${prog.done} / ${prog.total} dailies${lines.length ? ` · ${cleared} / ${lines.length} ${plural(lines.length, 'boss', 'bosses')}` : ''}`} bodyClass="card-b tight todo">
    <div class="group-h"><h4>Core dailies <span class="hint">reset 09:00 KST</span></h4><a class="small" href="#checklist">Full checklist</a></div>
    ${items.map((item) => html`<${Item} key=${item.id} item=${item} group=${group} cs=${cs} now=${now} who=${who} />`)}
    ${char ? html`<div class="group-h"><h4>Bosses <span class="hint">weekly reset Thu 09:00 KST</span></h4><a class="small" href="#bosses">Pick bosses</a></div>
      ${lines.length ? lines.map((l) => {
        const id = `today-boss-${l.bossId}`;
        return html`<div class=${'row' + (l.clearedNow || l.doneAs ? ' done' : '')}>
          <input type="checkbox" id=${id} checked=${l.clearedNow || Boolean(l.doneAs)} onChange=${(e) => toggleClear(char.id, l.boss, l, e.currentTarget.checked)} />
          <label class="lbl" for=${id}>${l.boss.difficulty} ${l.boss.boss}${l.doneAs ? html` <span class="small muted">done on ${l.doneAs}</span>` : null}</label>
          <div class="right"><span class="min">${l.kind === 'daily' ? 'daily' : l.kind === 'monthly' ? 'monthly' : 'weekly'}${l.value ? ` · ${fmtMesos(l.value)}` : ''}</span></div>
        </div>`;
      }) : html`<p class="note" style=${{ padding: '4px 8px 8px' }}>No bosses picked yet. Choose the ones you run on <a href="#bosses">Bosses</a> and they show up here to tick.</p>`}` : null}
  <//>`;
}

const RESET_NAMES = { daily: 'Daily reset', mon: 'Monday reset', wed: 'Wednesday reset', thu: 'Thursday reset', monthly: 'Monthly reset' };

function ResetWarning({ w }) {
  const parts = [];
  if (w.bosses.count) parts.push(`${w.bosses.count} boss${w.bosses.count === 1 ? '' : 'es'} uncleared (${fmtMesos(w.bosses.value)})`);
  parts.push(...w.items.slice(0, 3));
  const more = w.items.length - 3;
  return html`<p class="warnbox reset-warn" role="status"><b>${RESET_NAMES[w.kind] || 'Reset'} in <${Left} until=${w.at} /></b> (${fmtKst(w.at)}). Still open: ${parts.join(' · ')}${more > 0 ? ` · +${more} more` : ''}.
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
  // Redrawn every 30 s; each draw uses the current time, the same clock a tick uses.
  useNow(30000);
  const now = Date.now();
  const char = activeCharacter(state);
  const who = whoOf(data, state);
  const prog = dailyProgress(data.checklist, state.checklist, now, who);
  const { streak } = streakInfo(state.checklist.history || {}, now);
  const soon = endingSoon(liveEvents(data, state, now), now, { showSales: state.ui.todaySales, hidden: state.ui.hiddenEvents });
  const ending = soon.shown;
  const maint = upcomingMaintenance(data, now)[0];
  const income = char ? computeIncome(state.characters, state, data.bosses, data.bossById, now).perChar[char.id] : null;
  const gear = char ? gearSummary(data.gear, state.gear[char.id], char.mainStat || 'STR') : null;
  const genesis = char ? liberationPlan(data.liberation.genesis, state.liberation[char.id]?.genesis, now, data.bossById) : null;
  const erdaState = char ? state.erda[char.id] : null;
  const erdaNext = char ? erdaNextSteps(data.erda.templates[erdaTemplateFor(data.erda, char, erdaState)], erdaState || {}, 2) : [];
  const symbols = char ? nextSymbolLevels(data, state, char.id) : [];
  const level = char ? levelOutlook(data, state, char, now) : null;
  const gate = level && level.gates[0];
  const gearGap = gear ? gear.gaps.find((r) => !r.entry.temporary) : null;
  const best = char ? bestUpgrade(upgradeOptions(data.gear, state.gear[char.id], withCubeRates(data.upgrades, state.mesos.cubeRates), data.gearStats, damageEstimateSupported(char.mainStat) ? (state.gear[char.id] || {}).stats : null, { fl: data.flames, mainStat: char.mainStat || 'STR', weights: (state.ui.flameCalc || {}).weights })) : null;
  const weekly = weeklyIncome(data, state, now).total;
  const bestAt = best ? affordableAt(best.cost, state.mesos.held, weekly, now) : null;
  const warnings = resetWarnings(data.checklist, state.checklist, income ? income.lines : [], now, { who, weeklyCap: data.bosses.limits.weeklyPerCharacter, weeklyEarned: income ? income.unpicked.filter((u) => u.kind === 'weekly').flatMap((u) => u.earned) : [] });
  const timing = best && best.kind === 'sf' ? starForceTiming(data.events.sunny, best.cost, best.sunnyCost, now) : null;
  const sunday = sunnyDays(data.events.sunny, now)[0];
  const coming = comingUp(data.upcoming, now, char, 5, data.events.events);

  return html`
    <${StreakRecorder} data=${data} state=${state} now=${now} />
    <${PageHead} title=${char ? `Today · ${char.name}` : 'Today'}>${char ? `${char.cls || 'Character'}${char.level ? ' · Lv. ' + char.level : ''}` : 'Add a character to see boss income, gear and level dates here.'}<//>
    ${warnings.map((w) => html`<${ResetWarning} w=${w} />`)}
    <div class="tiles">
      <div class=${'tile' + (prog.total && prog.done >= prog.total ? ' ok' : '')}><span class="k">Core dailies</span><span class="v">${prog.done} / ${prog.total}</span><${Bar} pct=${prog.total ? prog.done / prog.total : 0} />
        <span class="s">${streak ? `${streak}-day streak` : 'start a streak today'} · <a href="#checklist">checklist</a></span></div>
      ${income ? html`<${Tile} k="Crystals this week" v=${fmtMesos(income.earned)} s=${`of ${fmtMesos(income.target)} planned · resets Thu 09:00 KST`} accent />` : null}
      ${gate ? html`<${Tile} k=${`Next gate · Lv. ${gate.level}`} v=${gate.due ? 'due' : gate.at ? dayWord(kstDays(now, gate.at)) : '—'} s=${gate.due ? `your last reading says you should be there · ${gate.what}` : gate.at ? `${fmtDate(gate.at)} · ${gate.what}` : level.last && level.last.level < data.upgrades.exp.from ? `dates from Lv. ${data.upgrades.exp.from} · ${gate.what}` : 'log your level on Progress for a date'} />` : null}
      <${Tile} k="Events ending this week" v=${String(ending.length)} s=${ending[0] ? html`next: ${ending[0].title} in <${Left} until=${Date.parse(ending[0].end)} />` : soon.salesHidden ? 'only Cash Shop sales' : 'none'} />
      ${maint ? html`<${Tile} k="Next maintenance" v=${fmtKst(Date.parse(maint.start), false)} s=${`${fmtKst(Date.parse(maint.start))} → ${fmtKst(Date.parse(maint.end))}`} />` : null}
    </div>
    ${char ? null : html`<div class="grid two" style=${{ marginBottom: '14px' }}><${QuickSetup} data=${data} /></div>`}
    ${best ? html`<div class="insight best"><span class="k">Best next upgrade</span><span class="big accent">${best.label}</span>
      <span>Expected ${fmtBig(best.cost)}${best.kind === 'sf' ? ` · ${fmtBig(best.sunnyCost)} on a Star Force Sunny Sunday` : ` · ${fmtBig(best.cost90)} with bad luck (9 in 10)`} · <b>${bestAt === null ? 'add your income on Mesos for a date' : bestAt === Infinity ? 'not in reach at your income' : bestAt <= now ? 'affordable now' : `affordable ${fmtDate(bestAt)}`}</b></span>
      ${timing && timing.kind === 'now' ? html`<span class="small" style=${{ color: 'var(--ok)' }}>A Star Force Sunny Sunday is on now, until ${fmtKst(timing.day.end)}. Do it today and save about ${fmtBig(timing.saves)}.</span>` : null}
      ${timing && timing.kind === 'wait' ? html`<span class="small" style=${{ color: 'var(--warn)' }}>Wait for the Star Force Sunny Sunday on ${fmtKst(timing.day.start)}: it saves about ${fmtBig(timing.saves)}.</span>` : null}
      ${timing && timing.kind === 'none' ? html`<span class="small muted">No Star Force Sunny Sunday is announced through ${fmtDate(timing.through)}, so there is no discount to wait for.</span>` : null}
      ${best.by === 'damage'
        ? html`<span class="small muted">Most damage per meso among your Star Force upgrades and flame rerolls: about <b>+${(best.dmg * 100).toFixed(2)}% damage</b>${best.dmgPartial ? ' or more (weapon ATT below 16 stars is not counted)' : ''}${best.kind === 'flame' ? ` (a better flame turns up about 1 try in ${Math.max(1, Math.round(best.flames))}, worth about ${Math.round(best.flameGain)} more flame score)` : ''}. An estimate from the stats you entered on Gear; potential tier-ups aren't ranked because their result depends on the lines you roll. <a href="#gear">Gear</a> · <a href="#mesos">Mesos</a></span>`
        : html`<span class="small muted">Most gear score per meso among your permanent items (+${(best.gain * 100).toFixed(1)}% of your gear target). The score is this tracker's own, not a damage number. Enter your stats on <a href="#gear">Gear</a> to rank by estimated damage instead. <a href="#mesos">Mesos</a></span>`}</div>` : null}
    <div class="grid wide-left">
      <div class="grid">
        <${TodoCard} data=${data} state=${state} now=${now} who=${who} char=${char} lines=${income ? income.lines : []} prog=${prog} />
        <${SessionPlanner} data=${data} state=${state} now=${now} />
      </div>
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
        ${coming.length ? html`<${Card} title="Coming to GMS" meta="announced by Nexon" bodyClass="card-b tight">
          ${coming.map((c) => html`<div class="goal"><div><b>${c.title}</b><div class="small muted">${c.note}</div></div>
            <span class=${'date' + (c.days <= 7 ? ' now' : '')}>${c.day ? fmtDate(c.t) : fmtKst(c.t)}</span><span class="small muted">${c.when}</span></div>`)}
          <p class="note" style=${{ padding: '6px 8px' }}>A date without a time is Nexon's server day: it can arrive up to 09:00 KST the next morning, usually after maintenance. Event start dates are read from Nexon's posts every 6 hours. The rest: ${(data.upcoming && data.upcoming.source) || 'typed in by hand.'}</p>
        <//>` : null}
        ${char ? html`<${Card} title="Next up">
          ${symbols.length ? html`<div><b>Symbols</b>${symbols.map((s) => html`<div class="small">${s.name} Lv. ${s.level} → ${s.level + 1} in ${s.daysToNext} day${s.daysToNext === 1 ? '' : 's'} · ${fmtMesos(s.nextMesos)} mesos</div>`)}</div>` : html`<p class="note">Enter your symbol levels on <a href="#progress">Progress</a> to see level-up dates.</p>`}
          ${erdaNext.length ? html`<div><b>6th job</b>${erdaNext.map((s) => html`<div class="small">${s.label}</div>`)}</div>` : null}
          ${gearGap && !best ? html`<div><b>Gear</b><div class="small">${gearGap.slot.name}: ${gearGap.gaps.slice(0, 2).join(', ')}</div></div>` : null}
          ${genesis && !genesis.done && Number.isFinite(genesis.weeks) ? html`<div><b>Genesis</b><div class="small">${genesis.remaining.toLocaleString()} ${plural(genesis.remaining, 'trace')} left · about ${genesis.weeks} ${plural(genesis.weeks, 'week')}</div></div>` : null}
        <//>` : null}
      </div>
    </div>
    ${char && char.challenger && data.season ? html`<div class="grid two" style=${{ marginTop: '2px' }}><${SeasonCard} season=${data.season} state=${state} now=${now} /></div>` : null}`;
}
