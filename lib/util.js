'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
/** Work folder. Hosting panels often mount the system temp dir read-only / noexec, so prefer a folder inside the bot itself. */
function pickTmp() {
  const cands = [process.env.BOT_TMP, path.join(ROOT, '.tmp'), path.join(process.cwd(), '.tmp'), path.join(os.tmpdir(), 'tanda'), path.join(os.homedir?.() || ROOT, '.decan-tmp')].filter(Boolean);
  for (const d of cands) {
    try {
      fs.mkdirSync(d, { recursive: true });
      const probe = path.join(d, `.w${process.pid}`);
      fs.writeFileSync(probe, 'ok'); fs.rmSync(probe, { force: true });
      return d;
    } catch { /* try the next one */ }
  }
  return os.tmpdir();
}
const TMP = pickTmp();
// Child programs (yt-dlp's self-extracting build, ffmpeg) also use this folder for their scratch files.
process.env.TMPDIR = process.env.TMP = process.env.TEMP = TMP;

/** Error whose message is safe to show to the WhatsApp user as-is. */
class UserError extends Error {}

/* ---------------------------- lazy heavy deps --------------------------- */
const lazy = name => { let m; return () => (m ||= require(name)); };
const sharp = lazy('sharp');
let ffBin;
/** Working ffmpeg: ffmpeg-static if its binary really exists (panels often skip its download step), else the system ffmpeg, else null. */
function findFfmpeg() {
  if (ffBin !== undefined) return ffBin;
  const cands = [process.env.FFMPEG_PATH];
  try { cands.push(require('ffmpeg-static')); } catch {}
  cands.push('ffmpeg');
  for (const c of cands.filter(Boolean)) {
    try {
      if (c !== 'ffmpeg' && !fs.existsSync(c)) continue;
      if (c !== 'ffmpeg' && process.platform !== 'win32') { try { fs.chmodSync(c, 0o755); } catch {} }
      const r = require('child_process').spawnSync(c, ['-version'], { timeout: 15000, stdio: 'ignore', env: process.env });
      if (!r.error && r.status === 0) return (ffBin = c);
    } catch {}
  }
  return (ffBin = null);
}
const hasFfmpeg = () => Boolean(findFfmpeg());
const ffmpegBin = () => findFfmpeg() || 'ffmpeg';

/* ------------------------------- text ----------------------------------- */
function bold(s) {
  return [...String(s)].map(c => {
    const k = c.codePointAt(0);
    if (k >= 65 && k <= 90) return String.fromCodePoint(0x1D5D4 + k - 65);
    if (k >= 97 && k <= 122) return String.fromCodePoint(0x1D5EE + k - 97);
    if (k >= 48 && k <= 57) return String.fromCodePoint(0x1D7EC + k - 48);
    return c;
  }).join('');
}
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escXml = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pick = a => a[Math.floor(Math.random() * a.length)];
const isUrl = s => /^https?:\/\/\S+$/i.test(String(s || '').trim());
const findUrl = s => (String(s || '').match(/https?:\/\/[^\s]+/i) || [])[0];
const fmtBytes = n => n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1e3).toFixed(0) + ' KB';
function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return [d && d + 'd', (d || h) && h + 'h', (d || h || m) && m + 'm', s + 's'].filter(Boolean).join(' ');
}

/* ------------------------------- time ----------------------------------- */
function tzParts(tz, d = new Date()) {
  let f;
  try {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long' });
  } catch {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long' });
  }
  const o = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return {
    h: o.hour, mi: o.minute, s: o.second, weekday: o.weekday,
    date: `${o.day}/${o.month}/${o.year}`, time: `${o.hour}:${o.minute}`, iso: `${o.year}-${o.month}-${o.day}`
  };
}
function nextClock(tz, hh, mm) {
  const now = Date.now();
  const p = tzParts(tz, new Date(now));
  let diff = (hh * 60 + mm) - (Number(p.h) * 60 + Number(p.mi));
  if (diff <= 0) diff += 1440;
  return now + diff * 60000 - Number(p.s) * 1000;
}
/** "1h30m", "45s", "10m", "2d" -> ms (or null) */
function parseDuration(s) {
  const re = /(\d+(?:\.\d+)?)\s*(d|h|m|s)/gi;
  let ms = 0, any = false, m;
  while ((m = re.exec(s))) { any = true; ms += Number(m[1]) * { d: 864e5, h: 36e5, m: 6e4, s: 1e3 }[m[2].toLowerCase()]; }
  return any ? ms : null;
}
/** "10", "1:30", "00:01:30" -> seconds */
function parseTs(s) {
  if (s == null || s === '') return null;
  const parts = String(s).split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((a, b) => a * 60 + b, 0);
}

