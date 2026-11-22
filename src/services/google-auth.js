// Google sign-in in the browser (Google Identity Services, token model).
// drive.file = the site can only see files it created and folders you pick for it.
// drive.appdata = a hidden app folder, used to link the phone and the computer.
const SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';

let tokenClient = null;
let accessToken = null;
let expiresAt = 0;
const scripts = {};

export class AuthNeededError extends Error {
  constructor() {
    super('צריך לחדש את החיבור לגוגל');
    this.authNeeded = true;
  }
}

export function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = resolve;
      el.onerror = () => reject(new Error('לא הצלחתי לטעון את הרכיב של גוגל. בדוק חיבור לאינטרנט.'));
      document.head.appendChild(el);
    });
  }
  return scripts[src];
}

export async function initGoogle(settings) {
  await loadScript('https://accounts.google.com/gsi/client');
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: settings.googleClientId,
      scope: SCOPE,
      callback: () => {},
    });
  }
}

// Must be called from a click the first time (Google opens a small window).
export function requestToken(prompt = '') {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      accessToken = resp.access_token;
      expiresAt = Date.now() + (Number(resp.expires_in || 3600) - 120) * 1000;
      resolve(accessToken);
    };
    tokenClient.error_callback = () => reject(new AuthNeededError());
    tokenClient.requestAccessToken({ prompt });
  });
}

export function hasToken() {
  return Boolean(accessToken) && Date.now() < expiresAt;
}

export function tokenExpiresSoon(ms = 5 * 60 * 1000) {
  return !accessToken || Date.now() > expiresAt - ms;
}

// Returns a valid token, trying a silent refresh; throws AuthNeededError if a click is needed.
export async function getToken() {
  if (!tokenExpiresSoon(60 * 1000)) return accessToken;
  try {
    return await withTimeout(requestToken(''), 20000);
  } catch {
    throw new AuthNeededError();
  }
}

export function dropToken() {
  accessToken = null;
  expiresAt = 0;
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}
