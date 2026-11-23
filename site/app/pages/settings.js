import { html, useState, useEffect } from '../../vendor/htm-preact.mjs';
import { syncConfig, syncStatus, onSyncStatus, connect, disconnect, pull, pairLink } from '../sync.js';
import { qrEncode, qrPath } from '../calc/qr.js';
import { getState, replaceState, isStorageOk, blankState } from '../store.js';
import { Card, PageHead } from '../ui.js';
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
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => onSyncStatus(setSt), []);
  const cfg = syncConfig();
  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (err) { setSt({ state: 'error', message: err.message }); }
    setBusy(false);
  };
  return html`<${Card} title="Sync between PC and phone" meta=${cfg ? 'connected' : 'off'}>
    ${cfg ? html`<p class=${st.state === 'error' ? 'warnbox' : 'okbox'} role="status">${st.message || 'Connected'}${st.at ? ` · ${fmtKst(st.at)}` : ''}</p>
      <div class="toolbar">
        <button type="button" class="btn primary" disabled=${busy} onClick=${() => run(pull)}>Sync now</button>
        <button type="button" class="btn" aria-expanded=${String(showQr)} onClick=${() => setShowQr(!showQr)}>${showQr ? 'Hide QR code' : 'Connect my phone (QR code)'}</button>
        <button type="button" class="btn danger" onClick=${() => { disconnect(); setToken(''); setShowQr(false); }}>Disconnect this device</button>
      </div>
      ${showQr ? html`<${PairQr} />` : null}
      <p class="note">Changes save to your secret gist a few seconds after you make them, and each device checks for newer entries when you open it. Entries from both devices are merged; if both changed the same thing, the newer edit wins.</p>`
    : html`<p class="note">Keeps your ticks and entries the same on every device, using a secret (unlisted) gist on your own GitHub account.</p>
      <ol class="note" style=${{ paddingLeft: '18px', margin: 0 }}>
        <li>On GitHub: Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token. Tick only <b>gist</b>, and pick an expiry.</li>
        <li>Paste it here and connect. Do the same on your phone with the same token.</li>
      </ol>
      <div class="form-grid">
        <label class="field"><span>GitHub token (gist scope only)</span><input class="input" type="password" autocomplete="off" value=${token} onInput=${(e) => setToken(e.currentTarget.value)} placeholder="ghp_…" /></label>
        <button type="button" class="btn primary" disabled=${busy || !token.trim()} onClick=${() => run(() => connect(token))}>Connect</button>
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
      <${SyncCard} />
      <${InstallCard} />
      <${Card} title="Characters"><p class="note">Add, edit or remove characters, and set main stat, world and Beyond Burning.</p><div class="toolbar"><a class="btn" href="#characters">Manage characters</a></div><//>
      <${Card} title="Backup">
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
                replaceState(parsed);
                setMessage(`Imported ${parsed.characters?.length || 0} characters from ${file.name}.`);
              } catch (err) {
                setMessage(`Couldn't import that file: ${err.message}.`);
              }
              e.currentTarget.value = '';
            }} />
        </div>
        ${message ? html`<p class="note" role="status">${message}</p>` : null}
      <//>
      <${Card} title="Start over">
        <p class="note">Clears every character, tick and entry in this browser. Export a backup first if you might want them back.</p>
        <div class="toolbar">
          ${confirmReset
            ? html`<button type="button" class="btn danger" onClick=${() => { replaceState(blankState()); setConfirmReset(false); setMessage('Everything was cleared.'); }}>Yes, clear everything</button>
                <button type="button" class="btn" onClick=${() => setConfirmReset(false)}>Keep my data</button>`
            : html`<button type="button" class="btn danger" onClick=${() => setConfirmReset(true)}>Clear all data</button>`}
        </div>
      <//>
      <${Card} title="Nexon data">
        ${meta ? html`<p class="note">Last check: ${fmtKst(Date.parse(meta.checkedAt))}. ${meta.posts ? `${meta.posts} posts in Nexon's feed, ${meta.events} event windows parsed.` : ''}
          ${meta.errors && meta.errors.length ? html`<br />Problems on the last run: ${meta.errors.join('; ')}` : ' No problems on the last run.'}</p>`
          : html`<p class="note">No data file yet. The GitHub job writes it on its first run.</p>`}
        <p class="note">The job reads Nexon's public news feed and, if you list characters in <code>config/characters.json</code>, Nexon's public rankings. Nexon doesn't offer an official API for GMS, so if they change these pages the job may need a fix.</p>
      <//>
      <${Card} title="Sources">
        <p class="note">Crystal prices: ${data.bosses.source}</p>
        <p class="note">Symbols: ${data.symbols.source}</p>
        <p class="note">Liberation: ${data.liberation.source}</p>
        <p class="note">Item Burning Plus: ${data.ibp.source}</p>
        <p class="note">Star Force: ${data.upgrades.starforce.source}</p>
        <p class="note">Cubes: ${data.upgrades.cubes.source}</p>
        <p class="note">EXP: ${data.upgrades.exp.source}</p>
        <p class="note">Not affiliated with Nexon. Game names belong to Nexon; this is a personal tracker.</p>
      <//>
    </div>`;
}
