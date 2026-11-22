import { getItem, setItem } from '../core/storage.js';

// The keys are entered once in the settings screen and kept only in this browser,
// so nothing secret is ever stored in the public GitHub repo.
export const SETTINGS_FIELDS = [
  { key: 'apiId', label: 'Telegram api_id', placeholder: 'מספר, למשל 1234567', group: 'telegram' },
  { key: 'apiHash', label: 'Telegram api_hash', placeholder: '32 תווים', group: 'telegram' },
  { key: 'googleClientId', label: 'Google Client ID', placeholder: '....apps.googleusercontent.com', group: 'google' },
  { key: 'googleApiKey', label: 'Google API Key', placeholder: 'AIza...', group: 'google' },
  { key: 'googleAppId', label: 'Google Project Number', placeholder: 'מספר הפרויקט, למשל 123456789012', group: 'google' },
];

export function loadSettings() {
  return getItem('settings', {}) || {};
}

export function saveSettings(values) {
  const clean = {};
  for (const f of SETTINGS_FIELDS) clean[f.key] = String(values[f.key] || '').trim();
  setItem('settings', clean);
  return clean;
}

export function isComplete(s) {
  return SETTINGS_FIELDS.every((f) => s[f.key]);
}
