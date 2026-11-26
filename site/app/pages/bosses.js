import { html, useState, useEffect } from '../../vendor/htm-preact.mjs';
import { update, activeCharacter, charSlice } from '../store.js';
import { Card, PageHead, Tile, useNow, Seg, Empty } from '../ui.js';
import { computeIncome, crystalValue, clearKey, fmtMesos, worldKey, crystalWeekStart, shareKey, entryBlock, entryBlockText } from '../calc/income.js';
import { knownLevel } from './level.js';
import { dayKey } from '../time.js';
import { PitchedCard } from './pitched.js';
import { CombatPowerCard } from './bosscp.js';
import { reach, minCpFor, marginOf, fmtCp } from '../calc/bosscp.js';

// Saves this crystal week's totals (all characters, after caps) for the Mesos > Income history chart: what was
// earned, and as `planned` the week's target on the same basis (earned plus what was still open). Mounted
// once for the whole app (main.js), so a clear ticked on any page is saved.
export function IncomeKeeper({ data, state }) {
  const now = useNow(60000);
  const income = computeIncome(state.characters, state, data.bosses, data.bossById, now);
  return html`<${IncomeRecorder} income=${income} state=${state} now=${now} />`;
}

function IncomeRecorder({ income, state, now }) {
  const key = dayKey(crystalWeekStart(now));
  const earned = income.worlds.reduce((a, w) => a + (w.earnedTotal || 0), 0);
  const planned = income.worlds.reduce((a, w) => a + (w.targetTotal || 0), 0);
  useEffect(() => {
    const h = (state.incomeHistory || {})[key];
    if (h && h.earned === earned && h.planned === planned) return;
    update((s) => {
      s.incomeHistory = s.incomeHistory || {};
      s.incomeHistory[key] = { earned, planned };
      const keys = Object.keys(s.incomeHistory).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 52))) delete s.incomeHistory[k];
    });
  }, [key, earned, planned]);
  return null;
}

const GROUPS = [
  ['weekly', 'Weekly'],
  ['daily', 'Daily'],
  ['monthly', 'Monthly']
];

function blankBosses() {
  return { picks: {}, clears: {} };
}

// The period comes from the moment of the click, not from when the page last redrew (up to 30 s earlier), so a
// tick just after a reset lands in the new period. A monthly mark keeps the time, so its crystal counts in the
// week it was cleared.
// `line` is the boss's line from characterLines: its `shared` lists the other difficulties with the same clear.
// Ticking one difficulty moves the tick from any other; unticking a boss that is done on another difficulty
// takes that tick away.
// `want` is what the box was moved to (true = ticked). An untick never adds a mark: a box drawn ticked before a
// reset and clicked just after it leaves the new period empty. Without `want` the current period is toggled.
export function toggleClear(charId, boss, line, want) {
  update((s) => {
    const t = Date.now();
    const b = charSlice(s, 'bosses', charId, blankBosses);
    const key = clearKey(boss, t);
    const marks = (b.clears[boss.id] = b.clears[boss.id] || {});
    const others = ((line && line.shared) || []).filter((id) => b.clears[id] && b.clears[id][key]);
    const tick = typeof want === 'boolean' ? want : !(marks[key] || others.length);
    for (const id of others) delete b.clears[id][key];
    if (!tick) delete marks[key];
    else if (!marks[key]) marks[key] = boss.reset === 'monthly' ? t : true;
    // keep only recent marks
    const keys = Object.keys(marks).sort();
    while (keys.length > 12) delete marks[keys.shift()];
  });
}

function setPick(charId, bossId, pick) {
  update((s) => {
    const b = charSlice(s, 'bosses', charId, blankBosses);
    if (pick) b.picks[bossId] = { party: 1, ...(b.picks[bossId] || {}), ...pick };
    else delete b.picks[bossId];
  });
}

