// Builds the subscribable calendar (site/data/calendar.ics): event end reminders, maintenance windows, weekly resets,
// Sunny Sundays (events.json "sunny"), the hand-typed dates in upcoming.json and the season deadlines in season.json.
// Cash Shop sales are left out, as on Today. Events of one post that end at the same minute share one entry.
// Content only changes when the inputs change (DTSTAMP comes from the post or item date), so the job doesn't commit
// every run. UIDs come from ids and dates, never from list positions, so calendars update entries instead of adding.
import { dedupeEvents } from '../../site/app/calc/events.js';
import { isStarForcePerk } from '../../site/app/calc/sunny.js';

const DAY = 86400000;

function stamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function dateOnly(ms) {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
}

function esc(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// RFC 5545: lines longer than 75 octets continue on the next line after a space.
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (len + n > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = '';
      len = 0;
    }
    cur += ch;
    len += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const alarm = (text, trigger = '-P1D') => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(text)}`, `TRIGGER:${trigger}`, 'END:VALARM'];
const noTag = (text) => String(text || '').replace(/^\[[^\]]+\]\s*/, '');

// Each part of a reset's summary lasts until its event ends (dates from site/data/checklist.json "until"), so the
// feed stops naming Specter Blast or the Challenger World items once they are over.
const RESETS = [
  ['weekly-thu', '2026-11-19T00:00:00Z', [['bosses', null], ['crystals', null], ['Challenger Pass', '2027-02-09T23:59:00Z'], ['Item Burning crests', '2027-02-09T23:59:00Z']]],
  ['weekly-wed', '2026-11-18T00:00:00Z', [['Challenger World missions', '2027-02-09T23:59:00Z'], ['Specter Blast', '2026-12-15T23:59:00Z'], ['Shadow Bounties records', '2027-02-09T23:59:00Z']]],
  ['weekly-mon', '2026-11-16T00:00:00Z', [['weekly quests', null]]]
];

// extra: { sunny: events.json "sunny", upcoming: upcoming.json, season: season.json }; each one is optional.
export function buildCalendar(rawEvents, now = Date.now(), extra = {}) {
  const events = dedupeEvents(rawEvents)
    .filter((e) => !e.isClassic && e.category !== 'sale' && Date.parse(e.end) > now - DAY && Date.parse(e.end) < now + 200 * DAY);
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Maple Tracker//GMS events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:MapleStory GMS events',
    'X-WR-CALDESC:Event ends\\, maintenance\\, Sunny Sundays\\, season deadlines and weekly resets from Nexon\'s news (Maple Tracker)',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'
  ];
  const descOf = (e) => `${e.postName}${e.alsoIn && e.alsoIn.length ? ` (also in ${e.alsoIn.map((p) => p.postName).join('; ')})` : ''}\n${e.url}`;

  // Event ends, grouped by post and end minute (first-seen order).
  const groups = new Map();
  for (const e of events) {
    const dtstamp = stamp(Date.parse(e.liveDate || e.end));
    if (e.category === 'maintenance') {
      if (!e.start) continue;
      L.push('BEGIN:VEVENT', `UID:${e.id}@maple-tracker`, `DTSTAMP:${dtstamp}`, `DTSTART:${stamp(Date.parse(e.start))}`, `DTEND:${stamp(Date.parse(e.end))}`,
        `SUMMARY:${esc('Maintenance: ' + noTag(e.title))}`, `DESCRIPTION:${esc(descOf(e))}`, `URL:${e.url}`, 'END:VEVENT');
      continue;
    }
    const key = `${e.postId}|${Date.parse(e.end)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
    if (e.start && !e.startApprox && Date.parse(e.start) > now) {
      L.push('BEGIN:VEVENT', `UID:${e.id}-start@maple-tracker`, `DTSTAMP:${dtstamp}`, `DTSTART:${stamp(Date.parse(e.start))}`, 'DURATION:PT30M',
        `SUMMARY:${esc('Starts: ' + e.title)}`, `DESCRIPTION:${esc(descOf(e))}`, `URL:${e.url}`, 'END:VEVENT');
    }
  }
  for (const list of groups.values()) {
    const e = list[0];
    const end = Date.parse(e.end);
    const dtstamp = stamp(Math.max(...list.map((x) => Date.parse(x.liveDate || x.end))));
    if (list.length === 1) {
      L.push('BEGIN:VEVENT', `UID:${e.id}-end@maple-tracker`, `DTSTAMP:${dtstamp}`, `DTSTART:${stamp(end - 3600000)}`, `DTEND:${stamp(end)}`,
        `SUMMARY:${esc('Ends: ' + e.title)}`, `DESCRIPTION:${esc(descOf(e))}`, `URL:${e.url}`, ...alarm(e.title + ' ends tomorrow'), 'END:VEVENT');
      continue;
    }
    const name = noTag(e.postName);
    const summary = `${list.length} things from ${name}`;
    L.push('BEGIN:VEVENT', `UID:post-${e.postId}-${stamp(end)}-end@maple-tracker`, `DTSTAMP:${dtstamp}`, `DTSTART:${stamp(end - 3600000)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${esc('Ends: ' + summary)}`, `DESCRIPTION:${esc(`${list.map((x) => x.title).join('\n')}\n\n${descOf(e)}`)}`, `URL:${e.url}`,
      ...alarm(`${summary} end tomorrow`), 'END:VEVENT');
  }

  // Sunny Sundays run 00:00 to 23:59 UTC (09:00 KST Sunday to 08:59 KST Monday). Only Star Force ones get a reminder.
  for (const s of extra.sunny || []) {
    const start = Date.parse(`${s && s.date}T00:00:00Z`);
    if (!s || !Number.isFinite(start) || !Array.isArray(s.perks) || start + DAY <= now - DAY || start >= now + 200 * DAY) continue;
    const sf = s.perks.find(isStarForcePerk);
    const summary = sf ? `Sunny Sunday: ${sf}` : 'Sunny Sunday';
    L.push('BEGIN:VEVENT', `UID:sunny-${s.date}@maple-tracker`, `DTSTAMP:${stamp(start)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(start + DAY)}`,
      `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(s.perks.join('\n'))}`, 'TRANSP:TRANSPARENT',
      ...(sf ? alarm(`${summary}: tomorrow`) : []), 'END:VEVENT');
  }

  // Hand-typed dates (upcoming.json). Repeating ones ("group") get no reminder.
  const up = extra.upcoming || {};
  for (const it of up.items || []) {
    const at = Date.parse(it && it.at);
    if (!it || !it.id || !it.title || !Number.isFinite(at) || at <= now - DAY || at >= now + 400 * DAY) continue;
    const desc = [it.note, up.sourceUrl].filter(Boolean).join('\n');
    const when = it.day ? [`DTSTART;VALUE=DATE:${dateOnly(at)}`, `DTEND;VALUE=DATE:${dateOnly(at + DAY)}`] : [`DTSTART:${stamp(at)}`, 'DURATION:PT30M'];
    L.push('BEGIN:VEVENT', `UID:upcoming-${it.id}@maple-tracker`, `DTSTAMP:${stamp(at)}`, ...when,
      `SUMMARY:${esc(it.title)}`, ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []), ...(it.day ? ['TRANSP:TRANSPARENT'] : []),
      ...(it.group ? [] : alarm(`${it.title}: tomorrow`)), 'END:VEVENT');
  }

  // Season deadlines (season.json actions): one entry per deadline, with a reminder three days before.
  const season = extra.season || {};
  const byTime = new Map();
  for (const a of season.actions || []) {
    const by = Date.parse(a && a.by);
    if (!a || !a.label || !Number.isFinite(by) || by <= now - DAY || by >= now + 400 * DAY) continue;
    if (!byTime.has(by)) byTime.set(by, []);
    byTime.get(by).push(a);
  }
  for (const [by, list] of [...byTime].sort((a, b) => a[0] - b[0])) {
    const summary = list.length === 1 ? `Deadline: ${list[0].label}` : `Deadline: ${list.length} steps for ${season.name || 'the season'}`;
    const desc = [list.map((a) => a.label).join('\n'), season.sourceUrl].filter(Boolean).join('\n\n');
    L.push('BEGIN:VEVENT', `UID:season-${stamp(by)}@maple-tracker`, `DTSTAMP:${stamp(by)}`, `DTSTART:${stamp(by - 3600000)}`, `DTEND:${stamp(by)}`,
      `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(desc)}`, ...alarm(`${summary} (3 days left)`, '-P3D'), 'END:VEVENT');
  }

  for (const [id, first, parts] of RESETS) {
    const live = parts.filter(([, until]) => !until || Date.parse(until) > now).map(([text]) => text);
    if (!live.length) continue;
    const summary = `Weekly reset: ${live.join(', ')}`;
    L.push('BEGIN:VEVENT', `UID:${id}@maple-tracker`, `DTSTAMP:${stamp(Date.parse(first))}`, `DTSTART:${stamp(Date.parse(first))}`, 'DURATION:PT15M',
      'RRULE:FREQ=WEEKLY', `SUMMARY:${esc(summary)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
