// Challenger World tiers: Progress → Challenger (the planner), one line on Today, the Arcane Seal advice on the
// Checklist row, and the coins still to come from missions for the Challenger World shop. All numbers come from
// data/challenger.json (Nexon notice 47305); the maths is in calc/challenger.js.
import { html } from '../../vendor/htm-preact.mjs';
import { update, charSlice } from '../store.js';
import { Card, Fold, Tile, Bar, Empty, plural } from '../ui.js';
import { fmtDate, fmtKst, kstDays, dayWord } from '../time.js';
import { marginOf, minCpFor, fmtCp } from '../calc/bosscp.js';
import { erdaTemplateFor } from '../calc/progress.js';
import {
  tiersOf, standing, targetPlan, earliestTier, likelyTarget, missionCoins, sealAdvice, sealDays, epicPlus, bossMissions,
  missionState, seasonalFor, levelAtTime, nextLevelMission, levelPoints
} from '../calc/challenger.js';
import { knownLevel, levelOutlook, levelPath } from './level.js';
import { undoable } from '../undo.js';

const num = (n) => Math.round(n).toLocaleString('en-US');
const named = (m) => `${m.boss.difficulty} ${m.boss.boss}`;
const runText = (r) => `${named(r.run)} +${num(r.gain)}`;
const listWords = (l) => (l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`);
// The longest list of runs the card shows; the rest are summed up in one line.
const SHOWN = 8;

// What the planner needs to know about a character (see calc/challenger.js).
export function challengerCtx(data, state, char) {
  const level = knownLevel(data, state, char);
  const templates = (data.erda && data.erda.templates) || {};
  const tpl = data.erda ? templates[erdaTemplateFor(data.erda, char, (state.erda || {})[char.id])] : null;
  const entry = (state.challenger || {})[char.id] || {};
  return {
    level,
    done: entry.done && typeof entry.done === 'object' ? entry.done : {},
    higherCounts: state.ui.cwHigherCounts === true,
    cp: Number(char.cp) > 0 ? Number(char.cp) : 0,
    margin: marginOf(data.bossCp, state.ui.bossMargin),
    cpData: data.bossCp,
    bossById: data.bossById || {},
    who: { challenger: Boolean(char.challenger), level },
    world: char.world,
    erdaLink: Boolean(tpl && /erda link/i.test(tpl.name || ''))
  };
}

// Everything the card and the Today line show. `withPath`: work out the level projection (skipped for the
// Checklist note when a target is saved).
export function challengerOutlook(data, state, char, now) {
  const cw = data.challenger;
  if (!cw || !char || !char.challenger) return null;
  const ctx = challengerCtx(data, state, char);
  const end = Date.parse(cw.ends);
  const over = !(now < end);
  const o = levelOutlook(data, state, char, now);
  const path = over ? [] : levelPath(data, state, char, now, end, o);
  const entry = (state.challenger || {})[char.id] || {};
  const tiers = tiersOf(cw);
  const chosen = tiers.some((t) => t.id === entry.target) ? entry.target : null;
  const target = chosen || likelyTarget(cw, ctx, path, end);
  return { cw, ctx, end, over, path, rate: o.rate, chosen, target, st: standing(cw, ctx) };
}

// "possible from 12 Dec" style words for earliestTier.
function whenText(e, now) {
  if (!e) return null;
  if (e.now) return 'possible now';
  return `possible from about ${fmtDate(e.at)} (Lv. ${e.level}, ${dayWord(kstDays(now, e.at))})`;
}

function stateText(m, s, path, ctx, now) {
  if (s.status === 'done') return 'done';
  if (s.status === 'can') return 'you can enter it';
  if (s.status === 'cp') return `needs ${fmtCp(minCpFor(ctx.cpData, m.boss) * (ctx.margin || 1))} Combat Power${ctx.margin > 1 ? ' with your room' : ''}`;
  if (s.status === 'level') {
    const p = (path || []).find((x) => x.level >= m.boss.minLevel);
    return `from Lv. ${m.boss.minLevel}${p ? `, about ${fmtDate(p.at)}` : ''}${s.reach === 'no' ? `; needs ${fmtCp(minCpFor(ctx.cpData, m.boss) * (ctx.margin || 1))} Combat Power` : s.reach === 'unknown' ? '; no Combat Power figure for it' : ''}`;
  }
  if (s.status === 'closed') return 'Challenger World only';
  if (s.status === 'nocp') return 'type your Combat Power on Bosses to check';
  return 'no Combat Power figure for it: check in game';
}

// Mission ticks go through the Undo bar like every other tick.
const setTick = (charId, id, on, label = 'a Challenger mission') => undoable(`${on ? 'Ticked' : 'Unticked'} ${label}`, () => update((s) => {
  const c = charSlice(s, 'challenger', charId, () => ({ done: {} }));
  if (!c.done || typeof c.done !== 'object') c.done = {};
  if (on) c.done[id] = Date.now();
  else delete c.done[id];
}));

function MissionRow({ id, label, right, note, done, implied, onChange }) {
  return html`<div class=${'row' + (done ? ' done' : '')}>
    <input type="checkbox" id=${'cw-' + id} checked=${done} disabled=${implied} onChange=${(e) => onChange(e.currentTarget.checked)} />
    <label class="lbl" for=${'cw-' + id}>${label}</label>
    <div class="right"><span class="min">${right}</span></div>
    ${note ? html`<p class="note">${note}</p>` : null}
  </div>`;
}

// The one-time check the player is asked for: whether a harder clear also completes the easier listed missions.
function HigherRule({ cw, state }) {
  const on = state.ui.cwHigherCounts === true;
  return html`<div class="warnbox">
    <b>Check in game: does a Hard clear also complete the Normal mission?</b>
    <div class="small">${cw.higherUnknown} Until you know, every listed mission counts on its own. A difficulty Nexon does not list (Extreme Lotus) counts as the highest listed one.</div>
    <label class="toggle" style=${{ marginTop: '6px' }}><input type="checkbox" id="cw-higher" checked=${on} onChange=${(e) => { const v = e.currentTarget.checked; update((s) => { s.ui.cwHigherCounts = v; }); }} /> Yes, a harder clear completes the easier missions (this device only)</label>
  </div>`;
}

// The Arcane Seal line: break now or save the wands for a better barrier.
// `left`: the time to the season end in ms; the save window never runs past it.
export function sealText(cw, ctx, target, left = Infinity) {
  const a = sealAdvice(cw, ctx, target, left);
  if (!a) return null;
  const tiers = tiersOf(cw);
  const name = (id) => (tiers.find((t) => t.id === id) || {}).name || id;
  const here = `Stage ${a.stage.stage} (${a.stage.name})`;
  if (a.kind === 'best') return `Your tier breaks ${here}, the best barrier. Break them as they come.`;
  if (a.why === 'ending') return `Break them now: the Arcane Seal ends ${fmtKst(Date.parse(cw.ends))}, and wands still saved then are lost.`;
  const better = `Stage ${a.next.stage} (Epic or better ${epicPlus(a.next).toFixed(1)}%, now ${epicPlus(a.stage).toFixed(1)}%)`;
  if (a.kind === 'save') {
    const short = a.days < sealDays(cw);
    return `Save them if you can clear ${listWords(a.runs.map((r) => named(r.run)))} within ${a.days} ${plural(a.days, 'day')}: that is ${num(a.runs.reduce((x, r) => x + r.gain, 0))} points, enough for ${a.nextTier.name}, where barriers are ${better}. ${short ? `The season ends ${fmtKst(Date.parse(cw.ends))}, so don't save longer.` : `Only ${cw.seal.cap} wands are kept, so don't save longer.`}`;
  }
  if (a.why === 'target') return `Break them now: your target, ${name(target)}, still breaks ${here}. ${a.nextTier.name} would open ${better}.`;
  return `Break them now: ${a.nextTier.name} opens ${better} but is ${num(a.need)} points away, more than the bosses you can clear now give.`;
}

// For the Checklist row of the Arcane Seal: the advice for this character, or null.
export function sealNoteFor(data, state, char, now = Date.now()) {
  try {
    const o = challengerOutlook(data, state, char, now);
    if (!o || o.over) return null;
    return sealText(o.cw, o.ctx, o.target, o.end - now);
  } catch {
    return null;
  }
}

// Coins still to come from Challenger World missions, once each, for the Challenger World shop.
export function challengerCoins(data, state, char, now) {
  const o = challengerOutlook(data, state, char, now);
  if (!o || o.over) return null;
  const endLevel = levelAtTime(o.path, o.ctx.level, o.end);
  return { ...missionCoins(o.cw, o.ctx, endLevel), endLevel, projected: Boolean(o.rate), erdaLink: o.ctx.erdaLink };
}

// Today: one line for a Challenger character.
export function ChallengerToday({ data, state, char, now }) {
  const o = challengerOutlook(data, state, char, now);
  if (!o || o.over) return null;
  const { st } = o;
  const show = () => update((s) => { s.ui.progressView = 'challenger'; });
  let text;
  if (!st.next) text = `${st.tier.name} reached, the top tier.`;
  else {
    const p = st.plan;
    const runs = p.runs.slice(0, 3).map(runText).join(' · ');
    const gate = p.forced && p.forced.status !== 'can' ? ` ${named(p.forced.mission)} solo is needed first (${stateText(p.forced.mission, p.forced, o.path, o.ctx, now)}).` : '';
    const lead = p.forced && p.forced.status === 'can' ? `${named(p.forced.mission)} +${num(p.forced.gain)}${runs ? ' · ' : ''}` : '';
    const need = st.next.points - st.points;
    text = `${need > 0 ? `${st.next.name} needs ${num(need)} more.` : `${st.next.name}: the points are there.`}${gate}${lead || runs ? ` Fewest boss missions: ${lead}${runs}${p.runs.length > 3 ? ` and ${p.runs.length - 3} more` : ''}.` : ''}${!p.runs.length && p.maybe.length ? (o.ctx.cp ? ' The bosses that would do it have no Combat Power figure: check in game.' : ' Type your Combat Power on Bosses to see which boss missions you can do.') : ''}${p.short > 0 ? ' The bosses you can clear now are not enough: levels and more Combat Power get the rest.' : ''}`;
  }
  return html`<div><b>Challenger tier</b><div class="small">${st.tier ? `${st.tier.name} · ` : ''}${num(st.points)} points. ${text} <a href="#progress" onClick=${show}>Plan</a></div></div>`;
}

// Progress → Challenger.
export function ChallengerView({ data, state, char, now }) {
  const o = challengerOutlook(data, state, char, now);
  if (!o) return html`<${Card} title="Challenger tiers"><${Empty}>The Challenger World data did not load.<//><//>`;
  const { cw, ctx, st, path, end, over } = o;
  const tiers = tiersOf(cw);
  const all = bossMissions(cw, ctx.bossById);
  const endLevel = levelAtTime(path, ctx.level, end);
  const endPoints = st.points + levelPoints(cw, endLevel) - st.levelPoints;
  const tp = targetPlan(cw, ctx, o.target, path, end);
  const early = tp && !tp.reached ? earliestTier(cw, ctx, o.target, path, now) : null;
  const nextLv = nextLevelMission(cw, ctx.level);
  const nextLvAt = nextLv ? (path.find((p) => p.level >= nextLv.level) || {}).at : null;
  const days = kstDays(now, end);
  const rewardsOf = (t) => (char.world === 'interactive' && t.rewardsInteractive ? t.rewardsInteractive : t.rewards);
  const setTarget = (v) => update((s) => { const c = charSlice(s, 'challenger', char.id, () => ({ done: {} })); if (v) c.target = v; else delete c.target; });
  const doneBoss = all.filter((m) => st.set.has(m.id)).length;
  const seasonal = seasonalFor(cw, ctx);
  const seal = over ? null : sealText(cw, ctx, o.target, end - now);
  const planList = (p) => html`${p.forced ? html`<div class="small">${named(p.forced.mission)} solo +${num(p.forced.gain)}: ${p.forced.status === 'can' ? 'needed for this tier' : `needed for this tier, ${stateText(p.forced.mission, p.forced, path, ctx, now)}`}</div>` : null}
    ${p.runs.slice(0, SHOWN).map((r) => html`<div class="small">${runText(r)}${r.ids.length > 1 ? ` (with ${r.ids.length - 1} easier ${plural(r.ids.length - 1, 'mission')})` : ''}${r.status !== 'can' ? ` · ${stateText(r.run, r, path, ctx, now)}` : ''}</div>`)}
    ${p.runs.length > SHOWN ? html`<div class="small muted">and ${p.runs.length - SHOWN} smaller ${plural(p.runs.length - SHOWN, 'mission')} worth ${num(p.runs.slice(SHOWN).reduce((a, r) => a + r.gain, 0))}</div>` : null}
    ${p.maybe.map((r) => html`<div class="small">${runText(r)} · if you can clear it: ${stateText(r.run, r, path, ctx, now)}</div>`)}
    ${p.short > 0 ? html`<div class="small cp-no">Still ${num(p.short)} short: no other boss mission is within reach yet.</div>` : null}`;
  return html`<div class="grid two">
    <${Card} title="Challenger tier" meta=${over ? 'the season has ended' : `${days} ${plural(days, 'day')} left · ends ${fmtDate(end)}`} className="span2">
      <div class="tiles">
        <${Tile} k="Tier now" v=${st.tier ? st.tier.name : 'None yet'} s=${`${num(st.points)} points: ${num(st.levelPoints)} from levels, ${num(st.bossPoints)} from bosses`} accent />
        ${st.next ? html`<div class="tile"><span class="k">Next · ${st.next.name}</span><span class="v">${num(Math.max(0, st.next.points - st.points))} to go</span><${Bar} pct=${Math.min(1, st.points / st.next.points)} /><span class="s">${num(st.next.points)} points${st.next.boss ? ` + ${named(all.find((m) => m.id === st.next.boss) || { boss: { difficulty: '', boss: 'boss' } })} solo` : ''}</span></div>` : html`<${Tile} k="Next" v="Top tier" s="Challenger reached" />`}
        ${over ? null : html`<${Tile} k="By the season end" v=${`${num(endPoints)} points`} s=${o.rate ? `from levels alone (Lv. ${endLevel} at your pace)` : 'levels so far only: log your level twice on Level for a projection'} />`}
      </div>
      ${over ? html`<p class="note">Season 4 has ended. ${cw.claimNote}</p>` : html`
        ${st.next ? html`<div class="insight"><span class="k">Fewest boss missions to ${st.next.name} now</span>${planList(st.plan)}${!st.plan.runs.length && !st.plan.forced && !st.plan.maybe.length ? html`<span class="small muted">None you can clear now.</span>` : null}</div>` : null}
        <div class="form-grid">
          <label class="field"><span>Target tier</span><select id="cw-target" class="select" value=${o.chosen || ''} onChange=${(e) => setTarget(e.currentTarget.value)}>
            <option value="">${`Best within reach (${(tiers.find((t) => t.id === o.target) || {}).name || '—'})`}</option>
            ${tiers.map((t) => html`<option value=${t.id}>${t.name} · ${num(t.points)}</option>`)}</select></label>
        </div>
        ${tp ? html`<div class="insight"><span class="k">${tp.target.name} by ${fmtDate(end)}</span>
          ${tp.reached ? html`<span class="big accent">Reached</span>` : html`
            <span class="small">${tp.fromLevels > 0 ? `Levels add about ${num(tp.fromLevels)} (Lv. ${tp.endLevel} by then). ` : ''}${tp.need > 0 || tp.forced ? `Boss missions for the other ${num(tp.need)}:` : 'Levels alone get you there.'}</span>
            ${tp.need > 0 || tp.forced ? planList(tp) : null}
            ${early ? html`<span class="small muted">${tp.target.name} is ${whenText(early, now)} if you clear every boss mission open to you by then${early.bossUnsure ? `, ${named(all.find((m) => m.id === tp.target.boss))} included (no Combat Power figure for it)` : ''}.</span>` : html`<span class="small muted">${o.rate ? 'Not within reach this season at your pace and Combat Power.' : 'Log your level twice on Level to see when it becomes possible.'}</span>`}`}
          <span class="small muted">${rewardsOf(tp.target)}.</span></div>` : null}
        <${HigherRule} cw=${cw} state=${state} />
        ${seal ? html`<p class="note"><b>Arcane Seal:</b> ${seal}</p>` : null}`}
      <p class="note">${cw.bossRules.join(' ')} Tick a mission once it shows as done in the Challenger World window.</p>
      <p class="note">"You can enter it" compares your Combat Power${ctx.margin > 1 ? ' (with the room you chose)' : ''} with the game's solo entry minimum, as on Bosses: a floor, not a promise of a clear.${ctx.cp ? '' : ' Type your Combat Power on Bosses to see which missions are within reach.'}</p>
    <//>
    <${Card} title="Boss missions" meta=${`${doneBoss} of ${all.length} done · solo`}>
      ${all.map((m) => {
        const s = missionState(m, ctx, st.set);
        const ticked = Boolean(ctx.done[m.id]);
        const implied = !ticked && st.set.has(m.id);
        return html`<${MissionRow} key=${m.id} id=${m.id} label=${named(m)} right=${`+${num(m.points)} · ${num(m.coins)} coins${m.adv ? ` + ${m.adv} advanced` : ''}`}
          note=${implied ? 'done by your harder clear' : s.status === 'done' ? null : stateText(m, s, path, ctx, now)} done=${s.status === 'done'} implied=${implied}
          onChange=${(v) => setTick(char.id, m.id, v, named(m))} />`;
      })}
    <//>
    <div class="grid">
      <${Card} title="Level missions" meta=${`${num(st.levelPoints)} points so far`}>
        <p class="note">${ctx.level ? `Lv. ${ctx.level}: ` : ''}${nextLv ? `next is Lv. ${nextLv.level}, +${num(nextLv.points)} points and ${num(nextLv.coins)} coins${nextLvAt ? `, about ${fmtDate(nextLvAt)}` : ''}.` : 'every level mission is done.'} ${cw.levelNote} They follow your level on Level, so there is nothing to tick.</p>
        <${Fold} title="Points per level" meta="Lv. 260 to 290"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Level</th><th class="num">Points</th><th class="num">Coins</th></tr></thead><tbody>
          ${cw.levels.map(([l, p, c]) => html`<tr class=${ctx.level >= l ? 'off' : ''}><td>Lv. ${l}${ctx.level >= l ? ' · done' : ''}</td><td class="num">${num(p)}</td><td class="num">${num(c)}</td></tr>`)}
        </tbody></table></div><//>
      <//>
      <${Fold} title="Seasonal coin missions" meta=${`${seasonal.filter((x) => st.set.has(x.id)).length} of ${seasonal.length} done · coins only`}>
        <p class="note">${cw.seasonalNote} Ticks here feed "still to earn" in Events → Coin shop.</p>
        ${seasonal.map((x) => html`<${MissionRow} key=${x.id} id=${x.id} label=${x.text} right=${`${num(x.coins)} coins`} note=${x.hexa && ctx.erdaLink ? 'May not apply to Erda Link: not counted.' : null}
          done=${st.set.has(x.id)} implied=${false} onChange=${(v) => setTick(char.id, x.id, v, x.text)} />`)}
        ${ctx.erdaLink ? html`<p class="note">${cw.hexaNote}</p>` : null}
      <//>
      <${Fold} title="Tier rewards" meta=${`${tiers.length} tiers`}>
        ${tiers.map((t) => html`<div class="goal"><div><b>${t.name}</b> <span class="small muted">${num(t.points)}${t.boss ? ` + ${named(all.find((m) => m.id === t.boss) || { boss: { difficulty: '', boss: '' } })} solo` : ''}</span><div class="small muted">${rewardsOf(t)}</div></div></div>`)}
        <p class="note">${cw.claimNote}</p>
      <//>
      <${Fold} title="Source" meta="Nexon notice 47305"><p class="note">${cw.source}</p>${cw.seal ? html`<p class="note">${cw.seal.wandNote}</p>` : null}<//>
    </div>
  </div>`;
}
