// What weekly boss clears pay besides crystals: Item Burning Plus crests (ibp.json `bossCrests`) and Shadow
// Bounties coins (bounty.json). Both count only solo clears, so both read the solo weekly picks on Bosses.
// Pure maths, no DOM.
import { shareKey } from './income.js';

const RANK = { easy: 1, normal: 2, hard: 3, chaos: 4, extreme: 5 };
const rankOf = (boss) => RANK[String(boss.difficulty || '').toLowerCase()] || 0;
const isSolo = (pick) => !(pick && Number(pick.party) > 1);

// The weekly bosses a character picked on Bosses, split into solo and party picks.
export function weeklyPicks(bossState, bossById) {
  const picks = (bossState && bossState.picks) || {};
  const solo = [];
  const party = [];
  for (const [id, pick] of Object.entries(picks)) {
    const boss = bossById && bossById[id];
    if (!boss || boss.reset !== 'weekly') continue;
    (isSolo(pick) ? solo : party).push(boss);
  }
  return { solo, party };
}

// Challenge Crests a week from the character's solo weekly picks. Difficulties of one boss share one clear, so
// each boss counts once, at the best-paying picked difficulty. A picked difficulty that Nexon's table does not
// list (Extreme Lotus, Hard Mayrin) is not counted and comes back in `unlisted`; party picks pay nothing and come
// back in `party` when that boss pays crests solo.
export function bossCrests(ibp, bossState, bossById) {
  const table = (ibp && ibp.bossCrests) || {};
  const { solo, party } = weeklyPicks(bossState, bossById);
  const groups = new Map();
  for (const boss of solo) {
    const k = shareKey(boss);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(boss);
  }
  const rows = [];
  const unlisted = [];
  for (const list of groups.values()) {
    const paying = list.filter((b) => table[b.id] > 0).sort((a, b) => table[b.id] - table[a.id] || rankOf(b) - rankOf(a) || (a.id < b.id ? -1 : 1));
    if (paying.length) rows.push({ boss: paying[0], crests: table[paying[0].id] });
    for (const b of list) if (!(table[b.id] > 0) && !paying.length && Object.keys(table).some((id) => bossById[id] && bossById[id].boss === b.boss)) unlisted.push(b);
  }
  rows.sort((a, b) => b.crests - a.crests || (a.boss.id < b.boss.id ? -1 : 1));
  const soloBosses = new Set(solo.map((b) => b.boss));
  const partyPaying = party.filter((b) => !soloBosses.has(b.boss) && Object.keys(table).some((id) => bossById[id] && bossById[id].boss === b.boss));
  return { rows, total: rows.reduce((a, r) => a + r.crests, 0), unlisted, party: partyPaying };
}

// Weeks of hunts and boss crests to reach `need` more crests. 0 when nothing is needed; Infinity when nothing
// comes in.
export function crestWeeks(need, perWeek) {
  if (!(need > 0)) return 0;
  if (!(perWeek > 0)) return Infinity;
  return Math.ceil(need / perWeek);
}

export const BOUNTY_COINS = ['basic', 'intermediate', 'advanced'];

// One coin of one boss row as [low, high]: Nexon writes some rows as a range ("1,500 ~ 2,000").
export function bountyRange(row, coin) {
  const v = row && row[coin];
  if (Array.isArray(v)) {
    const lo = Number(v[0]);
    const hi = Number(v[v.length - 1]);
    return Number.isFinite(lo) && lo > 0 ? [lo, Number.isFinite(hi) && hi >= lo ? hi : lo] : [0, 0];
  }
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? [n, n] : [0, 0];
}

// Bounty Coins a week from the solo weekly picks of the given characters (pass the characters of one world: the
// caps are per world). Only the best boss of the week pays, so each coin is the highest figure among the picks
// (the low end of a range), never a sum, then capped. `best[coin]` is the boss that sets it.
export function bountyWeek(bounty, bossStates, bossById) {
  const out = { basic: 0, intermediate: 0, advanced: 0, best: {}, ranged: {} };
  if (!bounty || !bounty.bosses) return out;
  const caps = bounty.caps || {};
  for (const st of bossStates || []) {
    for (const boss of weeklyPicks(st, bossById).solo) {
      const row = bounty.bosses[boss.id];
      if (!row) continue;
      for (const coin of BOUNTY_COINS) {
        const [lo, hi] = bountyRange(row, coin);
        const cur = out.best[coin];
        if (lo > out[coin] || (lo > 0 && lo === out[coin] && cur && boss.id < cur.id)) {
          out[coin] = lo;
          out.best[coin] = boss;
          out.ranged[coin] = hi > lo;
        }
      }
    }
  }
  for (const coin of BOUNTY_COINS) if (caps[coin] > 0) out[coin] = Math.min(out[coin], caps[coin]);
  return out;
}

// Every boss that pays the coin, best first: [{ boss, lo, hi }]. For the "what each boss pays" list.
export function bountyTable(bounty, coin, bossById) {
  if (!bounty || !bounty.bosses) return [];
  return Object.entries(bounty.bosses)
    .map(([id, row]) => {
      const [lo, hi] = bountyRange(row, coin);
      return { boss: bossById && bossById[id], lo, hi };
    })
    .filter((r) => r.boss && r.lo > 0)
    .sort((a, b) => a.lo - b.lo || (a.boss.price || 0) - (b.boss.price || 0) || rankOf(a.boss) - rankOf(b.boss) || (a.boss.id < b.boss.id ? -1 : 1));
}

// The Bounty coin a shop is paid in, from its hand field `bounty.coin` ("basic", "intermediate", "advanced").
export function bountyCoinOf(shop) {
  const c = shop && shop.bounty && shop.bounty.coin;
  return BOUNTY_COINS.includes(c) ? c : null;
}

// The next Challenger World level mission above `level` ([[level, coins], ...]): paid once, when it is reached.
export function nextLevelCoins(levels, level) {
  if (!Array.isArray(levels) || !Number.isFinite(level)) return null;
  const rows = levels.filter((r) => Array.isArray(r) && r[0] > level && r[1] > 0).sort((a, b) => a[0] - b[0]);
  return rows.length ? { level: rows[0][0], coins: rows[0][1] } : null;
}
