// One overall status for the top bar: device sync, the Nexon refresh job, and whether the hand-copied game
// tables predate the newest patch notes. Pure: takes plain values, returns what to show.
const HOUR = 3600000;
const RANK = { ok: 0, off: 0, busy: 1, warn: 2, error: 3 };

// Newest non-Classic "Patch Notes" post, or null.
export function latestPatchNotes(news) {
  return (news || [])
    .filter((n) => n && !n.isClassic && n.category === 'update' && /patch notes/i.test(n.name || '') && Number.isFinite(Date.parse(n.liveDate)))
    .sort((a, b) => Date.parse(b.liveDate) - Date.parse(a.liveDate))[0] || null;
}

// How old the Nexon files are, and why. The open page re-reads them by itself (data.js), so "old" has three
// different causes that must not be mixed up:
// - 'job': this page has just re-read the files and they are still old: the refresh job really stopped;
// - 'unreached': the last re-read failed (no connection), so the page cannot tell;
// - 'checking': the page has not managed a re-read for a while (it was asleep): one is on its way.
// refresh: { failed, at } from data.js: how the last re-read went and when. Without it (no re-reading), old means 'job'.
export const STALE_AFTER = 30 * HOUR;
const RECHECK_LATE = 1.5 * HOUR;
export function nexonAge(meta, now, refresh) {
  const checked = meta ? Date.parse(meta.checkedAt) : NaN;
  if (!meta || !Number.isFinite(checked)) return { kind: 'none', hours: 0 };
  const hours = Math.floor((now - checked) / HOUR);
  if (now - checked <= STALE_AFTER) return { kind: 'fresh', hours };
  if (refresh && refresh.failed) return { kind: 'unreached', hours };
  if (refresh && Number.isFinite(refresh.at) && now - refresh.at > RECHECK_LATE) return { kind: 'checking', hours };
  return { kind: 'job', hours };
}

