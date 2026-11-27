import { html } from '../../vendor/htm-preact.mjs';
import { update, activeCharacter } from '../store.js';
import { Card, Counter, PageHead, useClock, Bar } from '../ui.js';
import { periodKey } from '../time.js';
import { StreakRecorder, StreakCard } from './session.js';
import { itemStatus, resetOf, recordKey, moveResetDay, RESET_CYCLE, openAreas, setUnlocked, listedItems } from '../calc/checklist.js';
import { knownLevel } from './level.js';
import { toggleClear } from './bosses.js';
import { sealNoteFor } from './challenger.js';

export { itemStatus, resetOf, recordKey };

// The character the checklist is shown for: ticks, level locks and Challenger-only items follow it.
export function whoOf(data, state) {
  return whoFor(data, state, activeCharacter(state));
}

// The same for any one character. `bosses` is what the boss items read (calc/checklist.js): the Bosses page's
// picks and ticks are the one record of a boss clear.
export function whoFor(data, state, c) {
  if (!c) return {};
  const bosses = data.bosses && data.bossById ? { data: data.bosses, byId: data.bossById, all: state.bosses || {}, char: c, chars: state.characters || [] } : null;
  // open: the symbol areas Progress already holds a level for, so their dailies are never shown as locked.
  return { id: c.id, name: c.name, level: knownLevel(data, state, c), challenger: Boolean(c.challenger), bosses, open: openAreas((state.symbols || {})[c.id]), sealNote: () => sealNoteFor(data, state, c) };
}

const DAY_NAMES = { mon: ['Mon', 'Monday'], wed: ['Wed', 'Wednesday'], thu: ['Thu', 'Thursday'] };

// Progress over the main daily group; used by the Today page too.
export function dailyProgress(checklistData, checklistState, now, who) {
  const group = checklistData.groups.find((g) => g.key === 'daily');
  let done = 0;
  let total = 0;
  for (const item of group.items) {
    const st = itemStatus(item, group, checklistState, now, who);
    // Rows that follow the bosses picked on Bosses ("Daily bosses") are counted with the bosses, not here: the
    // list changes when picks change, and a day already finished must not come undone by a new pick.
    if (st.locked || st.expired || st.link || st.rows || item.optional) continue;
    total++;
    if (st.done) done++;
  }
  return { done, total };
}

export function setRecord(id, kind, rec) {
  update((s) => {
    // `t` is when the tick was made: changing an item's reset day needs it to tell which ticks still stand.
    const now = Date.now();
    s.checklist.items[id] = { p: periodKey(kind, now), t: now, ...rec };
  });
}

// One step on a counter, applied to the count that is current at the click. The page can be a few seconds
// behind a reset, so the count it drew may belong to the period that has just ended.
export function bumpCount(item, group, who, step) {
  update((s) => {
    const now = Date.now();
    const cur = itemStatus(item, group, s.checklist, now, who);
    const c = Math.max(0, Math.min(item.target, cur.count + step));
    if (c === cur.count) return;
    s.checklist.items[recordKey(item, who)] = { p: periodKey(cur.kind, now), t: now, c, d: c >= item.target ? 1 : 0 };
  });
}

// A tick on a plain item. An item that stands for a boss clear (`st.clear`) writes the Bosses tick instead, on
// the difficulty that is picked. Unticking also takes away a clear on another character when the item is
// account-wide, and a tick left from when the row was a checklist tick of its own.
export function tickItem(item, st, who, checked) {
  if (!st.clear) return setRecord(recordKey(item, who), st.kind, { d: checked ? 1 : 0 });
  const c = st.clear;
  if (checked || c.own) toggleClear(who.id, c.boss, { shared: c.shared }, checked);
  if (!checked) {
    for (const o of c.others) toggleClear(o.id, o.boss, { shared: o.shared }, false);
    if (st.old) setRecord(recordKey(item, who), st.kind, { d: 0 });
  }
}

