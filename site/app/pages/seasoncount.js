// Season counters (Today) and "use it or lose it": what expires soon (Today's season card), expiring coin shop
// picks (Events → Coin shop) and season-only growth potions (Progress → Level). Maths in calc/seasoncount.js.
import { html } from '../../vendor/htm-preact.mjs';
import { update, touch, getState } from '../store.js';
import { Card, Stepper, Left, fmtBig, plural } from '../ui.js';
import { fmtDay, fmtKst, asOf } from '../time.js';
import { changedAt } from '../calc/asof.js';
import { resetOf } from '../calc/checklist.js';
import { expToNext } from '../calc/upgrades.js';
import { passPlan, capPlan, etherionPlan, expiringSoon, picksPaidBy, expiringPicks, seasonalPotions, seasonCounts, linkedShops } from '../calc/seasoncount.js';

const num = (v) => Math.round(v).toLocaleString('en-US');
const path = (k) => `season/${k}`;
const DAY_NAME = { mon: 'Monday', wed: 'Wednesday', thu: 'Thursday' };
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

const whoOfChar = (char, level) => ({ level, challenger: Boolean(char.challenger), world: char.world || 'heroic' });

// When a count was last typed: for a counter a shop also keeps (its claims), the later of the two.
export function countAt(data, state, k, now) {
  let at = changedAt(state, path(k), now);
  for (const { shop, counter } of linkedShops(data)) {
    if (counter !== k) continue;
    const t = changedAt(state, `shops/${encodeURIComponent(shop.id)}/claims`, now);
    if (Number.isFinite(t) && t > 0 && !(at >= t)) at = t;
  }
  return at;
}

// Typing the figure that is already saved confirms it: only its "as of" date moves. A counter that a coin shop also
// keeps as its claims (shops.json earn.counter) is one count: both are written together, so lowering it in either
// place lowers it everywhere.
export function setCount(k, v, data = null) {
  const st = getState();
  const linked = linkedShops(data).filter((x) => x.counter === k);
  const cur = seasonCounts(data, st);
  const shopOf = (s, shop) => (s.shops && typeof s.shops === 'object' && s.shops[shop.id] && typeof s.shops[shop.id] === 'object' ? s.shops[shop.id] : null);
  if (v === null || v === undefined || !Number.isFinite(v)) {
    if (Object.hasOwn(cur, k)) update((s) => {
      if (s.season) delete s.season[k];
      for (const { shop } of linked) { const x = shopOf(s, shop); if (x) x.claims = 0; }
    });
    return;
  }
  const n = Math.floor(v);
  const raw = (st.season || {})[k];
  const shopsSame = linked.every(({ shop }) => { const x = shopOf(st, shop); return !x || !x.claims || x.claims === n; });
  if (cur[k] === n && raw === n && shopsSame) { touch(path(k)); return; }
  update((s) => {
    if (!s.season || typeof s.season !== 'object' || Array.isArray(s.season)) s.season = {};
    s.season[k] = n;
    for (const { shop } of linked) {
      if (!s.shops || typeof s.shops !== 'object') s.shops = {};
      const x = shopOf(s, shop) || (s.shops[shop.id] = { have: 0, claims: 0, want: {} });
      x.claims = n;
    }
  });
}

// The reset day of a checklist item (as set on Checklist), for a counter that follows it.
function itemReset(data, state, id) {
  for (const g of (data.checklist && data.checklist.groups) || []) {
    const item = (g.items || []).find((i) => i.id === id);
    if (item) return resetOf(item, g, state.checklist);
  }
  return null;
}

function Line({ lead, answer, small }) {
  return html`<div class="season-line" style=${{ padding: '7px 2px' }}>
    <div><b>${lead}</b>${answer ? html`: ${answer}` : null}</div>
    ${small ? html`<div class="small muted">${small}</div>` : null}
  </div>`;
}

