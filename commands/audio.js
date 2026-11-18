'use strict';
const { UserError, ff, parseTs } = require('../lib/util');

const AF = {
  bass: ['equalizer=f=54:width_type=o:width=2:g=20', 'Boost the bass'],
  blown: ['acrusher=.1:1:64:0:log', 'Blown-out distorted audio'],
  deep: ['asetrate=44100*0.7,aresample=44100,atempo=1.25', 'Deep voice'],
  earrape: ['volume=12,alimiter=limit=1', 'Extremely loud'],
  fast: ['atempo=1.5', 'Speed up'],
  fat: ['asetrate=44100*0.85,aresample=44100,bass=g=12', 'Fat, heavy bass voice'],
  low: ['asetrate=44100*0.8,aresample=44100', 'Lower the pitch'],
  nightcore: ['asetrate=44100*1.25,aresample=44100', 'Nightcore (faster + higher)'],
  robot: ["afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75", 'Robot voice'],
  slow: ['atempo=0.7', 'Slow down'],
  smooth: ['lowpass=f=3500,acompressor=threshold=-18dB:ratio=3', 'Smooth, mellow sound'],
  treble: ['treble=g=15', 'Boost the treble'],
  tupai: ['asetrate=44100*1.7,aresample=44100,atempo=0.59', 'Chipmunk voice']
};

const VIS = {
  avec: ['[0:a]showwaves=s=720x720:mode=cline:colors=cyan|magenta:rate=25,format=yuv420p[v]', 'Audio → video with a waveform'],
  histo: ['[0:a]ahistogram=s=720x480:slide=scroll:scale=log,format=yuv420p[v]', 'Audio → video with a histogram'],
  vector: ['[0:a]avectorscope=s=640x640:zoom=1.5:rc=40:gc=160:bc=80:rf=15:gf=80:bf=40,format=yuv420p[v]', 'Audio → video with a vectorscope']
};

module.exports = ({ def }) => {
  const mediaAudio = ctx => ctx.needMedia(['audio', 'video'], 'Reply to an audio, voice note or video.');

  for (const [name, [filter, desc]] of Object.entries(AF)) {
    def(name, { cat: 'audio', heavy: true, desc: `${desc}. Reply to audio/video.` }, async ctx => {
      const m = await mediaAudio(ctx);
      const out = await ff(m.buffer, { inExt: 'bin', outExt: 'mp3', args: ['-vn', '-t', '300', '-af', filter, '-c:a', 'libmp3lame', '-b:a', '128k'] });
      await ctx.audio(out, false);
    });
  }

  for (const [name, [graph, desc]] of Object.entries(VIS)) {
    def(name, { cat: 'audio', heavy: true, desc: `${desc}. Reply to audio.` }, async ctx => {
      const m = await mediaAudio(ctx);
      const out = await ff(m.buffer, {
        inExt: 'bin', outExt: 'mp4',
        args: (i, o) => ['-i', i, '-t', '120', '-filter_complex', graph, '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', o]
      });
      await ctx.video(out);
    });
  }

  def('black', { cat: 'audio', heavy: true, desc: 'Turn audio into a video with a black screen. Reply to audio.' }, async ctx => {
    const m = await mediaAudio(ctx);
    const out = await ff(m.buffer, {
      inExt: 'bin', outExt: 'mp4',
      args: (i, o) => ['-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=15', '-i', i, '-t', '300', '-shortest', '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-tune', 'stillimage', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', o]
    });
    await ctx.video(out);
  });

  def('pitch', { cat: 'audio', heavy: true, usage: 'pitch <0.5-2>', desc: 'Change pitch without changing speed (default 1.25). Reply to audio.' }, async ctx => {
    const m = await mediaAudio(ctx);
    const f = Math.min(2, Math.max(0.5, Number(ctx.argv[0]) || 1.25));
    const af = `asetrate=44100*${f},aresample=44100,atempo=${(1 / f).toFixed(4)}`;
    const out = await ff(m.buffer, { inExt: 'bin', outExt: 'mp3', args: ['-vn', '-t', '300', '-af', af, '-c:a', 'libmp3lame', '-b:a', '128k'] });
    await ctx.audio(out, false);
  });

  def('cut', { cat: 'audio', heavy: true, usage: 'cut <start> <end>  e.g. cut 0:10 0:40', desc: 'Cut a part of audio. Reply to audio.' }, async ctx => {
    const m = await mediaAudio(ctx);
    const s = parseTs(ctx.argv[0]), e = parseTs(ctx.argv[1]);
    if (s == null || e == null || e <= s) throw new UserError(`Usage: *${ctx.var('PREFIX')}cut 0:10 0:40* (start and end, in seconds or mm:ss)`);
    const out = await ff(m.buffer, { inExt: 'bin', outExt: 'mp3', args: ['-vn', '-ss', String(s), '-to', String(e), '-c:a', 'libmp3lame', '-b:a', '128k'] });
    await ctx.audio(out, false);
  });
};
