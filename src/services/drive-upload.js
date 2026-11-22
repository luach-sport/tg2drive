import { getToken, dropToken, AuthNeededError } from './google-auth.js';

const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink';

// Upload pieces must be multiples of 256 KB (except the last one). 8 MB is a good balance.
export const CHUNK = 32 * 256 * 1024;

// Opens a resumable upload session and returns its URL.
export async function startUpload({ name, mime, size, folderId, description, appProperties }) {
  const token = await getToken();
  const res = await fetch(UPLOAD, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({ name, parents: [folderId], description: description?.slice(0, 4000), appProperties }),
  });
  if (res.status === 401) {
    dropToken();
    throw new AuthNeededError();
  }
  if (!res.ok) throw new Error(`לא הצלחתי לפתוח העלאה לדרייב (${res.status})`);
  const url = res.headers.get('Location');
  if (!url) throw new Error('גוגל לא החזיר כתובת העלאה');
  return url;
}

function xhr(method, url, { token, headers = {}, body, onProgress }) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    x.setRequestHeader('Authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    if (onProgress) x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => resolve(x);
    x.onerror = () => reject(Object.assign(new Error('בעיית רשת בהעלאה'), { network: true }));
    x.ontimeout = x.onerror;
    x.send(body);
  });
}

function parseRange(x) {
  const range = x.getResponseHeader('Range'); // "bytes=0-12345"
  if (!range) return 0;
  const end = Number(range.split('-')[1]);
  return isFinite(end) ? end + 1 : 0;
}

// Sends one piece. Returns { done, received, file }.
export async function sendChunk(url, bytes, offset, total, onProgress) {
  const token = await getToken();
  const end = offset + bytes.length - 1;
  const x = await xhr('PUT', url, {
    token,
    headers: { 'Content-Range': `bytes ${offset}-${end}/${total}` },
    body: bytes,
    onProgress,
  });
  return interpret(x);
}

// Asks Google how much of the file it already has (used after a failure).
export async function uploadStatus(url, total) {
  const token = await getToken();
  const x = await xhr('PUT', url, { token, headers: { 'Content-Range': `bytes */${total}` } });
  return interpret(x);
}

function interpret(x) {
  if (x.status === 200 || x.status === 201) {
    let file = null;
    try {
      file = JSON.parse(x.responseText);
    } catch {
      /* ignore */
    }
    return { done: true, file };
  }
  if (x.status === 308) return { done: false, received: parseRange(x) };
  if (x.status === 401) {
    dropToken();
    throw new AuthNeededError();
  }
  if (x.status === 404 || x.status === 410) {
    throw Object.assign(new Error('פג תוקף ההעלאה, מתחיל את הקובץ מחדש'), { restart: true });
  }
  throw Object.assign(new Error(`שגיאה בהעלאה (${x.status})`), { retryable: x.status >= 500 || x.status === 429 });
}
