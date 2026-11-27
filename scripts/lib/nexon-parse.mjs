// Pure helpers for reading Nexon's MapleStory news posts.
// No DOM, no network: works in Node (the GitHub Action) and in tests.

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…',
  bull: '•', middot: '·', times: '×', star: '★', trade: '™', reg: '®', copy: '©', deg: '°',
  rarr: '→', larr: '←', laquo: '«', raquo: '»', minus: '−', plusmn: '±'
};

export function decodeEntities(input) {
  return String(input).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    const value = NAMED_ENTITIES[entity.toLowerCase()];
    return value === undefined ? match : value;
  });
}

export function cleanText(fragment) {
  return decodeEntities(
    String(fragment)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|td|th|h[1-6]|ul|ol|table|section|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\f\v ​]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}

// Split a post body into blocks, one per h1-h4 heading (plus any text before the first heading).
export function htmlToBlocks(html) {
  const source = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const headingRe = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const blocks = [];
  let lastIndex = 0;
  let current = { heading: null, parts: [] };
  let match;
  while ((match = headingRe.exec(source))) {
    current.parts.push(source.slice(lastIndex, match.index));
    blocks.push(current);
    current = { heading: cleanText(match[2]).replace(/\s+/g, ' '), parts: [] };
    lastIndex = headingRe.lastIndex;
  }
  current.parts.push(source.slice(lastIndex));
  blocks.push(current);
  return blocks
    .map((b) => ({ heading: b.heading, text: cleanText(b.parts.join(' ')) }))
    .filter((b) => b.heading || b.text);
}

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
};
const MONTH_PATTERN = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const WEEKDAY_PATTERN = '(?:(?:Mon|Tues|Tue|Wednes|Wed|Thurs|Thu|Fri|Satur|Sat|Sun)(?:day)?\\.?\\s*,?\\s+)?';
const DATE_PATTERN = `${WEEKDAY_PATTERN}${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})`;
// The zone after a time must be on the same line and must not be the label of the next range ("UTC:", "PST (UTC -8):").
const TIME_PATTERN = '(?:\\s*,?\\s*(?:at\\s+)?)(\\d{1,2})(?::(\\d{2}))?\\s*([AaPp])\\.?\\s*[Mm]\\.?(?:[ \\t]*(UTC|GMT|PST|PDT|PT)\\b(?![ \\t]*(?::|\\(UTC[^)]*\\)[ \\t]*:)))?';
// Between two dates; a "(UTC -8)" note after the first time is allowed before the dash.
const SEPARATOR_RE = /^\s*(?:\(UTC\s*[-+−]?\s*\d+\)\s*)?(?:-|–|—|~|to|through|thru|until)\s*$/i;

// US Pacific daylight time: second Sunday of March 02:00 to first Sunday of November 02:00 (local).
function isPacificDst(year, month, day) {
  const nthSunday = (y, m, n) => {
    const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  };
  const start = Date.UTC(year, 2, nthSunday(year, 2, 2));
  const end = Date.UTC(year, 10, nthSunday(year, 10, 1));
  const t = Date.UTC(year, month, day);
  return t >= start && t < end;
}

function offsetHours(tz, year, month, day) {
  switch ((tz || 'UTC').toUpperCase()) {
    case 'PST': return -8;
    case 'PDT': return -7;
    case 'PT': return isPacificDst(year, month, day) ? -7 : -8;
    default: return 0;
  }
}

function toUtcMs(date, time, tz, fallbackEndOfDay) {
  const { year, month, day } = date;
  let hours = 0;
  let minutes = 0;
  if (time) {
    hours = time.hour % 12 + (time.pm ? 12 : 0);
    minutes = time.minute;
  } else if (fallbackEndOfDay) {
    hours = 23;
    minutes = 59;
  }
  const offset = time ? offsetHours(tz, year, month, day) : 0;
  return Date.UTC(year, month, day, hours - offset, minutes);
}

function readTime(text, index) {
  const re = new RegExp('^' + TIME_PATTERN);
  const m = re.exec(text.slice(index));
  if (!m) return null;
  return {
    hour: parseInt(m[1], 10),
    minute: m[2] ? parseInt(m[2], 10) : 0,
    pm: m[3].toLowerCase() === 'p',
    tz: m[4] ? m[4].toUpperCase() : null,
    length: m[0].length
  };
}

