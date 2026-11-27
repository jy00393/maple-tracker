import { html, useState } from '../../vendor/htm-preact.mjs';
import { update, activeCharacter, charSlice } from '../store.js';
import { Card, Fold, NumberInput, Stepper, Empty, plural } from '../ui.js';
import { shopPlan, itemCap, limitText, weeksLeft } from '../calc/shops.js';
import { fmtKst, fmtDay, kstDays, asOf } from '../time.js';
import { ExpiryWarning, setCount, countAt } from './seasoncount.js';
import { seasonCounts } from '../calc/seasoncount.js';
import { changedAt } from '../calc/asof.js';
import { resetOf, itemStatus } from '../calc/checklist.js';
import { worldKey } from '../calc/income.js';
import { bountyCoinOf, bountyWeek, bountyTable, nextLevelCoins } from '../calc/rewards.js';
import { knownLevel } from './level.js';
import { challengerCoins } from './challenger.js';

const num = (v) => Math.round(v).toLocaleString('en-US');
const RESET_DAY = { mon: 'Monday', wed: 'Wednesday', thu: 'Thursday' };
// The reset day of the mission that pays this shop's coins: the one set for it on Checklist (earn.checklistItem).
export function earnReset(shop, checklist, checklistState) {
  const id = (shop.earn && shop.earn.checklistItem) || (shop.bounty && shop.bounty.checklistItem);
  if (!id || !checklist || !Array.isArray(checklist.groups)) return null;
  for (const g of checklist.groups) {
    const item = (g.items || []).find((i) => i.id === id);
    if (item) return resetOf(item, g, checklistState);
  }
  return null;
}
const blankShop = () => ({ have: 0, claims: 0, want: {} });

function findItem(checklist, id) {
  if (!id || !checklist || !Array.isArray(checklist.groups)) return null;
  for (const g of checklist.groups) {
    const item = (g.items || []).find((i) => i.id === id);
    if (item) return { item, group: g };
  }
  return null;
}

// What a Bounty Coin shop's coin comes in at each week (bounty.json): the best solo weekly boss picked on Bosses by
// the characters of the active character's world (the caps are per world), and whether this bounty week's coins
// are already in hand (its Checklist row is ticked). Null for any other shop, or without the data.
export function bountyIncome(data, state, char, shop, now) {
  const coin = bountyCoinOf(shop);
  if (!coin || !char || !data || !data.bounty || !data.bounty.bosses) return null;
  const chars = (state.characters || []).filter((c) => c && worldKey(c) === worldKey(char));
  if (!chars.some((c) => c.id === char.id)) chars.push(char);
  const whoOf = (c) => ({ level: knownLevel(data, state, c) ?? c.level, challenger: Boolean(c.challenger) });
  const week = bountyWeek(data.bounty, chars.map((c) => (state.bosses || {})[c.id]), data.bossById || {}, chars.map(whoOf));
  const found = findItem(data.checklist, shop.bounty.checklistItem);
  const thisWeekDone = Boolean(found && state.checklist && itemStatus(found.item, found.group, state.checklist, now, { id: char.id, level: char.level, challenger: Boolean(char.challenger) }).done);
  const caps = data.bounty.caps || {};
  return { coin, perWeek: week[coin], best: week.best[coin] || null, ranged: Boolean(week.ranged[coin]), thisWeekDone, cap: caps[coin] || 0, label: found ? found.item.label : '' };
}

function BountyNotes({ data, income, coin, weeks }) {
  const best = income.best;
  return html`<p class="note">Shadow Bounties pay ${coin} for weekly bosses beaten in a 1-person party. Practice Mode clears count. Only your best boss of the week pays: a stronger boss later in the week pays the difference.${income.cap ? ` Up to ${num(income.cap)} a week per world.` : ''}</p>
    <p class="note">${best
      ? `Your best solo weekly boss on Bosses is ${best.difficulty} ${best.boss}: ${num(income.perWeek)} ${coin} a week${income.ranged ? ' (the low end of Nexon\'s range)' : ''}. "Still to earn" counts that for each of the ${weeks} ${plural(weeks, 'week')} left${income.thisWeekDone ? ', not this one: it is ticked on Checklist' : ''}.`
      : `None of the solo weekly bosses picked on Bosses pays ${coin}, so nothing more is counted. Pick the bosses you solo on Bosses.`}</p>
    <p class="note">Bounty boss records reset Wednesday 09:00 KST, a day before the boss reset. Tick "${income.label || 'Shadow Bounties'}" on Checklist once this week's coins are in.</p>
    ${data.bounty.unlistedNote ? html`<p class="note">${data.bounty.unlistedNote}</p>` : null}`;
}

