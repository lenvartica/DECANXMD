'use strict';
/** Privacy-respecting anti-delete notices and view-once arrival notifications. */
const U = require('../lib/util');
const { UserError, bold } = U;

module.exports = ({ def, hooks }) => {
  const toggle = (name, key, desc, on, off) => def(name, { cat: 'whatsapp', owner: true, usage: `${name} on|off`, desc }, async ctx => {
    const a = (ctx.argv[0] || '').toLowerCase();
    if (!['on', 'off'].includes(a)) return ctx.reply(`${name} is *${ctx.get(key, false) ? 'ON' : 'OFF'}*. Use *${ctx.var('PREFIX')}${name} on|off*.`, { title: name });
    ctx.set(key, a === 'on');
    await ctx.reply(a === 'on' ? on : off, { title: name });
  });
  toggle('antidelete', 'antidelete', 'Get a private notice with the text and media of messages other people delete.', '🗑️ Anti-delete is *ON*. I will forward deleted messages and media to your private chat.', '✅ Anti-delete is *OFF*.');
  def('antiviewonce', { cat: 'whatsapp', owner: true, usage: 'antiviewonce on|off', desc: 'Notify the owner when a view-once message arrives.' }, async ctx => {
    const a = (ctx.argv[0] || '').toLowerCase();
    if (!['on', 'off'].includes(a)) return ctx.reply(`Anti-view-once notifications are *${ctx.get('vv2', false) ? 'ON' : 'OFF'}*. Use *${ctx.var('PREFIX')}antiviewonce on|off*.`);
    ctx.set('vv2', a === 'on');
    await ctx.reply(a === 'on' ? '🔐 View-once arrival notices are *ON*. You will be alerted when someone sends a view-once message.' : '🔐 View-once arrival notices are *OFF*.');
  });

  hooks.push({
    name: 'antiviewonce', priority: -1, run: async ctx => {
      if (ctx.fromMe || !ctx.fresh || ctx.chat === 'status@broadcast') return false;
      if (!ctx.get('vv2', false)) return false;
      const isVO = Boolean(
        ctx.msg?.message?.viewOnceMessage ||
        ctx.msg?.message?.viewOnceMessageV2 ||
        ctx.msg?.message?.viewOnceMessageV2Extension ||
        ctx.content?.imageMessage?.viewOnce ||
        ctx.content?.videoMessage?.viewOnce ||
        ctx.content?.audioMessage?.viewOnce
      );
      if (!isVO) return false;
      const where = ctx.isGroup ? 'in a group' : 'in a private chat';
      const sender = '+' + ctx.senderNum;
      await ctx.sendTo(ctx.ownerJid, {
        text: ctx.frame(`👁️ ${bold('View-Once Message Received')} ${where}\n👤 From: ${sender}\n🆔 Message ID: ${ctx.key.id}\n\n💡 Use *${ctx.var('PREFIX')}vv* or *${ctx.var('PREFIX')}vv2* (reply to the message) to reveal the media.`, 'Anti View-Once')
      });
      return false;
    }
  });

  hooks.push({
    name: 'antidelete', run: async ctx => {
      const pm = ctx.content?.protocolMessage;
      if (!pm?.key?.id || !(pm.type === 0 || pm.type === 'REVOKE')) return false;
      if (ctx.fromMe || !ctx.get('antidelete', false)) return false;
      const prev = ctx.rt.msgCache.get(pm.key.id);
      const where = ctx.isGroup ? 'in a group' : 'in a private chat';
      const who = prev?.sender ? '+' + ctx.jidUser(prev.sender) : '+' + ctx.senderNum;

      if (prev?.message) {
        const u = ctx.unwrap(prev.message);
        const t = ctx.mediaTypeOf(u);
        if (t && u[t]) {
          try {
            const m = await ctx.download({ key: prev.key || pm.key, message: prev.message });
            const kind = t.replace('Message', '');
            const cap = `🗑️ ${bold('Deleted ' + kind)} ${where}\n👤 ${who}${u[t].caption ? '\n\n' + u[t].caption : ''}`;
            if (kind === 'image') {
              await ctx.sendTo(ctx.ownerJid, { image: m, caption: ctx.frame(cap, 'Anti-delete') });
              return false;
            } else if (kind === 'video') {
              await ctx.sendTo(ctx.ownerJid, { video: m, caption: ctx.frame(cap, 'Anti-delete') });
              return false;
            } else if (kind === 'audio') {
              await ctx.sendTo(ctx.ownerJid, { text: ctx.frame(cap, 'Anti-delete') });
              await ctx.sendTo(ctx.ownerJid, { audio: m, mimetype: u[t].mimetype || 'audio/ogg; codecs=opus', ptt: Boolean(u[t].ptt) });
              return false;
            } else if (kind === 'sticker') {
              await ctx.sendTo(ctx.ownerJid, { text: ctx.frame(cap, 'Anti-delete') });
              await ctx.sendTo(ctx.ownerJid, { sticker: m });
              return false;
            }
          } catch {}
        }
      }

      await ctx.sendTo(ctx.ownerJid, { text: ctx.frame(`🗑️ ${bold('Message deleted')} ${where}\n👤 ${who}\n\n${prev?.text ? prev.text : '_I had not seen the text of this message (it may be media or older than my memory)._'}`, 'Anti-delete') });
      return false;
    }
  });


};
