import { h } from '../dom.js';
import { SETTINGS_FIELDS, saveSettings, isComplete } from '../../config/settings.js';

const ORIGIN = location.origin;

function guideTelegram() {
  return h(
    'details',
    { class: 'guide' },
    h('summary', {}, 'איך משיגים את המפתחות של טלגרם?'),
    h(
      'ol',
      {},
      h('li', {}, 'נכנסים ל-', h('a', { href: 'https://my.telegram.org', target: '_blank', rel: 'noopener' }, 'my.telegram.org'), ' ומתחברים עם מספר הטלפון (הקוד מגיע בתוך אפליקציית טלגרם).'),
      h('li', {}, 'לוחצים על API development tools.'),
      h('li', {}, 'ממלאים App title ו-Short name (כל שם באנגלית), Platform: Web, ולוחצים Create application.'),
      h('li', {}, 'מעתיקים לכאן את App api_id ואת App api_hash.')
    )
  );
}

function guideGoogle() {
  return h(
    'details',
    { class: 'guide' },
    h('summary', {}, 'איך משיגים את המפתחות של גוגל?'),
    h(
      'ol',
      {},
      h('li', {}, 'נכנסים ל-', h('a', { href: 'https://console.cloud.google.com/projectcreate', target: '_blank', rel: 'noopener' }, 'Google Cloud Console'), ' ויוצרים פרויקט חדש (חינם).'),
      h('li', {}, 'מפעילים את ', h('a', { href: 'https://console.cloud.google.com/apis/library/drive.googleapis.com', target: '_blank', rel: 'noopener' }, 'Google Drive API'), ' ואת ', h('a', { href: 'https://console.cloud.google.com/apis/library/picker.googleapis.com', target: '_blank', rel: 'noopener' }, 'Google Picker API'), '.'),
      h('li', {}, 'ב-', h('a', { href: 'https://console.cloud.google.com/auth/overview', target: '_blank', rel: 'noopener' }, 'Google Auth Platform'), ' מגדירים מסך הסכמה: External, ומוסיפים את המייל שלך תחת Audience → Test users.'),
      h('li', {}, 'ב-Clients יוצרים OAuth client מסוג Web application, ומוסיפים ב-Authorized JavaScript origins את: ', h('code', {}, ORIGIN), '. מעתיקים את ה-Client ID.'),
      h('li', {}, 'ב-', h('a', { href: 'https://console.cloud.google.com/apis/credentials', target: '_blank', rel: 'noopener' }, 'Credentials'), ' יוצרים API key ומעתיקים אותו.'),
      h('li', {}, 'את Project number מוצאים בדף הראשי של הפרויקט (', h('a', { href: 'https://console.cloud.google.com/home/dashboard', target: '_blank', rel: 'noopener' }, 'Dashboard'), ').')
    )
  );
}

export function settingsScreen(ctx, onDone) {
  const inputs = {};
  const fieldsFor = (group) =>
    SETTINGS_FIELDS.filter((f) => f.group === group).map((f) => {
      const input = h('input', {
        type: 'text',
        dir: 'ltr',
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: f.placeholder,
        value: ctx.settings?.[f.key] || '',
      });
      inputs[f.key] = input;
      return h('label', { class: 'field' }, h('span', {}, f.label), input);
    });

  const msg = h('div');
  const save = () => {
    const values = {};
    for (const [k, el] of Object.entries(inputs)) values[k] = el.value;
    const saved = saveSettings(values);
    if (!isComplete(saved)) {
      msg.replaceChildren(h('div', { class: 'alert alert-error' }, 'צריך למלא את כל השדות'));
      return;
    }
    ctx.settings = saved;
    onDone();
  };

  return h(
    'section',
    { class: 'stack' },
    h('div', { class: 'card' },
      h('h2', {}, 'הגדרה חד-פעמית'),
      h('p', { class: 'muted' }, 'המפתחות נשמרים רק בדפדפן הזה, ולא נשלחים לשום מקום חוץ מטלגרם וגוגל.')
    ),
    h('div', { class: 'card stack' }, h('h3', {}, '1. טלגרם'), guideTelegram(), ...fieldsFor('telegram')),
    h('div', { class: 'card stack' }, h('h3', {}, '2. גוגל דרייב'), guideGoogle(), ...fieldsFor('google')),
    msg,
    h('button', { class: 'btn btn-primary btn-wide', onclick: save }, 'שמירה'),
    h('p', { class: 'credit' }, 'Developed by Itzko')
  );
}
