'use strict';
/**
 * Group power tools:
 *   .tagall [message]      mention every member (admins only)
 *   .tagadmins [message]   mention all admins (anyone, once per 30s per group, handy for reports)
 *   .kickall yes           remove every non-admin member (admins only, needs confirmation)
 */
const U = require('../lib/util');
const { UserError, bold, sleep } = U;

const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

module.exports = ({ def }) => {
  const num = (ctx, id) => ctx.jidUser(id);

  def(['tagall', 'everyone'], { cat: 'group', group: true, admin: true, usage: 'tagall [message]', desc: 'Mention every member of the group with an optional message.' }, async ctx => {
    const meta = await ctx.group();
    const ids = meta.participants.map(p => p.id);
    const note = ctx.args || '📢 Attention everyone!';
    const parts = chunk(ids, 250);
    for (let i = 0; i < parts.length; i++) {
      const list = parts[i].map((id, k) => `${i * 250 + k + 1}. @${num(ctx, id)}`).join('\n');
      await ctx.send({ text: `${i === 0 ? `${note}\n\n` : ''}${list}`, mentions: parts[i] }, i === 0 ? { quoted: ctx.msg } : {});
      if (i < parts.length - 1) await sleep(800);
    }
  });

  def(['tagadmins', 'admin', 'calladmins'], { cat: 'group', group: true, usage: 'tagadmins [message]', desc: 'Mention all group admins (use it to report a problem).' }, async ctx => {
    const last = (ctx.rt.tagAdminsAt ||= new Map());
    if (Date.now() - (last.get(ctx.chat) || 0) < 30000 && !ctx.isOwner) throw new UserError('Admins were just tagged. Please wait a moment.');
    const meta = await ctx.group();
    const admins = meta.participants.filter(p => ctx.isAdminP(p)).map(p => p.id);
    if (!admins.length) throw new UserError('No admins found in this group.');
    last.set(ctx.chat, Date.now());
    await ctx.send({ text: `🛡️ ${bold('Calling the admins')}${ctx.args ? `\n${ctx.args}` : ''}\n\n${admins.map(id => `@${num(ctx, id)}`).join('\n')}`, mentions: admins }, { quoted: ctx.msg });
  });

  def(['kickall', 'removeall'], { cat: 'group', group: true, admin: true, botAdmin: true, usage: 'kickall yes', desc: 'Remove every non-admin member from the group. Admins and the bot owner stay. Needs "yes" to confirm.' }, async ctx => {
    const meta = await ctx.group();
    const ownerNum = num(ctx, ctx.ownerJid);
    const targets = meta.participants.filter(p => !ctx.isAdminP(p) && num(ctx, p.id) !== ownerNum && num(ctx, p.id) !== ctx.senderNum).map(p => p.id);
    if (!targets.length) throw new UserError('There are no regular members to remove.');
    if ((ctx.argv[0] || '').toLowerCase() !== 'yes') throw new UserError(`⚠️ This removes ${bold(String(targets.length))} non-admin member${targets.length > 1 ? 's' : ''} from the group. Admins stay.\nConfirm with *${ctx.var('PREFIX')}kickall yes*.`);
    await ctx.reply(`🧹 Removing ${targets.length} member${targets.length > 1 ? 's' : ''}…`, { title: 'Kick all' });
    let removed = 0, failed = 0;
    for (const batch of chunk(targets, 10)) {
      try {
        const res = await ctx.sock.groupParticipantsUpdate(ctx.chat, batch, 'remove');
        const bad = Array.isArray(res) ? res.filter(r => String(r?.status) !== '200').length : 0;
        removed += batch.length - bad; failed += bad;
      } catch { failed += batch.length; }
      await sleep(batch === targets.slice(-batch.length) ? 0 : 1500);
    }
    await ctx.reply(`✅ Removed: ${bold(String(removed))}${failed ? `\n⚠️ Could not remove: ${failed}` : ''}`, { title: 'Kick all' });
  });
};
