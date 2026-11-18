'use strict';
/**
 * Community + fun + group helpers:
 *   Chat levels: .rank [@user]  .top        (earn XP by chatting in groups)
 *   Fun: .8ball  .ship  .truth  .dare  .choose  .rps
 *   Groups: .rules  .setrules  .admins
 *   Bot: .stats
 */
const U = require('../lib/util');
const { UserError, bold } = U;

const levelOf = xp => Math.floor(Math.sqrt(xp / 40));
const xpFor = lvl => lvl * lvl * 40;
const bar = (frac, n = 10) => '▰'.repeat(Math.round(frac * n)) + '▱'.repeat(n - Math.round(frac * n));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const hash = s => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const medal = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;

const TRUTHS = ['What is the most embarrassing thing you have done in public?', 'Who was your first crush?', 'What is a secret talent nobody here knows about?', 'What is the last lie you told?', 'Which app do you waste the most time on?', 'What is the worst gift you have ever received?', 'Have you ever pretended to be sick to skip something?', 'What is your most unpopular opinion?', 'Which person in this chat would you swap lives with for a day?', 'What is something you are afraid to tell your parents?', 'What song do you secretly love but never admit?', 'What is the longest you have gone without showering?'];
const DARES = ['Send a voice note singing the chorus of your favourite song.', 'Change your WhatsApp status to "I love broccoli" for one hour.', 'Send the 7th photo in your gallery (no cheating).', 'Type the next three messages using only emojis.', 'Send a voice note saying a tongue twister three times fast.', 'Compliment everyone in this chat, one by one.', 'Tell us a joke. If nobody laughs, do it again.', 'Send a selfie making your silliest face.', 'Speak only in questions for the next 10 minutes.', 'Send a voice note doing your best animal impression.'];
const BALL = ['It is certain.', 'Without a doubt.', 'Yes, definitely.', 'Most likely.', 'Signs point to yes.', 'Ask again later.', 'Cannot predict now.', 'Better not tell you now.', 'Do not count on it.', 'My sources say no.', 'Very doubtful.', 'Outlook not so good.'];

