import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDateRanges, parsePost, decodeEntities, htmlToBlocks, findResetNotes, findLabeledRanges, findMaintenanceWindow } from '../lib/nexon-parse.mjs';

test('Cash Shop windows without a year use the UTC label and the post year', () => {
  const text = 'UTC: Monday, November 23 8:00 AM - Monday, December 7 7:59 AM Available in all worlds';
  const [r] = findLabeledRanges(text, '2026-11-22T16:00:00Z');
  assert.equal(new Date(r.start).toISOString(), '2026-11-23T08:00:00.000Z');
  assert.equal(new Date(r.end).toISOString(), '2026-12-07T07:59:00.000Z');
});

test('PST-labelled windows convert, and a December post rolls into January', () => {
  const [r] = findLabeledRanges('PST (UTC -8): Wednesday, December 30 12:00 AM - Tuesday, January 5 11:59 PM CET (UTC +1): Wednesday, December 30 9:00 AM - Wednesday, January 6 8:59 AM', '2026-12-29T16:00:00Z');
  assert.equal(new Date(r.start).toISOString(), '2026-12-30T08:00:00.000Z');
  assert.equal(new Date(r.end).toISOString(), '2027-01-06T07:59:00.000Z');
});

test('maintenance window from "starting ... concluding around"', () => {
  const w = findMaintenanceWindow('We will be performing a scheduled game update starting on Wednesday, November 11, 2026 at 5:00 AM PST (8:00 AM EST / 2:00 PM CET). We anticipate the maintenance to last approximately 9 hours, concluding around 2:00 PM PST (5:00 PM EST).');
  assert.equal(new Date(w.start).toISOString(), '2026-11-11T13:00:00.000Z');
  assert.equal(new Date(w.end).toISOString(), '2026-11-11T22:00:00.000Z');
});

test('bolded date parts ("Thursday , November 19 , 2026") still parse', () => {
  // Real wording of the 19 Nov 2026 minor patch post after its <strong> tags are stripped.
  const events = parsePost({ id: 48863, name: '[Completed] Scheduled Minor Patch - November 19, 2026', category: 'maintenance', liveDate: '2026-11-18T20:00:00Z' },
    '<p>We will be performing a scheduled minor patch starting on <strong>Thursday</strong>, <strong>November 19</strong>, 2026 at 5:00 AM PST (8:00 AM EST / 2:00 PM CET / 12:00 AM AEDT November 20). We anticipate the maintenance to last approximately 8 hours, concluding around 1:00 PM PST (4:00 PM EST / 10:00 PM CET / 8:00 AM AEDT November 20) .</p>');
  assert.equal(events.length, 1);
  assert.equal(events[0].start, '2026-11-19T13:00:00.000Z');
  assert.equal(events[0].end, '2026-11-19T21:00:00.000Z');
  const [r] = findDateRanges('Challenger World November 12 , 2026 (after maintenance) - February 9 , 2027 11:59 PM UTC');
  assert.equal(new Date(r.end).toISOString(), '2027-02-09T23:59:00.000Z');
});

test('channel maintenance without "starting" uses the first dated time after "will be performing"', () => {
  const w = findMaintenanceWindow('[Updated 11/20 at 6:20 PM PST] The channel maintenance has been completed. We will be performing an unscheduled channel maintenance for Event World: Quanah today, Friday, November 20, 2026 at 5:00 PM PST (8:00 PM EST / 2:00 AM CET November 21). We anticipate the maintenance to last approximately 2 hours, concluding around 7:00 PM PST (10:00 PM EST).');
  assert.equal(new Date(w.start).toISOString(), '2026-11-21T01:00:00.000Z');
  assert.equal(new Date(w.end).toISOString(), '2026-11-21T03:00:00.000Z');
});

test('maintenance posts only produce the maintenance window', () => {
  const events = parsePost({ id: 9, name: '[Scheduled] Minor Patch - November 19, 2026', category: 'maintenance', liveDate: '2026-11-18T20:00:00Z' },
    '<p>starting on Thursday, November 19, 2026 at 5:00 AM PST. Approximately 8 hours, concluding around 1:00 PM PST.</p><p>Genesis Pass extended until February 15, 2027 11:59 PM UTC.</p>');
  assert.equal(events.length, 1);
  assert.equal(events[0].start, '2026-11-19T13:00:00.000Z');
  assert.equal(events[0].end, '2026-11-19T21:00:00.000Z');
});

test('sale posts: one event per item heading', () => {
  const events = parsePost({ id: 47555, name: 'Black Friday 2026!', category: 'sale', liveDate: '2026-11-22T16:00:00Z' },
    '<h3>Black Friday Surprise Style Box</h3><p>UTC: Monday, November 23 8:00 AM - Monday, December 7 7:59 AM</p><h3>Doorbuster: Lucky Box (Monday)</h3><p>UTC: Monday, November 23 8:00 AM - Tuesday, November 24 7:59 AM</p>');
  assert.equal(events.length, 2);
  assert.equal(events[1].end, '2026-11-24T07:59:00.000Z');
});

