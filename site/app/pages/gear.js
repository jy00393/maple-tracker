import { html, useState, useEffect } from '../../vendor/htm-preact.mjs';
import { searchItems, itemSlotKey, iconUrl, tierFromName } from '../calc/items.js';
import { lineChoices, makeLine, refreshLines } from '../calc/potential.js';
import { update, activeCharacter, charSlice } from '../store.js';
import { Card, PageHead, Bar, Seg, NumberInput, Empty, Modal, PotBadge, fmtBig } from '../ui.js';
import { gearSummary, gearProjection } from '../calc/progress.js';
import { maxStarsFor } from '../calc/starforce.js';
import { itemLevel, slotOutlook } from '../calc/advice.js';
import { cubePlan, lineOptions, defaultValue, lineTotals, lineLabel, lineKind, hasPotential, MAIN_STATS, LINE_TYPES } from '../calc/upgrades.js';
import { dayKey, fmtDate } from '../time.js';

export { itemLevel, slotOutlook };

const POT = ['None', 'Rare', 'Epic', 'Unique', 'Legendary'];
const GROUPS = [
  ['Weapon set', ['weapon', 'secondary', 'emblem']],
  ['Armor', ['hat', 'top', 'bottom', 'shoes', 'gloves', 'cape', 'shoulder']],
  ['Accessories', ['belt', 'pendant1', 'pendant2', 'earrings', 'face', 'eye', 'ring1', 'ring2', 'ring3', 'ring4']],
  ['Other', ['pocket', 'badge', 'heart']]
];

function blankGear() {
  return { preset: 'mid', slots: {}, history: [] };
}

function snapshot(g, gearData) {
  const sum = gearSummary(gearData, g);
  const today = dayKey(Date.now());
  g.history = (g.history || []).filter((h) => h.d !== today);
  g.history.push({ d: today, pct: Math.round(sum.overall * 1000) / 1000 });
  g.history.sort((a, b) => (a.d < b.d ? -1 : 1));
  if (g.history.length > 120) g.history = g.history.slice(-120);
}

function setSlot(charId, slotId, patch, gearData) {
  update((s) => {
    const g = charSlice(s, 'gear', charId, blankGear);
    g.slots[slotId] = { ...(g.slots[slotId] || {}), ...patch };
    snapshot(g, gearData);
  });
}

function clearSlot(charId, slotId, gearData) {
  update((s) => {
    const g = charSlice(s, 'gear', charId, blankGear);
    delete g.slots[slotId];
    snapshot(g, gearData);
  });
}