/* ------------------------------- http ----------------------------------- */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
/** Limits are owner-tunable from .env / the dashboard (v1.2.0): MAX_DOWNLOAD_MB, MAX_MEDIA_MINUTES, MAX_MEDIA_MB. */
/** [██████░░░░] 63% — `pct` is clamped to 0-100, `width` segments. */
function progressBar(pct, width = 10) {
  const p = Math.max(0, Math.min(100, Number.isFinite(+pct) ? Math.round(+pct) : 0));
  const full = Math.round(p / 100 * width);
  return `[${'█'.repeat(full)}${'░'.repeat(width - full)}] ${p}%`;
}
const envNum = (k, d) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };
const maxDownloadBytes = () => envNum('MAX_DOWNLOAD_MB', 150) * 1024 * 1024;
const maxMediaMinutes = () => envNum('MAX_MEDIA_MINUTES', 60);
const maxMediaMb = () => envNum('MAX_MEDIA_MB', 100);

/** Turns undici's bare "fetch failed" into something a person (and the owner reading logs) can act on. */
function netError(url, e) {
  let host = 'the server'; try { host = new URL(url).hostname; } catch {}
  const code = e?.cause?.code || e?.code || '';
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT') return new Error(`Timed out waiting for ${host}`);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new Error(`Could not find ${host} (DNS/network problem on the bot's host)`);
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE') return new Error(`Connection to ${host} was refused or dropped (${code})`);
  if (/CERT|SSL|TLS/i.test(code)) return new Error(`Secure connection to ${host} failed (${code})`);
  return new Error(`Network error talking to ${host}${code ? ' (' + code + ')' : ''}`);
}
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
async function http(url, o = {}) {
  const { method = 'GET', headers = {}, body, timeout = 30000, maxBytes = maxDownloadBytes(), as = 'buffer', retries = method === 'GET' ? 1 : 0 } = o;
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url, { method, headers: { 'user-agent': UA, ...headers }, body, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
    } catch (e) {
      if (attempt < retries) { await sleep(600 * (attempt + 1)); continue; }
      throw netError(url, e);
    }
    if (!res.ok && RETRYABLE.has(res.status) && attempt < retries) { try { await res.arrayBuffer(); } catch {} await sleep(800 * (attempt + 1)); continue; }
    break;
  }
  if (!res.ok) {
    let extra = '';
    try { extra = (await res.text()).slice(0, 160).replace(/\s+/g, ' '); } catch {}
    throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}${extra ? ' - ' + extra : ''}`);
  }
  if (as === 'response') return res;
  if (as === 'json') return res.json();
  if (as === 'text') return res.text();
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw new UserError(`File is too large (${fmtBytes(len)}).`);
  const ab = await res.arrayBuffer();
  if (ab.byteLength > maxBytes) throw new UserError(`File is too large (${fmtBytes(ab.byteLength)}).`);
  return Buffer.from(ab);
}
const getJson = (u, o) => http(u, { ...o, as: 'json' });
const getText = (u, o) => http(u, { ...o, as: 'text' });
async function download(url, o = {}) {
  const res = await http(url, { ...o, as: 'response' });
  const len = Number(res.headers.get('content-length') || 0);
  const max = o.maxBytes || maxDownloadBytes();
  if (len > max) throw new UserError(`File is too large (${fmtBytes(len)}).`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > max) throw new UserError(`File is too large (${fmtBytes(buffer.length)}).`);
  const cd = res.headers.get('content-disposition') || '';
  const name = (cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i) || [])[1] || decodeURIComponent(new URL(res.url).pathname.split('/').pop() || 'file');
  return { buffer, mime: (res.headers.get('content-type') || '').split(';')[0], name };
}

