'use strict';
const U = require('../lib/util');
const { UserError, bold } = U;

/* ---------- safe calculator (no eval) ---------- */
function calculate(src) {
  const FN = { sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, exp: Math.exp, round: Math.round, floor: Math.floor, ceil: Math.ceil };
  const CONST = { pi: Math.PI, e: Math.E };
  const s = src.toLowerCase().replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '').replace(/\s+/g, '');
  let i = 0;
  const peek = () => s[i];
  function num() {
    const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/);
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function primary() {
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('missing )'); i++; return v; }
    if (peek() === '-') { i++; return -power(); }
    if (peek() === '+') { i++; return power(); }
    const n = num();
    if (n !== null) return n;
    const id = (s.slice(i).match(/^[a-z]+/) || [])[0];
    if (!id) throw new Error('unexpected "' + (peek() || 'end') + '"');
    i += id.length;
    if (id in CONST) return CONST[id];
    if (id in FN) { if (peek() !== '(') throw new Error(id + ' needs ( )'); i++; const v = expr(); if (peek() !== ')') throw new Error('missing )'); i++; return FN[id](v); }
    throw new Error('unknown "' + id + '"');
  }
  function power() { let b = primary(); while (peek() === '^') { i++; b = Math.pow(b, power()); } while (peek() === '%' && !/[\d(a-z.]/.test(s[i + 1] || '')) { i++; b /= 100; } return b; }
  function term() { let v = power(); while (peek() === '*' || peek() === '/' || peek() === '%') { const op = s[i++]; const r = power(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; } return v; }
  function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; }
  const v = expr();
  if (i < s.length) throw new Error('unexpected "' + s[i] + '"');
  if (!Number.isFinite(v)) throw new Error('result is not a finite number');
  return v;
}

