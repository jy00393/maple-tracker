// Server time is UTC. Daily reset 00:00 UTC (09:00 KST); weekly resets fall on Monday, Wednesday or Thursday.
export const DAY = 86400000;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const pad = (n) => String(n).padStart(2, '0');

export function dayKey(t) {
  return new Date(t).toISOString().slice(0, 10);
}

export function weekStart(t, weekday) {
  const d = new Date(t);
  const diff = (d.getUTCDay() - weekday + 7) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff);
}

export function monthStart(t) {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

// A key that changes exactly when the given reset happens.
export function periodKey(kind, t) {
  if (kind === 'daily') return 'daily:' + dayKey(t);
  if (kind === 'monthly') return 'monthly:' + dayKey(monthStart(t)).slice(0, 7);
  if (kind in WEEKDAY) return kind + ':' + dayKey(weekStart(t, WEEKDAY[kind]));
  return 'once';
}

export function nextReset(kind, t) {
  const d = new Date(t);
  if (kind === 'daily') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  if (kind === 'monthly') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  if (kind in WEEKDAY) return weekStart(t, WEEKDAY[kind]) + 7 * DAY;
  return Infinity;
}

export function fmtLeft(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m ${pad(s % 60)}s`;
}

export function kstParts(t) {
  const d = new Date(t + 9 * 3600000);
  return { wd: WD[d.getUTCDay()], day: d.getUTCDate(), mo: MO[d.getUTCMonth()], year: d.getUTCFullYear(), hh: pad(d.getUTCHours()), mm: pad(d.getUTCMinutes()) };
}

export function fmtKst(t, withTime = true) {
  if (t === null || t === undefined || !Number.isFinite(t)) return '—';
  const k = kstParts(t);
  return withTime ? `${k.wd} ${k.day} ${k.mo}, ${k.hh}:${k.mm} KST` : `${k.wd} ${k.day} ${k.mo}`;
}

export function fmtUtcTime(t) {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function fmtDate(t) {
  // Beyond what a date can hold (an absurd goal at a tiny income), there is nothing sensible to print.
  if (!Number.isFinite(t) || Math.abs(t) > 8.64e15) return '—';
  const k = kstParts(t);
  return `${k.day} ${k.mo} ${k.year}`;
}

// A day on its own, in Korea: "7 Dec", with the year only when it is not this year's ("7 Dec 2027").
export function fmtDay(t, now = Date.now()) {
  if (!Number.isFinite(t) || Math.abs(t) > 8.64e15) return '—';
  const k = kstParts(t);
  return k.year === kstParts(now).year ? `${k.day} ${k.mo}` : `${k.day} ${k.mo} ${k.year}`;
}

// Beside a figure that was typed by hand: the day it was typed. "" when that is not known.
export function asOf(at, now = Date.now()) {
  if (!Number.isFinite(at) || at <= 0) return '';
  return kstDays(at, now) <= 0 ? 'as of today' : `as of ${fmtDay(at, now)}`;
}

// Whole calendar days in Korea from a to b: 0 = the same Korean day, 1 = the next one. The one way the pages
// count "days left" to a deadline, so two pages never disagree about the same date.
export function kstDays(a, b) {
  const day = (t) => Math.floor((t + 9 * 3600000) / DAY);
  return day(b) - day(a);
}

// "today", "tomorrow" or "N days": the wording that goes with kstDays.
export function dayWord(n) {
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `${n} days`;
}

export function daysBetween(a, b) {
  return Math.round((b - a) / DAY);
}
