import { html, useState, useEffect } from '../../vendor/htm-preact.mjs';
import { update, activeCharacter, charSlice } from '../store.js';
import { Card, PageHead, Tile, useNow, Seg, Empty } from '../ui.js';
import { computeIncome, crystalValue, clearKey, fmtMesos, worldKey, crystalWeekStart } from '../calc/income.js';
import { dayKey } from '../time.js';

// Saves this crystal week's totals (all characters, after caps) for the Mesos > Income history chart.
function IncomeRecorder({ income, state, now }) {
  const key = dayKey(crystalWeekStart(now));
  const earned = income.worlds.reduce((a, w) => a + (w.earnedTotal || 0), 0);
  const planned = income.worlds.reduce((a, w) => a + (w.plannedTotal || 0), 0);
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

function toggleClear(charId, boss, now) {
  update((s) => {
    const b = charSlice(s, 'bosses', charId, blankBosses);
    const key = clearKey(boss, now);
    const marks = (b.clears[boss.id] = b.clears[boss.id] || {});
    if (marks[key]) delete marks[key];
    else marks[key] = true;
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

function ThisWeek({ char, income, data, now }) {
  const mine = income.perChar[char.id];
  if (!mine || mine.lines.length === 0) return html`<${Empty}>Pick the bosses you run in the list below, then tick them off here as you clear them.<//>`;
  const cap = data.bosses.limits.weeklyPerCharacter;
  let weeklyRank = 0;
  return html`<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Done</th><th>Boss</th><th class="num">Crystal</th><th class="num">This week</th></tr></thead>
    <tbody>
      ${mine.lines.map((l) => {
        if (l.kind === 'weekly' && l.value > 0) weeklyRank++;
        const over = l.kind === 'weekly' && l.value > 0 && weeklyRank > cap;
        const id = `clear-${l.bossId}`;
        return html`<tr class=${over ? 'off' : ''}>
          <td><input type="checkbox" id=${id} checked=${l.clearedNow} onChange=${() => toggleClear(char.id, l.boss, now)}
            aria-label=${`${l.boss.difficulty} ${l.boss.boss} cleared ${l.kind === 'daily' ? 'today' : l.kind === 'monthly' ? 'this month' : 'this week'}`} /></td>
          <td><label for=${id}>${l.boss.difficulty} ${l.boss.boss}</label>
            ${l.party > 1 ? html` <span class="small muted">party of ${l.party}</span>` : null}
            ${l.boss.noCrystal ? html` <span class="small muted">no crystal</span>` : null}
            ${over ? html` <span class="small muted">over the ${cap}-crystal cap</span>` : null}</td>
          <td class="num">${l.value ? fmtMesos(l.value) : '—'}</td>
          <td class="num">${l.kind === 'daily' ? `${l.cleared} / 7 days` : l.cleared ? 'Cleared' : '—'}</td>
        </tr>`;
      })}
    </tbody>
  </table></div>`;
}

function Picker({ char, data, picks }) {
  const [view, setView] = useState('weekly');
  const [onlyPicked, setOnlyPicked] = useState(false);
  const bosses = data.bosses.bosses.filter((b) => b.reset === view && (!onlyPicked || picks[b.id]));
  return html`<div class="card-b">
    <div class="toolbar">
      <${Seg} label="Boss reset type" options=${GROUPS} value=${view} onChange=${setView} />
      <label class="small"><input type="checkbox" checked=${onlyPicked} onChange=${(e) => setOnlyPicked(e.currentTarget.checked)} /> Only bosses I run</label>
    </div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Run</th><th>Boss</th><th>Party</th><th class="num">Your crystal</th></tr></thead>
      <tbody>
        ${bosses.map((b) => {
          const pick = picks[b.id];
          const id = `pick-${b.id}`;
          return html`<tr class=${pick ? '' : 'off'}>
            <td><input type="checkbox" id=${id} checked=${Boolean(pick)} onChange=${(e) => setPick(char.id, b.id, e.currentTarget.checked ? {} : null)} /></td>
            <td><label for=${id}>${b.difficulty} ${b.boss}</label>${b.note ? html`<div class="small muted">${b.note}</div>` : null}</td>
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
  const now = useNow(30000);
  const char = activeCharacter(state);
  if (!char) return html`<${PageHead} title="Bosses" /><${Card} title="Add a character first"><p class="note">Bosses, income and progress are tracked per character. <a href="#characters">Add your character</a> to start.</p><//>`;
  const income = computeIncome(state.characters, state, data.bosses, data.bossById, now);
  const mine = income.perChar[char.id];
  const world = income.worlds.find((w) => w.key === worldKey(char));
  const picks = state.bosses[char.id]?.picks || {};
  const cap = data.bosses.limits.weeklyPerCharacter;
  return html`
    <${PageHead} title="Bosses">${char.name}: tick clears as you go. The crystal week resets Thursday 09:00 KST; only your ${cap} best weekly crystals sell.<//>
    <${IncomeRecorder} income=${income} state=${state} now=${now} />
    ${char.quanah ? html`<p class="warnbox">Quanah World Leap characters can't sell boss crystals, so income shows zero.</p>` : null}
    <div class="tiles">
      <${Tile} k="Earned this week" v=${fmtMesos(mine.earned)} s=${`of ${fmtMesos(mine.planned)} planned`} accent />
      <${Tile} k="Weekly crystals" v=${`${Math.min(mine.weeklyCleared, cap)} / ${Math.min(mine.weeklyPicked, cap)}`} s=${mine.overCap ? `${mine.overCap} picked bosses fall outside the cap` : `cap ${cap} per character`} />
      <${Tile} k=${world ? world.label + ' world' : 'World'} v=${world ? fmtMesos(world.earnedTotal) : '—'} s=${world ? `${world.earnedCount} of ${data.bosses.limits.perWorldPerWeek} crystals sold` : ''} />
      <${Tile} k="Price basis" v=${char.world === 'interactive' ? 'Interactive' : 'Heroic ×5'} s="from the GMS v.272 crystal table" />
    </div>
    <div class="grid two">
      <${Card} title="This week" meta="Ticks reset with each boss's own reset"><${ThisWeek} char=${char} income=${income} data=${data} now=${now} /><//>
      <section class="card">
        <div class="card-h"><h3>Bosses you run</h3><span class="meta">Values for ${char.world === 'interactive' ? 'Interactive' : 'Heroic'}</span></div>
        <${Picker} char=${char} data=${data} picks=${picks} />
      </section>
    </div>
    <p class="note">${data.bosses.source} Limits: ${data.bosses.limits.note}</p>`;
}
