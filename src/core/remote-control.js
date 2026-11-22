import { RemoteHost } from './remote-host.js';
import { resolveChannel } from '../services/tg-channel.js';
import { scanChannel, loadPost, KINDS } from '../services/tg-media.js';
import { createFolder } from '../services/drive-api.js';
import { writeJson, SCAN_FILE } from '../services/drive-appdata.js';
import { getItem } from './storage.js';

const FINISHED = ['done', 'stopped'];

/**
 * Computer side: runs links sent from the phone and reports what is happening.
 * startTransfer({ channel, scan, folder, mode, kinds, selectedIds }) is the same function the screens use.
 */
export function createRemoteControl({ ctx, startTransfer, onChange }) {
  const pending = []; // { link, ids? } waiting their turn
  let busy = false;
  let scanning = false;
  let cache = null; // { link, channel, scan } — the last channel read for the phone
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

    const { link, ids } = pending.shift();
    busy = true;
    try {
      const { channel, scan } = cache?.link === link ? cache : await readLink(link);
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
        selectedIds: ids ? new Set(ids) : null,
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

  async function readLink(link) {
    setMessage(`פותח את הקישור: ${link}`);
    const channel = await resolveChannel(link);
    const scan = channel.postId
      ? await loadPost(channel.entity, channel.postId)
      : await scanChannel(channel.entity, ({ seen, total, found }) =>
          setMessage(`סורק את "${channel.title}": ${seen.toLocaleString()} מתוך ${total.toLocaleString()} פוסטים · ${found.toLocaleString()} קבצים`)
        );
    cache = { link, channel, scan };
    return cache;
  }

  // the phone asked to see the files of a channel before choosing
  async function scanForPhone(cmd) {
    if (scanning) return;
    scanning = true;
    try {
      const { channel, scan } = await readLink(cmd.link);
      await writeJson(SCAN_FILE, {
        ts: Date.now(),
        req: cmd.id,
        link: cmd.link,
        title: channel.title,
        items: scan.items.map((i) => [i.id, i.name, i.size, i.kind, i.date, (i.caption || '').split('\n')[0].slice(0, 120)]),
      });
      lastResult = `נסרק: ${channel.title} (${scan.items.length} קבצים) — בחר בטלפון`;
    } catch (e) {
      await writeJson(SCAN_FILE, { ts: Date.now(), req: cmd.id, link: cmd.link, error: e.message || String(e) }).catch(() => {});
      lastResult = `שגיאה בסריקה: ${e.message || e}`;
    } finally {
      scanning = false;
      setMessage('');
    }
  }

  async function onCommand(cmd) {
    const t = ctx.transfer;
    if (cmd.type === 'scan' && cmd.link) {
      scanForPhone(cmd); // runs in the background
    } else if (cmd.type === 'start' && cmd.link) {
      pending.push({ link: cmd.link, ids: cmd.ids });
      lastResult = `התקבלה בחירה של ${cmd.ids?.length || 0} קבצים מהטלפון${transferRunning() ? ' (ימתין לסיום ההעתקה הנוכחית)' : ''}`;
    } else if (cmd.type === 'link' && cmd.link) {
      pending.push({ link: cmd.link });
      lastResult = `התקבל קישור מהטלפון${transferRunning() ? ' (ימתין לסיום ההעתקה הנוכחית)' : ''}`;
    } else if (cmd.type === 'pause') t?.pause();
    else if (cmd.type === 'resume') t?.resume();
    else if (cmd.type === 'stop') t?.stop();
    else if (cmd.type === 'retry') t?.retryFailed();
    else if (cmd.type === 'item') t?.itemAction(cmd.fileId, cmd.action);
    onChange?.();
  }

  function snapshot() {
    const t = ctx.transfer;
    return {
      v: 1,
      message,
      lastResult,
      pending: pending.map((p) => (p.ids ? `${p.link} (${p.ids.length} קבצים)` : p.link)),
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
