import { html } from '../../vendor/htm-preact.mjs';
import { useStorageOk } from '../store.js';
import { syncConfig } from '../sync.js';

// Shown at the top of every page while the browser refuses to save: a tick still shows on screen, but it would be
// gone after closing the tab.
export function StorageWarning() {
  const ok = useStorageOk();
  if (ok) return null;
  return html`<p class="warnbox storage-warn" role="alert"><b>Your changes aren't being saved.</b> This browser is refusing to store them (its storage may be full, or blocked in a private window or by a site-data setting), so they are lost when you close this tab. ${syncConfig() ? 'Sync still sends them to your gist while the tab is open.' : html`<a href="#settings">Export a backup</a> before you close it.`}</p>`;
}
