import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar } from '../lib/ics.mjs';

const now = Date.parse('2026-11-23T09:00:00Z');
const ev = (o) => ({ id: 'p-x', title: 'Winter Countdown', start: '2026-11-11T00:00:00.000Z', end: '2026-11-24T23:59:00.000Z', startApprox: true, endApprox: false, resets: [],
  postId: 1, postName: 'Winter Countdown Event', liveDate: '2026-10-06T17:00:30Z', category: 'events', isClassic: false, url: 'https://www.nexon.com/maplestory/news/events/1', ...o });

test('calendar has end reminders, maintenance, weekly resets and valid lines', () => {
  const ics = buildCalendar([
    ev({}),
    ev({ id: 'p2-x', postId: 2, category: 'update', postName: 'v.272 notes' }),
    ev({ id: 'm-1', title: '[Scheduled] Minor Patch, with comma; and semicolon', category: 'maintenance', start: '2026-11-25T13:00:00.000Z', end: '2026-11-25T21:00:00.000Z', startApprox: false }),
    ev({ id: 'old', end: '2026-11-01T00:00:00.000Z' }),
    ev({ id: 'classic', isClassic: true })
  ], now);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.equal((ics.match(/SUMMARY:Ends: Winter Countdown/g) || []).length, 1, 'repeats merged');
  assert.match(ics, /DTSTART:20261124T225900Z/);
  const bs = String.fromCharCode(92);
  assert.ok(ics.includes(`SUMMARY:Maintenance: Minor Patch${bs},  with comma${bs}; and semicolon`.replace(',  ', ', ')), 'escaped summary');
  assert.equal((ics.match(/RRULE:FREQ=WEEKLY/g) || []).length, 3);
  assert.ok(!ics.includes('UID:old-end'));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.equal(buildCalendar([ev({})], now), buildCalendar([ev({})], now + 3600000), 'stable between runs');
});