function ThisWeek({ char, income, data, who }) {
  const mine = income.perChar[char.id];
  if (!mine || (mine.lines.length === 0 && mine.unpicked.length === 0)) return html`<${Empty}>Pick the bosses you run in the list below, then tick them off here as you clear them.<//>`;
  const cap = data.bosses.limits.weeklyPerCharacter;
  let weeklyRank = 0;
  return html`<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Done</th><th>Boss</th><th class="num">Crystal</th><th class="num">This week</th></tr></thead>
    <tbody>
      ${mine.lines.map((l) => {
        const counts = l.kind === 'weekly' && l.value > 0 && !l.spare;
        if (counts) weeklyRank++;
        const over = counts && weeklyRank > cap;
        const id = `clear-${l.bossId}`;
        return html`<tr class=${over || l.doneAs ? 'off' : ''}>
          <td><input type="checkbox" id=${id} checked=${l.clearedNow || Boolean(l.doneAs)} onChange=${(e) => toggleClear(char.id, l.boss, l, e.currentTarget.checked)}
            aria-label=${`${l.boss.difficulty} ${l.boss.boss} cleared ${l.kind === 'daily' ? 'today' : l.kind === 'monthly' ? 'this month' : 'this week'}`} /></td>
          <td><label for=${id}>${l.boss.difficulty} ${l.boss.boss}</label>
            ${l.party > 1 ? html` <span class="small muted">party of ${l.party}</span>` : null}
            ${l.boss.noCrystal ? html` <span class="small muted">no crystal</span>` : null}
            ${entryBlock(l.boss, who) ? html` <span class="small muted">${entryBlockText(l.boss, entryBlock(l.boss, who))}: not open to ${char.name}</span>` : null}
            ${l.doneAs ? html` <span class="small muted">done on ${l.doneAs}: one clear for all difficulties</span>` : l.spare ? html` <span class="small muted">shares one clear with ${l.spare}: not counted as planned</span>` : null}
            ${over ? html` <span class="small muted">over the ${cap}-crystal cap</span>` : null}</td>
          <td class="num">${l.value ? fmtMesos(l.value) : '—'}</td>
          <td class="num">${l.doneAs && !l.cleared ? '—' : l.kind === 'daily' ? `${l.cleared} / 7 days` : l.cleared > 1 ? `Cleared ${l.cleared} times` : l.cleared ? 'Cleared' : l.clearedNow ? 'Earlier this month' : '—'}</td>
        </tr>`;
      })}
      ${mine.unpicked.map((u) => html`<tr class="off">
        <td></td>
        <td>${u.boss.difficulty} ${u.boss.boss} <span class="small muted">cleared this week, no longer picked. Still counted as earned, as a solo clear.</span></td>
        <td class="num">${fmtMesos(u.earned[0])}</td>
        <td class="num">${u.kind === 'daily' ? `${u.earned.length} / 7 days` : u.earned.length > 1 ? `Cleared ${u.earned.length} times` : 'Cleared'}</td>
      </tr>`)}
    </tbody>
  </table></div>`;
}

// A boss with an entry rule in bosses.json (`only`, `minLevel`) is not offered to a character that cannot enter:
// a Challenger World boss is left out for other characters, and one above the character's level is shown locked.
// A boss that is already picked always stays, so it can be unpicked.
function Picker({ char, data, picks, margin, who }) {
  const [view, setView] = useState('weekly');
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [onlyReach, setOnlyReach] = useState(false);
  const cp = char.cp || 0;
  const reachOf = (b) => reach(data.bossCp, b, cp, margin);
  const sharedPicks = (b) => data.bosses.bosses.filter((o) => o.id !== b.id && picks[o.id] && shareKey(o) === shareKey(b)).map((o) => o.difficulty);
  const bosses = data.bosses.bosses.filter((b) => b.reset === view && (!onlyPicked || picks[b.id]) && (!onlyReach || !cp || reachOf(b) !== 'no' || picks[b.id]) && (entryBlock(b, who) !== 'challenger' || picks[b.id]));
  return html`<div class="card-b">
    <div class="toolbar">
      <${Seg} label="Boss reset type" options=${GROUPS} value=${view} onChange=${setView} />
      <label class="small"><input type="checkbox" checked=${onlyPicked} onChange=${(e) => setOnlyPicked(e.currentTarget.checked)} /> Only bosses I run</label>
      ${cp ? html`<label class="small"><input id="only-reach" type="checkbox" checked=${onlyReach} onChange=${(e) => setOnlyReach(e.currentTarget.checked)} /> Hide bosses above my Combat Power</label>` : null}
    </div>
    ${view === 'weekly' && !data.bosses.bosses.some((b) => b.reset === 'daily' && picks[b.id]) ? html`<p class="note">Daily bosses are under Daily above. The ones you pick there become your "Daily bosses" on Today and Checklist.</p>` : null}
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Run</th><th>Boss</th><th>Party</th><th class="num">Your crystal</th></tr></thead>
      <tbody>
        ${bosses.map((b) => {
          const pick = picks[b.id];
          const id = `pick-${b.id}`;
          const block = entryBlock(b, who);
          return html`<tr class=${pick ? '' : 'off'}>
            <td><input type="checkbox" id=${id} checked=${Boolean(pick)} disabled=${Boolean(block) && !pick} onChange=${(e) => setPick(char.id, b.id, e.currentTarget.checked ? {} : null)} /></td>
            <td><label for=${id}>${b.difficulty} ${b.boss}</label>${b.note ? html`<div class="small muted">${b.note}</div>` : null}
              ${block ? html`<div class="small cp-no">${entryBlockText(b, block)}${block === 'level' ? `: ${char.name} is Lv. ${who.level}` : `: ${char.name} is not a Challenger World character`}.${pick ? ' Untick it if you picked it by mistake.' : ''}</div>` : null}
              ${pick && sharedPicks(b).length ? html`<div class="small muted">One clear ${b.reset === 'daily' ? 'a day' : b.reset === 'monthly' ? 'a month' : 'a week'} for all difficulties: you also picked ${sharedPicks(b).join(', ')}. Only the best one counts as planned.</div>` : null}
              ${minCpFor(data.bossCp, b) !== null ? html`<div class=${'small ' + (reachOf(b) === 'no' ? 'cp-no' : 'muted')}>${reachOf(b) === 'no' ? `Above your Combat Power: asks for ${fmtCp(minCpFor(data.bossCp, b) * margin)}` : `Entry from ${fmtCp(minCpFor(data.bossCp, b))} Combat Power`}</div>` : null}</td>
            <td>${pick ? html`<select class="select sm" aria-label=${'Party size for ' + b.boss} value=${pick.party || 1}
              onChange=${(e) => setPick(char.id, b.id, { party: Number(e.currentTarget.value) })}>
              ${[1, 2, 3, 4, 5, 6].map((n) => html`<option value=${n}>${n === 1 ? 'Solo' : n}</option>`)}
            </select>` : null}</td>
            <td class="num">${b.noCrystal ? '—' : fmtMesos(crystalValue(b, char, data.bosses, pick?.party || 1))}</td>
          </tr>`;
        })}
      </tbody>
    </table></div>
  </div>`;
}