// sync: { state: 'off' | 'busy' | 'ok' | 'warn' | 'error', message } from sync.js; syncOn: a token is saved on this device.
// meta: data/meta.json written by the refresh job (or null); tablesChecked: ISO date the game tables were last checked.
// tokenExpires: 'YYYY-MM-DD' typed in by the user, or null. refresh: see nexonAge.
// storageOk: false when the browser refused the last save (store.js isStorageOk); missing counts as saving.
// storageKept: what the browser says about keeping the saved entries (persist.js storageKept): true, false or null
// (it can't tell). Only Settings passes it; when it is missing, nothing is said about it.
// (Browser rules from MDN, "Storage quotas and eviction criteria".)
export function appStatus({ syncOn, sync, meta, news, tablesChecked, now, tokenExpires, refresh, storageOk, storageKept }) {
  const parts = [];
  if (storageOk === false) {
    parts.push({ key: 'storage', level: 'error', short: 'Not saving', text: `This browser isn't letting the page save. Changes made now are lost when you close the tab.${syncOn ? ' Sync still sends them to your gist while the tab is open.' : ' Export a backup before you close it.'}` });
  } else if (storageKept !== undefined) {
    const elsewhere = syncOn ? 'Sync keeps a copy in your gist.' : 'This browser holds the only copy: connect Sync, or export a backup now and then.';
    if (storageKept === true) parts.push({ key: 'storage', level: 'ok', short: 'Saved', text: `Saved in this browser, which has agreed to keep your entries until its data is cleared. ${elsewhere}` });
    else parts.push({ key: 'storage', level: 'off', short: 'Saved', text: `Saved in this browser. ${storageKept === false ? 'The browser has not agreed to keep them for good' : "The browser can't say whether it keeps them for good"}: it may remove them by itself when the device runs low on space (Safari: after 7 days of use without a visit). Clearing the browser's data removes them too. ${elsewhere}` });
  }
  if (!syncOn) parts.push({ key: 'sync', level: 'off', short: 'Sync off', text: 'Device sync is off. Your entries stay in this browser only.' });
  else if (sync && sync.state === 'error') parts.push({ key: 'sync', level: 'error', short: 'Sync error', text: `Device sync failed: ${sync.message || 'unknown error'}` });
  else if (sync && sync.state === 'busy') parts.push({ key: 'sync', level: 'busy', short: 'Syncing…', text: sync.message && sync.message !== 'Syncing…' ? sync.message : 'Syncing your entries…' });
  else if (sync && sync.state === 'warn') parts.push({ key: 'sync', level: 'warn', short: 'Check device clocks', text: sync.message || 'The clock on one of your devices is wrong.' });
  // A token is saved but no sync has finished in this tab yet: not "in sync" until one has.
  else if (!sync || sync.state !== 'ok') parts.push({ key: 'sync', level: 'busy', short: 'Not synced yet', text: 'Device sync is set up but has not run in this tab yet.' });
  else parts.push({ key: 'sync', level: 'ok', short: 'Synced', text: `Devices in sync${sync && sync.message ? ` (${sync.message.toLowerCase()})` : ''}.` });

  // The token can stop working at any time on its expiry date, so the countdown runs to the start of that date (UTC).
  const expAt = syncOn && tokenExpires ? Date.parse(`${tokenExpires}T00:00:00Z`) : NaN;
  if (Number.isFinite(expAt)) {
    const left = expAt - now;
    const days = Math.ceil(left / (24 * HOUR));
    if (left <= -24 * HOUR) parts.push({ key: 'token', level: 'error', short: 'Sync token expired', text: `Your sync token expired on ${tokenExpires}. Make a new gist-only token on GitHub and connect again in Settings.` });
    else if (left <= 0) parts.push({ key: 'token', level: 'error', short: 'Sync token expires today', text: `Your sync token expires today (${tokenExpires}). Make a new gist-only token on GitHub and connect again in Settings.` });
    else if (days <= 7) parts.push({ key: 'token', level: 'warn', short: `Sync token: ${days} day${days === 1 ? '' : 's'} left`, text: `Your sync token expires on ${tokenExpires}. Make a new gist-only token on GitHub and connect again before then.` });
  }

  const age = nexonAge(meta, now, refresh);
  if (age.kind === 'none') {
    parts.push({ key: 'nexon', level: 'warn', short: 'No Nexon data', text: 'No Nexon data yet. The refresh job has not run.' });
  } else if (age.kind === 'job') {
    parts.push({ key: 'nexon', level: 'warn', short: 'Nexon data old', text: `Events and news are ${age.hours} hours old. The 6-hour refresh job may have stopped.` });
  } else if (age.kind === 'unreached') {
    parts.push({ key: 'nexon', level: 'warn', short: 'Nexon data not re-checked', text: `Events and news are ${age.hours} hours old. This page could not load a newer copy (no connection?). It tries again when you come back to it.` });
  } else if (age.kind === 'checking') {
    parts.push({ key: 'nexon', level: 'busy', short: 'Checking Nexon data…', text: `Events and news are ${age.hours} hours old. Looking for a newer copy…` });
  } else if (meta.ok === false || (meta.errors && meta.errors.length)) {
    parts.push({ key: 'nexon', level: 'warn', short: 'Nexon problem', text: `The last Nexon refresh reported a problem: ${(meta.errors || []).slice(0, 2).join('; ') || 'unknown'}` });
  } else {
    parts.push({ key: 'nexon', level: 'ok', short: 'Nexon fresh', text: 'Events and news were refreshed from Nexon within the last 30 hours.' });
  }

  const patch = latestPatchNotes(news);
  const tablesAt = Date.parse(tablesChecked);
  if (patch && Number.isFinite(tablesAt) && Date.parse(patch.liveDate) > tablesAt) {
    parts.push({ key: 'tables', level: 'warn', short: 'New patch: check tables', text: `"${patch.name}" came out after the game tables (crystals, symbols, Star Force, cubes, EXP) were last checked. Some numbers may be out of date.`, url: patch.url || null });
  } else {
    parts.push({ key: 'tables', level: 'ok', short: 'Tables current', text: 'No patch notes are newer than the game tables.' });
  }

  const worst = parts.reduce((a, p) => (RANK[p.level] > RANK[a.level] ? p : a), parts[0]);
  const level = RANK[worst.level] === 0 ? 'ok' : worst.level;
  const label = level === 'ok' ? (syncOn ? 'All synced' : 'Data fresh · sync off') : worst.short;
  return { level, label, parts };
}
