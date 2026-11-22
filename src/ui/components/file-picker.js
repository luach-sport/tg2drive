import { h, fileName } from '../dom.js';
import { KINDS } from '../../services/tg-media.js';
import { formatBytes } from '../../core/format.js';

const PAGE = 300;

export function formatDate(unixSeconds) {
  if (!unixSeconds) return '';
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/**
 * A searchable list of all files with a checkbox each.
 * `selected` is a Set of message ids that is changed in place.
 */
export function filePicker(items, selected, { onChange } = {}) {
  let query = '';
  let kind = 'all';
  let shown = PAGE;

  const counter = h('div', { class: 'picker-count' });
  const list = h('ul', { class: 'picker-list' });
  const more = h('button', { class: 'btn btn-wide', type: 'button', onclick: () => { shown += PAGE; draw(); } }, '');

  const filtered = () => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (it) => (kind === 'all' || it.kind === kind) && (!q || it.name.toLowerCase().includes(q) || it.caption.toLowerCase().includes(q))
    );
  };

  const updateCounter = () => {
    let bytes = 0;
    let n = 0;
    for (const it of items) if (selected.has(it.id)) { n++; bytes += it.size || 0; }
    counter.textContent = `נבחרו ${n.toLocaleString()} מתוך ${items.length.toLocaleString()} קבצים · ${formatBytes(bytes)}`;
    summaryCount.textContent = `(${n.toLocaleString()}/${items.length.toLocaleString()})`;
  };

  const row = (it) => {
    const cb = h('input', {
      type: 'checkbox',
      checked: selected.has(it.id),
      onchange: () => {
        cb.checked ? selected.add(it.id) : selected.delete(it.id);
        updateCounter();
        onChange?.();
      },
    });
    return h(
      'li',
      {},
      h('label', { class: 'picker-row' },
        cb,
        h('span', { class: 'picker-icon' }, KINDS[it.kind]?.icon || ''),
        h('span', { class: 'grow picker-name' }, fileName(it.name), it.caption && !it.name.startsWith(it.caption.slice(0, 20)) ? h('div', { class: 'muted small clip' }, it.caption.split('\n')[0]) : null),
        h('span', { class: 'muted small nowrap' }, formatBytes(it.size)),
        h('span', { class: 'muted small nowrap' }, formatDate(it.date))
      )
    );
  };

  const draw = () => {
    const f = filtered();
    list.replaceChildren(...f.slice(0, shown).map(row));
    if (!f.length) list.append(h('li', { class: 'muted center' }, 'אין קבצים שמתאימים לחיפוש'));
    more.hidden = f.length <= shown;
    more.textContent = `הצג עוד (${(f.length - shown).toLocaleString()} נוספים)`;
    updateCounter();
  };

  const setAll = (on) => {
    for (const it of filtered()) on ? selected.add(it.id) : selected.delete(it.id);
    draw();
    onChange?.();
  };

  const search = h('input', { type: 'text', placeholder: '🔍 חיפוש לפי שם או טקסט של הפוסט', oninput: (e) => { query = e.target.value; shown = PAGE; draw(); } });
  const kindSelect = h(
    'select',
    { onchange: (e) => { kind = e.target.value; shown = PAGE; draw(); } },
    h('option', { value: 'all' }, 'כל הסוגים'),
    ...Object.entries(KINDS).map(([k, m]) => h('option', { value: k }, `${m.icon} ${m.label}`))
  );

  const summaryCount = h('span', { class: 'muted' });
  const node = h(
    'details',
    { class: 'picker', open: items.length <= 60 },
    h('summary', {}, h('b', {}, '📋 רשימת הקבצים — בחירה אחד-אחד '), summaryCount),
    h('div', { class: 'stack picker-body' },
      h('div', { class: 'row wrap' }, search, kindSelect),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', type: 'button', onclick: () => setAll(true) }, '☑️ סמן הכול'),
        h('button', { class: 'btn', type: 'button', onclick: () => setAll(false) }, '⬜ נקה הכול'),
        h('span', { class: 'muted small' }, '(פועל על מה שמוצג לפי החיפוש)')
      ),
      counter,
      list,
      more
    )
  );
  node.refresh = draw;
  draw();
  return node;
}
