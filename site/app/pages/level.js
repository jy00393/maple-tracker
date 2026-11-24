import { html } from '../../vendor/htm-preact.mjs';
import { update, charSlice } from '../store.js';
import { Card, NumberInput, Empty, fmtBig } from '../ui.js';
import { expToNext, expToReach, expRate, erdaCost } from '../calc/upgrades.js';
import { erdaNextSteps } from '../calc/progress.js';
import { DAY, fmtDate, fmtKst } from '../time.js';

// Readings: your own log, plus the Nexon rankings history if this character is listed in config/characters.json.
export function levelReadings(data, state, char) {
  const exp = data.upgrades.exp;
  const manual = ((state.level[char.id] || {}).log || []).map((r) => ({ t: r.t, level: r.level, frac: (r.pct || 0) / 100, source: 'you' }));
  const nx = (data.nexonCharacters.characters || []).find((c) => String(c.name).toLowerCase() === String(char.name || '').toLowerCase());
  const auto = ((nx && nx.history) || []).map((h) => {
    const need = expToNext(exp, h.level);
    return need ? { t: h.t, level: h.level, frac: Math.min(1, (h.exp || 0) / need), source: 'Nexon' } : null;
  }).filter(Boolean);
  return [...auto, ...manual].sort((a, b) => a.t - b.t);
}

// The highest level the tracker knows for a character: the one typed on Characters, your own log, or Nexon's
// rankings history. Used for level locks, so a stale stored level never hides something you can already do.
export function knownLevel(data, state, char) {
  if (!char) return undefined;
  const levels = [Number(char.level), ...levelReadings(data, state, char).map((r) => Number(r.level))].filter(Number.isFinite);
  return levels.length ? Math.max(...levels) : undefined;
}

export function levelOutlook(data, state, char, now) {
  const exp = data.upgrades.exp;
  const readings = levelReadings(data, state, char);
  const last = readings[readings.length - 1] || (char.level ? { t: now, level: char.level, frac: 0 } : null);
  const beyond = Boolean(char.beyondBurning);
  const rate = expRate(exp, readings, beyond, 14, now);
  const gates = last ? exp.gates.filter(([lvl]) => lvl > last.level).map(([lvl, what]) => {
    const need = expToReach(exp, last.level, last.frac, lvl, beyond);
    const d = rate ? need / rate.perDay : null;
    return { level: lvl, what, need, days: d, at: d != null ? last.t + d * DAY : null };
  }) : [];
  return { readings, last, rate, gates, beyond };
}

function setChar(char, patch) {
  update((s) => {
    const c = s.characters.find((x) => x.id === char.id);
    if (c) Object.assign(c, patch);
  });
}

