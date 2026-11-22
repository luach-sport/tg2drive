import { getToken, dropToken, AuthNeededError } from './google-auth.js';

// Small JSON files in the app's hidden Drive folder ("appDataFolder").
// The computer and the phone use them to talk to each other.
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const ids = {};

async function call(url, options = {}) {
  const token = await getToken();
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (res.status === 401) {
    dropToken();
    throw new AuthNeededError();
  }
  return res;
}

async function findId(name) {
  if (ids[name]) return ids[name];
  const params = new URLSearchParams({ spaces: 'appDataFolder', q: `name = '${name}' and trashed = false`, fields: 'files(id)', orderBy: 'modifiedTime desc' });
  const res = await call(`${API}?${params}`);
  if (!res.ok) throw new Error(`Drive (${res.status})`);
  const data = await res.json();
  ids[name] = data.files?.[0]?.id || null;
  return ids[name];
}

export async function readJson(name) {
  const id = await findId(name);
  if (!id) return null;
  const res = await call(`${API}/${id}?alt=media`, { cache: 'no-store' });
  if (res.status === 404) {
    ids[name] = null;
    return null;
  }
  if (!res.ok) throw new Error(`Drive (${res.status})`);
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function writeJson(name, obj) {
  const body = JSON.stringify(obj);
  let id = await findId(name);
  if (id) {
    const res = await call(`${UPLOAD}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    if (res.status !== 404) {
      if (!res.ok) throw new Error(`Drive (${res.status})`);
      return;
    }
    ids[name] = null;
  }
  const boundary = 'tg2drive' + Math.random().toString(36).slice(2);
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name, parents: ['appDataFolder'] }) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const res = await call(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  if (!res.ok) throw new Error(`Drive (${res.status})`);
  ids[name] = (await res.json()).id;
}

export const STATUS_FILE = 'tg2drive-status.json';
export const COMMANDS_FILE = 'tg2drive-commands.json';
