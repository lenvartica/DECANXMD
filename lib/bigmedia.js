'use strict';
/**
 * Big-file media helpers (v1.2.0): everything here works on files on disk and streams to/from WhatsApp, so a 700 MB video does not
 * have to fit in memory. Limits are configurable from the environment (or the dashboard "Environment" page):
 *   MAX_VIDEO_MB        biggest video/reel/clip fetched by .video .insta .fb .tiktok …   (default 700)
 *   MAX_MOVIE_MB        biggest movie/drama/cartoon file                                  (default 1500)
 *   MAX_MOVIE_MINUTES   longest movie/episode yt-dlp will fetch                           (default 300)
 *   MAX_APK_MB          biggest APK                                                       (default 400)
 *   MAX_INLINE_VIDEO_MB videos above this are sent as documents (WhatsApp plays small ones inline)  (default 64)
 */
const fs = require('fs');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const U = require('./util');
const { UserError } = U;

const MB = 1024 * 1024;
const limits = () => ({
  video: U.envNum('MAX_VIDEO_MB', 700), movie: U.envNum('MAX_MOVIE_MB', 1500), movieMinutes: U.envNum('MAX_MOVIE_MINUTES', 300),
  apk: U.envNum('MAX_APK_MB', 400), inline: U.envNum('MAX_INLINE_VIDEO_MB', 64)
});

const safeName = (s, fallback = 'file') => String(s || fallback).replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || fallback;
const IMG = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const AUD = new Set(['mp3', 'm4a', 'opus', 'ogg', 'aac', 'wav']);

/** Stream a URL to a file on disk (with a hard byte cap). Returns { path, size, name, mime, cleanup() }. */
async function downloadToFile(url, { maxBytes = limits().video * MB, headers = {}, timeout = 30 * 60 * 1000, ext = '' } = {}) {
  const dir = U.tmp(); fs.mkdirSync(dir, { recursive: true });
  const cleanup = () => U.rm(dir);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    let res;
    try { res = await fetch(url, { headers: { 'user-agent': U.UA, ...headers }, redirect: 'follow', signal: ac.signal }); }
    catch (e) { clearTimeout(timer); throw U.netError ? U.netError(url, e) : e; }
    if (!res.ok || !res.body) { clearTimeout(timer); throw new UserError(`The download server answered ${res.status}.`); }
    const len = Number(res.headers.get('content-length')) || 0;
    if (len && len > maxBytes) { clearTimeout(timer); ac.abort(); throw new UserError(`That file is ${U.fmtBytes(len)}, over the limit of ${U.fmtBytes(maxBytes)}.`); }
    const cd = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(res.headers.get('content-disposition') || '');
    let name = cd ? decodeURIComponent(cd[1]) : decodeURIComponent(path.basename(new URL(res.url || url).pathname) || 'file');
    if (ext && !path.extname(name)) name += '.' + ext;
    const file = path.join(dir, safeName(name));
    let got = 0;
    const cap = new Transform({ transform(chunk, _e, cb) { got += chunk.length; cb(got > maxBytes ? new UserError(`That file is over the limit of ${U.fmtBytes(maxBytes)}.`) : null, chunk); } });
    try { await pipeline(Readable.fromWeb(res.body), cap, fs.createWriteStream(file)); }
    finally { clearTimeout(timer); }
    return { path: file, size: got, name: path.basename(file), mime: res.headers.get('content-type') || '', cleanup };
  } catch (e) { cleanup(); throw e; }
}

/**
 * yt-dlp to a file on disk. Returns { items:[{path,ext,size}], title, duration, cleanup() }.
 * quality = max height (360/480/720/1080/…); minutes/maxMb override the usual media limits.
 */
async function fetchVideo(target, { quality = 720, maxMb = limits().video, maxMinutes = U.maxMediaMinutes(), cookies, playlist = null, timeout = 30 * 60 * 1000 } = {}) {
  const dir = U.tmp(); fs.mkdirSync(dir, { recursive: true });
  const cleanup = () => U.rm(dir);
  try {
    const h = Math.max(144, Math.min(2160, Number(quality) || 720));
    const args = ['--match-filter', `duration<=?${maxMinutes * 60}`, '--max-filesize', `${maxMb}M`, '-o', path.join(dir, 'out.%(autonumber)s.%(ext)s'),
      '--print', 'after_move:%(title)s|||%(duration)s', '--no-part',
      '-f', U.videoFormat(h)];
    if (U.hasFfmpeg()) args.push('--merge-output-format', 'mp4');
    if (playlist) args.push('--yes-playlist', '--playlist-items', playlist);
    args.push(target);
    const { out } = await U.ytdlp(args, { cookies, timeout });
    const files = fs.readdirSync(dir).filter(f => f.startsWith('out.') && !/\.(part|ytdl|temp)$/i.test(f)).sort();
    if (!files.length) throw new UserError(`Nothing was downloaded. The file may be over ${maxMb} MB, longer than ${maxMinutes} minutes, or unavailable.`);
    const last = out.trim().split('\n').filter(l => l.includes('|||')).pop() || '';
    const [title, duration] = last.split('|||');
    const items = files.map(f => { const p = path.join(dir, f); return { path: p, ext: path.extname(f).slice(1).toLowerCase(), size: fs.statSync(p).size }; });
    return { items, title: title || 'media', duration: Number(duration) || 0, cleanup };
  } catch (e) { cleanup(); throw e; }
}

/**
 * Send downloaded items to the chat from disk. Videos go out as normal videos when small, as documents when large (or asDoc).
 * Returns the number of items sent.
 */
async function sendItems(ctx, r, { caption = '', asDoc = false, name } = {}) {
  const cap = limits().inline * MB;
  let n = 0;
  for (const it of r.items.slice(0, 10)) {
    const src = { url: it.path };
    const label = safeName(name || r.title, 'media');
    if (IMG.has(it.ext)) await ctx.image(src, caption);
    else if (AUD.has(it.ext)) await ctx.audio(src, false, U.audioMime(it.ext));
    else if (asDoc || it.size > cap) await ctx.doc(src, `${label}${r.items.length > 1 ? ` ${n + 1}` : ''}.${it.ext || 'mp4'}`, it.ext === 'mp4' ? 'video/mp4' : 'application/octet-stream', { caption: `${caption}\n💾 ${U.fmtBytes(it.size)}`.trim() });
    else await ctx.video(src, caption);
    n++;
  }
  return n;
}

/** Send one file path as a document. */
async function sendDoc(ctx, filePath, fileName, mime, caption) {
  await ctx.doc({ url: filePath }, fileName, mime || 'application/octet-stream', caption ? { caption } : {});
}

module.exports = { limits, safeName, downloadToFile, fetchVideo, sendItems, sendDoc, MB };
