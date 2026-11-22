import { h } from '../dom.js';
import { KINDS } from '../../services/tg-media.js';
import { formatBytes } from '../../core/format.js';
import { initGoogle, requestToken, hasToken } from '../../services/google-auth.js';
import { pickFolder } from '../../services/drive-picker.js';
import { createFolder } from '../../services/drive-api.js';
import { getItem, setItem } from '../../core/storage.js';
import { filePicker } from '../components/file-picker.js';

const MODES = [
  { value: 'archive', title: 'כל הארכיון', text: 'מעתיק את כל מה שכבר יש בערוץ, ומסיים.' },
  { value: 'archive+new', title: 'כל הארכיון + כל מה שיעלה מעכשיו', text: 'אחרי הארכיון ממשיך להאזין ומעתיק כל פוסט חדש (כל עוד הדף פתוח).' },
  { value: 'new', title: 'רק דברים חדשים', text: 'מתעלם ממה שכבר יש, ומעתיק רק פוסטים שיעלו מעכשיו (כל עוד הדף פתוח).' },
];

function summarize(items) {
  const by = {};
  for (const k of Object.keys(KINDS)) by[k] = { count: 0, bytes: 0 };
  for (const it of items) {
    by[it.kind].count++;
    by[it.kind].bytes += it.size || 0;
  }
  return by;
}

