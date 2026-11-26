import { html, useState, useEffect } from '../../vendor/htm-preact.mjs';
import { syncConfig, syncStatus, onSyncStatus, connect, disconnect, pull, pairLink, pendingPair, setPendingPair, onPendingPair, setTokenExpiry } from '../sync.js';
import { qrEncode, qrPath } from '../calc/qr.js';
import { appStatus } from '../calc/status.js';
import { getState, replaceState, resetState, isStorageOk, listBackups, restoreBackup, snapshotNow } from '../store.js';
import { describeBackup } from '../calc/backups.js';
import { Card, Fold, PageHead, useClock } from '../ui.js';
import { fmtKst } from '../time.js';

function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SyncCard() {
  const [st, setSt] = useState(syncStatus());
  const [token, setToken] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [pending, setPending] = useState(pendingPair());
  const dropPending = () => { setPendingPair(null); setPending(null); };
  useEffect(() => { const off = onSyncStatus(setSt); setSt(syncStatus()); return off; }, []);
  useEffect(() => onPendingPair(setPending), []);
  const cfg = syncConfig();
  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (err) { setSt({ state: 'error', message: err.message }); }
    setBusy(false);
  };
  if (pending) {
    return html`<${Card} title="Connect this device to Sync?" meta="from a pairing link">
      <p class="warnbox">You opened a pairing link. Connect only if you just scanned the QR code from <b>your own</b> PC. Connecting merges the entries saved with that sync token into this device, and sends this device's entries there.${cfg ? ' This device is already connected to Sync; connecting replaces that connection.' : ''}</p>
      <div class="toolbar">
        <button type="button" class="btn primary" disabled=${busy} onClick=${() => { const t = pending; run(() => connect(t)).then(dropPending); }}>Connect</button>
        <button type="button" class="btn" disabled=${busy} onClick=${dropPending}>Cancel</button>
      </div>
      ${st.state === 'error' ? html`<p class="warnbox" role="alert">${st.message}</p>` : null}
    <//>`;
  }
  return html`<${Card} title="Sync between PC and phone" meta=${cfg ? 'connected' : 'off'}>
    ${cfg ? html`<p class=${st.state === 'error' || st.state === 'warn' ? 'warnbox' : 'okbox'} role="status">${st.message || 'Connected'}${st.at ? ` · ${fmtKst(st.at)}` : ''}</p>
      <div class="toolbar">
        <button type="button" class="btn primary" disabled=${busy} onClick=${() => run(pull)}>Sync now</button>
        <button type="button" class="btn" aria-expanded=${String(showQr)} onClick=${() => setShowQr(!showQr)}>${showQr ? 'Hide QR code' : 'Connect my phone (QR code)'}</button>
        <button type="button" class="btn danger" onClick=${() => { disconnect(); setToken(''); setShowQr(false); }}>Disconnect this device</button>
      </div>
      ${showQr ? html`<${PairQr} />` : null}
      <label class="field"><span>Token expiry date (optional). The top bar warns you a week before.</span><input class="input" type="date" value=${cfg.expires || ''} onInput=${(e) => { setTokenExpiry(e.currentTarget.value); setSt({ ...syncStatus() }); }} /></label>
      <p class="note">Changes save to your secret gist a few seconds after you make them, and each device checks for newer entries when you open it and every few minutes while it is on screen. Entries from both devices are merged; if both changed the same thing, the newer edit wins.</p>`
    : html`<p class="note">Keeps your ticks and entries the same on every device, using a secret (unlisted) gist on your own GitHub account.</p>
      <ol class="note" style=${{ paddingLeft: '18px', margin: 0 }}>
        <li>On GitHub: Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token. Tick only <b>gist</b>, and pick an expiry.</li>
        <li>Paste it here and connect. Do the same on your phone with the same token.</li>
      </ol>
      <div class="form-grid">
        <label class="field"><span>GitHub token (gist scope only)</span><input class="input" type="password" autocomplete="off" value=${token} onInput=${(e) => setToken(e.currentTarget.value)} placeholder="ghp_…" /></label>
        <label class="field"><span>Token expiry date (optional, for a reminder)</span><input class="input" type="date" value=${expires} onInput=${(e) => setExpires(e.currentTarget.value)} /></label>
        <button type="button" class="btn primary" disabled=${busy || !token.trim()} onClick=${() => run(() => connect(token, expires))}>Connect</button>
      </div>
      ${st.state === 'error' ? html`<p class="warnbox" role="alert">${st.message}</p>` : null}
      <p class="note">The token is stored only in this browser and never goes into backups. Anyone with access to this browser profile could read it, so keep its scope to gists.</p>`}
  <//>`;
}

