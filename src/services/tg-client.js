import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { getItem, setItem, removeItem } from '../core/storage.js';

let client = null;

// One shared connection to Telegram, made with the user's own api_id / api_hash.
export async function getClient(settings) {
  if (client) return client;
  const session = new StringSession(getItem('tgSession', '') || '');
  client = new TelegramClient(session, Number(settings.apiId), settings.apiHash, {
    connectionRetries: 10,
    useWSS: true, // required on an https site
    floodSleepThreshold: 300, // wait out Telegram's rate limits automatically (up to 5 min)
    deviceModel: 'Telegram to Drive (web)',
    appVersion: '1.0',
  });
  client.setLogLevel('error');
  await client.connect();
  return client;
}

export function currentClient() {
  return client;
}

export async function isLoggedIn() {
  if (!client) return false;
  try {
    return await client.checkAuthorization();
  } catch {
    return false;
  }
}

// asks = { phone(), code(), password(hint), error(e) } — each returns a promise from the UI.
export async function login(asks) {
  await client.start({
    phoneNumber: () => asks.phone(),
    phoneCode: () => asks.code(),
    password: (hint) => asks.password(hint),
    onError: async (err) => {
      asks.error(err);
      return false; // keep trying: the UI asks again
    },
  });
  setItem('tgSession', client.session.save());
  return client.getMe();
}

export async function logout() {
  try {
    if (client) await client.invoke(new Api.auth.LogOut());
  } catch {
    /* ignore */
  }
  removeItem('tgSession');
  client = null;
}

export async function getMe() {
  return client.getMe();
}
