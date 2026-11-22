import { Api, utils, errors } from 'telegram';
import bigInt from 'big-integer';
import { currentClient, ensureConnected, isDisconnectError } from './tg-client.js';

const PART = 1024 * 1024; // Telegram's biggest allowed piece (1 MB)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Downloads a Telegram file with several requests in flight at once,
 * and keeps fetching ahead while the caller is busy uploading.
 * Yields the file's bytes in order, 1 MB at a time.
 *
 * parallel: how many 1 MB requests run at the same time
 * ahead:    how many MB may wait in memory ahead of the consumer
 */
export async function* fastDownload(entity, item, { parallel = 6, ahead = 24, onDownloaded, startOffset = 0, client = currentClient() } = {}) {
  await ensureConnected(client);
  let info = utils.getFileInfo(item.msg.media);
  let sender = await client.getSender(info.dcId);
  const totalParts = Math.ceil(item.size / PART);

  const ready = new Map(); // part index -> bytes
  // resuming: start from the 1 MB piece that holds startOffset, and drop the bytes before it
  const firstPart = Math.floor(startOffset / PART);
  let skipBytes = startOffset - firstPart * PART;
  let nextToFetch = firstPart;
  let nextToYield = firstPart;
  let failure = null;
  let waitingConsumer = null;
  let waitingWorkers = [];
  let stopped = false;

  const wakeConsumer = () => {
    waitingConsumer?.();
    waitingConsumer = null;
  };
  const wakeWorkers = () => {
    const w = waitingWorkers;
    waitingWorkers = [];
    w.forEach((f) => f());
  };

  let refreshing = null;
  const refreshReference = async () => {
    // file references expire after a while; re-reading the message gives a fresh one
    if (!refreshing) {
      refreshing = (async () => {
        const [msg] = await client.getMessages(entity, { ids: [item.id] });
        if (!msg?.media) throw new Error('הפוסט נמחק מהערוץ');
        item.msg = msg;
        info = utils.getFileInfo(msg.media);
      })().finally(() => setTimeout(() => (refreshing = null), 5000));
    }
    return refreshing;
  };

  const fetchPart = async (index) => {
    let drops = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await client.invokeWithSender(
          new Api.upload.GetFile({ location: info.location, offset: bigInt(index * PART), limit: PART, precise: false }),
          sender
        );
        if (!(res instanceof Api.upload.File)) throw new Error('הקובץ מוגש דרך CDN שלא נתמך');
        return res.bytes;
      } catch (e) {
        const msg = e.errorMessage || '';
        if (isDisconnectError(e) && drops++ < 20) {
          // Telegram dropped the connection: reconnect and ask for the same piece again
          attempt--;
          await sleep(1000);
          await ensureConnected(client);
          sender = await client.getSender(info.dcId);
        } else if (e instanceof errors.FileMigrateError) {
          sender = await client.getSender(e.newDc);
        } else if (msg.includes('FILE_REFERENCE')) {
          await refreshReference();
        } else if (msg.startsWith('FLOOD_WAIT') || e.seconds) {
          await sleep(((e.seconds || 5) + 1) * 1000);
        } else if (attempt >= 4) {
          throw e;
        } else {
          await sleep(1000 * (attempt + 1));
        }
      }
    }
  };

  const worker = async () => {
    while (!stopped && !failure) {
      // don't run too far ahead of the uploader
      while (!stopped && nextToFetch - nextToYield >= ahead) {
        await new Promise((r) => waitingWorkers.push(r));
      }
      if (stopped || nextToFetch >= totalParts) return;
      const index = nextToFetch++;
      try {
        const bytes = await fetchPart(index);
        ready.set(index, bytes);
        onDownloaded?.(bytes.length);
        wakeConsumer();
      } catch (e) {
        failure = e;
        wakeConsumer();
        return;
      }
    }
  };

  const workers = Array.from({ length: Math.min(parallel, totalParts) }, worker);

  try {
    while (nextToYield < totalParts) {
      while (!ready.has(nextToYield) && !failure) {
        await new Promise((r) => (waitingConsumer = r));
      }
      if (failure) throw failure;
      let bytes = ready.get(nextToYield);
      ready.delete(nextToYield);
      if (skipBytes) {
        bytes = bytes.subarray(skipBytes);
        skipBytes = 0;
      }
      nextToYield++;
      wakeWorkers();
      yield bytes;
    }
  } finally {
    stopped = true;
    wakeWorkers();
    await Promise.allSettled(workers);
  }
}
