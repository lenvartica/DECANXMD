'use strict';
const { UserError, bold } = require('../lib/util');


module.exports = ({ def }) => {
  def('forwardmode', { cat: 'bot', owner: true, usage: 'forwardmode on|off', desc: 'Show every bot reply as "Forwarded from <your channel>" (on) or as plain replies (off).' }, async ctx => {
    const a = (ctx.argv[0] || '').toLowerCase();
    if (!['on', 'off'].includes(a)) return ctx.reply(`Channel-forward style is *${ctx.var('CHANNEL_FORWARD') === 'off' ? 'OFF' : 'ON'}*.\nChange it: *${ctx.var('PREFIX')}forwardmode on* or *off*.`, { title: 'Forward mode' });
    ctx.update('vars', {}, v => { v.CHANNEL_FORWARD = a; });
    await ctx.reply(a === 'on' ? '📡 Done. Replies now appear forwarded from the channel.' : '✅ Done. Replies are now plain.', { title: 'Forward mode' });
  });

  def('setchannel', { cat: 'bot', owner: true, usage: 'setchannel <1203630…@newsletter> [display name] • setchannel auto', desc: 'Set the channel used in the forwarded header (JID + name). "auto" re-detects it from CHANNEL_URL.' }, async ctx => {
    const [jid, ...nameParts] = ctx.argv;
    if (!jid) {
      const info = await ctx.channelInfo();
      return ctx.reply(info ? `${bold('Channel')}: ${info.name}\n${bold('JID')}: ${info.jid}` : '⚠️ The channel could not be detected. Set it with *' + ctx.var('PREFIX') + 'setchannel 1203630xxxxxxxxxx@newsletter DECANXMD*.', { title: 'Forward channel' });
    }
    if (jid.toLowerCase() === 'auto') {
      ctx.update('vars', {}, v => { delete v.CHANNEL_JID; delete v.CHANNEL_NAME; });
      ctx.resetChannel();
      const info = await ctx.channelInfo();
      return ctx.reply(info ? `✅ Detected *${info.name}*\n${info.jid}` : '⚠️ Auto-detection failed. Set the JID manually.', { title: 'Forward channel' });
    }
    if (!/^\d{10,25}@newsletter$/.test(jid)) throw new UserError('The channel JID looks like *1203630xxxxxxxxxx@newsletter*.');
    ctx.update('vars', {}, v => { v.CHANNEL_JID = jid; if (nameParts.length) v.CHANNEL_NAME = nameParts.join(' '); });
    ctx.resetChannel();
    await ctx.reply(`✅ Forward channel saved: *${nameParts.join(' ') || 'DECANXMD'}*`, { title: 'Forward channel' });
  });

  def(['frame', 'frames', 'theme'], { cat: 'bot', owner: true, usage: 'frame • frame <style> • frame preview', desc: 'Choose how every bot message is framed: box, classic, neon, royal, minimal, dots, fire, channel, banner, elegant, clean.' }, async ctx => {
    const { FRAME_STYLES, frame } = require('../lib/bot'); // lazy: lib/bot loads the commands
    const a = (ctx.argv[0] || '').toLowerCase();
    const current = ctx.var('FRAME_STYLE') in FRAME_STYLES ? ctx.var('FRAME_STYLE') : 'decan';
    if (a && FRAME_STYLES[a]) {
      ctx.update('vars', {}, v => { v.FRAME_STYLE = a; });
      return ctx.send({ text: frame(`✅ Frame style is now *${FRAME_STYLES[a].name}*.\nEvery message will use it.`, 'Frame', a) }, { quoted: ctx.msg });
    }
    if (a === 'preview' || a === 'all') {
      for (const k of Object.keys(FRAME_STYLES)) await ctx.send({ text: frame(`Sample message in the *${FRAME_STYLES[k].name}* style.\nUse: *${ctx.var('PREFIX')}frame ${k}*`, k, k) });
      return;
    }
    if (a) throw new UserError(`Unknown style. Choose: ${Object.keys(FRAME_STYLES).join(', ')}`);
    await ctx.reply(`Current: ${bold(FRAME_STYLES[current].name)}\n\n${Object.keys(FRAME_STYLES).map(k => `${k === current ? '✅' : '▫️'} ${k}`).join('\n')}\n\nSet one: *${ctx.var('PREFIX')}frame neon*\nSee them all: *${ctx.var('PREFIX')}frame preview*`, { title: 'Frame styles' });
  });

  def('channelstatus', { cat: 'community', owner: true, desc: 'Show your channel, whether this account can post to it, and the forwarded-header settings.' }, async ctx => {
    const code = (String(ctx.CHANNEL_URL).match(/channel\/([\w-]+)/) || [])[1];
    let meta = null;
    try { meta = code ? await ctx.sock.newsletterMetadata('invite', code) : null; } catch { /* shown below */ }
    const info = await ctx.channelInfo();
    const role = String(meta?.viewer_metadata?.role || meta?.viewerMetadata?.role || '').toUpperCase();
    const canPost = ['OWNER', 'ADMIN'].includes(role);
    const subs = meta?.subscribers || meta?.thread_metadata?.subscribers_count;
    await ctx.reply([
      `${bold('Channel')}: ${info?.name || meta?.name || 'not found'}`,
      `${bold('JID')}: ${info?.jid || 'unknown'}`,
      subs ? `${bold('Followers')}: ${subs}` : '',
      `${bold('This account is')}: ${role || 'unknown'} ${role ? (canPost ? '✅ can post' : '⚠️ cannot post') : ''}`,
      `${bold('Header')}: ${ctx.var('CHANNEL_FORWARD') === 'off' ? 'off' : 'on'} • msg id ${info?.msgId || 'n/a'}`,
      `${bold('Auto-post')}: ${ctx.var('CHANNEL_AUTOPOST') === 'on' ? 'on' : 'off'}`
    ].filter(Boolean).join('\n'), { title: 'Channel status' });
  });
};
