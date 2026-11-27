// One-press ticks and shorter phone pages, mounted on Today, Checklist and Bosses:
// - "All done" on a checklist group and "All cleared" for this week's weekly bosses (both with Undo);
// - the streak as one line, the "Show notes" switch and the (i) behind each note, the folded season card.
import { html, useEffect, useState } from '../../vendor/htm-preact.mjs';
import { update, getState } from '../store.js';
import { Card, Left, plural } from '../ui.js';
import { fmtKst, kstDays, periodKey } from '../time.js';
import { bulkTargets, weeklyTargets, seasonFold, notesShown } from '../calc/daily.js';
import { seasonOutlook } from '../calc/season.js';
import { expiringSoon } from '../calc/seasoncount.js';
import { undoable } from '../undo.js';
import { toggleClear } from './bosses.js';
import { streakInfo } from './session.js';

// "All done": ticks every open plain row of one group for the character on screen, in one save (one Undo).
// The rows are worked out again from the saved state at the press, so a row ticked meanwhile is not touched.
export function AllDone({ group, items, cs, now, who, what }) {
  const targets = bulkTargets(group, items, cs, now, who);
  if (!targets.length) return null;
  const n = targets.length;
  const name = what || group.title;
  const press = () => undoable(`Ticked ${n} ${plural(n, 'row')}: ${name}`, () => update((s) => {
    const t = Date.now();
    for (const x of bulkTargets(group, items, s.checklist, t, who)) s.checklist.items[x.key] = { p: periodKey(x.kind, t), t, d: 1 };
  }));
  return html`<button type="button" class="btn sm bulk" aria-label=${`All done: tick the ${n} open ${plural(n, 'row')} of ${name}`} onClick=${press}>All done</button>`;
}

// "All cleared": this week's open weekly bosses, each through toggleClear so a difficulty that shares its clear
// with another moves the right tick. One Undo for all of them.
export function AllCleared({ char, lines, who }) {
  const targets = char ? weeklyTargets(lines, who) : [];
  if (!targets.length) return null;
  const n = targets.length;
  const press = () => undoable(`Cleared ${n} weekly ${plural(n, 'boss', 'bosses')}`, () => {
    for (const l of targets) toggleClear(char.id, l.boss, l, true);
  });
  return html`<button type="button" class="btn sm bulk" aria-label=${`All cleared: mark the ${n} open weekly ${plural(n, 'boss', 'bosses')} cleared this week`} onClick=${press}>All cleared</button>`;
}

// Checklist: the streak in one line at the top (the calendar sits under the lists).
export function StreakLine({ state, now }) {
  const { streak, best } = streakInfo(state.checklist.history || {}, now);
  return html`<span class="s">${streak ? `Streak ${streak} ${plural(streak, 'day')}` : 'No streak yet'} · best ${best} · calendar below</span>`;
}

const NARROW = '(max-width: 760px)';
function narrowQuery() {
  try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : null; } catch { return null; }
}
// Whether the screen is phone-sized (760px or less, where the bottom bar shows). Follows a rotated phone.
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => Boolean(narrowQuery()?.matches));
  useEffect(() => {
    const mq = narrowQuery();
    if (!mq) return undefined;
    const on = () => setNarrow(Boolean(mq.matches));
    on();
    if (typeof mq.addEventListener === 'function') { mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); }
    if (typeof mq.addListener === 'function') { mq.addListener(on); return () => mq.removeListener(on); }
    return undefined;
  }, []);
  return narrow;
}

// The "Show notes" switch. Kept on this device only (not synced). Until it is used, notes show on screens wider
// than 760px and sit behind an (i) on phones.
export function NotesToggle({ state }) {
  const narrow = useNarrow();
  const on = notesShown(state.ui, narrow);
  return html`<label class="toggle small notes-toggle"><input type="checkbox" id="show-notes" checked=${on}
    onChange=${(e) => { const v = e.currentTarget.checked; update((s) => { s.ui.showNotes = v; }); }} /> Show notes <span class="muted">(this device)</span></label>`;
}

// A checklist row's note: shown, or behind a small (i) that opens it in place.
export function RowNote({ note, label }) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  if (notesShown(getState().ui, narrow)) return html`<p class="note">${note}</p>`;
  return html`<button type="button" class="note-i" aria-expanded=${String(open)} aria-label=${`${open ? 'Hide' : 'Show'} the note: ${label}`} onClick=${() => setOpen(!open)}>i</button>${open ? html`<p class="note">${note}</p>` : null}`;
}

// Today: the Challenger season card, folded to one line (days left, next deadline) until 14 days before its first
// deadline. One press opens the whole card. `Full` is the whole card (Today's SeasonCard); `data`, `char` and
// `level` are passed on to it (its "Use it or lose it" list). The one line names the soonest thing that expires
// in the next 3 weeks, if any, so the fold never hides it.
export function SeasonFold({ Full, season, state, now, data, char, level }) {
  const [open, setOpen] = useState(false);
  const o = seasonOutlook(season, state.ui.seasonDone, now);
  const fold = open ? null : seasonFold(o, now);
  if (!fold) return html`<${Full} season=${season} state=${state} now=${now} data=${data} char=${char} level=${level} />`;
  const d = kstDays(now, o.ends);
  const exp = expiringLine(data, state, char, level, now);
  return html`<${Card} className="span2 season-mini" bodyClass="card-b">
    <p class="season-line"><b>${season.name}</b>: ${d} days left. Next deadline ${fmtKst(fold.at, false)} (<${Left} until=${fold.at} after=" left" done="passed" />, ${fold.open} ${plural(fold.open, 'step')} open).${exp ? ` ${exp}` : ''}${' '}
      <button type="button" class="linkbtn" aria-expanded="false" onClick=${() => setOpen(true)}>Show all ${o.total} steps</button></p>
  <//>`;
}

// "Expiring soon: X on 5 Dec (and 2 more)." for the folded season line, or null when nothing expires in 3 weeks.
export function expiringLine(data, state, char, level, now) {
  if (!data || !char) return null;
  let groups;
  try { groups = expiringSoon(data, state.shops, { level, challenger: Boolean(char.challenger), world: char.world || 'heroic' }, now); } catch { return null; }
  if (!groups || !groups.length) return null;
  const names = groups.flatMap((g) => [...g.hand.map((h) => h.label), ...g.picks.map((p) => p.item.name), ...g.shops.map((x) => `items from ${x.name}`)]);
  if (!names.length) return null;
  const more = names.length - 1;
  return `Expiring soon: ${names[0]} on ${fmtKst(groups[0].at, false)}${more ? ` (and ${more} more)` : ''}.`;
}