export function LevelView({ data, state, char, now }) {
  const o = levelOutlook(data, state, char, now);
  const exp = data.upgrades.exp;
  const log = (state.level[char.id] || {}).log || [];
  const last = o.last;
  const toNext = last ? expToNext(exp, last.level) : null;
  return html`<div class="grid two">
    <${Card} title="Level and EXP" meta=${o.rate ? `rate from the last ${o.rate.spanDays.toFixed(1)} days` : 'log twice to get a rate'}>
      ${last ? html`<div class="insight">
        <span class="k">Now</span>
        <span class="big">Lv. ${last.level} · ${(last.frac * 100).toFixed(2)}%</span>
        <span class="small muted">${toNext ? `${fmtBig(toNext * (1 - last.frac))} EXP to Lv. ${last.level + 1}` : 'past the EXP table'} · logged ${fmtKst(last.t)}</span>
        ${o.rate ? html`<span class="small">About <b>${fmtBig(o.rate.perDay)} EXP a day</b>${toNext ? `, so a level every ${(toNext / o.rate.perDay).toFixed(1)} days at this point` : ''}.</span>` : null}
      </div>` : html`<${Empty}>Log your level below to start.<//>`}
      <form class="form-grid" onSubmit=${(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const level = Number(f.get('level'));
        const pct = Number(f.get('pct'));
        if (!(level >= 200 && level <= 300) || !(pct >= 0 && pct < 100)) return;
        update((s) => {
          const l = charSlice(s, 'level', char.id, () => ({ log: [] }));
          l.log = [...(l.log || []), { t: Date.now(), level, pct }].slice(-200);
          const c = s.characters.find((x) => x.id === char.id);
          if (c) c.level = level;
        });
        e.currentTarget.reset();
      }}>
        <label class="field"><span>Level</span><input class="input" name="level" type="number" min="200" max="300" placeholder=${String(last ? last.level : char.level || 264)} required /></label>
        <label class="field"><span>EXP %</span><input class="input" name="pct" type="number" min="0" max="99.999" step="0.001" placeholder="e.g. 45.231" required /></label>
        <button class="btn primary" type="submit">Log it</button>
      </form>
      <label class="toggle"><input type="checkbox" checked=${Boolean(char.beyondBurning)} onChange=${(e) => setChar(char, { beyondBurning: e.currentTarget.checked })} /> Beyond Burning (an extra level each level-up until 280)</label>
      ${log.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Logged</th><th class="num">Level</th><th class="num">EXP %</th><th></th></tr></thead>
        <tbody>${log.slice(-6).reverse().map((r) => html`<tr><td>${fmtKst(r.t)}</td><td class="num">${r.level}</td><td class="num">${Number(r.pct).toFixed(3)}%</td>
          <td class="num"><button type="button" class="iconbtn" aria-label="Delete this reading" onClick=${() => update((s) => { const l = s.level[char.id]; l.log = l.log.filter((x) => x.t !== r.t); })}>×</button></td></tr>`)}</tbody></table></div>` : null}
      <p class="note">Log your level and EXP % (shown under the EXP bar) once a day or so. If the character is listed in config/characters.json, the GitHub job also records it from Nexon's rankings every 6 hours. ${exp.beyondBurningNote}</p>
    <//>
    <${Card} title="Level gates" meta=${o.beyond ? 'with Beyond Burning' : 'without Beyond Burning'}>
      ${o.gates.length ? o.gates.map((g) => html`<div class="goal">
        <div><b>Lv. ${g.level}</b><div class="small muted">${g.what}</div></div>
        <span class="small muted">${fmtBig(g.need)} EXP</span>
        <span class=${'date' + (g.days != null && g.days < 7 ? ' now' : '')}>${g.at ? fmtDate(g.at) : '—'}</span>
        <span class="small muted">${g.days != null ? `${Math.ceil(g.days)} days` : ''}</span>
      </div>`) : html`<${Empty}>No gates ahead.<//>`}
      ${!o.rate ? html`<p class="note">Dates show once you've logged your level on two different days.</p>` : null}
      <p class="note">${exp.source}</p>
    <//>
  </div>`;
}

// Sol Erda and Fragments: what the next upgrades cost and when you can afford them.
export function ErdaCosts({ data, char, entry, template }) {
  const up = data.upgrades.erda;
  const weekly = { ...up.weeklyDefault, ...(entry.weekly || {}) };
  const costs = entry.costs || {};
  const set = (fn) => update((s) => {
    const e = charSlice(s, 'erda', char.id, () => ({ template: 'erel', levels: {}, steps: {} }));
    fn(e);
  });
  const steps = erdaNextSteps(template, entry, 6).filter((st) => st.node);
  let sol = 0;
  let frag = 0;
  const rows = steps.map((st) => {
    const known = st.node === 'origin' ? erdaCost(up.originPerLevel, Math.max(1, st.from), st.to) : costs[st.id];
    if (known && (known.sol || known.frag)) {
      sol += known.sol || 0;
      frag += known.frag || 0;
    }
    const shortSol = Math.max(0, sol - (entry.solErda || 0));
    const shortFrag = Math.max(0, frag - (entry.fragments || 0));
    const weeks = Math.max(weekly.sol > 0 ? shortSol / weekly.sol : shortSol ? Infinity : 0, weekly.frag > 0 ? shortFrag / weekly.frag : shortFrag ? Infinity : 0);
    return { st, known, origin: st.node === 'origin', weeks, ready: known && shortSol === 0 && shortFrag === 0 };
  });
  return html`<${Card} title="Sol Erda planner" meta=${`${entry.solErda || 0} Sol Erda · ${entry.fragments || 0} Fragments held`}>
    <div class="form-grid">
      <label class="field"><span>Sol Erda a week</span><${NumberInput} className="input" label="Sol Erda per week" value=${weekly.sol} max=${999} onChange=${(v) => set((e) => { e.weekly = { ...weekly, sol: v || 0 }; })} /></label>
      <label class="field"><span>Fragments a week</span><${NumberInput} className="input" label="Fragments per week" value=${weekly.frag} max=${99999} onChange=${(v) => set((e) => { e.weekly = { ...weekly, frag: v || 0 }; })} /></label>
    </div>
    ${rows.length ? rows.map((r) => html`<div class="goal">
      <div><b>${r.st.label}</b><div class="small muted">${r.origin ? `${r.known.sol} Sol Erda + ${r.known.frag} Fragments (HEXA Origin table)` : r.known ? `${r.known.sol || 0} Sol Erda + ${r.known.frag || 0} Fragments (your entry)` : 'Enter the cost shown in game:'}</div>
        ${!r.origin ? html`<div class="toolbar" style=${{ marginTop: '4px' }}>
          <${NumberInput} label=${r.st.label + ' Sol Erda cost'} value=${r.known?.sol ?? ''} max=${999} onChange=${(v) => set((e) => { e.costs = { ...(e.costs || {}), [r.st.id]: { ...(e.costs || {})[r.st.id], sol: v || 0 } }; })} /><span class="small muted">Sol Erda</span>
          <${NumberInput} label=${r.st.label + ' Fragment cost'} value=${r.known?.frag ?? ''} max=${99999} onChange=${(v) => set((e) => { e.costs = { ...(e.costs || {}), [r.st.id]: { ...(e.costs || {})[r.st.id], frag: v || 0 } }; })} /><span class="small muted">Fragments</span>
        </div>` : null}</div>
      <span class=${'date' + (r.ready ? ' now' : '')}>${!r.known ? '—' : r.ready ? 'Ready now' : Number.isFinite(r.weeks) ? `${Math.ceil(r.weeks * 7)} days` : 'add income'}</span>
    </div>`) : html`<${Empty}>Every step in the order is done.<//>`}
    <p class="note">${up.source} Dates count every step above in order.</p>
  <//>`;
}
