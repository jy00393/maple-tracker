import { html, useState } from '../../vendor/htm-preact.mjs';
import { update, charSlice, newId } from '../store.js';
import { Card } from '../ui.js';
import { pitchedSummary, kstDay, isDay } from '../calc/pitched.js';
import { fmtDate } from '../time.js';

const showDay = (d) => fmtDate(Date.parse(d + 'T00:00:00Z'));

// Log of Pitched and Brilliant boss drops for one character. Shown on Bosses.
export function PitchedCard({ data, state, char, now }) {
  const today = kstDay(now);
  // No date picked means "today", which keeps up if the page stays open past midnight. A drop cannot be in the future.
  const [picked, setDay] = useState('');
  // The drop whose × was pressed. It is removed only after "Remove" is pressed too: the × sits beside "Got one".
  const [asking, setAsking] = useState(null);
  const sum = pitchedSummary(data.pitched, state.pitch[char.id]);
  const useDay = isDay(picked) && picked <= today ? picked : today;
  const day = picked || today;
  const log = (itemId) => update((s) => {
    const p = charSlice(s, 'pitch', char.id, () => ({ drops: [] }));
    p.drops.push({ id: newId(), item: itemId, d: useDay });
  });
  const remove = (id) => {
    setAsking(null);
    update((s) => {
      const p = s.pitch[char.id];
      if (p) p.drops = p.drops.filter((x) => x.id !== id);
    });
  };
  const meta = sum.sets.map((s) => `${s.owned} of ${s.total} ${s.id === 'pitched' ? 'Pitched' : 'Brilliant'}`).join(' · ');
  return html`<${Card} title="Pitched and Brilliant drops" meta=${meta} className="span2">
    <div class="toolbar">
      <label class="field"><span>Drop date (Korea)</span><input id="pitch-day" class="input" type="date" value=${day} max=${today} onInput=${(e) => setDay(e.currentTarget.value)} /></label>
      <p class="note">${sum.latest ? `Latest drop: ${showDay(sum.latest.d)}.` : 'No drops logged yet.'} Press "Got one" when an item drops. It is saved for ${char.name} with the date on the left${picked && picked > today ? ' (a date in the future counts as today)' : ''}.</p>
    </div>
    ${sum.sets.map((set) => html`<h4 class="sub-h">${set.name} <span class="small muted">${set.owned} of ${set.total}</span></h4>
      <div class="drops">
        ${set.items.map(({ item, drops }) => html`<div class=${'drop' + (drops.length ? ' got' : '')}>
          <div><b>${item.name}</b><div class="small muted">${item.slot} · ${item.from}</div></div>
          <div class="drop-r">
            ${drops.map((d) => (asking === d.id
              ? html`<span key=${d.id + ':ask'} class="tagdate ask" role="group" aria-label=${`Remove the ${item.name} drop of ${showDay(d.d)}?`}>${showDay(d.d)}
                  <button type="button" class="danger" aria-label=${`Yes, remove the ${item.name} drop of ${showDay(d.d)}`} onClick=${() => remove(d.id)}>Remove</button>
                  <button type="button" aria-label=${`Keep the ${item.name} drop of ${showDay(d.d)}`} onClick=${() => setAsking(null)}>Keep</button></span>`
              : html`<span key=${d.id} class="tagdate">${showDay(d.d)}<button type="button" class="x" aria-label=${`Remove the ${item.name} drop of ${showDay(d.d)}`} onClick=${() => setAsking(d.id)}>×</button></span>`))}
            ${drops.length ? null : html`<span class="small muted">Not yet</span>`}
            <button type="button" class="btn" aria-label=${`Got one: ${item.name}`} onClick=${() => log(item.id)}>Got one</button>
          </div>
        </div>`)}
      </div>`)}
    <p class="note">${data.pitched.note} ${data.pitched.source}</p>
  <//>`;
}
