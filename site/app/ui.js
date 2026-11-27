import { html, useEffect, useRef, useState } from '../vendor/htm-preact.mjs';
import { fmtLeft, nextReset } from './time.js';
import { plural } from './calc/plural.js';

export { plural };

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ---- Clocks -------------------------------------------------------------------------------------------------
// Everything on screen that depends on the time is redrawn by one of three pieces: useClock (a page or a bar),
// Left (a countdown) and Ago (an age). They aim their timers at the moment the text changes, so nothing is
// "up to 30 s behind", and they wake each other: when a countdown ends, every page clock redraws at once.
const wakers = new Set();

// Redraws every component that uses useClock, now.
export function wakePages() {
  [...wakers].forEach((fn) => fn());
}

// A tab that comes back to the front (a phone woken up, a laptop opened) redraws at once: its timers may have
// been asleep across a reset.
let watching = null;
function watchVisibility() {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || watching === doc || typeof doc.addEventListener !== 'function') return;
  watching = doc;
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') wakePages(); });
}

// The longest wait a browser timer takes (about 24.8 days).
const TIMER_MAX = 2147483647;

// The time for this draw, and a redraw:
// - on every round `every` ms of the clock (30 s by default: 09:00:00, 09:00:30, ...),
// - at the next reset, to the millisecond (daily 00:00 UTC, which is also when the weekly and monthly ones fall),
// - when a countdown on screen (Left) ends,
// - when the tab comes back to the front.
// Each draw reads the clock afresh, so a redraw for any other reason (a tick being saved) is up to date too.
export function useClock({ every = 30000 } = {}) {
  const [, tick] = useState(0);
  useEffect(() => {
    let id = null;
    const arm = () => {
      const now = Date.now();
      const wait = Math.min(every - (now % every), nextReset('daily', now) - now, TIMER_MAX);
      // A timer can fire a moment early; aiming again from the clock each time makes the next one land.
      id = setTimeout(() => { tick((n) => n + 1); arm(); }, Math.max(1, wait));
    };
    arm();
    const wake = () => tick((n) => n + 1);
    wakers.add(wake);
    watchVisibility();
    return () => { clearTimeout(id); wakers.delete(wake); };
  }, [every]);
  return Date.now();
}

const HOUR_MS = 3600000;

// A countdown that keeps itself up to date, whatever its page does. It redraws exactly when its text changes:
// every second while seconds show (under an hour), every minute otherwise.
// before / after: words printed around the time ("starts in ", " left"), so the words and the number come from
// one clock. done: what to show once the moment has passed; without it the countdown disappears. It never reads
// "in now" or "now left". The moment it ends, the pages redraw (wakePages), so what hung on it moves on too.
export function Left({ until, before = '', after = '', done = null }) {
  const [, tick] = useState(0);
  // Whether the last draw still showed a running countdown.
  const running = useRef(false);
  useEffect(() => {
    if (!Number.isFinite(until)) return undefined;
    if (until <= Date.now()) {
      // It ended between the draw and this moment: draw the ending, as the timer would have.
      if (running.current) { tick((n) => n + 1); wakePages(); }
      return undefined;
    }
    let id = null;
    const arm = () => {
      const left = until - Date.now();
      if (left <= 0) { id = null; wakePages(); return; }
      const unit = left >= HOUR_MS ? 60000 : 1000;
      // The text changes when the time left drops below a whole unit; in the last second, when it runs out.
      id = setTimeout(() => { tick((n) => n + 1); arm(); }, left < 1000 ? left : (left % unit) + 1);
    };
    arm();
    return () => clearTimeout(id);
  }, [until]);
  const ms = until - Date.now();
  running.current = ms > 0;
  if (ms <= 0) return done;
  return before + fmtLeft(ms) + after;
}

// How long ago something happened ("9m 50s", "1h 05m", "2d 3h"), counting up by itself: every second while
// seconds show, every minute after that.
export function Ago({ since }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(since)) return undefined;
    let id = null;
    const arm = () => {
      const age = Math.max(0, Date.now() - since);
      const unit = age >= HOUR_MS ? 60000 : 1000;
      id = setTimeout(() => { tick((n) => n + 1); arm(); }, unit - (age % unit));
    };
    arm();
    return () => clearTimeout(id);
  }, [since]);
  const age = Date.now() - since;
  if (!Number.isFinite(age)) return '—';
  return age < 1000 ? 'a moment' : fmtLeft(age);
}

