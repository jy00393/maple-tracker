import { html } from '../../vendor/htm-preact.mjs';
import { update, activeCharacter } from '../store.js';
import { Card, Counter, PageHead, useNow, Bar } from '../ui.js';
import { periodKey } from '../time.js';
import { StreakRecorder, StreakCard } from './session.js';
import { itemStatus, resetOf, recordKey, flagKey, RESET_CYCLE } from '../calc/checklist.js';
import { knownLevel } from './level.js';

export { itemStatus, resetOf, recordKey };

// The character the checklist is shown for: ticks, level locks and Challenger-only items follow it.
export function whoOf(data, state) {
  const c = activeCharacter(state);
  return c ? { id: c.id, name: c.name, level: knownLevel(data, state, c), challenger: Boolean(c.challenger) } : {};
}

const DAY_NAMES = { mon: ['Mon', 'Monday'], wed: ['Wed', 'Wednesday'], thu: ['Thu', 'Thursday'] };

// Progress over the main daily group; used by the Today page too.
export function dailyProgress(checklistData, checklistState, now, who) {
  const group = checklistData.groups.find((g) => g.key === 'daily');
  let done = 0;
  let total = 0;
  for (const item of group.items) {
    const st = itemStatus(item, group, checklistState, now, who);
    if (st.locked || st.expired || st.link || item.optional) continue;
    total++;
    if (st.done) done++;
  }
  return { done, total };
}

export function setRecord(id, kind, rec) {
  update((s) => {
    s.checklist.items[id] = { p: periodKey(kind, Date.now()), ...rec };
  });
}

export function Item({ item, group, cs, now, who }) {
  const st = itemStatus(item, group, cs, now, who);
  const level = who.level;
  const key = recordKey(item, who);
  if (st.expired) return null;
  const cls = 'row' + (st.done ? ' done' : '') + (item.optional || group.optional ? ' optional' : '') + (st.locked ? ' locked' : '');
  const id = 'cl-' + item.id;
  let left;
  let right = [];
  const accountPill = item.scope === 'account' ? html`<span class="pill" title="Ticked once for the whole account">account</span>` : null;
  if (item.type === 'count') {
    left = html`<span class=${'mark' + (st.done ? ' on' : '')} aria-hidden="true"></span>`;
    right.push(html`<${Counter} value=${st.count} target=${item.target} label=${item.label}
      onChange=${(v) => setRecord(key, st.kind, { c: v, d: v >= item.target ? 1 : 0 })} />`);
  } else if (item.type === 'chips') {
    left = html`<span class=${'mark' + (st.done ? ' on' : '')} aria-hidden="true"></span>`;
    right.push(html`<span class="min">${st.on.filter(Boolean).length} / ${item.chips.length}</span>`);
  } else if (item.type === 'link') {
    left = html`<span class="mark" aria-hidden="true"></span>`;
    right.push(html`<a class="btn" href=${item.href}>Open</a>`);
  } else {
    left = html`<input type="checkbox" id=${id} checked=${st.done} disabled=${st.locked}
      onChange=${(e) => setRecord(key, st.kind, { d: e.currentTarget.checked ? 1 : 0 })} />`;
    if (item.min) right.push(html`<span class="min">${item.min}</span>`);
  }
  if (accountPill) right.unshift(accountPill);
  if (group.reset === 'custom') {
    const names = DAY_NAMES[st.kind];
    right.unshift(html`<button type="button" class="pill" aria-label=${`Resets on ${names[1]}. Tap to change the reset day.`}
      onClick=${() => update((s) => {
        const next = RESET_CYCLE[(RESET_CYCLE.indexOf(st.kind) + 1) % RESET_CYCLE.length];
        // The reset day is one setting for everyone, so every character's tick for this item moves with it.
        for (const [k, r] of Object.entries(s.checklist.items)) {
          if ((k === item.id || k.endsWith(`|${item.id}`)) && r && r.p === periodKey(st.kind, Date.now())) r.p = periodKey(next, Date.now());
        }
        s.checklist.resets[item.id] = next;
      })}>${names[0]} reset</button>`);
  }
  if (st.tooLow) {
    right.push(html`<span class="pill">from Lv. ${item.minLevel}</span>`);
    right.push(html`<button type="button" class="btn" onClick=${() => update((s) => { s.checklist.flags[flagKey(`lvl:${item.id}`, who)] = true; })}>Mark unlocked</button>`);
  }
  // While the level lock is on, only that one is offered; the quest unlock comes after it.
  if (st.gated && !st.tooLow) {
    right.push(html`<button type="button" class="btn" onClick=${() => update((s) => { s.checklist.flags[flagKey(item.gate, who)] = true; })}>Mark unlocked</button>`);
  }
  const label = item.type === 'check' || !item.type
    ? html`<label class="lbl" for=${id}>${item.label}</label>`
    : html`<span class="lbl">${item.label}</span>`;
  return html`<div class=${cls}>
    ${left}${label}<div class="right">${right}</div>
    ${item.type === 'chips' ? html`<div class="chips">${item.chips.map(([cid, text], i) => html`<button type="button" class="chip" aria-pressed=${String(st.on[i])}
      onClick=${() => setRecord(recordKey(item, who, `_${cid}`), st.kind, { d: st.on[i] ? 0 : 1 })}>${text}</button>`)}</div>` : null}
    ${item.note ? html`<p class="note">${item.note}</p>` : null}
  </div>`;
}

export function ChecklistPage({ data, state }) {
  const now = useNow(15000);
  const cs = state.checklist;
  const who = whoOf(data, state);
  const prog = dailyProgress(data.checklist, cs, now, who);
  return html`
    <${PageHead} title=${who.name ? `Checklist · ${who.name}` : 'Checklist'}>${state.characters.length > 1 ? 'Each character has its own ticks; items marked “account” are shared. ' : ''}Ticks clear themselves at each reset: dailies at 09:00 KST, weeklies on their own day. Event items disappear once the event ends.<//>
    <div class="tiles">
      <div class="tile"><span class="k">Core dailies today</span><span class="v">${prog.done} / ${prog.total}</span><${Bar} pct=${prog.total ? prog.done / prog.total : 0} /></div>
    </div>
    <${StreakRecorder} data=${data} state=${state} now=${now} />
    <div class="grid two">
      <${StreakCard} state=${state} now=${now} />
      ${data.checklist.groups.map((group) => {
        // A group whose items have all ended (or are not for this character) is left out, heading included.
        if (group.items.every((item) => itemStatus(item, group, cs, now, who).expired)) return null;
        const items = group.items.map((item) => html`<${Item} key=${item.id} item=${item} group=${group} cs=${cs} now=${now} who=${who} />`);
        return html`<${Card} title=${group.title} meta=${group.hint} bodyClass="card-b tight">${items}<//>`;
      })}
    </div>
    <p class="note">${data.checklist.source}</p>`;
}
