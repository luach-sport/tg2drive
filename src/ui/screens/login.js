import { h } from '../dom.js';
import { login } from '../../services/tg-client.js';

const ERRORS = {
  PHONE_NUMBER_INVALID: 'מספר הטלפון לא תקין. כתוב אותו עם קידומת, למשל ‎+972501234567',
  PHONE_CODE_INVALID: 'הקוד שגוי, נסה שוב',
  PHONE_CODE_EXPIRED: 'פג תוקף הקוד. רענן את הדף ונסה מחדש',
  PASSWORD_HASH_INVALID: 'הסיסמה שגויה, נסה שוב',
  API_ID_INVALID: 'ה-api_id או ה-api_hash שגויים. בדוק אותם בהגדרות ⚙️',
  PHONE_NUMBER_BANNED: 'המספר הזה חסום בטלגרם',
};

function explain(err) {
  const code = err?.errorMessage || err?.message || '';
  const key = Object.keys(ERRORS).find((k) => code.includes(k));
  if (key) return ERRORS[key];
  if (code.includes('FLOOD')) return 'יותר מדי ניסיונות. חכה קצת ונסה שוב.';
  return `שגיאה: ${code}`;
}

export function loginScreen(ctx, onDone) {
  const title = h('h2', {}, 'התחברות לטלגרם');
  const hint = h('p', { class: 'muted' });
  const input = h('input', { type: 'text', dir: 'ltr', class: 'big-input' });
  const btn = h('button', { class: 'btn btn-primary btn-wide', type: 'submit' }, 'המשך');
  const msg = h('div');
  let pending = null;

  const form = h(
    'form',
    {
      class: 'card stack',
      onsubmit: (e) => {
        e.preventDefault();
        const v = input.value.trim();
        if (!v || !pending) return;
        msg.replaceChildren();
        btn.disabled = true;
        const p = pending;
        pending = null;
        p(v);
      },
    },
    title,
    hint,
    input,
    btn,
    msg
  );

  const ask = (label, text, type = 'text', autocomplete = 'off') =>
    new Promise((resolve) => {
      title.textContent = label;
      hint.textContent = text;
      input.type = type;
      input.autocomplete = autocomplete;
      input.value = '';
      btn.disabled = false;
      pending = resolve;
      input.focus();
    });

  login({
    phone: () => ask('התחברות לטלגרם', 'מספר הטלפון של חשבון הטלגרם שלך, עם קידומת מדינה (למשל ‎+972501234567)', 'tel', 'tel'),
    code: () => ask('קוד אימות', 'טלגרם שלח לך קוד בתוך האפליקציה (או ב-SMS). הקלד אותו כאן.', 'text', 'one-time-code'),
    password: (hint2) =>
      ask('סיסמת אימות דו-שלבי', `לחשבון שלך יש סיסמה נוספת.${hint2 ? ` רמז: ${hint2}` : ''}`, 'password', 'current-password'),
    error: (err) => msg.replaceChildren(h('div', { class: 'alert alert-error' }, explain(err))),
  })
    .then(onDone)
    .catch((err) => msg.replaceChildren(h('div', { class: 'alert alert-error' }, explain(err))));

  return h(
    'section',
    { class: 'stack' },
    form,
    h('p', { class: 'muted small' }, 'ההתחברות נשמרת בדפדפן הזה בלבד. אל תשתמש באתר במחשב של מישהו אחר.')
  );
}
