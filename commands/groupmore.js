'use strict';
/** More group tools: hidetag, warnings, setlimit, setdesc, approve, reject, modlog. */
const U = require('../lib/util');
const { UserError, bold } = U;

module.exports = ({ def }) => {
  const P = ctx => ctx.var('PREFIX');

  def('hidetag', { cat: 'group', group: true, admin: true, usage: 'hidetag <message> (or reply to a message)', desc: 'Send a message that notifies everyone without listing their names.' }, async ctx => {
    const meta = await ctx.group();
    const ids = meta.participants.map(p => p.id);
    const text = ctx.input().trim();
    if (!text) throw new UserError(`Write the message: *${P(ctx)}hidetag Meeting at 8 tonight*`);
    await ctx.send({ text, mentions: ids });
  });

  def('warnings', { cat: 'group', group: true, usage: 'warnings [@user]', desc: 'Show warnings in this group (one member, or everyone who has any).' }, async ctx => {
    const limit = Number(ctx.var('WARN_LIMIT')) || 3;
    const warns = ctx.get('warns:' + ctx.chat, {});
    const t = ctx.targets()[0];
    if (t) { const n = warns[ctx.jidUser(t)] || 0; return ctx.reply(`⚠️ +${ctx.jidUser(t)} has ${bold(`${n}/${limit}`)} warnings.`, { title: 'Warnings' }); }
    const rows = Object.entries(warns).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 25);
    if (!rows.length) return ctx.reply('✅ Nobody has any warnings in this group.', { title: 'Warnings' });
    await ctx.send({ text: ctx.frame(rows.map(([u, n]) => `⚠️ @${u} — ${n}/${limit}`).join('\n'), 'Warnings'), mentions: rows.map(([u]) => u + '@s.whatsapp.net') }, { quoted: ctx.msg });
  });

  def('setlimit', { cat: 'group', group: true, admin: true, usage: 'setlimit <2-10>', desc: 'How many warnings get a member removed (default 3).' }, async ctx => {
    const n = parseInt(ctx.argv[0], 10);
    if (!(n >= 2 && n <= 10)) throw new UserError(`Choose a number from 2 to 10, for example *${P(ctx)}setlimit 5*. Now: ${Number(ctx.var('WARN_LIMIT')) || 3}`);
    ctx.update('vars', {}, v => { v.WARN_LIMIT = String(n); });
    await ctx.reply(`✅ Members are removed after *${n}* warnings.`, { title: 'Warning limit' });
  });

  def('setdesc', { cat: 'group', group: true, admin: true, botAdmin: true, usage: 'setdesc <text>', desc: 'Change the group description.' }, async ctx => {
    const t = ctx.input().trim();
    if (!t || t.length > 2048) throw new UserError('Give a description of up to 2048 characters.');
    await ctx.sock.groupUpdateDescription(ctx.chat, t);
    await ctx.reply('✅ Group description updated.', { title: 'Description' });
  });

  for (const [name, action, icon] of [['approve', 'approve', '✅'], ['reject', 'reject', '❌']]) {
    def(name, { cat: 'group', group: true, admin: true, botAdmin: true, usage: `${name} all | ${name} <number> | ${name} list`, desc: `${name === 'approve' ? 'Accept' : 'Decline'} people waiting to join the group.` }, async ctx => {
      const list = await ctx.sock.groupRequestParticipantsList(ctx.chat).catch(() => []);
      const a = (ctx.argv[0] || 'list').toLowerCase();
      const jid = p => p.jid || p.phone_number || p.id;
      if (!list.length) return ctx.reply('📭 There are no pending join requests.', { title: 'Join requests' });
      if (a === 'list') return ctx.reply(list.slice(0, 30).map((p, i) => `${i + 1}. +${ctx.jidUser(jid(p))}`).join('\n') + `\n\n${bold(String(list.length))} waiting. Use *${P(ctx)}approve all* or *${P(ctx)}reject all*.`, { title: 'Join requests' });
      let pick = list;
      if (a !== 'all') { const num = a.replace(/\D/g, ''); pick = list.filter(p => ctx.jidUser(jid(p)) === num || ctx.jidUser(jid(p)).endsWith(num) && num.length >= 7); if (!pick.length) throw new UserError('That number is not waiting. See *' + P(ctx) + name + ' list*.'); }
      await ctx.sock.groupRequestParticipantsUpdate(ctx.chat, pick.slice(0, 50).map(jid), action);
      await ctx.reply(`${icon} ${action === 'approve' ? 'Approved' : 'Rejected'} ${Math.min(pick.length, 50)} request${pick.length > 1 ? 's' : ''}.`, { title: 'Join requests' });
    });
  }

  def('modlog', { cat: 'group', group: true, admin: true, usage: 'modlog [clear]', desc: 'The recent moderation actions admins ran through the bot in this group.' }, async ctx => {
    if (/^clear$/i.test(ctx.argv[0] || '')) { ctx.update('modlog', {}, o => { delete o[ctx.chat]; }); return ctx.reply('🧹 Moderation log cleared.', { title: 'Mod log' }); }
    const l = (ctx.get('modlog', {})[ctx.chat] || []).slice(-15).reverse();
    if (!l.length) return ctx.reply('📭 No moderation actions recorded yet.', { title: 'Mod log' });
    await ctx.reply(l.map(e => `🛡️ ${new Date(e.at).toLocaleString('en-GB', { timeZone: ctx.tz(), day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} • +${e.by} • ${bold(P(ctx) + e.cmd)} ${e.args}`.trim()).join('\n'), { title: 'Mod log' });
  });
};