export function Item({ item, group, cs, now, who }) {
  const st = itemStatus(item, group, cs, now, who);
  const level = who.level;
  if (st.expired) return null;
  const cls = 'row' + (st.done ? ' done' : '') + (item.optional || group.optional ? ' optional' : '') + (st.locked ? ' locked' : '');
  const id = 'cl-' + item.id;
  let left;
  let right = [];
  const accountPill = item.scope === 'account' ? html`<span class="pill" title="Ticked once for the whole account">account</span>` : null;
  if (item.type === 'count') {
    left = html`<span class=${'mark' + (st.done ? ' on' : '')} aria-hidden="true"></span>`;
    right.push(html`<${Counter} value=${st.count} target=${item.target} label=${item.label}
      disabled=${st.locked} onStep=${(d) => bumpCount(item, group, who, d)} />`);
  } else if (item.type === 'chips') {
    left = html`<span class=${'mark' + (st.done ? ' on' : '')} aria-hidden="true"></span>`;
    right.push(html`<span class="min">${st.on.filter(Boolean).length} / ${item.chips.length}</span>`);
  } else if (st.rows && !st.prompt) {
    // The bosses picked on Bosses: the count is theirs, and each chip is that boss's own tick.
    left = html`<span class=${'mark' + (st.done ? ' on' : '')} aria-hidden="true"></span>`;
    if (st.total) right.push(html`<span class="min">${st.count} / ${st.total}</span>`);
    if (item.type === 'link') right.push(html`<a class="btn" href=${item.href}>Open</a>`);
  } else if (item.type === 'link' || st.prompt) {
    left = html`<span class="mark" aria-hidden="true"></span>`;
    if (!st.prompt) right.push(html`<a class="btn" href=${item.href}>Open</a>`);
  } else {
    left = html`<input type="checkbox" id=${id} checked=${st.done} disabled=${st.locked}
      onChange=${(e) => tickItem(item, st, who, e.currentTarget.checked)} />`;
    if (item.min) right.push(html`<span class="min">${item.min}</span>`);
  }
  if (accountPill) right.unshift(accountPill);
  if (group.reset === 'custom') {
    const names = DAY_NAMES[st.kind];
    right.unshift(html`<button type="button" class="pill" aria-label=${`Resets on ${names[1]}. Tap to change the reset day.`}
      onClick=${() => update((s) => {
        // Worked out from the saved setting at the click, not from the draw.
        const from = resetOf(item, group, s.checklist);
        const next = RESET_CYCLE[(RESET_CYCLE.indexOf(from) + 1) % RESET_CYCLE.length];
        moveResetDay(s.checklist.items, item, from, next, Date.now());
        s.checklist.resets[item.id] = next;
      })}>${names[0]} reset</button>`);
  }
  if (st.tooLow) right.push(html`<span class="pill">from Lv. ${item.minLevel}</span>`);
  // One press opens the item, whatever keeps it locked (the level, the area's questline, or both); an item
  // opened by hand can be locked again.
  if (st.locked) right.push(html`<button type="button" class="btn" onClick=${() => update((s) => { setUnlocked(s.checklist, item, who, true); })}>Mark unlocked</button>`);
  else if (st.byHand) right.push(html`<button type="button" class="linkbtn small" aria-label=${`Lock again: ${item.label}`} onClick=${() => update((s) => { setUnlocked(s.checklist, item, who, false); })}>Lock again</button>`);
  const chips = st.rows && !st.prompt && item.type !== 'link' ? st.rows : null;
  const label = st.prompt
    ? html`<span class="lbl"><a href=${item.href || '#bosses'}>${item.empty || item.label}</a></span>`
    : st.rows || (item.type && item.type !== 'check')
      ? html`<span class="lbl">${item.label}</span>`
      : html`<label class="lbl" for=${id}>${item.label}</label>`;
  return html`<div class=${cls}>
    ${left}${label}<div class="right">${right}</div>
    ${item.type === 'chips' ? html`<div class="chips">${item.chips.map(([cid, text], i) => html`<button type="button" class="chip" aria-pressed=${String(st.on[i])}
      onClick=${() => setRecord(recordKey(item, who, `_${cid}`), st.kind, { d: st.on[i] ? 0 : 1 })}>${text}</button>`)}</div>` : null}
    ${chips ? html`<div class="chips">${chips.map((r) => html`<button type="button" class="chip" id=${`${id}-${r.bossId}`} aria-pressed=${String(r.on)} disabled=${st.locked}
      onClick=${() => toggleClear(who.id, r.boss, r.line, !r.on)}>${r.boss.difficulty} ${r.boss.boss}</button>`)}</div>` : null}
    ${item.note && !st.prompt ? html`<p class="note">${item.note}</p>` : null}
    ${item.id === 'd-seal' && who.sealNote ? html`<p class="note">${who.sealNote()}</p>` : null}
  </div>`;
}

export function ChecklistPage({ data, state }) {
  // The current time at every draw (not a time kept from the last timer), so a tick made right after a reset
  // shows at once; redrawn at the reset itself, so yesterday's ticks clear the second it passes.
  const now = useClock({ every: 15000 });
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
        const items = listedItems(group, cs, now, who).map((item) => html`<${Item} key=${item.id} item=${item} group=${group} cs=${cs} now=${now} who=${who} />`);
        return html`<${Card} title=${group.title} meta=${group.hint} bodyClass="card-b tight">${items}<//>`;
      })}
    </div>
    <p class="note">${data.checklist.source}</p>`;
}
