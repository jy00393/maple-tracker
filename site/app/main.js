import { html, render, useEffect, useState } from '../vendor/htm-preact.mjs';
import { loadData } from './data.js';
import { useStore, update } from './store.js';
import { useNow, Logo } from './ui.js';
import { fmtLeft, fmtUtcTime, kstParts, nextReset } from './time.js';
import { TodayPage } from './pages/today.js';
import { EventsPage, countNewNews } from './pages/events.js';
import { ChecklistPage } from './pages/checklist.js';
import { BossesPage } from './pages/bosses.js';
import { MesosPage } from './pages/mesos.js';
import { ProgressPage } from './pages/progress.js';
import { GearPage } from './pages/gear.js';
import { CharactersPage } from './pages/characters.js';
import { SettingsPage } from './pages/settings.js';
import { startSync, connect, tokenFromHash } from './sync.js';

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

function useRoute() {
  const [route, setRoute] = useState(currentRoute());
  useEffect(() => {
    const onChange = () => {
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

function CharacterPicker({ state }) {
  if (state.characters.length === 0) return html`<a class="btn primary" href="#characters">Add your character</a>`;
  return html`<label class="char-pick">
    <select id="active-character" aria-label="Active character" value=${state.activeId || ''} onChange=${(e) => update((s) => { s.activeId = e.currentTarget.value; })}>
      ${state.characters.map((c) => html`<option value=${c.id}>${c.name}${c.level ? ' · Lv. ' + c.level : ''}</option>`)}
    </select>
    <a class="small" href="#characters">Manage</a>
  </label>`;
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
          <div class="head-right"><${CharacterPicker} state=${state} /></div>
        </div>
        <${Clocks} />
        <nav class="tabs" aria-label="Sections">
          ${ROUTES.filter((r) => !r[3]).map(([key, label]) => html`<a class="tab" href=${'#' + key} aria-current=${key === route ? 'page' : undefined}>
            ${label}${key === 'events' && newNews > 0 ? html`<span class="dot" aria-label=${newNews + ' new posts'}>${newNews}</span>` : null}
          </a>`)}
        </nav>
      </div>
    </header>
    <main id="main"><${Page} data=${data} state=${state} /></main>`;
}

async function boot() {
  const root = document.getElementById('app');
  // A pairing link from another device (Settings → Sync → Show QR). Take the token out of the address bar at once.
  const pairToken = tokenFromHash(location.hash);
  if (pairToken) history.replaceState(null, '', location.pathname + location.search + '#settings');
  try {
    const data = await loadData();
    root.textContent = '';
    render(html`<${App} data=${data} />`, root);
    if (pairToken) connect(pairToken).catch(() => {});
    else startSync();
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
