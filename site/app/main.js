import { html, render, useEffect, useState } from '../vendor/htm-preact.mjs';
import { loadData } from './data.js';
import { useStore, update } from './store.js';
import { useNow, Logo } from './ui.js';
import { fmtLeft, fmtUtcTime, kstParts, nextReset } from './time.js';
import { TodayPage } from './pages/today.js';
import { EventsPage, countNewNews } from './pages/events.js';
import { ChecklistPage } from './pages/checklist.js';
import { BossesPage, IncomeKeeper } from './pages/bosses.js';
import { MesosPage } from './pages/mesos.js';
import { ProgressPage } from './pages/progress.js';
import { GearPage } from './pages/gear.js';
import { CharactersPage } from './pages/characters.js';
import { SettingsPage } from './pages/settings.js';
import { startSync, setPendingPair, tokenFromHash, syncConfig, syncStatus, onSyncStatus } from './sync.js';
import { appStatus } from './calc/status.js';

// [route, tab label, page, hidden from the tab row]
const ROUTES = [
  ['today', 'Today', TodayPage],
  ['events', 'Events', EventsPage],
  ['checklist', 'Checklist', ChecklistPage],
  ['bosses', 'Bosses', BossesPage],
  ['mesos', 'Mesos', MesosPage],
  ['gear', 'Gear', GearPage],
  ['progress', 'Progress', ProgressPage],
  ['settings', 'Settings', SettingsPage],
  ['characters', 'Characters', CharactersPage, true]
];

function currentRoute() {
  const h = location.hash.replace('#', '');
  return ROUTES.some(([key]) => key === h) ? h : 'today';
}

// A pairing link from another device (Settings → Sync → Show QR). The token is taken out of the address bar and
// history at once and handed to Settings, which asks before connecting. Runs on load and on every hash change, so
// pasting the link into a tab that already has the tracker open works the same way.
function takePairLink() {
  const token = tokenFromHash(location.hash);
  if (!token) return false;
  history.replaceState(null, '', location.pathname + location.search + '#settings');
  setPendingPair(token);
  return true;
}