export function Card({ title, meta, children, className = '', bodyClass = 'card-b' }) {
  return html`<section class=${'card ' + className}>
    ${title || meta ? html`<div class="card-h"><h3>${title}</h3>${meta ? html`<span class="meta">${meta}</span>` : null}</div>` : null}
    <div class=${bodyClass}>${children}</div>
  </section>`;
}

export function Tile({ k, v, s, accent, children }) {
  return html`<div class=${'tile' + (accent ? ' accent' : '')}>
    <span class="k">${k}</span><span class="v">${v}</span>${s ? html`<span class="s">${s}</span>` : null}${children}
  </div>`;
}

export function Bar({ pct, big }) {
  const p = Math.max(0, Math.min(1, pct || 0));
  return html`<div class=${'bar' + (p >= 1 ? ' ok' : '') + (big ? ' big' : '')} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(p * 100)}>
    <i style=${{ width: p * 100 + '%' }}></i>
  </div>`;
}

export function PageHead({ title, children }) {
  return html`<div class="page-head"><h2>${title}</h2>${children ? html`<p>${children}</p>` : null}</div>`;
}

export function Seg({ options, value, onChange, label }) {
  return html`<div class="seg" role="group" aria-label=${label}>
    ${options.map(([v, text]) => html`<button type="button" aria-pressed=${String(v === value)} onClick=${() => onChange(v)}>${text}</button>`)}
  </div>`;
}

// Saves on every keystroke. The text being typed is left alone until the box is left or the saved number changes
// some other way (a − / + button, another device). Rewriting it from the saved number on every redraw turned a
// half-typed "0.0" into "0", so 0.05 could not be typed.
// `rev`: the owner changes it when a button of its own sets the value (a preset, a reset). The typed text is then
// dropped even if the saved number did not change, which is the one outside change the box cannot see by itself.
// `clamp=${false}`: a number outside min..max is passed on as typed, so the owner can ignore it instead of saving
// the nearest limit (250 typed for 25 must not become 100).
export function NumberInput({ value, onChange, min = 0, max, step = 1, id, label, className = 'input num sm', clamp = true, rev }) {
  const box = useRef(null);
  // While typing: { text: what the box held after the last keystroke, ok: every saved text this typing can explain
  // (the one from before it began, and each number sent since), blank: an emptied box was sent and the owner's
  // answer to that (often 0) has not been seen yet }. A saved text outside `ok` came from somewhere else. None of
  // this depends on which redraw arrives first, the box's own or the one after the save.
  const typed = useRef(null);
  const [, redraw] = useState(0);
  const saved = value === null || value === undefined ? '' : String(value);
  let shown = saved;
  const seenRev = useRef(rev);
  if (seenRev.current !== rev) { seenRev.current = rev; typed.current = null; }
  const t = typed.current;
  if (t && !t.ok.has(saved) && t.blank) { t.blank = false; t.ok.add(saved); }
  if (t && box.current && box.current.value === t.text && t.ok.has(saved)) shown = t.text;
  else typed.current = null;
  return html`<input ref=${box} id=${id} class=${className} type="number" inputmode=${Number.isInteger(step) ? 'numeric' : 'decimal'} min=${min} max=${max} step=${step}
    aria-label=${label} value=${shown}
    onBlur=${() => { if (typed.current) { typed.current = null; redraw((n) => n + 1); } }}
    onInput=${(e) => {
      const raw = e.currentTarget.value;
      const was = typed.current;
      const ok = was ? was.ok : new Set([saved]);
      typed.current = { text: raw, ok, blank: Boolean(was && was.blank) };
      if (raw === '') { ok.add(''); typed.current.blank = true; return onChange(null); }
      let n = Number(raw);
      if (!Number.isFinite(n)) return;
      if (clamp) {
        if (max !== undefined) n = Math.min(max, n);
        n = Math.max(min, n);
      }
      if (Number.isInteger(step)) n = Math.round(n);
      ok.add(String(n));
      onChange(n);
    }} />`;
}

