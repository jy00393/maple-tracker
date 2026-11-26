import { html, useState, useEffect } from '../../vendor/htm-preact.mjs';
import { searchItems, itemSlotKey, iconUrl, tierFromName, exactItem, isOverall } from '../calc/items.js';
import { lineChoices, makeLine, refreshLines } from '../calc/potential.js';
import { FLAME_FIELDS, cleanFlame, flameLabel, flameTotals, starStats, detectSets, setBonusLabel, STAT_FIELDS } from '../calc/gearstats.js';
import { upgradeOptions } from '../calc/advice.js';
import { update, activeCharacter, charSlice } from '../store.js';
import { Card, Fold, PageHead, Bar, Seg, NumberInput, Stepper, Empty, Modal, PotBadge, fmtBig, plural } from '../ui.js';
import { gearSummary, gearProjection, historyFor } from '../calc/progress.js';
import { maxStarsFor } from '../calc/starforce.js';
import { itemLevel, slotOutlook, withCubeRates } from '../calc/advice.js';
import { cubePlan, lineOptions, defaultValue, lineTotals, lineLabel, lineKind, hasPotential, MAIN_STATS, LINE_TYPES, mainStatLabel, damageEstimateSupported } from '../calc/upgrades.js';
import { dayKey, fmtDate } from '../time.js';

export { itemLevel, slotOutlook };

const POT = ['None', 'Rare', 'Epic', 'Unique', 'Legendary'];
const GROUPS = [
  ['Weapon set', ['weapon', 'secondary', 'emblem']],
  ['Armor', ['hat', 'top', 'bottom', 'shoes', 'gloves', 'cape', 'shoulder']],
  ['Accessories', ['belt', 'pendant1', 'pendant2', 'earrings', 'face', 'eye', 'ring1', 'ring2', 'ring3', 'ring4']],
  ['Other', ['pocket', 'badge', 'heart']]
];

// The same places as the in-game equipment window (5 across). null is a gap, or a slot the tracker doesn't follow.
const WINDOW = [
  ['ring1', null, 'hat', null, 'emblem'],
  ['ring2', 'pendant1', 'face', null, 'badge'],
  ['ring3', 'pendant2', 'eye', 'earrings', null],
  ['ring4', 'weapon', 'top', 'shoulder', 'secondary'],
  ['pocket', 'belt', 'bottom', 'gloves', 'cape'],
  [null, null, 'shoes', null, 'heart']
];

function blankGear() {
  return { preset: 'mid', slots: {}, history: [] };
}

function snapshot(g, gearData, mainStat) {
  const sum = gearSummary(gearData, g, mainStat);
  const today = dayKey(Date.now());
  g.history = (g.history || []).filter((h) => h.d !== today);
  // p: the target the point was scored against, so Pace never compares scores for two different targets.
  g.history.push({ d: today, pct: Math.round(sum.overall * 1000) / 1000, p: g.preset || 'mid' });
  g.history.sort((a, b) => (a.d < b.d ? -1 : 1));
  if (g.history.length > 120) g.history = g.history.slice(-120);
}

const mainStatOf = (s, charId) => (s.characters.find((c) => c.id === charId) || {}).mainStat || 'STR';

function setSlot(charId, slotId, patch, gearData) {
  update((s) => {
    const g = charSlice(s, 'gear', charId, blankGear);
    g.slots[slotId] = { ...(g.slots[slotId] || {}), ...patch };
    snapshot(g, gearData, mainStatOf(s, charId));
  });
}

