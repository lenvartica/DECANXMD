'use strict';
const U = require('../lib/util');
const { UserError, bold } = U;

module.exports = ({ def }) => {
  def('block', { cat: 'user', owner: true, usage: 'block [@user | reply | number]', desc: 'Block a user (in a private chat, blocks that person).' }, async ctx => {
    const t = ctx.targets(true);
    if (!t.length) throw new UserError('Mention, reply to, or give the number of the person to block.');
    for (const j of t) await ctx.sock.updateBlockStatus(j, 'block');
    await ctx.reply(`🚫 Blocked ${t.length} user(s).`);
  });
  def('unblock', { cat: 'user', owner: true, usage: 'unblock [@user | reply | number]', desc: 'Unblock a user.' }, async ctx => {
    const t = ctx.targets(true);
    if (!t.length) throw new UserError('Mention, reply to, or give the number of the person to unblock.');
    for (const j of t) await ctx.sock.updateBlockStatus(j, 'unblock');
    await ctx.reply(`✅ Unblocked ${t.length} user(s).`);
  });

  def('fullpp', { cat: 'user', owner: true, heavy: true, desc: 'Set the bot\'s profile picture without cropping. Reply to an image.' }, async ctx => {
    const m = await ctx.needMedia('image');
    const img = await U.sharp()(m.buffer).rotate().resize(720, 720, { fit: 'contain', background: '#000000' }).jpeg({ quality: 92 }).toBuffer();
    await ctx.sock.updateProfilePicture(ctx.ownerJid, img);
    await ctx.reply('✅ Profile picture updated (full image).');
  });

  def('pp', { cat: 'user', heavy: true, usage: 'pp (reply to an image to set) • pp [@user] to view', desc: 'Reply to an image to set the bot\'s profile picture (owner), or get anyone\'s profile picture.' }, async ctx => {
    const q = ctx.quoted;
    if (q?.message?.imageMessage || (!q && ctx.type === 'imageMessage')) {
      if (!ctx.isOwner) throw new UserError('Only the owner can change the profile picture.');
      const m = await ctx.needMedia('image');
      await ctx.sock.updateProfilePicture(ctx.ownerJid, await U.sharp()(m.buffer).rotate().jpeg({ quality: 92 }).toBuffer());
      return ctx.reply('✅ Profile picture updated.');
    }
    const [jid] = ctx.targets(true);
    const target = jid || ctx.sender;
    let url;
    try { url = await ctx.sock.profilePictureUrl(target, 'image'); } catch {}
    if (!url) throw new UserError('No profile picture found (it may be hidden or not set).');
    await ctx.send({ image: { url }, caption: `🖼️ +${ctx.jidUser(target)}` }, { quoted: ctx.msg });
  });

  def('jid', { cat: 'user', usage: 'jid [@user | reply]', desc: 'Show the JID of this chat or of a user.' }, async ctx => {
    const t = ctx.targets();
    await ctx.reply(t.length ? t.join('\n') : ctx.chat, { title: 'JID' });
  });
  def('gjid', { cat: 'user', owner: true, heavy: true, desc: 'List the JIDs of all groups the bot is in (or this group\'s JID).' }, async ctx => {
    if (ctx.isGroup && !ctx.args) return ctx.reply(`${(await ctx.group()).subject}\n${ctx.chat}`, { title: 'Group JID' });
    const all = Object.values(await ctx.sock.groupFetchAllParticipating());
    if (!all.length) return ctx.reply('I am not in any groups.');
    await ctx.reply(all.map((g, i) => `${i + 1}. ${bold(g.subject)}\n   ${g.id}`).join('\n'), { title: 'Group JIDs' });
  });
  def('left', { cat: 'user', owner: true, group: true, desc: 'Make the bot leave this group.' }, async ctx => {
    await ctx.reply('👋 Goodbye everyone!');
    await ctx.sock.groupLeave(ctx.chat);
  });
};
