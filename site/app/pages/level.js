import { html, useState } from '../../vendor/htm-preact.mjs';
import { update, charSlice } from '../store.js';
import { Card, NumberInput, Empty, fmtBig, plural } from '../ui.js';
import { expToNext, expToReach, expRate, erdaCost, solErdaCap } from '../calc/upgrades.js';
import { erdaNextSteps, erdaTemplateFor } from '../calc/progress.js';
import { DAY, fmtDate, fmtDay, fmtKst, kstDays, dayWord, asOf } from '../time.js';
import { ExpSourcesCard } from './expsources.js';

// Your own readings that still stand, oldest first. Levels never go down, so readings whose levels go down over
// time cannot all be right. The longest run of readings that never goes down stands and the rest are ignored: one
// slip, too high or too low, is outvoted by the real readings around it. When two runs are as long as each other
// (a reading and one lower reading after it), the one that ends with the newest reading stands, since the newest
// one is most likely the correction. Inside a run, a reading follows the highest earlier level that fits, so a
// low slip is not kept as a stepping stone ([264, 207, 264] keeps both 264s).
export function standingLog(log) {
  const rows = (Array.isArray(log) ? log : []).filter((r) => r && Number.isFinite(r.t) && Number.isFinite(r.level)).slice().sort((a, b) => a.t - b.t);
  const len = [];
  const prev = [];
  let end = -1;
  for (let i = 0; i < rows.length; i++) {
    len[i] = 1;
    prev[i] = -1;
    for (let j = 0; j < i; j++) {
      if (rows[j].level > rows[i].level) continue;
      const p = prev[i];
      if (len[j] + 1 > len[i] || (len[j] + 1 === len[i] && p >= 0 && rows[j].level >= rows[p].level)) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
    if (end < 0 || len[i] >= len[end]) end = i;
  }
  const out = [];
  for (let i = end; i >= 0; i = prev[i]) out.unshift(rows[i]);
  return out;
}

// The character's level after "Log it" adds `reading` to a log (`logAfter` already holds it). A reading that
// stands sets the level; one that is ignored (it does not fit the other readings) leaves the level alone.
export function levelAfterLog(logAfter, reading, current) {
  return standingLog(logAfter).includes(reading) ? reading.level : current;
}

// The character's level after deleting reading `r`. `logBefore` is your own log with `r` still in it, `left` is
// every reading that remains (levelReadings: your standing ones and Nexon's), `current` is the level now.
// Only the newest of your readings can have set the current level, and only if the level still equals it; any
// other delete changes nothing, so a later reading is never contradicted. Undoing the newest one gives:
//  - a reading (from Nexon's rankings) later than it, when there is one: that is newer than anything else;
//  - else the higher of the latest reading left and `was`, the level the deleted reading replaced.
export function levelAfterDelete(logBefore, r, left, current) {
  if (current !== r.level) return current;
  // A later reading of yours keeps the level only while a reading that is left still reaches it; otherwise the
  // level came from rows that are now gone (two wrong rows deleted after a correction).
  const rest = (logBefore || []).filter((x) => x && x.t !== r.t);
  if (rest.some((x) => x.t > r.t) && (rest.some((x) => x.level >= current) || left.some((x) => x.level >= current))) return current;
  const latest = left.length ? left[left.length - 1] : null;
  if (latest && latest.t > r.t && latest.source !== 'you') return latest.level;
  const prior = [latest ? latest.level : null, r.was].filter((n) => Number.isFinite(n) && n > 0);
  if (prior.length) return Math.max(...prior);
  return r.was === null ? null : current;
}

// Each reading remembers the level it replaced (`was`). When `r` is deleted from the middle, the reading after it
// would remember a level that only `r` had set, so it takes over what `r` replaced. Deleting every reading, in any
// order, then ends at the level from before the first one, never at a deleted slip. `logAfter` is changed in place.
export function passOnWas(logAfter, r) {
  const next = (logAfter || []).filter((x) => x && x.t > r.t).sort((a, b) => a.t - b.t)[0];
  if (!next || next.was === undefined || next.was !== r.level) return;
  if (r.was === undefined) delete next.was;
  else next.was = r.was;
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
  return { need, at: perDay > 0 ? t : null, level: l };
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
  const gates = last ? exp.gates.filter(([lvl]) => lvl > last.level).map(([lvl, what, eventNote, burnNote]) => {
    const p = project(exp, last, lvl, rate ? rate.perDay : 0, burnUntil, now);
    // Days count from now, not from the reading; a date already passed means the reading is out of date.
    const days = p.at != null ? Math.max(0, (p.at - now) / DAY) : null;
    // The event part ("Item Burning stages 5-6") only for a Challenger World character (Item Burning Plus and Mayrin
    // are Challenger World only, Nexon notice 47305) and a gate reached while the event still runs.
    const eventOn = Boolean(char.challenger) && now < eventEnd && (p.at == null || p.at < eventEnd);
    // The Beyond Burning part only for a character that has it, for a gate reached while it still runs.
    const burnOn = beyond && (p.at == null || p.at < burnUntil);
    const parts = [what, eventOn ? eventNote : null, burnOn ? burnNote : null].filter(Boolean);
    return { level: lvl, what: parts.join(', '), need: p.need, days, at: p.at, due: p.at != null && p.at <= now };
  }) : [];
  return { readings, last, rate, gates, beyond, burnUntil: Number.isFinite(burnUntil) ? burnUntil : null };
}

// Each level the planner expects the character to reach before `until`, at the EXP rate of levelOutlook:
// [{ level, at }], ascending (Beyond Burning can skip a level). Empty without a rate. `o`: a levelOutlook already
// worked out, to save doing it twice.
export function levelPath(data, state, char, now, until, o = levelOutlook(data, state, char, now)) {
  const exp = data.upgrades.exp;
  if (!o.last || !o.rate || !(o.rate.perDay > 0)) return [];
  const burnUntil = o.burnUntil == null ? (o.beyond ? Infinity : -Infinity) : o.burnUntil;
  const out = [];
  let reached = o.last.level;
  for (let target = o.last.level + 1; target <= 300; target++) {
    if (target <= reached) continue;
    const p = project(exp, o.last, target, o.rate.perDay, burnUntil, now);
    if (p.at == null || !Number.isFinite(p.need)) break;
    const at = Math.max(p.at, now);
    if (at > until) break;
    // A Beyond Burning level-up lands one past the target: p.level is the level actually reached.
    out.push({ level: p.level, at });
    reached = p.level;
  }
  return out;
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
  // A level typed on Characters or in setup comes without an EXP %: none is shown until one is logged.
  const noPct = Boolean(last && last.source === 'profile');
  return html`<div class="grid two">
    <${Card} title="Level and EXP" meta=${o.rate ? `rate from the last ${o.rate.spanDays.toFixed(1)} days` : last && last.level < exp.from ? `EXP figures start at Lv. ${exp.from}` : 'log twice to get a rate'}>
      ${last ? html`<div class="insight">
        <span class="k">Now</span>
        <span class="big">Lv. ${last.level}${noPct ? '' : ` · ${(last.frac * 100).toFixed(2)}%`}</span>
        <span class="small muted">${toNext ? `${noPct ? 'up to ' : ''}${fmtBig(toNext * (1 - last.frac))} EXP to Lv. ${last.level + 1}` : last.level < exp.from ? `EXP figures start at Lv. ${exp.from}` : 'past the EXP table'} · ${last.source === 'profile' ? 'from Characters; log your EXP % below' : `logged ${fmtKst(last.t)}`}</span>
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
          // Never the same time as an earlier row: rows are told apart by their time.
          let t = Date.now();
          while ((l.log || []).some((x) => x && x.t === t)) t += 1;
          const reading = { t, level, pct, ...(c ? { was: Number.isFinite(c.level) ? c.level : null } : {}) };
          l.log = [...(l.log || []), reading].slice(-200);
          // The level follows the reading, unless the reading is ignored (see standingLog).
          if (c) c.level = levelAfterLog(l.log, reading, c.level);
        });
        e.currentTarget.reset();
      }}>
        <label class="field"><span>Level</span><input class="input" name="level" type="number" min="200" max="300" placeholder=${String(last ? last.level : char.level || 264)} required /></label>
        <label class="field"><span>EXP %</span><input class="input" name="pct" type="number" min="0" max="99.999" step="0.001" placeholder="e.g. 45.231" required /></label>
        <button class="btn primary" type="submit">Log it</button>
      </form>
      <label class="toggle"><input type="checkbox" checked=${Boolean(char.beyondBurning)} onChange=${(e) => setChar(char, { beyondBurning: e.currentTarget.checked })} /> Beyond Burning (an extra level each level-up until 280)</label>
      ${log.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Logged</th><th class="num">Level</th><th class="num">EXP %</th><th></th></tr></thead>
        <tbody>${shown.slice().reverse().map((r) => html`<tr><td>${fmtKst(r.t)}${standing.has(r) ? '' : html`<div class="small muted">Ignored: the level does not fit your other readings. If this one is right, delete the wrong ones.</div>`}</td><td class="num">${r.level}</td><td class="num">${Number(r.pct).toFixed(3)}%</td>
          <td class="num"><button type="button" class="iconbtn" aria-label="Delete this reading" onClick=${() => update((s) => {
            const l = s.level[char.id];
            if (!l || !Array.isArray(l.log)) return;
            const before = l.log;
            l.log = before.filter((x) => x.t !== r.t);
            // "Log it" also set the character's level; deleting that reading takes it back (see levelAfterDelete).
            const c = s.characters.find((x) => x.id === char.id);
            if (c) c.level = levelAfterDelete(before, r, levelReadings(data, s, c), c.level);
            passOnWas(l.log, r);
          })}>×</button></td></tr>`)}</tbody></table></div>
        ${log.length > shown.length || showAll ? html`<button type="button" class="btn ghost" onClick=${() => setShowAll(!showAll)}>${showAll ? 'Show the last 6 only' : `Show all ${log.length} readings`}</button>` : null}` : null}
      <p class="note">Log your level and EXP % (shown under the EXP bar) once a day or so. If the character is listed in config/characters.json, the GitHub job also records it from Nexon's rankings every 6 hours. ${exp.beyondBurningNote}</p>
    <//>
    <${Card} title="Level gates" meta=${o.beyond ? `with Beyond Burning until ${fmtDate(o.burnUntil)}` : 'without Beyond Burning'}>
      ${o.gates.length ? o.gates.map((g) => html`<div class="goal">
        <div><b>Lv. ${g.level}</b><div class="small muted">${g.what}</div></div>
        <span class="small muted">${fmtBig(g.need)} EXP</span>
        <span class=${'date' + (g.days != null && g.days < 7 ? ' now' : '')}>${g.due ? 'due' : g.at ? fmtDate(g.at) : '—'}</span>
        <span class="small muted">${g.due ? 'log your level' : g.at != null ? dayWord(kstDays(now, g.at)) : ''}</span>
      </div>`) : html`<${Empty}>${last ? 'No gates ahead.' : 'Log your level to see the gates.'}<//>`}
      ${!o.rate && last ? html`<p class="note">${last && last.level < exp.from ? `Gate dates show from Lv. ${exp.from}, where the EXP figures start.` : "Dates show once you've logged your level on two different days."}</p>` : null}
      <p class="note">${exp.source}${exp.gatesSource ? ` ${exp.gatesSource}` : ''}</p>
    <//>
    <${ExpSourcesCard} data=${data} level=${last ? last.level : null} />
  </div>`;
}

// Sol Erda and Fragments: what the next upgrades cost and when you can afford them.
// since: when the Sol Erda figures on this card were last changed (null: not known). The days to each step count
// from then, so they become a date that stays put.
export function ErdaCosts({ data, char, entry, template, since = null, now = Date.now() }) {
  const from = since && since <= now ? since : now;
  const up = data.upgrades.erda;
  const weekly = { ...up.weeklyDefault, ...(entry.weekly || {}) };
  const costs = entry.costs || {};
  // The most Sol Erda this character can hold (v.272): its level from Characters.
  const level = Number(char && char.level);
  const cap = solErdaCap(level, up.holdCap);
  const held = entry.solErda || 0;
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
    const at = Number.isFinite(weeks) ? from + Math.ceil(weeks * 7) * DAY : null;
    return { st, known, origin: st.node === 'origin', weeks, at, ready: known && shortSol === 0 && shortFrag === 0 };
  });
  return html`<${Card} title="Sol Erda planner" meta=${`${entry.solErda || 0} Sol Erda · ${entry.fragments || 0} ${plural(entry.fragments || 0, 'Fragment')} held${since ? ` ${asOf(since, now)}` : ''}`}>
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
      <span class=${'date' + (r.ready ? ' now' : '')}>${!r.known ? '—' : r.ready ? 'Ready now' : r.at === null ? 'add income' : r.at <= now ? 'update what you hold' : `about ${fmtDay(r.at, now)}`}</span>
    </div>`) : html`<${Empty}>Every step in the order is done.<//>`}
    ${cap ? html`<p class=${held >= cap || held + (weekly.sol || 0) > cap ? 'warnbox' : 'note'}>${held >= cap
      ? `You hold ${held} Sol Erda, the most a Lv. ${level} character can hold (${cap}). Spend some before more arrives, or it is wasted.`
      : held + (weekly.sol || 0) > cap
        ? `A week's Sol Erda would take you past ${cap}, the most a Lv. ${level} character can hold. Spend some first.`
        : `A Lv. ${level} character can hold up to ${cap} Sol Erda.`} ${up.holdCapSource || ''}</p>` : null}
    <p class="note">${template && template.costNote ? `${template.costNote} ` : ''}${up.source} Dates count every step above in order, from the day you last changed the figures on this page. Sol Erda and Fragments are not added by themselves: retype what you hold now and then.</p>
  <//>`;
}
