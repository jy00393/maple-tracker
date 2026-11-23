// Builds the subscribable calendar (site/data/calendar.ics): event end reminders, maintenance windows and weekly resets.
// Content only changes when the events change (DTSTAMP comes from the post date), so the job doesn't commit every run.
import { dedupeEvents } from '../../site/app/calc/events.js';

const DAY = 86400000;

function stamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
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

const RESETS = [
  ['weekly-thu', '2026-11-19T00:00:00Z', 'Weekly reset: bosses, crystals, Challenger Pass, Item Burning crests'],
  ['weekly-wed', '2026-11-18T00:00:00Z', 'Weekly reset: Challenger World missions, Specter Blast, Shadow Bounties records'],
  ['weekly-mon', '2026-11-16T00:00:00Z', 'Weekly reset: weekly quests']
];

export function buildCalendar(rawEvents, now = Date.now()) {
  const events = dedupeEvents(rawEvents).filter((e) => !e.isClassic && Date.parse(e.end) > now - DAY && Date.parse(e.end) < now + 200 * DAY);
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Maple Tracker//GMS events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:MapleStory GMS events', 'X-WR-CALDESC:Event ends\\, maintenance and weekly resets from Nexon\'s news (Maple Tracker)',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'
  ];
  for (const e of events) {
    const dtstamp = stamp(Date.parse(e.liveDate || e.end));
    const end = Date.parse(e.end);
    const desc = `${e.postName}${e.alsoIn && e.alsoIn.length ? ` (also in ${e.alsoIn.map((p) => p.postName).join('; ')})` : ''}\n${e.url}`;
    if (e.category === 'maintenance') {
      if (!e.start) continue;
      L.push('BEGIN:VEVENT', `UID:${e.id}@maple-tracker`, `DTSTAMP:${dtstamp}`, `DTSTART:${stamp(Date.parse(e.start))}`, `DTEND:${stamp(end)}`,
        `SUMMARY:${esc('Maintenance: ' + e.title.replace(/^\[[^\]]+\]\s*/, ''))}`, `DESCRIPTION:${esc(desc)}`, `URL:${e.url}`, 'END:VEVENT');
      continue;
    }
    L.push('BEGIN:VEVENT', `UID:${e.id}-end@maple-tracker`, `DTSTAMP:${dtstamp}`, `DTSTART:${stamp(end - 3600000)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${esc('Ends: ' + e.title)}`, `DESCRIPTION:${esc(desc)}`, `URL:${e.url}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title + ' ends tomorrow')}`, 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT');
    if (e.start && !e.startApprox && Date.parse(e.start) > now) {
      L.push('BEGIN:VEVENT', `UID:${e.id}-start@maple-tracker`, `DTSTAMP:${dtstamp}`, `DTSTART:${stamp(Date.parse(e.start))}`, 'DURATION:PT30M',
        `SUMMARY:${esc('Starts: ' + e.title)}`, `DESCRIPTION:${esc(desc)}`, `URL:${e.url}`, 'END:VEVENT');
    }
  }
  for (const [id, first, summary] of RESETS) {
    L.push('BEGIN:VEVENT', `UID:${id}@maple-tracker`, `DTSTAMP:${stamp(Date.parse(first))}`, `DTSTART:${stamp(Date.parse(first))}`, 'DURATION:PT15M',
      'RRULE:FREQ=WEEKLY', `SUMMARY:${esc(summary)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