function clearSlot(charId, slotId, gearData) {
  update((s) => {
    const g = charSlice(s, 'gear', charId, blankGear);
    delete g.slots[slotId];
    snapshot(g, gearData, mainStatOf(s, charId));
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
function ItemIcon({ entry, size = 36, fallback = null }) {
  const [failed, setFailed] = useState(null);
  const url = iconUrl(entry.iconVer, entry.itemId);
  if (!url || failed === url) return fallback;
  return html`<img class="item-icon" src=${url} alt="" width=${size} height=${size} loading="lazy" referrerpolicy="no-referrer" onError=${() => setFailed(url)} />`;
}

// Name box with suggestions from the item list for this slot. Picking one fills the name, level and picture.
function ItemPicker({ slot, entry, tiers, hints, set, pot, mainStat, overallRule }) {
  const doc = useItems();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // True after picking an item whose name gave no tier, so the page can ask for a look at the tier.
  const [unsure, setUnsure] = useState(false);
  const text = entry.note || '';
  const hits = open && doc ? searchItems(doc.items, itemSlotKey(slot.id), text, 8) : [];
  const isTop = Boolean(overallRule && slot.id === overallRule.slot);
  // A new item level, with the potential lines re-read for it (never deleted: keepMissing).
  const levelPatch = (ilvl) => ({ ilvl, ...(entry.pot && Array.isArray(entry.potLines) && entry.potLines.length
    ? { potLines: refreshLines(pot, slot.id, entry.pot, itemLevel(slot, { ...entry, ilvl }), entry.potLines, { mainStat, keepMissing: true }) } : {}) });
  // What the item list knows about an item: level, picture and, on Top, whether it is an overall.
  const fromList = (h) => ({ ...levelPatch(h.level), itemId: h.id, iconVer: doc.version, ...(isTop ? { overall: isOverall(overallRule, h.id) } : {}) });
  const pick = (h) => {
    const patch = { note: h.name, ...fromList(h) };
    const tier = tierFromName(h.name, tiers, hints);
    if (tier) patch.tier = tier;
    else if (!entry.tier) patch.tier = 1;
    set(patch);
    setUnsure(!tier);
    setOpen(false);
  };
  // Typing by hand: a name that is exactly a list item is taken as that item. Otherwise the level and picture
  // that came from the list go, so a stale level never breaks set detection or the star limit. A level typed by
  // hand (no list item behind it) is left alone, and so is the tier.
  const typed = (note) => {
    const hit = doc ? exactItem(doc.items, itemSlotKey(slot.id), note) : null;
    if (hit) set({ note, ...fromList(hit) });
    else if (entry.itemId) set({ note, itemId: null, iconVer: null, ...levelPatch(null), ...(isTop ? { overall: false } : {}) });
    else set({ note, itemId: null, iconVer: null });
    setUnsure(false);
  };
  return html`<div class="field picker"><span>Item name${doc && doc.items.length ? ' · type to search' : ''}</span>
    <input class="input" role="combobox" aria-label="Item name" aria-expanded=${String(hits.length > 0)} aria-controls="item-suggest" aria-autocomplete="list" autocomplete="off"
      value=${text} placeholder=${`e.g. ${slot.type === 'ring' ? 'Superior Gollux Ring' : 'Arcane Umbra'}`}
      onInput=${(e) => { typed(e.currentTarget.value); setOpen(true); setActive(0); }}
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
    ${unsure && entry.itemId ? html`<span class="small muted">Could not tell the tier from this name. Check the item tier below.</span>` : null}
  </div>`;
}

function LineEditor({ slot, entry, set, pot, mainStat }) {
  const tier = entry.pot || 0;
  if (!hasPotential(slot)) return html`<p class="note">This slot can't have potential.</p>`;
  if (!tier) return html`<p class="note">Pick a potential tier to add its lines.</p>`;
  const lines = Array.isArray(entry.potLines) ? entry.potLines : [];
  const lvl = itemLevel(slot, entry);
  const choices = lineChoices(pot, slot.id, tier, lvl, mainStat);
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
      // Shown as-is when it isn't one of this tier's lines (entered before the tables, or left from another tier).
      const legacy = l.type && !current;
      const kind = lineKind(slot, l, mainStat);
      return html`<label class="field"><span>Potential line ${i + 1}${current ? (current.prime ? ' · prime' : ' · non-prime') : ''}${kind === 'farm' ? ' · farming' : kind === 'damage' ? ' · damage' : ''}</span>
        <select class="select pline-select" aria-label=${'Potential line ' + (i + 1)} value=${current ? keyOf(current) : legacy ? 'legacy' : ''} onChange=${(e) => {
          const v = e.currentTarget.value;
          if (!v) return setLine(i, null);
          if (v === 'legacy') return;
          const c = choices.find((x) => keyOf(x) === v);
          if (c) setLine(i, makeLine(pot, c, lvl, mainStat));
        }}>
          <option value="">— none —</option>
          ${legacy ? html`<option value="legacy">${lineLabel(l, mainStat)} (${fromTable ? 'not a line for this tier' : 'entered earlier'})</option>` : null}
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
  // At its star limit, with the limit below the target: stars can never meet the target on this item.
  const capNote = outlook.capped && !outlook.sf ? `This item caps at ${outlook.capped.max}★, below the ${outlook.capped.target}★ target. Replace it, or lower the slot's target stars below.` : null;
  if (capNote && !outlook.cube) return html`<div class="insight"><span class="k">Upgrade outlook</span><div class="small">${capNote}</div></div>`;
  if (!outlook.sf && !outlook.cube) return html`<div class="insight"><span class="k">Upgrade outlook</span><div class="small" style=${{ color: 'var(--ok)' }}>Stars and potential tier meet the target${target.lines > (entry.lines || 0) ? '; only lines are missing (GMS line odds aren’t published)' : ''}.</div></div>`;
  return html`<div class="insight">
    <span class="k">Upgrade outlook</span>
    ${outlook.sf ? html`<div>
      <div class="big accent">≈ ${fmtBig(outlook.sf.plain.cost)}</div>
      <div class="small">${outlook.sf.from}★ → ${outlook.sf.to}★ on average${outlook.sf.to < target.stars ? ` (this item caps at ${outlook.sf.max}★)` : ''}. ${outlook.sf.plain.booms < 0.005 ? 'No boom risk below 15★.' : `${Math.round(outlook.sf.plain.noBoom * 100)}% chance of no boom; about ${outlook.sf.plain.booms.toFixed(1)} booms expected.`}</div>
      <div class="small">Sunny Sunday (30% off, less boom): ≈ ${fmtBig(outlook.sf.sunny.cost)}</div>
    </div>` : null}
    ${capNote ? html`<div class="small">${capNote}</div>` : null}
    ${outlook.cube ? html`<div>
      <div class="big">${Math.round(outlook.cube.bright.expected)} Bright ${plural(Math.round(outlook.cube.bright.expected), 'cube')}</div>
      <div class="small">${POT[Math.max(1, outlook.cube.from)]} → ${POT[outlook.cube.to]}: ≈ ${fmtBig(outlook.cube.bright.cost)}, or ${outlook.cube.bright.n90} ${plural(outlook.cube.bright.n90, 'cube')} (${fmtBig(outlook.cube.bright.cost90)}) to be 90% sure. Glowing: ≈ ${fmtBig(outlook.cube.glowing.cost)}.</div>
    </div>` : null}
  </div>`;
}

function SlotModal({ row, data, char, onClose, cubeRates }) {
  const { slot, entry, target } = row;
  const [flameOpen, setFlameOpen] = useState(Boolean(cleanFlame(entry.flame)));
  const up = withCubeRates(data.upgrades, cubeRates);
  const tiers = data.gear.slotTypes[slot.type].filter(Boolean);
  const set = (patch) => setSlot(char.id, slot.id, patch, data.gear);
  const setTarget = (patch) => set({ target: { ...(entry.target || {}), ...patch } });
  const mainStat = char.mainStat || 'STR';
  const msLabel = mainStatLabel(mainStat);
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
          ${slot.sf && entry.stars ? (() => { const ss = starStats(data.gearStats.starforce, slot, lvl, entry.stars); return ss.stat || ss.att ? html`<div class="small muted" style=${{ textAlign: 'center' }}>Stars give ${mainStat === 'HP' ? 'each stat (not Max HP)' : mainStat === 'XENON' ? 'STR, DEX and LUK' : msLabel} +${ss.stat}${ss.att ? `, ATT +${ss.att}` : ''}${ss.partial ? ' and more (not all of it is in the table)' : ''}</div>` : null; })() : null}
          <hr />
          ${entry.pot ? html`<div class=${'pot-' + entry.pot} style=${{ fontWeight: 700 }}><${PotBadge} tier=${entry.pot} /> Potential: ${POT[entry.pot]}</div>
            ${lines.length ? lines.map((l) => html`<div class=${'pot-line' + (lineKind(slot, l, mainStat) === 'farm' ? ' pot-4' : '')}>${lineLabel(l, mainStat)}</div>`) : html`<div class="small muted">No lines entered yet.</div>`}`
            : html`<div class="small muted">${hasPotential(slot) ? 'No potential' : 'No potential on this slot'}</div>`}
          ${cleanFlame(entry.flame) ? html`<div class="small" style=${{ color: 'var(--ok)' }}>Flame: ${flameLabel(entry.flame, msLabel)}</div>` : null}
        </div>
        <${Outlook} outlook=${outlook} entry=${entry} target=${target} />
      </div>
      <div class="grid" style=${{ gap: '14px' }}>
        ${row.covered ? html`<p class="warnbox">Your Top is marked as an overall, which fills this slot too. ${slot.name} is not scored while that is on, and its potential lines, flame and set piece are left out of the totals.</p>` : null}
        <${ItemPicker} slot=${slot} entry=${entry} tiers=${tiers} hints=${data.gear.tierHints} set=${set} pot=${data.potential} mainStat=${mainStat} overallRule=${data.gear.overall} />
        <div class="form-grid">
          <label class="field"><span>Item tier</span>
            <select class="select" value=${String(entry.tier || 0)} onChange=${(e) => set({ tier: Number(e.currentTarget.value) })}>
              <option value="0">Empty</option>
              ${tiers.map((t, i) => html`<option value=${i + 1}>${t}</option>`)}
            </select></label>
          <label class="field"><span>Item level</span><${NumberInput} className="input" label="Item level" value=${lvl} min=${0} max=${300} onChange=${(v) => set({ ilvl: v || null, ...(entry.pot && (entry.potLines || []).length ? { potLines: refreshLines(data.potential, slot.id, entry.pot, itemLevel(slot, { ...entry, ilvl: v || null }), entry.potLines, { mainStat, keepMissing: true }) } : {}) })} /></label>
          ${slot.sf ? html`<div class="field wide"><span>Stars (max ${max})</span><${Stepper} label=${slot.name + ' stars'} value=${entry.stars || 0} max=${max || 30} onChange=${(v) => set({ stars: v || 0 })}
            presets=${max ? [...new Set([0, Math.min(target.stars || 0, max), max])].map((n) => [n, n === 0 ? 'None' : n === max ? `Max ${n}★` : `Target ${n}★`]) : null} /></div>` : null}
          ${hasPotential(slot) ? html`<label class="field"><span>Potential tier</span>
            <select class=${'select pot-' + (entry.pot || 0)} value=${String(entry.pot || 0)} onChange=${(e) => {
              const pot = Number(e.currentTarget.value);
              // Lines are kept through a tier change: ones the new tier can't have stay listed as "entered earlier"
              // until you re-pick them, so a slip on this dropdown loses nothing. Choosing None clears them.
              const kept = refreshLines(data.potential, slot.id, pot, lvl, entry.potLines, { mainStat, keepMissing: true });
              set({ pot, potLines: pot && kept.some((l) => l.type) ? kept : [] });
            }}>${POT.map((p, i) => html`<option value=${i}>${p}</option>`)}</select></label>` : null}
          ${!heroic && hasPotential(slot) ? html`<label class="field"><span>Bonus potential</span>
            <select class="select" value=${String(entry.bpot || 0)} onChange=${(e) => set({ bpot: Number(e.currentTarget.value) })}>${POT.map((p, i) => html`<option value=${i}>${p}</option>`)}</select></label>` : null}
        </div>
        <${LineEditor} slot=${slot} entry=${entry} set=${set} pot=${data.potential} mainStat=${mainStat} />
        <details open=${flameOpen} onToggle=${(e) => setFlameOpen(e.currentTarget.open)}>
          <summary class="small muted">Bonus stats (flame)${cleanFlame(entry.flame) ? `: ${flameLabel(entry.flame, msLabel)}` : ': none entered'}</summary>
          <div class="form-grid" style=${{ marginTop: '10px' }}>
            ${FLAME_FIELDS.map(([key, label, unit]) => html`<label class="field"><span>${key === 'main' ? msLabel : label}${unit ? ` ${unit}` : ''}</span><${NumberInput} className="input" label=${`Flame ${label}`} value=${(entry.flame || {})[key] ?? null} max=${999} onChange=${(v) => set({ flame: cleanFlame({ ...(entry.flame || {}), [key]: v }) })} /></label>`)}
          </div>
          <p class="note">Copy the green bonus numbers from the item's tooltip. Leave a box empty if the item doesn't have that stat.</p>
          <label class="toggle"><input type="checkbox" checked=${entry.flameAdv !== false} onChange=${(e) => set({ flameAdv: e.currentTarget.checked })} /> Boss item (flame advantage: always 4 lines, higher tiers)</label>
        </details>
        <label class="toggle"><input type="checkbox" checked=${Boolean(entry.temporary)} onChange=${(e) => set({ temporary: e.currentTarget.checked })} /> Temporary item (Item Burning, event or rental)</label>
        ${data.gear.overall && slot.id === data.gear.overall.slot ? html`<label class="toggle"><input type="checkbox" checked=${Boolean(entry.overall)} onChange=${(e) => set({ overall: e.currentTarget.checked })} /> Overall (fills the Bottom slot too, so Bottom is not scored)</label>` : null}
        <details>
          <summary class="small muted">Target for this slot: ${tiers[target.tier - 1] || 'tier ' + target.tier}${target.stars ? `, ${target.stars}★` : ''}${hasPotential(slot) ? `, ${POT[target.pot]} with ${target.lines} useful ${plural(target.lines, 'line')}` : ''}. Change</summary>
          <div class="form-grid" style=${{ marginTop: '10px' }}>
            <label class="field"><span>Target tier</span><select class="select" value=${String(target.tier)} onChange=${(e) => setTarget({ tier: Number(e.currentTarget.value) })}>${tiers.map((t, i) => html`<option value=${i + 1}>${t}</option>`)}</select></label>
            ${slot.sf ? html`<div class="field"><span>Target stars</span><${Stepper} label="Target stars" value=${target.stars} max=${30} onChange=${(v) => setTarget({ stars: v || 0 })} /></div>` : null}
            ${hasPotential(slot) ? html`<label class="field"><span>Target potential</span><select class="select" value=${String(target.pot)} onChange=${(e) => setTarget({ pot: Number(e.currentTarget.value) })}>${POT.map((p, i) => html`<option value=${i}>${p}</option>`)}</select></label>
            <div class="field"><span>Target useful lines</span><${Seg} label="Target lines" value=${target.lines} onChange=${(v) => setTarget({ lines: v })} options=${[[0, '0'], [1, '1'], [2, '2'], [3, '3']]} /></div>` : null}
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
    <span class="it">${empty ? null : html`<${ItemIcon} entry=${entry} size=${28} />`}${empty ? (row.covered ? 'Covered by the overall' : 'Empty') : entry.note || tiers[entry.tier - 1]}</span>
    ${empty ? html`<span class="ln">${row.covered ? 'Not scored' : 'Tap to add'}</span>` : lines.length
      ? html`<span class="ln">${lines.slice(0, 3).map((l, i) => html`${i ? html`<br />` : ''}<span class=${lineKind(slot, l, mainStat) === 'farm' ? 'pot-4' : ''}>${lineLabel(l, mainStat)}</span>`)}</span>`
      : html`<span class="ln muted">${entry.pot ? `${POT[entry.pot]}, lines not entered` : hasPotential(slot) ? 'No potential' : ''}</span>`}
    <span class="foot">${slot.sf && !empty ? html`<span class="stars">★${entry.stars || 0}</span>` : html`<span></span>`}
      ${entry.temporary ? html`<span class="flag">expires</span>` : row.covered ? html`<span class="muted">not scored</span>` : html`<span class="muted">${Math.round(row.pct * 100)}%</span>`}</span>
  </button>`;
}

// One square of the equipment window: picture, stars, a border in the potential tier's colour, progress to target.
function WindowSlot({ row, data, onOpen }) {
  const { slot, entry } = row;
  const tiers = data.gear.slotTypes[slot.type].filter(Boolean);
  const empty = !entry.tier;
  const name = empty ? 'empty' : entry.note || tiers[entry.tier - 1];
  const tip = row.covered ? `${slot.name}: covered by the overall on Top, not scored` : empty ? `${slot.name}: empty` : `${slot.name}: ${name}${slot.sf ? ` · ★${entry.stars || 0}` : ''}${entry.pot ? ` · ${POT[entry.pot]}` : ''} · ${Math.round(row.pct * 100)}% of target${entry.temporary ? ' · expires' : ''}`;
  return html`<button type="button" class=${'wslot' + (empty ? ' empty' : '') + (entry.pot ? ' pot-' + entry.pot : '')} onClick=${onOpen} aria-label=${`${slot.name}: edit`} title=${tip}>
    <span class="pic">${empty ? (row.covered ? html`<span class="txt">Overall</span>` : html`<span class="plus" aria-hidden="true">+</span>`) : html`<${ItemIcon} entry=${entry} size=${32} fallback=${html`<span class="txt">${name}</span>`} />`}</span>
    <span class="nm">${slot.name}</span>
    ${slot.sf && !empty ? html`<span class="st stars">★${entry.stars || 0}</span>` : null}
    ${entry.temporary ? html`<span class="fl" aria-hidden="true">!</span>` : null}
    ${empty || row.covered ? null : html`<i class=${'pg' + (row.pct >= 1 ? ' full' : '')} style=${{ width: Math.round(Math.min(1, row.pct) * 100) + '%' }}></i>`}
  </button>`;
}

export function GearPage({ data, state }) {
  const char = activeCharacter(state);
  const [open, setOpen] = useState(null);
  const [view, setView] = useState('window');
  if (!char) return html`<${PageHead} title="Gear" /><${Card} title="Add a character first"><p class="note"><a href="#characters">Add your character</a> to track gear.</p><//>`;
  const g = state.gear[char.id] || blankGear();
  const mainStat = char.mainStat || 'STR';
  const sum = gearSummary(data.gear, g, mainStat);
  const proj = gearProjection(g.history, sum.overall, Date.now(), g.preset || 'mid');
  const up = withCubeRates(data.upgrades, state.mesos.cubeRates);
  const msLabel = mainStatLabel(mainStat);
  // Totals count what is worn: a Bottom left under an overall is not.
  const worn = sum.slots.filter((r) => !r.covered).map((r) => r.slot);
  const totals = lineTotals(worn, g, mainStat);
  const flames = flameTotals(worn, g);
  const sets = detectSets(data.gearStats.sets, worn, g);
  const stats = g.stats || {};
  const dmgOk = damageEstimateSupported(mainStat);
  const dmgOpts = upgradeOptions(data.gear, g, up, data.gearStats, dmgOk ? stats : null, { fl: data.flames, mainStat, weights: (state.ui.flameCalc || {}).weights }).filter((o) => o.dmg > 0).sort((a, b) => b.dmg / b.cost - a.dmg / a.cost).slice(0, 8);
  const setStat = (key, v) => update((s) => { const x = charSlice(s, 'gear', char.id, blankGear); x.stats = { ...(x.stats || {}), [key]: v }; if (v === null) delete x.stats[key]; });
  const byId = Object.fromEntries(sum.slots.map((r) => [r.slot.id, r]));
  const openRow = open ? byId[open] : null;
  const next = sum.gaps.filter((r) => !r.entry.temporary).slice(0, 6).map((r) => ({ row: r, outlook: slotOutlook(r.slot, r.entry, r.target, up) }));
  return html`
    <${PageHead} title="Gear">${char.name}: tap a slot to edit it. Each slot is scored against the target, with the expected mesos to get there.<//>
    <div class="toolbar">
      <span class="small muted">Target</span>
      <${Seg} label="Gear target" value=${g.preset || 'mid'} onChange=${(v) => update((s) => {
        const x = charSlice(s, 'gear', char.id, blankGear);
        const old = x.preset || 'mid';
        // Points saved before they carried their target were scored against the target that is being left.
        if (v !== old) for (const h of x.history || []) if (h && !h.p) h.p = old;
        x.preset = v;
        snapshot(x, data.gear, mainStatOf(s, char.id));
      })}
        options=${Object.entries(data.gear.presets).map(([id, p]) => [id, p.name])} />
    </div>
    <div class="tiles">
      <div class="tile"><span class="k">Overall vs ${sum.preset.name}</span><span class="v">${Math.round(sum.overall * 100)}%</span><${Bar} pct=${sum.overall} big /></div>
      <div class="tile"><span class="k">${msLabel} % from potential</span><span class="v">${totals.main}%</span><span class="s">${totals.damageLines} damage ${plural(totals.damageLines, 'line')}${totals.boss ? ` · Boss +${totals.boss}%` : ''}${totals.ied ? ` · IED ${totals.ied}%` : ''}</span></div>
      ${flames.items ? html`<div class="tile"><span class="k">Flames · ${flames.items} item${flames.items === 1 ? '' : 's'}</span><span class="v">${msLabel} +${flames.main}</span><span class="s">ATT +${flames.att} · All Stats +${flames.allstat}%${flames.boss ? ` · Boss +${flames.boss}%` : ''}${flames.dmg ? ` · Damage +${flames.dmg}%` : ''}</span></div>` : null}
      <div class="tile ok"><span class="k">Farming lines</span><span class="v">${totals.meso}% · ${totals.drop}%</span><span class="s">Meso obtained · Item drop rate</span></div>
      <div class="tile"><span class="k">Pace</span><span class="v">${proj ? `${(proj.perWeek * 100).toFixed(1)} pts/wk` : '—'}</span>
        <span class="s">${proj ? (proj.eta ? `100% around ${fmtDate(proj.eta)}` : 'no progress in the saved history yet') : 'shows after a few days of edits'}</span><${Spark} history=${historyFor(g.history, g.preset || 'mid')} /></div>
    </div>
    <div class="grid wide-left">
      <${Card} title="Equipment" meta=${html`<${Seg} label="Equipment view" value=${view} onChange=${setView} options=${[['window', 'Window'], ['list', 'List']]} />`}>
        ${view === 'window' ? html`<div class="equip-window" role="group" aria-label="Equipment window">
          ${WINDOW.flat().map((id, i) => (id && byId[id]
            ? html`<${WindowSlot} key=${id} row=${byId[id]} data=${data} onOpen=${() => setOpen(id)} />`
            : html`<span key=${'gap' + i} class="wslot blank" aria-hidden="true"></span>`))}
          ${sum.slots.filter((r) => !WINDOW.flat().includes(r.slot.id)).map((r) => html`<${WindowSlot} key=${r.slot.id} row=${r} data=${data} onOpen=${() => setOpen(r.slot.id)} />`)}
        </div>
        <div class="legend"><span><i style=${{ background: 'var(--rare)' }}></i>Rare</span><span><i style=${{ background: 'var(--epic)' }}></i>Epic</span><span><i style=${{ background: 'var(--unique)' }}></i>Unique</span><span><i style=${{ background: 'var(--legendary)' }}></i>Legendary</span></div>
        <p class="note">Laid out like the in-game equipment window. Tap a slot to edit it. The border is the potential tier and the bar along the bottom is progress to your target${sum.temporary.length ? `; “!” marks the ${sum.temporary.length} item${sum.temporary.length === 1 ? '' : 's'} that expire${sum.temporary.length === 1 ? 's' : ''}` : ''}. Switch to List to read every line.</p>` : null}
        ${view !== 'window' ? GROUPS.map(([label, ids]) => html`<div class="grid" style=${{ gap: '8px' }}>
          <div class="group-h" style=${{ padding: '4px 2px 0' }}><h4>${label}</h4></div>
          <div class="equip-grid">${ids.filter((id) => byId[id]).map((id) => html`<${EquipTile} key=${id} row=${byId[id]} data=${data} mainStat=${mainStat} onOpen=${() => setOpen(id)} />`)}</div>
        </div>`) : null}
      <//>
      <${Card} title="What to upgrade next" meta="Biggest weighted gaps, permanent items">
        ${next.length ? next.map(({ row, outlook }) => html`<div class="insight" style=${{ cursor: 'pointer' }} onClick=${() => setOpen(row.slot.id)}>
          <div style=${{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}><b>${row.slot.name}</b><span class="muted small">${Math.round(row.pct * 100)}%</span></div>
          <div class="small">${row.gaps.join(', ')}</div>
          ${outlook.replace ? html`<div class="small">Replace with a better item rather than upgrading this one.</div>` : null}
          ${outlook.capped && !outlook.sf ? html`<div class="small">This item caps at ${outlook.capped.max}★: replace it, or lower the slot's target stars.</div>` : null}
          ${outlook.sf ? html`<div class="small">Star Force ${outlook.sf.from}→${outlook.sf.to}★: <b>≈ ${fmtBig(outlook.sf.plain.cost)}</b> (Sunny Sunday ≈ ${fmtBig(outlook.sf.sunny.cost)})</div>` : null}
          ${outlook.cube ? html`<div class="small">Cubes to ${POT[outlook.cube.to]}: <b>≈ ${fmtBig(outlook.cube.bright.cost)}</b> (${Math.round(outlook.cube.bright.expected)} Bright)</div>` : null}
        </div>`) : html`<${Empty}>Every permanent slot meets the target. Raise the target to keep going.<//>`}
        <p class="note">${data.gear.note} Star Force and cube figures are expected values from the GMS v.272 tables (cube tier-up odds are community estimates).</p>
      <//>
    </div>
    <div class="grid two" style=${{ marginTop: '14px' }}>
      <${Card} title="Set effects" meta=${sets.length ? `${sets.length} set${sets.length === 1 ? '' : 's'} found` : 'none found'}>
        ${sets.length ? sets.map((s) => html`<div class="insight">
          <div style=${{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}><b>${s.name}</b><span class="muted small">${s.count} / ${s.total} pieces</span></div>
          <div class="small">${setBonusLabel(s.bonus) || 'No bonus yet at this piece count.'}</div>
          ${s.nextAt ? html`<div class="small muted">Next bonus at ${s.nextAt} pieces.</div>` : null}
        </div>`) : html`<${Empty}>Pick items by name in each slot and their set bonuses show up here.<//>`}
        <p class="note">${data.gearStats.sets.note}</p>
      <//>
      <${Fold} title="Your stats, for damage estimates" meta=${stats.main && stats.att ? 'entered · tap to change' : 'optional · tap to open'}>
        ${dmgOk ? null : html`<p class="warnbox">Not available for this character. The estimate uses the standard damage formula (4 × main stat + secondary stat), and the wiki's formula page doesn't give the Demon Avenger or Xenon versions. Upgrades are ranked by the tracker's gear score instead.</p>`}
        <p class="note">Copy these totals from your in-game stat window. With them, Star Force upgrades and flame rerolls (for items with a flame typed in) are ranked by estimated damage per meso instead of the tracker's gear score.</p>
        <div class="form-grid">${STAT_FIELDS.map(([key, label, ph]) => html`<label class="field"><span>${key === 'main' ? `${msLabel} (total)` : key === 'mainPct' ? `${msLabel} %` : label}</span><${NumberInput} className="input" label=${label} value=${stats[key] ?? null} max=${9999999} onChange=${(v) => setStat(key, v)} /><span class="small muted">${ph}</span></label>`)}</div>
        ${dmgOpts.length ? html`<div><b>Star Force and flames by damage per meso</b>${dmgOpts.map((o) => html`<div class="small">${o.label}: about +${(o.dmg * 100).toFixed(2)}% damage${o.dmgPartial ? ' or more' : ''} for ≈ ${fmtBig(o.cost)}</div>`)}</div>` : html`<p class="note">${stats.main && stats.att ? 'No Star Force upgrade is open on your permanent items.' : 'Enter at least your main stat and Attack Power to see estimates.'}</p>`}
        <p class="note">${data.gearStats.damage.note} Damage is taken as proportional to (4 × main stat + secondary stat) × Attack Power, per the wiki's Damage Formula page; skills, boss defense and buffs are left out, so treat it as a ranking aid, not a prediction. ${data.gearStats.source}</p>
      <//>
    </div>
    ${openRow ? html`<${SlotModal} row=${openRow} data=${data} char=${char} cubeRates=${state.mesos.cubeRates} onClose=${() => setOpen(null)} />` : null}`;
}
