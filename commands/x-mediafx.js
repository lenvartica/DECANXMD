'use strict';
/**
 * Audio and video tools (ffmpeg, runs locally). Reply to an audio / voice note / video with the command.
 * Audio: audiovolume, echo, reverb, equalizer, voice changers, noise removal, normalize, converters (wav m4a aac flac
 *        ogg opus mp3), audioinfo, audiosplit, audiojoin, renamemp3, metronome, tuner
 * Video: videoinfo, converters (mp4 webm mkv avi mov gif), videomute, videoflip, videoframes, videothumbnail,
 *        videocaption, videowatermark, videofilter, videofps, videoquality, videosplit
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const U = require('../lib/util');
const { UserError, ff } = U;

const V264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'];
const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

/** Parse the text that `ffmpeg -i file` prints (no output file) into a small info object. */
function probe(buffer, ext = 'bin') {
  const f = U.tmp(ext);
  try {
    fs.writeFileSync(f, buffer);
    const r = spawnSync(U.ffmpegBin(), ['-hide_banner', '-i', f], { encoding: 'utf8', timeout: 30000 });
    const t = String(r.stderr || '');
    const dur = t.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const info = { seconds: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null, bitrate: (t.match(/bitrate:\s*(\d+)\s*kb\/s/) || [])[1] };
    const v = t.match(/Stream #[^\n]*Video:\s*([^,\s(]+)[^\n]*?,\s*(\d{2,5})x(\d{2,5})[^\n]*?(?:,\s*([\d.]+)\s*fps)?/);
    if (v) Object.assign(info, { vcodec: v[1], width: Number(v[2]), height: Number(v[3]), fps: v[4] ? Number(v[4]) : null });
    const a = t.match(/Stream #[^\n]*Audio:\s*([^,\s(]+)[^\n]*?,\s*(\d+)\s*Hz,\s*([^,\n]+)/);
    if (a) Object.assign(info, { acodec: a[1], hz: Number(a[2]), channels: a[3].trim() });
    return info;
  } finally { U.rm(f); }
}
const clock = s => (s == null ? '?' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const NOTES = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 };

module.exports = ({ def: rawDef, alias: rawAlias, registry }) => {
  const def = (names, opts, run) => { const n = [].concat(names).filter(x => !registry.has(x.toLowerCase())); if (n.length) rawDef(n, opts, run); };
  const alias = (existing, ...names) => { if (!registry.has(existing)) return; const f = names.filter(x => !registry.has(x.toLowerCase())); if (f.length) rawAlias(existing, ...f); };
  const P = ctx => ctx.var('PREFIX');
  const aud = ctx => ctx.needMedia(['audio', 'video'], 'Reply to an audio, voice note or video with this command.');
  const vid = ctx => ctx.needMedia(['video'], 'Reply to a video with this command.');
  const num = (s, d, lo, hi) => { const n = Number(s); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  const afx = (name, filter, desc, extraAlias = []) => def([name, ...extraAlias], { cat: 'audio', heavy: true, desc: `${desc}. Reply to audio/video.` }, async ctx => {
    const m = await aud(ctx);
    await ctx.audio(await ff(m.buffer, { inExt: 'bin', outExt: 'mp3', args: ['-vn', '-t', '300', '-af', typeof filter === 'function' ? filter(ctx) : filter, '-c:a', 'libmp3lame', '-b:a', '128k'] }), false);
  });

  /* ------------------------------------- audio effects ------------------------------------- */
  afx('audiovolume', ctx => `volume=${num(ctx.argv[0], 1.5, 0.1, 5)},alimiter=limit=0.97`, 'Change loudness, e.g. audiovolume 2 (0.1-5)');
  afx('echo', 'aecho=0.8:0.9:500|1000:0.3|0.25', 'Add an echo');
  afx('reverb', 'aecho=0.8:0.88:40|70|110:0.35|0.25|0.2', 'Add room reverb');
  afx('equalizer', ctx => `bass=g=${num(ctx.argv[0], 8, -20, 20)},treble=g=${num(ctx.argv[1], 6, -20, 20)}`, 'Adjust bass and treble in dB, e.g. equalizer 8 4');
  afx('noiseremove', 'highpass=f=80,afftdn=nf=-25', 'Reduce background noise', ['audioclean', 'denoise']);
  afx('audioenhance', 'highpass=f=70,afftdn=nf=-28,acompressor=threshold=-20dB:ratio=3,loudnorm=I=-16:TP=-1.5:LRA=11', 'Clean up and level out speech');
  afx('audionormalize', 'loudnorm=I=-16:TP=-1.5:LRA=11', 'Normalize loudness');
  afx('malevoice', 'asetrate=44100*0.82,aresample=44100,atempo=1.22', 'Deeper, more masculine voice');
  afx('femalevoice', 'asetrate=44100*1.22,aresample=44100,atempo=0.82', 'Higher, more feminine voice');
  afx('childvoice', 'asetrate=44100*1.45,aresample=44100,atempo=0.69', 'Child-like voice');
  afx('voicechanger', ctx => { const n = num(ctx.argv[0], 4, -12, 12); const f = 2 ** (n / 12); return `asetrate=44100*${f.toFixed(4)},aresample=44100,atempo=${(1 / f).toFixed(4)}`; }, 'Shift the voice by semitones, e.g. voicechanger -5 or 7');
  alias('deep', 'deepvoice'); alias('robot', 'robotvoice'); alias('transcribe', 'audiotext', 'audiotranscribe'); alias('cut', 'cutaudio', 'audiocut', 'audiotrim');

  /* ------------------------------------ audio conversion ------------------------------------ */
  const FMT = {
    mp3: { codec: ['-c:a', 'libmp3lame', '-b:a', '192k'], mime: 'audio/mpeg', asAudio: true },
    m4a: { codec: ['-c:a', 'aac', '-b:a', '192k'], mime: 'audio/mp4', asAudio: true },
    aac: { codec: ['-c:a', 'aac', '-b:a', '192k'], mime: 'audio/aac' },
    wav: { codec: ['-c:a', 'pcm_s16le'], mime: 'audio/wav' },
    flac: { codec: ['-c:a', 'flac'], mime: 'audio/flac' },
    ogg: { codec: ['-c:a', 'libvorbis', '-q:a', '5'], mime: 'audio/ogg' },
    opus: { codec: ['-c:a', 'libopus', '-b:a', '96k'], mime: 'audio/opus' }
  };
  async function convertAudio(ctx, fmt) {
    const f = FMT[fmt]; const m = await aud(ctx);
    const out = await ff(m.buffer, { inExt: 'bin', outExt: fmt === 'aac' ? 'aac' : fmt, args: ['-vn', '-t', '900', ...f.codec] });
    if (f.asAudio) return ctx.audio(out, false, f.mime);
    await ctx.doc(out, `audio.${fmt}`, f.mime);
  }
  for (const fmt of ['m4a', 'aac', 'wav', 'flac', 'ogg', 'opus']) def(fmt, { cat: 'audio', heavy: true, desc: `Convert audio/video to ${fmt.toUpperCase()}. Reply to audio/video.` }, ctx => convertAudio(ctx, fmt));
  def('mp3convert', { cat: 'audio', heavy: true, desc: 'Convert audio to MP3. Reply to audio/video.' }, ctx => convertAudio(ctx, 'mp3'));
  def(['audioconvert', 'audioformat'], { cat: 'audio', heavy: true, usage: `audioconvert <${Object.keys(FMT).join('|')}>`, desc: 'Convert audio to another format. Reply to audio/video.' }, async ctx => {
    const f = (ctx.argv[0] || '').toLowerCase();
    if (!FMT[f]) throw new UserError(`Usage: *${P(ctx)}audioconvert wav* (formats: ${Object.keys(FMT).join(', ')})`);
    await convertAudio(ctx, f);
  });

  /* ------------------------------------ audio info & editing ------------------------------------ */
  def('audioinfo', { cat: 'audio', heavy: true, desc: 'Duration, codec and quality of an audio file. Reply to audio/video.' }, async ctx => {
    const m = await aud(ctx); const i = probe(m.buffer);
    await ctx.reply(`🎧 Duration: *${clock(i.seconds)}*\n🔊 Codec: *${i.acodec || '?'}*${i.hz ? ` • ${i.hz} Hz • ${i.channels}` : ''}\n📶 Bitrate: *${i.bitrate ? i.bitrate + ' kb/s' : '?'}*\n💾 Size: *${U.fmtBytes(m.buffer.length)}*`, { title: 'Audio info' });
  });
  def('audiosplit', { cat: 'audio', heavy: true, usage: 'audiosplit [seconds per part, default 30]', desc: 'Split audio into parts (max 6). Reply to audio/video.' }, async ctx => {
    const m = await aud(ctx); const step = num(ctx.argv[0], 30, 5, 600); const total = probe(m.buffer).seconds || step;
    const parts = Math.min(6, Math.ceil(total / step));
    for (let i = 0; i < parts; i++) await ctx.audio(await ff(m.buffer, { inExt: 'bin', outExt: 'mp3', args: ['-vn', '-ss', String(i * step), '-t', String(step), '-c:a', 'libmp3lame', '-b:a', '128k'] }), false);
    await ctx.reply(`✂️ Sent ${parts} part(s) of ${step}s${total > parts * step ? ` (first ${parts * step}s of ${clock(total)})` : ''}.`);
  });
  def(['audiojoin', 'mergeaudio', 'audiomerge'], { cat: 'audio', heavy: true, usage: 'audiojoin add (reply to audio) • audiojoin • audiojoin clear', desc: 'Join several audios: reply to each with "audiojoin add", then send "audiojoin".' }, async ctx => {
    ctx.rt.mergeAudio = ctx.rt.mergeAudio || new Map(); const k = ctx.chat + ctx.senderNum; const q = ctx.rt.mergeAudio.get(k) || []; const sub = (ctx.argv[0] || '').toLowerCase();
    if (sub === 'clear') { ctx.rt.mergeAudio.delete(k); return ctx.reply('🧹 Audio queue cleared.'); }
    if (sub === 'add') { const m = await aud(ctx); if (q.length >= 8) throw new UserError('You can join up to 8 audios.'); q.push(m.buffer); ctx.rt.mergeAudio.set(k, q); return ctx.reply(`➕ Added audio ${q.length}. Add more, or send *${P(ctx)}audiojoin* to join them.`); }
    if (q.length < 2) throw new UserError(`Add at least 2 audios first: reply to each with *${P(ctx)}audiojoin add*`);
    const files = q.map((b, i) => { const f = U.tmp('bin'); fs.writeFileSync(f, b); return f; }); const out = U.tmp('mp3');
    try {
      await U.ffmpeg([...files.flatMap(f => ['-i', f]), '-filter_complex', `${files.map((_, i) => `[${i}:a]`).join('')}concat=n=${files.length}:v=0:a=1[a]`, '-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '128k', out]);
      await ctx.audio(fs.readFileSync(out), false);
    } finally { U.rm(...files, out); ctx.rt.mergeAudio.delete(k); }
  });
  def('renamemp3', { cat: 'audio', heavy: true, usage: 'renamemp3 <title> | <artist>', desc: 'Set the title/artist of an MP3 and send it back with that file name. Reply to audio.' }, async ctx => {
    const [title, artist = ''] = ctx.input().split('|').map(s => s.trim()); if (!title) throw new UserError(`Usage: *${P(ctx)}renamemp3 My Song | My Artist*`);
    const m = await aud(ctx);
    const out = await ff(m.buffer, { inExt: 'bin', outExt: 'mp3', args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-metadata', `title=${title}`, ...(artist ? ['-metadata', `artist=${artist}`] : [])] });
    await ctx.doc(out, `${(artist ? artist + ' - ' : '') + title}.mp3`.replace(/[\\/:*?"<>|]/g, ''), 'audio/mpeg');
  });
  def('metronome', { cat: 'audio', heavy: true, usage: 'metronome <bpm 30-240> [seconds 5-60]', desc: 'Generate a metronome click track.' }, async ctx => {
    const bpm = num(ctx.argv[0], 100, 30, 240), secs = num(ctx.argv[1], 20, 5, 60); const out = U.tmp('mp3');
    try { await U.ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=sin(2*PI*1200*t)*exp(-60*mod(t\\,${(60 / bpm).toFixed(5)})):s=44100:d=${secs}`, '-c:a', 'libmp3lame', '-b:a', '96k', out]); await ctx.audio(fs.readFileSync(out), false); } finally { U.rm(out); }
  });
  def('tuner', { cat: 'audio', heavy: true, usage: 'tuner <note like A4, E2, C#3>', desc: 'Play a reference tone for a musical note (A4 = 440 Hz).' }, async ctx => {
    const m = (ctx.argv[0] || 'A4').toLowerCase().match(/^([a-g][#b]?)(\d)$/); if (!m || !(m[1] in NOTES)) throw new UserError(`Usage: *${P(ctx)}tuner A4* (notes A-G, optional # or b, octave 0-8)`);
    const hz = 440 * 2 ** ((NOTES[m[1]] + 12 * Number(m[2]) - 57) / 12); const out = U.tmp('mp3');
    try { await U.ffmpeg(['-f', 'lavfi', '-i', `sine=f=${hz.toFixed(2)}:d=6`, '-af', 'afade=t=out:st=5:d=1', '-c:a', 'libmp3lame', '-b:a', '96k', out]); await ctx.audio(fs.readFileSync(out), false); await ctx.reply(`🎼 ${(ctx.argv[0] || 'A4').toUpperCase()} = *${hz.toFixed(2)} Hz*`); } finally { U.rm(out); }
  });

  /* ------------------------------------------ video ------------------------------------------ */
  def('videoinfo', { cat: 'video', heavy: true, desc: 'Resolution, length, codec and size of a video. Reply to a video.' }, async ctx => {
    const m = await vid(ctx); const i = probe(m.buffer, 'mp4');
    await ctx.reply(`🎬 Length: *${clock(i.seconds)}*\n📐 Size: *${i.width || '?'} × ${i.height || '?'}*${i.fps ? ` • ${i.fps} fps` : ''}\n🎞️ Video: *${i.vcodec || '?'}*\n🔊 Audio: *${i.acodec || 'none'}*\n📶 Bitrate: *${i.bitrate ? i.bitrate + ' kb/s' : '?'}*\n💾 File: *${U.fmtBytes(m.buffer.length)}*`, { title: 'Video info' });
  });
  const VF = {
    mp4: { ext: 'mp4', args: V264, mime: 'video/mp4' },
    webm: { ext: 'webm', args: ['-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-c:a', 'libopus'], mime: 'video/webm' },
    mkv: { ext: 'mkv', args: V264.slice(0, -2), mime: 'video/x-matroska' },
    avi: { ext: 'avi', args: ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame', '-b:a', '128k'], mime: 'video/x-msvideo' },
    mov: { ext: 'mov', args: V264, mime: 'video/quicktime' },
    gif: { ext: 'gif', args: ['-vf', 'fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse', '-an', '-t', '15'], mime: 'image/gif' }
  };
  async function convertVideo(ctx, fmt) {
    const f = VF[fmt]; const m = await vid(ctx);
    const vf = fmt === 'gif' ? [] : ['-vf', even];
    const out = await ff(m.buffer, { inExt: 'mp4', outExt: f.ext, args: fmt === 'gif' ? f.args : [...vf, '-t', '180', ...f.args] });
    if (fmt === 'mp4') return ctx.video(out);
    await ctx.doc(out, `video.${f.ext}`, f.mime);
  }
  def(['videoconvert', 'videoformat'], { cat: 'video', heavy: true, usage: `videoconvert <${Object.keys(VF).join('|')}>`, desc: 'Convert a video to another format. Reply to a video.' }, async ctx => {
    const f = (ctx.argv[0] || '').toLowerCase(); if (!VF[f]) throw new UserError(`Usage: *${P(ctx)}videoconvert webm* (formats: ${Object.keys(VF).join(', ')})`);
    await convertVideo(ctx, f);
  });
  for (const [name, fmt] of [['mp4convert', 'mp4'], ['mkvconvert', 'mkv'], ['avi', 'avi'], ['mov', 'mov'], ['webm', 'webm'], ['gifconvert', 'gif']]) def(name, { cat: 'video', heavy: true, desc: `Convert a video to ${fmt.toUpperCase()}. Reply to a video.` }, ctx => convertVideo(ctx, fmt));
  def('videomute', { cat: 'video', heavy: true, desc: 'Remove the sound from a video. Reply to a video.' }, async ctx => { const m = await vid(ctx); await ctx.video(await ff(m.buffer, { inExt: 'mp4', outExt: 'mp4', args: ['-an', '-c:v', 'copy'] })); });
  def('videoflip', { cat: 'video', heavy: true, usage: 'videoflip [h|v]', desc: 'Mirror a video horizontally (h, default) or flip it upside down (v). Reply to a video.' }, async ctx => {
    const m = await vid(ctx); await ctx.video(await ff(m.buffer, { inExt: 'mp4', outExt: 'mp4', args: ['-vf', /^v/i.test(ctx.argv[0] || '') ? 'vflip' : 'hflip', ...V264] }));
  });
  def('videothumbnail', { cat: 'video', heavy: true, usage: 'videothumbnail [time e.g. 0:05]', desc: 'Grab one frame of a video as an image. Reply to a video.' }, async ctx => {
    const m = await vid(ctx); const t = ctx.argv[0] ? U.parseTs(ctx.argv[0]) : 1;
    await ctx.image(await ff(m.buffer, { inExt: 'mp4', outExt: 'jpg', args: ['-ss', String(t ?? 1), '-frames:v', '1', '-q:v', '2'] }), `🖼️ Frame at ${clock(t ?? 1)}`);
  });
  def(['videoframes', 'extractframes', 'frames'], { cat: 'video', heavy: true, usage: 'videoframes [count 1-8]', desc: 'Pull evenly spaced frames out of a video as images. Reply to a video.' }, async ctx => {
    const m = await vid(ctx); const n = Math.floor(num(ctx.argv[0], 4, 1, 8)); const total = probe(m.buffer, 'mp4').seconds || 10;
    for (let i = 0; i < n; i++) { const t = (total * (i + 0.5)) / n; await ctx.image(await ff(m.buffer, { inExt: 'mp4', outExt: 'jpg', args: ['-ss', t.toFixed(2), '-frames:v', '1', '-q:v', '3'] }), `🎞️ ${i + 1}/${n} • ${clock(t)}`); }
  });
  def('videofilter', { cat: 'video', heavy: true, usage: 'videofilter <grayscale|sepia|blur|negate|vintage|sharpen|bright|dark>', desc: 'Apply a look to a video. Reply to a video.' }, async ctx => {
    const F = { grayscale: 'hue=s=0', sepia: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131', blur: 'boxblur=6:2', negate: 'negate', vintage: 'curves=vintage,noise=alls=12:allf=t', sharpen: 'unsharp=5:5:1.2', bright: 'eq=brightness=0.12:saturation=1.3', dark: 'eq=brightness=-0.15:contrast=1.1' };
    const f = (ctx.argv[0] || '').toLowerCase(); if (!F[f]) throw new UserError(`Usage: *${P(ctx)}videofilter sepia* (${Object.keys(F).join(', ')})`);
    const m = await vid(ctx); await ctx.video(await ff(m.buffer, { inExt: 'mp4', outExt: 'mp4', args: ['-t', '60', '-vf', `${F[f]},${even}`, ...V264] }));
  });
  def('videofps', { cat: 'video', heavy: true, usage: 'videofps <5-60>', desc: 'Change a video\'s frame rate. Reply to a video.' }, async ctx => {
    const fps = num(ctx.argv[0], 0, 5, 60); if (!fps) throw new UserError(`Usage: *${P(ctx)}videofps 24*`);
    const m = await vid(ctx); await ctx.video(await ff(m.buffer, { inExt: 'mp4', outExt: 'mp4', args: ['-t', '90', '-vf', `fps=${fps},${even}`, ...V264] }));
  });
  def('videoquality', { cat: 'video', heavy: true, usage: 'videoquality <240|360|480|720|1080>', desc: 'Resize a video to a height in pixels. Reply to a video.' }, async ctx => {
    const h = Number(ctx.argv[0]); if (![240, 360, 480, 720, 1080].includes(h)) throw new UserError(`Usage: *${P(ctx)}videoquality 480* (240, 360, 480, 720 or 1080)`);
    const m = await vid(ctx); await ctx.video(await ff(m.buffer, { inExt: 'mp4', outExt: 'mp4', args: ['-t', '120', '-vf', `scale=-2:${h}`, ...V264] }));
  });
  def(['videosplit', 'splitvideo'], { cat: 'video', heavy: true, usage: 'videosplit [seconds per part, default 30]', desc: 'Cut a video into parts (max 5). Reply to a video.' }, async ctx => {
    const m = await vid(ctx); const step = num(ctx.argv[0], 30, 5, 120); const total = probe(m.buffer, 'mp4').seconds || step; const parts = Math.min(5, Math.ceil(total / step));
    for (let i = 0; i < parts; i++) await ctx.video(await ff(m.buffer, { inExt: 'mp4', outExt: 'mp4', args: ['-ss', String(i * step), '-t', String(step), '-vf', even, ...V264] }), `✂️ Part ${i + 1}/${parts}`);
  });

  /* text burned into a video: drawn as a transparent PNG with sharp (no fonts needed on the server) */
  async function burn(ctx, build) {
    const m = await vid(ctx); const i = probe(m.buffer, 'mp4'); if (!i.width) throw new UserError('I could not read that video\'s size.');
    const w = i.width - (i.width % 2), h = i.height - (i.height % 2);
    const png = await U.sharp()(Buffer.from(build(w, h))).png().toBuffer(); const pf = U.tmp('png'); fs.writeFileSync(pf, png);
    try {
      await ctx.video(await ff(m.buffer, { inExt: 'mp4', outExt: 'mp4', args: (inp, outp) => ['-i', inp, '-i', pf, '-t', '90', '-filter_complex', `[0:v]scale=${w}:${h}[b];[b][1:v]overlay=0:0`, '-map', '0:a?', ...V264, outp] }));
    } finally { U.rm(pf); }
  }
  const lines = (t, n) => { const out = []; let l = ''; for (const w of t.split(/\s+/)) { if ((l + ' ' + w).trim().length > n && l) { out.push(l); l = w; } else l = (l + ' ' + w).trim(); } if (l) out.push(l); return out.slice(0, 3); };
  def('videocaption', { cat: 'video', heavy: true, usage: 'videocaption <text>', desc: 'Burn a caption into the bottom of a video. Reply to a video.' }, async ctx => {
    const t = ctx.input().trim(); if (!t) throw new UserError(`Usage: *${P(ctx)}videocaption my caption* (reply to a video)`);
    await burn(ctx, (w, h) => { const size = Math.round(w / 18), ls = lines(t, Math.max(10, Math.round(w / (size * 0.55)))); const y0 = h - size * 0.7 - (ls.length - 1) * size * 1.2;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text font-family="Arial, sans-serif" font-size="${size}" font-weight="700" fill="#fff" stroke="#000" stroke-width="${size / 7}" paint-order="stroke" stroke-linejoin="round" text-anchor="middle">${ls.map((l, i) => `<tspan x="${w / 2}" y="${y0 + i * size * 1.2}">${U.escXml(l)}</tspan>`).join('')}</text></svg>`; });
  });
  def('videowatermark', { cat: 'video', heavy: true, usage: 'videowatermark <text>', desc: 'Stamp a text watermark in the corner of a video. Reply to a video.' }, async ctx => {
    const t = ctx.input().trim(); if (!t) throw new UserError(`Usage: *${P(ctx)}videowatermark © My Brand* (reply to a video)`);
    await burn(ctx, (w, h) => { const size = Math.max(14, Math.round(w / 26)); return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="${w - size}" y="${h - size}" font-family="Arial, sans-serif" font-size="${size}" font-weight="700" fill="#fff" fill-opacity="0.75" stroke="#000" stroke-opacity="0.4" stroke-width="${size / 14}" paint-order="stroke" text-anchor="end">${U.escXml(t.slice(0, 40))}</text></svg>`; });
  });

  alias('compress', 'videocompress', 'compressvideo'); alias('trim', 'videotrim', 'videocut'); alias('merge', 'videomerge', 'mergevideo');
  alias('rotate', 'videorotate'); alias('reverse', 'videoreverse'); alias('mp3', 'videoaudio');
};

module.exports.helpers = { probe, clock };