export function BossesPage({ data, state }) {
  // Redrawn every 30 s, but each draw uses the current time, the same clock a tick uses.
  useNow(30000);
  const now = Date.now();
  const char = activeCharacter(state);
  if (!char) return html`<${PageHead} title="Bosses" /><${Card} title="Add a character first"><p class="note">Bosses, income and progress are tracked per character. <a href="#characters">Add your character</a> to start.</p><//>`;
  const income = computeIncome(state.characters, state, data.bosses, data.bossById, now);
  const mine = income.perChar[char.id];
  const world = income.worlds.find((w) => w.key === worldKey(char));
  const picks = state.bosses[char.id]?.picks || {};
  const cap = data.bosses.limits.weeklyPerCharacter;
  const who = { challenger: Boolean(char.challenger), level: knownLevel(data, state, char) };
  return html`
    <${PageHead} title="Bosses">${char.name}: tick clears as you go. The crystal week resets Thursday 09:00 KST; only your ${cap} best weekly crystals sell.<//>
    ${char.quanah ? html`<p class="warnbox">Quanah World Leap characters can't sell boss crystals, so income shows zero.</p>` : null}
    <div class="tiles">
      <${Tile} k="Earned this week" v=${fmtMesos(mine.earned)} s=${`of ${fmtMesos(mine.target)} planned`} accent />
      <${Tile} k="Weekly crystals" v=${`${Math.min(mine.weeklyCleared, cap)} / ${Math.min(mine.weeklyPicked + mine.weeklyUnpicked, cap)}`} s=${mine.overCap ? `${mine.overCap} picked boss${mine.overCap === 1 ? ' falls' : 'es fall'} outside the cap` : `cap ${cap} per character`} />
      <${Tile} k=${world ? world.label + ' world' : 'World'} v=${world ? fmtMesos(world.earnedTotal) : '—'} s=${world ? `${world.earnedCount} of ${data.bosses.limits.perWorldPerWeek} crystals sold` : ''} />
      <${Tile} k="Price basis" v=${char.world === 'interactive' ? 'Interactive' : 'Heroic ×5'} s="from the GMS v.272 crystal table" />
    </div>
    <div class="grid two">
      <${CombatPowerCard} data=${data} state=${state} char=${char} />
      <${Card} title="This week" meta="Ticks reset with each boss's own reset"><${ThisWeek} char=${char} income=${income} data=${data} who=${who} /><//>
      <section class="card">
        <div class="card-h"><h3>Bosses you run</h3><span class="meta">Values for ${char.world === 'interactive' ? 'Interactive' : 'Heroic'}</span></div>
        <${Picker} char=${char} data=${data} picks=${picks} margin=${marginOf(data.bossCp, state.ui.bossMargin)} who=${who} />
      </section>
      <${PitchedCard} data=${data} state=${state} char=${char} now=${now} />
    </div>
    <p class="note">${data.bosses.source} Limits: ${data.bosses.limits.note} ${data.bosses.sharedClear.note}</p>`;
}