/* ------------------------------ processes ------------------------------- */
function run(cmd, args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: TMP, TMP, TEMP: TMP } });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('Process timed out')); }, timeout);
    p.stdout.on('data', d => { out += d; if (out.length > 2e6) out = out.slice(-1e6); });
    p.stderr.on('data', d => { err += d; if (err.length > 4e4) err = err.slice(-2e4); });
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => {
      clearTimeout(t);
      if (code === 0) resolve({ out, err });
      else reject(new Error((err.trim().split('\n').slice(-3).join(' ') || `exit code ${code}`).slice(0, 400)));
    });
  });
}
const tmp = ext => path.join(TMP, crypto.randomBytes(8).toString('hex') + (ext ? '.' + ext : ''));
const rm = (...fs_) => { for (const f of fs_) { try { fs.rmSync(f, { recursive: true, force: true }); } catch {} } };
const ffmpeg = (args, o) => run(ffmpegBin(), ['-y', '-hide_banner', '-loglevel', 'error', ...args], { timeout: 240000, ...o });

/** Run ffmpeg on a buffer. args may be an array or a function(inPath,outPath)->array */
async function ff(buffer, { inExt = 'bin', outExt = 'mp4', args = [] }) {
  const i = tmp(inExt), o = tmp(outExt);
  fs.writeFileSync(i, buffer);
  try {
    await ffmpeg(typeof args === 'function' ? args(i, o) : ['-i', i, ...args, o]);
    const out = fs.readFileSync(o);
    if (!out.length) throw new Error('Conversion produced an empty file');
    return out;
  } finally { rm(i, o); }
}

