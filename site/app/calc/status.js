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

// sync: { state: 'off' | 'busy' | 'ok' | 'error', message } from sync.js; syncOn: a token is saved on this device.
// meta: data/meta.json written by the refresh job (or null); tablesChecked: ISO date the game tables were last checked.
export function appStatus({ syncOn, sync, meta, news, tablesChecked, now }) {
  const parts = [];
  if (!syncOn) parts.push({ key: 'sync', level: 'off', short: 'Sync off', text: 'Device sync is off. Your entries stay in this browser only.' });
  else if (sync && sync.state === 'error') parts.push({ key: 'sync', level: 'error', short: 'Sync error', text: `Device sync failed: ${sync.message || 'unknown error'}` });
  else if (sync && sync.state === 'busy') parts.push({ key: 'sync', level: 'busy', short: 'Syncing…', text: 'Syncing your entries…' });
  else parts.push({ key: 'sync', level: 'ok', short: 'Synced', text: `Devices in sync${sync && sync.message ? ` (${sync.message.toLowerCase()})` : ''}.` });

  const checked = meta ? Date.parse(meta.checkedAt) : NaN;
  if (!meta || !Number.isFinite(checked)) {
    parts.push({ key: 'nexon', level: 'warn', short: 'No Nexon data', text: 'No Nexon data yet. The refresh job has not run.' });
  } else if (now - checked > 30 * HOUR) {
    parts.push({ key: 'nexon', level: 'warn', short: 'Nexon data old', text: `Events and news are ${Math.floor((now - checked) / HOUR)} hours old. The 6-hour refresh job may have stopped.` });
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
