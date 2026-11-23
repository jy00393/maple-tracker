import { html, useEffect, useState } from '../vendor/htm-preact.mjs';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
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

export function NumberInput({ value, onChange, min = 0, max, step = 1, id, label, className = 'input num sm' }) {
  return html`<input id=${id} class=${className} type="number" inputmode="numeric" min=${min} max=${max} step=${step}
    aria-label=${label} value=${value ?? ''}
    onInput=${(e) => {
      const raw = e.currentTarget.value;
      if (raw === '') return onChange(null);
      let n = Number(raw);
      if (!Number.isFinite(n)) return;
      if (max !== undefined) n = Math.min(max, n);
      n = Math.max(min, n);
      onChange(n);
    }} />`;
}

export function Counter({ value, target, onChange, label }) {
  return html`<div class="counter">
    <button type="button" class="iconbtn" aria-label=${'One fewer: ' + label} onClick=${() => onChange(Math.max(0, value - 1))}>−</button>
    <span class=${'val' + (value >= target ? ' full' : '')} aria-live="polite">${value} / ${target}</span>
    <button type="button" class="iconbtn" aria-label=${'One more: ' + label} onClick=${() => onChange(Math.min(target, value + 1))}>+</button>
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
  if (a >= 1e12) return (n / 1e12).toFixed(a >= 1e13 ? 1 : 2).replace(/\.0+$/, '') + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 1 : 2).replace(/\.0+$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}

export function MesoInput({ value, onChange, label, placeholder = 'e.g. 1.5B' }) {
  const [text, setText] = useState(value ? fmtBig(value) : '');
  useEffect(() => { setText(value ? fmtBig(value) : ''); }, [value]);
  return html`<input class="input" inputmode="decimal" aria-label=${label} placeholder=${placeholder} value=${text}
    onInput=${(e) => setText(e.currentTarget.value)}
    onBlur=${() => { const v = parseMesos(text); onChange(v); setText(v ? fmtBig(v) : ''); }} />`;
}

// "1.5b", "450m", "2,000,000", "300k" -> mesos
export function parseMesos(text) {
  const t = String(text || '').trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
  if (!t) return null;
  const m = /^(\d+(?:\.\d+)?)([kmbt])?$/.exec(t);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2]] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}