// One token from findDateTokens as a time (ms, UTC). A date without a time means the end of that day.
export function tokenTime(token) {
  return toUtcMs(token.date, token.time, token.time && token.time.tz, true);
}

// Find every date (with an optional time right after it) in a block of text.
export function findDateTokens(text) {
  const re = new RegExp(DATE_PATTERN, 'gi');
  const tokens = [];
  let m;
  while ((m = re.exec(text))) {
    const month = MONTHS[m[1].toLowerCase().replace('.', '')];
    if (month === undefined) continue;
    const date = { year: parseInt(m[3], 10), month, day: parseInt(m[2], 10) };
    let end = m.index + m[0].length;
    const time = readTime(text, end);
    if (time) end += time.length;
    let afterMaintenance = false;
    // "(after maintenance)", "(End of Maintenance)", "(following maintenance)"
    const maint = /^\s*\(\s*(?:after|end\s+of|following)\s+(?:the\s+)?maintenance\s*\)/i.exec(text.slice(end));
    if (maint) {
      afterMaintenance = true;
      end += maint[0].length;
    }
    tokens.push({ start: m.index, end, date, time, afterMaintenance });
  }
  return tokens;
}

// Turn date tokens into ranges: "A - B", "A TIME - TIME TZ" (same day) and "until B".
export function findDateRanges(text) {
  const tokens = findDateTokens(text);
  const ranges = [];
  const used = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (used.has(i)) continue;
    const a = tokens[i];
    const b = tokens[i + 1];
    if (b && SEPARATOR_RE.test(text.slice(a.end, b.start))) {
      used.add(i);
      used.add(i + 1);
      ranges.push(makeRange(text, a, b));
      continue;
    }
    // A second date written without its year: "October 7, 2026 12:00 AM UTC - November 10 11:59 PM UTC". It takes
    // the first date's year, or the next one when its month comes earlier in the year.
    // Case-sensitive: a capitalised month name only, so "may 3 times" or "to dec 5" in a sentence is not a date,
    // and the day must end there (not "November 10th floor" or "December 12 characters").
    const yearless = new RegExp(`^\\s*(?:-|–|—|~|[Tt]o|[Tt]hrough|[Tt]hru|[Uu]ntil)\\s*${WEEKDAY_PATTERN}${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\s*,?\\s*\\d{4})(?=\\s*(?:$|[,.;)]|\\d{1,2}(?::\\d{2})?\\s*[AaPp]\\.?\\s*[Mm]|\\(|at\\s))`).exec(text.slice(a.end));
    if (yearless) {
      const month = MONTHS[yearless[1].toLowerCase().replace('.', '')];
      const day = parseInt(yearless[2], 10);
      const year = a.date.year + (month < a.date.month ? 1 : 0);
      // A day the month doesn't have (November 31) is not a date.
      if (month !== undefined && new Date(Date.UTC(year, month, day)).getUTCDate() === day) {
        const bEnd = a.end + yearless[0].length;
        const bTime = readTime(text, bEnd);
        const date = { year: a.date.year + (month < a.date.month ? 1 : 0), month, day: parseInt(yearless[2], 10) };
        used.add(i);
        ranges.push({ ...makeRange(text, a, { start: a.end, end: bEnd + (bTime ? bTime.length : 0), date, time: bTime }), inferredYear: true });
        continue;
      }
    }
    // Same-day window: "November 25, 2026 4:00 AM - 9:00 AM PST"
    if (a.time) {
      const rest = text.slice(a.end);
      const sep = /^\s*(?:-|–|—|~|to)\s*/i.exec(rest);
      const t2 = sep ? readTime(rest, sep[0].length) : null;
      if (t2) {
        used.add(i);
        const tz = a.time.tz || t2.tz || zoneLabelBefore(text, a.start) || 'UTC';
        const start = toUtcMs(a.date, a.time, tz, false);
        let end = toUtcMs(a.date, t2, t2.tz || tz, true);
        // "10:00 PM - 2:00 AM": the window runs past midnight, so it ends the next day.
        if (end <= start) end += 86400000;
        ranges.push({
          start,
          end,
          startApprox: false,
          endApprox: false,
          afterMaintenance: a.afterMaintenance,
          raw: text.slice(a.start, a.end + sep[0].length + t2.length).replace(/\s+/g, ' ').trim()
        });
        continue;
      }
    }
    const before = text.slice(Math.max(0, a.start - 12), a.start);
    if (/\b(?:until|ends?|through)\s*(?:on\s*)?$/i.test(before)) {
      used.add(i);
      const tz = a.time ? a.time.tz || 'UTC' : 'UTC';
      ranges.push({
        start: null,
        end: toUtcMs(a.date, a.time, tz, true),
        startApprox: true,
        endApprox: !a.time,
        afterMaintenance: false,
        raw: text.slice(Math.max(0, a.start - 6), a.end).trim()
      });
    }
  }
  // A window that ends before it starts (a typo in the post, or two dates the wrong way round) is not a window.
  return ranges.filter((r) => r.start === null || r.end > r.start);
}

