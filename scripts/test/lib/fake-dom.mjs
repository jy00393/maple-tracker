// A very small stand-in for the browser, just enough for Preact to render the tracker's pages in Node.
// It has no layout and no real events: tests read the rendered text and call a node's click/input handler directly.
import { readFileSync } from 'node:fs';

export class FakeNode {
  constructor(type, text) {
    this.nodeType = text === undefined ? 1 : 3;
    this.localName = type;
    this.nodeName = type;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = {};
    this.style = { setProperty() {}, cssText: '' };
    this.data = text;
    this.l = {}; // Preact keeps its event handlers here
  }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
    return c;
  }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {}
  removeEventListener() {}
  focus() {}
  get text() {
    if (this.nodeType === 3) return String(this.data);
    const block = ['div', 'p', 'section', 'li', 'label', 'button', 'h2', 'h3', 'h4', 'summary', 'option', 'tr', 'td', 'th', 'span'].includes(this.localName);
    return this.childNodes.map((c) => c.text).join('') + (block ? ' ' : '');
  }
  // Depth-first search over element nodes.
  findAll(pred, out = []) {
    for (const c of this.childNodes) {
      if (c.nodeType !== 1) continue;
      if (pred(c)) out.push(c);
      c.findAll(pred, out);
    }
    return out;
  }
  find(pred) { return this.findAll(pred)[0] || null; }
  // Calls the handler Preact attached for an event ("click", "input", "change", "submit").
  fire(type, event = {}) {
    const key = Object.keys(this.l).find((k) => k.toLowerCase().startsWith(type));
    if (!key || typeof this.l[key] !== 'function') throw new Error(`no ${type} handler on <${this.localName}>`);
    return this.l[key]({ type, currentTarget: this, target: this, preventDefault() {}, stopPropagation() {}, ...event });
  }
}

// Installs the globals the app expects. `files` maps a fetch path suffix to a file on disk.
export function installFakeBrowser({ storage = [], files = {} } = {}) {
  const mem = new Map(storage);
  globalThis.document = {
    createElement: (t) => new FakeNode(t),
    createElementNS: (_, t) => new FakeNode(t),
    createTextNode: (t) => new FakeNode('#text', t),
    body: new FakeNode('body'),
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible'
  };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, matchMedia: null };
  globalThis.location = { href: 'https://example.test/maple-tracker/', origin: 'https://example.test', pathname: '/maple-tracker/', hash: '', search: '' };
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); }
  };
  globalThis.fetch = async (url) => {
    const hit = Object.keys(files).find((suffix) => String(url).endsWith(suffix));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const text = readFileSync(files[hit], 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  };
  return mem;
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
