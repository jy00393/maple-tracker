// Asking the browser to keep this site's saved entries. By default a browser may remove a site's storage on its own
// when the device runs low on space (and Safari, after 7 days of use without a visit, unless the app is on the
// home screen). A site whose storage is "persistent" loses it only when the person clears it.
// The browser is asked once per browser: Firefox shows a question for it, which must not come back every visit.
// (Kept next to the entries as its own key, never synced: the answer belongs to this browser.)
const KEY = 'maple-tracker:persist';

function asked() {
  try { return localStorage.getItem(KEY) !== null; } catch { return true; }
}

// What the browser says now: true (kept), false (may be removed), null (it can't tell).
export async function storageKept(nav = globalThis.navigator) {
  const st = nav && nav.storage;
  if (!st || typeof st.persisted !== 'function') return null;
  try { return Boolean(await st.persisted()); } catch { return null; }
}

// Asks once, when the browser can be asked and has not agreed already. Returns 'kept', 'refused', 'asked before' or
// 'unsupported'. Never throws.
export async function askToKeepOnce(nav = globalThis.navigator, now = Date.now()) {
  const st = nav && nav.storage;
  if (!st || typeof st.persist !== 'function') return 'unsupported';
  try {
    if (typeof st.persisted === 'function' && await st.persisted()) return 'kept';
    if (asked()) return 'asked before';
    // Noted before asking, so a page closed while the question is up does not ask again.
    try { localStorage.setItem(KEY, JSON.stringify({ at: now })); } catch { return 'unsupported'; }
    return (await st.persist()) ? 'kept' : 'refused';
  } catch {
    return 'unsupported';
  }
}
