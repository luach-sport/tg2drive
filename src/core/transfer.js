import { concatBytes, sleep } from './bytes.js';
import * as tgMedia from '../services/tg-media.js';
import * as driveUpload from '../services/drive-upload.js';
import * as driveApi from '../services/drive-api.js';
import { getItem, setItem, removeItem } from './storage.js';

const REAL_DEPS = { ...tgMedia, ...driveUpload, ...driveApi };

const MAX_TRIES = 6;
const POLL_MS = 60 * 1000;

/**
 * Copies files from a Telegram channel into a Drive folder, one at a time.
 * Emits snapshots through onUpdate so the UI can draw progress bars.
 */
export class Transfer {
  constructor({ channel, folder, kinds, mode, items, lastId, onUpdate, selectedIds = null, deps = REAL_DEPS, pollMs = POLL_MS }) {
    this.selectedIds = selectedIds; // archive files the user ticked (null = all of the chosen kinds)
    this.d = deps;
    this.pollMs = pollMs;
    this.channel = channel; // { entity, id, title }
    this.folder = folder; // { id, name }
    this.kinds = new Set(kinds);
    this.mode = mode; // 'archive' | 'archive+new' | 'new'
    this.lastId = lastId;
    this.onUpdate = onUpdate;
    this.queue = [];
    this.log = [];
    this.state = 'idle'; // idle | running | paused | needAuth | watching | done | stopped
    this.stats = { totalFiles: 0, doneFiles: 0, skipped: 0, failed: 0, totalBytes: 0, doneBytes: 0 };
    this.current = null; // { item, sent, size }
    this.failedItems = [];
    this.files = []; // every file this run deals with, in order
    this.status = new Map(); // id -> 'waiting' | 'active' | 'done' | 'exists' | 'failed'
    this._initialItems = items || [];
    this._gate = null;
    this._authWaiter = null;
    this._speed = { t: Date.now(), bytes: 0, value: 0 };
  }

  async start() {
    this._set('preparing');
    const copied = await this.d.listCopiedIds(this.folder.id, this.channel.id);
    this.copied = copied;
    if (this.mode !== 'new') {
      const picked = this.selectedIds ? this._initialItems.filter((i) => this.selectedIds.has(i.id)) : this._initialItems;
      this._enqueue(picked, { anyKind: Boolean(this.selectedIds) });
    }
    this._initialItems = null;
    this._loop();
  }

  _enqueue(items, { anyKind = false } = {}) {
    for (const item of items) {
      if (!item || (!anyKind && !this.kinds.has(item.kind))) continue;
      if (!this.status.has(item.id)) this.files.push(item);
      if (this.copied.has(item.id)) {
        this.stats.skipped++;
        this.status.set(item.id, 'exists');
        continue;
      }
      this.status.set(item.id, 'waiting');
      this.queue.push(item);
      this.stats.totalFiles++;
      this.stats.totalBytes += item.size || 0;
    }
    this._emit();
  }

  async _loop() {
    this._set('running');
    while (this.state !== 'stopped') {
      const item = this.queue.shift();
      if (!item) {
        if (this.mode === 'archive') return this._set('done');
        await this._watch();
        continue;
      }
      await this._copyWithRetry(item);
    }
  }

  async _watch() {
    this._set('watching');
    await sleep(this.pollMs);
    if (this.state === 'stopped') return;
    try {
      const newer = await this.d.fetchNewer(this.channel.entity, this.lastId);
      for (const n of newer) this.lastId = Math.max(this.lastId, n.id);
      this._enqueue(newer.map((n) => n.item));
    } catch (e) {
      this._addLog(null, 'error', `בדיקת פוסטים חדשים נכשלה: ${e.message}`);
    }
    if (this.queue.length) this._set('running');
  }

