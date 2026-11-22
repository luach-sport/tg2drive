import QRCode from 'qrcode';
import { h } from '../dom.js';
import { pairingUrl } from '../../config/pairing.js';
import { initGoogle, requestToken, hasToken } from '../../services/google-auth.js';

/** Window on the computer: turns on phone control and shows the QR to scan. */
export function openPhoneLink({ settings, remote, onStarted }) {
  const statusLine = h('p', { class: 'center' });
  const qrBox = h('div', { class: 'qr-box' }, h('div', { class: 'spinner' }));
  const msg = h('div');
  const startBtn = h('button', { class: 'btn btn-primary', type: 'button' }, '🔑 התחבר לגוגל והפעל');

  const draw = () => {
    const host = remote.host;
    if (host.running && !host.authNeeded) {
      startBtn.hidden = true;
      const ago = host.lastOk ? Math.round((Date.now() - host.lastOk) / 1000) : null;
      statusLine.replaceChildren(h('b', { class: 'ok' }, '✅ השליטה מהטלפון פעילה'), ago !== null ? h('span', { class: 'muted small' }, ` · עדכון לפני ${ago} שנ'`) : '');
    } else if (host.authNeeded) {
      startBtn.hidden = false;
      startBtn.textContent = '🔑 חדש את החיבור לגוגל';
      statusLine.replaceChildren(h('b', { class: 'bad' }, 'החיבור לגוגל פג — לחץ כדי לחדש'));
    } else {
      startBtn.hidden = false;
      statusLine.replaceChildren(h('span', { class: 'muted' }, 'כדי שהטלפון יוכל לראות ולשלוח, המחשב צריך חיבור לגוגל.'));
    }
  };

  startBtn.onclick = async () => {
    msg.replaceChildren();
    try {
      await initGoogle(settings);
      if (!hasToken()) await requestToken('');
      remote.host.authRenewed();
      remote.host.start();
      onStarted?.();
      draw();
    } catch (e) {
      msg.replaceChildren(h('div', { class: 'alert alert-error' }, e.message || String(e)));
    }
  };

  QRCode.toCanvas(h('canvas'), pairingUrl(settings), { width: 240, margin: 2 }).then((c) => qrBox.replaceChildren(c));

  const timer = setInterval(draw, 1000);
  const close = () => {
    clearInterval(timer);
    overlay.remove();
  };
  const overlay = h(
    'div',
    { class: 'overlay', onclick: (e) => e.target === overlay && close() },
    h(
      'div',
      { class: 'card stack modal' },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, '📱 שליטה מהטלפון'), h('button', { class: 'icon-btn', type: 'button', onclick: close }, '✖')),
      statusLine,
      startBtn,
      msg,
      qrBox,
      h('ol', { class: 'qr-steps' },
        h('li', {}, 'פתח את המצלמה בטלפון וכוון אותה לקוד'),
        h('li', {}, 'לחץ על הקישור שמופיע — האתר ייפתח בטלפון'),
        h('li', {}, 'בטלפון לחץ "התחבר לגוגל" עם ', h('b', {}, 'אותו חשבון גוגל'), ' של המחשב')
      ),
      h('p', { class: 'muted small' }, 'מהטלפון תראה בזמן אמת מה המחשב מעתיק, ותוכל לשלוח לו קישורים חדשים, להשהות ולעצור. הדף במחשב צריך להישאר פתוח.'),
      h('p', { class: 'muted small' }, 'הקוד כולל את המפתחות שלך — אל תצלם אותו ואל תשלח אותו לאחרים.')
    )
  );
  document.body.append(overlay);
  draw();
}