function PairQr() {
  const link = pairLink();
  const qr = link ? qrEncode(link) : null;
  if (!qr) return html`<p class="warnbox">This token is too long for a QR code. Paste it on your phone instead.</p>`;
  const { d, box } = qrPath(qr);
  return html`<div class="qr-wrap">
    <svg class="qr" viewBox=${`0 0 ${box} ${box}`} role="img" aria-label="QR code that connects another device to your sync"><rect width=${box} height=${box} fill="#fff" /><path d=${d} fill="#000" /></svg>
    <p class="note">Point your phone's camera at this and open the link. It opens the tracker and connects it with the same token. <b>Treat this code like a password:</b> anyone who scans it can read and change your synced entries, so don't screenshot or share it.</p>
  </div>`;
}

// The same status the top-bar pill shows, spelled out.
function StatusCard({ data }) {
  // The same clock as the pill, so the two never disagree about how old the data is.
  const now = useClock({ every: 60000 });
  const [sync, setSync] = useState(syncStatus());
  useEffect(() => { const off = onSyncStatus(setSync); setSync(syncStatus()); return off; }, []);
  const st = appStatus({ syncOn: Boolean(syncConfig()), sync, meta: data.meta, news: data.news.items, tablesChecked: data.tables && data.tables.checked, now, tokenExpires: syncConfig()?.expires, refresh: data.refresh });
  const names = { sync: 'Your devices', token: 'Sync token', nexon: 'Nexon events and news', tables: 'Game tables' };
  return html`<${Card} title="Status" meta=${st.label} className="span2">
    ${st.parts.map((p) => html`<p class=${p.level === 'error' || p.level === 'warn' ? 'warnbox' : 'note'}><b>${names[p.key]}:</b> ${p.text}${p.url ? html` <a href=${p.url} target="_blank" rel="noopener">Open the post</a>` : null}</p>`)}
    <p class="note">Events and news refresh from Nexon every 6 hours, and this page picks up the new copy by itself while it stays open. The game tables were copied by hand from the sources below and only change with a patch, so they are checked, not refreshed.</p>
  <//>`;
}

// Daily safety copies kept in this browser, with one-tap restore.
function BackupsCard() {
  // Read on every draw, so a copy made by Clear all data or an import on this page shows at once.
  const list = listBackups();
  const [confirm, setConfirm] = useState(null);
  const [msg, setMsg] = useState('');
  return html`<${Card} title="Daily safety copies" meta=${list.length ? `${list.length} kept` : 'none yet'}>
    <p class="note">Once a day the tracker keeps a copy of your entries in this browser (the last 7 days). Restore one if an edit or a sync goes wrong. Restoring first saves what you have now, so it can be undone.</p>
    ${list.length === 0 ? html`<p class="note">The first copy is made the next day you use the tracker with entries saved.</p>` : list.map((b) => html`<div class="row">
      <span class="lbl">${fmtKst(b.at)}${b.label ? html` <span class="pill">${b.label}</span>` : null}<span class="small muted"> · ${describeBackup(b)}</span></span>
      <div class="right">${confirm === b.at
        ? html`<button type="button" class="btn danger" onClick=${() => { const done = restoreBackup(b.at); setConfirm(null); setMsg(!done ? 'That copy is no longer there.' : done.kept ? `Restored the copy from ${fmtKst(b.at)}.` : `Restored the copy from ${fmtKst(b.at)}. The browser is out of room, so what you had before could not be kept.`); }}>Yes, restore</button>
            <button type="button" class="btn" onClick=${() => setConfirm(null)}>Cancel</button>`
        : html`<button type="button" class="btn" onClick=${() => setConfirm(b.at)}>Restore</button>`}</div>
    </div>`)}
    ${msg ? html`<p class="okbox" role="status">${msg}</p>` : null}
    ${confirm !== null && syncConfig() ? html`<p class="warnbox" role="alert">Sync is on: restoring replaces your entries on <b>every synced device</b> with this copy, including characters added since. What you have now is kept here as a “before restore” copy.</p>` : null}
    ${syncConfig() ? html`<p class="note">With Sync on, a restored copy is sent to your other devices too.</p>` : null}
  <//>`;
}

function InstallCard() {
  const [prompt, setPrompt] = useState(null);
  const [done, setDone] = useState(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); };
    const onInstalled = () => setDone(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  return html`<${Card} title="Install on your phone" meta=${done ? 'installed' : ''}>
    ${done ? html`<p class="okbox">Running as an installed app.</p>` : prompt
      ? html`<button type="button" class="btn primary" onClick=${async () => { prompt.prompt(); await prompt.userChoice; setPrompt(null); }}>Install Maple Tracker</button>`
      : null}
    <p class="note"><b>iPhone (Safari):</b> open your tracker link, tap Share, then Add to Home Screen. <b>Android (Chrome):</b> menu ⋮ → Add to Home screen (or Install app). It opens full screen and works offline with the last data it saw.</p>
  <//>`;
}

