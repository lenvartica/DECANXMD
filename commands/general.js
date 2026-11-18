'use strict';
/** General info + owner/profile commands: date, prefix, setprefix, language, report, feedback, owner, support, version, setname, setbio, public, self, maintenance, shutdown, shutdownstatus, logout, reconnect, restart. */
const U = require('../lib/util');
const { requireHost } = require('../lib/host');
const { UserError, bold } = U;

module.exports = ({ def }) => {
  const P = ctx => ctx.var('PREFIX');
  const setVar = (ctx, k, v) => ctx.update('vars', {}, o => { o[k] = v; });

  def('date', { cat: 'misc', usage: 'date', desc: 'Today\'s date, week number and days left in the year (bot timezone).' }, async ctx => {
    const tz = ctx.tz(), now = new Date();
    const fmt = (o) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o }).format(now);
    const y = Number(fmt({ year: 'numeric' }));
    const start = Date.UTC(y, 0, 1), cur = Date.UTC(y, Number(fmt({ month: 'numeric' })) - 1, Number(fmt({ day: 'numeric' })));
    const doy = Math.floor((cur - start) / 86400000) + 1, total = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365;
    const week = Math.ceil(doy / 7);
    await ctx.reply(`📅 ${bold(fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}\n🕒 ${fmt({ hour: '2-digit', minute: '2-digit' })} (${tz})\n📆 Day ${doy} of ${total} • Week ${week}\n⏳ ${total - doy} days left this year`, { title: 'Date' });
  });

  def('prefix', { cat: 'vars', usage: 'prefix', desc: 'Show the command prefix.' }, async ctx => ctx.reply(`The prefix is *${P(ctx)}*\nExample: *${P(ctx)}menu*`, { title: 'Prefix' }));
  def('setprefix', { cat: 'vars', owner: true, core: true, usage: 'setprefix <symbol>', desc: 'Change the command prefix (1 to 3 symbols, for example . ! #).' }, async ctx => {
    const p = ctx.argv[0];
    if (!p || p.length > 3 || /[\p{L}\p{N}\s]/u.test(p)) throw new UserError(`Use 1 to 3 symbols, for example *${P(ctx)}setprefix !*`);
    setVar(ctx, 'PREFIX', p);
    await ctx.reply(`✅ Prefix changed to *${p}*\nExample: *${p}menu*`, { title: 'Prefix' });
  });

  def('language', { cat: 'vars', owner: true, usage: 'language <name>', desc: 'Set the language the AI commands answer in (for example English, Swahili, French).' }, async ctx => {
    const l = ctx.args.trim();
    if (!l) return ctx.reply(`AI answers in: *${ctx.var('LANGUAGE') || 'the language you write in'}*\nChange: *${P(ctx)}language Swahili* • reset: *${P(ctx)}language auto*`, { title: 'Language' });
    if (/^(auto|default|off)$/i.test(l)) { ctx.update('vars', {}, o => { delete o.LANGUAGE; }); return ctx.reply('🌐 AI will answer in the language you write in.', { title: 'Language' }); }
    if (l.length > 30) throw new UserError('Give a language name, for example Swahili.');
    setVar(ctx, 'LANGUAGE', l);
    await ctx.reply(`🌐 AI answers will now be in *${l}*.`, { title: 'Language' });
  });

  for (const [name, label, icon] of [['report', 'Report', '🚨'], ['feedback', 'Feedback', '💬']]) {
    def(name, { cat: 'bot', usage: `${name} <message>`, desc: `Send ${name === 'report' ? 'a problem report' : 'feedback'} to the bot owner.` }, async ctx => {
      const t = ctx.input().trim();
      if (!t) throw new UserError(`Write your message, for example *${P(ctx)}${name} the play command is slow*`);
      if (!ctx.isOwner && !ctx.cooldown(60, name)) throw new UserError('Please wait a minute before sending another one.');
      await ctx.sendTo(ctx.ownerJid, { text: ctx.frame(`${icon} ${bold(label)} from +${ctx.senderNum}${ctx.isGroup ? ` (group: ${ctx.chat})` : ''}\n\n${t.slice(0, 1500)}`, label) });
      await ctx.reply(`✅ ${label} sent to the owner. Thank you!`, { title: label });
    });
  }

  def(['owner', 'creator'], { cat: 'bot', desc: 'Send the bot owner\'s contact card.' }, async ctx => {
    const num = ctx.ownerJid.split('@')[0], name = ctx.OWNER_NAME || 'Lenny / Decan';
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nORG:${ctx.COMPANY_NAME || 'DECANXMD'};\nTEL;type=CELL;type=VOICE;waid=${num}:+${num}\nEND:VCARD`;
    await ctx.sendTo(ctx.chat, { contacts: { displayName: name, contacts: [{ vcard }] } }, { quoted: ctx.msg });
  });

  def('support', { cat: 'bot', desc: 'How to get help: owner, channel and source code.' }, async ctx => {
    await ctx.reply(`👤 Owner: wa.me/${ctx.ownerJid.split('@')[0]}\n📡 Channel: ${ctx.CHANNEL_URL}\n💻 Code: ${ctx.var('REPO_URL') || process.env.REPO_URL || 'see ' + P(ctx) + 'repo'}\n\nReport a problem: *${P(ctx)}report <message>*`, { title: 'Support' });
  });

  def(['helper', 'chatowner', 'contactowner'], { cat: 'bot', usage: 'helper <message>', desc: 'Send a private message to Lenny / Decan.' }, async ctx => {
    const message = ctx.input().trim();
    if (!message) throw new UserError(`Write your message: *${P(ctx)}helper I need help with...*`);
    if (!ctx.isOwner && !ctx.cooldown(30, 'helper')) throw new UserError('Please wait before sending another helper message.');
    await ctx.sendTo(ctx.ownerJid, { text: ctx.frame(`💬 Helper message from +${ctx.senderNum}${ctx.isGroup ? ` (group: ${ctx.chat})` : ''}\n\n${message.slice(0, 1500)}\n\nReply to this chat to contact the user directly.`, 'Helper inbox') });
    await ctx.reply('✅ Your message has been sent privately to the owner. They can reply to you directly.');
  });

  def(['version', 'changelog', 'whatsnew'], { cat: 'bot', public: true, usage: 'version • changelog [page]', desc: 'Bot version card, or the full release notes (changelog) one page at a time.' }, async ctx => {
    const { notesText, notesPages, VERSION } = require('./channelpost')._test;
    const n = notesPages();
    if (ctx.cmd === 'version') {
      const { registry } = require('./index');
      const total = new Set([...registry.values()].filter(d => d.cat).map(d => d.name)).size;
      const sections = n ? n.items.filter(i => /^\*[^*]+\*$/.test(i)).map(i => i.replace(/\*/g, '')) : [];
      const body = [
        `🔖 ${bold('Version')}: v${VERSION}`,
        n?.title ? `✨ ${bold('Release')}: ${n.title}` : null,
        `🧩 ${bold('Commands')}: ${total}`,
        `🟢 ${bold('Node')}: ${process.version}`,
        sections.length ? `\n📌 ${bold('Highlights')}\n${sections.slice(0, 6).map(x => `◈ ${x}`).join('\n')}` : null,
        `\n📜 Full notes: *${P(ctx)}changelog*${n && n.pages.length > 1 ? ` (${n.pages.length} pages)` : ''}`
      ].filter(x => x != null).join('\n');
      return ctx.reply(body, { title: 'Version' });
    }
    const page = Number(ctx.argv[0]) || 1;
    const text = notesText(ctx, VERSION, page);
    if (!text) return ctx.reply(`🔖 Running ${bold('v' + VERSION)}\nNo release notes for this version yet.`, { title: 'Changelog' });
    await ctx.send({ text, noFrame: true }, { quoted: ctx.msg });
    if (n && page < n.pages.length) await ctx.reply(`➡️ Next page: *${P(ctx)}changelog ${Math.max(1, page | 0) + 1}*`, { title: 'Changelog' });
  });

  /* ---------------- profile ---------------- */
  def('setname', { cat: 'user', usage: 'setname <name>', desc: 'In a group (admins): rename the group. In private (owner): change the bot\'s WhatsApp profile name.' }, async ctx => {
    const n = ctx.input().trim();
    if (!n) throw new UserError(`Give a name, for example *${P(ctx)}setname DECANXMD*`);
    if (ctx.isGroup) {
      if (!ctx.isOwner && !(await ctx.admin())) throw new UserError('🛡️ Only group admins can rename the group.');
      if (!(await ctx.botAdmin())) throw new UserError('⚠️ Make me a group admin first.');
      if (n.length > 100) throw new UserError('Group names can be 100 characters at most.');
      await ctx.sock.groupUpdateSubject(ctx.chat, n);
      return ctx.reply(`✅ Group renamed to *${n}*`, { title: 'Group name' });
    }
    if (!ctx.isOwner) throw new UserError('🔒 Only the bot owner can change the profile name.');
    if (n.length > 25) throw new UserError('Profile names can be 25 characters at most.');
    await ctx.sock.updateProfileName(n);
    await ctx.reply(`✅ Profile name is now *${n}*`, { title: 'Profile' });
  });
  def('setbio', { cat: 'user', owner: true, usage: 'setbio <text>', desc: 'Change the bot\'s WhatsApp "About" text.' }, async ctx => {
    const n = ctx.input().trim();
    if (!n || n.length > 139) throw new UserError('Give a bio of up to 139 characters.');
    await ctx.sock.updateProfileStatus(n);
    await ctx.reply(`✅ About text updated:\n${n}`, { title: 'Profile' });
  });

  /* ---------------- access / state ---------------- */
  def('public', { cat: 'vars', owner: true, core: true, desc: 'Let everyone use the bot (same as mode public).' }, async ctx => { setVar(ctx, 'MODE', 'public'); await ctx.reply('🌍 Mode is now *PUBLIC*. Everyone can use my commands.', { title: 'Mode' }); });
  def('self', { cat: 'vars', owner: true, core: true, desc: 'Only you and sudo users can use the bot (same as mode private).' }, async ctx => { setVar(ctx, 'MODE', 'private'); await ctx.reply('🔒 Mode is now *PRIVATE*. Only you and sudo users can use commands.', { title: 'Mode' }); });

  def('maintenance', { cat: 'vars', owner: true, core: true, usage: 'maintenance on [message] • maintenance off', desc: 'Pause the bot for everyone except you, with a message people see when they try a command.' }, async ctx => {
    const a = (ctx.argv[0] || '').toLowerCase();
    if (a === 'on') { setVar(ctx, 'MAINTENANCE', 'on'); const m = ctx.args.slice(2).trim(); if (m) setVar(ctx, 'MAINTENANCE_MESSAGE', m.slice(0, 200)); return ctx.reply('🛠️ Maintenance mode is *ON*. Only you can use commands.', { title: 'Maintenance' }); }
    if (a === 'off') { setVar(ctx, 'MAINTENANCE', 'off'); return ctx.reply('✅ Maintenance mode is *OFF*. The bot is back for everyone.', { title: 'Maintenance' }); }
    await ctx.reply(`Maintenance is *${ctx.var('MAINTENANCE') === 'on' ? 'ON' : 'OFF'}*.\nUse *${P(ctx)}maintenance on <message>* or *off*.`, { title: 'Maintenance' });
  });
  def('shutdown', { cat: 'vars', owner: true, core: true, desc: 'Stop answering everyone except you until you run "maintenance off". The connection stays up so you can switch it back on.' }, async ctx => {
    setVar(ctx, 'MAINTENANCE', 'on'); setVar(ctx, 'MAINTENANCE_MESSAGE', 'The bot has been shut down by its owner.');
    await ctx.reply(`⏻ Bot shut down for everyone except you.\nTurn it back on with *${P(ctx)}maintenance off*.`, { title: 'Shutdown' });
  });
  def('shutdownstatus', { cat: 'vars', owner: true, core: true, desc: 'Is the bot paused for others?' }, async ctx => {
    const on = ctx.var('MAINTENANCE') === 'on';
    await ctx.reply(`${on ? '⏻ PAUSED' : '🟢 RUNNING'}\n${on ? `Message: ${ctx.var('MAINTENANCE_MESSAGE') || 'under maintenance'}` : 'The bot answers everyone allowed by the current mode.'}\nMode: ${ctx.var('MODE')}`, { title: 'Status' });
  });

  def('logout', { cat: 'bot', owner: true, core: true, usage: 'logout yes', desc: 'Unlink this WhatsApp number from the bot (you will need to pair again). Needs "yes".' }, async ctx => {
    if ((ctx.argv[0] || '').toLowerCase() !== 'yes') throw new UserError(`This unlinks the bot from WhatsApp and you will have to pair again.\nConfirm with *${P(ctx)}logout yes*.`);
    await ctx.reply('👋 Logging out. Pair again from the website when you want me back.', { title: 'Logout' });
    setTimeout(() => ctx.sock.logout().catch(() => {}), 1500);
  });
  def('reconnect', { cat: 'bot', owner: true, core: true, desc: 'Drop and re-open this session\'s WhatsApp connection.' }, async ctx => {
    await ctx.reply('🔄 Reconnecting. I will be back in a few seconds.', { title: 'Reconnect' });
    setTimeout(() => ctx.sock.end(new Error('Manual reconnect')), 1200);
  });
  def('restart', { cat: 'bot', core: true, desc: 'Restart the whole bot service (server operator only; START.bat brings it back).' }, async ctx => {
    requireHost(ctx);
    await ctx.reply('♻️ Restarting the service. START.bat will bring it back shortly.', { title: 'Restart' });
    await ctx.store.flushAll().catch(() => {});
    setTimeout(() => process.exit(0), 1500);
  });
};