test('two-date range with after-maintenance start and UTC end', () => {
  const [r] = findDateRanges('Challenger World November 11, 2026 (after maintenance) - February 9, 2027 11:59 PM UTC How to Participate');
  assert.equal(new Date(r.start).toISOString(), '2026-11-11T00:00:00.000Z');
  assert.equal(r.startApprox, true);
  assert.equal(r.afterMaintenance, true);
  assert.equal(new Date(r.end).toISOString(), '2027-02-09T23:59:00.000Z');
  assert.equal(r.endApprox, false);
});

test('two-date range with times on both sides', () => {
  const [r] = findDateRanges('November 12, 2026 12:00 AM UTC - February 9, 2027 11:59 PM UTC');
  assert.equal(new Date(r.start).toISOString(), '2026-11-12T00:00:00.000Z');
  assert.equal(new Date(r.end).toISOString(), '2027-02-09T23:59:00.000Z');
});

test('weekday names and "at" are accepted', () => {
  const [r] = findDateRanges('Wednesday, November 25, 2026 at 5:00 PM UTC – Tuesday, December 15, 2026 at 11:59 PM UTC');
  assert.equal(new Date(r.start).toISOString(), '2026-11-25T17:00:00.000Z');
  assert.equal(new Date(r.end).toISOString(), '2026-12-15T23:59:00.000Z');
});

test('same-day maintenance window in PST converts to UTC', () => {
  const [r] = findDateRanges('Wednesday, November 25, 2026 4:00 AM - 9:00 AM PST (12:00 - 17:00 UTC)');
  assert.equal(new Date(r.start).toISOString(), '2026-11-25T12:00:00.000Z');
  assert.equal(new Date(r.end).toISOString(), '2026-11-25T17:00:00.000Z');
});

test('PDT applies in summer', () => {
  const [r] = findDateRanges('July 8, 2026 5:00 PM PDT - July 9, 2026 5:00 PM PDT');
  assert.equal(new Date(r.start).toISOString(), '2026-07-09T00:00:00.000Z');
});

test('"until" gives an end-only window', () => {
  const [r] = findDateRanges('Rewards can be claimed until February 9, 2027 at 11:59 PM UTC.');
  assert.equal(r.start, null);
  assert.equal(new Date(r.end).toISOString(), '2027-02-09T23:59:00.000Z');
});

test('a date with no range is ignored', () => {
  assert.equal(findDateRanges('Mysterious Cryptic Chest: Untradable, expires February 9, 2027 at 11:59 PM UTC').length, 0);
});

test('entities decode', () => {
  assert.equal(decodeEntities('Bowmaster&rsquo;s &amp; Hero&#39;s &#x2605;'), 'Bowmaster’s & Hero\'s ★');
});

test('blocks split on headings and drop styles', () => {
  const blocks = htmlToBlocks('<style>.x{color:red}</style><h2>Alpha</h2><p>one</p><h3>Beta &amp; Co</h3><p>two</p>');
  assert.deepEqual(blocks.map((b) => b.heading), ['Alpha', 'Beta & Co']);
  assert.equal(blocks[1].text, 'two');
});

test('reset notes are picked up', () => {
  const notes = findResetNotes('Weekly Progression Missions can be completed once per week and progress resets every Wednesday at 12:00 AM UTC. Other text.');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /Wednesday/);
});

test('reset notes skip items that merely contain the word reset', () => {
  // Real sentences from the v.272 notes: only the first two describe a reset schedule.
  const notes = findResetNotes('Purchase limits reset every Thursday at 12:00 AM UTC . The weekly charge limit resets every Wednesday at 12:00 AM UTC . Limit AP Reset Scroll : Tradable within account, expires February 10, 2027 at 2:00 AM UTC . Round Missions: Mission progress resets when a character dies, so the relevant milestones must be reached again during a new run.');
  assert.deepEqual(notes.map((n) => n.slice(0, 20)), ['Purchase limits rese', 'The weekly charge li']);
});

test('parsePost makes one event per dated heading and skips the table of contents', () => {
  const post = { id: 47305, name: 'Maplayer One Challenger World and Burning Events!', category: 'events', isMSCW: false };
  const html = `
    <h2>Table of Contents</h2><ul><li>Challenger World</li><li>Hyper Burning MAX</li></ul>
    <h2>Challenger World</h2><p><strong>November 11, 2026 (after maintenance) - February 9, 2027 11:59 PM UTC</strong></p>
    <p>Weekly Progression Missions can be completed once per week and progress resets every Wednesday at 12:00 AM UTC.</p>
    <h3>Hyper Burning MAX</h3><p>November 11, 2026 (after maintenance) - February 9, 2027 11:59 PM UTC</p>
    <h3>Notes</h3><p>Nothing dated here.</p>`;
  const events = parsePost(post, html);
  assert.equal(events.length, 2);
  assert.equal(events[0].title, 'Challenger World');
  assert.equal(events[0].url, 'https://www.nexon.com/maplestory/news/events/47305');
  assert.equal(events[0].resets.length, 1);
  assert.equal(events[1].id, '47305-hyper-burning-max');
});

test('parsePost falls back to the first window in the post', () => {
  const events = parsePost({ id: 1, name: 'Sale', category: 'sale' }, '<p>Available from November 25, 2026 5:00 PM UTC to December 1, 2026 11:59 PM UTC.</p>');
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Sale');
});