/* ------------------------------- stickers ------------------------------- */
async function imageToWebp(buf, { crop = false, circle = false } = {}) {
  const s = sharp();
  let img = s(buf).rotate();
  img = crop
    ? img.resize(512, 512, { fit: 'cover' })
    : img.resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (circle) {
    const mask = Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="256" fill="#fff"/></svg>');
    img = s(await img.ensureAlpha().png().toBuffer()).composite([{ input: mask, blend: 'dest-in' }]);
  }
  return img.webp({ quality: 80 }).toBuffer();
}
function videoToWebp(buf, inExt = 'mp4') {
  return ff(buf, {
    inExt, outExt: 'webp',
    args: ['-vcodec', 'libwebp', '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=0x00000000,format=rgba',
      '-loop', '0', '-t', '8', '-an', '-lossless', '0', '-q:v', '45', '-compression_level', '6']
  });
}
async function withExif(webp, pack, author, packId = crypto.randomBytes(16).toString('hex')) {
  const { Image } = require('node-webpmux');
  const img = new Image();
  await img.load(webp);
  const json = { 'sticker-pack-id': packId, 'sticker-pack-name': pack, 'sticker-pack-publisher': author, emojis: ['✨'] };
  const head = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
  const jb = Buffer.from(JSON.stringify(json), 'utf8');
  const exif = Buffer.concat([head, jb]);
  exif.writeUIntLE(jb.length, 14, 4);
  img.exif = exif;
  return img.save(null);
}
async function readExif(webp) {
  const { Image } = require('node-webpmux');
  const img = new Image();
  await img.load(webp);
  if (!img.exif) return null;
  const s = img.exif.toString('utf8');
  const i = s.indexOf('{');
  if (i < 0) return null;
  try { return JSON.parse(s.slice(i)); } catch { return null; }
}
async function webpToMp4(buf) {
  const s = sharp();
  const meta = await s(buf, { animated: true }).metadata();
  const pages = meta.pages || 1;
  const dir = tmp();
  fs.mkdirSync(dir, { recursive: true });
  try {
    const frames = Math.min(pages, 150);
    for (let i = 0; i < frames; i++) {
      const png = await s(buf, { page: i, pages: 1 }).flatten({ background: '#ffffff' }).png().toBuffer();
      fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, '0')}.png`), png);
    }
    const delay = Array.isArray(meta.delay) && meta.delay[0] > 0 ? meta.delay[0] : 100;
    const fps = frames > 1 ? Math.min(30, Math.max(1, 1000 / delay)) : 1;
    const out = tmp('mp4');
    const loops = frames > 1 ? 1 : 3;
    const args = ['-framerate', String(fps), '-i', path.join(dir, 'f%04d.png'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-movflags', '+faststart'];
    if (frames === 1) args.splice(0, 0, '-loop', '1'), args.push('-t', String(loops));
    await ffmpeg([...args, out]);
    const r = fs.readFileSync(out);
    rm(out);
    return r;
  } finally { rm(dir); }
}

/* ----------------------------- yt-dlp / YouTube ------------------------- */
const YTDLP_PATH = path.join(TMP, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const YTDLP_PY = path.join(TMP, 'yt-dlp.pyz');
let ytReady = null;
let ytRunner = null;          // { cmd, pre:[args before yt-dlp's own], managed:boolean, file }
let ytRefreshedAt = 0;
let ytNoJs = false;           // set when the installed yt-dlp is too old to know --js-runtimes
function ytDlpAsset() {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'yt-dlp_linux_aarch64';
  if (process.platform === 'linux' && process.arch === 'arm') return 'yt-dlp_linux_armv7l';
  if (process.platform === 'linux' && process.arch === 'x64') return 'yt-dlp_linux';
  return null;
}
function validYtDlp(file, minSize = 0) {
  try { const stat = fs.statSync(file); return stat.isFile() && stat.size > minSize; }
  catch { return false; }
}
/** Does `cmd [pre] --version` run and print a yt-dlp version? */
function probeYt(cmd, pre = []) {
  try {
    const r = require('child_process').spawnSync(cmd, [...pre, '--version'], { timeout: 120000, encoding: 'utf8', env: { ...process.env, TMPDIR: TMP, TMP, TEMP: TMP } });
    if (r.error) return { ok: false, why: r.error.code || r.error.message };
    if (r.status === 0 && /^\d{4}\.\d{1,2}\.\d{1,2}/.test(String(r.stdout).trim())) return { ok: true, version: String(r.stdout).trim() };
    return { ok: false, why: String(r.stderr || r.stdout || `exit ${r.status}`).trim().split('\n').slice(-2).join(' ').slice(0, 200) };
  } catch (e) { return { ok: false, why: e.message }; }
}
async function fetchYtAsset(asset, dest) {
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
  const b = await http(url, { timeout: 240000, maxBytes: 250e6 });
  if (!b || b.length < 500 * 1024) throw new Error('The downloaded yt-dlp file is incomplete.');
  const partial = `${dest}.download`;
  try {
    fs.writeFileSync(partial, b, { mode: 0o755 });
    fs.renameSync(partial, dest);
  } finally { rm(partial); }
  if (process.platform !== 'win32') { try { fs.chmodSync(dest, 0o755); } catch {} }
}
function findPython() {
  for (const py of [process.env.PYTHON, 'python3', 'python'].filter(Boolean)) {
    try {
      const r = require('child_process').spawnSync(py, ['-c', 'import sys;print(sys.version_info[0]*100+sys.version_info[1])'], { timeout: 10000, encoding: 'utf8' });
      if (!r.error && r.status === 0 && Number(String(r.stdout).trim()) >= 309) return py;
    } catch {}
  }
  return null;
}
/**
 * Finds (or installs) a yt-dlp that actually RUNS on this host and remembers how to call it.
 * Order: YTDLP_PATH -> yt-dlp on PATH -> downloaded stand-alone build -> downloaded python build (panels where the
 * stand-alone binary cannot start: noexec temp folder, musl/Alpine, old glibc). `refresh` forces a fresh download.
 */
function ensureYtDlp({ refresh = false } = {}) {
  if (process.env.YTDLP_PATH) {
    if (!validYtDlp(process.env.YTDLP_PATH)) return Promise.reject(new UserError(`YTDLP_PATH does not point to an existing file: ${process.env.YTDLP_PATH}`));
    ytRunner = { cmd: process.env.YTDLP_PATH, pre: [], managed: false };
    return Promise.resolve(process.env.YTDLP_PATH);
  }
  if (ytReady && !refresh) return ytReady;
  ytReady = (async () => {
    const tried = [];
    const use = (cmd, pre, managed, file) => { ytRunner = { cmd, pre, managed, file }; return cmd; };
    if (!refresh) {
      const sys = probeYt('yt-dlp');
      if (sys.ok) return use('yt-dlp', [], false);
      tried.push(`PATH: ${sys.why}`);
    }
    const asset = ytDlpAsset();
    if (asset) {
      if (refresh) rm(YTDLP_PATH);
      if (!validYtDlp(YTDLP_PATH, 500 * 1024)) { rm(YTDLP_PATH); await fetchYtAsset(asset, YTDLP_PATH); }
      const t = probeYt(YTDLP_PATH);
      if (t.ok) return use(YTDLP_PATH, [], true, YTDLP_PATH);
      tried.push(`binary: ${t.why}`);
      rm(YTDLP_PATH);
    }
    const py = findPython();
    if (py) {
      if (refresh) rm(YTDLP_PY);
      if (!validYtDlp(YTDLP_PY, 500 * 1024)) { rm(YTDLP_PY); await fetchYtAsset('yt-dlp', YTDLP_PY); }
      const t = probeYt(py, [YTDLP_PY]);
      if (t.ok) return use(py, [YTDLP_PY], true, YTDLP_PY);
      tried.push(`python: ${t.why}`);
    } else tried.push('python 3.9+ not found');
    throw new Error(tried.join(' | '));
  })().catch(e => {
    ytReady = null; ytRunner = null;
    throw new UserError('The downloader engine (yt-dlp) could not start on this host (' + String(e.message).slice(0, 260) + '). Owner: install yt-dlp on the panel (pip install -U yt-dlp) or set YTDLP_PATH, then try again.');
  });
  return ytReady;
}
async function runYtDlp(args, timeout) {
  await ensureYtDlp();
  try { return await run(ytRunner.cmd, [...ytRunner.pre, ...args], { timeout }); }
  catch (e) {
    if ((e.code === 'ENOENT' || e.code === 'EACCES') && !process.env.YTDLP_PATH) {
      await ensureYtDlp({ refresh: true });
      return run(ytRunner.cmd, [...ytRunner.pre, ...args], { timeout });
    }
    throw e;
  }
}
const cleanYtMsg = m => String(m || '').replace(/^ERROR:\s*/i, '').replace(/\[[\w:+-]+\]\s*[\w-]*:?\s*/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
async function ytdlp(args, { cookies, timeout = 240000, fast = false } = {}) {
  await ensureYtDlp();
  const base = () => {
    const b = ['--no-warnings', '--no-playlist', '--socket-timeout', fast ? '8' : '20', '--retries', fast ? '0' : '2'];
    const ff = findFfmpeg();
    if (ff && path.isAbsolute(ff)) b.push('--ffmpeg-location', ff);
    // yt-dlp >= 2025.11 needs a JavaScript runtime to solve YouTube's challenges. This bot already runs on Node, so lend it.
    if (!ytNoJs && !process.env.YTDLP_NO_JS) b.push('--js-runtimes', `node:${process.execPath}`);
    return b;
  };
  let cf;
  if (cookies) { cf = tmp('txt'); fs.writeFileSync(cf, cookies); }
  const go = async extra => {
    const b = base();
    if (cf) b.push('--cookies', cf);
    try { return await runYtDlp([...b, ...extra, ...args], timeout); }
    catch (e) {
      if (/no such option.*js-runtimes|js-runtimes.*(no such|unrecognized)/i.test(String(e.message)) && !ytNoJs) { ytNoJs = true; return go(extra); }
      throw e;
    }
  };
  const stale = e => /Unable to extract|nsig|n challenge|Signature|player response|Requested format is not available|HTTP Error 40[04]|Precondition|update yt-dlp|Only images are available/i.test(String(e.message));
  try {
    try { return await go([]); }
    catch (e) {
      const msg = String(e.message);
      // YouTube bot check: retry once with other player clients, which often works without cookies
      if (!fast && /Sign in to confirm|not a bot/i.test(msg) && !args.includes('--extractor-args')) {
        return await go(['--extractor-args', 'youtube:player_client=tv,mweb,web_safari']);
      }
      // Site changed since this yt-dlp was released: fetch a fresh copy (at most once every 3 hours) and retry.
      if (!fast && stale(e) && ytRunner?.managed && Date.now() - ytRefreshedAt > 3 * 3600e3) {
        ytRefreshedAt = Date.now();
        await ensureYtDlp({ refresh: true });
        return await go([]);
      }
      throw e;
    }
  } catch (e) {
    const m = String(e.message);
    if (e instanceof UserError) throw e;
    if (e.code === 'ENOENT' || e.code === 'EACCES' || e.code === 'ENOEXEC') throw new UserError('The downloader engine could not be started on this host. Owner: install yt-dlp (pip install -U yt-dlp) or set YTDLP_PATH.');
    if (/ffmpeg|ffprobe/i.test(m) && /not found|not installed|No such file/i.test(m)) throw new UserError('ffmpeg is missing on this host. Owner: run npm install again (ffmpeg-static), or install ffmpeg / set FFMPEG_PATH.');
    if (/Sign in to confirm|not a bot|login required|cookies/i.test(m)) throw new UserError('The site asked for a login/bot check, even after an automatic retry. Try again later or another link. Owner: send fresh browser cookies with .ytlogin.');
    if (/Unsupported URL/i.test(m)) throw new UserError('That link is not supported.');
    if (/Private|unavailable|not available|removed|deleted/i.test(m)) throw new UserError('That media is unavailable or private.');
    if (/does not pass filter|duration/i.test(m)) throw new UserError(`That media is too long (limit is ${maxMediaMinutes()} minutes; the owner can raise MAX_MEDIA_MINUTES).`);
    if (/timed out|ETIMEDOUT|Temporary failure|Name or service not known|Network is unreachable|Connection (refused|reset)|getaddrinfo/i.test(m)) throw new UserError('Could not reach the site from this server (network problem or timeout). Try again in a moment.');
    throw new UserError('Download failed: ' + (cleanYtMsg(m) || 'unknown error') + '. Try again, or try another link.');
  } finally { if (cf) rm(cf); }
}
/** WhatsApp mimetype for an audio file extension. */
const audioMime = ext => ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg; codecs=opus', opus: 'audio/ogg; codecs=opus', wav: 'audio/wav' }[String(ext || '').toLowerCase()] || 'audio/mpeg');
/** yt-dlp format selector for video up to `h` pixels high. Without ffmpeg only ready-made single files can be used. */
function videoFormat(h) {
  return hasFfmpeg()
    ? `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]/b[height<=${h}][ext=mp4]/bv*[height<=${h}]+ba/b[height<=${h}]/b`
    : `b[height<=${h}][ext=mp4]/b[ext=mp4]/b[height<=${h}]/b`;
}
/** Download via yt-dlp. kind: 'audio' | 'video'. Returns { buffer, ext, title, duration, file } */
async function ytDownload(target, kind, { cookies, maxMb = maxMediaMb(), playlist = null, fast = false } = {}) {
  const dir = tmp();
  fs.mkdirSync(dir, { recursive: true });
  try {
    const tpl = path.join(dir, 'out.%(ext)s');
    const args = ['--match-filter', `duration<=?${maxMediaMinutes() * 60}`, '--max-filesize', `${maxMb}M`, '-o', tpl, '--print', 'after_move:%(title)s|||%(duration)s'];
    if (playlist) args.push('--yes-playlist', '--playlist-items', playlist); // later flag wins over the --no-playlist default
    if (kind === 'audio') {
      if (hasFfmpeg()) args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', fast ? '7' : '5');
      else args.push('-f', 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best'); // no ffmpeg: send the original audio stream as it is
    } else {
      args.push('-f', videoFormat(480));
      if (hasFfmpeg()) args.push('--merge-output-format', 'mp4');
    }
    args.push(target);
    const { out } = await ytdlp(args, { cookies, fast, timeout: fast ? 90000 : 240000 });
    const files = fs.readdirSync(dir).filter(f => f.startsWith('out.') && !/\.(part|ytdl|temp)$/i.test(f)).sort();
    if (!files.length) throw new UserError('Nothing was downloaded (file may be too large, too long or unavailable).');
    const last = out.trim().split('\n').filter(l => l.includes('|||')).pop() || '';
    const [title, duration] = last.split('|||');
    const items = files.map(f => ({ file: f, ext: path.extname(f).slice(1).toLowerCase(), buffer: fs.readFileSync(path.join(dir, f)) }));
    return { ...items[0], items, title: title || 'media', duration: Number(duration) || 0 };
  } finally { rm(dir); }
}
async function ytSearch(q, n = 5, { timeout = 30000, retries = 1, fallback = true, fallbackTimeout = 25000 } = {}) {
  try {
    const html = await getText('https://www.youtube.com/results?hl=en&search_query=' + encodeURIComponent(q), { timeout, retries, headers: { 'accept-language': 'en-US,en;q=0.9' } });
    const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
    if (!m) throw new Error('no data');
    const data = JSON.parse(m[1]);
    const sections = data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
    const vids = sections.flatMap(c => c.itemSectionRenderer?.contents || []).filter(i => i.videoRenderer).map(i => i.videoRenderer);
    const res = vids.slice(0, n).map(v => ({
      id: v.videoId, title: v.title?.runs?.[0]?.text || 'Untitled', duration: v.lengthText?.simpleText || 'LIVE',
      views: v.viewCountText?.simpleText || '', channel: v.ownerText?.runs?.[0]?.text || '', published: v.publishedTimeText?.simpleText || '',
      url: 'https://www.youtube.com/watch?v=' + v.videoId, thumb: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
    }));
    if (res.length) return res;
  } catch {}
  if (!fallback) return [];
  const { out } = await ytdlp(['--flat-playlist', '--dump-json', `ytsearch${n}:${q}`], { timeout: fallbackTimeout, fast: true });
  return out.trim().split('\n').filter(Boolean).flatMap(l => {
    try {
      const v = JSON.parse(l);
      if (!v.id || !v.title) return [];
      const secs = Number(v.duration) || 0;
      return [{ id: v.id, title: v.title, duration: secs ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '', views: v.view_count ? String(v.view_count) : '', channel: v.channel || v.uploader || '', published: '', url: 'https://www.youtube.com/watch?v=' + v.id, thumb: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` }];
    } catch { return []; }
  });
}

