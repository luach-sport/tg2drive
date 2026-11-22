import { Api } from 'telegram';
import bigInt from 'big-integer';
import { currentClient } from './tg-client.js';
import { nameFromCaption } from '../core/format.js';

export const KINDS = {
  video: { label: 'סרטונים', icon: '🎬' },
  audio: { label: 'שמע', icon: '🎧' },
  document: { label: 'קבצים (PDF ועוד)', icon: '📄' },
  photo: { label: 'תמונות', icon: '🖼️' },
};

const EXT_BY_MIME = {
  'video/mp4': 'mp4',
  'video/x-matroska': 'mkv',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
};

function extFor(mime) {
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const sub = (mime || '').split('/')[1] || 'bin';
  return sub.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
}

function largestPhotoSize(photo) {
  let best = 0;
  for (const s of photo.sizes || []) {
    if (s instanceof Api.PhotoSize) best = Math.max(best, s.size);
    else if (s instanceof Api.PhotoSizeProgressive) best = Math.max(best, ...s.sizes);
  }
  return best;
}

// Turns a Telegram message into a "file to copy", or null if it has no file.
export function messageToItem(msg) {
  const media = msg.media;
  if (!media) return null;
  const caption = msg.message || '';
  const base = { id: msg.id, date: msg.date, caption, msg };

  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const doc = media.document;
    const attrs = doc.attributes || [];
    if (attrs.some((a) => a instanceof Api.DocumentAttributeSticker)) return null;
    const fileAttr = attrs.find((a) => a instanceof Api.DocumentAttributeFilename);
    const isVideo = attrs.some((a) => a instanceof Api.DocumentAttributeVideo);
    const isAudio = attrs.some((a) => a instanceof Api.DocumentAttributeAudio);
    const kind = isVideo ? 'video' : isAudio ? 'audio' : 'document';
    const mime = doc.mimeType || 'application/octet-stream';
    const ext = extFor(mime);
    const fromCaption = nameFromCaption(caption);
    const name = fileAttr?.fileName || (fromCaption ? `${fromCaption}.${ext}` : `${kind}-${msg.id}.${ext}`);
    return { ...base, kind, mime, name, size: Number(doc.size) };
  }

  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    const fromCaption = nameFromCaption(caption);
    return {
      ...base,
      kind: 'photo',
      mime: 'image/jpeg',
      name: fromCaption ? `${fromCaption}.jpg` : `photo-${msg.id}.jpg`,
      size: largestPhotoSize(media.photo),
    };
  }
  return null;
}

// Reads the whole channel (oldest first) and collects every post that has a file.
export async function scanChannel(entity, onProgress) {
  const client = currentClient();
  const head = await client.getMessages(entity, { limit: 1 });
  const total = head.total || 0;
  const lastId = head[0]?.id || 0;
  const items = [];
  let seen = 0;
  for await (const msg of client.iterMessages(entity, { reverse: true })) {
    seen++;
    const item = messageToItem(msg);
    if (item) items.push(item);
    if (seen % 100 === 0) onProgress?.({ seen, total, found: items.length });
  }
  onProgress?.({ seen, total, found: items.length });
  return { items, lastId: Math.max(lastId, items.at(-1)?.id || 0) };
}

export async function latestMessageId(entity) {
  const head = await currentClient().getMessages(entity, { limit: 1 });
  return head[0]?.id || 0;
}

// Posts newer than `afterId`, oldest first.
export async function fetchNewer(entity, afterId) {
  const msgs = await currentClient().getMessages(entity, { minId: afterId, limit: 100 });
  return msgs
    .filter((m) => m.id > afterId)
    .sort((a, b) => a.id - b.id)
    .map((m) => ({ id: m.id, item: messageToItem(m) }));
}

// Streams a document in 512 KB pieces without holding the whole file in memory.
export function streamDocument(entity, item) {
  return currentClient().iterDownload({
    file: item.msg.media,
    requestSize: 512 * 1024,
    fileSize: bigInt(item.size),
    msgData: [entity, item.id], // lets the library refresh expired file references
  });
}

export async function downloadSmall(item) {
  const buf = await currentClient().downloadMedia(item.msg, {});
  return new Uint8Array(buf);
}
