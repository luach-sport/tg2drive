import { Api } from 'telegram';
import bigInt from 'big-integer';
import { currentClient } from './tg-client.js';

// Understands: https://t.me/name, t.me/s/name, @name, name, t.me/+hash, t.me/joinchat/hash, t.me/c/123/45
// A link to one post (t.me/name/123, t.me/c/123/45) also returns postId.
export function parseChannelLink(input) {
  const s = String(input || '').trim().replace(/[?#].*$/, '');
  let m = s.match(/t\.me\/(?:\+|joinchat\/)([\w-]+)/i);
  if (m) return { invite: m[1] };
  m = s.match(/t\.me\/c\/(\d+)(?:\/(\d+))?(?:\/(\d+))?/i);
  if (m) return { channelId: m[1], postId: num(m[3] || m[2]) };
  m = s.match(/(?:t\.me\/(?:s\/)?|^@)([A-Za-z][\w]{3,})(?:\/(\d+))?(?:\/(\d+))?/i);
  if (m) return { username: m[1], postId: num(m[3] || m[2]) };
  m = s.match(/^([A-Za-z][\w]{3,})$/);
  if (m) return { username: m[1] };
  return null;
}

function num(v) {
  return v ? Number(v) : null;
}

export async function resolveChannel(input) {
  const client = currentClient();
  const parsed = parseChannelLink(input);
  if (!parsed) throw new Error('הקישור לא נראה כמו קישור לערוץ טלגרם');

  let entity;
  if (parsed.invite) {
    const res = await client.invoke(new Api.messages.CheckChatInvite({ hash: parsed.invite }));
    if (!(res instanceof Api.ChatInviteAlready)) {
      throw new Error('אתה עדיין לא חבר בערוץ הזה. הצטרף אליו בטלגרם ונסה שוב.');
    }
    entity = res.chat;
  } else if (parsed.channelId) {
    await client.getDialogs({ limit: 500 }); // loads the access info of channels you are in
    entity = await client.getEntity(new Api.PeerChannel({ channelId: bigInt(parsed.channelId) }));
  } else {
    entity = await client.getEntity(parsed.username);
  }

  if (!(entity instanceof Api.Channel) && !(entity instanceof Api.Chat)) {
    throw new Error('הקישור מוביל למשתמש ולא לערוץ או קבוצה');
  }
  return {
    entity,
    id: entity.id.toString(),
    title: entity.title || 'ערוץ',
    protectedContent: Boolean(entity.noforwards),
    postId: parsed.postId || null,
  };
}