function passLine(cfg, s, at, now) {
  const lv = s.pass;
  const p = passPlan(cfg, lv, at, now);
  const when = at ? ` ${asOf(at, now)}` : '';
  if (!p) return { lead: 'Challenger Pass', answer: 'type your Pass level below for a Lv. 30 date' };
  if (p.done) return { lead: `Pass Lv. ${cfg.max}`, answer: 'maxed', small: `Claim the rewards by ${fmtKst(Date.parse(cfg.ends))}. They expire about 2 hours later.` };
  if (p.short) return { lead: `Pass Lv. ${lv}`, answer: `Lv. ${cfg.max} is out of reach, about Lv. ${p.reach} by the end`, small: `${num(p.need)} points to go and at most ${cfg.perWeek} a week.${when}` };
  if (p.due) return { lead: `Pass Lv. ${lv}`, answer: `you should be Lv. ${cfg.max} by now if every week was maxed`, small: `Type the level again to update it.${when}` };
  return {
    lead: `Pass Lv. ${lv}`,
    answer: `Lv. ${cfg.max} by ${fmtDay(p.by, now)} if each week is maxed`,
    small: `${num(p.need)} points to go at up to ${cfg.perWeek} a week: ${p.weeks} ${plural(p.weeks, 'week')}, counting the week the level was typed in. Points reset ${DAY_NAME[cfg.reset] || 'weekly'} 09:00 KST.${when}`
  };
}

function capLine(cfg, short, n, at, now, resetKind, extra) {
  const p = capPlan(cfg, n, at, now, resetKind);
  const when = at ? ` ${asOf(at, now)}` : '';
  if (!p) return { lead: cfg.label, answer: `type your count below (out of ${cfg.max})` };
  const lead = `${short} ${n} / ${cfg.max}`;
  if (p.done) return { lead, answer: 'done for the season' };
  const weeks = `${p.weeks} ${plural(p.weeks, 'week')} left counting the current one`;
  // Supply Report: one a day you log in, so near the end the days left are the limit, not the weeks.
  const days = p.byDays ? `${p.days} login ${plural(p.days, 'day')} left counting ${at ? 'the day the count was typed' : 'today'}` : '';
  if (p.short) return { lead, answer: `${cfg.max} is out of reach, about ${p.reach} by the end`, small: p.byDays ? `At most ${cfg.perDay} a day you log in, and ${days}.${when}` : `At most ${cfg.perWeek} a week and ${weeks}.${when}` };
  if (p.byDays) {
    const answer = p.spare > 0 ? `you can miss ${p.spare} more login ${plural(p.spare, 'day')}` : `log in every day left to reach ${cfg.max}`;
    return { lead, answer, small: `${p.left} to go, at most ${cfg.perDay} a day you log in; ${days}. ${extra.note || ''}${when}` };
  }
  let answer;
  if (p.spareWeeks >= 1) answer = `you can miss ${p.spareWeeks} more ${extra.unit} ${plural(p.spareWeeks, 'week')}`;
  else if (p.spare > 0) answer = `you can miss ${p.spare} more, then you need ${cfg.perWeek} every week`;
  else answer = `you need ${cfg.perWeek} every week from now to reach ${cfg.max}`;
  return { lead, answer, small: `${p.left} to go${extra.each || ''}, at most ${cfg.perWeek} a week; ${weeks}${p.spare % cfg.perWeek && p.spareWeeks >= 1 ? ` (${p.spare} spare in all)` : ''}. ${extra.note || ''}${when}` };
}

function etherionLines(e, s, atDone, atCore, now) {
  const p = etherionPlan(e, s.ether, s.core);
  const out = [];
  const whenDone = atDone ? ` ${asOf(atDone, now)}` : '';
  if (!p.known) out.push({ lead: 'Etherion Relics', answer: `type your completions below (out of ${e.max})` });
  else if (p.finished) out.push({ lead: `Etherion ${p.done} of ${e.max}`, answer: 'done for the season' });
  else {
    const next = p.next ? (p.next.core ? 'you pick a core (for good)' : p.next.relic ? `the ${p.next.relic} relic switches on` : p.next.reward) : '';
    out.push({
      lead: `Etherion ${p.done} of ${e.max}`,
      answer: `${p.left} to go; one opens every ${DAY_NAME[e.opens] || 'week'} 09:00 KST and they stack, so a missed week is not lost`,
      small: `${next ? `At the ${ordinal(p.done + 1)}: ${next}. ` : ''}${p.coresOpen} of ${p.cores} cores open. Each completion needs ${num(e.killsEach)} solo kills. ${e.openNote}${whenDone}`
    });
  }
  const whenCore = atCore ? ` ${asOf(atCore, now)}` : '';
  if (p.core === undefined) out.push({ lead: 'Core', answer: 'type the level of the core you are raising for its cost' });
  else if (!p.step) out.push({ lead: `Core Lv. ${p.core}`, answer: 'at the top level' });
  else {
    out.push({
      lead: `Core Lv. ${p.core}`,
      answer: `Lv. ${p.core + 1} needs about ${num(p.step.avg)} Etherion on average`,
      small: `${p.step.cost} a try at ${Math.round(p.step.rate * 100)}% success.${p.toFive ? ` To Lv. 5: about ${num(p.toFive)} in all.` : ''} A combined core level of ${e.medal.combinedLevel} gives the Etherion Overload Medal. ${e.coreNote}${whenCore}`
    });
  }
  return out;
}