/* -------------------------------- thumbnail ----------------------------- */
let thumbCache = null;
const GENERATED_ART = `<svg width="480" height="480" viewBox="0 0 480 480" xmlns="http://www.w3.org/2000/svg">
<defs><radialGradient id="g" cx="50%" cy="36%" r="75%"><stop offset="0" stop-color="#4a34b8"/><stop offset=".5" stop-color="#150d44"/><stop offset="1" stop-color="#03020c"/></radialGradient>
<filter id="b"><feGaussianBlur stdDeviation="22"/></filter></defs>
<rect width="480" height="480" fill="url(#g)"/>
<circle cx="240" cy="175" r="120" fill="#7b5cff" opacity=".42" filter="url(#b)"/>
<circle cx="240" cy="250" r="165" fill="none" stroke="#8a6bff" stroke-opacity=".55" stroke-width="2" stroke-dasharray="6 11"/>
<circle cx="240" cy="250" r="125" fill="none" stroke="#6fc3ff" stroke-opacity=".35" stroke-width="1.5"/>
<polygon points="0,480 0,395 60,345 120,385 205,315 300,392 385,335 480,400 480,480" fill="#06051a"/>
<path d="M240 205 l-22 38 -46 132 h136 l-46-132z" fill="#010106"/>
<path d="M218 243 l-70 132 h58z M262 243 l70 132 h-58z" fill="#010106"/>
<circle cx="240" cy="186" r="19" fill="#010106"/>
<polygon points="221,172 227,144 235,166 240,138 245,166 253,144 259,172" fill="#010106"/>
<circle cx="233" cy="188" r="3.2" fill="#a8d8ff"/><circle cx="247" cy="188" r="3.2" fill="#a8d8ff"/>
</svg>`;
async function getThumb() {
  if (thumbCache) return thumbCache;
  let raw = null;
  try {
    if (process.env.BOT_IMAGE_URL) raw = await http(process.env.BOT_IMAGE_URL, { timeout: 20000, maxBytes: 15e6 });
  } catch {}
  if (!raw) {
    for (const f of ['bot.jpg', 'bot.jpeg', 'bot.png', 'bot.webp']) {
      const p = path.join(ROOT, 'assets', f);
      if (fs.existsSync(p)) { raw = fs.readFileSync(p); break; }
    }
  }
  try {
    thumbCache = await sharp()(raw || Buffer.from(GENERATED_ART)).resize(480, 480, { fit: 'cover' }).jpeg({ quality: 78 }).toBuffer();
  } catch { thumbCache = null; }
  return thumbCache;
}
const thumbSync = () => thumbCache;

module.exports = {
  ROOT, TMP, UserError, sharp, ffmpegBin, bold, escRe, escXml, sleep, pick, isUrl, findUrl, fmtBytes, fmtDur,
  tzParts, nextClock, parseDuration, parseTs, UA, http, getJson, getText, download, run, tmp, rm, ffmpeg, ff,
  imageToWebp, videoToWebp, withExif, readExif, webpToMp4, ensureYtDlp, ytdlp, ytDownload, ytSearch, hasFfmpeg, findFfmpeg, audioMime, videoFormat, getThumb, thumbSync,
  progressBar, envNum, maxDownloadBytes, maxMediaMinutes, maxMediaMb, netError
};