function Spark({ history }) {
  if (!history || history.length < 2) return null;
  const w = 300;
  const h = 48;
  const xs = history.map((_, i) => (i / (history.length - 1)) * (w - 8) + 4);
  const ys = history.map((p) => h - 6 - p.pct * (h - 12));
  const d = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const area = `${d} L${xs[xs.length - 1].toFixed(1)},${h - 4} L${xs[0].toFixed(1)},${h - 4} Z`;
  return html`<svg class="spark" viewBox=${`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Gear progress over time">
    <path d=${area} fill="rgba(254,172,66,.14)" /><path d=${d} fill="none" stroke="#FEAC42" stroke-width="2" />
    <circle cx=${xs[xs.length - 1]} cy=${ys[ys.length - 1]} r="3.5" fill="#FEAC42" />
  </svg>`;
}

// The item list is about 200 KB, so it loads the first time the Gear tab needs it and is then kept.
let itemsCache = null;
let itemsPromise = null;
function loadItems() {
  if (!itemsPromise) {
    itemsPromise = fetch('data/items.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { itemsCache = d && Array.isArray(d.items) ? d : { items: [], version: null }; return itemsCache; })
      .catch(() => { itemsCache = { items: [], version: null }; return itemsCache; });
  }
  return itemsPromise;
}
function useItems() {
  const [doc, setDoc] = useState(itemsCache);
  useEffect(() => { let on = true; loadItems().then((d) => { if (on) setDoc(d); }); return () => { on = false; }; }, []);
  return doc;
}

// Item picture from maplestory.io. Hidden if it fails to load, so a missing icon never breaks the tile.
function ItemIcon({ entry, size = 36 }) {
  const [failed, setFailed] = useState(null);
  const url = iconUrl(entry.iconVer, entry.itemId);
  if (!url || failed === url) return null;
  return html`<img class="item-icon" src=${url} alt="" width=${size} height=${size} loading="lazy" referrerpolicy="no-referrer" onError=${() => setFailed(url)} />`;
}

// Name box with suggestions from the item list for this slot. Picking one fills the name, level and picture.
function ItemPicker({ slot, entry, tiers, hints, set, pot }) {
  const doc = useItems();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const text = entry.note || '';
  const hits = open && doc ? searchItems(doc.items, itemSlotKey(slot.id), text, 8) : [];
  const pick = (h) => {
    const patch = { note: h.name, ilvl: h.level, itemId: h.id, iconVer: doc.version };
    if (entry.pot && Array.isArray(entry.potLines) && entry.potLines.length) patch.potLines = refreshLines(pot, slot.id, entry.pot, h.level, entry.potLines);
    const tier = tierFromName(h.name, tiers, hints);
    if (tier) patch.tier = tier;
    else if (!entry.tier) patch.tier = 1;
    set(patch);
    setOpen(false);
  };
  return html`<div class="field picker"><span>Item name${doc && doc.items.length ? ' · type to search' : ''}</span>
    <input class="input" role="combobox" aria-expanded=${String(hits.length > 0)} aria-controls="item-suggest" aria-autocomplete="list" autocomplete="off"
      value=${text} placeholder=${`e.g. ${slot.type === 'ring' ? 'Superior Gollux Ring' : 'Arcane Umbra'}`}
      onInput=${(e) => { set({ note: e.currentTarget.value, itemId: null, iconVer: null }); setOpen(true); setActive(0); }}
      onFocus=${() => setOpen(true)} onBlur=${() => setTimeout(() => setOpen(false), 150)}
      onKeyDown=${(e) => {
        if (!hits.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % hits.length); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + hits.length) % hits.length); }
        else if (e.key === 'Enter') { e.preventDefault(); pick(hits[active] || hits[0]); }
        else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
      }} />
    ${hits.length ? html`<ul class="suggest" id="item-suggest" role="listbox">${hits.map((h, i) => html`<li role="option" aria-selected=${String(i === active)}
      onMouseDown=${(e) => { e.preventDefault(); pick(h); }}><${ItemIcon} entry=${{ itemId: h.id, iconVer: doc.version }} size=${28} /><span>${h.name}</span><span class="muted small">Lv. ${h.level}</span></li>`)}</ul>` : null}
    ${open && doc && doc.items.length && text.trim().length >= 3 && !hits.length && !entry.itemId ? html`<span class="small muted">Not in the item list (GMS v.${doc.version} data). Your typed name is kept.</span>` : null}
  </div>`;
}

function LineEditor({ slot, entry, set, pot, mainStat }) {
  const tier = entry.pot || 0;
  if (!hasPotential(slot)) return html`<p class="note">This slot can't have potential.</p>`;
  if (!tier) return html`<p class="note">Pick a potential tier to add its lines.</p>`;
  const lines = Array.isArray(entry.potLines) ? entry.potLines : [];
  const lvl = itemLevel(slot, entry);
  const choices = lineChoices(pot, slot.id, tier, lvl);
  const prime = choices.filter((c) => c.prime);
  const nonPrime = choices.filter((c) => !c.prime);
  const keyOf = (c) => `${c.prime ? 'p' : 'n'}${c.pid}`;
  const setLine = (i, line) => {
    const next = [0, 1, 2].map((k) => lines[k] || { type: '' });
    next[i] = line || { type: '' };
    set({ potLines: next.some((l) => l && l.type) ? next : [] });
  };
  const group = (label, list) => (list.length ? html`<optgroup label=${label}>${list.map((c) => html`<option value=${keyOf(c)}>${c.text}</option>`)}</optgroup>` : null);
  return html`<div class="grid" style=${{ gap: '8px' }}>
    ${[0, 1, 2].map((i) => {
      const l = lines[i] || {};
      const fromTable = l.type && l.pid !== undefined && l.pid !== null;
      const current = fromTable ? choices.find((c) => c.pid === l.pid && c.prime === Boolean(l.prime)) : null;
      const legacy = l.type && !current;
      const kind = lineKind(slot, l);
      return html`<label class="field"><span>Potential line ${i + 1}${current ? (current.prime ? ' · prime' : ' · non-prime') : ''}${kind === 'farm' ? ' · farming' : kind === 'damage' ? ' · damage' : ''}</span>
        <select class="select pline-select" aria-label=${'Potential line ' + (i + 1)} value=${current ? keyOf(current) : legacy ? 'legacy' : ''} onChange=${(e) => {
          const v = e.currentTarget.value;
          if (!v) return setLine(i, null);
          if (v === 'legacy') return;
          const c = choices.find((x) => keyOf(x) === v);
          if (c) setLine(i, makeLine(pot, c, lvl));
        }}>
          <option value="">— none —</option>
          ${legacy ? html`<option value="legacy">${lineLabel(l, mainStat)} (entered earlier)</option>` : null}
          ${group(`Prime · ${POT[tier]}`, prime)}
          ${group(`Non-prime · ${POT[tier - 1] === 'None' ? 'Rare' : POT[tier - 1]}`, nonPrime)}
        </select></label>`;
    })}
    <p class="note">Lines and values for a Lv. ${lvl} ${slot.name.toLowerCase()} at ${POT[tier]}: prime lines are the item's own tier, non-prime lines come from the tier below. Useful lines are listed first. From StrategyWiki (2023), so a line added since may be missing.</p>
  </div>`;
}