// Today: one card with the season's counters, each led by its number and the answer it gives.
// `level`: the character's known level (pages/level.js knownLevel).
export function SeasonCounters({ data, state, char, level, now }) {
  const c = data.season && data.season.counters;
  const e = data.etherion;
  if (!char || !c) return null;
  // One count for a counter a coin shop also keeps (Defense Missions = Alliance Credit claims).
  const s = seasonCounts(data, state);
  const at = (k) => countAt(data, state, k, now);
  const lvlOk = (cfg) => !(cfg && cfg.minLevel && Number.isFinite(level) && level < cfg.minLevel);
  const open = (cfg) => cfg && Date.parse(cfg.ends) > now && lvlOk(cfg);
  const pass = c.pass && char.challenger && open(c.pass) ? c.pass : null;
  const supply = open(c.supply) ? c.supply : null;
  const defense = open(c.defense) ? c.defense : null;
  const ether = e && Date.parse(e.ends) > now && lvlOk(c.supply) ? e : null;
  if (!pass && !supply && !defense && !ether) {
    // The counters have closed, but rewards and shop items are usable a little longer (10 Feb 02:00 UTC). A
    // Challenger character sees that list on its season card; everyone else sees it here, on its own.
    if (char.challenger || !expiringSoon(data, state.shops, whoOfChar(char, level), now).length) return null;
    return html`<div class="grid two" style=${{ marginTop: '14px' }}><${Card} title="Season rewards" meta="the counters have closed" className="span2">
      <${ExpiringSoon} data=${data} state=${state} char=${char} level=${level} now=${now} />
    <//></div>`;
  }
  const defenseReset = defense && defense.checklistItem ? itemReset(data, state, defense.checklistItem) : null;
  const lines = [
    ...(pass ? [passLine(pass, s, at('pass'), now)] : []),
    ...(supply ? [capLine(supply, 'Supply', s.supply, at('supply'), now, supply.reset, { unit: 'login', note: `${supply.resetNote} ${supply.archiveNote}` })] : []),
    ...(defense ? [capLine(defense, 'Defense', s.defense, at('defense'), now, defenseReset, { unit: 'hunting', each: `: ${num(defense.killsEach)} kills each`, note: DAY_NAME[defenseReset] ? `Weeks end ${DAY_NAME[defenseReset]} 09:00 KST, the reset set for "Ultima weekly hunt" on Checklist.` : '' })] : []),
    ...(ether ? etherionLines(ether, s, at('ether'), at('core'), now) : [])
  ];
  const typed = ['pass', 'supply', 'defense', 'ether', 'core'].some((k) => Object.hasOwn(s, k));
  const field = (k, label, max, min = 0) => html`<div class="field"><span>${label}</span><${Stepper} label=${label} value=${Object.hasOwn(s, k) ? s[k] : null} min=${min} max=${max} onChange=${(v) => setCount(k, v, data)} /></div>`;
  return html`<div class="grid two" style=${{ marginTop: '14px' }}><${Card} title="Season counters" meta="typed in from the game" className="span2">
    ${lines.map((l) => html`<${Line} ...${l} />`)}
    <details open=${!typed}><summary class="small">Update the counts (from the Event List in game)</summary>
      <div class="form-grid" style=${{ marginTop: '8px' }}>
        ${pass ? field('pass', 'Challenger Pass level', pass.max) : null}
        ${supply ? field('supply', 'Supply Report collections', supply.max) : null}
        ${defense ? field('defense', 'Defense Missions done', defense.max) : null}
        ${ether ? field('ether', 'Etherion completions', ether.max) : null}
        ${ether ? field('core', 'Level of the core you are raising', 6, 1) : null}
      </div>
      <p class="note">${[pass && pass.scope, supply && supply.scope, defense && defense.scope, ether && ether.scope].filter(Boolean).join(' ')} Type a number again to confirm it: its date moves to today.</p>
    </details>
    <p class="note">When a count reaches its cap, its Checklist row shows as done for the season.</p>
    <details><summary class="small muted">Sources and what Nexon hasn't said</summary>
      <p class="note">${c.buyBackNote}${ether ? ` ${ether.dropNote}` : ''}</p>
      <p class="note">${c.source}${ether ? ` Etherion: ${ether.source}` : ''}</p>
    </details>
    ${char.challenger ? null : html`<${ExpiringSoon} data=${data} state=${state} char=${char} level=${level} now=${now} />`}
  <//></div>`;
}

