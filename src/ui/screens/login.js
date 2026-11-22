import { Api } from 'telegram';
import { h } from '../dom.js';
import { sendCode, resendCode, signIn, signInPassword, passwordHint, describeSentCode } from '../../services/tg-login.js';
import { getItem, setItem } from '../../core/storage.js';

const ERRORS = {
  PHONE_NUMBER_INVALID: 'מספר הטלפון לא תקין. כתוב אותו עם קידומת, למשל ‎+972501234567',
  PHONE_CODE_INVALID: 'הקוד שגוי, נסה שוב',
  PHONE_CODE_EXPIRED: 'פג תוקף הקוד. לחץ על "שלח קוד שוב"',
  PHONE_CODE_EMPTY: 'צריך להקליד את הקוד',
  PASSWORD_HASH_INVALID: 'הסיסמה שגויה, נסה שוב',
  API_ID_INVALID: 'ה-api_id או ה-api_hash שגויים. בדוק אותם בהגדרות ⚙️',
  API_ID_PUBLISHED_FLOOD: 'טלגרם חוסם את המפתחות האלה. צור מפתחות חדשים ב-my.telegram.org',
  PHONE_NUMBER_BANNED: 'המספר הזה חסום בטלגרם',
  PHONE_NUMBER_FLOOD: 'ביקשת יותר מדי קודים. טלגרם חוסם זמנית, נסה שוב בעוד כמה שעות.',
  SEND_CODE_UNAVAILABLE: 'טלגרם לא יכול לשלוח עוד קודים כרגע. חכה כמה דקות ונסה שוב.',
  EMAIL_CODE_INVALID: 'הקוד מהמייל שגוי',
};

function explain(err) {
  const code = err?.errorMessage || err?.message || String(err);
  const key = Object.keys(ERRORS).find((k) => code.includes(k));
  if (key) return ERRORS[key];
  const flood = code.match(/FLOOD_WAIT_(\d+)|A wait of (\d+) seconds/);
  if (flood) {
    const sec = Number(flood[1] || flood[2]);
    return `טלגרם ביקש להמתין ${sec > 120 ? `${Math.ceil(sec / 60)} דקות` : `${sec} שניות`} לפני ניסיון נוסף.`;
  }
  return `שגיאה: ${code}`;
}

export function loginScreen(ctx, onDone) {
  const title = h('h2', {});
  const hint = h('p', { class: 'muted' });
  const input = h('input', { type: 'text', dir: 'ltr', class: 'big-input' });
  const btn = h('button', { class: 'btn btn-primary btn-wide', type: 'submit' }, 'המשך');
  const extra = h('div', { class: 'row wrap' });
  const msg = h('div');
  let onSubmit = null;

  const showError = (e) => msg.replaceChildren(h('div', { class: 'alert alert-error' }, explain(e)));
  const step = ({ t, text, type = 'text', autocomplete = 'off', value = '', submit, buttons = [] }) => {
    title.textContent = t;
    hint.replaceChildren(...[].concat(text));
    input.type = type;
    input.autocomplete = autocomplete;
    input.value = value;
    btn.disabled = false;
    extra.replaceChildren(...buttons);
    onSubmit = submit;
    input.focus();
  };

  const form = h(
    'form',
    {
      class: 'card stack',
      onsubmit: async (e) => {
        e.preventDefault();
        const v = input.value.trim();
        if (!v || !onSubmit) return;
        msg.replaceChildren();
        btn.disabled = true;
        try {
          await onSubmit(v);
        } catch (err) {
          showError(err);
        } finally {
          btn.disabled = false;
        }
      },
    },
    title, hint, input, btn, extra, msg
  );

  // --- step 1: phone ---
  const askPhone = () =>
    step({
      t: 'התחברות לטלגרם',
      text: 'מספר הטלפון של חשבון הטלגרם שלך, עם קידומת מדינה (למשל ‎+972501234567)',
      type: 'tel',
      autocomplete: 'tel',
      value: getItem('lastPhone', '') || '',
      submit: async (raw) => {
        const phone = normalizePhone(raw);
        setItem('lastPhone', phone);
        const sent = await sendCode(ctx.settings, phone);
        if (sent instanceof Api.auth.SentCodeSuccess) return finish();
        askCode(phone, sent);
      },
    });

  // --- step 2: code ---
  const askCode = (phone, sent) => {
    const viaEmail = sent.type instanceof Api.auth.SentCodeTypeEmailCode;
    let wait = sent.timeout || 0;
    const resendBtn = h('button', { class: 'btn', type: 'button' }, '');
    const backBtn = h('button', { class: 'btn', type: 'button', onclick: askPhone }, 'שינוי מספר');
    const tick = () => {
      resendBtn.disabled = wait > 0;
      resendBtn.textContent = wait > 0 ? `שלח קוד שוב (${wait})` : sent.nextType ? 'שלח קוד בדרך אחרת' : 'שלח קוד שוב';
    };
    const timer = setInterval(() => {
      if (wait > 0) wait--;
      tick();
      if (!document.body.contains(resendBtn)) clearInterval(timer);
    }, 1000);
    tick();
    resendBtn.onclick = async () => {
      msg.replaceChildren();
      try {
        const again = await resendCode(phone, sent.phoneCodeHash);
        clearInterval(timer);
        askCode(phone, again);
      } catch (e) {
        showError(e);
      }
    };

    step({
      t: 'קוד אימות',
      text: [h('b', {}, describeSentCode(sent.type)), h('br'), h('span', { class: 'small' }, `נשלח למספר ${phone}`)],
      autocomplete: 'one-time-code',
      buttons: [resendBtn, backBtn],
      submit: async (code) => {
        const r = await signIn({ phone, phoneCodeHash: sent.phoneCodeHash, code: code.replace(/\s|-/g, ''), viaEmail });
        clearInterval(timer);
        if (r === 'password') return askPassword();
        finish();
      },
    });
  };

  // --- step 3: two-step password ---
  const askPassword = async () => {
    const h2 = await passwordHint();
    step({
      t: 'סיסמת אימות דו-שלבי',
      text: `לחשבון שלך יש סיסמה נוספת (אימות דו-שלבי).${h2 ? ` רמז: ${h2}` : ''}`,
      type: 'password',
      autocomplete: 'current-password',
      submit: async (pw) => {
        await signInPassword(ctx.settings, pw);
        finish();
      },
    });
  };

  const finish = async () => {
    title.textContent = 'מחובר ✅';
    onDone();
  };

  askPhone();

  return h(
    'section',
    { class: 'stack' },
    form,
    h('p', { class: 'muted small' }, 'ההתחברות נשמרת בדפדפן הזה בלבד. אל תשתמש באתר במחשב של מישהו אחר.')
  );
}

// "050-1234567" → "+972501234567"
function normalizePhone(raw) {
  let p = raw.replace(/[^\d+]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.startsWith('0')) p = '+972' + p.slice(1);
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}
