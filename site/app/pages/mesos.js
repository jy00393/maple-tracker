import { html, useState } from '../../vendor/htm-preact.mjs';
import { update, activeCharacter, newId } from '../store.js';
import { Card, Fold, PageHead, Seg, NumberInput, Stepper, Empty, MesoInput, fmtBig, useNow, parseMesos, MESO_MAX, plural } from '../ui.js';
import { computeIncome, crystalWeekStart } from '../calc/income.js';
import { starPlan, starSpread, maxStarsFor } from '../calc/starforce.js';
import { cubePlan } from '../calc/upgrades.js';
import { gearSummary, symbolPlan } from '../calc/progress.js';
import { slotOutlook } from './gear.js';
import { withCubeRates } from '../calc/advice.js';
import { DAY, dayKey, fmtDate, kstDays, dayWord, asOf } from '../time.js';
import { changedAt } from '../calc/asof.js';
import { Flames } from './flames.js';

const POT = ['None', 'Rare', 'Epic', 'Unique', 'Legendary'];
const setM = (fn) => update((s) => fn(s.mesos));

export function weeklyIncome(data, state, now) {
  const income = computeIncome(state.characters, state, data.bosses, data.bossById, now);
  const m = state.mesos;
  const bosses = income.worlds.reduce((a, w) => a + (w.plannedTotal || 0), 0);
  const ursus = (m.ursus || 0) * 7; // one run a day since v.272 (Nexon patch notes)
  const farming = (m.farmPerHour || 0) * (m.farmHours || 0);
  const other = m.other || 0;
  return { bosses, ursus, farming, other, total: bosses + ursus + farming + other };
}

const FAR = 100 * 365.25 * DAY;

// Date each goal becomes affordable, in list order, from mesos held plus weekly income.
// since: when `held` was typed. Income counts from then, so a goal's date stays put instead of sliding a day
// every day. due: that date has passed and `held` is still short, so the typed amount is out of date.
export function goalDates(goals, held, weekly, now, since = now) {
  const from = since > 0 && since <= now ? since : now;
  let need = 0;
  return goals.map((g) => {
    need += g.cost || 0;
    const short = need - (held || 0);
    if (short <= 0) return { ...g, cumulative: need, at: now, now: true };
    if (weekly <= 0) return { ...g, cumulative: need, at: null };
    const at = from + (short / weekly) * 7 * DAY;
    // More than a hundred years away is shown as out of reach rather than as a date.
    if (!(at - now <= FAR)) return { ...g, cumulative: need, at: null, tooFar: true };
    return { ...g, cumulative: need, at, ...(at <= now ? { due: true } : {}) };
  });
}

function IncomeBar({ inc }) {
  const parts = [['Boss crystals', inc.bosses, 'var(--accent)'], ['Ursus', inc.ursus, 'var(--info)'], ['Farming', inc.farming, 'var(--ok)'], ['Other', inc.other, '#A0A0A0']].filter((p) => p[1] > 0);
  if (!inc.total) return html`<p class="note">Add your income sources to see when each goal is affordable.</p>`;
  return html`<div class="grid" style=${{ gap: '8px' }}>
    <div style=${{ display: 'flex', height: '14px', borderRadius: '999px', overflow: 'hidden', background: '#1C1C1C' }}>
      ${parts.map(([k, v, c]) => html`<span title=${`${k}: ${fmtBig(v)}`} style=${{ width: `${(v / inc.total) * 100}%`, background: c }}></span>`)}
    </div>
    <div class="legend">${parts.map(([k, v, c]) => html`<span><i style=${{ background: c }}></i>${k} ${fmtBig(v)}</span>`)}</div>
  </div>`;
}

