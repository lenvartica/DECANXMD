'use strict';
const crypto = require('crypto');
const U = require('../lib/util');
const music = require('../lib/music');
const interactive = require('../lib/interactive');
const { UserError, bold } = U;
const bm = require('../lib/bigmedia');

/** "video funny cats 720 doc" -> { text:'funny cats', quality:720, asDoc:true } */
function parseMediaOpts(input) {
  let text = String(input || ''), quality = null, asDoc = false;
  text = text.replace(/(?:^|\s)(2160|1440|1080|720|480|360|240)p?(?=\s|$)/i, (_m, q) => { quality = Number(q); return ' '; });
  text = text.replace(/(?:^|\s)(doc|document|file)(?=\s|$)/i, () => { asDoc = true; return ' '; });
  return { text: text.trim(), quality, asDoc };
}

module.exports = ({ def, hooks }) => {
  const cookies = ctx => ctx.get('yt_cookies', '') || undefined;
  const IMG = new Set(['jpg', 'jpeg', 'png', 'webp']);

  async function sendItems(ctx, r, caption) {
    for (const it of r.items.slice(0, 6)) {
      if (IMG.has(it.ext)) await ctx.image(it.buffer, caption);
      else if (['mp3', 'm4a', 'opus', 'ogg'].includes(it.ext)) await ctx.audio(it.buffer, false, U.audioMime(it.ext));
      else await ctx.video(it.buffer, caption);
    }
  }

  /** TikTok through a public resolver (no watermark when available). Returns the same shape as bm.fetchVideo, or throws. */
  async function tiktokFallback(url) {
    const j = await U.getJson('https://www.tikwm.com/api/?hd=1&url=' + encodeURIComponent(url), { timeout: 20000, retries: 1 });
    const d = j?.data;
    if (!d || (j.code !== 0 && j.code !== undefined)) throw new Error('resolver had no video');
    const link = d.hdplay || d.play;
    if (!link) throw new Error('resolver had no video');
    const f = await bm.downloadToFile(/^https?:/i.test(link) ? link : 'https://www.tikwm.com' + link, { ext: 'mp4', maxBytes: bm.limits().video * bm.MB });
    const ext = (/\.([a-z0-9]{2,4})$/i.exec(f.name) || [, 'mp4'])[1].toLowerCase();
    return { items: [{ path: f.path, ext, size: f.size }], title: String(d.title || 'TikTok video').slice(0, 120), duration: Number(d.duration) || 0, cleanup: f.cleanup };
  }

  /* Generic link downloaders powered by yt-dlp */
  const GENERIC = {
    fb: ['Facebook video', /facebook\.com|fb\.watch|fb\.com/i],
    insta: ['Instagram post/reel', /instagram\.com/i],
    tiktok: ['TikTok video', /tiktok\.com/i],
    twitter: ['Twitter/X video or image', /twitter\.com|x\.com|t\.co/i],
    reddit: ['Reddit video', /reddit\.com|redd\.it/i],
    pinterest: ['Pinterest pin', /pinterest\.|pin\.it/i]
  };
  for (const [name, [label, re]] of Object.entries(GENERIC)) {
    def(name, { cat: 'download', heavy: true, usage: `${name} <link>`, desc: `Download a ${label} from its link.` }, async ctx => {
      const o = parseMediaOpts(ctx.input());
      const url = U.findUrl(o.text);
      if (!url) throw new UserError(`Send a link, e.g. *${ctx.var('PREFIX')}${name} https://…*  (add *720* for a quality, or *doc* to get it as a document)`);
      if (!re.test(url)) throw new UserError(`That doesn't look like a ${label} link.`);
      await ctx.react('⏳');
      // Big files are streamed to disk and sent from disk, so long videos work (limit: MAX_VIDEO_MB, default 700)
      let r;
      try { r = await bm.fetchVideo(url, { quality: o.quality || 1080, cookies: cookies(ctx), playlist: name === 'insta' ? '1-10' : null }); }
      catch (e) {
        // TikTok often blocks yt-dlp on server IPs; a public resolver is tried before giving up. Setup problems are reported as they are.
        if (name !== 'tiktok' || /engine|ffmpeg is missing/i.test(String(e?.message))) throw e;
        r = await tiktokFallback(url).catch(() => null);
        if (!r) throw e;
      }
      try { await bm.sendItems(ctx, r, { caption: `📥 ${r.title}`.slice(0, 200), asDoc: o.asDoc, name: r.title }); await ctx.react('✅'); }
      finally { r.cleanup(); }
    });
  }

  def('story', { cat: 'download', heavy: true, usage: 'story <instagram username or story link>', desc: 'Download Instagram stories (needs owner cookies via .ytlogin).' }, async ctx => {
    const a = ctx.input().trim();
    if (!a) throw new UserError('Give an Instagram username or story link.');
    const url = U.isUrl(a) ? a : `https://www.instagram.com/stories/${a.replace('@', '')}/`;
    const r = await U.ytDownload(url, 'video', { cookies: cookies(ctx), playlist: '1-5' });
    await sendItems(ctx, r, `📥 Story`);
  });

  /* YouTube */
  async function resolveYt(ctx, wantInfo) {
    const q = ctx.input();
    if (!q) throw new UserError('Give a song/video name or a YouTube link.');
    if (U.isUrl(q)) return { url: U.findUrl(q), info: null };
    const [v] = await U.ytSearch(q, 1);
    if (!v) throw new UserError('No results found.');
    return { url: v.url, info: v };
  }
  def('play', { cat: 'download', heavy: true, usage: 'play <song name or YouTube link>', desc: 'Search YouTube and send the song as audio — fast, no preview card. A direct YouTube link is downloaded directly; SoundCloud is used as a fallback for search queries.' }, async ctx => {
    const q = ctx.input().trim();
    if (!q) throw new UserError(`Which song? Example: *${ctx.var('PREFIX')}play burna boy last last* or send a YouTube link.`);
    await ctx.react('🔎');
    // Intentionally no preview card / onInfo callback here: .play stays fast and sends audio
    // the moment the download finishes. Use .music for the tappable preview-and-choose menu.
    const r = await music.getAudio(q, { cookies: cookies(ctx) });
    await ctx.audio(r.buffer, false, U.audioMime(r.ext));
    await ctx.react('✅');
  });
  def('song', { cat: 'download', heavy: true, usage: 'song <name or YouTube link>', desc: 'Search and download a song as an MP3 file, or provide a direct media link.' }, async ctx => {
    const input = ctx.input().trim();
    if (!input) throw new UserError(`Which song? Example: *${ctx.var('PREFIX')}song asake sungba*`);
    const r = await music.getAudio(input, { cookies: cookies(ctx) });
    await ctx.doc(r.buffer, mp3Name(r.title, r.ext), U.audioMime(r.ext));
  });
  def('video', { cat: 'download', heavy: true, usage: 'video <name or link> [360|480|720|1080] [doc]', desc: 'Download a YouTube video in the quality you choose (default 720p). Long and large videos are sent as documents.' }, async ctx => {
    const o = parseMediaOpts(ctx.input());
    if (!o.text) throw new UserError(`Give a video name or link, e.g. *${ctx.var('PREFIX')}video burna boy last last 1080*`);
    const url = U.isUrl(o.text) ? U.findUrl(o.text) : (await U.ytSearch(o.text, 1))[0]?.url;
    if (!url) throw new UserError('No results found.');
    await ctx.react('⏳');
    const r = await bm.fetchVideo(url, { quality: o.quality || 720, cookies: cookies(ctx) });
    try { await bm.sendItems(ctx, r, { caption: `🎬 ${r.title}`.slice(0, 200), asDoc: o.asDoc, name: r.title }); await ctx.react('✅'); }
    finally { r.cleanup(); }
  });

  /* ------------------------------------------------------------------ *
   * .music — a real tappable WhatsApp menu for a song: Play Audio /
   * Send as Document / Download Video / Cancel. See lib/interactive.js
   * for how the menu itself is sent (native-flow buttons, with a
   * numbered-reply fallback), and the hook below for how a tap/reply
   * is matched back to the request that created it.
   * ------------------------------------------------------------------ */
  const mp3Name = (title, ext = 'mp3') => `${String(title || 'song').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 120) || 'song'}.${/^[a-z0-9]{2,4}$/i.test(ext) ? ext.toLowerCase() : 'mp3'}`;
  const MENU_TTL_MS = 2 * 60 * 1000;
  const MAX_PENDING_MENUS = 40;
  const MENU_ACTIONS = ['play', 'doc', 'video', 'cancel'];
  const genMenuId = () => crypto.randomBytes(4).toString('hex');

  // WhatsApp can show the same person as a phone number in one message and a LID in the next, so match on any shared id.
  const sameUser = (p, ctx) => p.userId === ctx.senderNum || (ctx.senderIds || []).some(i => (p.userIds || []).includes(i));

  function sweepMenus(rt) {
    const now = Date.now();
    for (const [id, p] of rt.musicMenus) if (p.used || now > p.expiresAt) rt.musicMenus.delete(id);
    while (rt.musicMenus.size > MAX_PENDING_MENUS) rt.musicMenus.delete(rt.musicMenus.keys().next().value);
  }

  async function resolveVideoUrl(q) {
    if (U.isUrl(q)) return U.findUrl(q);
    const [v] = await U.ytSearch(q, 1);
    if (!v) throw new UserError('No results found.');
    return v.url;
  }

  def('music', { cat: 'download', usage: 'music <song name or YouTube link>', desc: 'Show a real tappable menu — Play Audio, Send as Document, Download Video, or Cancel — for a song.' }, async ctx => {
    const q = ctx.input().trim();
    if (!q) throw new UserError(`Which song? Example: *${ctx.var('PREFIX')}music burna boy last last*`);
    const rt = ctx.rt;
    sweepMenus(rt);
    // Duplicate-request guard: don't open a second menu for the same chat+user+query while one is still open.
    for (const p of rt.musicMenus.values()) {
      if (p.chat === ctx.chat && sameUser(p, ctx) && p.query === q && !p.used && Date.now() < p.expiresAt) {
        return ctx.reply('⏳ You already have a menu open for that song — pick an option above, or wait for it to expire and try again.');
      }
    }
    const id = genMenuId();
    const rows = [
      { id: `mm:${id}:play`, title: '▶ Play Audio', description: 'Send the song as audio' },
      { id: `mm:${id}:doc`, title: '📄 Send as Document', description: 'Send the MP3 as a file' },
      { id: `mm:${id}:video`, title: '🎬 Download Video', description: 'Send the matching video' },
      { id: `mm:${id}:cancel`, title: '❌ Cancel', description: 'Dismiss this menu' }
    ];
    const mode = await interactive.sendMenu(ctx, { body: `🎵 *${q}*\nChoose how you want it:`, title: 'Music options', buttonText: 'Choose', rows });
    rt.musicMenus.set(id, { id, chat: ctx.chat, userId: ctx.senderNum, userIds: [...new Set([ctx.senderNum, ...(ctx.senderIds || [])].filter(Boolean))], query: q, mode, used: false, createdAt: Date.now(), expiresAt: Date.now() + MENU_TTL_MS });
  });

  hooks.push({
    name: 'musicMenu',
    run: async ctx => {
      if (!ctx.fresh || !ctx.text) return false;
      const rt = ctx.rt;
      sweepMenus(rt);

      let pendingId, action;
      const native = /^mm:([0-9a-f]{8}):(play|doc|video|cancel)$/.exec(ctx.text.trim());
      if (native) {
        [, pendingId, action] = native;
      } else {
        const text = ctx.text.trim().toLowerCase();
        const n = Number(text);
        const actionAliases = {
          '1': 'play', 'play': 'play', 'audio': 'play', 'song': 'play',
          '2': 'doc', 'doc': 'doc', 'document': 'doc', 'mp3': 'doc',
          '3': 'video', 'video': 'video', 'vid': 'video', 'mp4': 'video',
          '4': 'cancel', 'cancel': 'cancel', 'stop': 'cancel', 'close': 'cancel'
        };
        const resolved = (Number.isInteger(n) && n >= 1 && n <= MENU_ACTIONS.length) ? MENU_ACTIONS[n - 1] : actionAliases[text];
        if (!resolved) return false;
        // Typed numbers: the person who asked for the menu, or the owner (who cannot tap their own account's buttons).
        const candidates = [...rt.musicMenus.values()].filter(p => p.chat === ctx.chat && (ctx.isOwner || sameUser(p, ctx)) && !p.used && Date.now() < p.expiresAt);
        if (!candidates.length || (candidates.length > 1 && !ctx.isOwner)) return false;
        pendingId = candidates[candidates.length - 1].id; // newest open menu
        action = resolved;
      }

      const pending = rt.musicMenus.get(pendingId);
      if (!pending || pending.used || Date.now() > pending.expiresAt) { if (pending) rt.musicMenus.delete(pendingId); return false; }
      if (pending.chat !== ctx.chat) return false; // a button tap from another chat is not ours to act on
      // Buttons are open to everyone in the chat: whoever taps first gets their choice (menus are one-time use).

      pending.used = true; // one-time use: a duplicate/replayed selection can never run twice
      rt.musicMenus.delete(pendingId);

      if (action === 'cancel') { await ctx.reply('❌ Cancelled.'); return true; }

      await ctx.react('⏳');
      try {
        if (action === 'play') {
          const r = await music.getAudio(pending.query, { cookies: cookies(ctx) });
          await ctx.audio(r.buffer, false, U.audioMime(r.ext));
        } else if (action === 'doc') {
          const r = await music.getAudio(pending.query, { cookies: cookies(ctx) });
          await ctx.doc(r.buffer, mp3Name(r.title, r.ext), U.audioMime(r.ext));
        } else if (action === 'video') {
          const url = await resolveVideoUrl(pending.query);
          const r = await U.ytDownload(url, 'video', { cookies: cookies(ctx) });
          await ctx.video(r.buffer, `🎬 ${r.title}`.slice(0, 200));
        }
        await ctx.react('✅');
      } catch (e) {
        await ctx.react('❌');
        await ctx.reply(e instanceof UserError ? '⚠️ ' + e.message : `❌ Could not complete that: ${String(e?.message || e).slice(0, 200)}`).catch(() => {});
      }
      return true;
    }
  });
  def('yta', { cat: 'download', heavy: true, usage: 'yta <youtube link>', desc: 'YouTube link → MP3.' }, async ctx => {
    const url = U.findUrl(ctx.input());
    if (!url) throw new UserError('Send a YouTube link.');
    const r = await U.ytDownload(url, 'audio', { cookies: cookies(ctx) });
    await ctx.audio(r.buffer, false, U.audioMime(r.ext));
  });
  def('ytv', { cat: 'download', heavy: true, usage: 'ytv <youtube link>', desc: 'YouTube link → video.' }, async ctx => {
    const url = U.findUrl(ctx.input());
    if (!url) throw new UserError('Send a YouTube link.');
    const r = await U.ytDownload(url, 'video', { cookies: cookies(ctx) });
    await ctx.video(r.buffer, `🎬 ${r.title}`.slice(0, 200));
  });

  def('spotify', { cat: 'download', heavy: true, usage: 'spotify <track link or name>', desc: 'Send a Spotify track as MP3 (matched on YouTube).' }, async ctx => {
    const a = ctx.input().trim();
    if (!a) throw new UserError('Give a Spotify track link or a song name.');
    let query = a;
    const link = U.findUrl(a);
    if (link) {
      if (!/spotify\.com|spotify\.link/i.test(link)) throw new UserError('That is not a Spotify link.');
      const o = await U.getJson('https://open.spotify.com/oembed?url=' + encodeURIComponent(link));
      query = o.title;
    }
    const [v] = await U.ytSearch(query + ' audio', 1);
    if (!v) throw new UserError('Could not find that track.');
    await ctx.send({ image: { url: v.thumb }, caption: `🎧 ${query}\n${v.url}` }, { quoted: ctx.msg }).catch(() => {});
    const r = await U.ytDownload(v.url, 'audio', { cookies: cookies(ctx) });
    await ctx.audio(r.buffer, false, U.audioMime(r.ext));
  });

  /* Screenshots */
  const shot = (url, full) => U.http(`https://image.thum.io/get/width/1280/${full ? 'fullpage' : 'crop/720'}/noanimate/${url}`, { timeout: 60000 });
  const normUrl = a => { const u = U.findUrl(a) || (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(a.trim()) ? 'https://' + a.trim() : null); if (!u) throw new UserError('Send a website link, e.g. *https://example.com*'); return u; };
  // Primary name is 'screenshot' (not 'ss') so that .ss is free for "save status" — see commands/whatsapp.js.
  def('screenshot', { cat: 'download', heavy: true, usage: 'screenshot <website>', desc: 'Screenshot of a website.' }, async ctx => ctx.image(await shot(normUrl(ctx.input()), false), '📸 Screenshot'));
  def('fulls', { cat: 'download', heavy: true, usage: 'fulls <website>', desc: 'Full-page screenshot of a website.' }, async ctx => ctx.doc(await shot(normUrl(ctx.input()), true), 'fullpage.png', 'image/png', { caption: '📸 Full page' }));
  module.exports.shot = shot;

  def('upload', { cat: 'download', heavy: true, usage: 'upload <direct file link>', desc: 'Download a file from a direct link and send it here.' }, async ctx => {
    const url = U.findUrl(ctx.input());
    if (!url) throw new UserError('Send a direct file link.');
    const f = await U.download(url, { maxBytes: U.maxDownloadBytes() });
    const major = f.mime.split('/')[0];
    if (major === 'image') return ctx.image(f.buffer, f.name);
    if (major === 'video') return ctx.video(f.buffer, f.name);
    if (major === 'audio') return ctx.audio(f.buffer, false, f.mime);
    await ctx.doc(f.buffer, f.name, f.mime || 'application/octet-stream');
  });

  def('mediafire', { cat: 'download', heavy: true, usage: 'mediafire <link>', desc: 'Download a MediaFire file.' }, async ctx => {
    const url = U.findUrl(ctx.input());
    if (!url || !/mediafire\.com/i.test(url)) throw new UserError('Send a MediaFire link.');
    const html = await U.getText(url);
    const direct = (html.match(/href="(https?:\/\/download[^"]+)"/i) || html.match(/aria-label="Download file"[^>]*href="([^"]+)"/i) || [])[1];
    if (!direct) throw new UserError('Could not find the download link (the file may have been removed).');
    const f = await U.download(direct.replace(/&amp;/g, '&'), { maxBytes: U.maxDownloadBytes() });
    await ctx.doc(f.buffer, f.name, f.mime || 'application/octet-stream', { caption: `📁 ${f.name} (${U.fmtBytes(f.buffer.length)})` });
  });

  def('apk', { cat: 'download', heavy: true, usage: 'apk <app name> • apk <number from apksearch>', desc: 'Find an Android app in several sources (Aptoide, F-Droid, GitHub) and send the APK. Falls back to the next source if one fails.' }, async ctx => {
    await require('../lib/appflow').apkCommand(ctx);
  });
};
