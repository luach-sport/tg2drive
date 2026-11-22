import { Api } from 'telegram';
import { currentClient } from './tg-client.js';
import { setItem } from '../core/storage.js';

// Explains in Hebrew where Telegram delivered the login code.
export function describeSentCode(type) {
  if (type instanceof Api.auth.SentCodeTypeApp) return 'הקוד נשלח בתוך אפליקציית טלגרם (במחשב או בטלפון), בצ\'אט שנקרא "Telegram".';
  if (type instanceof Api.auth.SentCodeTypeSms || type instanceof Api.auth.SentCodeTypeFirebaseSms) return 'הקוד נשלח ב-SMS לטלפון.';
  if (type instanceof Api.auth.SentCodeTypeSmsWord || type instanceof Api.auth.SentCodeTypeSmsPhrase) return 'נשלחה הודעת SMS עם מילה. הקלד אותה כאן.';
  if (type instanceof Api.auth.SentCodeTypeCall) return 'טלגרם מתקשר אליך ומקריא את הקוד.';
  if (type instanceof Api.auth.SentCodeTypeFlashCall || type instanceof Api.auth.SentCodeTypeMissedCall)
    return `תקבל שיחה שלא צריך לענות לה. הקוד הוא ${type.length || ''} הספרות האחרונות של המספר שהתקשר.`;
  if (type instanceof Api.auth.SentCodeTypeEmailCode) return `הקוד נשלח למייל ${type.emailPattern || ''}.`;
  if (type instanceof Api.auth.SentCodeTypeFragmentSms) return 'הקוד נשלח דרך Fragment (מספר אנונימי).';
  if (type instanceof Api.auth.SentCodeTypeSetUpEmailRequired)
    return 'טלגרם דורש להגדיר מייל לכניסה. פתח טלגרם בטלפון ← הגדרות ← פרטיות ואבטחה ← מייל כניסה, ואז נסה שוב.';
  return 'הקוד נשלח.';
}

export async function sendCode(settings, phone) {
  const client = currentClient();
  const res = await client.invoke(
    new Api.auth.SendCode({
      phoneNumber: phone,
      apiId: Number(settings.apiId),
      apiHash: settings.apiHash,
      settings: new Api.CodeSettings({}),
    })
  );
  return res; // auth.SentCode: { type, nextType, timeout, phoneCodeHash }
}

export async function resendCode(phone, phoneCodeHash) {
  return currentClient().invoke(new Api.auth.ResendCode({ phoneNumber: phone, phoneCodeHash }));
}

// Returns 'ok' or 'password' (two-step verification needed).
export async function signIn({ phone, phoneCodeHash, code, viaEmail }) {
  const client = currentClient();
  try {
    const res = await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        ...(viaEmail ? { emailVerification: new Api.EmailVerificationCode({ code }) } : { phoneCode: code }),
      })
    );
    if (res instanceof Api.auth.AuthorizationSignUpRequired) {
      throw new Error('אין חשבון טלגרם למספר הזה');
    }
    saveSession();
    return 'ok';
  } catch (e) {
    if ((e.errorMessage || '').includes('SESSION_PASSWORD_NEEDED')) return 'password';
    throw e;
  }
}

export async function signInPassword(settings, password) {
  const client = currentClient();
  let failed = null;
  try {
    await client.signInWithPassword(
    { apiId: Number(settings.apiId), apiHash: settings.apiHash },
    {
      password: async () => password,
      onError: async (err) => {
        failed = err;
        return true; // stop, let the UI ask again
      },
    }
  );
  } catch (e) {
    throw failed || e;
  }
  saveSession();
}

export async function passwordHint() {
  try {
    return (await currentClient().invoke(new Api.account.GetPassword())).hint || '';
  } catch {
    return '';
  }
}

function saveSession() {
  setItem('tgSession', currentClient().session.save());
}
