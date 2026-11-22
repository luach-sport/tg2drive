import { h, fileName, progressBar } from '../dom.js';
import { formatBytes, percent } from '../../core/format.js';

const STATES = {
  waiting: { icon: '⏳', label: 'ממתינים' },
  active: { icon: '🔄', label: 'מועתק עכשיו' },
  done: { icon: '✅', label: 'הועתקו' },
  exists: { icon: '⏭', label: 'כבר היו בדרייב' },
  failed: { icon: '❌', label: 'נכשלו' },
  held: { icon: '⏸', label: 'מושהים' },
  cancelled: { icon: '🚫', label: 'בוטלו' },
};

// buttons per state: [action, icon, tooltip]
const ACTIONS = {
  waiting: [['hold', '⏸', 'השהה את השיעור הזה'], ['cancel', '✖', 'בטל את השיעור הזה']],
  active: [['hold', '⏸', 'השהה את השיעור הזה'], ['cancel', '✖', 'בטל את השיעור הזה']],
  held: [['resume', '▶️', 'המשך מאותה נקודה'], ['cancel', '✖', 'בטל']],
  cancelled: [['resume', '↩️', 'החזר לתור']],
  failed: [['retry', '🔁', 'נסה שוב']],
};
const PAGE = 300;

/** Openable list with the state of every file in the run. Call .refresh() to redraw. */
export function statusList(transfer, { onAction } = {}) {
  let filter = 'all';
  let shown = PAGE;
  let lastDraw = 0;

  const tabs = h('div', { class: 'row wrap tabs' });
  const list = h('ul', { class: 'picker-list' });
  const more = h('button', { class: 'btn btn-wide', type: 'button', onclick: () => { shown += PAGE; draw(true); } });
  const summaryCount = h('span', { class: 'muted' });

  const counts = () => {
    const c = { all: transfer.files.length };
    for (const k of Object.keys(STATES)) c[k] = 0;
    for (const f of transfer.files) c[transfer.status.get(f.id)]++;
    return c;
  };

  const row = (it) => {
    const st = transfer.status.get(it.id);
    const cur = transfer.current?.item?.id === it.id ? transfer.current : null;
    return h(
      'li',
      { class: `status-${st}` },
      h('div', { class: 'picker-row' },
        h('span', { class: 'picker-icon', title: STATES[st]?.label }, STATES[st]?.icon || ''),
        h('span', { class: 'grow picker-name' },
          fileName(it.name),
          cur ? progressBar(percent(cur.sent, cur.size), 'bar-mini') : null,
          st === 'failed' && it.error ? h('div', { class: 'small bad' }, it.error) : null
        ),
        h('span', { class: 'muted small nowrap' }, cur ? `${percent(cur.sent, cur.size).toFixed(0)}% · ` : '', formatBytes(it.size)),
        it.driveFile?.webViewLink ? h('a', { href: it.driveFile.webViewLink, target: '_blank', rel: 'noopener', class: 'small' }, 'פתח') : null,
        onAction
          ? h('span', { class: 'row-actions' },
              ...(ACTIONS[st] || []).map(([a, icon, tip]) =>
                h('button', { type: 'button', class: 'mini-btn', title: tip, 'aria-label': tip, onclick: (e) => {
                  e.preventDefault();
                  e.target.disabled = true;
                  onAction(it.id, a);
                  setTimeout(() => draw(true), 300);
                } }, icon)
              ))
          : null
      )
    );
  };

  const draw = (force = false) => {
    const c = counts();
    summaryCount.textContent = `(${c.done + c.exists}/${c.all} מוכנים${c.failed ? ` · ${c.failed} נכשלו` : ''})`;
    if (!node.open) return;
    const now = Date.now();
    if (!force && now - lastDraw < 1000) return; // big lists: redraw at most once a second
    lastDraw = now;

    tabs.replaceChildren(
      ...[['all', '📋 הכול'], ...Object.entries(STATES).map(([k, v]) => [k, `${v.icon} ${v.label}`])].map(([k, label]) =>
        h('button', { type: 'button', class: `btn btn-small${filter === k ? ' btn-primary' : ''}`, onclick: () => { filter = k; shown = PAGE; draw(true); } }, `${label} (${c[k].toLocaleString()})`)
      )
    );
    const f = filter === 'all' ? transfer.files : transfer.files.filter((it) => transfer.status.get(it.id) === filter);
    list.replaceChildren(...f.slice(0, shown).map(row));
    if (!f.length) list.append(h('li', { class: 'muted center' }, 'אין קבצים כאן'));
    more.hidden = f.length <= shown;
    more.textContent = `הצג עוד (${(f.length - shown).toLocaleString()})`;
  };

  const node = h(
    'details',
    { class: 'card picker', ontoggle: () => draw(true) },
    h('summary', {}, h('b', {}, '📋 כל הקבצים ומה קורה עם כל אחד '), summaryCount),
    h('div', { class: 'stack picker-body' }, tabs, list, more)
  );
  node.refresh = draw;
  return node;
}
