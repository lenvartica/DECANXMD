'use strict';
/**
 * Manage the chats of the bot's WhatsApp account (owner only), from inside the chat itself:
 *   .archive  .unarchive  .pinchat  .unpinchat  .deletechat yes
 */
const { UserError } = require('../lib/util');

module.exports = ({ def }) => {
  const last = ctx => [{ key: ctx.key, messageTimestamp: ctx.ts }];
  const run = async (ctx, mod, what) => {
    try { await ctx.sock.chatModify(mod, ctx.chat); }
    catch (e) {
      if (/pin/i.test(what) && /limit|max|three|3/i.test(String(e?.message))) throw new UserError('WhatsApp allows only 3 pinned chats. Unpin one first.');
      throw new UserError(`WhatsApp refused to ${what} this chat (${String(e?.message || 'unknown error').slice(0, 80)}).`);
    }
  };

  def('archive', { cat: 'whatsapp', owner: true, desc: 'Archive this chat on the bot account.' }, async ctx => {
    await ctx.reply('🗂️ Archiving this chat.', { title: 'Archive' });
    await run(ctx, { archive: true, lastMessages: last(ctx) }, 'archive');
  });
  def('unarchive', { cat: 'whatsapp', owner: true, desc: 'Move this chat out of the archive.' }, async ctx => {
    await run(ctx, { archive: false, lastMessages: last(ctx) }, 'unarchive');
    await ctx.reply('📥 Chat restored from the archive.', { title: 'Unarchive' });
  });
  def('pinchat', { cat: 'whatsapp', owner: true, desc: 'Pin this chat to the top of the bot account chat list (max 3).' }, async ctx => {
    await run(ctx, { pin: true }, 'pin');
    await ctx.reply('📌 Chat pinned.', { title: 'Pin' });
  });
  def('unpinchat', { cat: 'whatsapp', owner: true, desc: 'Unpin this chat.' }, async ctx => {
    await run(ctx, { pin: false }, 'unpin');
    await ctx.reply('📍 Chat unpinned.', { title: 'Unpin' });
  });
  def('deletechat', { cat: 'whatsapp', owner: true, usage: 'deletechat yes', desc: 'Delete this chat from the bot account (all its messages). Needs "yes" to confirm.' }, async ctx => {
    if ((ctx.argv[0] || '').toLowerCase() !== 'yes') throw new UserError(`This removes the whole chat and its messages from the bot account.\nConfirm with *${ctx.var('PREFIX')}deletechat yes*.`);
    await ctx.reply('🗑️ Deleting this chat.', { title: 'Delete chat' });
    try { await ctx.sock.chatModify({ delete: true, lastMessages: last(ctx) }, ctx.chat); }
    catch { await run(ctx, { clear: true, lastMessages: last(ctx) }, 'delete'); }
  });
};
