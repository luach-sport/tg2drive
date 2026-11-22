import { h, progressBar, setBar } from '../dom.js';
import { resolveChannel } from '../../services/tg-channel.js';
import { scanChannel, loadPost } from '../../services/tg-media.js';
import { getItem, setItem } from '../../core/storage.js';
import { percent } from '../../core/format.js';

export function channelScreen(ctx, { me, onLogout, onScanned }) {
  const input = h('input', {
    type: 'url',
    dir: 'ltr',
    class: 'big-input',
    placeholder: 'https://t.me/...',
    value: getItem('lastLink', '') || '',
  });
  const btn = h('button', { class: 'btn btn-primary btn-wide', type: 'submit' }, 'המשך');
  const status = h('div', { class: 'stack' });

  const run = async () => {
    const link = input.value.trim();
    if (!link) return;
    btn.disabled = true;
    input.disabled = true;
    status.replaceChildren(h('p', {}, 'מחפש את הערוץ...'));
    try {
      const channel = await resolveChannel(link);
      setItem('lastLink', link);
      if (channel.postId) {
        status.replaceChildren(h('p', {}, 'טוען את הפוסט...'));
        ctx.channel = channel;
        ctx.scan = await loadPost(channel.entity, channel.postId);
        return onScanned();
      }
      const bar = progressBar(0);
      const line = h('p', { class: 'muted' }, 'סורק את הפוסטים...');
      status.replaceChildren(h('p', {}, h('b', {}, channel.title)), bar, line);
      const scan = await scanChannel(channel.entity, ({ seen, total, found }) => {
        setBar(bar, percent(seen, total));
        line.textContent = `נסרקו ${seen.toLocaleString()} מתוך ${total.toLocaleString()} פוסטים · נמצאו ${found.toLocaleString()} קבצים`;
      });
      ctx.channel = channel;
      ctx.scan = scan;
      onScanned();
    } catch (e) {
      status.replaceChildren(h('div', { class: 'alert alert-error' }, e.errorMessage === 'USERNAME_INVALID' || e.errorMessage === 'USERNAME_NOT_OCCUPIED' ? 'לא מצאתי ערוץ כזה. בדוק את הקישור.' : e.message || String(e)));
      btn.disabled = false;
      input.disabled = false;
    }
  };

  return h(
    'section',
    { class: 'stack' },
    h(
      'form',
      { class: 'card stack', onsubmit: (e) => (e.preventDefault(), run()) },
      h('h2', {}, 'מה להעתיק?'),
      h('p', { class: 'muted' }, 'הדבק קישור לערוץ שלם, או קישור לפוסט מסוים (בטלגרם: קליק ימני על הפוסט ← העתק קישור).'),
      input,
      btn,
      status
    ),
    h(
      'p',
      { class: 'muted small center' },
      `מחובר לטלגרם בתור ${[me?.firstName, me?.lastName].filter(Boolean).join(' ') || me?.username || ''} · `,
      h('a', { href: '#', onclick: (e) => (e.preventDefault(), onLogout()) }, 'התנתקות')
    )
  );
}