function Outlook({ outlook, entry, target }) {
  if (!entry.tier) return null;
  if (outlook.temporary) return html`<div class="insight"><span class="k">Upgrade outlook</span><div class="small">This item expires, so put no mesos or cubes into it.</div></div>`;
  if (outlook.replace) return html`<div class="insight"><span class="k">Upgrade outlook</span><div class="small">The target for this slot is a better item, so replace this one rather than spending on it. To upgrade it anyway, lower the slot's target tier below.</div></div>`;
  if (!outlook.sf && !outlook.cube) return html`<div class="insight"><span class="k">Upgrade outlook</span><div class="small" style=${{ color: 'var(--ok)' }}>Stars and potential tier meet the target${target.lines > (entry.lines || 0) ? '; only lines are missing (GMS line odds aren’t published)' : ''}.</div></div>`;
  return html`<div class="insight">
    <span class="k">Upgrade outlook</span>
    ${outlook.sf ? html`<div>
      <div class="big accent">≈ ${fmtBig(outlook.sf.plain.cost)}</div>
      <div class="small">${outlook.sf.from}★ → ${outlook.sf.to}★ on average${outlook.sf.to < target.stars ? ` (this item caps at ${outlook.sf.max}★)` : ''}. ${outlook.sf.plain.booms < 0.005 ? 'No boom risk below 15★.' : `${Math.round(outlook.sf.plain.noBoom * 100)}% chance of no boom; about ${outlook.sf.plain.booms.toFixed(1)} booms expected.`}</div>
      <div class="small">Sunny Sunday (30% off, less boom): ≈ ${fmtBig(outlook.sf.sunny.cost)}</div>
    </div>` : null}
    ${outlook.cube ? html`<div>
      <div class="big">${Math.round(outlook.cube.bright.expected)} Bright cubes</div>
      <div class="small">${POT[Math.max(1, outlook.cube.from)]} → ${POT[outlook.cube.to]}: ≈ ${fmtBig(outlook.cube.bright.cost)}, or ${outlook.cube.bright.n90} cubes (${fmtBig(outlook.cube.bright.cost90)}) to be 90% sure. Glowing: ≈ ${fmtBig(outlook.cube.glowing.cost)}.</div>
    </div>` : null}
  </div>`;
}

