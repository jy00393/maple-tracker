// Turns the offline worker (sw.js) on, or, with ?nosw in the address, off.
// Off means off: a worker registered on an earlier visit is removed and its stored copies are deleted. Skipping
// the registration alone left the old worker answering every request of the ?nosw page.
const NOSW = /[?&]nosw(?:[=&]|$)/;

export function workerOff(search) {
  return NOSW.test(String(search || ''));
}

// nav: navigator, search: location.search, cacheStore: window.caches (may be missing). Returns what it did.
export function setUpWorker(nav, search, cacheStore) {
  const sw = nav && nav.serviceWorker;
  if (!sw) return 'none';
  if (!workerOff(search)) {
    Promise.resolve().then(() => sw.register('./sw.js')).catch(() => {});
    return 'on';
  }
  Promise.resolve()
    .then(() => sw.getRegistrations())
    .then((regs) => Promise.all((regs || []).map((r) => r.unregister())))
    .catch(() => {});
  if (cacheStore) {
    Promise.resolve()
      .then(() => cacheStore.keys())
      .then((keys) => Promise.all((keys || []).filter((k) => String(k).startsWith('maple-tracker-')).map((k) => cacheStore.delete(k))))
      .catch(() => {});
  }
  return 'off';
}
