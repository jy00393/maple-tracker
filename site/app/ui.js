import { html, useEffect, useRef, useState } from '../vendor/htm-preact.mjs';
import { fmtLeft } from './time.js';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// A countdown that keeps itself up to date, whatever its page does: every second while seconds show (under an
// hour), every 30 s otherwise.
// before / after: words printed around the time ("starts in ", " left"). done: what to show once the moment has
// passed, so the words and the number come from one clock (never "now left"). Without done it ends on "now".
export function Left({ until, before = '', after = '', done }) {
  const [, tick] = useState(0);
  const ms = until - Date.now();
  const step = ms < 3630000 ? 1000 : 30000;
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), step);
    return () => clearInterval(id);
  }, [step]);
  if (ms <= 0 && done !== undefined) return done;
  return before + fmtLeft(ms) + after;
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
export function NumberInput({ value, onChange, min = 0, max, step = 1, id, label, className = 'input num sm' }) {
  const box = useRef(null);
  // { text: what the box held after the last keystroke, after: the saved text on the first redraw that followed }
  const typed = useRef(null);
  const [, redraw] = useState(0);
  const saved = value === null || value === undefined ? '' : String(value);
  let shown = saved;
  const t = typed.current;
  if (t && box.current && box.current.value === t.text) {
    if (!('after' in t)) t.after = saved;
    if (t.after === saved) shown = t.text;
    else typed.current = null;
  } else typed.current = null;
  return html`<input ref=${box} id=${id} class=${className} type="number" inputmode=${Number.isInteger(step) ? 'numeric' : 'decimal'} min=${min} max=${max} step=${step}
    aria-label=${label} value=${shown}
    onBlur=${() => { if (typed.current) { typed.current = null; redraw((n) => n + 1); } }}
    onInput=${(e) => {
      const raw = e.currentTarget.value;
      typed.current = { text: raw };
      if (raw === '') return onChange(null);
      let n = Number(raw);
      if (!Number.isFinite(n)) return;
      if (max !== undefined) n = Math.min(max, n);
      n = Math.max(min, n);
      if (Number.isInteger(step)) n = Math.round(n);
      onChange(n);
    }} />`;
}

// A number box with − and + buttons, and optional one-tap presets ([value, text] pairs).
// Put it inside a <div class="field">, not a <label>: a click on a label would press the first button.
export function Stepper({ value, onChange, min = 0, max, label, presets }) {
  const v = Number(value) || 0;
  const clamp = (n) => Math.max(min, max !== undefined ? Math.min(max, n) : n);
  return html`<div class="stepper">
    <div class="stepper-row">
      <button type="button" class="iconbtn" aria-label=${'One fewer: ' + label} disabled=${v <= min} onClick=${() => onChange(clamp(v - 1))}>−</button>
      <${NumberInput} className="input num" label=${label} value=${value} min=${min} max=${max} onChange=${onChange} />
      <button type="button" class="iconbtn" aria-label=${'One more: ' + label} disabled=${max !== undefined && v >= max} onClick=${() => onChange(clamp(v + 1))}>+</button>
    </div>
    ${presets && presets.length ? html`<div class="stepper-presets">${presets.map(([n, text]) => html`<button type="button" class="chip" aria-pressed=${String(v === n)} onClick=${() => onChange(clamp(n))}>${text}</button>`)}</div>` : null}
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
export function Counter({ value, target, onChange, onStep, label }) {
  const step = (d) => (onStep ? onStep(d) : onChange(Math.max(0, Math.min(target, value + d))));
  return html`<div class="counter">
    <button type="button" class="iconbtn" aria-label=${'One fewer: ' + label} onClick=${() => step(-1)}>−</button>
    <span class=${'val' + (value >= target ? ' full' : '')} aria-live="polite">${value} / ${target}</span>
    <button type="button" class="iconbtn" aria-label=${'One more: ' + label} onClick=${() => step(1)}>+</button>
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

// The box shows the saved amount rounded ("45M"). Leaving it without typing changes nothing, so the exact number
// is never replaced by the rounded one. Text it can't read puts the saved amount back; an empty box clears it.
export function MesoInput({ value, onChange, label, placeholder = 'e.g. 1.5B' }) {
  const [text, setText] = useState(value ? fmtBig(value) : '');
  // Kept outside render state, so a blur right after typing (before a redraw) still sees the typing.
  const edited = useRef(false);
  useEffect(() => { setText(value ? fmtBig(value) : ''); edited.current = false; }, [value]);
  return html`<input class="input" inputmode="decimal" aria-label=${label} placeholder=${placeholder} value=${text}
    onInput=${(e) => { setText(e.currentTarget.value); edited.current = true; }}
    onBlur=${(e) => {
      if (!edited.current) return;
      edited.current = false;
      const raw = e.currentTarget.value;
      if (!String(raw).trim()) { onChange(null); setText(''); return; }
      // Typed back to exactly what was shown (the rounded "45M"): the exact saved amount stays.
      if (value && parseMesos(raw) === parseMesos(fmtBig(value))) { setText(fmtBig(value)); return; }
      const v = parseMesos(raw);
      if (v === null || v > MESO_MAX) { setText(value ? fmtBig(value) : ''); return; }
      onChange(v);
      setText(v ? fmtBig(v) : '');
    }} />`;
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
