import { html, useEffect } from '../../vendor/htm-preact.mjs';
import { update } from '../store.js';
import { Card, PageHead, Seg, useNow, Empty } from '../ui.js';
import { DAY, fmtKst, fmtLeft } from '../time.js';
import { Timeline, CalendarCard } from './timeline.js';

export function visibleNews(data, state) {
  return (data.news.items || []).filter((n) => !(state.ui.hideClassic && n.isClassic));
}

export function countNewNews(data, state) {
  const seen = state.ui.lastSeenNews || 0;
  if (!seen) return 0;
  return visibleNews(data, state).filter((n) => Date.parse(n.liveDate) > seen).length;
}

export function liveEvents(data, state, now) {
  return (data.events.events || []).filter((e) => {
    if (state.ui.hideClassic && e.isClassic) return false;
    if (e.category === 'maintenance') return false;
    const start = e.start ? Date.parse(e.start) : -Infinity;
    return start <= now && Date.parse(e.end) > now;
  });
}

export function upcomingMaintenance(data, now) {
  return (data.events.events || [])
    .filter((e) => e.category === 'maintenance' && Date.parse(e.end) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

function urgency(e, now) {
  const left = Date.parse(e.end) - now;
  if (left <= 0) return 'ended';
  if (e.start && Date.parse(e.start) > now) return 'soon';
  if (left <= 2 * DAY) return 'crit';
  if (left <= 7 * DAY) return 'warn';
  return '';
}

export function EventRow({ e, now, showPost, onHide }) {
  const start = e.start ? Date.parse(e.start) : null;
  const end = Date.parse(e.end);
  const upcoming = start && start > now;
  const left = upcoming ? `starts in ${fmtLeft(start - now)}` : end > now ? `${fmtLeft(end - now)} left` : 'ended';
  const startText = start ? fmtKst(start, !e.startApprox) + (e.afterMaintenance ? ' (after maintenance)' : '') : 'now';
  return html`<div class=${'ev ' + urgency(e, now)}>
    <div>
      <div class="t">${e.title}</div>
      <div class="when">${startText} → ${fmtKst(end, !e.endApprox)}</div>
      ${showPost ? html`<div class="from"><a href=${e.url} target="_blank" rel="noopener">${e.postName}</a></div>` : null}
      ${e.alsoIn && e.alsoIn.length ? html`<div class="from">Also in ${e.alsoIn.map((p, i) => html`${i ? ', ' : ''}<a href=${p.url} target="_blank" rel="noopener">${p.postName}</a>`)}</div>` : null}
    </div>
    <div class="left">${left}${onHide ? html` <button type="button" class="iconbtn mini" aria-label=${'Hide from Today: ' + e.title} title="Not for me: hide from Today" onClick=${onHide}>×</button>` : null}</div>
    ${e.resets && e.resets.length ? html`<div class="resets">${e.resets[0]}</div>` : null}
  </div>`;
}

function groupByPost(events) {
  const map = new Map();
  for (const e of events) {
    if (!map.has(e.postId)) map.set(e.postId, { postId: e.postId, name: e.postName, url: e.url, category: e.category, events: [] });
    map.get(e.postId).events.push(e);
  }
  return [...map.values()];
}

function DataStatus({ meta, now }) {
  if (!meta) return html`<p class="warnbox">No Nexon data yet. It appears after the GitHub job's first run (Actions tab → "Update Nexon data and deploy").</p>`;
  const age = now - Date.parse(meta.checkedAt);
  const stale = age > 30 * 3600000;
  return html`<p class=${stale || !meta.ok ? 'warnbox' : 'note'}>
    Nexon data checked ${fmtLeft(age)} ago (${fmtKst(Date.parse(meta.checkedAt))}).
    ${stale ? ' The scheduled job may have stopped; re-run it from the Actions tab.' : ''}
    ${meta.errors && meta.errors.length ? ` Last run reported: ${meta.errors.slice(0, 2).join('; ')}.` : ''}
  </p>`;
}

export function EventsPage({ data, state }) {
  const now = useNow(30000);
  const view = state.ui.eventsView || 'timeline';
  const all = (data.events.events || []).filter((e) => !(state.ui.hideClassic && e.isClassic));
  useEffect(() => {
    const newest = visibleNews(data, state).reduce((m, n) => Math.max(m, Date.parse(n.liveDate)), 0);
    if (newest && newest !== state.ui.lastSeenNews) {
      const timer = setTimeout(() => update((s) => { s.ui.lastSeenNews = newest; }), 4000);
      return () => clearTimeout(timer);
    }
  }, [data]);

  let body;
  if (view === 'timeline') {
    body = html`<${Timeline} data=${data} state=${state} now=${now} />`;
  } else if (view === 'news') {
    const items = visibleNews(data, state).slice(0, 60);
    const seen = state.ui.lastSeenNews || 0;
    body = html`<${Card} title="Latest Nexon posts" meta=${items.length + ' posts'} bodyClass="card-b tight">
      ${items.length === 0 ? html`<${Empty}>No posts loaded yet.<//>` : items.map((n) => html`<div class="news">
        <span class=${'tag ' + n.category}>${n.category}</span>
        <span><a href=${n.url} target="_blank" rel="noopener">${n.name}</a>${seen && Date.parse(n.liveDate) > seen ? html` <span class="tag new">new</span>` : null}
          ${n.summary ? html`<div class="small muted">${n.summary}</div>` : null}</span>
        <span class="meta-r">${fmtKst(Date.parse(n.liveDate), false)}</span>
      </div>`)}
    <//>`;
  } else {
    let list;
    if (view === 'live') list = all.filter((e) => e.category !== 'maintenance' && (!e.start || Date.parse(e.start) <= now) && Date.parse(e.end) > now);
    else if (view === 'soon') list = all.filter((e) => e.start && Date.parse(e.start) > now);
    else if (view === 'maint') list = all.filter((e) => e.category === 'maintenance').sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
    else list = all.filter((e) => e.category !== 'maintenance' && Date.parse(e.end) <= now).sort((a, b) => Date.parse(b.end) - Date.parse(a.end));
    const posts = groupByPost(list);
    body = posts.length === 0
      ? html`<${Card} title="Nothing here"><${Empty}>No events in this view.<//><//>`
      : html`<div class="grid two">${posts.map((p) => html`<${Card} title=${p.name} meta=${html`<span class=${'tag ' + p.category}>${p.category}</span> <a href=${p.url} target="_blank" rel="noopener">Open post</a>`} bodyClass="card-b tight">
          ${p.events.map((e) => html`<${EventRow} key=${e.id} e=${e} now=${now} />`)}
        <//>`)}</div>`;
  }

  return html`
    <${PageHead} title="Events">Pulled from Nexon's news every 6 hours by your GitHub job. Times are in Korea time; the server runs on UTC.<//>
    <${DataStatus} meta=${data.meta} now=${now} />
    <div class="toolbar">
      <${Seg} label="Event view" value=${view} onChange=${(v) => update((s) => { s.ui.eventsView = v; })}
        options=${[['timeline', 'Timeline'], ['live', 'Live now'], ['soon', 'Starting soon'], ['ended', 'Recently ended'], ['maint', 'Maintenance'], ['news', 'All posts']]} />
      <label class="small"><input type="checkbox" checked=${state.ui.hideClassic} onChange=${(e) => update((s) => { s.ui.hideClassic = e.currentTarget.checked; })} /> Hide Classic World</label>
    </div>
    ${body}
    <${CalendarCard} />`;
}