function Shop({ shop, state, char, now, resetKind, data = {} }) {
  const [onlyPicked, setOnlyPicked] = useState(false);
  const saved = state.shops[shop.id] || blankShop();
  const income = bountyIncome(data, state, char, shop, now);
  // Challenger World missions not done yet pay their coins once (Progress → Challenger).
  const missions = shop.earn && shop.earn.missions === 'challenger' && char && char.challenger ? challengerCoins(data, state, char, now) : null;
  // A shop whose claims are a season counter (earn.counter: Defense Missions) reads and writes that one count.
  const counter = shop.earn && shop.earn.counter ? shop.earn.counter : null;
  const claims = counter ? Number(seasonCounts(data, state)[counter]) || 0 : saved.claims || 0;
  const plan = shopPlan(shop, { ...saved, claims }, char, now, resetKind, income || undefined, missions ? missions.total : 0);
  // The closing day in Korea compared with today in Korea: 0 = today, 1 = tomorrow. Used for every wording.
  const closesIn = kstDays(now, Date.parse(shop.end));
  // When the two typed amounts were last changed, shown beside them: nothing else moves them.
  const stamp = (field) => changedAt(state, `shops/${encodeURIComponent(shop.id)}/${field}`, now);
  const haveAt = stamp('have');
  const claimsAt = counter ? countAt(data, state, counter, now) : stamp('claims');
  const set = (fn) => update((s) => { fn(charSlice(s, 'shops', shop.id, blankShop)); });
  const earn = shop.earn;
  // The level the tracker knows (typed, or a newer reading): level missions below it are already paid.
  const levelNext = earn && char ? nextLevelCoins(earn.levels, knownLevel(data, state, char)) : null;
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
        <div class="tile"><span class="k">You can reach</span><span class="v">${num(plan.total)}</span><span class="s">${earn || income ? `${num(plan.have)} held${haveAt ? ` ${asOf(haveAt, now)}` : ''} + ${earn ? 'up to' : 'about'} ${num(plan.toCome)} still to earn` : `the amount you hold${haveAt ? ` ${asOf(haveAt, now)}` : ' now'}`}</span></div>
        <div class="tile"><span class="k">Closes</span><span class="v">${closesIn === 0 ? 'Today' : closesIn === 1 ? 'Tomorrow' : `${closesIn} days`}</span><span class="s">${fmtKst(Date.parse(shop.end))}</span></div>
      </div>
      <div class="form-grid">
        <label class="field"><span>${coin} you hold now</span><${NumberInput} id=${'shop-have-' + shop.id} className="input" label=${coin + ' held'} value=${saved.have || null} max=${1e9} onChange=${(v) => set((x) => { x.have = Math.floor(v || 0); })} /></label>
        ${earn ? html`<div class="field"><span>${earn.name}s claimed so far (max ${earn.max}${claimsAt ? `, ${asOf(claimsAt, now)}` : ''})</span><${Stepper} label=${earn.name + 's claimed'} value=${Math.min(claims, earn.max)} max=${earn.max} onChange=${(v) => (counter ? setCount(counter, v, data) : set((x) => { x.claims = v || 0; }))} /></div>` : null}
      </div>
      ${shop.note ? html`<p class="warnbox">${shop.note}</p>` : null}
      ${plan.short ? html`<p class="warnbox">Your picks cost ${num(plan.short)} ${coin} more than you can reach. Drop a pick, or lower a number.</p>` : null}
      <${ExpiryWarning} shop=${shop} plan=${plan} now=${now} resetKind=${resetKind} weekly=${income || undefined} />
      <div class="toolbar">
        <label class="small"><input type="checkbox" checked=${onlyPicked} onChange=${(e) => setOnlyPicked(e.currentTarget.checked)} /> Only my picks</label>
        ${plan.picked ? html`<button type="button" class="btn ghost" onClick=${() => set((x) => { x.want = {}; })}>Clear picks</button>` : null}
      </div>
      <div class="tbl-wrap"><table class="tbl shop-tbl">
        <thead><tr><th>Item</th><th>Still to buy</th><th class="num">Cost</th></tr></thead>
        <tbody>
          ${rows.length === 0 ? html`<tr><td colspan="3"><span class="small muted">No picks yet.</span></td></tr>` : rows.map(({ item, want, cost }) => html`<tr class=${want ? '' : 'off'}>
            <td>${item.name}
              <div class="small muted">${num(item.cost)} each · limit ${limitText(item)}${item.expires ? ` · expires ${fmtDay(Date.parse(item.expires), now)}` : ''}${item.note ? ' · ' + item.note : ''}${item.notChallenger && char && char.challenger ? ' · not sold in Challenger World' : ''}</div></td>
            <td><${Stepper} label=${'Still to buy: ' + item.name} value=${want} max=${itemCap(item) ?? 9999} onChange=${(v) => set((x) => { if (v) x.want[item.id] = v; else delete x.want[item.id]; })} /></td>
            <td class="num">${want ? num(cost) : '—'}</td>
          </tr>`)}
        </tbody>
      </table></div>
    <//>
    <div class="grid">
      <${Card} title="How it adds up">
        ${shop.scope ? html`<p class="note">${shop.scope}</p>` : null}
        ${earn || income ? null : html`<p class="note">How to earn ${coin} is not listed here, so only the amount you hold is counted. Keep it up to date.</p>`}
        ${earn ? html`<p class="note">${earn.name}: ${num(earn.perClaim)} ${coin} per claim, ${earn.perWeek} ${plural(earn.perWeek, 'claim')} a week, ${earn.max} in total (${num(earn.perClaim * earn.max)} ${coin}). ${earn.note}</p>
          <p class="note">"Still to earn" assumes ${earn.perWeek} ${plural(earn.perWeek, 'claim')} in every week that is left, up to the ${earn.max} total.${RESET_DAY[resetKind] ? ` Weeks start on ${RESET_DAY[resetKind]} at 09:00 KST, the reset set for this mission on Checklist.` : ''}</p>` : null}
        ${earn && earn.extra ? html`<p class="note">${earn.extra}</p>` : null}
        ${missions ? html`<p class="note">"Still to earn" also counts ${num(missions.total)} ${coin} from missions not done yet, once each: ${num(missions.level)} from level missions up to Lv. ${missions.endLevel}${missions.projected ? ' (where your pace takes you by the season end)' : ' (your level now: log it twice on Progress for a projection)'}, ${num(missions.boss)} from boss missions you can clear now, and ${num(missions.seasonal)} from seasonal missions not ticked on Progress → Challenger.${missions.hexaLeftOut ? ` HEXA missions (${num(missions.hexaLeftOut)}) are left out: they may not apply to Erda Link.` : ''}${missions.adv ? ` The boss missions also pay ${num(missions.adv)} Advanced Challenger Coins.` : ''}</p>` : null}
        ${levelNext && !missions ? html`<p class="note">Level missions pay once, when the level is reached: your next one, Lv. ${levelNext.level}, gives ${num(levelNext.coins)} ${coin}. They are not counted in "Still to earn".</p>` : null}
        ${income ? html`<${BountyNotes} data=${data} income=${income} coin=${coin} weeks=${Math.max(0, weeksLeft(Date.parse(shop.end), now, resetKind) - (income.thisWeekDone ? 1 : 0))} />` : null}
        <p class="note">Lower "Still to buy" as you buy things, and keep the amount you hold${earn ? ' and the claims' : ''} up to date: missions ticked on Checklist do not change them.${counter ? ` The claims are the same count as "${earn.name}s done" in Season counters on Today: change it in either place.` : ''}</p>
        ${shop.useBy ? html`<p class="warnbox">Most items from this shop expire on ${fmtKst(Date.parse(shop.useBy))}. Use them before then.</p>` : null}
      <//>
      ${income ? html`<${Fold} title="What each boss pays" meta=${coin}><div class="tbl-wrap"><table class="tbl"><tbody>${bountyTable(data.bounty, income.coin, data.bossById || {}).map((r) => html`<tr><td>${r.boss.difficulty} ${r.boss.boss}</td><td class="num">${r.hi > r.lo ? `${num(r.lo)} to ${num(r.hi)}` : num(r.lo)}</td></tr>`)}</tbody></table></div><p class="note">A week pays the best of these, not the sum. ${data.bounty.rangeNote || ''}</p><p class="note">${data.bounty.source}</p><//>` : null}
      <${Fold} title="Source" meta="tap to open"><p class="note">${shop.sourceNote}</p>${earn && earn.source ? html`<p class="note">${earn.source}</p>` : null}<//>
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
    <${Shop} key=${shop.id} shop=${{ ...shop, sourceNote: data.shops.source }} state=${state} char=${char} now=${now} resetKind=${earnReset(shop, data.checklist, state.checklist)} data=${data} />`;
}