// A zone written as a label in front of a date ("PST: Thursday, November 12, 2026 12:00 AM - ...",
// "PST (UTC -8): ..."), or null.
function zoneLabelBefore(text, at) {
  const label = /\b(UTC|PST|PDT|PT)(?:\s*\(UTC\s*[-+−]?\s*\d+\))?\s*:\s*$/i.exec(text.slice(Math.max(0, at - 30), at));
  return label ? label[1].toUpperCase() : null;
}

function makeRange(text, a, b) {
  // The label in front counts when neither time names a zone.
  const tz = (a.time && a.time.tz) || (b.time && b.time.tz) || zoneLabelBefore(text, a.start) || 'UTC';
  return {
    start: toUtcMs(a.date, a.time, (a.time && a.time.tz) || tz, false),
    end: toUtcMs(b.date, b.time, (b.time && b.time.tz) || tz, true),
    startApprox: !a.time,
    endApprox: !b.time,
    afterMaintenance: a.afterMaintenance,
    raw: text.slice(a.start, b.end).replace(/\s+/g, ' ').trim()
  };
}

// Cash Shop posts give windows without a year and with a time-zone label in front:
// "UTC: Monday, November 23 8:00 AM - Monday, December 7 7:59 AM". The year comes from the post date.
const LABELED_RANGE_RE = new RegExp(
  `\\b(UTC|PST|PDT|PT)(?:\\s*\\(UTC\\s*[-+−]?\\s*\\d+\\))?\\s*:\\s*${WEEKDAY_PATTERN}${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?${TIME_PATTERN}\\s*(?:-|–|—|~|to)\\s*${WEEKDAY_PATTERN}${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?${TIME_PATTERN}`,
  'gi'
);

function inferYear(month, refIso) {
  const ref = new Date(refIso || Date.now());
  const refYear = ref.getUTCFullYear();
  const refMonth = ref.getUTCMonth();
  if (month < refMonth - 6) return refYear + 1;
  if (month > refMonth + 6) return refYear - 1;
  return refYear;
}

