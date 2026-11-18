'use strict';
/**
 * Who can see a status the bot posts for you. WhatsApp only delivers a status to the phone numbers listed with it, so a short list
 * means a status that "nobody can see". The audience is now (all de-duplicated, phone-number JIDs only):
 *   • you                      • private chats the bot has seen          • your saved contacts (learned from WhatsApp sync events)
 *   • members of every group you are in
 */
const MAX = 5000;
const isUser = j => typeof j === 'string' && /^\d{6,15}@s\.whatsapp\.net$/.test(j);
const toUser = j => { const m = /^(\d{6,15})(?::\d+)?@s\.whatsapp\.net$/.exec(String(j || '')); return m ? `${m[1]}@s.whatsapp.net` : null; };

/** remember phone JIDs in the bot's store (called from WhatsApp sync events) */
function remember(api, jids) {
  const add = [...new Set((jids || []).map(toUser).filter(Boolean))];
  if (!add.length) return 0;
  try {
    api.update('statusAudience', {}, a => {
      for (const j of add) a[j] = a[j] || Date.now();
      const k = Object.keys(a);
      if (k.length > MAX) for (const x of k.sort((p, q) => a[p] - a[q]).slice(0, k.length - MAX)) delete a[x];
    });
  } catch { /* storage hiccup must never break sync */ }
  return add.length;
}

/** Phone JIDs out of a group participant (Baileys 7 may give a LID in `id` and the number in `phoneNumber`) */
const participantJid = p => toUser(p?.phoneNumber) || toUser(p?.jid) || toUser(p?.id);

async function collect(ctx) {
  const me = toUser(ctx.sock.user?.id);
  const tracked = Object.keys(ctx.get('statusAudience', {})).map(toUser).filter(Boolean);
  let groupMembers = [];
  try {
    const groups = await ctx.sock.groupFetchAllParticipating();
    groupMembers = Object.values(groups || {}).flatMap(g => (g.participants || []).map(participantJid)).filter(Boolean);
  } catch { /* groups are a bonus; the other sources still work */ }
  const set = new Set([...(me ? [me] : []), ...tracked, ...groupMembers]);
  const list = [...set].slice(0, MAX);
  return { list, me, chats: tracked.length, groupMembers: new Set(groupMembers).size, total: list.length };
}

module.exports = { remember, collect, toUser, isUser, participantJid, MAX };
