import { Api } from 'telegram';
import { currentClient } from './tg-client.js';
import { setItem } from '../core/storage.js';

/**
 * Login by scanning a QR code with Telegram on the phone
 * (Settings → Devices → Link Desktop Device).
 * onQr(url, expiresAt) is called every time a fresh code is ready.
 * Resolves 'ok' or 'password'. Call the returned cancel() to stop.
 */
export function qrLogin(settings, onQr) {
  const client = currentClient();
  if (!client) return { promise: Promise.reject(new Error('אין חיבור לטלגרם. רענן את הדף.')), cancel() {} };
  const creds = { apiId: Number(settings.apiId), apiHash: settings.apiHash };
  let stopped = false;
  let wake = null;

  const handler = (update) => {
    if (update instanceof Api.UpdateLoginToken) wake?.();
  };
  client.addEventHandler(handler);

  const exportToken = () => client.invoke(new Api.auth.ExportLoginToken({ ...creds, exceptIds: [] }));

  const finish = async (res) => {
    if (res instanceof Api.auth.LoginTokenMigrateTo) {
      await client._switchDC(res.dcId);
      res = await client.invoke(new Api.auth.ImportLoginToken({ token: res.token }));
    }
    if (res instanceof Api.auth.LoginTokenSuccess) {
      setItem('tgSession', client.session.save());
      return 'ok';
    }
    return null;
  };

  const promise = (async () => {
    try {
      while (!stopped) {
        let res = await exportToken();
        const done = await finish(res);
        if (done) return done;
        if (!(res instanceof Api.auth.LoginToken)) throw new Error('תשובה לא צפויה מטלגרם');

        const token = Buffer.from(res.token).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const expiresAt = res.expires * 1000;
        onQr(`tg://login?token=${token}`, expiresAt);

        // wait until scanned, or until the code expires (then make a new one)
        const ms = Math.max(5000, Math.min(expiresAt - Date.now(), 30000));
        const scanned = await new Promise((resolve) => {
          wake = () => resolve(true);
          setTimeout(() => resolve(false), ms);
        });
        wake = null;
        if (scanned) {
          res = await exportToken();
          const ok = await finish(res);
          if (ok) return ok;
        }
      }
      return 'stopped';
    } catch (e) {
      if ((e.errorMessage || '').includes('SESSION_PASSWORD_NEEDED')) {
        return 'password'; // scan accepted; the account also has a two-step password
      }
      throw e;
    } finally {
      client.removeEventHandler(handler, undefined);
    }
  })();

  return {
    promise,
    cancel: () => {
      stopped = true;
      wake?.();
    },
  };
}
