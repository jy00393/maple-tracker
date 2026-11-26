import { html, useState } from '../../vendor/htm-preact.mjs';
import { update, charSlice } from '../store.js';
import { Card, NumberInput, Empty, fmtBig, plural } from '../ui.js';
import { expToNext, expToReach, expRate, erdaCost } from '../calc/upgrades.js';
import { erdaNextSteps, erdaTemplateFor } from '../calc/progress.js';
import { DAY, fmtDate, fmtKst } from '../time.js';
import { ExpSourcesCard } from './expsources.js';

// Your own readings that still stand, oldest first. Levels never go down, so a reading with a higher level than
// one logged after it was a slip of the keyboard: the later reading wins and the earlier one is ignored.
export function standingLog(log) {
  const rows = (Array.isArray(log) ? log : []).filter((r) => r && Number.isFinite(r.t) && Number.isFinite(r.level)).slice().sort((a, b) => a.t - b.t);
  const out = [];
  let lowest = Infinity;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].level > lowest) continue;
    lowest = rows[i].level;
    out.unshift(rows[i]);
  }
  return out;
}

// Readings: your own log, plus the Nexon rankings history if this character is listed in config/characters.json.
export function levelReadings(data, state, char) {
  const exp = data.upgrades.exp;
  const manual = standingLog((state.level[char.id] || {}).log).map((r) => ({ t: r.t, level: r.level, frac: (r.pct || 0) / 100, source: 'you' }));
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
  const levels = [Number(char.level), ...levelReadings(data, state, char).map((r) => Number(r.level))].filter((n) => Number.isFinite(n) && n > 0);
  return levels.length ? Math.max(...levels) : undefined;
}

// When Beyond Burning ends: the event's own end from Nexon's posts (the run that is on now, else the latest one
// that has started), else the end of the season. A run that is only announced gives nothing free yet: -Infinity.
export function beyondBurningEnd(data, now = Date.now()) {
  const runs = ((data.events && data.events.events) || []).filter((e) => /beyond burning/i.test(e.title || '') && Number.isFinite(Date.parse(e.end)));
  const on = runs.find((e) => (!e.start || Date.parse(e.start) <= now) && Date.parse(e.end) > now);
  const ev = on || runs.filter((e) => !e.start || Date.parse(e.start) <= now).sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0];
  if (!ev && runs.length) return -Infinity;
  const t = ev ? Date.parse(ev.end) : data.season ? Date.parse(data.season.ends) : NaN;
  return Number.isFinite(t) ? t : Infinity;
}

// Walks level by level from a reading to `target` at `perDay` EXP a day. Beyond Burning skips every other level
// below 280, but only while the walk is still before `burnUntil`. The walk starts at the reading's time, and a
// level not yet gained cannot be gained before `now`, so a reading from before the end gets nothing free after it.
function project(exp, from, target, perDay, burnUntil, now = -Infinity) {
  let t = from.t;
  let l = from.level;
  let f = Math.max(0, Math.min(1, from.frac || 0));
  let need = 0;
  while (l < target) {
    const n = expToNext(exp, l);
    if (n == null) return { need: Infinity, at: null };
    const e = n * (1 - f);
    need += e;
    if (perDay > 0) t += (e / perDay) * DAY;
    f = 0;
    l += 1;
    if (Math.max(t, now) < burnUntil && l < 280) l += 1;
  }
  return { need, at: perDay > 0 ? t : null };
}

