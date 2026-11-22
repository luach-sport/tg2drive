import { h, progressBar, setBar, fileName } from '../dom.js';
import { formatBytes, formatDuration, percent } from '../../core/format.js';
import { initGoogle, requestToken, hasToken } from '../../services/google-auth.js';
import { readJson, writeJson, STATUS_FILE, COMMANDS_FILE } from '../../services/drive-appdata.js';
import { statusList } from '../components/status-list.js';
import { sleep } from '../../core/bytes.js';

const STATE_TEXT = {
  preparing: 'בודק מה כבר נמצא בדרייב...',
  running: '🔄 מעתיק',
  paused: '⏸ מושהה',
  needAuth: '🔑 במחשב צריך לחדש את החיבור לגוגל',
  watching: '👀 מחכה לפוסטים חדשים...',
  done: '✅ הסתיים',
  stopped: '⏹ נעצר',
};
const LOG_ICON = { ok: '✅', error: '❌', retry: '🔁' };

/** Phone screen: shows what the computer is doing right now, and sends it links and commands. */
export function remoteViewScreen(ctx, { onLeave }) {
  const conn = h('div', { class: 'conn' });
  const signInBox = h('div', { class: 'card stack center' });
  const main = h('div', { class: 'stack', hidden: true });

  // --- send a link ---
  const linkInput = h('input', { type: 'url', dir: 'ltr', class: 'big-input', placeholder: 'https://t.me/...' });
  const sendMsg = h('div', { class: 'small' });
  const sendForm = h(
    'form',
    { class: 'card stack', onsubmit: (e) => (e.preventDefault(), sendLink()) },
    h('h3', {}, '➕ שלח קישור למחשב'),
    h('p', { class: 'muted small' }, 'ערוץ שלם או פוסט בודד. המחשב יתחיל להעתיק אותו (או יחכה שההעתקה הנוכחית תסתיים).'),
    linkInput,
    h('button', { class: 'btn btn-primary btn-wide', type: 'submit' }, '📤 שלח למחשב'),
    sendMsg
  );

  // --- live status ---
  const title = h('h2', {});
  const stateLine = h('div', { class: 'state-line' });
  const hostMsg = h('div', { class: 'muted small' });
  const overallBar = progressBar(0, 'bar-big');
  const overallText = h('div', { class: 'muted small' });
  const counts = h('div', { class: 'counts' });
  const curName = h('div', { class: 'cur-name' });
  const curBar = progressBar(0);
  const curText = h('div', { class: 'muted small' });
  const curBox = h('div', { class: 'stack', hidden: true }, curName, curBar, curText);
  const pendingBox = h('div', { class: 'small' });
  const btns = h('div', { class: 'row wrap' });
  const statusCard = h('div', { class: 'card stack' }, title, stateLine, hostMsg, overallBar, overallText, counts, curBox, pendingBox, btns);
  const log = h('ul', { class: 'log' });

  // statusList expects a transfer-like object; we fill it from each snapshot
  const mirror = { files: [], status: new Map(), current: null };
  const files = statusList(mirror);

  main.append(statusCard, sendForm, files, h('div', { class: 'card stack' }, h('h3', {}, 'יומן'), log));

  let alive = true;
  let snap = null;

  const command = async (type, extra = {}) => {
    const data = (await readJson(COMMANDS_FILE).catch(() => null)) || { cmds: [] };
    const cmds = (data.cmds || []).filter((c) => Date.now() - c.ts < 24 * 3600 * 1000).slice(-30);
    cmds.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now(), type, ...extra });
    await writeJson(COMMANDS_FILE, { cmds });
  };

  const sendLink = async () => {
    const link = linkInput.value.trim();
    if (!/t\.me\/|^@/.test(link)) {
      sendMsg.replaceChildren(h('span', { class: 'bad' }, 'זה לא נראה כמו קישור טלגרם'));
      return;
    }
    sendMsg.replaceChildren('שולח...');
    try {
      await command('link', { link });
      linkInput.value = '';
      sendMsg.replaceChildren(h('span', { class: 'ok' }, '✅ נשלח. המחשב יקלוט אותו תוך כמה שניות.'));
    } catch (e) {
      sendMsg.replaceChildren(h('span', { class: 'bad' }, e.authNeeded ? 'צריך להתחבר שוב לגוגל (למעלה)' : e.message));
      if (e.authNeeded) showSignIn();
    }
  };

  const btn = (label, type, cls = '') =>
    h('button', { class: `btn ${cls}`, type: 'button', onclick: async (e) => {
      e.target.disabled = true;
      try { await command(type); } catch (err) { if (err.authNeeded) showSignIn(); }
      setTimeout(() => (e.target.disabled = false), 3000);
    } }, label);

  const render = () => {
    const age = snap ? Math.round((Date.now() - snap.ts) / 1000) : null;
    conn.replaceChildren(
      age === null
        ? h('span', { class: 'muted' }, '⏳ מחכה לעדכון ראשון מהמחשב...')
        : age > 45
          ? h('span', { class: 'bad' }, `⚠️ המחשב לא עדכן כבר ${formatDuration(age)}. ודא שהאתר פתוח במחשב ושהשליטה מהטלפון פעילה שם.`)
          : h('span', { class: 'ok' }, `🟢 מחובר למחשב · עדכון לפני ${age} שנ'`)
    );
    if (!snap) return;

    hostMsg.textContent = [snap.message, snap.lastResult].filter(Boolean).join(' · ');
    pendingBox.replaceChildren(...(snap.pending?.length ? [h('b', {}, 'ממתינים בתור: '), snap.pending.join(' , ')] : []));

    const t = snap.transfer;
    if (!t) {
      title.textContent = 'המחשב פנוי';
      stateLine.textContent = snap.busy ? 'מכין העתקה...' : 'שלח קישור כדי להתחיל';
      overallBar.hidden = true;
      overallText.textContent = '';
      counts.replaceChildren();
      curBox.hidden = true;
      btns.replaceChildren();
      return;
    }
    title.replaceChildren(`${t.channel} ← 📁 `, t.folder.url ? h('a', { href: t.folder.url, target: '_blank', rel: 'noopener' }, t.folder.name) : t.folder.name);
    stateLine.textContent = STATE_TEXT[t.state] || t.state;
    stateLine.dataset.state = t.state;
    const s = t.stats;
    const done = s.doneBytes + (t.current?.sent || 0);
    overallBar.hidden = false;
    setBar(overallBar, percent(done, s.totalBytes));
    const eta = t.speed ? (s.totalBytes - done) / t.speed : Infinity;
    overallText.textContent = s.totalBytes
      ? `${formatBytes(done)} מתוך ${formatBytes(s.totalBytes)} · ${percent(done, s.totalBytes).toFixed(1)}%${t.speed ? ` · נשאר בערך ${formatDuration(eta)}` : ''}`
      : '';
    counts.replaceChildren(
      h('span', {}, `✅ ${s.doneFiles}/${s.totalFiles}`),
      s.skipped ? h('span', {}, `⏭ ${s.skipped} כבר היו`) : null,
      s.failed ? h('span', { class: 'bad' }, `❌ ${s.failed} נכשלו`) : null
    );

    const curFile = t.current && t.files.find((f) => f[0] === t.current.id);
    curBox.hidden = !curFile;
    if (curFile) {
      curName.replaceChildren('🔄 ', fileName(curFile[1]));
      setBar(curBar, percent(t.current.sent, t.current.size));
      curText.textContent = `${formatBytes(t.current.sent)} מתוך ${formatBytes(t.current.size)} · ${percent(t.current.sent, t.current.size).toFixed(0)}% · ⬇ ${formatBytes(t.dl)} לשנייה · ⬆ ${formatBytes(t.speed)} לשנייה`;
    }

    const finished = ['done', 'stopped'].includes(t.state);
    btns.replaceChildren(
      ...(finished
        ? [s.failed ? btn('🔁 נסה שוב את מה שנכשל', 'retry') : null]
        : [t.state === 'paused' ? btn('▶️ המשך', 'resume') : btn('⏸ השהיה', 'pause'), btn('⏹ עצירה', 'stop', 'btn-danger')])
    );

    // file list + log
    mirror.files = t.files.map(([id, name, size, , link, error]) => ({ id, name, size, driveFile: link ? { webViewLink: link } : null, error }));
    mirror.status = new Map(t.files.map(([id, , , st]) => [id, st]));
    mirror.current = t.current ? { item: { id: t.current.id }, sent: t.current.sent, size: t.current.size } : null;
    files.refresh();
    log.replaceChildren(
      ...t.log.map(([name, status, text]) =>
        h('li', {}, h('span', {}, LOG_ICON[status] || '•'), h('span', { class: 'grow' }, name ? fileName(name) : '', text ? h('div', { class: 'muted small' }, text) : null))
      )
    );
  };

  const poll = async () => {
    while (alive) {
      if (hasToken()) {
        try {
          const s = await readJson(STATUS_FILE);
          if (s) snap = s;
          render();
        } catch (e) {
          if (e.authNeeded) showSignIn();
        }
      }
      await sleep(3000);
    }
  };

  const showSignIn = () => {
    signInBox.hidden = false;
    main.hidden = true;
  };

  signInBox.append(
    h('h2', {}, '📱 שליטה מהטלפון'),
    h('p', { class: 'muted' }, 'התחבר עם אותו חשבון גוגל שמחובר במחשב.'),
    h('button', { class: 'btn btn-primary btn-wide', type: 'button', onclick: async (e) => {
      try {
        await requestToken('');
        signInBox.hidden = true;
        main.hidden = false;
        render();
      } catch (err) {
        e.target.after(h('div', { class: 'alert alert-error' }, err.message));
      }
    } }, '🔑 התחבר לגוגל')
  );

  initGoogle(ctx.settings).catch((e) => signInBox.append(h('div', { class: 'alert alert-error' }, e.message)));
  poll();

  const node = h(
    'section',
    { class: 'stack' },
    conn,
    signInBox,
    main,
    h('p', { class: 'muted small center' }, h('a', { href: '#', onclick: (e) => (e.preventDefault(), onLeave()) }, 'יציאה ממצב שליטה (להעתיק מהטלפון עצמו)'))
  );
  node.cleanup = () => (alive = false);
  return node;
}