export function optionsScreen(ctx, { onStart, onBack }) {
  const { channel, scan, settings } = ctx;
  const sum = summarize(scan.items);
  const saved = getItem(`opts.${channel.id}`, {}) || {};
  let folder = saved.folder || null;
  const single = Boolean(scan.single); // a link to specific post(s), not a whole channel
  let mode = single ? 'archive' : saved.mode || 'archive+new';

  // --- what to copy ---
  const kindBoxes = {};
  const selected = new Set();
  const initialKinds = single ? Object.keys(KINDS) : saved.kinds || Object.keys(KINDS).filter((k) => sum[k].count > 0 || k !== 'photo');
  for (const it of scan.items) if (initialKinds.includes(it.kind)) selected.add(it.id);
  const picker = filePicker(scan.items, selected);

  const kindRows = Object.entries(KINDS).map(([k, meta]) => {
    const cb = h('input', {
      type: 'checkbox',
      checked: initialKinds.includes(k),
      onchange: () => {
        // ticking a type selects/clears all files of that type in the list below
        for (const it of scan.items) if (it.kind === k) cb.checked ? selected.add(it.id) : selected.delete(it.id);
        picker.refresh();
      },
    });
    kindBoxes[k] = cb;
    return h('label', { class: 'check-row' }, cb, h('span', {}, `${meta.icon} ${meta.label}`), h('span', { class: 'muted' }, `${sum[k].count.toLocaleString()} · ${formatBytes(sum[k].bytes)}`));
  });

  // --- mode ---
  const modeRows = MODES.map((m) =>
    h(
      'label',
      { class: 'radio-card' },
      h('input', { type: 'radio', name: 'mode', value: m.value, checked: m.value === mode, onchange: () => (mode = m.value) }),
      h('div', {}, h('b', {}, m.title), h('div', { class: 'muted small' }, m.text))
    )
  );

  // --- Drive folder ---
  const folderLine = h('div', { class: 'folder-line' });
  const gBox = h('div', { class: 'stack' });
  const gMsg = h('div');
  const newName = h('input', { type: 'text', value: channel.title, class: 'big-input' });

  const drawFolder = () => {
    folderLine.replaceChildren(
      folder
        ? h('span', {}, '📁 ', h('b', {}, folder.name), folder.url ? [' · ', h('a', { href: folder.url, target: '_blank', rel: 'noopener' }, 'פתח בדרייב')] : null)
        : h('span', { class: 'muted' }, 'עוד לא נבחרה תיקייה')
    );
  };

  const withGoogle = async (fn) => {
    gMsg.replaceChildren();
    try {
      await initGoogle(settings);
      if (!hasToken()) await requestToken('');
      await fn();
      drawGoogle();
    } catch (e) {
      gMsg.replaceChildren(h('div', { class: 'alert alert-error' }, e.message || String(e)));
    }
  };

  initGoogle(settings).catch(() => {}); // preload, so the sign-in window opens right on click

  const drawGoogle = () => {
    gBox.replaceChildren(
      folderLine,
      h(
        'div',
        { class: 'row wrap' },
        h('button', { class: 'btn', type: 'button', onclick: () => withGoogle(async () => { const f = await pickFolder(settings); if (f) folder = f; drawFolder(); }) }, '📂 בחירת תיקייה קיימת'),
      ),
      h(
        'div',
        { class: 'row' },
        newName,
        h('button', { class: 'btn', type: 'button', onclick: () => withGoogle(async () => { const f = await createFolder(newName.value.trim() || channel.title); folder = { id: f.id, name: f.name, url: f.webViewLink }; drawFolder(); }) }, '➕ תיקייה חדשה')
      ),
      gMsg
    );
    drawFolder();
  };
  drawGoogle();

  // --- protected channel confirmation ---
  const protectedBox = channel.protectedContent ? h('input', { type: 'checkbox' }) : null;

  const err = h('div');
  const start = () => {
    const kinds = Object.keys(kindBoxes).filter((k) => kindBoxes[k].checked);
    if (mode !== 'new' && !selected.size) return err.replaceChildren(h('div', { class: 'alert alert-error' }, 'לא נבחר אף קובץ'));
    if (mode !== 'archive' && !kinds.length) return err.replaceChildren(h('div', { class: 'alert alert-error' }, 'בחר לפחות סוג קובץ אחד לפוסטים חדשים'));
    if (!folder) return err.replaceChildren(h('div', { class: 'alert alert-error' }, 'בחר תיקייה בדרייב'));
    if (protectedBox && !protectedBox.checked) return err.replaceChildren(h('div', { class: 'alert alert-error' }, 'צריך לאשר שמותר לך לשמור את התוכן של הערוץ'));
    if (!single) setItem(`opts.${channel.id}`, { folder, mode, kinds });
    else setItem(`opts.${channel.id}`, { ...saved, folder });
    onStart({ folder, mode, kinds, selectedIds: new Set(selected) });
  };

  return h(
    'section',
    { class: 'stack' },
    h('div', { class: 'card' },
      h('h2', {}, channel.title),
      h('p', { class: 'muted' }, single
        ? `קישור לפוסט בודד · ${scan.items.length} ${scan.items.length === 1 ? 'קובץ' : 'קבצים'} · ${formatBytes(scan.items.reduce((s, i) => s + (i.size || 0), 0))}`
        : `נמצאו ${scan.items.length.toLocaleString()} קבצים · ${formatBytes(scan.items.reduce((s, i) => s + (i.size || 0), 0))}`)
    ),
    single ? null : h('div', { class: 'card stack' }, h('h3', {}, 'מה להעתיק?'), ...modeRows),
    h('div', { class: 'card stack' }, h('h3', {}, 'אילו קבצים?'), single ? null : kindRows, picker),
    h('div', { class: 'card stack' }, h('h3', {}, 'איפה לשמור בדרייב?'), gBox),
    protectedBox
      ? h('div', { class: 'card stack warn' },
          h('p', {}, '⚠️ בעל הערוץ חסם בו שמירה והעברה של תוכן.'),
          h('label', { class: 'check-row' }, protectedBox, h('span', {}, 'זה הערוץ שלי, או שבעל הערוץ אישר לי לשמור את התוכן')))
      : null,
    err,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: onBack }, 'חזרה'),
      h('button', { class: 'btn btn-primary grow', type: 'button', onclick: start }, '🚀 התחל להעתיק')
    ),
    h('p', { class: 'muted small center' }, 'קבצים שכבר הועתקו לתיקייה הזו מדולגים אוטומטית, כך שאפשר לעצור ולהמשיך מתי שרוצים.')
  );
}
