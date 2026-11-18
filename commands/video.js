'use strict';
const { UserError, ff, parseTs, tmp, rm, ffmpeg } = require('../lib/util');
const fs = require('fs');

module.exports = ({ def }) => {
  const needVideo = ctx => ctx.needMedia('video', 'Reply to a video with this command.');
  const V264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart'];

  def('compress', { cat: 'video', heavy: true, desc: 'Shrink a video\'s file size. Reply to a video.' }, async ctx => {
    const m = await needVideo(ctx);
    const out = await ff(m.buffer, { inExt: 'mp4', outExt: 'mp4', args: ['-vf', "scale='min(640,iw)':-2", '-c:v', 'libx264', '-crf', '32', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart'] });
    await ctx.video(out, `📉 ${(m.buffer.length / 1048576).toFixed(1)} MB → ${(out.length / 1048576).toFixed(1)} MB`);
  });

  def('crop', { cat: 'video', heavy: true, usage: 'crop <w:h>  (default 1:1)  or  crop <w:h:x:y>', desc: 'Crop a video to an aspect ratio (centered) or exact pixels. Reply to a video.' }, async ctx => {
    const m = await needVideo(ctx);
    const parts = (ctx.argv[0] || '1:1').split(':').map(Number);
    if (parts.some(n => !(n > 0) && n !== 0) || parts.length < 2) throw new UserError('Use e.g. *crop 1:1*, *crop 16:9* or *crop 480:480:0:0*');
    const vf = parts.length === 4
      ? `crop=${parts.join(':')}`
      : `crop='min(iw,ih*${parts[0]}/${parts[1]})':'min(ih,iw*${parts[1]}/${parts[0]})',scale=trunc(iw/2)*2:trunc(ih/2)*2`;
    const out = await ff(m.buffer, { inExt: 'mp4', outExt: 'mp4', args: ['-vf', vf, ...V264] });
    await ctx.video(out);
  });

  def('mp3', { cat: 'video', heavy: true, desc: 'Extract the audio of a video as MP3. Reply to a video.' }, async ctx => {
    const m = await ctx.needMedia(['video', 'audio']);
    const out = await ff(m.buffer, { inExt: 'bin', outExt: 'mp3', args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '160k'] });
    await ctx.audio(out, false);
  });

  def('reverse', { cat: 'video', heavy: true, desc: 'Play a video backwards (first 30 s). Reply to a video.' }, async ctx => {
    const m = await needVideo(ctx);
    const out = await ff(m.buffer, { inExt: 'mp4', outExt: 'mp4', args: ['-t', '30', '-vf', 'reverse', '-af', 'areverse', ...V264] });
    await ctx.video(out);
  });

  def('rotate', { cat: 'video', heavy: true, usage: 'rotate <90|180|270|left|right|flip|flop>', desc: 'Rotate or mirror a video. Reply to a video.' }, async ctx => {
    const m = await needVideo(ctx);
    const a = (ctx.argv[0] || '90').toLowerCase();
    const map = { 90: 'transpose=1', right: 'transpose=1', 270: 'transpose=2', left: 'transpose=2', 180: 'transpose=1,transpose=1', flip: 'vflip', flop: 'hflip' };
    if (!map[a]) throw new UserError('Use one of: 90, 180, 270, left, right, flip, flop');
    const out = await ff(m.buffer, { inExt: 'mp4', outExt: 'mp4', args: ['-vf', map[a], ...V264] });
    await ctx.video(out);
  });

  def('trim', { cat: 'video', heavy: true, usage: 'trim <start> <end>  e.g. trim 0:05 0:20', desc: 'Cut a part of a video. Reply to a video.' }, async ctx => {
    const m = await needVideo(ctx);
    const s = parseTs(ctx.argv[0]), e = parseTs(ctx.argv[1]);
    if (s == null || e == null || e <= s) throw new UserError(`Usage: *${ctx.var('PREFIX')}trim 0:05 0:20*`);
    const out = await ff(m.buffer, { inExt: 'mp4', outExt: 'mp4', args: ['-ss', String(s), '-to', String(e), ...V264] });
    await ctx.video(out);
  });

  def('merge', { cat: 'video', heavy: false, usage: 'merge add (reply to a video) • merge (join) • merge clear', desc: 'Join several videos into one: reply to each with "merge add", then send "merge".' }, async ctx => {
    const q = ctx.rt.merge.get(ctx.chat + ctx.senderNum) || [];
    const sub = (ctx.argv[0] || '').toLowerCase();
    if (sub === 'clear') { ctx.rt.merge.delete(ctx.chat + ctx.senderNum); return ctx.reply('🧹 Merge queue cleared.'); }
    if (sub === 'add') {
      const m = await needVideo(ctx);
      if (q.length >= 6) throw new UserError('You can merge up to 6 videos.');
      q.push(m.buffer);
      ctx.rt.merge.set(ctx.chat + ctx.senderNum, q);
      return ctx.reply(`➕ Added video ${q.length}. Add more, or send *${ctx.var('PREFIX')}merge* to join them.`);
    }
    if (q.length < 2) throw new UserError(`Add at least 2 videos first: reply to each with *${ctx.var('PREFIX')}merge add*`);
    ctx.react('⏳');
    const files = q.map(() => tmp('mp4'));
    const out = tmp('mp4');
    try {
      q.forEach((b, i) => fs.writeFileSync(files[i], b));
      const inputs = files.flatMap(f => ['-i', f]);
      const norm = files.map((_, i) => `[${i}:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];[${i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]`).join(';');
      const cat = files.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${files.length}:v=1:a=1[v][a]`;
      await ffmpeg([...inputs, '-filter_complex', `${norm};${cat}`, '-map', '[v]', '-map', '[a]', ...V264, out]);
      await ctx.video(fs.readFileSync(out), `🎞️ Merged ${files.length} videos`);
      ctx.rt.merge.delete(ctx.chat + ctx.senderNum);
      ctx.react('✅');
    } catch (e) {
      if (/Stream specifier|matches no streams/i.test(e.message)) throw new UserError('One of the videos has no audio track, which merge needs. Use videos with sound.');
      throw e;
    } finally { rm(out, ...files); }
  });
};