function SlotModal({ row, data, char, onClose }) {
  const { slot, entry, target } = row;
  const up = data.upgrades;
  const tiers = data.gear.slotTypes[slot.type].filter(Boolean);
  const set = (patch) => setSlot(char.id, slot.id, patch, data.gear);
  const setTarget = (patch) => set({ target: { ...(entry.target || {}), ...patch } });
  const mainStat = char.mainStat || 'STR';
  const outlook = slotOutlook(slot, entry, target, up);
  const lines = (entry.potLines || []).filter((l) => l && l.type);
  const lvl = itemLevel(slot, entry);
  const max = slot.sf ? maxStarsFor(up.starforce, lvl) : 0;
  const heroic = char.world !== 'interactive';
  return html`<${Modal} title=${`${slot.name}${entry.note ? ': ' + entry.note : ''}`} onClose=${onClose}
    footer=${html`<button type="button" class="btn danger" onClick=${() => { clearSlot(char.id, slot.id, data.gear); onClose(); }}>Clear slot</button>
      <button type="button" class="btn primary" onClick=${onClose}>Done</button>`}>
    <div class="modal-b">
      <div class="grid" style=${{ gap: '12px' }}>
        <div class="item-card">
          <div class="item-pic"><${ItemIcon} entry=${entry} size=${56} /></div>
          <div class="title">${entry.note || tiers[(entry.tier || 0) - 1] || 'Empty slot'}</div>
          <div class="small muted" style=${{ textAlign: 'center' }}>${slot.name} · Lv. ${lvl}${entry.temporary ? html` · <span class="flag">expires</span>` : ''}</div>
          ${slot.sf ? html`<div style=${{ textAlign: 'center' }}><span class="stars">★ ${entry.stars || 0}</span><span class="muted small"> / ${max}</span></div>` : null}
          <hr />
          ${entry.pot ? html`<div class=${'pot-' + entry.pot} style=${{ fontWeight: 700 }}><${PotBadge} tier=${entry.pot} /> Potential: ${POT[entry.pot]}</div>
            ${lines.length ? lines.map((l) => html`<div class=${'pot-line' + (lineKind(slot, l) === 'farm' ? ' pot-4' : '')}>${lineLabel(l, mainStat)}</div>`) : html`<div class="small muted">No lines entered yet.</div>`}`
            : html`<div class="small muted">${hasPotential(slot) ? 'No potential' : 'No potential on this slot'}</div>`}
        </div>
        <${Outlook} outlook=${outlook} entry=${entry} target=${target} />
      </div>
      <div class="grid" style=${{ gap: '14px' }}>
        <${ItemPicker} slot=${slot} entry=${entry} tiers=${tiers} hints=${data.gear.tierHints} set=${set} pot=${data.potential} />
        <div class="form-grid">
          <label class="field"><span>Item tier</span>
            <select class="select" value=${String(entry.tier || 0)} onChange=${(e) => set({ tier: Number(e.currentTarget.value) })}>
              <option value="0">Empty</option>
              ${tiers.map((t, i) => html`<option value=${i + 1}>${t}</option>`)}
            </select></label>
          <label class="field"><span>Item level</span><${NumberInput} className="input" label="Item level" value=${lvl} min=${0} max=${300} onChange=${(v) => set({ ilvl: v || null, ...(entry.pot && (entry.potLines || []).length ? { potLines: refreshLines(data.potential, slot.id, entry.pot, itemLevel(slot, { ...entry, ilvl: v || null }), entry.potLines) } : {}) })} /></label>
          ${slot.sf ? html`<label class="field"><span>Stars (max ${max})</span><${NumberInput} className="input" label=${slot.name + ' stars'} value=${entry.stars || 0} max=${max || 30} onChange=${(v) => set({ stars: v || 0 })} /></label>` : null}
          ${hasPotential(slot) ? html`<label class="field"><span>Potential tier</span>
            <select class=${'select pot-' + (entry.pot || 0)} value=${String(entry.pot || 0)} onChange=${(e) => {
              const pot = Number(e.currentTarget.value);
              const kept = refreshLines(data.potential, slot.id, pot, lvl, entry.potLines).map((l) => (l.type && (l.pid === undefined || l.pid === null) ? { type: '' } : l));
              set({ pot, potLines: pot && kept.some((l) => l.type) ? kept : [] });
            }}>${POT.map((p, i) => html`<option value=${i}>${p}</option>`)}</select></label>` : null}
          ${!heroic && hasPotential(slot) ? html`<label class="field"><span>Bonus potential</span>
            <select class="select" value=${String(entry.bpot || 0)} onChange=${(e) => set({ bpot: Number(e.currentTarget.value) })}>${POT.map((p, i) => html`<option value=${i}>${p}</option>`)}</select></label>` : null}
        </div>
        <${LineEditor} slot=${slot} entry=${entry} set=${set} pot=${data.potential} mainStat=${mainStat} />
        <label class="toggle"><input type="checkbox" checked=${Boolean(entry.temporary)} onChange=${(e) => set({ temporary: e.currentTarget.checked })} /> Temporary item (Item Burning, event or rental)</label>
        <details>
          <summary class="small muted">Target for this slot: ${tiers[target.tier - 1] || 'tier ' + target.tier}${target.stars ? `, ${target.stars}★` : ''}${hasPotential(slot) ? `, ${POT[target.pot]} with ${target.lines} useful lines` : ''}. Change</summary>
          <div class="form-grid" style=${{ marginTop: '10px' }}>
            <label class="field"><span>Target tier</span><select class="select" value=${String(target.tier)} onChange=${(e) => setTarget({ tier: Number(e.currentTarget.value) })}>${tiers.map((t, i) => html`<option value=${i + 1}>${t}</option>`)}</select></label>
            ${slot.sf ? html`<label class="field"><span>Target stars</span><${NumberInput} className="input" label="Target stars" value=${target.stars} max=${30} onChange=${(v) => setTarget({ stars: v || 0 })} /></label>` : null}
            ${hasPotential(slot) ? html`<label class="field"><span>Target potential</span><select class="select" value=${String(target.pot)} onChange=${(e) => setTarget({ pot: Number(e.currentTarget.value) })}>${POT.map((p, i) => html`<option value=${i}>${p}</option>`)}</select></label>
            <label class="field"><span>Target useful lines</span><${NumberInput} className="input" label="Target lines" value=${target.lines} max=${3} onChange=${(v) => setTarget({ lines: v || 0 })} /></label>` : null}
            <button type="button" class="btn ghost" onClick=${() => set({ target: {} })}>Use the preset</button>
          </div>
        </details>
      </div>
    </div>
  <//>`;
}