export function SettingsPage({ data }) {
  const [message, setMessage] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const meta = data.meta;
  return html`
    <${PageHead} title="Settings">Your ticks and entries are saved in this browser only. Export a backup to move them to another device.<//>
    ${!isStorageOk() ? html`<p class="warnbox">This browser isn't letting the page save. Changes will be lost when you close the tab.</p>` : null}
    <div class="grid two">
      <${StatusCard} data=${data} />
      <${SyncCard} />
      <${InstallCard} />
      <${Card} title="Characters"><p class="note">Add, edit or remove characters, and set main stat, world and Beyond Burning.</p><div class="toolbar"><a class="btn" href="#characters">Manage characters</a></div><//>
      <${BackupsCard} />
      <${Card} title="Backup file">
        <div class="toolbar">
          <button type="button" class="btn primary" onClick=${() => {
            const stamp = new Date().toISOString().slice(0, 10);
            download(`maple-tracker-backup-${stamp}.json`, JSON.stringify(getState(), null, 1));
            setMessage('Backup downloaded.');
          }}>Export backup</button>
          <label class="btn" for="import-file">Import backup</label>
          <input id="import-file" type="file" accept="application/json,.json" style=${{ display: 'none' }}
            onChange=${async (e) => {
              const file = e.currentTarget.files[0];
              if (!file) return;
              try {
                const parsed = JSON.parse(await file.text());
                if (!parsed || parsed.v !== 1) throw new Error('not a Maple Tracker backup');
                // A safety copy first, so an import that turns out wrong can be undone from Restore.
                const had = getState().updatedAt > 0;
                const kept = snapshotNow('before import');
                replaceState(parsed);
                const n = getState().characters.length;
                setMessage(`Imported ${n} character${n === 1 ? '' : 's'} from ${file.name}.${!had ? '' : kept ? ' A copy of the previous data is saved under Daily safety copies (the last three such copies are kept).' : ' The browser is out of room, so no copy of the previous data was kept.'}`);
              } catch (err) {
                setMessage(`Couldn't import that file: ${err.message}.`);
              }
              e.currentTarget.value = '';
            }} />
        </div>
        ${message ? html`<p class="note" role="status">${message}</p>` : null}
      <//>
      <${Fold} title="Start over" meta="clear all data">
        <p class="note">Clears every character, tick and entry in this browser. Export a backup first if you might want them back.${syncConfig() ? ' This device is disconnected from Sync first, so your other devices and the synced copy keep their data.' : ''}</p>
        <div class="toolbar">
          ${confirmReset
            ? html`<button type="button" class="btn danger" onClick=${() => { const wasSynced = Boolean(syncConfig()); if (wasSynced) disconnect(); const had = getState().updatedAt > 0; const kept = snapshotNow('before clearing'); resetState(); setConfirmReset(false); setMessage((wasSynced ? 'Everything was cleared here, and this device was disconnected from Sync.' : 'Everything was cleared.') + (!had ? '' : kept ? ' A copy from just before is under Daily safety copies.' : ' The browser is out of room, so no safety copy was kept.')); }}>Yes, clear everything</button>
                <button type="button" class="btn" onClick=${() => setConfirmReset(false)}>Keep my data</button>`
            : html`<button type="button" class="btn danger" onClick=${() => setConfirmReset(true)}>Clear all data</button>`}
        </div>
      <//>
      <${Fold} title="Nexon data" meta="how the refresh works">
        ${meta ? html`<p class="note">Last check: ${fmtKst(Date.parse(meta.checkedAt))}. ${meta.posts ? `${meta.posts} posts in Nexon's feed, ${meta.events} event windows parsed.` : ''}
          ${meta.errors && meta.errors.length ? html`<br />Problems on the last run: ${meta.errors.join('; ')}` : ' No problems on the last run.'}</p>`
          : html`<p class="note">No data file yet. The GitHub job writes it on its first run.</p>`}
        <p class="note">The job reads Nexon's public news feed and, if you list characters in <code>config/characters.json</code>, Nexon's public rankings. Nexon doesn't offer an official API for GMS, so if they change these pages the job may need a fix.</p>
      <//>
      <${Fold} title="Sources" meta="where the game numbers come from">
        <p class="note">Crystal prices: ${data.bosses.source}</p>
        <p class="note">Symbols: ${data.symbols.source}</p>
        <p class="note">Liberation: ${data.liberation.source}</p>
        <p class="note">Item Burning Plus: ${data.ibp.source}</p>
        <p class="note">Star Force: ${data.upgrades.starforce.source}</p>
        <p class="note">Cubes: ${data.upgrades.cubes.source}</p>
        <p class="note">Potential lines: ${data.potential.source}</p>
        <p class="note">Star Force stats, set effects, damage formula: ${data.gearStats.source}</p>
        ${data.season ? html`<p class="note">Season end: ${data.season.source}</p>` : null}
        <p class="note">EXP: ${data.upgrades.exp.source}</p>
        <p class="note">Not affiliated with Nexon. Game names belong to Nexon; this is a personal tracker.</p>
      <//>
    </div>`;
}
