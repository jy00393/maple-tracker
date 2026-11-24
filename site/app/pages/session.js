import { html, useEffect } from '../../vendor/htm-preact.mjs';
import { update, activeCharacter } from '../store.js';
import { Card, Seg } from '../ui.js';
import { itemStatus, setRecord, dailyProgress, whoOf, recordKey } from './checklist.js';
import { DAY, dayKey, nextReset } from '../time.js';
import { knownLevel } from './level.js';

export function minutesOf(item, fallback) {
  const m = /(\d+)(?:\s*[–-]\s*(\d+))?\s*min/.exec(item.min || '');
  if (!m) return fallback;
  return Number(m[2] || m[1]);
}

// Fills the time you have: core dailies first, then weeklies that reset within two days, then optional dailies.
export function planSession(checklistData, cs, now, minutes, who) {
  const picks = [];
  const add = (item, group, mins, why) => picks.push({ item, group, mins, why });
  const groups = checklistData.groups;
  const core = groups.find((g) => g.key === 'daily');
  const optional = groups.filter((g) => g.reset === 'daily' && g.key !== 'daily');
  const weekly = groups.filter((g) => g.reset !== 'daily');
  const candidates = [];
  for (const item of core.items) candidates.push([item, core, minutesOf(item, 5), 'daily']);
  for (const g of weekly) {
    for (const item of g.items) {
      const st = itemStatus(item, g, cs, now, who);
      const resetIn = nextReset(st.kind, now) - now;
      if (resetIn <= 2 * DAY) candidates.push([item, g, minutesOf(item, 10), `resets in ${Math.ceil(resetIn / 3600000)}h`]);
    }
  }
  for (const g of optional) for (const item of g.items) candidates.push([item, g, minutesOf(item, 10), 'optional']);
  let used = 0;
  for (const [item, group, mins, why] of candidates) {
    const st = itemStatus(item, group, cs, now, who);
    if (st.done || st.locked || st.expired || st.link || item.type === 'count' || item.type === 'chips') continue;
    if (used + mins > minutes) continue;
    used += mins;
    add(item, group, mins, why);
  }
  return { picks, used };
}

export function SessionPlanner({ data, state, now }) {
  const mins = state.ui.sessionMins || 60;
  const cs = state.checklist;
  const who = whoOf(data, state);
  const plan = planSession(data.checklist, cs, now, mins, who);
  return html`<${Card} title="Plan a session" meta=${`${plan.used} of ${mins} min planned`}>
    <${Seg} label="Session length" value=${mins} onChange=${(v) => update((s) => { s.ui.sessionMins = v; })} options=${[[30, '30 min'], [60, '60 min'], [90, '90 min']]} />
    ${plan.picks.length ? html`<div>${plan.picks.map(({ item, group, mins: m, why }) => {
      const st = itemStatus(item, group, cs, now, who);
      return html`<div class=${'row' + (st.done ? ' done' : '')}>
        <input type="checkbox" id=${'plan-' + item.id} checked=${st.done} onChange=${(e) => setRecord(recordKey(item, who), st.kind, { d: e.currentTarget.checked ? 1 : 0 })} />
        <label class="lbl" for=${'plan-' + item.id}>${item.label}</label>
        <div class="right"><span class="min">${m} min · ${why}</span></div>
      </div>`;
    })}</div>` : html`<p class="okbox">Everything that fits is done. Nice.</p>`}
    <p class="note">Counters (Shadow Supplies, hunts) fill up while you grind, so they aren't listed. Ticks here are the same as on the Checklist.</p>
  <//>`;
}

// Saves today's core-daily progress for the streak calendar (one entry per UTC day, the game's day).
export function StreakRecorder({ data, state, now }) {
  const prog = dailyProgress(data.checklist, state.checklist, now, whoOf(data, state));
  const key = dayKey(now);
  useEffect(() => {
    const h = (state.checklist.history || {})[key];
    if (!prog.total || (h && h.done === prog.done && h.total === prog.total)) return;
    update((s) => {
      s.checklist.history = s.checklist.history || {};
      s.checklist.history[key] = { done: prog.done, total: prog.total };
      const keys = Object.keys(s.checklist.history).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete s.checklist.history[k];
    });
  }, [key, prog.done, prog.total]);
  return null;
}

export function streakInfo(history, now) {
  const full = (k) => history[k] && history[k].total > 0 && history[k].done >= history[k].total;
  let streak = 0;
  let t = now;
  if (!full(dayKey(t))) t -= DAY;
  while (full(dayKey(t))) {
    streak++;
    t -= DAY;
  }
  let best = 0;
  let run = 0;
  for (const k of Object.keys(history).sort()) {
    if (full(k)) {
      const prev = dayKey(Date.parse(k + 'T00:00:00Z') - DAY);
      run = full(prev) ? run + 1 : 1;
      best = Math.max(best, run);
    }
  }
  return { streak, best: Math.max(best, streak) };
}

export function StreakCard({ state, now }) {
  const history = state.checklist.history || {};
  const { streak, best } = streakInfo(history, now);
  const today = Date.parse(dayKey(now) + 'T00:00:00Z');
  const weekday = (new Date(today).getUTCDay() + 6) % 7; // Monday = 0
  const start = today - (15 * 7 + weekday) * DAY;
  const cells = [];
  for (let t = start; t <= today; t += DAY) {
    const k = dayKey(t);
    const h = history[k];
    const r = h && h.total ? h.done / h.total : 0;
    const lvl = !h || r === 0 ? 0 : r < 0.34 ? 1 : r < 0.67 ? 2 : r < 1 ? 3 : 4;
    cells.push(html`<i class=${`h${lvl}${t === today ? ' today' : ''}`} title=${`${k}: ${h ? `${h.done}/${h.total} core dailies` : 'no record'}`}></i>`);
  }
  return html`<${Card} title="Dailies streak" meta=${`best ${best} day${best === 1 ? '' : 's'}`}>
    <div class="insight"><span class="k">Current streak</span><span class="big accent">${streak} day${streak === 1 ? '' : 's'}</span><span class="small muted">Days with every core daily ticked (game days, 09:00 KST to 09:00 KST)</span></div>
    <div class="heat" role="img" aria-label="Last 16 weeks of dailies">${cells}</div>
  <//>`;
}
