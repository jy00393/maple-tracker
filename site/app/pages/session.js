import { html, useEffect, useRef, useState } from '../../vendor/htm-preact.mjs';
import { update, activeCharacter } from '../store.js';
import { Card, Fold, Seg } from '../ui.js';
import { itemStatus, tickItem, dailyProgress, whoOf, whoFor } from './checklist.js';
import { streakToday } from '../calc/checklist.js';
import { DAY, dayKey, nextReset, fmtDate } from '../time.js';
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
    if (st.done || st.locked || st.expired || st.link || st.rows || item.type === 'count' || item.type === 'chips') continue;
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
  return html`<${Fold} title="Short on time? Plan a session" meta=${`${plan.used} of ${mins} min · tap to open`}>
    <${Seg} label="Session length" value=${mins} onChange=${(v) => update((s) => { s.ui.sessionMins = v; })} options=${[[30, '30 min'], [60, '60 min'], [90, '90 min']]} />
    ${plan.picks.length ? html`<div>${plan.picks.map(({ item, group, mins: m, why }) => {
      const st = itemStatus(item, group, cs, now, who);
      return html`<div class=${'row' + (st.done ? ' done' : '')}>
        <input type="checkbox" id=${'plan-' + item.id} checked=${st.done} onChange=${(e) => tickItem(item, st, who, e.currentTarget.checked)} />
        <label class="lbl" for=${'plan-' + item.id}>${item.label}</label>
        <div class="right"><span class="min">${m} min · ${why}</span></div>
      </div>`;
    })}</div>` : html`<p class="okbox">Everything that fits is done. Nice.</p>`}
    <p class="note">Kill counters (event counters, hunts) fill up while you grind, so they aren't listed. Ticks here are the same as on the Checklist.</p>
  <//>`;
}

// Saves today's core-daily progress for the streak calendar (one entry per UTC day, the game's day).
//
// The entry is worked out from every character's ticks, not only the one on screen: a second device that shows
// an alt and has not synced yet writes "0 done" on opening, and that newer write replaces the main's finished
// day when the copies merge. The ticks arrive in the same merge, so the entry is put right from them here.
export function StreakRecorder({ data, state, now }) {
  const who = whoOf(data, state);
  const list = state.characters.length
    ? state.characters.map((c) => ({ by: c.id, ...dailyProgress(data.checklist, state.checklist, now, whoFor(data, state, c)) }))
    : [{ ...dailyProgress(data.checklist, state.checklist, now, who) }];
  const key = dayKey(now);
  const existing = (state.checklist.history || {})[key];
  const entry = streakToday(existing, list, who.id);
  // What this device counts, and what is saved: the effect runs again when either changes.
  const counted = `${key}|${list.map((p) => `${p.by || ''}:${p.done}/${p.total}`).join(',')}|${who.id || ''}`;
  const saved = existing ? `${existing.done}/${existing.total}/${existing.by || ''}` : '';
  const last = useRef(null);
  useEffect(() => {
    const fresh = last.current !== counted;
    last.current = counted;
    if (!entry) return;
    // Nothing done and nothing saved: there is nothing to record yet (a missing day reads as an unfinished one),
    // so only opening the tracker never writes over what another device has saved.
    if (!existing && entry.done === 0) return;
    // When only the saved entry changed (it came from another device), it is replaced only by a better one. Two
    // devices that count differently (one has newer level data, say) would otherwise overwrite each other for ever.
    if (!fresh && existing && existing.total > 0 && entry.done / entry.total <= existing.done / existing.total) return;
    update((s) => {
      s.checklist.history = s.checklist.history || {};
      s.checklist.history[key] = entry;
      const keys = Object.keys(s.checklist.history).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete s.checklist.history[k];
    });
  }, [counted, saved]);
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
      // A key that is not a date is skipped (the loader drops them; this keeps one from ever stopping the page).
      const t = Date.parse(k + 'T00:00:00Z');
      if (!Number.isFinite(t)) continue;
      const prev = dayKey(t - DAY);
      run = full(prev) ? run + 1 : 1;
      best = Math.max(best, run);
    }
  }
  return { streak, best: Math.max(best, streak) };
}

const showDay = (k) => fmtDate(Date.parse(k + 'T00:00:00Z'));
const dayCount = (h) => (h ? `${h.done} of ${h.total} core dailies` : 'no record');

export function StreakCard({ state, now }) {
  const history = state.checklist.history || {};
  // The square picked by a tap or the arrow keys (a day key). Nothing picked means today. Not saved.
  const [pick, setPick] = useState(null);
  const { streak, best } = streakInfo(history, now);
  const today = Date.parse(dayKey(now) + 'T00:00:00Z');
  const weekday = (new Date(today).getUTCDay() + 6) % 7; // Monday = 0
  const start = today - (15 * 7 + weekday) * DAY;
  const keys = [];
  for (let t = start; t <= today; t += DAY) keys.push(dayKey(t));
  const todayKey = keys[keys.length - 1];
  // A pick that has scrolled out of the 16 weeks falls back to today.
  const shown = keys.includes(pick) ? pick : todayKey;
  // Columns are weeks: left and right move a week, up and down a day. Only the picked square is a Tab stop.
  const onKey = (e, i) => {
    const d = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : d ? i + d : -1;
    if (j < 0 || j >= keys.length) return;
    e.preventDefault();
    setPick(keys[j]);
    const next = e.currentTarget.parentNode && e.currentTarget.parentNode.childNodes[j];
    if (next && next.focus) next.focus();
  };
  const cells = keys.map((k, i) => {
    const h = history[k];
    const r = h && h.total ? h.done / h.total : 0;
    const lvl = !h || r === 0 ? 0 : r < 0.34 ? 1 : r < 0.67 ? 2 : r < 1 ? 3 : 4;
    return html`<button type="button" class=${`h${lvl}${k === todayKey ? ' today' : ''}${k === shown ? ' sel' : ''}`} tabindex=${k === shown ? 0 : -1}
      aria-pressed=${String(k === shown)} aria-label=${`${showDay(k)}: ${dayCount(h)}`} title=${`${showDay(k)}: ${dayCount(h)}`}
      onClick=${() => setPick(k)} onKeyDown=${(e) => onKey(e, i)}></button>`;
  });
  return html`<${Card} title="Dailies streak" meta=${`best ${best} day${best === 1 ? '' : 's'}`}>
    <div class="insight"><span class="k">Current streak</span><span class="big accent">${streak} day${streak === 1 ? '' : 's'}</span><span class="small muted">Days with every core daily ticked (game days, 09:00 KST to 09:00 KST)</span></div>
    <div class="heat" role="group" aria-label="Last 16 weeks of dailies. Pick a day to see its count.">${cells}</div>
    <p class="heat-day small" aria-live="polite"><b>${shown === todayKey ? 'Today' : showDay(shown)}:</b> ${dayCount(history[shown])}. <span class="muted">Pick a square to see that day.</span></p>
  <//>`;
}