// A number box with − and + buttons, and optional one-tap presets ([value, text] pairs).
// Put it inside a <div class="field">, not a <label>: a click on a label would press the first button.
export function Stepper({ value, onChange, min = 0, max, label, presets }) {
  const v = Number(value) || 0;
  const clamp = (n) => Math.max(min, max !== undefined ? Math.min(max, n) : n);
  // A button press always replaces what was typed, also when it lands on the number already saved
  // (99 typed with a 30 cap saves 30; pressing "Max 30" must then show 30, not 99).
  const [rev, setRev] = useState(0);
  const press = (n) => { setRev((r) => r + 1); onChange(clamp(n)); };
  return html`<div class="stepper">
    <div class="stepper-row">
      <button type="button" class="iconbtn" aria-label=${'One fewer: ' + label} disabled=${v <= min} onClick=${() => press(v - 1)}>−</button>
      <${NumberInput} className="input num" label=${label} value=${value} min=${min} max=${max} rev=${rev} onChange=${onChange} />
      <button type="button" class="iconbtn" aria-label=${'One more: ' + label} disabled=${max !== undefined && v >= max} onClick=${() => press(v + 1)}>+</button>
    </div>
    ${presets && presets.length ? html`<div class="stepper-presets">${presets.map(([n, text]) => html`<button type="button" class="chip" aria-pressed=${String(v === n)} onClick=${() => press(n)}>${text}</button>`)}</div>` : null}
  </div>`;
}

// A card that starts closed. For sections you rarely change; the title and meta stay visible.
export function Fold({ title, meta, children, className = '', bodyClass = 'card-b' }) {
  return html`<details class=${'card fold ' + className}>
    <summary class="card-h"><h3>${title}</h3>${meta ? html`<span class="meta">${meta}</span>` : null}</summary>
    <div class=${bodyClass}>${children}</div>
  </details>`;
}

// With `onStep` the buttons report -1 or +1 and the owner applies it to the value that is current at the
// click (the drawn value can be a few seconds old). Without it they report the new value through `onChange`.
// At a limit a button is greyed and marked aria-disabled, not truly disabled: a press still reaches the owner, who
// decides from the current value (so a count drawn just before a reset can never lock the + button), and the
// keyboard focus stays on the button.
// `disabled`: the item is locked (level or quest); the count is shown and cannot be changed.
export function Counter({ value, target, onChange, onStep, label, disabled }) {
  const step = (d) => { if (disabled) return; if (onStep) onStep(d); else onChange(Math.max(0, Math.min(target, value + d))); };
  return html`<div class="counter">
    <button type="button" class="iconbtn" aria-label=${'One fewer: ' + label} aria-disabled=${String(Boolean(disabled) || value <= 0)} disabled=${Boolean(disabled)} onClick=${() => step(-1)}>−</button>
    <span class=${'val' + (value >= target ? ' full' : '')} aria-live="polite">${value} / ${target}</span>
    <button type="button" class="iconbtn" aria-label=${'One more: ' + label} aria-disabled=${String(Boolean(disabled) || value >= target)} disabled=${Boolean(disabled)} onClick=${() => step(1)}>+</button>
  </div>`;
}

export function Empty({ children }) {
  return html`<p class="note">${children}</p>`;
}

export function Logo() {
  return html`<span class="logo" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="#2A1704" d="M12 2.2l2.1 4.4 3.6-2-.6 4.1 4.4.9-3.3 2.8 2.6 3.4-4.3.2.5 4.3L12 18l-5 2.3.5-4.3-4.3-.2 2.6-3.4-3.3-2.8 4.4-.9-.6-4.1 3.6 2z"/><path stroke="#2A1704" stroke-width="1.6" stroke-linecap="round" d="M12 13v9"/></svg></span>`;
}

const POT_LETTER = ['', 'R', 'E', 'U', 'L'];
export function PotBadge({ tier }) {
  if (!tier) return null;
  return html`<span class=${'potb pot-' + tier} title=${['', 'Rare', 'Epic', 'Unique', 'Legendary'][tier]}>${POT_LETTER[tier]}</span>`;
}

// Centered dialog. Escape or a click on the backdrop closes it.
export function Modal({ title, onClose, children, footer, label }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, []);
  return html`<div class="modal-back" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="modal" role="dialog" aria-modal="true" aria-label=${label || title}>
      <div class="modal-h"><h3>${title}</h3><button type="button" class="iconbtn" aria-label="Close" onClick=${onClose}>×</button></div>
      ${children}
      ${footer ? html`<div class="modal-f">${footer}</div>` : null}
    </div>
  </div>`;
}