export function findLabeledRanges(text, refIso) {
  const ranges = [];
  const re = new RegExp(LABELED_RANGE_RE.source, 'gi');
  let m;
  while ((m = re.exec(text))) {
    const label = m[1].toUpperCase();
    const month1 = MONTHS[m[2].toLowerCase().replace('.', '')];
    const month2 = MONTHS[m[8].toLowerCase().replace('.', '')];
    if (month1 === undefined || month2 === undefined) continue;
    const date1 = { year: inferYear(month1, refIso), month: month1, day: parseInt(m[3], 10) };
    let year2 = date1.year;
    if (month2 < month1) year2 += 1;
    const date2 = { year: year2, month: month2, day: parseInt(m[9], 10) };
    const time1 = { hour: parseInt(m[4], 10), minute: m[5] ? parseInt(m[5], 10) : 0, pm: m[6].toLowerCase() === 'p' };
    const time2 = { hour: parseInt(m[10], 10), minute: m[11] ? parseInt(m[11], 10) : 0, pm: m[12].toLowerCase() === 'p' };
    ranges.push({
      index: m.index,
      start: toUtcMs(date1, time1, (m[7] || label).toUpperCase(), false),
      end: toUtcMs(date2, time2, (m[13] || label).toUpperCase(), true),
      startApprox: false,
      endApprox: false,
      afterMaintenance: false,
      label,
      raw: m[0].replace(/\s+/g, ' ').trim()
    });
  }
  // The same layout with the start written as "(End of Maintenance)" instead of a time:
  // "UTC: Wednesday, November 11 (End of Maintenance) - Wednesday, December 9 7:59 AM".
  const maintRe = new RegExp(
    `\\b(UTC|PST|PDT|PT)(?:\\s*\\(UTC\\s*[-+−]?\\s*\\d+\\))?\\s*:\\s*${WEEKDAY_PATTERN}${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*\\(\\s*(?:after|end\\s+of|following)\\s+(?:the\\s+)?maintenance\\s*\\)\\s*(?:-|–|—|~|to)\\s*${WEEKDAY_PATTERN}${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?${TIME_PATTERN}`,
    'gi'
  );
  while ((m = maintRe.exec(text))) {
    const label = m[1].toUpperCase();
    const month1 = MONTHS[m[2].toLowerCase().replace('.', '')];
    const month2 = MONTHS[m[4].toLowerCase().replace('.', '')];
    if (month1 === undefined || month2 === undefined) continue;
    const date1 = { year: inferYear(month1, refIso), month: month1, day: parseInt(m[3], 10) };
    const date2 = { year: date1.year + (month2 < month1 ? 1 : 0), month: month2, day: parseInt(m[5], 10) };
    const time2 = { hour: parseInt(m[6], 10), minute: m[7] ? parseInt(m[7], 10) : 0, pm: m[8].toLowerCase() === 'p' };
    ranges.push({
      index: m.index,
      start: toUtcMs(date1, null, label, false),
      end: toUtcMs(date2, time2, (m[9] || label).toUpperCase(), true),
      startApprox: true,
      endApprox: false,
      afterMaintenance: true,
      label,
      raw: m[0].replace(/\s+/g, ' ').trim()
    });
  }
  // UTC-labelled windows repeat the same window in other zones; keep the UTC one when both exist.
  const utc = ranges.filter((r) => r.label === 'UTC');
  return utc.length ? utc : ranges;
}

// Maintenance posts: "starting on Wednesday, November 11, 2026 at 5:00 AM PST ... concluding around 2:00 PM PST".
// Channel maintenance posts skip "starting": "for Event World: Quanah today, Friday, November 20, 2026 at 5:00 PM PST".
function findMaintenanceStart(text) {
  const startRe = new RegExp(`starting\\s+(?:on\\s+)?${DATE_PATTERN}`, 'i');
  const m = startRe.exec(text);
  if (m) {
    const month = MONTHS[m[1].toLowerCase().replace('.', '')];
    const time = readTime(text, m.index + m[0].length);
    if (time) return { index: m.index, date: { year: parseInt(m[3], 10), month, day: parseInt(m[2], 10) }, time };
  }
  const anchor = Math.max(0, text.search(/\bwill be performing\b/i));
  const token = findDateTokens(text.slice(anchor)).find((t) => t.time);
  return token ? { index: anchor + token.start, date: token.date, time: token.time } : null;
}

export function findMaintenanceWindow(text) {
  const found = findMaintenanceStart(text);
  if (!found) return null;
  const { index, date, time } = found;
  const tz = time.tz || 'UTC';
  const start = toUtcMs(date, time, tz, false);
  let end = null;
  const concl = /concluding\s+(?:around|at)\s+/i.exec(text.slice(index));
  if (concl) {
    const endTime = readTime(text, index + concl.index + concl[0].length);
    if (endTime) {
      end = toUtcMs(date, endTime, endTime.tz || tz, false);
      if (end <= start) end += 86400000;
    }
  }
  if (end === null) {
    const hours = /last\s+approximately\s+(\d+(?:\.\d+)?)\s+hours?/i.exec(text);
    if (hours) end = start + parseFloat(hours[1]) * 3600000;
  }
  if (end === null) return null;
  return { start, end, startApprox: false, endApprox: false, afterMaintenance: false, raw: text.slice(index, index + 120).replace(/\s+/g, ' ').trim() };
}