  async _copyWithRetry(item) {
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      try {
        this.current = { item, sent: 0, size: item.size, attempt };
        this.status.set(item.id, 'active');
        this._emit();
        const file = await this._copyOne(item);
        this.copied.add(item.id);
        this.status.set(item.id, 'done');
        item.driveFile = file;
        this.stats.doneFiles++;
        this.stats.doneBytes += item.size || 0;
        this._addLog(item, 'ok', '', file);
        this.current = null;
        return;
      } catch (e) {
        if (this.state === 'stopped') {
          this.status.set(item.id, 'waiting');
          return;
        }
        if (e.authNeeded) {
          attempt--; // waiting for the user is not a failed attempt
          await this._waitForAuth();
          continue;
        }
        if (attempt === MAX_TRIES) {
          this.stats.failed++;
          this.status.set(item.id, 'failed');
          item.error = e.message || String(e);
          this.failedItems.push(item);
          this._addLog(item, 'error', e.message || String(e));
          this.current = null;
          return;
        }
        this._addLog(item, 'retry', `ניסיון ${attempt} נכשל: ${e.message}. מנסה שוב...`);
        await sleep(Math.min(60000, 3000 * 2 ** (attempt - 1)));
      }
    }
  }

  async _copyOne(item) {
    const meta = {
      name: item.name,
      mime: item.mime,
      folderId: this.folder.id,
      description: item.caption,
      appProperties: { tgChan: this.channel.id, tgMsg: String(item.id) },
    };

    // Photos are small: download whole, then upload.
    if (item.kind === 'photo') {
      const bytes = await this.d.downloadSmall(item);
      item.size = bytes.length;
      this.current.size = bytes.length;
      const url = await this.d.startUpload({ ...meta, size: bytes.length });
      return this._sendSafe(url, bytes, 0, bytes.length);
    }

    // Big files: stream from Telegram to Drive in pieces.
    // The Drive upload address is remembered, so a file that stopped in the middle
    // (error, refresh, closed tab) continues from where Drive got to, not from the start.
    const total = item.size;
    const key = `upload.${this.folder.id}.${this.channel.id}.${item.id}`;
    let url = getItem(key, null);
    let offset = 0;
    if (url) {
      try {
        const st = await this.d.uploadStatus(url, total);
        if (st.done) {
          removeItem(key);
          return st.file;
        }
        offset = st.received || 0;
        if (offset) this._addLog(item, 'retry', `ממשיך מ-${Math.round((offset / total) * 100)}% (לא מתחיל מההתחלה)`);
      } catch (e) {
        if (e.authNeeded) throw e;
        url = null; // the old upload expired — start this file fresh
        offset = 0;
      }
    }
    if (!url) {
      url = await this.d.startUpload({ ...meta, size: total });
      setItem(key, url);
    }
    this.current.sent = offset;
    let pending = [];
    let pendingLen = 0;
    let result = null;

    const onDownloaded = (n) => this._downloaded(n);
    for await (const part of this.d.streamDocument(this.channel.entity, item, { onDownloaded, startOffset: offset })) {
      await this._checkPause();
      if (this.state === 'stopped') throw new Error('stopped');
      pending.push(part);
      pendingLen += part.length;
      while (pendingLen >= this.d.CHUNK) {
        const all = concatBytes(pending);
        const piece = all.subarray(0, this.d.CHUNK);
        const rest = all.subarray(this.d.CHUNK);
        result = await this._sendSafe(url, piece, offset, total);
        offset += this.d.CHUNK;
        pending = rest.length ? [rest] : [];
        pendingLen = rest.length;
      }
    }
    if (pendingLen > 0) {
      result = await this._sendSafe(url, concatBytes(pending), offset, total);
      offset += pendingLen;
    }
    if (!result?.done) throw new Error('הקובץ לא הושלם בדרייב');
    removeItem(key);
    return result.file;
  }

  // Sends a piece; on network trouble asks Google where it stopped and continues from there.
  async _sendSafe(url, bytes, offset, total) {
    let start = offset;
    let data = bytes;
    for (let i = 0; i < MAX_TRIES; i++) {
      try {
        const r = await this.d.sendChunk(url, data, start, total, (loaded) => this._progress(start + loaded));
        this._progress(start + data.length);
        return r;
      } catch (e) {
        if (e.authNeeded) {
          await this._waitForAuth();
          i--;
        } else if (e.restart) {
          removeItem(`upload.${this.folder.id}.${this.channel.id}.${this.current?.item?.id}`);
          throw e;
        } else if (i === MAX_TRIES - 1) {
          throw e;
        } else {
          await sleep(2000 * (i + 1));
        }
        const st = await this.d.uploadStatus(url, total).catch(() => null);
        if (st?.done) return st;
        if (st && st.received > start && st.received <= offset + bytes.length) {
          data = bytes.subarray(st.received - offset);
          start = st.received;
        }
      }
    }
    throw new Error('ההעלאה נכשלה');
  }

  _progress(sent) {
    if (!this.current) return;
    const now = Date.now();
    const delta = sent - this.current.sent;
    this.current.sent = sent;
    const sp = this._speed;
    sp.bytes += Math.max(0, delta);
    if (now - sp.t >= 1000) {
      const inst = (sp.bytes * 1000) / (now - sp.t);
      sp.value = sp.value ? sp.value * 0.7 + inst * 0.3 : inst;
      sp.t = now;
      sp.bytes = 0;
    }
    this._emit();
  }

  speed() {
    return this._speed.value;
  }

  // download side (Telegram → browser), tracked separately to show which side is slower
  _downloaded(n) {
    if (this.current) this.current.downloaded = (this.current.downloaded || 0) + n;
    const d = (this._dl ||= { t: Date.now(), bytes: 0, value: 0 });
    d.bytes += n;
    const now = Date.now();
    if (now - d.t >= 1000) {
      const inst = (d.bytes * 1000) / (now - d.t);
      d.value = d.value ? d.value * 0.7 + inst * 0.3 : inst;
      d.t = now;
      d.bytes = 0;
    }
  }

  downloadSpeed() {
    return this._dl?.value || 0;
  }

  // --- controls ---
  pause() {
    if (this.state !== 'running') return;
    this._gate = {};
    this._gate.promise = new Promise((r) => (this._gate.resolve = r));
    this._set('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this._gate?.resolve();
    this._gate = null;
    this._set('running');
  }

  stop() {
    this._set('stopped');
    this._gate?.resolve();
    this._authWaiter?.resolve();
  }

  retryFailed() {
    const items = this.failedItems.splice(0);
    this.stats.failed = 0;
    this.stats.totalFiles -= items.length;
    this.stats.totalBytes -= items.reduce((s, i) => s + (i.size || 0), 0);
    const restart = this.state === 'done';
    this._enqueue(items, { anyKind: true });
    if (restart) this._loop();
  }

  async _checkPause() {
    if (this._gate) await this._gate.promise;
  }

  async _waitForAuth() {
    const prev = this.state;
    this._authWaiter = {};
    this._authWaiter.promise = new Promise((r) => (this._authWaiter.resolve = r));
    this._set('needAuth');
    await this._authWaiter.promise;
    this._authWaiter = null;
    if (this.state !== 'stopped') this._set(prev === 'needAuth' ? 'running' : prev);
  }

  authRenewed() {
    this._authWaiter?.resolve();
  }

  // --- helpers ---
  _addLog(item, status, text, file) {
    this.log.unshift({ item, status, text, file, time: Date.now() });
    if (this.log.length > 200) this.log.length = 200;
    this._emit();
  }

  _set(state) {
    if (this.state === 'stopped' && state !== 'stopped') return;
    this.state = state;
    this._emit();
  }

  _emit() {
    this.onUpdate?.(this);
  }
}