export function fmtBig(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  // The unit is picked after rounding, so 999,999 reads 1M, not 1000K.
  if (a >= 999.95e9) return (n / 1e12).toFixed(a >= 1e13 ? 1 : 2).replace(/\.0+$/, '') + 'T';
  if (a >= 999.5e6) return (n / 1e9).toFixed(a >= 1e10 ? 1 : 2).replace(/\.0+$/, '') + 'B';
  if (a >= 999.5e3) return (n / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 999.5) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}

// Form fields kept in one object. `set` merges a patch; `latest()` returns the fields including a patch made earlier
// in the same event, before any redraw. A form's submit reads `latest()`: Enter in a box saves that box and submits
// the form in one go, and the submit must not miss what was just typed.
export function useFields(initial) {
  const [f, setF] = useState(initial);
  const ref = useRef(f);
  const set = (patch) => { ref.current = { ...ref.current, ...patch }; setF(ref.current); };
  return [f, set, () => ref.current];
}

// The box shows the saved amount rounded ("45M"). Leaving it without typing changes nothing, so the exact number
// is never replaced by the rounded one. Text it can't read puts the saved amount back; an empty box clears it.
// Typing is saved when the box is left and when Enter is pressed (Enter never leaves the box, and inside a form it
// submits at once). Phones get the full keyboard, because amounts are typed with a unit and a dot ("45M", "1.5B").
// `emptyShows`: the figure the owner falls back to when the box is emptied (shown again then); 0 leaves it empty.
export function MesoInput({ value, onChange, onConfirm, label, placeholder = 'e.g. 1.5B', emptyShows = 0 }) {
  const [text, setText] = useState(value ? fmtBig(value) : '');
  // Kept outside render state, so a blur right after typing (before a redraw) still sees the typing.
  const edited = useRef(false);
  useEffect(() => { setText(value ? fmtBig(value) : ''); edited.current = false; }, [value]);
  // Saves once per edit: after Enter, the blur that follows finds nothing new.
  const commit = (raw) => {
    if (!edited.current) return;
    edited.current = false;
    if (!String(raw).trim()) { onChange(null); setText(emptyShows ? fmtBig(emptyShows) : ''); return; }
    // Typed back to exactly what was shown (the rounded "45M"): the exact saved amount stays.
    // `onConfirm`: the owner may note that the amount was looked at again (its "as of" day).
    if (value && parseMesos(raw) === parseMesos(fmtBig(value))) { setText(fmtBig(value)); if (onConfirm) onConfirm(); return; }
    const v = parseMesos(raw);
    if (v === null || v > MESO_MAX) { setText(value ? fmtBig(value) : ''); return; }
    onChange(v);
    setText(v ? fmtBig(v) : '');
  };
  return html`<input class="input" type="text" inputmode="text" enterkeyhint="done" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck=${false}
    aria-label=${label} placeholder=${placeholder} value=${text}
    onInput=${(e) => { setText(e.currentTarget.value); edited.current = true; }}
    onKeyDown=${(e) => { if (e.key === 'Enter' && !e.isComposing) commit(e.currentTarget.value); }}
    onChange=${(e) => commit(e.currentTarget.value)}
    onBlur=${(e) => commit(e.currentTarget.value)} />`;
}

// The largest amount the tracker keeps (saved data is cleaned to this on load).
export const MESO_MAX = 1e15;

// "1.5b", "450m", "2,000,000", "300k", ".5b", "5.", "1.5 billion" -> mesos. null when it can't be read.
export function parseMesos(text) {
  let t = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  // Commas: thousands separators ("2,000,000") are dropped; a single comma before one or two digits is a decimal
  // comma ("3,2b" is 3.2B, not 32B); anything else is not read at all.
  if (t.includes(',')) {
    if (/^\d{1,3}(,\d{3})+(\.\d*)?[a-z]*$/.test(t)) t = t.replace(/,/g, '');
    else if (/^\d+,\d{1,2}[a-z]*$/.test(t)) t = t.replace(',', '.');
    else return null;
  }
  const m = /^(\d+(?:\.\d*)?|\.\d+)(k|m|b|t|thousand|million|billion|trillion)?$/.exec(t);
  if (!m) return null;
  // A fraction with no unit ("1.5", "0.4") is not a meso amount: refused, not rounded to 2 or 0 mesos.
  if (!m[2] && !Number.isInteger(parseFloat(m[1]))) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 }[m[2]] || 1;
  const v = Math.round(parseFloat(m[1]) * mult);
  return Number.isFinite(v) ? v : null;
}