export function findResetNotes(text) {
  const sentences = String(text).replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/);
  const notes = [];
  for (const s of sentences) {
    if (/\bresets?\s+(?:every|daily|weekly|each\s+(?:day|week))\b/i.test(s) && s.length < 260) {
      const clean = s.replace(/\s+/g, ' ').trim();
      if (!notes.includes(clean)) notes.push(clean);
    }
    if (notes.length >= 4) break;
  }
  return notes;
}

const SKIP_HEADINGS = /^(table of contents|back to top|contents|rewards?|notes?|faq|how to participate|details?|event details)$/i;

// Nexon's rankings answer: { totalCount, pageIndex, ranks: [{ characterName, level, exp, jobName, worldID,
// characterImgURL, rank, gap, legionLevel, raidPower, tierID, starSum }] }. Field names confirmed against a live
// response on 23 Nov 2026; they are still undocumented, so anything missing or oddly typed is treated as no result.
export function findRanked(data, name) {
  const ranks = data && Array.isArray(data.ranks) ? data.ranks : [];
  const want = String(name || '').trim().toLowerCase();
  if (!want) return null;
  const hit = ranks.find((r) => r && String(r.characterName || '').toLowerCase() === want);
  if (!hit) return null;
  const level = Number(hit.level);
  if (!Number.isFinite(level) || level < 1 || level > 300) return null;
  const exp = Number(hit.exp);
  return {
    name: String(hit.characterName),
    level,
    exp: Number.isFinite(exp) && exp >= 0 ? exp : 0,
    jobName: typeof hit.jobName === 'string' ? hit.jobName : null,
    worldID: Number.isFinite(Number(hit.worldID)) ? Number(hit.worldID) : null,
    imageUrl: typeof hit.characterImgURL === 'string' && hit.characterImgURL.startsWith('https://') ? hit.characterImgURL : null
  };
}

