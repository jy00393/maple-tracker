// Reads event coin shops out of a Nexon patch-notes post: a heading with "Shop" in it, a date range under it,
// and one or more tables of Item | Price (currency) | Qty. Limit. Shops priced in mesos, NX or Maple Points
// are left out: the planner is for event coins.
import { cleanText, findDateRanges, slugify, postUrl } from './nexon-parse.mjs';

const NOT_COINS = /^(mesos?|nx|maple points?|reward points?)$/i;
const clean = (html) => cleanText(html).replace(/\s+/g, ' ').trim();
const cells = (rowHtml) => [...rowHtml.matchAll(/<t([hd])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((m) => ({ head: m[1].toLowerCase() === 'h', html: m[2] }));

// "5", "3,000", "5 daily", "5 weekly", "40 per World", "5 per Account", "-" -> { limit, per?, limitNote? }
export function parseLimit(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const m = /^([\d,]+)\s*(.*)$/.exec(t);
  if (!m) return { limit: null };
  const limit = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(limit) || limit <= 0) return { limit: null };
  const rest = m[2].toLowerCase();
  if (/dai?ly|per day|a day/.test(rest)) return { limit, per: 'day' };
  if (/weekly|per week|a week/.test(rest)) return { limit, per: 'week' };
  if (/per world/.test(rest)) return { limit, limitNote: `${limit} per world` };
  if (/per character/.test(rest)) return { limit, limitNote: `${limit} per character` };
  return { limit };
}

// One item cell -> { name, only?, notChallenger?, note? }. The name is the bold text before the first colon,
// without leading tags such as "(Interactive Worlds Only)".
export function parseItemCell(html) {
  const text = cleanText(html);
  const flat = text.replace(/\s+/g, ' ').trim();
  const first = text.split('\n')[0].replace(/\s+/g, ' ').trim();
  let name = first;
  const out = {};
  // Leading tags, in any order.
  for (let guard = 0; guard < 4; guard++) {
    const tag = /^\(([^)]*)\)\s*/.exec(name);
    if (!tag) break;
    const label = tag[1].toLowerCase();
    if (/interactive/.test(label)) out.only = 'interactive';
    else if (/heroic/.test(label)) out.only = 'heroic';
    else if (/not available in challenger/.test(label)) out.notChallenger = true;
    else break; // an ordinary bracket that belongs to the name
    name = name.slice(tag[0].length);
  }
  // A name with a colon of its own ("Heart Upgrade Module: Plasma") is kept whole when Nexon's bold text marks where
  // it ends: the bold text ends with the colon, or the colon comes straight after the bold. Otherwise (no bold, or
  // a bold that runs on into the description, "Karma Bright Cube: Tradable within world,") the name is cut at the
  // first colon, as before.
  const TAG = /^\(\s*(?:[^)]*worlds?[^)]*|not available in challenger[^)]*)\)\s*/i;
  const source = String(html);
  let fromBold = null;
  for (const m of source.matchAll(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    let s = clean(m[2]);
    while (TAG.test(s)) s = s.replace(TAG, '');
    if (!s.trim()) continue;
    const after = cleanText(source.slice(m.index + m[0].length, m.index + m[0].length + 40));
    if (/:\s*$/.test(s)) fromBold = s.replace(/\s*:\s*$/, '').trim();
    else if (/^\s*:/.test(after)) fromBold = s.trim();
    break; // only the first bold with text can be the name
  }
  // A colon inside the bold must be part of the name, not the start of the description.
  const tail = fromBold && fromBold.includes(':') ? fromBold.slice(fromBold.indexOf(':') + 1).trim() : '';
  if (fromBold && !/^(un)?tradable|^permanent|^expires|^use\b|^can\b|,/i.test(tail)) name = fromBold;
  else {
    const colon = name.indexOf(':');
    if (colon > 0) name = name.slice(0, colon);
  }
  name = name.replace(/\s+/g, ' ').trim();
  if (/not available in challenger world/i.test(flat)) out.notChallenger = true;
  const note = /Note:\s*([^\n]+)/i.exec(text);
  if (note && !/not available in challenger world/i.test(note[1])) out.note = note[1].replace(/\s+/g, ' ').trim().slice(0, 160);
  return { name, ...out };
}

