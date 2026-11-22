import '@fontsource-variable/heebo';
import './styles/main.css';
import { ctx, show } from './ui/app.js';
import { h } from './ui/dom.js';
import { loadSettings, isComplete } from './config/settings.js';
import { getClient, isLoggedIn, getMe, logout } from './services/tg-client.js';
import { settingsScreen } from './ui/screens/settings.js';
import { loginScreen } from './ui/screens/login.js';
import { channelScreen } from './ui/screens/channel.js';
import { optionsScreen } from './ui/screens/options.js';
import { progressScreen } from './ui/screens/progress.js';
import { Transfer } from './core/transfer.js';
import { latestMessageId } from './services/tg-media.js';
import { initTheme, toggleTheme } from './ui/theme.js';
import { consumePairingLink } from './config/pairing.js';
import { getItem, setItem, removeItem } from './core/storage.js';
import { createRemoteControl } from './core/remote-control.js';
import { openPhoneLink } from './ui/components/phone-link.js';
import { remoteViewScreen } from './ui/screens/remote-view.js';

consumePairingLink(); // opened from the QR on the computer? save the keys and go to phone mode

initTheme();
document.getElementById('theme-btn').addEventListener('click', toggleTheme);
document.getElementById('settings-btn').addEventListener('click', () => {
  if (ctx.transfer && !['done', 'stopped'].includes(ctx.transfer.state)) return alert('אפשר לפתוח הגדרות אחרי שההעתקה נגמרת או נעצרת');
  show(settingsScreen, () => location.reload());
});

function loading(text) {
  return () => h('div', { class: 'card center' }, h('div', { class: 'spinner' }), h('p', {}, text));
}

const phoneBtn = document.getElementById('phone-btn');
let remote = null;

function updatePhoneBtn() {
  const on = remote?.host.running && !remote.host.authNeeded;
  phoneBtn.classList.toggle('on', Boolean(on));
  phoneBtn.classList.toggle('warn', Boolean(remote?.host.authNeeded));
}

phoneBtn.addEventListener('click', () => {
  if (!remote) return alert('קודם צריך להשלים את ההגדרות וההתחברות לטלגרם');
  openPhoneLink({ settings: ctx.settings, remote });
});

async function boot() {
  ctx.settings = loadSettings();
  if (!isComplete(ctx.settings)) return show(settingsScreen, boot);

  if (getItem('mode', 'host') === 'remote') {
    phoneBtn.hidden = true;
    return show(remoteViewScreen, {
      onLeave: () => {
        removeItem('mode');
        location.reload();
      },
    });
  }

  show(loading('מתחבר לטלגרם...'));
  try {
    await Promise.race([
      getClient(ctx.settings),
      new Promise((_, rej) => setTimeout(() => rej(new Error('אין תגובה מטלגרם. בדוק חיבור לאינטרנט, או שה-api_id שגוי.')), 45000)),
    ]);
  } catch (e) {
    return show(() => h('div', { class: 'card stack' }, h('div', { class: 'alert alert-error' }, `לא הצלחתי להתחבר לטלגרם: ${e.message}`), h('button', { class: 'btn', onclick: () => location.reload() }, 'נסה שוב')));
  }
  remote = createRemoteControl({ ctx, startTransfer, onChange: updatePhoneBtn });
  if (!(await isLoggedIn())) return show(loginScreen, goChannel);
  goChannel();
}

// Starts copying and opens the progress screen. Used by the screens and by links sent from the phone.
async function startTransfer({ channel, scan, folder, mode, kinds, selectedIds }) {
  if (channel) ctx.channel = channel;
  if (scan) ctx.scan = scan;
  setItem('lastFolder', folder);
  show(loading('מתחיל...'));
  const lastId = mode === 'new' ? await latestMessageId(ctx.channel.entity) : ctx.scan.lastId;
  const t = new Transfer({ channel: ctx.channel, folder, kinds, mode, items: ctx.scan.items, lastId, selectedIds });
  ctx.transfer = t;
  show(progressScreen, { onFinish: goChannel });
  t.start().catch((e) => {
    alert(`שגיאה: ${e.message}`);
    t.stop();
  });
}

async function goChannel() {
  const me = await getMe().catch(() => null);
  ctx.transfer = null;
  show(channelScreen, {
    me,
    onLogout: async () => {
      if (!confirm('להתנתק מטלגרם בדפדפן הזה?')) return;
      await logout();
      location.reload();
    },
    onScanned: goOptions,
  });
}

function goOptions() {
  show(optionsScreen, {
    onBack: goChannel,
    onStart: (opts) => startTransfer(opts),
  });
}

boot();