function Planner({ data, state, now }) {
  const m = state.mesos;
  const char = activeCharacter(state);
  const inc = weeklyIncome(data, state, now);
  // When "Mesos you have now" was last typed: goal dates count from that day.
  const heldAt = changedAt(state, 'mesos/held', now);
  const dated = goalDates(m.goals, m.held, inc.total, now, heldAt || now);
  const [goalErr, setGoalErr] = useState('');
  // A cost above the most the tracker holds would be reset on load, so it is never saved (nor offered below).
  // Any goal action takes down an earlier "can't read that" message: it was about a different try.
  const addGoal = (name, cost) => { setGoalErr(''); if (cost > 0 && cost <= MESO_MAX) setM((x) => { x.goals.push({ id: newId(), name, cost: Math.round(cost) }); }); };
  const removeGoal = (i) => { setGoalErr(''); setM((x) => { x.goals.splice(i, 1); }); };
  const move = (i, d) => { setGoalErr(''); moveGoal(i, d); };
  const moveGoal = (i, d) => setM((x) => { const j = i + d; if (j < 0 || j >= x.goals.length) return; [x.goals[i], x.goals[j]] = [x.goals[j], x.goals[i]]; });
  // One suggestion of each kind: the first one a goal can hold. One above the limit is passed over, not the end of the search.
  const offerable = (cost) => cost > 0 && cost <= MESO_MAX;
  const quick = [];
  // The cube prices are the Heroic Cube Shop's (upgrades.json), so they are not offered to an Interactive character.
  if (!char || char.world !== 'interactive') {
    quick.push(['200 Bright Cubes', 200 * data.upgrades.cubes.types.bright.price]);
    quick.push(['100 Glowing Cubes', 100 * data.upgrades.cubes.types.glowing.price]);
  }
  if (char) {
    const entries = state.symbols[char.id] || {};
    for (const area of data.symbols.sacred.areas) {
      const p = symbolPlan(data.symbols.sacred, area, entries[area.id]);
      if (!p.locked && !p.maxed && offerable(p.nextMesos)) { quick.push([`${area.name} symbol Lv. ${p.level + 1}`, p.nextMesos]); break; }
    }
    const gear = gearSummary(data.gear, state.gear[char.id], char.mainStat || 'STR');
    for (const r of gear.gaps) {
      if (r.entry.temporary) continue;
      const o = slotOutlook(r.slot, r.entry, r.target, withCubeRates(data.upgrades, state.mesos.cubeRates));
      if (o.sf && offerable(o.sf.plain.cost)) { quick.push([`${r.slot.name} ${o.sf.from}→${o.sf.to}★ (expected)`, o.sf.plain.cost]); break; }
    }
  }
  return html`<div class="grid wide-left">
    <${Card} title="Goals" meta=${inc.total ? `${fmtBig(inc.total)} a week` : 'no income entered'}>
      ${dated.length ? dated.map((g, i) => html`<div class="goal">
        <div><b>${String(g.name || '').trim() || 'Goal'}</b><div class="small muted">${fmtBig(g.cost)} · ${fmtBig(g.cumulative)} with everything above</div></div>
        <span class=${'date' + (g.now ? ' now' : '')}>${g.now ? 'Affordable now' : g.due ? 'should be affordable' : g.at ? fmtDate(g.at) : g.tooFar ? 'not in reach' : '—'}</span>
        <span class="small muted">${g.due ? 'update your mesos' : g.at && !g.now ? dayWord(kstDays(now, g.at)) : ''}</span>
        <span style=${{ display: 'flex', gap: '4px' }}>
          <button type="button" class="iconbtn" aria-label=${'Move up: ' + g.name} disabled=${i === 0} onClick=${() => move(i, -1)}>↑</button>
          <button type="button" class="iconbtn" aria-label=${'Move down: ' + g.name} disabled=${i === dated.length - 1} onClick=${() => move(i, 1)}>↓</button>
          <button type="button" class="iconbtn" aria-label=${'Remove: ' + g.name} onClick=${() => removeGoal(i)}>×</button>
        </span>
      </div>`) : html`<${Empty}>No goals yet. Add one below, or tap a suggestion.<//>`}
      <div class="toolbar">${quick.filter(([, cost]) => offerable(cost)).map(([name, cost]) => html`<button type="button" class="chip" onClick=${() => addGoal(name, cost)}>+ ${name} · ${fmtBig(cost)}</button>`)}</div>
      <form class="form-grid" onInput=${() => { if (goalErr) setGoalErr(''); }} onSubmit=${(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const name = String(f.get('name') || '').trim();
        const cost = parseMesosLoose(f.get('cost'));
        // A refused goal says why, instead of leaving the typed text sitting there.
        if (!name) return setGoalErr('Give the goal a name.');
        if (!cost) return setGoalErr('Type the cost like 750m or 2.4b (1,000T at most).');
        setGoalErr('');
        addGoal(name, cost);
        e.currentTarget.reset();
      }}>
        <label class="field"><span>Goal</span><input class="input" name="name" placeholder="e.g. Arcus symbol to Lv. 5" /></label>
        <label class="field"><span>Cost</span><input class="input" name="cost" inputmode="text" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck=${false} placeholder="e.g. 750m or 2.4b" /></label>
        <button class="btn primary" type="submit">Add goal</button>
      </form>
      ${goalErr ? html`<p class="warnbox" role="alert">${goalErr}</p>` : null}
    <//>
    <${Card} title="Your meso income" meta="per week">
      <div class="insight"><span class="k">Weekly income</span><span class="big accent">${fmtBig(inc.total)}</span><${IncomeBar} inc=${inc} /></div>
      <label class="field"><span>Mesos you have now${heldAt ? ` (${asOf(heldAt, now)})` : ''}</span><${MesoInput} label="Mesos held" value=${m.held} onChange=${(v) => setM((x) => { x.held = v || 0; })} /></label>
      <div class="field"><span>Boss crystals (from Bosses, all characters)</span><b>${fmtBig(inc.bosses)} a week</b></div>
      <div class="form-grid">
        <label class="field"><span>Ursus mesos per run (1 run a day)</span><${MesoInput} label="Ursus mesos per run" placeholder="e.g. 36m" value=${m.ursus} onChange=${(v) => setM((x) => { x.ursus = v; })} /></label>
        <label class="field"><span>Farming mesos per hour</span><${MesoInput} label="Farming mesos per hour" placeholder="e.g. 250m" value=${m.farmPerHour} onChange=${(v) => setM((x) => { x.farmPerHour = v; })} /></label>
        <label class="field"><span>Farming hours a week</span><${NumberInput} className="input" label="Farming hours per week" value=${m.farmHours || 0} max=${100} onChange=${(v) => setM((x) => { x.farmHours = v || 0; })} /></label>
        <label class="field"><span>Other mesos a week</span><${MesoInput} label="Other weekly mesos" value=${m.other} onChange=${(v) => setM((x) => { x.other = v; })} /></label>
      </div>
      <p class="note">Ursus is one run a day since v.272, with Golden Time always on and meso rewards tripled to make up for it (Nexon v.272 patch notes, 10 Nov 2026). Older community figures (about 36M to 56M a run at Lv. 264) are from before that change, so enter what your own run pays. Measure your own farming for an hour and enter it.</p>
    <//>
  </div>`;
}

// The same reading as the meso boxes, and nothing above what saved data can hold (it would be reset on load).
function parseMesosLoose(v) {
  const n = parseMesos(v);
  return n !== null && n <= MESO_MAX ? n : null;
}

function StarForce({ data, state }) {
  const sfData = data.upgrades.starforce;
  const o = { level: 160, from: 17, to: 22, discount: false, lessBoom: false, safeguard: false, mvp: 'none', spare: 0, ...(state.ui.sfCalc || {}) };
  const set = (patch) => update((s) => { s.ui.sfCalc = { ...o, ...patch }; });
  const max = maxStarsFor(sfData, o.level);
  const to = Math.min(o.to, max);
  // The saved stars are kept as typed (the level box saves per keystroke); the boxes and the sum use what fits.
  const from = Math.min(o.from, max);
  const todo = from < to;
  const opts = { discount: o.discount, lessBoom: o.lessBoom, safeguard: o.safeguard, mvp: o.mvp };
  const plan = starPlan(sfData, o.level, from, to, opts, o.spare || 0);
  // The spread comes from simulated runs, so it is skipped when a run would take thousands of attempts.
  const spread = plan.attempts > 0 && plan.attempts <= 2000 ? starSpread(sfData, o.level, from, to, opts, o.spare || 0, 2500) : null;
  return html`<div class="grid wide-left">
    <${Card} title="Star Force calculator" meta="GMS v.272 rates and costs">
      <div class="form-grid">
        <label class="field"><span>Item level</span><${NumberInput} className="input" label="Item level" value=${o.level} max=${300} onChange=${(v) => set({ level: v || 0 })} /></label>
        <div class="field"><span>From stars</span><${Stepper} label="Current stars" value=${from} max=${max} onChange=${(v) => set({ from: v || 0 })} /></div>
        <div class="field"><span>To stars (max ${max})</span><${Stepper} label="Target stars" value=${to} max=${max} onChange=${(v) => set({ to: v || 0 })} /></div>
        <label class="field"><span>MVP</span><select class="select" value=${o.mvp} onChange=${(e) => set({ mvp: e.currentTarget.value })}><option value="none">None</option><option value="silver">Silver (3%)</option><option value="gold">Gold (5%)</option><option value="diamond">Diamond+ (10%)</option></select></label>
        <label class="field"><span>Spare item cost per boom</span><${MesoInput} label="Spare item cost" placeholder="0" value=${o.spare} onChange=${(v) => set({ spare: v || 0 })} /></label>
      </div>
      <div class="toolbar">
        <label class="toggle"><input type="checkbox" checked=${o.discount} onChange=${(e) => set({ discount: e.currentTarget.checked })} /> 30% off (Sunny Sunday)</label>
        <label class="toggle"><input type="checkbox" checked=${o.lessBoom} onChange=${(e) => set({ lessBoom: e.currentTarget.checked })} /> 30% less destruction</label>
        <label class="toggle"><input type="checkbox" checked=${o.safeguard} onChange=${(e) => set({ safeguard: e.currentTarget.checked })} /> Safeguard 15–17★</label>
      </div>
      ${!todo ? html`<p class="note">${max === 0 ? 'An item of this level cannot take stars.' : 'Pick a target above the current stars.'}</p>` : html`<div class="tiles">
        <div class="tile accent"><span class="k">Expected cost</span><span class="v">${fmtBig(plan.cost)}</span><span class="s">${Math.round(plan.attempts)} ${plural(Math.round(plan.attempts), 'attempt')} on average</span></div>
        <div class="tile"><span class="k">Typical · bad luck</span><span class="v">${spread ? fmtBig(spread.p50) : '—'}</span><span class="s">${spread ? `1 in 10 runs costs over ${fmtBig(spread.p90)}` : 'not shown when the upgrade takes thousands of attempts'}</span></div>
        <div class=${'tile' + (plan.noBoom > 0.8 ? ' ok' : '')}><span class="k">No boom</span><span class="v">${Math.round(plan.noBoom * 100)}%</span><span class="s">${plan.booms.toFixed(2)} booms expected</span></div>
      </div>
      ${spread ? html`<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>To be this sure</th><th class="num">Mesos</th></tr></thead>
        <tbody>${[['50%', spread.p50], ['75%', spread.p75], ['90%', spread.p90], ['95%', spread.p95]].map(([label, v]) => html`<tr><td>${label}</td><td class="num">${fmtBig(v)}</td></tr>`)}</tbody>
      </table></div>
      <p class="note">From 2,500 simulated runs, booms included.</p>` : null}
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Attempt</th><th class="num">Success</th><th class="num">Boom</th><th class="num">Cost per try</th></tr></thead>
        <tbody>${plan.steps.map((a) => html`<tr><td>${a.star} → ${a.star + 1}★${a.guard ? ' (Safeguard)' : ''}</td><td class="num">${(a.success * 100).toFixed(2)}%</td><td class="num">${a.destroy ? (a.destroy * 100).toFixed(2) + '%' : '—'}</td><td class="num">${fmtBig(a.cost)}</td></tr>`)}</tbody>
      </table></div>`}
    <//>
    <${Fold} title="How it's worked out" meta="tap to open">
      <p class="note">Rates are the wiki base table with the old Star Catch bonus folded in (GMS made it permanent in v.271). Failing never drops a star. A boom leaves a trace restored at 12★ (15–19★), 15★ (20★), 17★ (21–22★), 19★ (23–25★) or 20★ (26★+).</p>
      <p class="note">${sfData.sunny.note} ${sfData.safeguard.note} ${sfData.mvp.note}</p>
      <p class="note">${sfData.source}</p>
    <//>
  </div>`;
}

function Cubes({ data, state }) {
  const c = data.upgrades.cubes;
  const char = activeCharacter(state);
  const interactive = Boolean(char && char.world === 'interactive');
  const o = { from: 3, to: 4, ...(state.ui.cubeCalc || {}) };
  const rates = state.mesos.cubeRates || {};
  // Counts presses of "Reset to the estimates", so the odds boxes drop a number that was typed but not saved.
  const [resets, setResets] = useState(0);
  const set = (patch) => update((s) => { s.ui.cubeCalc = { ...o, ...patch }; });
  const typeFor = (id) => ({ ...c.types[id], tierUp: rates[id] || c.types[id].tierUp });
  const plans = ['bright', 'glowing'].map((id) => ({ id, cube: typeFor(id), plan: cubePlan(typeFor(id), o.from, o.to) }));
  const cheaper = plans[0].plan.cost <= plans[1].plan.cost ? plans[0] : plans[1];
  return html`<div class="grid wide-left">
    <${Card} title="Cube calculator" meta="Heroic Cube Shop prices">
      <div class="form-grid">
        <label class="field"><span>Current tier</span><select class=${'select pot-' + o.from} value=${String(o.from)} onChange=${(e) => set({ from: Number(e.currentTarget.value) })}>${[1, 2, 3].map((t) => html`<option value=${t}>${POT[t]}</option>`)}</select></label>
        <label class="field"><span>Target tier</span><select class=${'select pot-' + o.to} value=${String(o.to)} onChange=${(e) => set({ to: Number(e.currentTarget.value) })}>${[2, 3, 4].map((t) => html`<option value=${t}>${POT[t]}</option>`)}</select></label>
      </div>
      ${o.to <= o.from ? html`<p class="note">Pick a target above the current tier.</p>` : html`<div class="tiles">
        ${plans.map(({ id, cube, plan }) => html`<div class=${'tile' + (cheaper.id === id ? ' accent' : '')}>
          <span class="k">${cube.name} · ${fmtBig(cube.price)} each</span>
          <span class="v">${fmtBig(plan.cost)}</span>
          <span class="s">${Math.round(plan.expected)} ${plural(Math.round(plan.expected), 'cube')} on average · ${plan.n90} (${fmtBig(plan.cost90)}) to be 90% sure</span>
        </div>`)}
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>To be this sure</th>${plans.map(({ cube }) => html`<th class="num">${cube.name}s</th><th class="num">Mesos</th>`)}</tr></thead>
        <tbody>${[50, 75, 90, 95].map((q) => html`<tr><td>${q}%</td>${plans.map(({ cube, plan }) => html`<td class="num">${plan.sure[q].toLocaleString('en-US')}</td><td class="num">${fmtBig(plan.sure[q] * cube.price)}</td>`)}</tr>`)}</tbody>
      </table></div>
      <p class="note">${cheaper.cube.name}s are the cheaper way to tier up here. ${interactive ? `These are Heroic Cube Shop prices; ${char.name || 'this character'} is on an Interactive world.` : c.heroicNoBonus}</p>`}
      <details>
        <summary class="small muted">Tier-up odds used (community estimates, editable from 0.1% to 100%)</summary>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Cube</th><th class="num">Rare → Epic</th><th class="num">Epic → Unique</th><th class="num">Unique → Legendary</th></tr></thead>
          <tbody>${['bright', 'glowing'].map((id) => html`<tr><td>${c.types[id].name}</td>${[0, 1, 2].map((i) => html`<td class="num">
            <${NumberInput} step=${0.1} min=${0.1} max=${100} clamp=${false} rev=${resets} label=${`${c.types[id].name} tier-up ${i + 1} percent`} value=${Number((typeFor(id).tierUp[i] * 100).toFixed(3))}
              onChange=${(v) => { if (!(v >= 0.1 && v <= 100)) return; update((s) => { const r = { ...(s.mesos.cubeRates || {}) }; const arr = [...(r[id] || c.types[id].tierUp)]; arr[i] = v / 100; r[id] = arr; s.mesos.cubeRates = r; }); }} />%</td>`)}</tr>`)}</tbody></table></div>
        <button type="button" class="btn ghost" onClick=${() => { setResets((n) => n + 1); update((s) => { delete s.mesos.cubeRates; }); }}>Reset to the estimates</button>
      </details>
    <//>
    <${Fold} title="About the odds" meta="tap to open">
      <p class="note">${c.source}</p>
      <p class="note">Line odds (e.g. two lines of STR %) aren't published for GMS, so this covers tier-ups only. Gear slots show the same estimate for their own target.</p>
    <//>
  </div>`;
}

function History({ data, state, now }) {
  const hist = state.incomeHistory || {};
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const key = dayKey(crystalWeekStart(now) - i * 7 * DAY);
    weeks.push({ key, ...(hist[key] || { earned: 0, planned: 0 }) });
  }
  const top = Math.max(0, ...weeks.map((w) => Math.max(w.earned || 0, w.planned || 0)));
  const max = Math.max(1, top);
  // The last entry is the crystal week still running: its part-total is shown, but not averaged with full weeks.
  const thisWeek = weeks[weeks.length - 1];
  const recorded = weeks.slice(0, -1).filter((w) => w.earned > 0);
  const avg = recorded.length ? recorded.reduce((a, w) => a + w.earned, 0) / recorded.length : 0;
  const W = 720;
  const H = 220;
  const bw = W / weeks.length;
  return html`<div class="grid wide-left">
    <${Card} title="Weekly crystal income" meta="last 12 crystal weeks (Thursday to Wednesday)">
      <svg class="chart" viewBox=${`0 0 ${W} ${H + 28}`} role="img" aria-label="Weekly crystal income chart">
        ${[0.25, 0.5, 0.75, 1].map((f) => html`<line x1="0" x2=${W} y1=${H - f * (H - 16)} y2=${H - f * (H - 16)} stroke="#333" stroke-dasharray="3 4" />
          ${top > 0 ? html`<text x="4" y=${H - f * (H - 16) - 4} fill="#8C9087" font-size="11">${fmtBig(max * f)}</text>` : null}`)}
        ${weeks.map((w, i) => {
          const x = i * bw + bw * 0.18;
          const bwInner = bw * 0.64;
          const hp = ((w.planned || 0) / max) * (H - 16);
          const he = ((w.earned || 0) / max) * (H - 16);
          return html`<g>
            <rect x=${x} y=${H - hp} width=${bwInner} height=${hp} rx="4" fill="#3A3A3A"><title>${`Planned ${fmtBig(w.planned || 0)}`}</title></rect>
            <rect x=${x} y=${H - he} width=${bwInner} height=${he} rx="4" fill="#FEAC42"><title>${`Week of ${w.key}: earned ${fmtBig(w.earned || 0)}`}</title></rect>
            <text x=${x + bwInner / 2} y=${H + 18} fill="#A7ABA2" font-size="11" text-anchor="middle">${w.key.slice(5).replace('-', '/')}</text>
          </g>`;
        })}
      </svg>
      <div class="legend"><span><i style=${{ background: '#FEAC42' }}></i>Earned</span><span><i style=${{ background: '#3A3A3A' }}></i>Planned</span></div>
    <//>
    <${Card} title="Summary">
      <div class="insight"><span class="k">Average earned week</span><span class="big accent">${fmtBig(avg)}</span><span class="small muted">${recorded.length} finished week${recorded.length === 1 ? '' : 's'} recorded · this week so far: ${fmtBig(thisWeek.earned || 0)}</span></div>
      <p class="note">A week is saved while the tracker is open, so the chart fills in as you use it. Totals are all characters, after the 14-per-character and 180-per-world caps.</p>
    <//>
  </div>`;
}

export function MesosPage({ data, state }) {
  const now = useNow(60000);
  const view = state.ui.mesosView || 'planner';
  return html`
    <${PageHead} title="Mesos">Plan what to save for, and check what Star Force, cubes and flames will really cost before you spend.<//>
    <div class="toolbar"><${Seg} label="Mesos section" value=${view} onChange=${(v) => update((s) => { s.ui.mesosView = v; })}
      options=${[['planner', 'Planner'], ['starforce', 'Star Force'], ['cubes', 'Cubes'], ['flames', 'Flames'], ['history', 'Income history']]} /></div>
    ${view === 'planner' ? html`<${Planner} data=${data} state=${state} now=${now} />`
      : view === 'starforce' ? html`<${StarForce} data=${data} state=${state} />`
      : view === 'cubes' ? html`<${Cubes} data=${data} state=${state} />`
      : view === 'flames' ? html`<${Flames} data=${data} state=${state} />`
      : html`<${History} data=${data} state=${state} now=${now} />`}`;
}
