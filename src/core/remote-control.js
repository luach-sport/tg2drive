import { RemoteHost } from './remote-host.js';
import { resolveChannel } from '../services/tg-channel.js';
import { scanChannel, loadPost, KINDS } from '../services/tg-media.js';
import { createFolder } from '../services/drive-api.js';
import { getItem } from './storage.js';

const FINISHED = ['done', 'stopped'];

/**
 * Computer side: runs links sent from the phone and reports what is happening.
 * startTransfer({ channel, scan, folder, mode, kinds, selectedIds }) is the same function the screens use.
 */
export function createRemoteControl({ ctx, startTransfer, onChange }) {
  const pending = []; // links waiting their turn
  let busy = false;
  let message = '';
  let lastResult = '';

  const setMessage = (m) => {
    message = m;
    onChange?.();
  };

  const transferRunning = () => ctx.transfer && !FINISHED.includes(ctx.transfer.state);

  async function processQueue() {
    if (busy || !pending.length) return;
    // a run that only waits for new posts gives way to a new link
    if (ctx.transfer?.state === 'watching') ctx.transfer.stop();
    if (transferRunning()) return;

    const link = pending.shift();
    busy = true;
    try {
      setMessage(`פותח את הקישור: ${link}`);
      const channel = await resolveChannel(link);
      let scan;
      if (channel.postId) {
        scan = await loadPost(channel.entity, channel.postId);
      } else {
        scan = await scanChannel(channel.entity, ({ seen, total, found }) =>
          setMessage(`סורק את "${channel.title}": ${seen.toLocaleString()} מתוך ${total.toLocaleString()} פוסטים · ${found.toLocaleString()} קבצים`)
        );
      }
      const saved = getItem(`opts.${channel.id}`, {}) || {};
      if (channel.protectedContent && !saved.confirmedProtected) {
        throw new Error(`הערוץ "${channel.title}" חוסם שמירת תוכן. צריך לפתוח אותו פעם אחת במחשב ולאשר שמותר לך.`);
      }
      let folder = saved.folder || getItem('lastFolder', null);
      if (!folder) {
        const f = await createFolder(channel.title);
        folder = { id: f.id, name: f.name, url: f.webViewLink };
      }
      setMessage('');
      lastResult = `התחיל: ${channel.title}`;
      await startTransfer({
        channel,
        scan,
        folder,
        mode: 'archive',
        kinds: Object.keys(KINDS),
        selectedIds: null,
        fromPhone: true,
      });
    } catch (e) {
      lastResult = `שגיאה בקישור ${link}: ${e.message || e}`;
      setMessage('');
    } finally {
      busy = false;
      onChange?.();
    }
  }

  async function onCommand(cmd) {
    const t = ctx.transfer;
    if (cmd.type === 'link' && cmd.link) {
      pending.push(cmd.link);
      lastResult = `התקבל קישור מהטלפון${transferRunning() ? ' (ימתין לסיום ההעתקה הנוכחית)' : ''}`;
    } else if (cmd.type === 'pause') t?.pause();
    else if (cmd.type === 'resume') t?.resume();
    else if (cmd.type === 'stop') t?.stop();
    else if (cmd.type === 'retry') t?.retryFailed();
    onChange?.();
  }

  function snapshot() {
    const t = ctx.transfer;
    return {
      v: 1,
      message,
      lastResult,
      pending: [...pending],
      busy,
      transfer: t
        ? {
            state: t.state,
            channel: ctx.channel?.title || '',
            folder: { name: t.folder.name, url: t.folder.url || '' },
            stats: t.stats,
            speed: Math.round(t.speed()),
            dl: Math.round(t.downloadSpeed()),
            current: t.current ? { id: t.current.item.id, sent: t.current.sent, size: t.current.size, attempt: t.current.attempt } : null,
            files: t.files.slice(0, 3000).map((f) => [f.id, f.name, f.size, t.status.get(f.id), f.driveFile?.webViewLink || '', f.error || '']),
            log: t.log.slice(0, 15).map((l) => [l.item?.name || '', l.status, l.text || '']),
          }
        : null,
    };
  }

  const host = new RemoteHost({
    getSnapshot: snapshot,
    onCommand,
    onTick: () => {
      processQueue();
      onChange?.();
    },
  });

  return { host, pending, snapshot };
}
