import { h, progressBar, setBar, fileName } from '../dom.js';
import { formatBytes, formatDuration, percent } from '../../core/format.js';
import { requestToken } from '../../services/google-auth.js';
import { KINDS } from '../../services/tg-media.js';
import { statusList } from '../components/status-list.js';

const STATE_TEXT = {
  preparing: 'בודק מה כבר נמצא בדרייב...',
  running: 'מעתיק',
  paused: 'מושהה',
  needAuth: 'החיבור לגוגל פג — צריך לחדש',
  watching: 'מחכה לפוסטים חדשים (בודק כל דקה)...',
  done: 'הסתיים ✅',
  stopped: 'נעצר',
};

const LOG_ICON = { ok: '✅', error: '❌', retry: '🔁' };

export function progressScreen(ctx, { onFinish }) {
  const t = ctx.transfer;

  const stateLine = h('div', { class: 'state-line' });
  const overallBar = progressBar(0, 'bar-big');
  const overallText = h('div', { class: 'muted' });
  const counts = h('div', { class: 'counts' });

  const curName = h('div', { class: 'cur-name' });
  const curBar = progressBar(0);
  const curText = h('div', { class: 'muted small' });
  const speedText = h('div', { class: 'muted small' });
  const curBox = h('div', { class: 'card stack' }, h('h3', {}, 'הקובץ הנוכחי'), curName, curBar, curText, speedText);

  const authBox = h('div', { class: 'card stack warn', hidden: true },
    h('p', {}, 'גוגל מנתק את החיבור כל שעה בערך. לחץ כדי להמשיך מאותה נקודה:'),
    h('button', { class: 'btn btn-primary', onclick: async () => { try { await requestToken(''); t.authRenewed(); } catch (e) { alert(e.message); } } }, '🔑 חידוש החיבור לגוגל')
  );

  const pauseBtn = h('button', { class: 'btn', onclick: () => (t.state === 'paused' ? t.resume() : t.pause()) });
  const stopBtn = h('button', { class: 'btn btn-danger', onclick: () => { if (confirm('לעצור את ההעתקה? אפשר להמשיך אחר כך מאותה נקודה.')) t.stop(); } }, '⏹ עצירה');
  const retryBtn = h('button', { class: 'btn', hidden: true, onclick: () => t.retryFailed() }, '🔁 נסה שוב את מה שנכשל');
  const backBtn = h('button', { class: 'btn btn-primary', hidden: true, onclick: onFinish }, 'חזרה למסך הראשי');
  const log = h('ul', { class: 'log' });
  const files = statusList(t);

  let lastLogTop = null;
  let scheduled = false;

  const render = () => {
    scheduled = false;
    const s = t.stats;
    stateLine.textContent = STATE_TEXT[t.state] || t.state;
    stateLine.dataset.state = t.state;

    const curSent = t.current?.sent || 0;
    const done = s.doneBytes + curSent;
    setBar(overallBar, percent(done, s.totalBytes));
    const speed = t.speed();
    const eta = speed ? (s.totalBytes - done) / speed : Infinity;
    overallText.textContent = s.totalBytes
      ? `${formatBytes(done)} מתוך ${formatBytes(s.totalBytes)} · ${percent(done, s.totalBytes).toFixed(1)}%${speed ? ` · ${formatBytes(speed)} לשנייה · נשאר בערך ${formatDuration(eta)}` : ''}`
      : t.mode === 'new' ? 'עוד לא עלו פוסטים חדשים' : '';
    counts.replaceChildren(
      h('span', {}, `✅ ${s.doneFiles.toLocaleString()} / ${s.totalFiles.toLocaleString()} קבצים`),
      s.skipped ? h('span', {}, `⏭ ${s.skipped.toLocaleString()} כבר היו בדרייב`) : null,
      s.failed ? h('span', { class: 'bad' }, `❌ ${s.failed} נכשלו`) : null
    );

    if (t.current) {
      curBox.hidden = false;
      const it = t.current.item;
      curName.replaceChildren(`${KINDS[it.kind]?.icon || ''} `, fileName(it.name));
      setBar(curBar, percent(t.current.sent, t.current.size));
      const dl = t.downloadSpeed();
      curText.textContent = `${formatBytes(t.current.sent)} מתוך ${formatBytes(t.current.size)} · ${percent(t.current.sent, t.current.size).toFixed(0)}%${t.current.attempt > 1 ? ` · ניסיון ${t.current.attempt}` : ''}`;
      speedText.textContent = `⬇ הורדה מטלגרם: ${dl ? `${formatBytes(dl)} לשנייה` : '—'}   ·   ⬆ העלאה לדרייב: ${speed ? `${formatBytes(speed)} לשנייה` : '—'}`;
    } else {
      curBox.hidden = true;
    }

    authBox.hidden = t.state !== 'needAuth';
    const finished = t.state === 'done' || t.state === 'stopped';
    pauseBtn.hidden = finished;
    stopBtn.hidden = finished;
    pauseBtn.textContent = t.state === 'paused' ? '▶️ המשך' : '⏸ השהיה';
    pauseBtn.disabled = !['running', 'paused'].includes(t.state);
    retryBtn.hidden = !(s.failed && t.state !== 'stopped');
    backBtn.hidden = !finished;

    if (t.log[0] !== lastLogTop) {
      lastLogTop = t.log[0];
      log.replaceChildren(
        ...t.log.slice(0, 60).map((e) =>
          h('li', { class: `log-${e.status}` },
            h('span', {}, LOG_ICON[e.status] || '•'),
            h('span', { class: 'grow' }, e.item ? fileName(e.item.name) : '', e.text ? h('div', { class: 'muted small' }, e.text) : null),
            e.file?.webViewLink ? h('a', { href: e.file.webViewLink, target: '_blank', rel: 'noopener' }, 'פתח') : null)
        )
      );
    }
    files.refresh();
    document.title = t.state === 'running' && s.totalBytes ? `${percent(done, s.totalBytes).toFixed(0)}% · מטלגרם לדרייב` : 'מטלגרם לדרייב';
  };

  // redraw at most ~4 times a second
  t.onUpdate = () => {
    if (!scheduled) {
      scheduled = true;
      setTimeout(render, 250);
    }
  };

  // keep the screen awake and warn before closing the tab
  let wakeLock = null;
  const lock = async () => {
    try {
      if (!wakeLock && navigator.wakeLock && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen');
      wakeLock?.addEventListener('release', () => (wakeLock = null));
    } catch {
      /* not supported */
    }
  };
  const onVisible = () => document.visibilityState === 'visible' && lock();
  const beforeUnload = (e) => {
    if (!['done', 'stopped'].includes(t.state)) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  lock();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('beforeunload', beforeUnload);

  render();

  const node = h(
    'section',
    { class: 'stack' },
    h('div', { class: 'card stack' },
      h('h2', {}, `${ctx.channel.title} ← 📁 ${t.folder.name}`),
      stateLine, overallBar, overallText, counts,
      h('div', { class: 'row wrap' }, pauseBtn, stopBtn, retryBtn, backBtn)
    ),
    authBox,
    curBox,
    files,
    h('div', { class: 'card stack' }, h('h3', {}, 'יומן'), log),
    h('p', { class: 'muted small center' }, 'השאר את הדף פתוח עד הסוף. אם הוא נסגר, פתח שוב ובחר את אותה תיקייה, וההעתקה תמשיך מהמקום שנעצרה.')
  );
  node.cleanup = () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('beforeunload', beforeUnload);
    wakeLock?.release().catch(() => {});
    t.onUpdate = null;
  };
  return node;
}
