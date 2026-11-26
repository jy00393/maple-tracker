import { html, useState } from '../../vendor/htm-preact.mjs';
import { update, activeCharacter, charSlice } from '../store.js';
import { Card, Fold, NumberInput, Stepper, Empty } from '../ui.js';
import { shopPlan, itemCap, limitText } from '../calc/shops.js';
import { fmtKst, kstDays } from '../time.js';
import { resetOf } from '../calc/checklist.js';

const num = (v) => Math.round(v).toLocaleString('en-US');
const RESET_DAY = { mon: 'Monday', wed: 'Wednesday', thu: 'Thursday' };
// The reset day of the mission that pays this shop's coins: the one set for it on Checklist (earn.checklistItem).
export function earnReset(shop, checklist, checklistState) {
  const id = shop.earn && shop.earn.checklistItem;
  if (!id || !checklist || !Array.isArray(checklist.groups)) return null;
  for (const g of checklist.groups) {
    const item = (g.items || []).find((i) => i.id === id);
    if (item) return resetOf(item, g, checklistState);
  }
  return null;
}
const blankShop = () => ({ have: 0, claims: 0, want: {} });

function Shop({ shop, state, char, now, resetKind }) {
  const [onlyPicked, setOnlyPicked] = useState(false);
  const saved = state.shops[shop.id] || blankShop();
  const plan = shopPlan(shop, saved, char, now, resetKind);
  // The closing day in Korea compared with today in Korea: 0 = today, 1 = tomorrow. Used for every wording.
  const closesIn = kstDays(now, Date.parse(shop.end));
  const set = (fn) => update((s) => { fn(charSlice(s, 'shops', shop.id, blankShop)); });
  const earn = shop.earn;
  const rows = plan.rows.filter((r) => !onlyPicked || r.want > 0);
  const coin = shop.currency;
  if (!plan.open) return html`<${Card} title=${shop.name} meta="closed"><${Empty}>This shop closed on ${fmtKst(Date.parse(shop.end))}.<//><//>`;
  return html`<div class="grid wide-left">
    <${Card} title=${shop.name} meta=${`${shop.event ? shop.event + ' · ' : ''}${closesIn === 0 ? 'closes today' : closesIn === 1 ? 'closes tomorrow' : `${closesIn} days left`}`}>
      <div class="tiles">
        <div class=${'tile ' + (plan.short ? 'accent' : 'ok')}>
          <span class="k">${plan.short ? 'Short by' : 'Left over'}</span>
          <span class="v">${num(plan.short || plan.spare)}</span>
          <span class="s">${plan.picked ? `your picks cost ${num(plan.need)} ${coin}` : 'pick what you want below'}</span>
        </div>
        <div class="tile"><span class="k">You can reach</span><span class="v">${num(plan.total)}</span><span class="s">${earn ? `${num(plan.have)} held + up to ${num(plan.toCome)} still to earn` : 'the amount you hold now'}</span></div>
        <div class="tile"><span class="k">Closes</span><span class="v">${closesIn === 0 ? 'Today' : closesIn === 1 ? 'Tomorrow' : `${closesIn} days`}</span><span class="s">${fmtKst(Date.parse(shop.end))}</span></div>
      </div>
      <div class="form-grid">
        <label class="field"><span>${coin} you hold now</span><${NumberInput} id=${'shop-have-' + shop.id} className="input" label=${coin + ' held'} value=${saved.have || null} max=${1e9} onChange=${(v) => set((x) => { x.have = Math.floor(v || 0); })} /></label>
        ${earn ? html`<div class="field"><span>${earn.name}s claimed so far (max ${earn.max})</span><${Stepper} label=${earn.name + 's claimed'} value=${Math.min(saved.claims || 0, earn.max)} max=${earn.max} onChange=${(v) => set((x) => { x.claims = v || 0; })} /></div>` : null}
      </div>
      ${shop.note ? html`<p class="warnbox">${shop.note}</p>` : null}
      ${plan.short ? html`<p class="warnbox">Your picks cost ${num(plan.short)} ${coin} more than you can reach. Drop a pick, or lower a number.</p>` : null}
      <div class="toolbar">
        <label class="small"><input type="checkbox" checked=${onlyPicked} onChange=${(e) => setOnlyPicked(e.currentTarget.checked)} /> Only my picks</label>
        ${plan.picked ? html`<button type="button" class="btn ghost" onClick=${() => set((x) => { x.want = {}; })}>Clear picks</button>` : null}
      </div>
      <div class="tbl-wrap"><table class="tbl shop-tbl">
        <thead><tr><th>Item</th><th>Still to buy</th><th class="num">Cost</th></tr></thead>
        <tbody>
          ${rows.length === 0 ? html`<tr><td colspan="3"><span class="small muted">No picks yet.</span></td></tr>` : rows.map(({ item, want, cost }) => html`<tr class=${want ? '' : 'off'}>
            <td>${item.name}
              <div class="small muted">${num(item.cost)} each · limit ${limitText(item)}${item.note ? ' · ' + item.note : ''}${item.notChallenger && char && char.challenger ? ' · not sold in Challenger World' : ''}</div></td>
            <td><${Stepper} label=${'Still to buy: ' + item.name} value=${want} max=${itemCap(item) ?? 9999} onChange=${(v) => set((x) => { if (v) x.want[item.id] = v; else delete x.want[item.id]; })} /></td>
            <td class="num">${want ? num(cost) : '—'}</td>
          </tr>`)}
        </tbody>
      </table></div>
    <//>
    <div class="grid">
      <${Card} title="How it adds up">
        ${shop.scope ? html`<p class="note">${shop.scope}</p>` : null}
        ${earn ? null : html`<p class="note">How ${coin} is earned is not listed here, so only the amount you hold is counted. Keep it up to date.</p>`}
        ${earn ? html`<p class="note">${earn.name}: ${num(earn.perClaim)} ${coin} per claim, ${earn.perWeek} claims a week, ${earn.max} in total (${num(earn.perClaim * earn.max)} ${coin}). ${earn.note}</p>
          <p class="note">"Still to earn" assumes ${earn.perWeek} claims in every week that is left, up to the ${earn.max} total.${RESET_DAY[resetKind] ? ` Weeks start on ${RESET_DAY[resetKind]} at 09:00 KST, the reset set for this mission on Checklist.` : ''}</p>` : null}
        <p class="note">Lower "Still to buy" as you buy things, and keep the amount you hold up to date.</p>
        ${shop.useBy ? html`<p class="warnbox">Most items from this shop expire on ${fmtKst(Date.parse(shop.useBy))}. Use them before then.</p>` : null}
      <//>
      <${Fold} title="Source" meta="tap to open"><p class="note">${shop.sourceNote}</p><//>
    </div>
  </div>`;
}

// Events > Coin shop.
export function ShopsView({ data, state, now }) {
  const char = activeCharacter(state);
  const shops = (data.shops && data.shops.shops) || [];
  // Open shops first; a closed one is only shown when nothing is open.
  // Challenger World shops are only for Challenger World characters.
  const mine = shops.filter((s) => !/^challenger world/i.test(s.name) || Boolean(char && char.challenger));
  const open = mine.filter((s) => Date.parse(s.end) > now);
  const list = open.length ? open : mine.slice(-1);
  if (list.length === 0) return html`<${Card} title="Coin shop"><${Empty}>No event shop is listed right now.<//><//>`;
  const shop = list.find((s) => s.id === state.ui.shopId) || list[0];
  return html`${list.length > 1 ? html`<div class="toolbar"><label class="field"><span>Shop (${list.length} open)</span><select id="shop-pick" class="select" value=${shop.id} onChange=${(e) => { const v = e.currentTarget.value; update((s) => { s.ui.shopId = v; }); }}>${list.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label></div>` : null}
    <${Shop} key=${shop.id} shop=${{ ...shop, sourceNote: data.shops.source }} state=${state} char=${char} now=${now} resetKind=${earnReset(shop, data.checklist, state.checklist)} />`;
}
