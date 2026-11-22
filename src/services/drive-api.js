import { getToken, dropToken, AuthNeededError } from './google-auth.js';

const API = 'https://www.googleapis.com/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function call(url, options = {}) {
  const token = await getToken();
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (res.status === 401) {
    dropToken();
    throw new AuthNeededError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`שגיאה מגוגל דרייב (${res.status}) ${text.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

export function createFolder(name, parentId) {
  return call(`${API}/files?fields=id,name,webViewLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  });
}

export function getFolder(id) {
  return call(`${API}/files/${id}?fields=id,name,webViewLink,trashed`);
}

// Message ids from this channel that were already copied into the folder (so we never copy twice).
export async function listCopiedIds(folderId, channelId) {
  const ids = new Set();
  const q = `'${folderId}' in parents and trashed = false and appProperties has { key='tgChan' and value='${channelId}' }`;
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q,
      pageSize: '1000',
      fields: 'nextPageToken,files(appProperties)',
      ...(pageToken ? { pageToken } : {}),
    });
    const data = await call(`${API}/files?${params}`);
    for (const f of data.files || []) {
      const id = Number(f.appProperties?.tgMsg);
      if (id) ids.add(id);
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return ids;
}
