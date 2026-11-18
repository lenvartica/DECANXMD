'use strict';
const os = require('os');
const { bold, tzParts, fmtDur, progressBar } = require('../lib/util');
const { getHostingPlatform } = require('../lib/platform');
const menus = require('../lib/menus');
const fonts = require('../lib/fonts');
const { sendButtons } = require('../lib/interactive');

module.exports = ({ def }) => {
  const idx = () => require('./index');

  function visible(ctx) {
    const { registry, categories, CATEGORY_ORDER } = idx();
    const off = ctx.get('disabled', []);
    const offCats = ctx.get('disabledCats', []);
    const cats = CATEGORY_ORDER.filter(c => categories.has(c) && !offCats.includes(c));
    return { registry, categories, cats, off };
  }

  function infoBox(ctx) {
    const { registry } = idx();
    const p = tzParts(ctx.tz());
    const used = Math.round(process.memoryUsage().rss / 1048576);
    const total = Math.round(os.totalmem() / 1048576);
    const total_cmds = new Set([...registry.values()].filter(d => d.cat).map(d => d.name)).size;
    const row = (k, v) => `┃ ❖ ${bold(k.padEnd(8))}: ${v}`;
    return [
      '┏❒ 👑 ✦ 𝐃𝐄𝐂𝐀𝐍 𝐗𝐌𝐃 ✦ 👑 ❒',
      row('Prefix', ctx.var('PREFIX')),
      row('User', ctx.name || ctx.senderNum),
      row('Time', p.time),
      row('Day', p.weekday),
      row('Date', p.date),
      row('Version', require('../package.json').version),
      row('Plugins', total_cmds),
      row('Ram', `${used}/${total}MB`),
      row('Uptime', fmtDur((Date.now() - ctx.rt.started) / 1000)),
      row('Mode', ctx.var('MODE')),
      row('Platform', getHostingPlatform()),
      '┗❒ ❤️ POWERED BY DECAN KONNECT'
    ].join('\n');
  }

  // ---- Menu (v1.2.0) -------------------------------------------------------------------------------------------
  // Themed sections (your reordered layout). Names that are not real commands are never shown, so the menu cannot list a
  // dead entry; disabled commands are hidden too. Section titles use the owner's chosen font (.menufont).
  const SECTIONS = [
      ['👑 Owner Commands', ['menu', 'owner', 'restart', 'shutdown', 'update', 'settings', 'setprefix', 'setname', 'setbio', 'setstatus', 'setpp', 'broadcast', 'ban', 'unban', 'block', 'unblock', 'eval', 'exec', 'sessions', 'clearcache', 'fixsession', 'access', 'alias', 'unalias', 'aliases', 'limits', 'doctor', 'menufont']],
      ['👥 Group Management', ['kick', 'add', 'promote', 'demote', 'tagall', 'hidetag', 'everyone', 'groupinfo', 'grouplink', 'revoke', 'setname', 'setdesc', 'open', 'close', 'lock', 'unlock', 'mute', 'unmute', 'delete', 'warn', 'warnings', 'resetwarn']],
      ['🤖 AI & ChatGPT', ['ai', 'chatgpt', 'ask', 'imagine', 'vision', 'analyze', 'summarize', 'translate', 'grammar', 'rewrite', 'code', 'debug', 'explain', 'gemini', 'deepseek', 'llama', 'prompt', 'clear']],
      ['🎨 Image Generation & Editing', ['imagine', 'generate', 'sticker', 's', 'take', 'toimg', 'removebg', 'enhance', 'upscale', 'blur', 'crop', 'resize', 'circle', 'wanted', 'wasted', 'meme', 'quote']],
      ['🎵 Music & Audio', ['play', 'song', 'yta', 'lyrics', 'bass', 'deep', 'nightcore', 'slow', 'fast', 'reverse', 'volume', 'mp3', 'audioconvert', 'tts', 'transcribe', 'voice']],
      ['🎬 Video & Media', ['video', 'ytv', 'ytmp4', 'tiktok', 'instagram', 'facebook', 'twitter', 'mediafire', 'pinterest', 'download', 'screenshot', 'gif', 'mp4']],
      ['📥 Downloaders & Apps', ['apk', 'movie', 'drama', 'cartoon', 'apksearch', 'apkdl', 'appinfo', 'gitclone', 'ghrelease', 'ytthumb', 'play', 'song', 'yta', 'ytv', 'tiktok', 'instagram', 'facebook', 'twitter', 'pinterest', 'reddit', 'soundcloud', 'spotify', 'mediafire', 'gdrive', 'download', 'upload']],
      ['⚽ Football & Sports', ['livescore', 'fixtures', 'results', 'match', 'table', 'fulltable', 'titlerace', 'relegation', 'wcgroups', 'ustable', 'squad', 'nextmatch', 'lastresults', 'scorers', 'leaguenews', 'injuries', 'transfers', 'sportnews', 'player', 'leagues', 'livealerts', 'matchday', 'epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'ucl', 'nba', 'nfl', 'f1', 'sportsmenu']],
      ['🤼 WWE & Wrestling', ['wwe', 'raw', 'smackdown', 'nxt', 'wwechamps', 'wweschedule', 'wweresults', 'wwerumors', 'wwemania', 'royalrumble', 'summerslam', 'survivorseries', 'aew', 'superstar', 'wwedraft', 'wwehof', 'wwewomen']],
      ['🖼️ Photo Studio', ['enhance', 'hd', 'autofix', 'hdr', 'brighten', 'darken', 'contrast', 'saturate', 'fade', 'warm', 'cool', 'vintage', 'noir', 'glow', 'dreamy', 'cyberpunk', 'sunset', 'emboss', 'oldphoto', 'vignettefx', 'cleanimg', 'mirrorfx', 'neonedge', 'duotone', 'polaroid', 'roundcorners', 'sketch', 'cartoon', 'pencil', 'bokeh', 'picfilters']],
      ['🛡️ Security & Protection', ['antidelete', 'antiviewonce', 'antiedit', 'antispam', 'antilink', 'antibot', 'antitag', 'antifake', 'autoread', 'autoviewstatus', 'autoreactstatus', 'autoreact', 'privacy', 'blocklist', 'spamcheck']],
      ['📱 WhatsApp Status', ['tostatus', 'textstatus', 'statusimage', 'statusvideo', 'statusaudio', 'save', 'ss', 'vv', 'vv2', 'status', 'getstatus', 'savestatus', 'autoviewstatus', 'autoreactstatus', 'statuslike', 'statusprivacy']],
      ['🔗 Pairing & Connection', ['pair', 'paircode', 'qr', 'connect', 'disconnect', 'reconnect', 'connection', 'session', 'logout']],
      ['🔍 Search & Information', ['google', 'search', 'wikipedia', 'weather', 'news', 'define', 'movie', 'anime', 'github', 'npm', 'image', 'wallpaper']],
      ['🎮 Games & Entertainment', ['quiz', 'trivia', 'riddle', 'guess', 'tictactoe', 'hangman', 'snake', 'joke', 'fact', 'ship', 'truth', 'dare', 'wordle']],
      ['🧰 Utility & Productivity', ['calculator', 'textqr', 'shorturl', 'weather', 'time', 'date', 'translate', 'currency', 'remind', 'password', 'reverse', 'dictionary', 'wordcount', 'age', 'loan', 'tip']],
      ['💻 Developer Tools', ['github', 'repo', 'npm', 'html', 'css', 'javascript', 'python', 'php', 'json', 'base64', 'urlencode', 'qr', 'uptime', 'system', 'ping']],
      ['🌐 Bot Information', ['menu', 'help', 'about', 'owner', 'repo', 'script', 'runtime', 'ping', 'status', 'alive', 'version', 'support', 'channel', 'report']],
      ['⚙️ Automation & Customization', ['autoreact', 'autoread', 'autotyping', 'autobio', 'autostatus', 'autolikestatus', 'prefix', 'setprefix', 'setwelcome', 'setgoodbye', 'menufont', 'settimezone', 'setlanguage', 'antidelete']],
      ['🔤 Fonts & Text Style', ['style', 'fontlist', 'fonts', 'fancy', 'bold', 'italic', 'mono', 'smallcaps', 'bubble', 'strike', 'underline', 'vapor', 'zalgo', 'flip', 'menufont']],
      ['✍️ Text Tools', ['wordcount', 'textcase', 'slug', 'lorem', 'mock', 'clap', 'uwu', 'leet', 'piglatin', 'nato', 'acronym', 'initials', 'charcount', 'sortlines', 'uniquelines', 'reverselines', 'numberlines', 'extractemails', 'extracturls', 'extractnumbers', 'anagram', 'palindrome', 'urlparse']],
      ['💰 Money & Finance', ['loan', 'savings', 'compound', 'splitbill', 'vat', 'tip', 'discount', 'percent', 'percentchange', 'roi', 'margin', 'breakeven']],
      ['📅 Dates & Time', ['age', 'daysbetween', 'dateadd', 'workdays', 'weeknum', 'dayofweek', 'leapyear', 'sleepcalc', 'generation', 'birthstone', 'zodiac']],
      ['🔢 Numbers & Converters', ['roman', 'numwords', 'prime', 'baseconv', 'temp', 'convert', 'hexcolor', 'ipcalc']],
      ['🎛️ Control Center', ['access', 'alias', 'unalias', 'aliases', 'limits', 'doctor', 'menufont']]
    ];

  const stripLead = t => t.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const fontOf = ctx => fonts.find(ctx.var('MENU_FONT') || 'boldserif') || fonts.find('boldserif');
  const styledTitle = (title, font) => { const m = title.match(/^([^\p{L}\p{N}]*)(.*)$/u); return `${m[1]}${font.fn(m[2].toUpperCase())}`.trim(); };
  function liveSections(ctx) {
    const { registry } = idx();
    const off = new Set(ctx.get('disabled', []));
    return SECTIONS.map(([title, cmds]) => [title, cmds.filter(c => registry.has(c) && !off.has(c))]).filter(([, cmds]) => cmds.length);
  }
  const block = (P, font, title, cmds) => `╭━━〔 *${styledTitle(title, font)}* 〕\n${cmds.map(c => `│ ◈ *${P}${c}*`).join('\n')}\n╰━━━━━━━━━━━━━━━━━━`;
  const FOOT = '┏❒ 👑 ✦ 𝐃𝐄𝐂𝐀𝐍 𝐗𝐌𝐃 ✦ 👑 ❒';

  def(['menu', 'list'], { core: true, public: true, usage: 'menu • menu <section|number> • menu list • menu new • menu cats', desc: 'Show the command menu.' }, async ctx => {
    const P = ctx.var('PREFIX') || '.';
    const { registry, categories, CATEGORY_ORDER } = idx();
    const ver = require('../package.json').version;
    const font = fontOf(ctx);
    const secs = liveSections(ctx);
    const commandCount = new Set([...registry.values()].filter(d => d.cat).map(d => d.name)).size;
    const ramPct = (1 - os.freemem() / os.totalmem()) * 100; // system memory in use
    const p = tzParts(ctx.tz());
    const host = getHostingPlatform();
    const uptime = fmtDur((Date.now() - ctx.rt.started) / 1000);
    const send = text => ctx.send({ text, contextInfo: ctx.adContext(true), noFrame: true }, { quoted: ctx.msg });
    const arg = (ctx.argv.join(' ') || '').toLowerCase().trim();

    if (arg === 'list' || arg === 'index' || arg === 'sections') {
      const rows = secs.map(([t, c], i) => `│ ${i < 9 ? ' ' : ''}*${i + 1}.* ${t}  _(${c.length})_`).join('\n');
      return send(`╭━━〔 *${styledTitle('📚 Menu sections', font)}* 〕\n${rows}\n╰━━━━━━━━━━━━━━━━━━\n_Open one:_ *${P}menu <number or name>*  •  *${P}menu new*  •  *${P}menu cats*\n${FOOT}`);
    }
    if (arg === 'new') {
      const fresh = [...new Set([...registry.values()].filter(d => d.cat && d.since === ver).map(d => d.name))].sort();
      return send(`${block(P, font, `✨ New in v${ver}`, fresh)}\n${FOOT}`);
    }
    if (arg === 'cats' || arg === 'categories') {
      const rows = CATEGORY_ORDER.filter(c => categories.has(c)).map(c => `│ ◈ *${P}menu cat ${c}*  _(${new Set(categories.get(c).map(d => d.name)).size})_`).join('\n');
      return send(`╭━━〔 *${styledTitle('🗂️ Every category', font)}* 〕\n${rows}\n╰━━━━━━━━━━━━━━━━━━\n${FOOT}`);
    }
    if (/^cat(egory)?\s+\S+/.test(arg)) {
      const want = arg.replace(/^cat(egory)?\s+/, '');
      const key = CATEGORY_ORDER.find(c => c === want) || CATEGORY_ORDER.find(c => c.startsWith(want));
      const names = key ? [...new Set([...registry.values()].filter(d => d.cat === key).map(d => d.name))].sort() : [];
      if (!names.length) return ctx.reply(`No category called *${want}*. See *${P}menu cats*.`);
      return send(`${block(P, font, `📁 ${key}`, names)}\n${FOOT}`);
    }
    if (arg && arg !== 'all' && arg !== 'full') {
      const n = /^\d+$/.test(arg) ? Number(arg) - 1 : secs.findIndex(([t]) => stripLead(t).toLowerCase().includes(arg));
      const hit = secs[n];
      if (!hit) return ctx.reply(`No menu section matches *${arg}*. See *${P}menu list*.`);
      return send(`${block(P, font, hit[0], hit[1])}\n_Details:_ *${P}help <command>*\n${FOOT}`);
    }

    const fresh = new Set([...registry.values()].filter(d => d.cat && d.since === ver).map(d => d.name)).size;
    const menu = `┏❒ 👑 ✦ 𝐃𝐄𝐂𝐀𝐍 𝐗𝐌𝐃 ✦ 👑 ❒
_Building a smarter WhatsApp experience._
┃
┃ *Usᴇʀ:* Decan Konnect Tech Services
┃ *Oᴡɴᴇʀ:* Sir Lenny Muriuki
┃ *Mᴏᴅᴇ:* ${String(ctx.var('MODE') || 'PUBLIC').toUpperCase()}
┃ *Hᴏsᴛ:* ${host}
┃ *Pʀᴇғɪx:* [ ${P} ]
┃ *Cᴏᴍᴍᴀɴᴅs:* ${commandCount}
┃ *Vᴇʀsɪᴏɴ:* ${ver}
┃ *Rᴀᴍ:* ${progressBar(ramPct)}
┃ *Uᴘᴛɪᴍᴇ:* ${uptime}
┃
┗❒
╭━━〔 *${styledTitle('⚜️ Status', font)}* 〕
│ *👤 User      :* ${ctx.name || ctx.senderNum}
│ *🕰️ Time      :* ${p.time}:${p.s}
│ *📅 Date      :* ${p.date}
│ *✨ New       :* ${fresh} commands in v${ver} → *${P}menu new*
│ *📚 Sections  :* *${P}menu list*  •  *${P}menu <name>*
╰━━━━━━━━━━━━━━━━━━
${secs.map(([t, c]) => block(P, font, t, c)).join('\n')}
${FOOT}`;
    await send(menu);
  });

  // .menufont — pick the font used for menu section titles
  def('menufont', { cat: 'bot', owner: true, usage: 'menufont <style name or number> • menufont reset • menufont list', desc: 'Choose the font used for the menu section titles.' }, async ctx => {
    const P = ctx.var('PREFIX') || '.';
    const a = (ctx.argv[0] || '').toLowerCase();
    if (!a || a === 'list') {
      const cur = fontOf(ctx);
      return ctx.reply(`${fonts.list().map(s => `${String(s.n).padStart(2)}. ${s.fn('MENU')}  ${s.label}${s.id === cur.id ? '  ✅' : ''}`).join('\n')}\n\nSet one: *${P}menufont 8*  or  *${P}menufont script*`, { title: 'Menu fonts' });
    }
    if (a === 'reset') { ctx.update('vars', {}, v => { delete v.MENU_FONT; }); return ctx.reply('✅ Menu font reset to *Bold Serif*.'); }
    const f = fonts.find(a);
    if (!f) return ctx.reply(`Unknown font. See *${P}menufont list*.`);
    ctx.update('vars', {}, v => { v.MENU_FONT = f.id; });
    await ctx.reply(`✅ Menu titles now use *${f.label}*: ${f.fn('MENU')}\nSend *${P}menu* to see it.`);
  });

  // .toggle <name> — flips one switch from the On/Off Controls page (or by typing it). Gating mirrors the real command:
  // bot-wide switches are owner-only, group switches need a group admin.
  def('toggle', { core: true, public: true, usage: 'toggle <switch name>', desc: 'Flip an on/off switch (used by the On/Off Controls buttons).' }, async ctx => {
    const t = menus.findToggle(ctx.argv[0]);
    if (!t) return ctx.reply(`Unknown switch. Open *${ctx.var('PREFIX')}menu toggles* to see them all.`);
    if (t.scope === 'owner' && !ctx.isOwner) return ctx.reply('🔒 This switch is for the bot owner only.');
    if (t.scope === 'group') {
      if (!ctx.isGroup) return ctx.reply('👥 This switch works in groups only.');
      if (!ctx.isOwner && !(await ctx.admin())) return ctx.reply('🛡️ Only group admins can change this switch.');
    }
    const target = idx().registry.get(t.name);
    if (!target) return ctx.reply('That command is not available.');
    const next = menus.isOn(ctx, t) ? 'off' : 'on';
    const sub = Object.assign(Object.create(ctx), { cmd: t.name, args: next, argv: [next], input: () => next });
    await target.run(sub);
    const at = menus.visibleToggles(ctx).findIndex(x => x.name === t.name);
    await menus.sendToggles(ctx, Math.floor(Math.max(0, at) / menus.PER_PAGE) + 1);
  });

  def('help', { core: true, public: true }, async ctx => {
    const { registry } = idx();
    const n = ctx.argv[0]?.toLowerCase().replace(/^[^a-z0-9]+/, '');
    if (!n) return sendButtons(ctx, { title: 'Help', body: `Send *${ctx.var('PREFIX')}menu* to see every command.\nSend *${ctx.var('PREFIX')}help <command>* for details.`, buttons: [{ label: '📋 Menu', cmd: 'menu' }, { label: '🟢 Alive', cmd: 'alive' }, { label: '🏓 Ping', cmd: 'ping' }] });
    const d = registry.get(n);
    if (!d || !d.cat) return ctx.reply(`No command called *${n}*.`);
    const flags = [d.owner && 'owner only', d.group && 'group only', d.admin && 'admins only', d.botAdmin && 'bot must be admin'].filter(Boolean).join(', ');
    await ctx.reply([
      `${bold('Command')}: ${ctx.var('PREFIX')}${d.name}`,
      d.names.length > 1 ? `${bold('Aliases')}: ${d.names.slice(1).join(', ')}` : null,
      `${bold('Category')}: ${d.cat}`,
      d.desc ? `${bold('What it does')}: ${d.desc}` : null,
      d.usage ? `${bold('Usage')}: ${ctx.var('PREFIX')}${d.usage}` : null,
      flags ? `${bold('Access')}: ${flags}` : null
    ].filter(Boolean).join('\n'), { title: 'Help' });
  });

  def('alive', { cat: 'misc', desc: 'Check that the bot is running.' }, async ctx => {
    const custom = ctx.var('ALIVE_MESSAGE');
    await sendButtons(ctx, {
      body: custom || `🟢 ${bold('I am alive and running!')}\n\n⏱ Uptime: ${fmtDur((Date.now() - ctx.rt.started) / 1000)}\n⚙️ Mode: ${ctx.var('MODE')}\n📌 Prefix: ${ctx.var('PREFIX')}\n\nTap a button or send *${ctx.var('PREFIX')}menu*.`,
      buttons: [{ label: '📋 Menu', cmd: 'menu' }, { label: '🏓 Ping', cmd: 'ping' }, { label: '❓ Help', cmd: 'help' }]
    });
  });

  def('ping', { cat: 'misc', desc: 'Measure response speed.', public: true }, async ctx => {
    const t0 = Date.now();
    const sent = await ctx.plain('🏓 Pinging…');
    const ms = Date.now() - t0;
    const text = ctx.frame(`🏓 ${bold('Pong!')}\n⚡ Speed: ${ms} ms`);
    await ctx.send({ text, edit: sent.key }).catch(() => ctx.plain(text));
  });
};
