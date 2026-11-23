import { html } from '../../vendor/htm-preact.mjs';
import { update } from '../store.js';
import { Card } from '../ui.js';
import { DAY, fmtKst, fmtLeft } from '../time.js';

const CATS = [['gameplay', 'Gameplay', ['events', 'update', 'general', 'community']], ['sale', 'Cash Shop', ['sale']], ['maintenance', 'Maintenance', ['maintenance']]];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function catOf(e) {
  return (CATS.find(([, , list]) => list.includes(e.category)) || CATS[0])[0];
}

// Groups events by post; each group spans its events. Range: 10 days back to the last end within 120 days.
export function timelineModel(events, now, filter = {}, hideClassic = true) {
  const from = Math.floor((now - 10 * DAY) / DAY) * DAY;
  const list = events.filter((e) => {
    if (hideClassic && e.isClassic) return false;
    if (filter[catOf(e)] === false) return false;
    const end = Date.parse(e.end);
    return end > from && (e.start ? Date.parse(e.start) : from) < now + 120 * DAY;
  });
  const lastEnd = Math.max(now + 45 * DAY, ...list.map((e) => Math.min(Date.parse(e.end), now + 120 * DAY)));
  const to = Math.ceil((lastEnd + 2 * DAY) / DAY) * DAY;
  const groups = new Map();
  for (const e of list) {
    const key = e.category === 'maintenance' ? 'maintenance' : String(e.postId);
    if (!groups.has(key)) groups.set(key, { key, name: e.category === 'maintenance' ? 'Maintenance' : e.postName, url: e.category === 'maintenance' ? null : e.url, category: e.category, events: [] });
    groups.get(key).events.push(e);
  }
  const out = [...groups.values()].map((g) => {
    const starts = g.events.map((e) => (e.start ? Date.parse(e.start) : from));
    g.start = Math.min(...starts);
    g.end = Math.max(...g.events.map((e) => Date.parse(e.end)));
    g.events.sort((a, b) => (a.start ? Date.parse(a.start) : from) - (b.start ? Date.parse(b.start) : from) || Date.parse(a.end) - Date.parse(b.end));
    return g;
  });
  out.sort((a, b) => (a.key === 'maintenance') - (b.key === 'maintenance') || a.start - b.start || a.end - b.end);
  return { from, to, groups: out };
}

function shortStatus(s, end, now) {
  if (s > now) return `starts ${fmtKst(s, false)}`;
  if (end <= now) return 'ended';
  const d = Math.floor((end - now) / DAY);
  return d >= 1 ? `${d}d left` : `${Math.max(1, Math.floor((end - now) / 3600000))}h left`;
}

function pos(t, from, to) {
  return ((Math.min(Math.max(t, from), to) - from) / (to - from)) * 100;
}

function Bar({ e, from, to, now, label }) {
  const s = e.start ? Date.parse(e.start) : from;
  const end = Date.parse(e.end);
  const left = pos(s, from, to);
  const width = Math.max(0.6, pos(end, from, to) - left);
  const status = s > now ? `starts in ${fmtLeft(s - now)}` : end > now ? `${fmtLeft(end - now)} left` : 'ended';
  const tip = `${e.title}\n${e.start ? fmtKst(s, !e.startApprox) : 'already running'} → ${fmtKst(end, !e.endApprox)}\n${status}`;
  return html`<a class=${`tl-bar cat-${e.category}${!e.start || s < from ? ' approx-start' : ''}`} href=${e.url} target="_blank" rel="noopener"
    style=${{ left: left + '%', width: width + '%' }} title=${tip} aria-label=${tip.replace(/\n/g, ', ')}>${label ?? shortStatus(s, end, now)}</a>`;
}

function Ticks({ from, to, now }) {
  const ticks = [];
  for (let t = from; t <= to; t += DAY) {
    const d = new Date(t);
    if (d.getUTCDate() === 1) ticks.push({ t, label: MONTHS[d.getUTCMonth()], month: true });
    else if (d.getUTCDay() === 4) ticks.push({ t, label: d.getUTCDate() > 3 && d.getUTCDate() < 29 ? String(d.getUTCDate()) : '', month: false });
  }
  return html`<div class="tl-overlay">
    ${ticks.map((tk) => html`<div class=${'tl-tick' + (tk.month ? ' month' : '')} style=${{ left: pos(tk.t, from, to) + '%' }}><span>${tk.label}</span></div>`)}
    <div class="tl-today" style=${{ left: pos(now, from, to) + '%' }}></div>
  </div>`;
}