function parseTable(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => cells(m[1]));
  const header = rows.find((r) => r.length >= 2 && r.every((c) => c.head));
  if (!header) return null;
  const heads = header.map((c) => clean(c.html));
  const priceCol = heads.findIndex((h) => /price|cost/i.test(h));
  if (priceCol < 0) return null;
  const limitCol = heads.findIndex((h) => /limit|qty|quantity/i.test(h));
  // The item column is headed "Item (Growth Tab)" or just the tab's name ("Normal", "Special").
  let itemCol = heads.findIndex((h) => /^item/i.test(h));
  if (itemCol < 0) itemCol = heads.findIndex((h, i) => i !== priceCol && i !== limitCol);
  if (itemCol < 0) return null;
  // "Price (Alliance Credit)" -> Alliance Credit; "Meso Price" -> Meso; a bare "Price" -> '' (named in the text above).
  const inBrackets = /\(([^)]+)\)/.exec(heads[priceCol]);
  const currency = inBrackets ? inBrackets[1].trim() : heads[priceCol].replace(/price|cost/gi, '').trim();
  const tab = /\(([^)]+)\)/.exec(heads[itemCol]) || (/^item/i.test(heads[itemCol]) ? null : [null, heads[itemCol]]);
  const items = [];
  for (const r of rows) {
    if (r === header || r.length <= Math.max(priceCol, itemCol) || r.some((c) => c.head)) continue;
    const cost = Number(clean(r[priceCol].html).replace(/,/g, ''));
    if (!Number.isFinite(cost) || cost <= 0) continue;
    const item = parseItemCell(r[itemCol].html);
    if (!item.name) continue;
    items.push({ id: slugify(item.name), ...item, cost, ...parseLimit(limitCol >= 0 && r[limitCol] ? clean(r[limitCol].html) : '') });
  }
  return { currency, tab: tab ? tab[1].replace(/\s*tab$/i, '').trim() : null, items };
}