// Each Sunday's perks from a "Sunny Sunday" section: a "Date (UTC) | Perks" table where a row starts with a date
// line ("November 29, 2026") followed by one perk per line. Returns [{ date: 'YYYY-MM-DD', perks: [...] }].
const SUNNY_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function findSunnySchedule(body) {
  const source = String(body || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const headingRe = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let section = null;
  let match;
  while ((match = headingRe.exec(source))) {
    if (section !== null) { section = source.slice(section, match.index); break; }
    if (/^sunny sunday$/i.test(cleanText(match[2]).replace(/\s+/g, ' ').trim())) section = headingRe.lastIndex;
  }
  if (section === null) return [];
  if (typeof section === 'number') section = source.slice(section);
  // The schedule is a table; anything after it (closing notes, gift details) is not a perk of the last Sunday.
  const table = /<table\b[\s\S]*?<\/table>/i.exec(section);
  const block = { text: cleanText(table ? table[0] : section) };
  const out = [];
  let cur = null;
  for (const raw of block.text.split('\n')) {
    const line = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const m = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(line);
    const month = m ? SUNNY_MONTHS.indexOf(m[1].toLowerCase()) : -1;
    if (m && month >= 0) {
      const t = Date.UTC(Number(m[3]), month, Number(m[2]));
      // Only real Sundays count; anything else means the page layout changed.
      cur = new Date(t).getUTCDay() === 0 ? { date: new Date(t).toISOString().slice(0, 10), perks: [] } : null;
      if (cur) out.push(cur);
    } else if (cur && line.length <= 200 && cur.perks.length < 30) {
      cur.perks.push(line);
    }
  }
  return out.filter((d) => d.perks.length > 0);
}

// Which posts from the news list the job reads in full.
const DETAIL_CATEGORIES = new Set(['events', 'update', 'sale', 'general', 'maintenance']);
export function wantsDetail(post, now) {
  if (!DETAIL_CATEGORIES.has(post.category)) return false;
  if (post.isMSCW) return false; // Classic World posts are listed but not parsed
  const age = now - Date.parse(post.liveDate);
  // Announced maintenance is titled without a bracket ("Scheduled Maintenance - November 24, 2026") and gets a
  // "[Completed]" bracket afterwards; both are read. Other maintenance-category posts (notices) are skipped.
  // The title may start with any bracket ("[Update Nov 26]", "[Extended]") and need not say "Scheduled":
  // "Emergency Maintenance - June 20, 2026" and "<World> Channel Maintenance - ..." are maintenance too. Known-issues
  // notices have neither word.
  if (post.category === 'maintenance') {
    const name = String(post.name);
    const title = name.replace(/^\s*(?:\[[^\]]*\]\s*)+/, '');
    return age < 21 * 86400000 && (/\b(?:un)?scheduled\b|\bmaintenance\b/i.test(title) || /^\s*\[(?:scheduled|completed|updated|unscheduled)/i.test(name));
  }
  return age < 150 * 86400000;
}

export function slugify(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}

export function postUrl(post) {
  const category = post.category || 'general';
  return `https://www.nexon.com/maplestory/news/${category}/${post.id}`;
}

// Parse one post into event windows. `post` is a list item from the CMS feed; `body` is its HTML.
function firstWindow(text, post) {
  // A range whose end date had no year of its own is only used when the section has no fully dated range, so it
  // never displaces the window the section was read with before (Winter Countdown's own dates).
  const ranges = findDateRanges(text).filter((r) => r.end !== null);
  const standard = ranges.find((r) => !r.inferredYear) || ranges[0];
  if (standard) return standard;
  return findLabeledRanges(text, post.liveDate)[0] || null;
}

export function parsePost(post, body) {
  const blocks = htmlToBlocks(body);
  const allText = () => blocks.map((b) => (b.heading ? b.heading + '\n' : '') + b.text).join('\n');
  if (post.category === 'maintenance') {
    const window = findMaintenanceWindow(allText().replace(/\n+/g, ' '));
    return window ? [toEvent(post, post.name, window, [])] : [];
  }
  const events = [];
  const seen = new Set();
  const ids = new Set();
  for (const block of blocks) {
    if (!block.heading || SKIP_HEADINGS.test(block.heading)) continue;
    // Sunny Sunday is a list of single Sundays (findSunnySchedule), not one event; a claim deadline inside it
    // would otherwise become the window of the whole section.
    if (/^sunny sundays?$/i.test(block.heading.trim())) continue;
    const range = firstWindow(block.text, post);
    if (!range) continue;
    // A repeated heading with the same window is the same event. The whole heading is compared, not the slug:
    // long headings that only share their first 60 characters (the slug length) are different events.
    const same = `${block.heading.replace(/\s+/g, ' ').trim().toLowerCase()}|${range.start}|${range.end}`;
    if (seen.has(same)) continue;
    seen.add(same);
    // Every event of a post gets its own id: the heading's slug, then -2, -3, … until it is free (a later heading
    // "X 2" must not collide with the second "X").
    const base = `${post.id}-${slugify(block.heading)}`;
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    const ev = { ...toEvent(post, block.heading, range, findResetNotes(block.text)), id };
    if (isMesoOffer(post, block.text)) ev.mesos = true;
    events.push(ev);
  }
  if (events.length === 0) {
    const text = allText();
    const range = firstWindow(text, post);
    if (range) events.push(toEvent(post, post.name, range, findResetNotes(text)));
  }
  return events;
}

// A section of a sale post priced in mesos and not in NX (Black Friday's Heroic cube packs: "Price: 360,000,000
// mesos 270,000,000 mesos"): an in-game meso offer, which the site must not hide with the Cash Shop sales.
export function isMesoOffer(post, text) {
  if (!post || post.category !== 'sale') return false;
  const t = String(text || '');
  return /\d[\d,]*\s*mesos\b/i.test(t) && !/\bNX\b/.test(t) && !/\bMaple Points?\b/i.test(t);
}

function toEvent(post, title, range, resets) {
  return {
    id: `${post.id}-${slugify(title)}`,
    title: String(title).replace(/\s+/g, ' ').trim(),
    start: range.start === null ? null : new Date(range.start).toISOString(),
    end: new Date(range.end).toISOString(),
    startApprox: range.startApprox,
    endApprox: range.endApprox,
    afterMaintenance: range.afterMaintenance,
    raw: range.raw.slice(0, 200),
    resets,
    postId: post.id,
    postName: post.name,
    liveDate: post.liveDate || null,
    category: post.category,
    isClassic: Boolean(post.isMSCW),
    url: postUrl(post)
  };
}