function EquipTile({ row, data, mainStat, onOpen }) {
  const { slot, entry } = row;
  const tiers = data.gear.slotTypes[slot.type].filter(Boolean);
  const lines = (entry.potLines || []).filter((l) => l && l.type);
  const empty = !entry.tier;
  return html`<button type="button" class=${'equip' + (empty ? ' empty' : '') + (entry.pot ? ' pot-' + entry.pot : '')} onClick=${onOpen} aria-label=${`${slot.name}: edit`}>
    <span class="nm"><span>${slot.name}</span><${PotBadge} tier=${entry.pot} /></span>
    <span class="it">${empty ? null : html`<${ItemIcon} entry=${entry} size=${28} />`}${empty ? 'Empty' : entry.note || tiers[entry.tier - 1]}</span>
    ${empty ? html`<span class="ln">Tap to add</span>` : lines.length
      ? html`<span class="ln">${lines.slice(0, 3).map((l, i) => html`${i ? html`<br />` : ''}<span class=${lineKind(slot, l) === 'farm' ? 'pot-4' : ''}>${lineLabel(l, mainStat)}</span>`)}</span>`
      : html`<span class="ln muted">${entry.pot ? `${POT[entry.pot]}, lines not entered` : hasPotential(slot) ? 'No potential' : ''}</span>`}
    <span class="foot">${slot.sf && !empty ? html`<span class="stars">★${entry.stars || 0}</span>` : html`<span></span>`}
      ${entry.temporary ? html`<span class="flag">expires</span>` : html`<span class="muted">${Math.round(row.pct * 100)}%</span>`}</span>
  </button>`;
}