// What expires in the next 3 weeks: the hand list in season.json and coin shop items with a date. Shown on the
// season card (Challenger World characters) or in the counters card (everyone else).
export function ExpiringSoon({ data, state, char, level, now }) {
  if (!char) return null;
  const groups = expiringSoon(data, state.shops, whoOfChar(char, level), now);
  if (!groups.length) return null;
  return html`<div class="expiring" style=${{ marginTop: '8px' }}>
    <div><b>Use it or lose it</b> <span class="small muted">· what expires in the next 3 weeks</span></div>
    ${groups.map((g) => html`<details open>
      <summary><b>Expires ${fmtKst(g.at)}</b> <span class="small muted">· <${Left} until=${g.at} after=" left" done="expired" /></span></summary>
      ${g.hand.map((h) => html`<p class="note"><b>${h.label}.</b> ${h.detail}</p>`)}
      ${g.picks.length ? html`<p class="note"><b>Coin shop picks:</b> ${g.picks.map((p) => `${p.item.name} x${p.want}`).join(', ')}. You still plan to buy ${plural(g.picks.length, 'this', 'these')}; ${plural(g.picks.length, 'it is', 'they are')} gone on this date.</p>` : null}
      ${g.shops.length ? html`<p class="note">Also gone then: what you bought from ${g.shops.map((x) => `${x.name} (${x.count} ${plural(x.count, 'item')} with this date)`).join(', ')}.</p>` : null}
    </details>`)}
    <p class="note">${(data.season && data.season.expiringNote) || ''}</p>
  </div>`;
}

// Events → Coin shop: the picks that expire before the planner says they can all be paid for.
export function ExpiryWarning({ shop, plan, now, resetKind, weekly }) {
  const picked = plan.rows.filter((r) => r.want > 0 && r.item.expires);
  if (!picked.length) return null;
  const paidBy = picksPaidBy(shop, plan, now, resetKind, weekly);
  // Nothing is bought after the shop closes: an item that expires later is never lost to a shortfall.
  const lost = expiringPicks(plan, paidBy, Date.parse(shop.end));
  const first = Math.min(...picked.map((r) => Date.parse(r.item.expires)));
  return html`${lost.length ? html`<p class="warnbox">${lost.map((r) => r.item.name).join(', ')} ${plural(lost.length, 'expires', 'expire')} before your picks are paid for (${paidBy === Infinity ? 'not before the shop closes' : `around ${fmtDay(paidBy, now)}`}). You could not use ${plural(lost.length, 'it', 'them')} after that: drop ${plural(lost.length, 'it', 'them')} from your picks.</p>` : null}
    <p class="note">${picked.length} of your picks ${plural(picked.length, 'expires', 'expire')}, the first on ${fmtKst(first)}. Expiring items are gone on that date, used or not. Items without a date are permanent or have none in Nexon's post.</p>`;
}

// Progress → Level: season-only growth potions that work at this level, with the level they are worth most at.
export function SeasonalPotions({ data, level, now = Date.now() }) {
  const src = data.expSources;
  const list = seasonalPotions(src, level, now);
  if (!list.length) return null;
  const exp = data.upgrades && data.upgrades.exp;
  const here = exp ? expToNext(exp, level) : null;
  return html`${list.map((p) => {
    const top = exp ? expToNext(exp, p.to) : null;
    const share = here && top && level < p.to ? ` At Lv. ${level} it gives ${fmtBig(here)} EXP, ${Math.round((here / top) * 100)}% of that.` : '';
    return html`<p class="note"><b>${p.name}</b> (${p.where}) expires ${fmtKst(Date.parse(p.expires))}. It is worth the most at Lv. ${p.to}${top ? `: ${fmtBig(top)} EXP` : ''}.${share}</p>`;
  })}
    <p class="note">${src.seasonalNote} ${list[0].source}</p>`;
}
