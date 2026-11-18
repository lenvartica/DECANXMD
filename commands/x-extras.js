'use strict';
/**
 * Smaller extras that round out the command list:
 *  barcode (Code 128), collage, oilpaint / paint, heart / blink / unreact, emojiweather, alarmdelete,
 *  gifsearch (Tenor/Giphy key), shazam (AudD key), soundcloud / twitchclip / snapchat (via yt-dlp),
 *  subtitles / srt / vtt / subtitletranslate (YouTube captions), bpm, sudoku
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const U = require('../lib/util');
const { UserError, escXml } = U;

/* ---------------------------------------- Code 128-B ---------------------------------------- */
const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
function code128(text) {
  const vals = [104]; let sum = 104;
  [...text].forEach((ch, i) => { const v = ch.charCodeAt(0) - 32; if (v < 0 || v > 94) throw new UserError('Barcodes support plain letters, digits and common symbols (no emoji or accents).'); vals.push(v); sum += v * (i + 1); });
  vals.push(sum % 103, 106);
  const modules = vals.map(v => C128[v]).join('');
  return { modules, bars: [...modules].map(Number) };
}
async function barcodePng(text) {
  const { bars } = code128(text); const mw = 3, quiet = 10 * mw, h = 140; let x = quiet, rects = '';
  bars.forEach((w, i) => { if (i % 2 === 0) rects += `<rect x="${x}" y="20" width="${w * mw}" height="${h}" fill="#000"/>`; x += w * mw; });
  const W = x + quiet; const H = h + 70;
  return U.sharp()(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>${rects}<text x="${W / 2}" y="${h + 52}" font-family="monospace" font-size="26" text-anchor="middle" fill="#000">${escXml(text)}</text></svg>`)).png().toBuffer();
}

/* ------------------------------------------ sudoku ------------------------------------------ */
function solveCount(g, limit = 2) {
  let count = 0;
  (function rec() {
    if (count >= limit) return;
    let best = -1, bestOpts = null;
    for (let i = 0; i < 81; i++) if (!g[i]) { const o = options(g, i); if (!o.length) return; if (!bestOpts || o.length < bestOpts.length) { best = i; bestOpts = o; if (o.length === 1) break; } }
    if (best < 0) { count++; return; }
    for (const d of bestOpts) { g[best] = d; rec(); if (count >= limit) { g[best] = 0; return; } }
    g[best] = 0;
  })();
  return count;
}
function options(g, i) { const r = Math.floor(i / 9), c = i % 9, used = new Set(); for (let k = 0; k < 9; k++) { used.add(g[r * 9 + k]); used.add(g[k * 9 + c]); } const br = r - r % 3, bc = c - c % 3; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) used.add(g[(br + a) * 9 + bc + b]); return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => !used.has(d)); }
function fullGrid() {
  const g = new Array(81).fill(0);
  (function rec() { let best = -1, bo = null; for (let i = 0; i < 81; i++) if (!g[i]) { const o = options(g, i); if (!o.length) return false; if (!bo || o.length < bo.length) { best = i; bo = o; } } if (best < 0) return true; for (const d of bo.sort(() => crypto.randomInt(3) - 1)) { g[best] = d; if (rec()) return true; } g[best] = 0; return false; })();
  return g;
}
function makeSudoku(blanks) {
  const sol = fullGrid(), puz = [...sol]; const order = [...Array(81).keys()].sort(() => crypto.randomInt(3) - 1); let removed = 0;
  for (const i of order) { if (removed >= blanks) break; const keep = puz[i]; puz[i] = 0; if (solveCount([...puz]) === 1) removed++; else puz[i] = keep; }
  return { puz, sol, removed };
}
const sudokuText = g => { const rows = []; for (let r = 0; r < 9; r++) { let line = ''; for (let c = 0; c < 9; c++) line += (c && c % 3 === 0 ? '│ ' : '') + (g[r * 9 + c] || '·') + ' '; rows.push(line.trimEnd()); if (r % 3 === 2 && r < 8) rows.push('──────┼───────┼──────'); } return rows.join('\n'); };

/* ------------------------------------------- tempo ------------------------------------------- */
function estimateBpm(pcm, rate = 11025) {
  const n = Math.floor(pcm.length / 2); if (n < rate * 4) throw new UserError('I need at least 4 seconds of audio to measure the tempo.');
  const hop = 128, win = 512, frames = Math.floor((n - win) / hop), env = new Float64Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0; for (let i = 0; i < win; i++) { const v = pcm.readInt16LE((f * hop + i) * 2) / 32768; s += v * v; } env[f] = Math.sqrt(s / win); }
  const on = new Float64Array(frames); for (let f = 1; f < frames; f++) on[f] = Math.max(0, env[f] - env[f - 1]);
  const mean = on.reduce((a, b) => a + b, 0) / frames; for (let f = 0; f < frames; f++) on[f] -= mean;
  const fps = rate / hop; let bestBpm = 0, best = -Infinity;
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const lag = (60 / bpm) * fps; let s = 0, cnt = 0;
    for (let k = 1; k <= 4; k++) { const L = lag * k, i0 = Math.floor(L), fr = L - i0; for (let f = 0; f + i0 + 1 < frames; f++) { s += on[f] * (on[f + i0] * (1 - fr) + on[f + i0 + 1] * fr); cnt++; } }
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.8) ** 2); const score = (s / Math.max(1, cnt)) * (0.6 + 0.4 * prior);
    if (score > best) { best = score; bestBpm = bpm; }
  }
  return bestBpm;
}

module.exports = ({ def: rawDef, alias: rawAlias, registry }) => {
  const def = (names, opts, run) => { const n = [].concat(names).filter(x => !registry.has(x.toLowerCase())); if (n.length) rawDef(n, opts, run); };
  const alias = (existing, ...names) => { if (!registry.has(existing)) return; const f = names.filter(x => !registry.has(x.toLowerCase())); if (f.length) rawAlias(existing, ...f); };
  const P = ctx => ctx.var('PREFIX');
  const delegate = (ctx, target, args) => { const d = registry.get(target); if (!d) throw new UserError(`The ${target} command is not available.`); return d.run(Object.assign(Object.create(ctx), { cmd: target, args, argv: args.split(/\s+/).filter(Boolean), input: () => args })); };
  const sharp = () => U.sharp();

  def('alarmdelete', { cat: 'tools', owner: true, usage: 'alarmdelete <number>', desc: 'Delete one of your reminders (see .reminder list).' }, ctx => delegate(ctx, 'reminder', `del ${ctx.input()}`));
  alias('weather', 'emojiweather');

  /* ---------------------------------------- barcode ---------------------------------------- */
  def('barcode', { cat: 'tools', usage: 'barcode <text or number>', desc: 'Make a Code 128 barcode image (up to 40 characters).' }, async ctx => {
    const t = ctx.input().trim(); if (!t) throw new UserError(`Usage: *${P(ctx)}barcode 6001234567890*`); if (t.length > 40) throw new UserError('Barcodes can hold up to 40 characters here.');
    await ctx.image(await barcodePng(t), `📊 ${t}`);
  });

  /* ---------------------------------------- collage ---------------------------------------- */
  def('collage', { cat: 'editor', heavy: true, usage: 'collage add (reply to a photo) • collage [columns] • collage clear', desc: 'Build a photo grid: reply to each photo with "collage add" (up to 9), then send "collage".' }, async ctx => {
    ctx.rt.collage = ctx.rt.collage || new Map(); const k = ctx.chat + ctx.senderNum; const q = ctx.rt.collage.get(k) || []; const a = (ctx.argv[0] || '').toLowerCase();
    if (a === 'clear') { ctx.rt.collage.delete(k); return ctx.reply('🧹 Collage cleared.'); }
    if (a === 'add') { const m = await ctx.needMedia(['image'], 'Reply to a photo with *collage add*.'); if (q.length >= 9) throw new UserError('A collage holds up to 9 photos.'); q.push(await sharp()(m.buffer).rotate().resize(600, 600, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer()); ctx.rt.collage.set(k, q); return ctx.reply(`➕ Photo ${q.length} added. Add more, or send *${P(ctx)}collage* to build it.`); }
    if (q.length < 2) throw new UserError(`Add at least 2 photos first: reply to each with *${P(ctx)}collage add*`);
    const cols = Math.min(q.length, Math.max(1, Math.floor(Number(a)) || Math.ceil(Math.sqrt(q.length)))); const rows = Math.ceil(q.length / cols), gap = 8, S = 600;
    const out = await sharp()({ create: { width: cols * S + (cols + 1) * gap, height: rows * S + (rows + 1) * gap, channels: 3, background: '#ffffff' } }).composite(q.map((b, i) => ({ input: b, left: gap + (i % cols) * (S + gap), top: gap + Math.floor(i / cols) * (S + gap) }))).jpeg({ quality: 88 }).toBuffer();
    ctx.rt.collage.delete(k); await ctx.image(out, `🖼️ Collage of ${q.length} photos`);
  });

  /* ------------------------------------- painting filters ------------------------------------- */
  const paint = (name, desc, fn) => def(name, { cat: 'editor', heavy: true, desc: `${desc} Reply to an image.` }, async ctx => {
    const m = await ctx.needMedia(['image'], 'Reply to an image with this command.'); const base = await sharp()(m.buffer).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).toBuffer();
    await ctx.image(await fn(sharp()(base)).png().toBuffer(), '🎨');
  });
  paint('oilpaint', 'Oil-painting look (median smoothing + rich colour).', i => i.median(9).modulate({ saturation: 1.35, brightness: 1.03 }).sharpen({ sigma: 1.2 }));
  paint('paint', 'Soft painted look.', i => i.blur(1.2).median(5).modulate({ saturation: 1.5, brightness: 1.06 }).gamma(1.1));

  /* ---------------------------------------- reactions ---------------------------------------- */
  const reactWith = (name, emoji, desc) => def(name, { cat: 'sticker', usage: `${name} (reply to a message)`, desc }, async ctx => { await ctx.sock.sendMessage(ctx.chat, { react: { text: emoji, key: ctx.quoted?.key || ctx.key } }); });
  reactWith('heart', '❤️', 'React with a heart to the replied message.'); reactWith('blink', '👀', 'React with eyes 👀 to the replied message.');
  def('unreact', { cat: 'sticker', usage: 'unreact (reply to a message)', desc: 'Remove the bot\'s reaction from the replied message.' }, async ctx => { await ctx.sock.sendMessage(ctx.chat, { react: { text: '', key: ctx.quoted?.key || ctx.key } }); });

  /* ---------------------------------------- GIF search ---------------------------------------- */
  def('gifsearch', { cat: 'sticker', heavy: true, usage: 'gifsearch <words>', desc: 'Find a GIF (needs TENOR_API_KEY or GIPHY_API_KEY on the server).' }, async ctx => {
    const q = ctx.input().trim(); if (!q) throw new UserError(`Usage: *${P(ctx)}gifsearch dancing cat*`); let url;
    if (process.env.TENOR_API_KEY) { const j = await U.getJson(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${process.env.TENOR_API_KEY}&limit=8&media_filter=mp4&contentfilter=medium`, { timeout: 15000 }); const r = j.results || []; url = r[crypto.randomInt(Math.max(1, r.length))]?.media_formats?.mp4?.url; }
    else if (process.env.GIPHY_API_KEY) { const j = await U.getJson(`https://api.giphy.com/v1/gifs/search?api_key=${process.env.GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=8&rating=pg-13`, { timeout: 15000 }); const r = j.data || []; url = r[crypto.randomInt(Math.max(1, r.length))]?.images?.original_mp4?.mp4; }
    else throw new UserError('GIF search needs a free TENOR_API_KEY (Google Cloud) or GIPHY_API_KEY on the server.');
    if (!url) throw new UserError('No GIF found for that.'); await ctx.video((await U.download(url)).buffer, `🎞️ ${q}`, { gifPlayback: true });
  });

  /* ------------------------------------- song recognition ------------------------------------- */
  def('shazam', { cat: 'audio', heavy: true, usage: 'shazam (reply to a voice note, audio or video)', desc: 'Recognise a song from a short clip (needs a free AUDD_API_TOKEN on the server).' }, async ctx => {
    if (!process.env.AUDD_API_TOKEN) throw new UserError('Song recognition needs an AUDD_API_TOKEN (free tier at audd.io) set on the server.');
    const m = await ctx.needMedia(['audio', 'video'], 'Reply to a voice note, audio or video of the song.');
    const clip = await U.ff(m.buffer, { inExt: 'bin', outExt: 'mp3', args: ['-vn', '-t', '20', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k'] });
    const form = new FormData(); form.append('api_token', process.env.AUDD_API_TOKEN); form.append('return', 'apple_music,spotify'); form.append('file', new Blob([clip], { type: 'audio/mpeg' }), 'clip.mp3');
    const j = await U.http('https://api.audd.io/', { method: 'POST', body: form, as: 'json', timeout: 60000 }).catch(() => { throw new UserError('The recognition service did not answer. Try again in a moment.'); });
    const r = j.result; if (!r) throw new UserError('I could not recognise that song. Try a clearer or longer clip with less background noise.');
    await ctx.reply(`🎶 *${r.title}*\n👤 ${r.artist}\n💿 ${r.album || '—'}${r.release_date ? ' • ' + r.release_date.slice(0, 4) : ''}\n${r.song_link ? '🔗 ' + r.song_link : ''}\n\n▶️ Get it with *${P(ctx)}play ${r.artist} ${r.title}*`, { title: 'Song found' });
  });

  /* ------------------------------ more sites through yt-dlp (allow-listed) ------------------------------ */
  const SITE = { soundcloud: /(^|\.)soundcloud\.com$|^on\.soundcloud\.com$/, twitch: /(^|\.)twitch\.tv$|^clips\.twitch\.tv$/, snapchat: /(^|\.)snapchat\.com$/ };
  const ytSite = (names, site, kind, label) => def(names, { cat: 'download', heavy: true, usage: `${[].concat(names)[0]} <${label} link>`, desc: `Download ${kind === 'audio' ? 'the audio of' : ''} a ${label} link.` }, async ctx => {
    const link = U.findUrl(ctx.input()); if (!link) throw new UserError(`Usage: *${P(ctx)}${[].concat(names)[0]} <${label} link>*`);
    let host; try { host = new URL(link).hostname.toLowerCase(); } catch { throw new UserError('That link is not valid.'); } if (!SITE[site].test(host)) throw new UserError(`That is not a ${label} link.`);
    if (!ctx.cooldown(5, 'ytsite')) throw new UserError('Please wait a few seconds between downloads.');
    const r = await U.ytDownload(link, kind); if (kind === 'audio') await ctx.audio(r.buffer, false, U.audioMime(r.ext)); else await ctx.video(r.buffer, `🎬 ${r.title}`.slice(0, 200));
  });
  ytSite('soundcloud', 'soundcloud', 'audio', 'SoundCloud'); ytSite(['twitchclip', 'twitch'], 'twitch', 'video', 'Twitch clip'); ytSite(['snapchat', 'snapdl', 'snapchatstory'], 'snapchat', 'video', 'Snapchat');

  /* ------------------------------------ YouTube subtitles ------------------------------------ */
  async function subs(ctx, fmt, needLang) {
    const parts = ctx.input().trim().split(/\s+/); const link = U.findUrl(ctx.input()); const lang = (parts.find(p => /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(p) && !p.includes('.')) || (needLang ? '' : 'en')).toLowerCase();
    if (!link || !/(youtube\.com|youtu\.be)/i.test(link)) throw new UserError(`Usage: *${P(ctx)}${ctx.cmd} <YouTube link>${needLang ? ' <language code, e.g. sw>' : ' [language code]'}*`);
    if (!lang) throw new UserError('Add a language code, e.g. *sw* (Swahili), *fr*, *es*, *ar*.');
    const dir = U.tmp(); fs.mkdirSync(dir, { recursive: true });
    try {
      await U.ytdlp(['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', lang, '--sub-format', 'vtt/best', '--convert-subs', fmt, '-o', path.join(dir, 's.%(ext)s'), link]);
      const f = fs.readdirSync(dir).find(x => x.endsWith('.' + fmt)); if (!f) throw new UserError(`No ${lang} subtitles are available for that video.`);
      await ctx.doc(fs.readFileSync(path.join(dir, f)), `subtitles-${lang}.${fmt}`, fmt === 'srt' ? 'application/x-subrip' : 'text/vtt');
    } finally { U.rm(dir); }
  }
  def(['subtitles', 'subtitle', 'srt'], { cat: 'video', heavy: true, usage: 'subtitles <YouTube link> [language]', desc: 'Download a YouTube video\'s captions as an .srt file (default English).' }, ctx => subs(ctx, 'srt', false));
  def('vtt', { cat: 'video', heavy: true, usage: 'vtt <YouTube link> [language]', desc: 'Download a YouTube video\'s captions as a .vtt file.' }, ctx => subs(ctx, 'vtt', false));
  def('subtitletranslate', { cat: 'video', heavy: true, usage: 'subtitletranslate <YouTube link> <language code>', desc: 'YouTube captions auto-translated into another language (.srt).' }, ctx => subs(ctx, 'srt', true));

  /* ------------------------------------------- tempo ------------------------------------------- */
  def('bpm', { cat: 'audio', heavy: true, desc: 'Estimate the tempo (beats per minute) of a song. Reply to audio/video.' }, async ctx => {
    const m = await ctx.needMedia(['audio', 'video'], 'Reply to a song or audio clip with this command.');
    const pcm = await U.ff(m.buffer, { inExt: 'bin', outExt: 'raw', args: ['-vn', '-t', '60', '-ac', '1', '-ar', '11025', '-f', 's16le'] }); const bpm = estimateBpm(pcm);
    await ctx.reply(`🥁 About *${Math.round(bpm)} BPM*${bpm < 90 ? `  (could also feel like ${Math.round(bpm * 2)})` : bpm > 150 ? `  (could also feel like ${Math.round(bpm / 2)})` : ''}\n_An estimate from the first minute; it works best on music with a steady beat._`, { title: 'Tempo' });
  });

  /* ------------------------------------------- sudoku ------------------------------------------- */
  def('sudoku', { cat: 'game', usage: 'sudoku [easy|medium|hard] • sudoku solution', desc: 'A sudoku puzzle with a single solution. Send "sudoku solution" to see the answer.' }, async ctx => {
    ctx.rt.sudoku = ctx.rt.sudoku || new Map(); const a = (ctx.argv[0] || '').toLowerCase();
    if (/^sol/.test(a)) { const s = ctx.rt.sudoku.get(ctx.chat); if (!s) throw new UserError(`There is no puzzle yet. Send *${P(ctx)}sudoku* first.`); return ctx.reply('```' + sudokuText(s.sol) + '```', { title: 'Sudoku solution' }); }
    const blanks = { easy: 36, medium: 44, hard: 52 }[a] || 40; const t = Date.now(); const { puz, sol, removed } = makeSudoku(blanks);
    ctx.rt.sudoku.set(ctx.chat, { sol, at: Date.now() }); if (ctx.rt.sudoku.size > 200) ctx.rt.sudoku.delete(ctx.rt.sudoku.keys().next().value);
    await ctx.reply('```' + sudokuText(puz) + '```\n' + `🧩 ${81 - removed} clues • one unique solution\nReveal it with *${P(ctx)}sudoku solution*` + (Date.now() - t > 4000 ? '' : ''), { title: 'Sudoku' });
  });
};

module.exports.helpers = { code128, makeSudoku, solveCount, estimateBpm, sudokuText };