module.exports = ({ def, hooks }) => {
  const P = ctx => ctx.var('PREFIX');

  /* ---------------- chat levels ---------------- */
  hooks.push({
    name: 'xp', run: async ctx => {
      if (!ctx.isGroup || ctx.fromMe || !ctx.fresh || !ctx.text || ctx.text.startsWith(ctx.var('PREFIX')) || !ctx.senderNum) return false;
      const last = (ctx.rt.xpLast ||= new Map());
      const k = `${ctx.chat}|${ctx.senderNum}`;
      if (Date.now() - (last.get(k) || 0) < 30000) return false; // one XP gain per 30s per person
      last.set(k, Date.now());
      if (last.size > 5000) last.delete(last.keys().next().value);
      ctx.update('xp', {}, o => {
        const c = (o[ctx.chat] ||= {});
        const u = (c[ctx.senderNum] ||= { xp: 0, msgs: 0, name: '' });
        u.xp += rnd(8, 15); u.msgs++; if (ctx.name) u.name = ctx.name;
        const keys = Object.keys(c);
        if (keys.length > 600) { const low = keys.sort((a, b) => c[a].xp - c[b].xp)[0]; delete c[low]; }
      });
      return false;
    }
  });

  const board = ctx => Object.entries(ctx.get('xp', {})[ctx.chat] || {}).map(([id, u]) => ({ id, ...u })).sort((a, b) => b.xp - a.xp);

  def(['rank', 'level', 'xp'], { cat: 'community', usage: 'rank [@user]', desc: 'Your chat level and XP in this group. You earn XP by chatting.' }, async ctx => {
    if (!ctx.isGroup) throw new UserError('Levels are tracked in groups.');
    const target = ctx.targets()[0];
    const id = target ? ctx.jidUser(target) : ctx.senderNum;
    const all = board(ctx);
    const pos = all.findIndex(u => u.id === id);
    if (pos < 0) throw new UserError(target ? 'That person has no XP yet.' : 'You have no XP yet. Chat in the group to earn some!');
    const u = all[pos], lvl = levelOf(u.xp), lo = xpFor(lvl), hi = xpFor(lvl + 1);
    await ctx.reply(`👤 ${bold(u.name || '+' + u.id)}\n🏅 Rank: ${bold('#' + (pos + 1))} of ${all.length}\n⭐ Level: ${bold(String(lvl))}\n✨ XP: ${u.xp}  (${hi - u.xp} to level ${lvl + 1})\n${bar((u.xp - lo) / (hi - lo))}\n💬 Messages: ${u.msgs}`, { title: 'Rank card' });
  });

  def(['top', 'ranks', 'chatboard'], { cat: 'community', usage: 'top', desc: 'Top 10 most active members of this group.' }, async ctx => {
    if (!ctx.isGroup) throw new UserError('Levels are tracked in groups.');
    const all = board(ctx).slice(0, 10);
    if (!all.length) throw new UserError('Nobody has XP yet. Start chatting!');
    await ctx.reply(all.map((u, i) => `${medal(i)} ${bold(u.name || '+' + u.id)} — Lv ${levelOf(u.xp)} • ${u.xp} XP`).join('\n'), { title: 'Top chatters' });
  });

  /* ---------------- fun ---------------- */
  def(['8ball', 'ball'], { cat: 'game', usage: '8ball <question>', desc: 'Ask the magic 8-ball.' }, async ctx => {
    if (!ctx.args) throw new UserError(`Ask a question, e.g. *${P(ctx)}8ball will I pass?*`);
    await ctx.reply(`❓ ${ctx.args}\n\n🎱 ${bold(BALL[Math.floor(Math.random() * BALL.length)])}`, { title: 'Magic 8-ball' });
  });

  def(['ship', 'love'], { cat: 'game', usage: 'ship <name> & <name>   (or @mention two people)', desc: 'Love compatibility between two names.' }, async ctx => {
    let names = ctx.args.split(/\s*(?:&|\+|,|\band\b|\bx\b)\s*/i).map(x => x.replace(/@/g, '').trim()).filter(Boolean);
    if (names.length === 1) names.unshift(ctx.name || 'You');
    if (names.length < 2) throw new UserError(`Usage: *${P(ctx)}ship Amina & Brian*`);
    names = names.slice(0, 2);
    const pct = hash([...names].map(n => n.toLowerCase()).sort().join('+')) % 101;
    const msg = pct > 85 ? 'Soulmates! 💍' : pct > 65 ? 'Great match! 💖' : pct > 40 ? 'There is potential 🙂' : pct > 20 ? 'Just friends 🤝' : 'Not meant to be 💔';
    await ctx.reply(`💘 ${bold(names[0])} + ${bold(names[1])}\n\n${bar(pct / 100)} ${bold(pct + '%')}\n${msg}`, { title: 'Love meter' });
  });

  def('truth', { cat: 'game', desc: 'A random truth question for truth or dare.' }, async ctx => ctx.reply(TRUTHS[Math.floor(Math.random() * TRUTHS.length)], { title: 'Truth 🫣' }));
  def('dare', { cat: 'game', desc: 'A random dare for truth or dare.' }, async ctx => ctx.reply(DARES[Math.floor(Math.random() * DARES.length)], { title: 'Dare 😈' }));

  def(['choose', 'pick'], { cat: 'game', usage: 'choose pizza | burger | chips', desc: 'Let the bot pick for you. Separate options with | or commas.' }, async ctx => {
    const opts = ctx.args.split(/\s*[|,]\s*|\s+or\s+/i).map(x => x.trim()).filter(Boolean);
    if (opts.length < 2) throw new UserError(`Give at least two options: *${P(ctx)}choose pizza | burger*`);
    await ctx.reply(`🤔 ${opts.join('  •  ')}\n\n👉 ${bold(opts[Math.floor(Math.random() * opts.length)])}`, { title: 'Decision' });
  });

  def('rps', { cat: 'game', usage: 'rps rock|paper|scissors', desc: 'Rock paper scissors against the bot.' }, async ctx => {
    const map = { rock: '🪨', paper: '📄', scissors: '✂️', r: 'rock', p: 'paper', s: 'scissors' };
    const me = ({ r: 'rock', p: 'paper', s: 'scissors' })[ctx.argv[0]?.toLowerCase()] || ctx.argv[0]?.toLowerCase();
    if (!['rock', 'paper', 'scissors'].includes(me)) throw new UserError(`Choose one: *${P(ctx)}rps rock*, *paper* or *scissors*`);
    const bot = ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)];
    const win = me === bot ? 'draw' : ({ rock: 'scissors', paper: 'rock', scissors: 'paper' })[me] === bot ? 'win' : 'lose';
    await ctx.reply(`You: ${map[me]} ${me}\nBot: ${map[bot]} ${bot}\n\n${win === 'win' ? '🎉 You win!' : win === 'lose' ? '😎 I win!' : '🤝 Draw!'}`, { title: 'Rock Paper Scissors' });
  });

  /* ---------------- group helpers ---------------- */
  def('setrules', { cat: 'group', usage: 'setrules <text> • setrules off', desc: 'Set the rules shown by .rules (group admins).' }, async ctx => {
    if (!ctx.isGroup) throw new UserError('Use this in a group.');
    if (!ctx.isOwner && !(await ctx.admin())) throw new UserError('Only group admins can set the rules.');
    if (!ctx.args) throw new UserError(`Usage: *${P(ctx)}setrules 1. Be kind 2. No spam*`);
    if (/^(off|clear|delete)$/i.test(ctx.args)) { ctx.update('rules', {}, o => { delete o[ctx.chat]; }); return ctx.reply('🗑️ Rules removed.'); }
    ctx.update('rules', {}, o => { o[ctx.chat] = ctx.args.slice(0, 1500); });
    await ctx.reply(`✅ Rules saved. Members can read them with *${P(ctx)}rules*.`, { title: 'Group rules' });
  });
  def('rules', { cat: 'group', desc: 'Show the group rules.' }, async ctx => {
    if (!ctx.isGroup) throw new UserError('Use this in a group.');
    const r = ctx.get('rules', {})[ctx.chat];
    if (!r) throw new UserError(`No rules set yet. Admins: *${P(ctx)}setrules <text>*`);
    await ctx.reply(r, { title: 'Group rules' });
  });
  def(['admins', 'staff'], { cat: 'group', desc: 'List and mention the group admins.' }, async ctx => {
    const meta = await ctx.group();
    const adm = meta.participants.filter(p => ctx.isAdminP(p));
    if (!adm.length) throw new UserError('No admins found.');
    const jids = adm.map(p => p.phoneNumber || p.jid || p.id);
    await ctx.send({ text: ctx.frame(jids.map((j, i) => `${i + 1}. @${ctx.jidUser(j)}`).join('\n'), `Admins (${adm.length})`), mentions: jids }, { quoted: ctx.msg });
  });

  /* ---------------- bot info ---------------- */
  def(['stats', 'uptime', 'botinfo'], { cat: 'bot', desc: 'Bot uptime, memory use and status.' }, async ctx => {
    const up = process.uptime();
    const d = Math.floor(up / 86400), h = Math.floor(up % 86400 / 3600), m = Math.floor(up % 3600 / 60);
    const mem = process.memoryUsage();
    await ctx.reply([
      `⏱️ ${bold('Uptime')}: ${d ? d + 'd ' : ''}${h}h ${m}m`,
      `🧠 ${bold('Memory')}: ${Math.round(mem.rss / 1048576)} MB`,
      `⚙️ ${bold('Node')}: ${process.version}`,
      `🔣 ${bold('Prefix')}: ${P(ctx)}   •   🔐 ${bold('Mode')}: ${ctx.var('MODE') || 'public'}`,
      `🎨 ${bold('Frame')}: ${ctx.var('FRAME_STYLE')}   •   📡 ${bold('Channel header')}: ${ctx.var('CHANNEL_FORWARD') === 'off' ? 'off' : 'on'}`
    ].join('\n'), { title: 'Bot stats' });
  });
};

module.exports._test = { levelOf, xpFor };
