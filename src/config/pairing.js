import { loadSettings, saveSettings } from './settings.js';
import { setItem } from '../core/storage.js';

// The QR the phone scans: the site address + the keys, packed after "#" (never sent to any server).
export function pairingUrl(settings) {
  const payload = {
    c: settings.googleClientId,
    k: settings.googleApiKey,
    p: settings.googleAppId,
    i: settings.apiId,
    h: settings.apiHash,
  };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#remote=${b64}`;
}

// Runs on page load: if we were opened from the QR, save the keys and switch to phone mode.
export function consumePairingLink() {
  const m = location.hash.match(/^#remote=([\w-]+)/);
  if (!m) return false;
  try {
    const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
    const p = JSON.parse(json);
    saveSettings({
      ...loadSettings(),
      googleClientId: p.c,
      googleApiKey: p.k,
      googleAppId: p.p,
      apiId: p.i,
      apiHash: p.h,
    });
    setItem('mode', 'remote');
  } catch {
    /* broken link — ignore */
  }
  history.replaceState(null, '', location.pathname); // remove the keys from the address bar
  return true;
}
