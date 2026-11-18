'use strict';
/** Owner tools: broadcast, broadcastgroup, ban, unban, allow, deny. */
const U = require('../lib/util');
const { UserError, bold, sleep } = U;

module.exports = ({ def, hooks }) => {
  const P = ctx => ctx.var('PREFIX');

  /* remember private chats the bot has talked with, so .broadcast knows who to reach */
  hooks.push({
    name: 'chatlist', run: async ctx => {
      if (ctx.isGroup || ctx.fromMe || !ctx.fresh || !ctx.chat.endsWith('@s.whatsapp.net')) return false;
      const seen = (ctx.rt.seenChats ||= new Set());
      if (seen.has(ctx.chat)) return false;
      seen.add(ctx.chat);
      ctx.update('chats', [], l => { if (!l.includes(ctx.chat)) { l.push(ctx.chat); if (l.length > 500) l.shift(); } });
      return false;
    }
  });

  async function run(ctx, kind) {
    const a = (ctx.argv[0] || '').toLowerCase();
    const send = a === 'send';
    const body = (send ? ctx.args.slice(4) : ctx.args).trim();
    if (!body) throw new UserError(`Write the message: *${P(ctx)}${ctx.cmd} Hello everyone!*\nYou will get a preview first.`);
    let targets = [];
    if (kind === 'groups') targets = Object.keys(await ctx.sock.groupFetchAllParticipating().catch(() => ({})));
    else targets = ctx.get('chats', []);
    targets = targets.filter(j => j !== ctx.chat || kind === 'groups').slice(0, 150);
    if (!targets.length) throw new UserError(kind === 'groups' ? 'I am not in any group.' : 'No private chats are known yet. I remember people who message me from now on.');
    if (!send) return ctx.reply(`📣 This would reach ${bold(String(targets.length))} ${kind === 'groups' ? 'group' : 'private chat'}${targets.length > 1 ? 's' : ''} (about ${Math.ceil(targets.length * 3 / 60)} min).\n\n${bold('Preview')}:\n${body}\n\nSend it with *${P(ctx)}${ctx.cmd} send ${body.slice(0, 20)}${body.length > 20 ? '…' : ''}* (use your full text).\n⚠️ Mass messaging can get a WhatsApp number banned. Use it sparingly.`, { title: 'Broadcast preview' });
    await ctx.reply(`📣 Sending to ${targets.length} chat${targets.length > 1 ? 's' : ''}. I will tell you when it is done.`, { title: 'Broadcast' });
    (async () => {
      let ok = 0, bad = 0;
      for (const jid of targets) {
        try { await ctx.sendTo(jid, { text: ctx.frame(body, 'Broadcast') }); ok++; } catch { bad++; }
        await sleep(3000);
      }
      await ctx.sendTo(ctx.ownerJid, { text: ctx.frame(`✅ Delivered: ${ok}${bad ? `\n⚠️ Failed: ${bad}` : ''}`, 'Broadcast done') }).catch(() => {});
    })();
  }
  def('broadcast', { cat: 'bot', owner: true, usage: 'broadcast <text> (preview) • broadcast send <text>', desc: 'Message every private chat the bot knows (preview first, 3 seconds between messages).' }, ctx => run(ctx, 'private'));
  def('broadcastgroup', { cat: 'bot', owner: true, usage: 'broadcastgroup <text> (preview) • broadcastgroup send <text>', desc: 'Message every group the bot is in (preview first, 3 seconds between messages).' }, ctx => run(ctx, 'groups'));

  /* ---------------- ban / allow ---------------- */
  const who = ctx => {
    const t = ctx.targets()[0];
    const n = (ctx.argv[0] || '').replace(/\D/g, '');
    const jid = t || (n.length >= 7 ? n + '@s.whatsapp.net' : null) || ctx.quoted?.sender || (!ctx.isGroup ? ctx.chat : null);
    if (!jid) throw new UserError(`Mention someone, reply to them, or give a number: *${P(ctx)}${ctx.cmd} 254712345678*`);
    return ctx.jidUser(jid);
  };
  const listCmd = (name, key, add, desc, okText) => def(name, { cat: 'user', owner: true, core: true, usage: `${name} @user | number | reply`, desc }, async ctx => {
    const num = who(ctx);
    if (add && (num === ctx.entry.phone || num === ctx.senderNum)) throw new UserError('You cannot do that to yourself.');
    ctx.update(key, [], l => { const i = l.indexOf(num); if (add && i < 0) l.push(num); if (!add && i >= 0) l.splice(i, 1); });
    await ctx.reply(`${okText} +${num}`, { title: name[0].toUpperCase() + name.slice(1) });
  });
  listCmd('ban', 'banned', true, 'Ban someone from using the bot (they are ignored everywhere).', '🚫 Banned');
  listCmd('unban', 'banned', false, 'Lift a ban.', '✅ Unbanned');
  listCmd('allow', 'allowed', true, 'Let someone use the bot even in private mode.', '✅ Allowed');
  listCmd('deny', 'allowed', false, 'Take back private-mode access.', '⛔ Removed from allowed:');
};