export function levelOutlook(data, state, char, now) {
  const exp = data.upgrades.exp;
  const readings = levelReadings(data, state, char);
  let last = readings[readings.length - 1] || null;
  // A level typed on Characters that is above the last reading is newer than it.
  if (char.level && (!last || char.level > last.level)) last = { t: now, level: char.level, frac: 0, source: 'profile' };
  const burnUntil = char.beyondBurning ? beyondBurningEnd(data, now) : -Infinity;
  const beyond = now < burnUntil;
  // The rate only uses readings from one side of the end of Beyond Burning (levels before it were half price), so a
  // pair that straddles the end never mixes the two.
  const sameSide = readings.filter((r) => (r.t < burnUntil) === beyond);
  const rate = expRate(exp, sameSide, beyond, 14, now);
  const eventEnd = Date.parse((data.ibp && data.ibp.endsAt) || 0);
  const gates = last ? exp.gates.filter(([lvl]) => lvl > last.level).map(([lvl, what, eventNote]) => {
    const p = project(exp, last, lvl, rate ? rate.perDay : 0, burnUntil, now);
    // Days count from now, not from the reading; a date already passed means the reading is out of date.
    const days = p.at != null ? Math.max(0, (p.at - now) / DAY) : null;
    // The event part ("Item Burning stages 5-6") only for a gate reached while the event still runs.
    const eventOn = now < eventEnd && (p.at == null || p.at < eventEnd);
    return { level: lvl, what: eventNote && eventOn ? `${what}, ${eventNote}` : what, need: p.need, days, at: p.at, due: p.at != null && p.at <= now };
  }) : [];
  return { readings, last, rate, gates, beyond, burnUntil: Number.isFinite(burnUntil) ? burnUntil : null };
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
  const [showAll, setShowAll] = useState(false);
  const standing = new Set(standingLog(log));
  // The last six, plus every ignored reading wherever it is, so a slip can always be deleted.
  const shown = log.filter((r, i) => showAll || i >= log.length - 6 || !standing.has(r));
  const last = o.last;
  const toNext = last ? expToNext(exp, last.level) : null;
  return html`<div class="grid two">
    <${Card} title="Level and EXP" meta=${o.rate ? `rate from the last ${o.rate.spanDays.toFixed(1)} days` : last && last.level < exp.from ? `EXP figures start at Lv. ${exp.from}` : 'log twice to get a rate'}>
      ${last ? html`<div class="insight">
        <span class="k">Now</span>
        <span class="big">Lv. ${last.level} · ${(last.frac * 100).toFixed(2)}%</span>
        <span class="small muted">${toNext ? `${fmtBig(toNext * (1 - last.frac))} EXP to Lv. ${last.level + 1}` : last.level < exp.from ? `EXP figures start at Lv. ${exp.from}` : 'past the EXP table'} · ${last.source === 'profile' ? 'from Characters; log your EXP % below' : `logged ${fmtKst(last.t)}`}</span>
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
          const c = s.characters.find((x) => x.id === char.id);
          // was: the level this reading replaces, so deleting the reading can put it back.
          l.log = [...(l.log || []), { t: Date.now(), level, pct, ...(c ? { was: Number.isFinite(c.level) ? c.level : null } : {}) }].slice(-200);
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
        <tbody>${shown.slice().reverse().map((r) => html`<tr><td>${fmtKst(r.t)}${standing.has(r) ? '' : html`<div class="small muted">Ignored: a later reading has a lower level.</div>`}</td><td class="num">${r.level}</td><td class="num">${Number(r.pct).toFixed(3)}%</td>
          <td class="num"><button type="button" class="iconbtn" aria-label="Delete this reading" onClick=${() => update((s) => {
            const l = s.level[char.id];
            l.log = l.log.filter((x) => x.t !== r.t);
            // "Log it" also set the character's level; deleting a mistyped reading takes that back to the latest
            // reading left (your own or from Nexon's rankings) or to the level the reading replaced, whichever is higher.
            const c = s.characters.find((x) => x.id === char.id);
            if (!c || c.level !== r.level) return;
            const left = levelReadings(data, s, c);
            const prior = [left.length ? left[left.length - 1].level : null, r.was].filter((n) => Number.isFinite(n) && n > 0);
            if (prior.length) c.level = Math.max(...prior);
            else if (r.was === null) c.level = null;
          })}>×</button></td></tr>`)}</tbody></table></div>
        ${log.length > shown.length || showAll ? html`<button type="button" class="btn ghost" onClick=${() => setShowAll(!showAll)}>${showAll ? 'Show the last 6 only' : `Show all ${log.length} readings`}</button>` : null}` : null}
      <p class="note">Log your level and EXP % (shown under the EXP bar) once a day or so. If the character is listed in config/characters.json, the GitHub job also records it from Nexon's rankings every 6 hours. ${exp.beyondBurningNote}</p>
    <//>
    <${Card} title="Level gates" meta=${o.beyond ? `with Beyond Burning until ${fmtDate(o.burnUntil)}` : 'without Beyond Burning'}>
      ${o.gates.length ? o.gates.map((g) => html`<div class="goal">
        <div><b>Lv. ${g.level}</b><div class="small muted">${g.what}</div></div>
        <span class="small muted">${fmtBig(g.need)} EXP</span>
        <span class=${'date' + (g.days != null && g.days < 7 ? ' now' : '')}>${g.due ? 'due' : g.at ? fmtDate(g.at) : '—'}</span>
        <span class="small muted">${g.due ? 'log your level' : g.days != null ? `${Math.ceil(g.days)} day${Math.ceil(g.days) === 1 ? '' : 's'}` : ''}</span>
      </div>`) : html`<${Empty}>No gates ahead.<//>`}
      ${!o.rate ? html`<p class="note">${last && last.level < exp.from ? `Gate dates show from Lv. ${exp.from}, where the EXP figures start.` : "Dates show once you've logged your level on two different days."}</p>` : null}
      <p class="note">${exp.source}</p>
    <//>
    <${ExpSourcesCard} data=${data} level=${last ? last.level : null} />
  </div>`;
}

// Sol Erda and Fragments: what the next upgrades cost and when you can afford them.
export function ErdaCosts({ data, char, entry, template }) {
  const up = data.upgrades.erda;
  const weekly = { ...up.weeklyDefault, ...(entry.weekly || {}) };
  const costs = entry.costs || {};
  const set = (fn) => update((s) => {
    const e = charSlice(s, 'erda', char.id, () => ({ template: erdaTemplateFor(data.erda, char, entry), levels: {}, steps: {} }));
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
  return html`<${Card} title="Sol Erda planner" meta=${`${entry.solErda || 0} Sol Erda · ${entry.fragments || 0} ${plural(entry.fragments || 0, 'Fragment')} held`}>
    <div class="form-grid">
      <label class="field"><span>Sol Erda a week</span><${NumberInput} className="input" label="Sol Erda per week" value=${weekly.sol} max=${999} onChange=${(v) => set((e) => { e.weekly = { ...weekly, sol: v || 0 }; })} /></label>
      <label class="field"><span>Fragments a week</span><${NumberInput} className="input" label="Fragments per week" value=${weekly.frag} max=${99999} onChange=${(v) => set((e) => { e.weekly = { ...weekly, frag: v || 0 }; })} /></label>
    </div>
    ${rows.length ? rows.map((r) => html`<div class="goal">
      <div><b>${r.st.label}</b><div class="small muted">${r.origin ? `${r.known.sol} Sol Erda + ${r.known.frag} ${plural(r.known.frag, 'Fragment')} (HEXA Origin table)` : r.known ? `${r.known.sol || 0} Sol Erda + ${r.known.frag || 0} ${plural(r.known.frag || 0, 'Fragment')} (your entry)` : 'Enter the cost shown in game:'}</div>
        ${!r.origin ? html`<div class="toolbar" style=${{ marginTop: '4px' }}>
          <${NumberInput} label=${r.st.label + ' Sol Erda cost'} value=${r.known?.sol ?? ''} max=${999} onChange=${(v) => set((e) => { e.costs = { ...(e.costs || {}), [r.st.id]: { ...(e.costs || {})[r.st.id], sol: v || 0 } }; })} /><span class="small muted">Sol Erda</span>
          <${NumberInput} label=${r.st.label + ' Fragment cost'} value=${r.known?.frag ?? ''} max=${99999} onChange=${(v) => set((e) => { e.costs = { ...(e.costs || {}), [r.st.id]: { ...(e.costs || {})[r.st.id], frag: v || 0 } }; })} /><span class="small muted">Fragments</span>
        </div>` : null}</div>
      <span class=${'date' + (r.ready ? ' now' : '')}>${!r.known ? '—' : r.ready ? 'Ready now' : Number.isFinite(r.weeks) ? `${Math.ceil(r.weeks * 7)} ${plural(Math.ceil(r.weeks * 7), 'day')}` : 'add income'}</span>
    </div>`) : html`<${Empty}>Every step in the order is done.<//>`}
    <p class="note">${up.source} Dates count every step above in order.</p>
  <//>`;
}