// Every coin shop in a post body. `post` is the feed entry ({ id, name, category, liveDate }).
export function findShops(body, post) {
  const source = String(body || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(style|script|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const heads = [...source.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ at: m.index, end: m.index + m[0].length, level: Number(m[1]), title: clean(m[2]) }));
  const shops = [];
  heads.forEach((h, i) => {
    if (!/\bshop\b/i.test(h.title) || /cash shop/i.test(h.title)) return;
    const next = heads.slice(i + 1).find((x) => x.level <= h.level);
    const section = source.slice(h.end, next ? next.at : source.length);
    const firstTable = section.search(/<table\b/i);
    if (firstTable < 0) return;
    const tables = [...section.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((m) => parseTable(m[0])).filter((t) => t && t.items.length);
    if (!tables.length) return;
    const intro = cleanText(section.slice(0, firstTable)).replace(/\n+/g, ' ');
    const range = findDateRanges(intro).find((r) => r.end !== null);
    if (!range) return;
    // A price column headed just "Price": the coin is named in the text, as in "Spend Challenger Coins earned from…".
    const named = /\bSpend\s+((?:[A-Z][\w']*\s+){0,3}(?:Coins?|Credits?|Tokens?|Points?))\b/.exec(intro);
    const bare = tables.filter((t) => !t.currency);
    for (const t of bare) { t.bare = true; if (named) t.currency = named[1].trim(); }
    // Tables are grouped into shops:
    // - by coin, when the price columns name different coins (one shop per coin);
    // - by tab, when several tabs all say just "Price": the post does not say they share a coin, and the
    //   same item can appear in two of them at different prices, so each tab is planned on its own.
    const splitTabs = bare.length > 1;
    const groups = new Map();
    for (const t of tables) {
      if (!t.currency || NOT_COINS.test(t.currency)) continue;
      const key = t.bare && splitTabs ? `tab:${t.tab || groups.size}` : `coin:${t.currency}`;
      if (!groups.has(key)) groups.set(key, { currency: t.currency, tab: t.bare && splitTabs ? t.tab : null, tables: [] });
      groups.get(key).tables.push(t);
    }
    let n = 0;
    for (const g of groups.values()) {
      // The same item can sit in two tables of one group; the first one is kept.
      const seen = new Set();
      const items = [];
      for (const t of g.tables) {
        for (const it of t.items) {
          if (seen.has(it.id)) continue;
          seen.add(it.id);
          items.push(it);
        }
      }
      const name = g.tab ? `${h.title}: ${g.tab}` : groups.size > 1 ? `${h.title}: ${g.currency}` : h.title;
      const shop = {
        id: slugify(name), name, currency: g.currency,
        start: range.start === null ? null : new Date(range.start).toISOString(),
        end: new Date(range.end).toISOString(),
        items, postId: post.id, postName: post.name, liveDate: post.liveDate || null, url: postUrl(post)
      };
      if (g.tab && n > 0) shop.note = `Nexon's post names one coin for this shop (${g.currency}) and does not say whether the ${g.tab} tab uses a different one. Check the tab in game before planning.`;
      shops.push(shop);
      n++;
    }
  });
  return shops;
}

// Builds data/shops.json from what the job parsed, keeping what a person added to the existing file.
// - A shop is matched to an existing one by name, and keeps that one's id (saved picks are keyed by it) and
//   any field the parser does not produce (earn, scope, useBy, event).
// - Items are matched by name the same way and keep a hand-written note when the post has none.
// - When two posts describe the same shop, the newer post wins. Shops that closed more than 21 days ago go.
// - An existing shop the job did not find (typed by hand, or its post left the window) stays until it closes.
export function mergeShops(existing, parsed, now) {
  const DAY = 86400000;
  const keep = (s) => Date.parse(s.end) > now - 21 * DAY;
  const old = (existing && Array.isArray(existing.shops) ? existing.shops : []).filter((s) => s && s.name && keep(s));
  const byName = new Map();
  for (const s of (parsed || []).slice().sort((a, b) => Date.parse(a.liveDate || 0) - Date.parse(b.liveDate || 0))) if (keep(s)) byName.set(s.name.toLowerCase(), s);
  const out = [];
  const used = new Set();
  for (const prev of old) {
    const fresh = byName.get(prev.name.toLowerCase());
    if (!fresh) { out.push(prev); continue; }
    used.add(prev.name.toLowerCase());
    const prevItems = new Map((prev.items || []).map((it) => [String(it.name).toLowerCase(), it]));
    // When the parser learns to read a name more fully ("Heart Upgrade Module" became "Heart Upgrade Module:
    // Plasma"), the item is still the same one: matched by the part before the colon at the same price, so its id,
    // and the picks saved under it, carry over.
    const short = (s) => String(s).split(':')[0].trim().toLowerCase();
    const findWas = (it) => prevItems.get(it.name.toLowerCase())
      || (prev.items || []).find((p) => short(p.name) === short(it.name) && p.cost === it.cost && !fresh.items.some((f) => f.name.toLowerCase() === String(p.name).toLowerCase()));
    const items = fresh.items.map((it) => {
      const was = findWas(it);
      if (!was) return it;
      return { ...it, id: was.id, ...(it.note || !was.note ? {} : { note: was.note }) };
    });
    out.push({ ...prev, ...fresh, id: prev.id, items });
  }
  for (const [key, fresh] of byName) if (!used.has(key)) out.push(fresh);
  out.sort((a, b) => Date.parse(a.end) - Date.parse(b.end) || (a.name < b.name ? -1 : 1));
  const posts = [...new Set(out.map((s) => s.postId).filter(Boolean))];
  return {
    source: `Nexon patch notes${posts.length ? ` (news ${posts.length === 1 ? 'id' : 'ids'} ${posts.join(', ')})` : ''}, read by the 6-hourly job. How coins are earned ("earn"), "scope" and "useBy" are typed in by hand where present.`,
    sourceUrl: (out.find((s) => s.url) || {}).url || (existing && existing.sourceUrl) || '',
    shops: out
  };
}