export function Timeline({ data, state, now }) {
  const filter = state.ui.tlFilter || {};
  const open = state.ui.tlOpen || {};
  const model = timelineModel(data.events.events || [], now, filter, state.ui.hideClassic);
  const toggle = (key) => update((s) => { s.ui.tlOpen = { ...(s.ui.tlOpen || {}), [key]: !open[key] }; });
  return html`<${Card} title="Event timeline" meta="Thursday ticks are the weekly boss reset. Tap a row to see its events.">
    <div class="toolbar">
      ${CATS.map(([id, label]) => html`<button type="button" class="chip" aria-pressed=${String(filter[id] !== false)}
        onClick=${() => update((s) => { s.ui.tlFilter = { ...(s.ui.tlFilter || {}), [id]: filter[id] === false }; })}>${label}</button>`)}
      <div class="legend"><span><i class="cat-events"></i>Event</span><span><i class="cat-update"></i>Patch notes</span><span><i class="cat-sale"></i>Cash Shop</span><span><i class="cat-maintenance"></i>Maintenance</span><span><i style=${{ background: 'var(--accent)', width: '3px' }}></i>Today</span></div>
    </div>
    ${model.groups.length === 0 ? html`<p class="note">No events in this range yet.</p>` : html`<div class="tl"><div class="tl-inner">
      <div class="tl-row"><div class="tl-label small muted">${fmtKst(model.from, false)} → ${fmtKst(model.to, false)}</div><div class="tl-scale"></div></div>
      ${model.groups.map((g) => {
        const isOpen = Boolean(open[g.key]) || g.events.length === 1;
        const single = g.events.length === 1;
        return html`
          <div class=${'tl-row group' + (isOpen && !single ? ' open' : '')}>
            <div class="tl-label">${single ? html`<span title=${g.events[0].title}>${g.events[0].title}</span>`
              : html`<button type="button" aria-expanded=${String(isOpen)} onClick=${() => toggle(g.key)} title=${g.name}><span class="caret">${isOpen ? '▾' : '▸'}</span>${g.name}<span class="muted small"> ${g.events.length}</span></button>`}</div>
            <div class="tl-track">${single ? html`<${Bar} e=${g.events[0]} from=${model.from} to=${model.to} now=${now} />`
              : html`<${Bar} e=${{ ...g.events[0], title: g.name, start: new Date(g.start).toISOString(), end: new Date(g.end).toISOString(), startApprox: true, endApprox: false, url: g.url || g.events[0].url, category: g.category }} from=${model.from} to=${model.to} now=${now} label=${isOpen ? '' : `${g.events.length} events · ${shortStatus(g.start, g.end, now)}`} />`}</div>
          </div>
          ${isOpen && !single ? g.events.map((e) => html`<div class="tl-row child">
            <div class="tl-label" title=${e.title}>${e.title}</div>
            <div class="tl-track"><${Bar} e=${e} from=${model.from} to=${model.to} now=${now} /></div>
          </div>`) : null}`;
      })}
      <${Ticks} from=${model.from} to=${model.to} now=${now} />
    </div></div>`}
  <//>`;
}

export function CalendarCard() {
  const base = location.href.split('#')[0].replace(/index\.html$/, '');
  const feed = new URL('data/calendar.ics', base).href;
  const webcal = feed.replace(/^https?:/, 'webcal:');
  return html`<${Card} title="Reminders on your phone" meta="calendar feed, refreshed by your GitHub job">
    <p class="note">Subscribe once: your calendar shows each event's last hour (with a reminder the day before), maintenance windows, and the Monday, Wednesday and Thursday resets.</p>
    <div class="toolbar">
      <a class="btn primary" href=${webcal}>Subscribe (iPhone, Mac)</a>
      <a class="btn" href=${'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal)} target="_blank" rel="noopener">Add to Google Calendar</a>
      <button type="button" class="btn ghost" onClick=${(e) => { navigator.clipboard?.writeText(feed); e.currentTarget.textContent = 'Link copied'; }}>Copy link</button>
    </div>
    <p class="note">Google refreshes subscribed calendars on its own schedule, which can take up to a day; Apple Calendar lets you pick how often.</p>
  <//>`;
}