export function GearPage({ data, state }) {
  const char = activeCharacter(state);
  const [open, setOpen] = useState(null);
  if (!char) return html`<${PageHead} title="Gear" /><${Card} title="Add a character first"><p class="note"><a href="#characters">Add your character</a> to track gear.</p><//>`;
  const g = state.gear[char.id] || blankGear();
  const sum = gearSummary(data.gear, g);
  const proj = gearProjection(g.history, sum.overall);
  const mainStat = char.mainStat || 'STR';
  const totals = lineTotals(data.gear.slots, g, mainStat);
  const byId = Object.fromEntries(sum.slots.map((r) => [r.slot.id, r]));
  const openRow = open ? byId[open] : null;
  const next = sum.gaps.filter((r) => !r.entry.temporary).slice(0, 6).map((r) => ({ row: r, outlook: slotOutlook(r.slot, r.entry, r.target, data.upgrades) }));
  return html`
    <${PageHead} title="Gear">${char.name}: tap a slot to edit it. Each slot is scored against the target, with the expected mesos to get there.<//>
    <div class="toolbar">
      <span class="small muted">Target</span>
      <${Seg} label="Gear target" value=${g.preset || 'mid'} onChange=${(v) => update((s) => { const x = charSlice(s, 'gear', char.id, blankGear); x.preset = v; snapshot(x, data.gear); })}
        options=${Object.entries(data.gear.presets).map(([id, p]) => [id, p.name])} />
    </div>
    <div class="tiles">
      <div class="tile"><span class="k">Overall vs ${sum.preset.name}</span><span class="v">${Math.round(sum.overall * 100)}%</span><${Bar} pct=${sum.overall} big /></div>
      <div class="tile"><span class="k">${mainStat} % from potential</span><span class="v">${totals.main}%</span><span class="s">${totals.damageLines} damage lines${totals.boss ? ` · Boss +${totals.boss}%` : ''}${totals.ied ? ` · IED ${totals.ied}%` : ''}</span></div>
      <div class="tile ok"><span class="k">Farming lines</span><span class="v">${totals.meso}% · ${totals.drop}%</span><span class="s">Meso obtained · Item drop rate</span></div>
      <div class="tile"><span class="k">Pace</span><span class="v">${proj ? `${(proj.perWeek * 100).toFixed(1)} pts/wk` : '—'}</span>
        <span class="s">${proj ? (proj.eta ? `100% around ${fmtDate(proj.eta)}` : 'no progress in the saved history yet') : 'shows after a few days of edits'}</span><${Spark} history=${g.history} /></div>
    </div>
    <div class="grid wide-left">
      <${Card} title="Equipment" meta=${`${sum.temporary.length} expiring item${sum.temporary.length === 1 ? '' : 's'}`}>
        ${GROUPS.map(([label, ids]) => html`<div class="grid" style=${{ gap: '8px' }}>
          <div class="group-h" style=${{ padding: '4px 2px 0' }}><h4>${label}</h4></div>
          <div class="equip-grid">${ids.filter((id) => byId[id]).map((id) => html`<${EquipTile} key=${id} row=${byId[id]} data=${data} mainStat=${mainStat} onOpen=${() => setOpen(id)} />`)}</div>
        </div>`)}
      <//>
      <${Card} title="What to upgrade next" meta="Biggest weighted gaps, permanent items">
        ${next.length ? next.map(({ row, outlook }) => html`<div class="insight" style=${{ cursor: 'pointer' }} onClick=${() => setOpen(row.slot.id)}>
          <div style=${{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}><b>${row.slot.name}</b><span class="muted small">${Math.round(row.pct * 100)}%</span></div>
          <div class="small">${row.gaps.join(', ')}</div>
          ${outlook.replace ? html`<div class="small">Replace with a better item rather than upgrading this one.</div>` : null}
          ${outlook.sf ? html`<div class="small">Star Force ${outlook.sf.from}→${outlook.sf.to}★: <b>≈ ${fmtBig(outlook.sf.plain.cost)}</b> (Sunny Sunday ≈ ${fmtBig(outlook.sf.sunny.cost)})</div>` : null}
          ${outlook.cube ? html`<div class="small">Cubes to ${POT[outlook.cube.to]}: <b>≈ ${fmtBig(outlook.cube.bright.cost)}</b> (${Math.round(outlook.cube.bright.expected)} Bright)</div>` : null}
        </div>`) : html`<${Empty}>Every permanent slot meets the target. Raise the target to keep going.<//>`}
        <p class="note">${data.gear.note} Star Force and cube figures are expected values from the GMS v.272 tables (cube tier-up odds are community estimates).</p>
      <//>
    </div>
    ${openRow ? html`<${SlotModal} row=${openRow} data=${data} char=${char} onClose=${() => setOpen(null)} />` : null}`;
}