/* ---------- fancy fonts ---------- */
const range = (from, upper, lower, digits) => c => {
  const k = c.codePointAt(0);
  if (k >= 65 && k <= 90 && upper) return String.fromCodePoint(upper + k - 65);
  if (k >= 97 && k <= 122 && lower) return String.fromCodePoint(lower + k - 97);
  if (k >= 48 && k <= 57 && digits) return String.fromCodePoint(digits + k - 48);
  return c;
};
const mapFrom = (a, b) => { const m = {}; [...a].forEach((c, i) => (m[c] = [...b][i])); return c => m[c] || c; };
const FONTS = [
  ['Bold', range(0, 0x1D5D4, 0x1D5EE, 0x1D7EC)],
  ['Bold Serif', range(0, 0x1D400, 0x1D41A, 0x1D7CE)],
  ['Italic', range(0, 0x1D608, 0x1D622)],
  ['Bold Italic', range(0, 0x1D63C, 0x1D656)],
  ['Script', range(0, 0x1D4D0, 0x1D4EA)],
  ['Fraktur', range(0, 0x1D56C, 0x1D586)],
  ['Double-struck', range(0, 0x1D538, 0x1D552, 0x1D7D8)],
  ['Monospace', range(0, 0x1D670, 0x1D68A, 0x1D7F6)],
  ['Circled', c => { const k = c.codePointAt(0); return k >= 65 && k <= 90 ? String.fromCodePoint(0x24B6 + k - 65) : k >= 97 && k <= 122 ? String.fromCodePoint(0x24D0 + k - 97) : c; }],
  ['Squared', c => { const k = c.toUpperCase().codePointAt(0); return k >= 65 && k <= 90 ? String.fromCodePoint(0x1F130 + k - 65) : c; }],
  ['Fullwidth', c => { const k = c.codePointAt(0); return k >= 33 && k <= 126 ? String.fromCodePoint(0xFF01 + k - 33) : c === ' ' ? '\u3000' : c; }],
  ['Small caps', mapFrom('abcdefghijklmnopqrstuvwxyz', 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ')],
  ['Upside down', null],
  ['Bubble text', c => { const k = c.codePointAt(0); return k >= 97 && k <= 122 ? String.fromCodePoint(0x24D0 + k - 97) : k >= 65 && k <= 90 ? String.fromCodePoint(0x24B6 + k - 65) : c; }],
  ['Strikethrough', c => c + '\u0336'],
  ['Underline', c => c + '\u0332']
];
const FLIP = mapFrom('abcdefghijklmnopqrstuvwxyz', 'ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz');
const styled = (i, text) => {
  const [, fn] = FONTS[i];
  return fn ? [...text].map(fn).join('') : [...text.toLowerCase()].map(FLIP).reverse().join('');
};

/* ---------- helpers ---------- */
const normJid = s => {
  s = String(s).trim();
  if (s.includes('@')) return s;
  const d = s.replace(/\D/g, '');
  return d.length >= 7 ? d + '@s.whatsapp.net' : null;
};

module.exports = ({ def, hooks }) => {
  def(['channelpromo', 'followchannel'], { cat: 'bot', desc: 'Share the official DECANXMD WhatsApp channel invitation.', public: true }, async ctx => {
    const link = process.env.CHANNEL_URL || 'https://whatsapp.com/channel/0029VbDqBjyFnSzHeIHAzH3m';
    await ctx.reply(`╭━━━〔 ✦ DECANXMD ✦ 〕━━━╮\n\n🚀 *WELCOME TO THE DECANXMD COMMUNITY*\n\nUpdates, new features, useful tools and announcements live on our official WhatsApp channel.\n\n📣 *Join and follow the channel:*\n${link}\n\n✅ Open the invite and tap *Follow* so you do not miss updates.\n\n╰━━━〔 POWERED BY DECANXMD 〕━━━╯`, { title: 'Official Channel Invite' });
  });

  def('calc', { cat: 'misc', usage: 'calc 2+2*5', desc: 'Calculator: + - * / % ^ ( ), sqrt, sin, cos, tan, log, ln, abs, round, pi, e.' }, async ctx => {
    const e = ctx.input();
    if (!e) throw new UserError('Give an expression, e.g. *calc (12+8)*3/4*');
    let v;
    try { v = calculate(e); } catch (err) { throw new UserError('Cannot calculate: ' + err.message); }
    await ctx.reply(`🧮 ${e}\n\n${bold('= ' + (Number.isInteger(v) ? v : +v.toFixed(10)))}`, { title: 'Calculator' });
  });

  def('fancy', { cat: 'misc', usage: 'fancy <text> • fancy <number> <text>', desc: 'Stylish fonts. Without a number it shows all styles.' }, async ctx => {
    let n = null, text = ctx.args;
    const m = ctx.args.match(/^(\d{1,2})\s+([\s\S]+)$/) || (ctx.quoted && ctx.args.match(/^(\d{1,2})$/) ? [null, ctx.args, ctx.textOf(ctx.quoted.message)] : null);
    if (m) { n = Number(m[1]); text = m[2]; }
    else if (!text && ctx.quoted) text = ctx.textOf(ctx.quoted.message);
    if (!text) throw new UserError('Usage: *fancy Hello* then *fancy 3 Hello* to get one style.');
    if (n) {
      if (n < 1 || n > FONTS.length) throw new UserError(`Pick a style from 1 to ${FONTS.length}.`);
      return ctx.reply(styled(n - 1, text), { title: 'Fancy fonts' });
    }
    await ctx.reply(FONTS.map(([name], i) => `${i + 1}. ${styled(i, text.slice(0, 60))}`).join('\n') + `\n\nUse *${ctx.var('PREFIX')}fancy <number> <text>* to get just one.`, { title: 'Fancy fonts' });
  });

  def('qr', { cat: 'misc', heavy: true, usage: 'qr <text/link> • reply to a QR image to read it', desc: 'Create a QR code, or read one from a replied image.' }, async ctx => {
    const txt = ctx.args;
    const m = !txt ? await ctx.media().catch(() => null) : null;
    if (m?.kind === 'image') {
      const jsQR = require('jsqr');
      const { data, info } = await U.sharp()(m.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const r = jsQR(new Uint8ClampedArray(data), info.width, info.height);
      if (!r) throw new UserError('No QR code found in that image.');
      return ctx.reply(r.data, { title: 'QR content' });
    }
    if (!txt) throw new UserError('Give text/link to encode, or reply to a QR image.');
    const QR = require('qrcode');
    await ctx.image(await QR.toBuffer(txt, { width: 600, margin: 2 }), '🔳 QR code');
  });

  def('tts', { cat: 'misc', heavy: true, usage: 'tts [lang] <text>', desc: 'Text to speech voice note (lang like en, sw, fr; default en).' }, async ctx => {
    let lang = 'en', text = ctx.input();
    const first = ctx.args.split(/\s+/)[0];
    if (ctx.args && /^[a-z]{2}(-[A-Z]{2})?$/.test(first) && ctx.args.length > first.length) { lang = first; text = ctx.args.slice(first.length).trim(); }
    if (!text) throw new UserError('Give some text, e.g. *tts Hello there*');
    const chunks = text.slice(0, 600).match(/[\s\S]{1,180}(?:\s|$)/g) || [text];
    const parts = [];
    for (const c of chunks) parts.push(await U.http(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(c.trim())}`, { timeout: 20000 }));
    const ogg = await U.ff(Buffer.concat(parts), { inExt: 'mp3', outExt: 'ogg', args: ['-vn', '-c:a', 'libopus', '-b:a', '48k', '-ac', '1'] });
    await ctx.audio(ogg, true);
  });

  def('url', { cat: 'misc', heavy: true, desc: 'Upload replied media and get a public link (catbox.moe).' }, async ctx => {
    const m = await ctx.media();
    if (!m) throw new UserError('Reply to an image, video, audio or file.');
    const fd = new FormData();
    fd.append('reqtype', 'fileupload');
    fd.append('fileToUpload', new Blob([m.buffer], { type: m.mime || 'application/octet-stream' }), m.name || `file.${(m.mime.split('/')[1] || 'bin').split(';')[0]}`);
    const link = (await U.getText('https://catbox.moe/user/api.php', { method: 'POST', body: fd, timeout: 90000 })).trim();
    if (!/^https?:/.test(link)) throw new UserError('Upload failed: ' + link.slice(0, 100));
    await ctx.reply(`🔗 ${link}`, { title: 'Uploaded' });
  });

  def('rmbg', { cat: 'misc', heavy: true, desc: 'Remove an image background (needs REMOVEBG_API_KEY on the server).' }, async ctx => {
    if (!process.env.REMOVEBG_API_KEY) throw new UserError('Background removal needs a remove.bg key. Add REMOVEBG_API_KEY to the local .env file and restart the bot.');
    const m = await ctx.needMedia('image');
    const fd = new FormData();
    fd.append('size', 'auto');
    fd.append('image_file', new Blob([m.buffer], { type: m.mime || 'image/jpeg' }), 'image.jpg');
    const png = await U.http('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': process.env.REMOVEBG_API_KEY }, body: fd, timeout: 90000 });
    await ctx.doc(png, 'no-background.png', 'image/png', { caption: '✂️ Background removed' });
  });

  def('news', { cat: 'misc', heavy: true, usage: 'news [topic]', desc: 'Top headlines (Google News).' }, async ctx => {
    const reg = process.env.NEWS_REGION || 'KE';
    const q = ctx.input();
    const url = q
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-${reg}&gl=${reg}&ceid=${reg}:en`
      : `https://news.google.com/rss?hl=en-${reg}&gl=${reg}&ceid=${reg}:en`;
    const xml = await U.getText(url);
    const dec = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map(m => ({
      title: dec((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ''),
      link: dec((m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '')
    }));
    if (!items.length) throw new UserError('No news found.');
    await ctx.reply(items.map((n, i) => `${i + 1}. ${n.title}\n🔗 ${n.link}`).join('\n\n'), { title: q ? `News: ${q}` : 'Top news' });
  });

  def('whois', { cat: 'misc', heavy: true, usage: 'whois [@user | number | reply]', desc: 'Show info about a WhatsApp user.' }, async ctx => {
    const [jid] = ctx.targets(true);
    if (!jid) throw new UserError('Mention someone, reply to them, or give a number.');
    const num = ctx.jidUser(jid);
    const lines = [`📞 ${bold('Number')}: ${/^\d+$/.test(num) ? '+' + num : num}`];
    const exists = await ctx.sock.onWhatsApp(jid).catch(() => null);
    if (exists?.[0]) lines.push(`✅ ${bold('On WhatsApp')}: ${exists[0].exists ? 'yes' : 'no'}`);
    try {
      const st = await ctx.sock.fetchStatus(jid);
      const s = Array.isArray(st) ? st[0]?.status : st;
      const text = typeof s === 'object' ? s?.status : s;
      if (text) lines.push(`💬 ${bold('About')}: ${text}`);
    } catch {}
    try {
      const b = await ctx.sock.getBusinessProfile(jid);
      if (b) lines.push(`🏢 ${bold('Business')}: ${b.description || 'yes'}${b.email ? `\n📧 ${b.email}` : ''}${b.website?.[0] ? `\n🌐 ${b.website[0]}` : ''}`);
    } catch {}
    let pic = null;
    try { pic = await ctx.sock.profilePictureUrl(jid, 'image'); } catch {}
    if (pic) await ctx.send({ image: { url: pic }, caption: lines.join('\n') }, { quoted: ctx.msg });
    else await ctx.reply(lines.join('\n'), { title: 'Who is' });
  });

  def('forward', { cat: 'misc', owner: true, usage: 'forward <jid or number> (reply to a message)', desc: 'Forward the replied message to a chat.' }, async ctx => {
    if (!ctx.quoted) throw new UserError('Reply to the message you want to forward.');
    const to = normJid(ctx.argv[0] || '');
    if (!to) throw new UserError('Give a number or chat JID to forward to.');
    await ctx.sock.sendMessage(to, { forward: { key: ctx.quoted.key, message: ctx.quoted.message } });
    await ctx.reply('✅ Forwarded.');
  });
  def('mforward', { cat: 'misc', owner: true, usage: 'mforward <jid1,jid2,…> (reply to a message)', desc: 'Forward the replied message to several chats.' }, async ctx => {
    if (!ctx.quoted) throw new UserError('Reply to the message you want to forward.');
    const list = ctx.args.split(/[\s,]+/).map(normJid).filter(Boolean).slice(0, 25);
    if (!list.length) throw new UserError('Give numbers or JIDs separated by commas.');
    let ok = 0;
    for (const to of list) { try { await ctx.sock.sendMessage(to, { forward: { key: ctx.quoted.key, message: ctx.quoted.message } }); ok++; await U.sleep(1200); } catch {} }
    await ctx.reply(`✅ Forwarded to ${ok}/${list.length} chats.`);
  });
  def('save', { cat: 'misc', owner: true, usage: 'save [here] (reply to a message or a status)', desc: 'Save the replied message, photo, video, voice note or status to your own chat (add "here" to keep it in this chat).' }, async ctx => {
    if (!ctx.quoted) throw new UserError('Reply to the message or status you want to save.');
    const to = /\bhere\b/i.test(ctx.args) ? ctx.chat : ctx.ownerJid;
    const m = await ctx.media().catch(() => null);
    if (m && ['image', 'video', 'audio'].includes(m.kind)) {
      const cap = m.caption ? `💾 ${m.caption}` : '💾 Saved';
      const content = m.kind === 'image' ? { image: m.buffer, caption: cap } : m.kind === 'video' ? { video: m.buffer, caption: cap } : { audio: m.buffer, mimetype: m.mime || 'audio/ogg; codecs=opus', ptt: m.ptt };
      await ctx.sendTo(to, content);
    } else {
      const t = ctx.textOf?.(ctx.quoted?.message);
      try { await ctx.sock.sendMessage(to, { forward: { key: ctx.quoted.key, message: ctx.quoted.message } }); }
      catch { if (!t) throw new UserError('I could not save that message.'); await ctx.sendTo(to, { text: `💾 ${t}` }); }
    }
    await ctx.react('💾');
  });

  def('avm', { cat: 'misc', heavy: true, desc: 'Convert replied audio/video into a WhatsApp voice note.' }, async ctx => {
    const m = await ctx.needMedia(['audio', 'video']);
    const ogg = await U.ff(m.buffer, { inExt: 'bin', outExt: 'ogg', args: ['-vn', '-t', '600', '-c:a', 'libopus', '-b:a', '48k', '-ac', '1'] });
    await ctx.audio(ogg, true);
  });

  def('reboot', { cat: 'misc', owner: true, core: true, desc: 'Restart the whole bot service (server operator only; START.bat brings it back).' }, async ctx => {
    require('../lib/host').requireHost(ctx); // restarting affects every paired number, so group admins and ordinary session owners cannot do it
    await ctx.reply('♻️ Restarting… START.bat will bring the bot back shortly.');
    await ctx.store.flushAll().catch(() => {});
    setTimeout(() => process.exit(0), 1500);
  });

  /* ---------- AFK ---------- */
  def('afk', { cat: 'misc', owner: true, usage: 'afk <reason> • afk off', desc: 'Set an away message that auto-replies when people mention or message you.' }, async ctx => {
    if (/^(off|stop|back)$/i.test(ctx.args)) { ctx.del('afk'); return ctx.reply('👋 Welcome back! AFK is off.'); }
    ctx.set('afk', { since: Date.now(), reason: ctx.args || 'Away' });
    await ctx.reply(`😴 AFK is on: ${ctx.args || 'Away'}\nI will let people know. I switch it off when you send a message.`);
  });
  hooks.push({
    name: 'afk', run: async ctx => {
      const afk = ctx.get('afk', null);
      if (!afk || ctx.chat === 'status@broadcast') return false;
      if (ctx.fromMe) {
        if (ctx.text && !ctx.text.startsWith(ctx.prefix || '.') && Date.now() - afk.since > 30000 && !ctx.rt.sent.has(ctx.key.id)) { ctx.del('afk'); await ctx.send({ text: '👋 AFK off — welcome back!' }); }
        return false;
      }
      const mentionsOwner = ctx.mentioned.some(j => ctx.botIds().includes(ctx.jidUser(j)));
      if (!(ctx.isGroup ? mentionsOwner : true) || !ctx.fresh) return false;
      const k = ctx.chat + ctx.senderNum;
      if (Date.now() - (ctx.rt.afkSeen.get(k) || 0) < 10 * 60000) return false;
      ctx.rt.afkSeen.set(k, Date.now());
      await ctx.send({ text: ctx.frame(`😴 ${bold('Owner is AFK')}\n📝 ${afk.reason}\n⏱ Since ${U.fmtDur((Date.now() - afk.since) / 1000)} ago`) }, { quoted: ctx.msg });
      return false;
    }
  });

  /* ---------- mention auto-reply ---------- */
  def('mention', { cat: 'misc', owner: true, usage: 'mention <text> • mention off', desc: 'Auto-reply with a message when someone @mentions you in a group.' }, async ctx => {
    if (!ctx.args) { const t = ctx.get('mention', null); return ctx.reply(t ? `📌 Current mention reply:\n${t}` : `No mention reply set. Use *${ctx.var('PREFIX')}mention <text>*`); }
    if (/^(off|stop|delete)$/i.test(ctx.args)) { ctx.del('mention'); return ctx.reply('✅ Mention reply removed.'); }
    ctx.set('mention', ctx.args);
    await ctx.reply('✅ Mention reply saved.');
  });
  hooks.push({
    name: 'mention', run: async ctx => {
      if (ctx.fromMe || !ctx.isGroup || !ctx.fresh || !ctx.mentioned.length) return false;
      const t = ctx.get('mention', null);
      if (!t || !ctx.mentioned.some(j => ctx.botIds().includes(ctx.jidUser(j)))) return false;
      if (!ctx.cooldown(30, 'mention')) return false;
      await ctx.send({ text: t }, { quoted: ctx.msg });
      return false;
    }
  });

  /* ---------- lydia: AI chatbot ---------- */
  def('lydia', { cat: 'misc', owner: true, usage: 'lydia on|off', desc: 'Turn the AI chatbot on or off in this chat (in groups it answers when replied to or mentioned).' }, async ctx => {
    const on = ctx.get('lydia', {});
    const a = ctx.argv[0]?.toLowerCase();
    if (a === 'on') on[ctx.chat] = true; else if (a === 'off') delete on[ctx.chat];
    else return ctx.reply(`Lydia is *${on[ctx.chat] ? 'ON' : 'OFF'}* here. Use *${ctx.var('PREFIX')}lydia on* or *off*.`);
    ctx.set('lydia', on);
    await ctx.reply(on[ctx.chat] ? '🤖 Lydia is on — I will chat with people here.' : '🤖 Lydia is off.');
  });
  hooks.push({
    name: 'lydia', run: async ctx => {
      if (ctx.fromMe || !ctx.fresh || !ctx.text || ctx.text.startsWith(ctx.prefix || '.') || !ctx.get('lydia', {})[ctx.chat]) return false;
      if (ctx.isGroup) {
        const addressed = ctx.mentioned.some(j => ctx.botIds().includes(ctx.jidUser(j))) || (ctx.quoted && ctx.botIds().includes(ctx.jidUser(ctx.quoted.sender)));
        if (!addressed) return false;
      }
      if (!ctx.cooldown(3, 'lydia')) return false;
      const { ask } = require('./ai');
      const r = await ask('gpt', `You are Lydia, a friendly, concise WhatsApp assistant. Reply briefly in the user's language.\nUser: ${ctx.text}`);
      await ctx.send({ text: r.text }, { quoted: ctx.msg });
      return false;
    }
  });

  /* ---------- sticker commands ---------- */
  const shaOf = m => {
    const s = m?.stickerMessage?.fileSha256;
    return s ? Buffer.from(s).toString('hex') : null;
  };
  def('setcmd', { cat: 'misc', owner: true, usage: 'setcmd <command> (reply to a sticker)', desc: 'Make a sticker trigger a command when sent.' }, async ctx => {
    const sha = shaOf(ctx.quoted?.message);
    if (!sha) throw new UserError('Reply to a sticker with *setcmd <command>*, e.g. *setcmd menu*');
    if (!ctx.args) throw new UserError('Which command should this sticker run?');
    const map = ctx.get('stickercmds', {});
    map[sha] = ctx.args.replace(/^[^a-zA-Z0-9]+/, '');
    ctx.set('stickercmds', map);
    await ctx.reply(`✅ That sticker now runs *${map[sha]}*.`);
  });
  def('delcmd', { cat: 'misc', owner: true, usage: 'delcmd (reply to the sticker) • delcmd <command>', desc: 'Remove a sticker command.' }, async ctx => {
    const map = ctx.get('stickercmds', {});
    const sha = shaOf(ctx.quoted?.message);
    let removed = 0;
    if (sha && map[sha]) { delete map[sha]; removed++; }
    else if (ctx.args) for (const [k, v] of Object.entries(map)) if (v.toLowerCase().split(' ')[0] === ctx.args.toLowerCase()) { delete map[k]; removed++; }
    if (!removed) throw new UserError('Reply to a sticker that has a command, or give the command name.');
    ctx.set('stickercmds', map);
    await ctx.reply(`🗑️ Removed ${removed} sticker command(s).`);
  });
  def('getcmd', { cat: 'misc', owner: true, desc: 'List the stickers that run commands.' }, async ctx => {
    const map = Object.values(ctx.get('stickercmds', {}));
    await ctx.reply(map.length ? map.map((c, i) => `${i + 1}. ${c}`).join('\n') : 'No sticker commands set.', { title: 'Sticker commands' });
  });
  hooks.push({
    name: 'stickercmd', run: async ctx => {
      if (!ctx.fresh || ctx.type !== 'stickerMessage') return false;
      const cmdText = ctx.get('stickercmds', {})[shaOf(ctx.content)];
      if (!cmdText || (!ctx.isOwner && ctx.var('MODE') === 'private')) return false;
      const { registry } = require('./index');
      const [name, ...rest] = cmdText.split(/\s+/);
      const d = registry.get(name.toLowerCase());
      if (!d) return false;
      ctx.cmd = name.toLowerCase(); ctx.args = rest.join(' '); ctx.argv = rest;
      const owner = d.owner && !ctx.isOwner;
      if (owner) return true;
      try { await d.run(ctx); } catch (e) { await ctx.reply('⚠️ ' + (e instanceof UserError ? e.message : 'Command failed.')); }
      return true;
    }
  });
};
