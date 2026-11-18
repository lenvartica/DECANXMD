'use strict';
/**
 * Files, stickers, music lookups and the universal downloader.
 *  zip, unzip, ziplist, filepreview, gzip, fileconvert, sendimage/sendvideo/sendaudio/senddocument
 *  stickerinfo, stickerresize, stickercrop, stickerrotate, stickerflip, stickercompress, webp
 *  musicsearch, album, artist (iTunes), songguess / artistguess / albumguess (+ musicquiz)
 *  player (ESPN), gdrive, download (picks the right downloader from the link)
 */
const zlib = require('zlib');
const path = require('path');
const U = require('../lib/util');
const { UserError, bold } = U;

/* ----------------------------------- tiny ZIP reader / writer ----------------------------------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function makeZip(files) {
  const locals = [], central = []; let offset = 0; const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), raw = f.data, def = zlib.deflateRawSync(raw), store = def.length >= raw.length, data = store ? raw : def, method = store ? 0 : 8, crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8); lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10); ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name); offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central), eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
function readZip(buf) {
  let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new UserError('That does not look like a ZIP file.');
  const count = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = [];
  for (let i = 0; i < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    out.push({ name: buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nl), flags, method, csize, usize, off }); p += 46 + nl + el + cl;
  }
  return out;
}
function extract(buf, ent, maxBytes) {
  if (ent.flags & 1) throw new UserError(`"${ent.name}" is password-protected, which I cannot open.`);
  if (ent.usize > maxBytes) throw new UserError(`"${ent.name}" is too large (${U.fmtBytes(ent.usize)}).`);
  const lo = ent.off, nl = buf.readUInt16LE(lo + 26), el = buf.readUInt16LE(lo + 28), start = lo + 30 + nl + el; const data = buf.subarray(start, start + ent.csize);
  if (ent.method === 0) return Buffer.from(data);
  if (ent.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: maxBytes });
  throw new UserError(`"${ent.name}" uses a compression method I do not support.`);
}
const safeName = n => path.basename(String(n).replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').slice(0, 100) || 'file';

const ITUNES = 'https://itunes.apple.com';
const SEEDS = ['pop hits', 'afrobeats', 'bongo flava', 'hip hop classics', 'rock anthems', 'r&b slow jams', 'dancehall', 'gospel worship', 'country road', 'reggae', 'latin hits', 'amapiano', '90s hits', '2000s pop', 'rap 2010s'];
const clean = s => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]|feat\.?.*$|ft\.?.*$|- .*$/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
function guessMatch(guess, answer) { const g = clean(guess), a = clean(answer); if (!g || !a) return false; if (g === a) return true; if (g.length >= 4 && (a.includes(g) || g.includes(a))) return g.length / a.length > 0.55 || a.includes(g) && g.split(' ').length >= Math.min(2, a.split(' ').length); const aw = a.split(' '), gw = new Set(g.split(' ')); return aw.length >= 2 && aw.filter(w => gw.has(w)).length / aw.length >= 0.75; }

module.exports = ({ def: rawDef, alias: rawAlias, registry, hooks }) => {
  const def = (names, opts, run) => { const n = [].concat(names).filter(x => !registry.has(x.toLowerCase())); if (n.length) rawDef(n, opts, run); };
  const alias = (existing, ...names) => { if (!registry.has(existing)) return; const f = names.filter(x => !registry.has(x.toLowerCase())); if (f.length) rawAlias(existing, ...f); };
  const P = ctx => ctx.var('PREFIX');
  const delegate = (ctx, target, args) => { const d = registry.get(target); if (!d) throw new UserError(`The ${target} command is not available.`); return d.run(Object.assign(Object.create(ctx), { cmd: target, args, argv: args.split(/\s+/).filter(Boolean), input: () => args })); };
  const fileMedia = async (ctx, hint = 'Reply to a file with this command.') => { const m = await ctx.media().catch(() => null); if (!m) throw new UserError(hint); return m; };
  const J = async (url, o = {}) => { try { return await U.getJson(url, { timeout: 15000, ...o }); } catch { throw new UserError('That service did not answer just now. Please try again in a moment.'); } };

  /* -------------------------------------------- zip -------------------------------------------- */
  def('zip', { cat: 'media', heavy: true, usage: 'zip [name] (reply to a file) • zip notes.txt some text', desc: 'Put a replied file into a ZIP, or turn typed text into a zipped .txt file.' }, async ctx => {
    const m = await ctx.media().catch(() => null); let files;
    if (m) files = [{ name: safeName(m.fileName || `file.${(m.mime || '').split('/')[1]?.split(';')[0] || 'bin'}`), data: m.buffer }];
    else { const t = ctx.input().trim(); if (!t) throw new UserError(`Reply to a file with *${P(ctx)}zip*, or send *${P(ctx)}zip notes.txt your text*`); const m2 = t.match(/^(\S+\.[A-Za-z0-9]{1,5})\s+([\s\S]+)$/); files = [{ name: safeName(m2 ? m2[1] : 'text.txt'), data: Buffer.from(m2 ? m2[2] : t, 'utf8') }]; }
    const zip = makeZip(files); await ctx.doc(zip, `${files[0].name.replace(/\.[^.]+$/, '') || 'archive'}.zip`, 'application/zip');
  });
  const zipOf = async ctx => { const m = await fileMedia(ctx, 'Reply to a ZIP file with this command.'); if (m.buffer.length > 60 * 1024 * 1024) throw new UserError('That ZIP is too large for me (max 60 MB).'); return { buf: m.buffer, ents: readZip(m.buffer) }; };
  def(['ziplist', 'filelist'], { cat: 'media', heavy: true, desc: 'List what is inside a ZIP. Reply to the ZIP.' }, async ctx => {
    const { ents } = await zipOf(ctx); const files = ents.filter(e => !e.name.endsWith('/'));
    await ctx.reply(`🗜️ ${files.length} file(s), ${U.fmtBytes(files.reduce((a, e) => a + e.usize, 0))} unpacked\n\n${files.slice(0, 60).map((e, i) => `${i + 1}. ${e.name} — ${U.fmtBytes(e.usize)}${e.flags & 1 ? ' 🔒' : ''}`).join('\n')}${files.length > 60 ? `\n… and ${files.length - 60} more` : ''}\n\nOpen one with *${P(ctx)}unzip <number>*`, { title: 'ZIP contents' });
  });
  def(['unzip', 'extract', 'fileextract'], { cat: 'media', heavy: true, usage: 'unzip [number | all]', desc: 'Open a ZIP: send one file from it (by number) or up to 8 files. Reply to the ZIP.' }, async ctx => {
    const { buf, ents } = await zipOf(ctx); const files = ents.filter(e => !e.name.endsWith('/')); if (!files.length) throw new UserError('That ZIP is empty.');
    const total = files.reduce((a, e) => a + e.usize, 0); if (total > 400 * 1024 * 1024) throw new UserError('That ZIP unpacks to too much data.');
    const a = (ctx.argv[0] || 'all').toLowerCase(); const pickN = /^\d+$/.test(a) ? [files[Number(a) - 1]].filter(Boolean) : files.slice(0, 8);
    if (!pickN.length) throw new UserError(`There is no file number ${a}. Use *${P(ctx)}ziplist* to see them.`);
    let sent = 0, budget = 40 * 1024 * 1024;
    for (const e of pickN) { if (e.usize > budget) { await ctx.reply(`⏭️ Skipped "${e.name}" (too big for the remaining limit).`); continue; } const data = extract(buf, e, 30 * 1024 * 1024); budget -= data.length; await ctx.doc(data, safeName(e.name), 'application/octet-stream'); sent++; }
    if (!/^\d+$/.test(a) && files.length > 8) await ctx.reply(`📦 Sent the first ${sent} of ${files.length} files. Use *${P(ctx)}unzip <number>* for the others.`);
  });
  def(['gzip', 'filecompress', 'compressfile'], { cat: 'media', heavy: true, desc: 'Compress a replied file to .gz.' }, async ctx => {
    const m = await fileMedia(ctx); const out = zlib.gzipSync(m.buffer, { level: 9 }); const name = safeName(m.fileName || 'file');
    await ctx.doc(out, `${name}.gz`, 'application/gzip'); await ctx.reply(`🗜️ ${U.fmtBytes(m.buffer.length)} → *${U.fmtBytes(out.length)}* (${Math.round((1 - out.length / m.buffer.length) * 100)}% smaller)`);
  });
  def(['filepreview', 'preview'], { cat: 'media', heavy: true, usage: 'filepreview [lines]', desc: 'Peek inside a replied text, code, CSV, JSON, PDF or ZIP file.' }, async ctx => {
    const m = await fileMedia(ctx); const n = Math.min(80, Math.max(5, Math.floor(Number(ctx.argv[0])) || 30)); const name = m.fileName || '';
    if (/pdf/i.test(m.mime || '') || /\.pdf$/i.test(name)) { const r = await require('pdf-parse')(m.buffer); return ctx.reply(`📄 ${r.numpages} page(s)\n\n${String(r.text).replace(/\s+\n/g, '\n').trim().slice(0, 1800) || '(no readable text)'}`, { title: 'PDF preview' }); }
    if (/zip/i.test(m.mime || '') || /\.zip$/i.test(name)) return delegate(ctx, 'ziplist', '');
    const sample = m.buffer.subarray(0, 200000); if (sample.includes(0)) throw new UserError('That looks like a binary file, so I cannot show it as text. Try *' + P(ctx) + 'filecheck* for its details.');
    const lines = sample.toString('utf8').split(/\r?\n/); await ctx.reply('```' + lines.slice(0, n).join('\n').slice(0, 3000) + '```' + (lines.length > n ? `\n_…${lines.length - n}+ more lines_` : ''), { title: name || 'Preview' });
  });
  def('fileconvert', { cat: 'media', heavy: true, usage: 'fileconvert <format> (reply to image / audio / video)', desc: 'Convert a replied image, audio or video to another format.' }, async ctx => {
    const m = await fileMedia(ctx); const fmt = (ctx.argv[0] || '').toLowerCase(); if (!fmt) throw new UserError(`Usage: *${P(ctx)}fileconvert <format>* — image: png jpg webp • audio: mp3 wav flac ogg m4a • video: mp4 webm gif mkv`);
    const kind = m.kind || (m.mime || '').split('/')[0]; const target = { image: 'imageconvert', sticker: 'imageconvert', audio: 'audioconvert', video: 'videoconvert' }[kind];
    if (!target) throw new UserError('I can convert images, audio and video.');
    await delegate(ctx, target, fmt);
  });

  /* -------------------------------------- send as another type -------------------------------------- */
  def(['senddocument', 'sendfile', 'sharefile', 'transferfile', 'filetransfer'], { cat: 'media', heavy: true, usage: 'senddocument (reply to media)', desc: 'Re-send a replied photo/video/audio as a document, keeping full quality.' }, async ctx => {
    const m = await fileMedia(ctx); const ext = (m.mime || 'application/octet-stream').split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg') || 'bin'; await ctx.doc(m.buffer, safeName(m.fileName || `file.${ext}`), m.mime || 'application/octet-stream');
  });
  def('sendimage', { cat: 'media', heavy: true, desc: 'Send a replied image document or sticker as a normal photo.' }, async ctx => { const m = await ctx.needMedia(['image', 'sticker', 'document'], 'Reply to an image file or sticker.'); const png = await U.sharp()(m.buffer).rotate().png().toBuffer().catch(() => { throw new UserError('That file is not an image I can read.'); }); await ctx.image(png, ''); });
  def('sendvideo', { cat: 'media', heavy: true, desc: 'Send a replied video file/GIF as a normal playable video.' }, async ctx => { const m = await ctx.needMedia(['video', 'document'], 'Reply to a video file.'); await ctx.video(await U.ff(m.buffer, { inExt: 'mp4', outExt: 'mp4', args: ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-t', '180'] })); });
  def('sendaudio', { cat: 'media', heavy: true, desc: 'Send a replied audio/video file as a playable audio message.' }, async ctx => { const m = await ctx.needMedia(['audio', 'video', 'document'], 'Reply to an audio or video file.'); await ctx.audio(await U.ff(m.buffer, { inExt: 'bin', outExt: 'mp3', args: ['-vn', '-t', '600', '-c:a', 'libmp3lame', '-b:a', '128k'] }), false); });

  /* ------------------------------------------ stickers ------------------------------------------ */
  const stk = async ctx => {
    const m = await ctx.needMedia(['sticker'], 'Reply to a sticker with this command.');
    const meta = await U.sharp()(m.buffer, { animated: true }).metadata(); if ((meta.pages || 1) > 1) throw new UserError('That is an animated sticker. This command works on still stickers only.');
    const ex = await U.readExif(m.buffer).catch(() => null);
    return { buf: m.buffer, meta, pack: ex?.['sticker-pack-name'] || ctx.var('STICKER_PACK') || 'DECANXMD', author: ex?.['sticker-pack-publisher'] || ctx.var('STICKER_AUTHOR') || '' };
  };
  const reSticker = async (ctx, s, img) => ctx.sticker(await U.withExif(await img.webp({ quality: 85 }).toBuffer(), s.pack, s.author));
  def('stickerinfo', { cat: 'sticker', heavy: true, desc: 'Details of a sticker: size, animated or not, pack and author. Reply to a sticker.' }, async ctx => {
    const m = await ctx.needMedia(['sticker'], 'Reply to a sticker.'); const meta = await U.sharp()(m.buffer, { animated: true }).metadata(); const ex = await U.readExif(m.buffer).catch(() => null);
    await ctx.reply(`🏷️ Pack: *${ex?.['sticker-pack-name'] || '—'}*\n✍️ Author: *${ex?.['sticker-pack-publisher'] || '—'}*\n📐 ${meta.width} × ${(meta.pageHeight || meta.height)} px • ${meta.pages > 1 ? `🎞️ animated (${meta.pages} frames)` : 'still'}\n💾 ${U.fmtBytes(m.buffer.length)}`, { title: 'Sticker info' });
  });
  def('stickerresize', { cat: 'sticker', heavy: true, usage: 'stickerresize <size 64-512>', desc: 'Shrink a still sticker\'s content inside the 512 canvas (smaller artwork). Reply to a sticker.' }, async ctx => {
    const s = await stk(ctx); const size = Math.min(512, Math.max(64, Math.floor(Number(ctx.argv[0])) || 320)); const inner = await U.sharp()(s.buf).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    await reSticker(ctx, s, U.sharp()({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: inner, gravity: 'center' }]));
  });
  def('stickercrop', { cat: 'sticker', heavy: true, desc: 'Crop a still sticker to fill the square (no transparent borders). Reply to a sticker.' }, async ctx => { const s = await stk(ctx); const trimmed = await U.sharp()(s.buf).trim().png().toBuffer().catch(() => s.buf); await reSticker(ctx, s, U.sharp()(trimmed).resize(512, 512, { fit: 'cover' })); });
  def('stickerrotate', { cat: 'sticker', heavy: true, usage: 'stickerrotate [degrees, default 90]', desc: 'Rotate a still sticker. Reply to a sticker.' }, async ctx => { const s = await stk(ctx); const deg = Number(ctx.argv[0]); await reSticker(ctx, s, U.sharp()(await U.sharp()(s.buf).rotate(Number.isFinite(deg) ? deg : 90, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })); });
  def('stickerflip', { cat: 'sticker', heavy: true, usage: 'stickerflip [h|v]', desc: 'Mirror a still sticker (h = left-right, default; v = upside-down). Reply to a sticker.' }, async ctx => { const s = await stk(ctx); const i = U.sharp()(s.buf); await reSticker(ctx, s, /^v/i.test(ctx.argv[0] || '') ? i.flip() : i.flop()); });
  def('stickercompress', { cat: 'sticker', heavy: true, desc: 'Make a still sticker\'s file smaller. Reply to a sticker.' }, async ctx => { const s = await stk(ctx); const out = await U.withExif(await U.sharp()(s.buf).webp({ quality: 45, effort: 6 }).toBuffer(), s.pack, s.author); await ctx.sticker(out); await ctx.reply(`📦 ${U.fmtBytes(s.buf.length)} → *${U.fmtBytes(out.length)}*`); });
  def('webp', { cat: 'sticker', heavy: true, desc: 'Convert a replied image to a .webp file.' }, ctx => delegate(ctx, 'imageconvert', 'webp'));

  /* -------------------------------------------- music -------------------------------------------- */
  const songs = async (q, n = 6) => (await J(`${ITUNES}/search?media=music&entity=song&limit=${n}&term=${encodeURIComponent(q)}`)).results || [];
  const mins = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')}`;
  def(['musicsearch', 'songsearch'], { cat: 'audio', heavy: true, usage: 'musicsearch <song or artist>', desc: 'Search songs on Apple Music / iTunes (title, artist, album, link). Get the audio with .play.' }, async ctx => {
    const q = ctx.input().trim(); if (!q) throw new UserError(`Usage: *${P(ctx)}musicsearch ed sheeran perfect*`); const r = await songs(q);
    await ctx.reply(r.length ? r.map((t, i) => `${i + 1}. 🎵 *${t.trackName}*\n   👤 ${t.artistName} • 💿 ${t.collectionName || '—'} • ⏱️ ${mins(t.trackTimeMillis || 0)} • ${String(t.releaseDate).slice(0, 4)}\n   ${t.trackViewUrl}`).join('\n\n') + `\n\n▶️ Download: *${P(ctx)}play <song name>*` : 'No songs found.', { title: 'Music' });
  });
  def('album', { cat: 'audio', heavy: true, usage: 'album <album name>', desc: 'Album details and track list.' }, async ctx => {
    const q = ctx.input().trim(); if (!q) throw new UserError(`Usage: *${P(ctx)}album 25 adele*`); const a = (await J(`${ITUNES}/search?media=music&entity=album&limit=1&term=${encodeURIComponent(q)}`)).results?.[0]; if (!a) throw new UserError('No album found.');
    const tr = (await J(`${ITUNES}/lookup?id=${a.collectionId}&entity=song`)).results?.filter(x => x.wrapperType === 'track') || [];
    await ctx.reply(`💿 *${a.collectionName}*\n👤 ${a.artistName} • ${a.primaryGenreName} • ${String(a.releaseDate).slice(0, 4)}\n🎵 ${a.trackCount} tracks\n\n${tr.slice(0, 20).map(t => `${t.trackNumber}. ${t.trackName}`).join('\n')}${tr.length > 20 ? '\n…' : ''}\n\n${a.collectionViewUrl}`, { title: 'Album' });
  });
  def('artist', { cat: 'audio', heavy: true, usage: 'artist <name>', desc: 'Artist details and top albums.' }, async ctx => {
    const q = ctx.input().trim(); if (!q) throw new UserError(`Usage: *${P(ctx)}artist burna boy*`); const a = (await J(`${ITUNES}/search?media=music&entity=musicArtist&limit=1&term=${encodeURIComponent(q)}`)).results?.[0]; if (!a) throw new UserError('No artist found.');
    const al = (await J(`${ITUNES}/lookup?id=${a.artistId}&entity=album&limit=8`)).results?.filter(x => x.wrapperType === 'collection') || [];
    await ctx.reply(`🎤 *${a.artistName}*\n🎼 ${a.primaryGenreName || '—'}\n\n💿 *Albums*\n${al.map(x => `• ${x.collectionName} (${String(x.releaseDate).slice(0, 4)})`).join('\n') || '—'}\n\n${a.artistLinkUrl}`, { title: 'Artist' });
  });

  /* music quizzes: a 30-second preview is sent and the first correct guess wins */
  const quiz = (name, kind, extra = []) => def([name, ...extra], { cat: 'game', heavy: true, usage: `${name} [genre or artist]`, desc: `Hear a 30-second clip and guess the ${kind}. First correct answer wins coins.` }, async ctx => {
    if (ctx.rt.games.has(ctx.chat)) throw new UserError('A game is already running in this chat. Finish it first.');
    const term = ctx.input().trim() || SEEDS[Math.floor(Math.random() * SEEDS.length)]; const list = (await songs(term, 40)).filter(t => t.previewUrl && t.trackName && t.artistName);
    if (!list.length) throw new UserError('I could not find songs for that. Try another genre or artist.');
    const t = list[Math.floor(Math.random() * list.length)]; const answer = kind === 'song' ? t.trackName : kind === 'artist' ? t.artistName : (t.collectionName || t.trackName);
    const clip = (await U.download(t.previewUrl)).buffer; ctx.rt.games.set(ctx.chat, { type: 'x-song', kind, answer, ans: answer, deadline: Date.now() + 60000 });
    await ctx.audio(await U.ff(clip, { inExt: 'm4a', outExt: 'mp3', args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '96k'] }), false);
    await ctx.reply(`🎧 Guess the *${kind}*! Type your answer (60 seconds).${kind !== 'artist' ? `\n💡 Hint: it starts with “${answer[0].toUpperCase()}”` : ''}`, { title: 'Music quiz' });
  });
  quiz('songguess', 'song', ['musicquiz']); quiz('artistguess', 'artist'); quiz('albumguess', 'album');
  hooks.push({
    name: 'x-songquiz', run: async ctx => {
      const g = ctx.rt.games.get(ctx.chat); if (!g || g.type !== 'x-song' || !ctx.fresh || !ctx.text || ctx.text.startsWith(ctx.prefix || '.')) return false;
      if (!guessMatch(ctx.text, g.answer)) return false;
      ctx.rt.games.delete(ctx.chat);
      let name = ctx.name || 'Player'; ctx.update(`decanxmd_player_${ctx.senderNum}`, { name, level: 1, xp: 0, coins: 100, wins: 0, losses: 0, lastDaily: 0, lastHunt: 0, inventory: ['Starter Dagger'] }, p => { p.coins = (p.coins || 0) + 30; p.wins = (p.wins || 0) + 1; p.xp = (p.xp || 0) + 10; name = p.name || name; });
      await ctx.reply(`✅ Correct, *${name}*! It was *${g.answer}*. +30 coins`, { title: 'Winner' }); return true;
    }
  });

  /* --------------------------------------------- search --------------------------------------------- */
  def('player', { cat: 'sports', heavy: true, usage: 'player <name>', desc: 'Find an athlete (ESPN): sport, team and a profile link.' }, async ctx => {
    const q = ctx.input().trim(); if (!q) throw new UserError(`Usage: *${P(ctx)}player lionel messi*`);
    const j = await J(`https://site.web.api.espn.com/apis/common/v3/search?limit=6&type=player&query=${encodeURIComponent(q)}`); const items = (j.items || j.results?.flatMap(x => x.contents || []) || []).slice(0, 6);
    if (!items.length) { const r = await require('../lib/websearch').ddg(`${q} athlete profile site:espn.com`, 4).catch(() => []); if (!r.length) throw new UserError('No player found.'); return ctx.reply(r.map(x => `🏅 *${x.title}*\n   ${x.link}`).join('\n\n'), { title: 'Player' }); }
    await ctx.reply(items.map(x => `🏅 *${x.displayName || x.name}*${x.sport ? ` — ${x.sport}` : ''}${x.league ? ` (${x.league})` : ''}\n   ${x.subtitle || x.description || ''}${x.link?.web || x.link?.href ? `\n   ${x.link.web || x.link.href}` : ''}`).join('\n\n'), { title: 'Players' });
  });

  /* ----------------------------------------- universal download ----------------------------------------- */
  const ROUTES = [[/(?:^|\.)(?:tiktok\.com)$|^vm\.tiktok\.com$|^vt\.tiktok\.com$/, 'tiktok'], [/(?:^|\.)instagram\.com$/, 'insta'], [/(?:^|\.)(?:facebook\.com|fb\.watch|fb\.com)$/, 'fb'], [/(?:^|\.)(?:twitter\.com|x\.com|t\.co)$/, 'twitter'], [/(?:^|\.)(?:pinterest\.[a-z.]+|pin\.it)$/, 'pinterest'], [/(?:^|\.)(?:reddit\.com|redd\.it)$/, 'reddit'], [/(?:^|\.)mediafire\.com$/, 'mediafire'], [/(?:^|\.)(?:youtube\.com|youtu\.be|music\.youtube\.com)$/, 'ytv'], [/(?:^|\.)spotify\.com$/, 'spotify'], [/(?:^|\.)(?:drive|docs)\.google\.com$/, 'gdrive']];
  const driveId = u => (u.match(/\/d\/([\w-]{20,})/) || u.match(/[?&]id=([\w-]{20,})/) || [])[1];
  def('gdrive', { cat: 'media', heavy: true, usage: 'gdrive <Google Drive share link>', desc: 'Download a public Google Drive file (up to the bot\'s size limit).' }, async ctx => {
    const link = U.findUrl(ctx.input()) || ctx.input().trim(); const id = driveId(link); if (!id) throw new UserError(`Usage: *${P(ctx)}gdrive https://drive.google.com/file/d/…/view* (the file must be shared with “anyone with the link”)`);
    await delegate(ctx, 'upload', `https://drive.google.com/uc?export=download&confirm=t&id=${id}`);
  });
  def(['download', 'videodl', 'downloadmedia', 'downloadfile', 'downloadvideo', 'downloadimage', 'downloadpdf', 'downloadzip', 'dl'], { cat: 'media', heavy: true, usage: 'download <link> [audio]', desc: 'Download from almost any link: I pick TikTok, Instagram, Facebook, X/Twitter, Pinterest, Reddit, YouTube, Spotify, MediaFire, Google Drive or a direct file link.' }, async ctx => {
    const link = U.findUrl(ctx.input()); if (!link) throw new UserError(`Usage: *${P(ctx)}download <link>* (add the word *audio* for YouTube music)`);
    let host; try { host = new URL(link).hostname.toLowerCase(); } catch { throw new UserError('That link is not valid.'); }
    let target = (ROUTES.find(([re]) => re.test(host)) || [null, 'upload'])[1]; if (target === 'ytv' && /\baudio\b/i.test(ctx.input())) target = 'yta';
    await delegate(ctx, target, link);
  });
  def('downloadaudio', { cat: 'media', heavy: true, usage: 'downloadaudio <link or song name>', desc: 'Download the audio of a link (YouTube, TikTok …) or a song by name.' }, async ctx => {
    const t = ctx.input().trim(); if (!t) throw new UserError(`Usage: *${P(ctx)}downloadaudio <link or song name>*`); const link = U.findUrl(t);
    if (!link || /youtu/.test(link)) return delegate(ctx, link ? 'yta' : 'play', link || t);
    await ctx.reply('ℹ️ Only YouTube links and song names can be downloaded as audio directly. Downloading the video — reply to it with *' + P(ctx) + 'mp3* to get the audio.'); await delegate(ctx, 'download', link);
  });
};

module.exports.helpers = { makeZip, readZip, crc32, guessMatch };