function useRoute() {
  const [route, setRoute] = useState(currentRoute());
  useEffect(() => {
    const onChange = () => {
      takePairLink();
      setRoute(currentRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function Clocks() {
  const now = useNow(1000);
  const k = kstParts(now);
  return html`<div class="clocks" aria-label="Server time and resets">
    <span><b>${fmtUtcTime(now)}</b> · ${k.hh}:${k.mm} KST</span>
    <span>Daily <b>${fmtLeft(nextReset('daily', now) - now)}</b></span>
    <span>Wed <b>${fmtLeft(nextReset('wed', now) - now)}</b></span>
    <span>Thu bosses <b>${fmtLeft(nextReset('thu', now) - now)}</b></span>
    <span>Mon <b>${fmtLeft(nextReset('mon', now) - now)}</b></span>
  </div>`;
}

// Small pill in the top bar: device sync, the Nexon refresh and stale game tables in one glance. Opens Settings.
function StatusPill({ data }) {
  const now = useNow(60000);
  const [sync, setSync] = useState(syncStatus());
  // The pill starts listening a moment after it first draws; the status is read again so nothing in that gap is missed.
  useEffect(() => { const off = onSyncStatus(setSync); setSync(syncStatus()); return off; }, []);
  const st = appStatus({ syncOn: Boolean(syncConfig()), sync, meta: data.meta, news: data.news.items, tablesChecked: data.tables && data.tables.checked, now, tokenExpires: syncConfig()?.expires });
  const detail = st.parts.map((p) => p.text).join(' ');
  return html`<a class=${'status-pill ' + st.level} href="#settings" title=${detail} aria-label=${`Status: ${st.label}. ${detail}`}><i aria-hidden="true"></i>${st.label}</a>`;
}

function CharacterPicker({ state }) {
  if (state.characters.length === 0) return html`<a class="btn primary" href="#characters">Add your character</a>`;
  return html`<label class="char-pick">
    <select id="active-character" aria-label="Active character" value=${state.activeId || ''} onChange=${(e) => update((s) => { s.activeId = e.currentTarget.value; })}>
      ${state.characters.map((c) => html`<option value=${c.id}>${c.name}${c.level ? ' · Lv. ' + c.level : ''}</option>`)}
    </select>
    <a class="small" href="#characters">Manage</a>
  </label>`;
}

// Phones: the four tabs used every day sit in a bar under the thumb; the rest open from "More".
const PRIMARY = ['today', 'checklist', 'bosses', 'gear'];
const ICONS = {
  today: 'M3 11l9-7 9 7v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  checklist: 'M8 12l3 3 6-7M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
  bosses: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  gear: 'M6 4h12l4 5-10 11L2 9zM2 9h20',
  more: 'M5 12h.01M12 12h.01M19 12h.01'
};
function NavIcon({ name }) {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${ICONS[name]} /></svg>`;
}

function BottomNav({ route, newNews }) {
  const [more, setMore] = useState(false);
  useEffect(() => { setMore(false); }, [route]);
  // The sheet also closes on Escape and on a tap anywhere outside the bar.
  useEffect(() => {
    if (!more || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMore(false); };
    const onDown = (e) => { if (!(e.target && e.target.closest && e.target.closest('.bottomnav'))) setMore(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [more]);
  const rest = ROUTES.filter(([key]) => !PRIMARY.includes(key));
  return html`<nav class="bottomnav" aria-label="Sections, bottom bar">
    ${PRIMARY.map((key) => html`<a class="bn" href=${'#' + key} aria-current=${key === route ? 'page' : undefined} onClick=${() => setMore(false)}><${NavIcon} name=${key} /><span>${ROUTES.find((r) => r[0] === key)[1]}</span></a>`)}
    <button type="button" class="bn" aria-expanded=${String(more)} aria-current=${!PRIMARY.includes(route) ? 'page' : undefined} onClick=${() => setMore(!more)}>
      <${NavIcon} name="more" /><span>More</span>${newNews > 0 ? html`<i class="bn-dot" aria-label=${newNews + ' new posts'}></i>` : null}
    </button>
    ${more ? html`<div class="more-sheet">
      ${rest.map(([key, label]) => html`<a class="more-item" href=${'#' + key} aria-current=${key === route ? 'page' : undefined} onClick=${() => setMore(false)}>
        ${label}${key === 'events' && newNews > 0 ? html`<span class="dot" aria-label=${newNews + ' new posts'}>${newNews}</span>` : null}</a>`)}
    </div>` : null}
  </nav>`;
}

function App({ data }) {
  const state = useStore();
  const route = useRoute();
  const Page = ROUTES.find(([key]) => key === route)[2];
  const newNews = countNewNews(data, state);
  return html`
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand-row">
          <a class="brand" href="#today"><${Logo} /><div><h1>Maple Tracker</h1><div class="sub">GMS · Heroic · your own copy</div></div></a>
          <div class="head-right"><${StatusPill} data=${data} /><${CharacterPicker} state=${state} /></div>
        </div>
        <${Clocks} />
        <nav class="tabs" aria-label="Sections">
          ${ROUTES.filter((r) => !r[3]).map(([key, label]) => html`<a class="tab" href=${'#' + key} aria-current=${key === route ? 'page' : undefined}>
            ${label}${key === 'events' && newNews > 0 ? html`<span class="dot" aria-label=${newNews + ' new posts'}>${newNews}</span>` : null}
          </a>`)}
        </nav>
      </div>
    </header>
    <${IncomeKeeper} data=${data} state=${state} />
    <main id="main"><${Page} data=${data} state=${state} /></main>
    <${BottomNav} route=${route} newNews=${newNews} />`;
}

async function boot() {
  const root = document.getElementById('app');
  takePairLink();
  try {
    const data = await loadData();
    root.textContent = '';
    render(html`<${App} data=${data} />`, root);
    startSync();
  } catch (err) {
    root.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'boot';
    p.textContent = `The tracker couldn't load its data files (${err.message}). If you opened index.html straight from disk, serve the folder instead, or use the GitHub Pages link.`;
    root.appendChild(p);
  }
  if ('serviceWorker' in navigator && window.isSecureContext && !/[?&]nosw/.test(location.search)) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
