'use strict';
/**
 * Image tools that run locally with sharp (no external service):
 *  - filters on a replied image: grayscale, invert, sepia, sharpen, brighten, contrast, saturate, pixelate, mirror
 *  - info/convert/compress, text overlays: addtext, watermark, memetext, demotivator, wasted, comrade, heartimage
 *  - generated cards from text: logo, banner, poster, cover, thumbnail, wallpaper, avatar, signature, quoteimage,
 *    achievement, rip, shipimage, welcomeimage, goodbyeimage, birthdayimage, couple, rose, flower
 */
const crypto = require('crypto');
const U = require('../lib/util');
const { UserError, escXml: esc } = U;

const THEMES = [['#6a11cb', '#2575fc'], ['#ff512f', '#dd2476'], ['#11998e', '#38ef7d'], ['#f7971e', '#ffd200'], ['#0f2027', '#2c5364'], ['#8e2de2', '#4a00e0'], ['#ee0979', '#ff6a00'], ['#134e5e', '#71b280'], ['#1d976c', '#93f9b9'], ['#373b44', '#4286f4']];
const themeFor = t => THEMES[crypto.createHash('md5').update(String(t)).digest()[0] % THEMES.length];
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const IMPACT = "Impact, 'Arial Black', 'Helvetica Neue', Arial, sans-serif";

function wrap(text, max) {
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if ((line + ' ' + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
/** <text> with wrapped <tspan> lines, vertically centred on y */
function textBlock(lines, { x, y, size, lh = 1.2, fill = '#fff', weight = 700, anchor = 'middle', font = FONT, extra = '' }) {
  const top = y - ((lines.length - 1) * size * lh) / 2;
  return `<text x="${x}" y="${top}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="middle" ${extra}>${lines.map((l, i) => `<tspan x="${x}" dy="${i ? size * lh : 0}">${esc(l)}</tspan>`).join('')}</text>`;
}
const gradDef = (id, [a, b], dir = 'diag') => `<linearGradient id="${id}" x1="0" y1="0" x2="${dir === 'v' ? 0 : 1}" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const svgDoc = (w, h, body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;

module.exports = ({ def: rawDef, alias: rawAlias, registry }) => {
  const def = (names, opts, run) => { const n = [].concat(names).filter(x => !registry.has(x.toLowerCase())); if (n.length) rawDef(n, opts, run); };
  const alias = (existing, ...names) => { if (!registry.has(existing)) return; const f = names.filter(x => !registry.has(x.toLowerCase())); if (f.length) rawAlias(existing, ...f); };
  const P = ctx => ctx.var('PREFIX');
  const sharp = () => U.sharp();
  const toPng = svg => sharp()(Buffer.from(svg)).png().toBuffer();
  const needText = (ctx, usage) => { const t = ctx.input().trim(); if (!t) throw new UserError(`Usage: *${P(ctx)}${usage}*`); return t; };
  /** replied image, upright and capped to 1600px */
  async function src(ctx) {
    const m = await ctx.needMedia(['image', 'sticker'], 'Reply to an image with this command.');
    const buf = await sharp()(m.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).toBuffer();
    const meta = await sharp()(buf).metadata();
    return { buf, w: meta.width, h: meta.height, m };
  }
  const overlay = async (s, svg, extra = {}) => sharp()(s.buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png(extra).toBuffer();

  /* ----------------------------------- filters ----------------------------------- */
  const FILTERS = {
    grayscale: [i => i.grayscale(), 'Black and white'],
    invert: [i => i.negate({ alpha: false }), 'Invert the colours'],
    sepia: [i => i.recomb([[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]]), 'Old-photo sepia tone'],
    sharpen: [i => i.sharpen({ sigma: 2, m1: 1.5, m2: 2 }), 'Sharpen the picture'],
    saturate: [(i, n) => i.modulate({ saturation: n > 0 ? n : 1.8 }), 'Boost colours (optional factor, e.g. 2)'],
    brighten: [(i, n) => i.modulate({ brightness: n > 0 ? n : 1.3 }), 'Brighten (optional factor, e.g. 1.5)'],
    contrast: [(i, n) => { const a = n > 0 ? n : 1.3; return i.linear(a, -(128 * a) + 128); }, 'More contrast (optional factor, e.g. 1.5)']
  };
  for (const [name, [fn, desc]] of Object.entries(FILTERS)) {
    def(name, { cat: 'editor', heavy: true, usage: `${name} [factor]`, desc: `${desc}. Reply to an image.` }, async ctx => {
      const s = await src(ctx); const n = Number(ctx.argv[0]);
      await ctx.image(await fn(sharp()(s.buf), Number.isFinite(n) ? Math.min(5, n) : 0).png().toBuffer(), `✅ ${name}`);
    });
  }
  def('pixelate', { cat: 'editor', heavy: true, usage: 'pixelate [size 4-60]', desc: 'Pixelate an image (mosaic effect). Reply to an image.' }, async ctx => {
    const s = await src(ctx); const size = Math.min(60, Math.max(4, Math.floor(Number(ctx.argv[0])) || 16));
    const w = Math.max(1, Math.round(s.w / size)), h = Math.max(1, Math.round(s.h / size));
    const small = await sharp()(s.buf).resize(w, h, { kernel: 'nearest' }).toBuffer();
    await ctx.image(await sharp()(small).resize(s.w, s.h, { kernel: 'nearest' }).png().toBuffer(), '✅ pixelate');
  });
  def('mirror', { cat: 'editor', heavy: true, usage: 'mirror [left|right]', desc: 'Mirror one half of an image onto the other for a symmetrical look. Reply to an image.' }, async ctx => {
    const s = await src(ctx); const half = Math.floor(s.w / 2); const right = /^r/i.test(ctx.argv[0] || '');
    const part = await sharp()(s.buf).extract({ left: right ? s.w - half : 0, top: 0, width: half, height: s.h }).toBuffer();
    const flipped = await sharp()(part).flop().toBuffer();
    const out = await sharp()({ create: { width: half * 2, height: s.h, channels: 3, background: '#000' } }).composite(right ? [{ input: flipped, left: 0, top: 0 }, { input: part, left: half, top: 0 }] : [{ input: part, left: 0, top: 0 }, { input: flipped, left: half, top: 0 }]).png().toBuffer();
    await ctx.image(out, '✅ mirror');
  });

  /* --------------------------------- info / convert / compress --------------------------------- */
  def('imageinfo', { cat: 'editor', heavy: true, desc: 'Size, format and details of an image. Reply to an image.' }, async ctx => {
    const m = await ctx.needMedia(['image', 'sticker'], 'Reply to an image with this command.'); const i = await sharp()(m.buffer).metadata();
    await ctx.reply(`🖼️ Format: *${i.format}*\n📐 Size: *${i.width} × ${i.height}* px\n💾 File: *${U.fmtBytes(m.buffer.length)}*\n🎨 Channels: ${i.channels}${i.hasAlpha ? ' (transparency)' : ''}\n🔎 Density: ${i.density || '?'} dpi${i.orientation ? `\n↻ EXIF orientation: ${i.orientation}` : ''}`, { title: 'Image info' });
  });
  def(['imageconvert', 'imageformat'], { cat: 'editor', heavy: true, usage: 'imageconvert <png|jpg|webp|avif|tiff>', desc: 'Convert an image to another format. Reply to an image.' }, async ctx => {
    const f = (ctx.argv[0] || '').toLowerCase().replace('jpeg', 'jpg'); const M = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', tiff: 'image/tiff' };
    if (!M[f]) throw new UserError(`Usage: *${P(ctx)}imageconvert png* (formats: ${Object.keys(M).join(', ')})`);
    const m = await ctx.needMedia(['image', 'sticker'], 'Reply to an image with this command.');
    const out = await sharp()(m.buffer).rotate().toFormat(f === 'jpg' ? 'jpeg' : f, { quality: 90 }).toBuffer();
    await ctx.doc(out, `image.${f}`, M[f]);
  });
  def('imagecompress', { cat: 'editor', heavy: true, usage: 'imagecompress [quality 10-90]', desc: 'Make an image file smaller. Reply to an image.' }, async ctx => {
    const m = await ctx.needMedia(['image'], 'Reply to an image with this command.'); const q = Math.min(90, Math.max(10, Math.floor(Number(ctx.argv[0])) || 60));
    const out = await sharp()(m.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
    await ctx.image(out, `📦 ${U.fmtBytes(m.buffer.length)} → *${U.fmtBytes(out.length)}* (quality ${q})`);
  });

  /* ---------------------------------------- overlays ---------------------------------------- */
  def('addtext', { cat: 'editor', heavy: true, usage: 'addtext <caption>', desc: 'Add a caption bar under an image. Reply to an image.' }, async ctx => {
    const t = needText(ctx, 'addtext Hello world'); const s = await src(ctx); const size = Math.max(18, Math.round(s.w / 18));
    const lines = wrap(t, Math.max(12, Math.round(s.w / (size * 0.55)))); const bar = Math.round(lines.length * size * 1.25 + size);
    const svg = svgDoc(s.w, s.h + bar, `<rect width="${s.w}" height="${bar}" y="${s.h}" fill="#fff"/>${textBlock(lines, { x: s.w / 2, y: s.h + bar / 2, size, fill: '#111', font: FONT })}`);
    const base = await sharp()(s.buf).extend({ bottom: bar, background: '#ffffff' }).toBuffer();
    await ctx.image(await sharp()(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer(), '✅ caption added');
  });
  def('watermark', { cat: 'editor', heavy: true, usage: 'watermark <text>', desc: 'Stamp a semi-transparent text watermark on an image. Reply to an image.' }, async ctx => {
    const t = needText(ctx, 'watermark © My Brand'); const s = await src(ctx); const size = Math.max(16, Math.round(s.w / 22));
    const svg = svgDoc(s.w, s.h, `<text x="${s.w - size}" y="${s.h - size}" font-family="${FONT}" font-size="${size}" font-weight="700" fill="#fff" fill-opacity="0.7" stroke="#000" stroke-opacity="0.35" stroke-width="${size / 14}" paint-order="stroke" text-anchor="end">${esc(t.slice(0, 40))}</text>`);
    await ctx.image(await overlay(s, svg), '✅ watermark added');
  });
  def(['memetext', 'memecreate', 'memeimage'], { cat: 'editor', heavy: true, usage: 'memetext top text | bottom text', desc: 'Classic meme captions on an image. Reply to an image.' }, async ctx => {
    const [top, bottom] = needText(ctx, 'memetext when it works | on the first try').split('|').map(x => x.trim().toUpperCase());
    const s = await src(ctx); const size = Math.round(s.w / 9); const max = Math.max(8, Math.round(s.w / (size * 0.52)));
    const style = `font-family="${IMPACT}" font-size="${size}" font-weight="900" fill="#fff" stroke="#000" stroke-width="${size / 8}" paint-order="stroke" stroke-linejoin="round" text-anchor="middle"`;
    const block = (lines, y0, dir) => lines.map((l, i) => `<text x="${s.w / 2}" y="${y0 + dir * i * size * 1.05}" ${style}>${esc(l)}</text>`).join('');
    const tl = top ? wrap(top, max) : [], bl = bottom ? wrap(bottom, max) : [];
    const svg = svgDoc(s.w, s.h, block(tl, size * 1.05, 1) + block(bl.reverse(), s.h - size * 0.4, -1));
    await ctx.image(await overlay(s, svg), '😂');
  });
  def('demotivator', { cat: 'editor', heavy: true, usage: 'demotivator TITLE | smaller text', desc: 'Black-framed "demotivational poster" from an image. Reply to an image.' }, async ctx => {
    const [title, sub = ''] = needText(ctx, 'demotivator PROCRASTINATION | it can wait').split('|').map(x => x.trim());
    const s = await src(ctx); const pad = Math.round(s.w * 0.08), W = s.w + pad * 2, ts = Math.round(s.w / 11), ss = Math.round(s.w / 24);
    const tl = wrap(title.toUpperCase(), Math.round(s.w / (ts * 0.65))), sl = sub ? wrap(sub, Math.round(s.w / (ss * 0.5))) : [];
    const textH = Math.round(tl.length * ts * 1.2 + sl.length * ss * 1.3 + pad); const H = pad + s.h + textH;
    const body = `<rect width="${W}" height="${H}" fill="#000"/><rect x="${pad - 6}" y="${pad - 6}" width="${s.w + 12}" height="${s.h + 12}" fill="none" stroke="#fff" stroke-width="3"/>` +
      textBlock(tl, { x: W / 2, y: pad + s.h + pad * 0.6 + (tl.length * ts * 1.2) / 2, size: ts, font: "Georgia, 'Times New Roman', serif", weight: 400 }) +
      (sl.length ? textBlock(sl, { x: W / 2, y: pad + s.h + pad * 0.6 + tl.length * ts * 1.2 + (sl.length * ss * 1.3) / 2, size: ss, fill: '#ccc', weight: 400 }) : '');
    const base = await sharp()({ create: { width: W, height: H, channels: 3, background: '#000' } }).composite([{ input: s.buf, left: pad, top: pad }]).png().toBuffer();
    await ctx.image(await sharp()(base).composite([{ input: Buffer.from(svgDoc(W, H, body.replace(`<rect width="${W}" height="${H}" fill="#000"/>`, ''))), top: 0, left: 0 }]).png().toBuffer(), '🖼️');
  });
  def('wasted', { cat: 'editor', heavy: true, desc: 'GTA-style "WASTED" effect. Reply to an image.' }, async ctx => {
    const s = await src(ctx); const size = Math.round(s.w / 6);
    const base = await sharp()(s.buf).grayscale().modulate({ brightness: 0.75 }).toBuffer();
    const svg = svgDoc(s.w, s.h, `<rect y="${s.h / 2 - size * 0.8}" width="${s.w}" height="${size * 1.6}" fill="#000" fill-opacity="0.65"/><text x="${s.w / 2}" y="${s.h / 2}" font-family="${IMPACT}" font-size="${size}" font-weight="900" fill="#c4161c" text-anchor="middle" dominant-baseline="middle" letter-spacing="${size / 12}">WASTED</text>`);
    await ctx.image(await sharp()(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer(), '💀');
  });
  def('comrade', { cat: 'editor', heavy: true, desc: 'Red "comrade" tint with a star. Reply to an image.' }, async ctx => {
    const s = await src(ctx); const size = Math.round(s.w / 5);
    const star = (cx, cy, r) => `<polygon fill="#ffd700" points="${Array.from({ length: 10 }, (_, i) => { const a = Math.PI / 5 * i - Math.PI / 2, rr = i % 2 ? r * 0.4 : r; return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`; }).join(' ')}"/>`;
    const svg = svgDoc(s.w, s.h, `<rect width="${s.w}" height="${s.h}" fill="#c1121f" fill-opacity="0.38"/>${star(s.w * 0.14, s.h * 0.16, s.w * 0.08)}<text x="${s.w / 2}" y="${s.h - size * 0.5}" font-family="${IMPACT}" font-size="${size / 1.6}" font-weight="900" fill="#ffd700" stroke="#7a0b12" stroke-width="${size / 30}" paint-order="stroke" text-anchor="middle">COMRADE</text>`);
    await ctx.image(await overlay(s, svg), '☭');
  });
  def('heartimage', { cat: 'editor', heavy: true, desc: 'Crop an image into a heart shape (PNG). Reply to an image.' }, async ctx => {
    const s = await src(ctx); const side = Math.min(s.w, s.h); const sq = await sharp()(s.buf).resize(side, side, { fit: 'cover' }).toBuffer();
    const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 100 100"><path fill="#fff" d="M50 92 C 12 62, 2 38, 2 27 C 2 12, 14 3, 27 3 C 38 3, 46 9, 50 17 C 54 9, 62 3, 73 3 C 86 3, 98 12, 98 27 C 98 38, 88 62, 50 92 Z"/></svg>`;
    await ctx.image(await sharp()(sq).ensureAlpha().composite([{ input: Buffer.from(mask), blend: 'dest-in' }]).png().toBuffer(), '❤️');
  });

  /* ------------------------------------ text → image cards ------------------------------------ */
  const card = async (ctx, { w, h, text, usage, build }) => {
    const t = text ?? needText(ctx, usage);
    const [a, b] = t.split('|').map(x => x.trim());
    return ctx.image(await toPng(build(a, b || '', themeFor(a), w, h)), '');
  };
  const BG = (w, h, th, extra = '') => `<rect width="${w}" height="${h}" fill="url(#g)"/>${extra}`;
  const initials = s => s.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?';

  def('logo', { cat: 'editor', heavy: true, usage: 'logo <name> | tagline', desc: 'Generate a simple badge-style logo from a name.' }, ctx => card(ctx, {
    w: 800, h: 800, usage: 'logo Decan Labs | build better',
    build: (a, b, th, w, h) => svgDoc(w, h, `<rect width="${w}" height="${h}" fill="#fff"/><circle cx="400" cy="330" r="210" fill="url(#g)"/><circle cx="400" cy="330" r="235" fill="none" stroke="${th[0]}" stroke-width="10"/>${textBlock([initials(a)], { x: 400, y: 330, size: 190, font: FONT })}${textBlock(wrap(a, 16), { x: 400, y: 640, size: 64, fill: '#111' })}${b ? textBlock(wrap(b, 28), { x: 400, y: 735, size: 34, fill: '#666', weight: 400 }) : ''}`, gradDef('g', th))
  }));
  def('banner', { cat: 'editor', heavy: true, usage: 'banner <title> | subtitle', desc: 'Generate a 1500×500 banner.' }, ctx => card(ctx, {
    w: 1500, h: 500, usage: 'banner Grand Opening | this Saturday',
    build: (a, b, th, w, h) => svgDoc(w, h, BG(w, h, th, `<circle cx="1320" cy="90" r="220" fill="#fff" fill-opacity="0.08"/><circle cx="1180" cy="460" r="160" fill="#fff" fill-opacity="0.06"/>`) + textBlock(wrap(a, 26), { x: w / 2, y: b ? 210 : 250, size: 110 }) + (b ? textBlock(wrap(b, 50), { x: w / 2, y: 370, size: 48, weight: 400 }) : ''), gradDef('g', th))
  }));
  def('poster', { cat: 'editor', heavy: true, usage: 'poster <title> | details', desc: 'Generate a 1080×1500 event/promo poster.' }, ctx => card(ctx, {
    w: 1080, h: 1500, usage: 'poster Music Night | Fri 8pm • Nairobi',
    build: (a, b, th, w, h) => svgDoc(w, h, BG(w, h, th, `<rect x="60" y="60" width="${w - 120}" height="${h - 120}" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="6"/><circle cx="540" cy="430" r="230" fill="#fff" fill-opacity="0.12"/>`) + textBlock(wrap(a.toUpperCase(), 9), { x: w / 2, y: 650, size: 140 }) + (b ? textBlock(wrap(b, 28), { x: w / 2, y: 1150, size: 58, weight: 400 }) : '') + textBlock(['★ ★ ★'], { x: w / 2, y: 1330, size: 60, fill: '#ffd700' }), gradDef('g', th, 'v'))
  }));
  def('cover', { cat: 'editor', heavy: true, usage: 'cover <title> | subtitle', desc: 'Generate a 1280×720 cover image.' }, ctx => card(ctx, {
    w: 1280, h: 720, usage: 'cover My Playlist | Chill vibes',
    build: (a, b, th, w, h) => svgDoc(w, h, BG(w, h, th, Array.from({ length: 9 }, (_, i) => `<circle cx="${140 + i * 140}" cy="${i % 2 ? 90 : 630}" r="${40 + (i % 3) * 18}" fill="#fff" fill-opacity="0.08"/>`).join('')) + textBlock(wrap(a, 22), { x: w / 2, y: b ? 320 : 360, size: 96 }) + (b ? textBlock(wrap(b, 42), { x: w / 2, y: 500, size: 44, weight: 400 }) : ''), gradDef('g', th))
  }));
  def('thumbnail', { cat: 'editor', heavy: true, usage: 'thumbnail <big words> | small tag', desc: 'Generate a YouTube-style 1280×720 thumbnail.' }, ctx => card(ctx, {
    w: 1280, h: 720, usage: 'thumbnail I TRIED THIS | day 1',
    build: (a, b, th, w, h) => svgDoc(w, h, BG(w, h, th, `<polygon points="0,0 520,0 380,720 0,720" fill="#000" fill-opacity="0.25"/>`) + textBlock(wrap(a.toUpperCase(), 14), { x: w / 2 + 60, y: 340, size: 128, font: IMPACT, weight: 900, extra: `stroke="#000" stroke-width="10" paint-order="stroke" stroke-linejoin="round"` }) + (b ? `<rect x="60" y="560" rx="12" width="${Math.min(600, 40 + b.length * 26)}" height="84" fill="#ffd700"/>${textBlock([b.toUpperCase().slice(0, 22)], { x: 60 + Math.min(600, 40 + b.length * 26) / 2, y: 602, size: 46, fill: '#111' })}` : ''), gradDef('g', th))
  }));
  def('wallpaper', { cat: 'editor', heavy: true, usage: 'wallpaper [text]', desc: 'Generate a 1080×1920 phone wallpaper (optional text).' }, async ctx => {
    const t = ctx.input().trim() || String(Date.now()); const th = themeFor(t); const w = 1080, h = 1920;
    const blobs = Array.from({ length: 6 }, (_, i) => `<circle cx="${(crypto.createHash('md5').update(t + i).digest()[0] / 255) * w}" cy="${(crypto.createHash('md5').update(t + i + 'y').digest()[0] / 255) * h}" r="${160 + i * 40}" fill="#fff" fill-opacity="0.07"/>`).join('');
    await ctx.image(await toPng(svgDoc(w, h, BG(w, h, th, blobs) + (ctx.input().trim() ? textBlock(wrap(ctx.input().trim(), 14), { x: w / 2, y: h / 2, size: 120 }) : ''), gradDef('g', th, 'v'))), '');
  });
  def(['avatar', 'profilepic'], { cat: 'editor', heavy: true, usage: 'avatar <name>', desc: 'Generate an initials avatar (512×512).' }, ctx => card(ctx, {
    w: 512, h: 512, usage: 'avatar Jane Doe',
    build: (a, b, th, w, h) => svgDoc(w, h, `<circle cx="256" cy="256" r="256" fill="url(#g)"/>${textBlock([initials(a)], { x: 256, y: 262, size: 210 })}`, gradDef('g', th))
  }));
  def('signature', { cat: 'editor', heavy: true, usage: 'signature <name>', desc: 'Make a handwritten-style signature on a white card.' }, ctx => card(ctx, {
    w: 900, h: 320, usage: 'signature Jane Doe',
    build: a => svgDoc(900, 320, `<rect width="900" height="320" fill="#fff"/>${textBlock([a.slice(0, 24)], { x: 450, y: 150, size: 110, fill: '#14213d', weight: 400, font: "'Brush Script MT', 'Segoe Script', cursive", extra: 'font-style="italic"' })}<path d="M170 235 Q 450 200 730 240" stroke="#14213d" stroke-width="4" fill="none" stroke-linecap="round"/>`)
  }));
  def('quoteimage', { cat: 'editor', heavy: true, usage: 'quoteimage <quote> | author', desc: 'Put a quote on a gradient card.' }, ctx => card(ctx, {
    w: 1080, h: 1080, usage: 'quoteimage Stay hungry, stay foolish | Steve Jobs',
    build: (a, b, th, w, h) => svgDoc(w, h, BG(w, h, th) + `<text x="90" y="230" font-family="Georgia, serif" font-size="260" fill="#fff" fill-opacity="0.3">“</text>` + textBlock(wrap(a, 24), { x: w / 2, y: 540, size: 76, weight: 600, font: "Georgia, 'Times New Roman', serif" }) + (b ? textBlock([`— ${b}`], { x: w / 2, y: 900, size: 46, weight: 400 }) : ''), gradDef('g', th))
  }));
  def('achievement', { cat: 'editor', heavy: true, usage: 'achievement <text>', desc: 'A game-style "Achievement unlocked" banner.' }, ctx => card(ctx, {
    w: 900, h: 200, usage: 'achievement Sent my first command',
    build: a => svgDoc(900, 200, `<rect width="900" height="200" rx="14" fill="#1c1c1c"/><rect x="6" y="6" width="888" height="188" rx="10" fill="none" stroke="#555" stroke-width="4"/><rect x="28" y="38" width="124" height="124" rx="10" fill="#3a3a3a" stroke="#777" stroke-width="3"/>${textBlock(['🏆'], { x: 90, y: 100, size: 78 })}<text x="185" y="82" font-family="${FONT}" font-size="34" font-weight="700" fill="#ffd700">Achievement unlocked!</text>${textBlock(wrap(a, 38).slice(0, 2), { x: 185, y: 135, size: 34, fill: '#fff', weight: 400, anchor: 'start' })}`)
  }));
  def('rip', { cat: 'editor', heavy: true, usage: 'rip <name>', desc: 'A tombstone card (for a joke).' }, ctx => card(ctx, {
    w: 800, h: 900, usage: 'rip my phone battery',
    build: a => svgDoc(800, 900, `<rect width="800" height="900" fill="#87b6d6"/><rect y="700" width="800" height="200" fill="#4a7c3a"/><path d="M200 760 V300 A200 200 0 0 1 600 300 V760 Z" fill="#9a9a9a" stroke="#555" stroke-width="8"/>${textBlock(['R.I.P'], { x: 400, y: 280, size: 120, fill: '#333', font: "Georgia, serif" })}${textBlock(wrap(a, 14).slice(0, 3), { x: 400, y: 470, size: 56, fill: '#333', weight: 600, font: "Georgia, serif" })}${textBlock(['gone but not forgotten'], { x: 400, y: 650, size: 28, fill: '#555', weight: 400 })}`)
  }));
  def('shipimage', { cat: 'editor', heavy: true, usage: 'shipimage <name> | <name>', desc: 'A love-meter card for two names (for fun).' }, ctx => card(ctx, {
    w: 1000, h: 500, usage: 'shipimage Sam | Alex',
    build: (a, b) => { const pct = 20 + (crypto.createHash('md5').update([a, b].map(x => x.toLowerCase()).sort().join('+')).digest()[0] % 81); return svgDoc(1000, 500, `<rect width="1000" height="500" fill="url(#g)"/>${textBlock([initials(a)], { x: 200, y: 200, size: 150 })}${textBlock([initials(b || '?')], { x: 800, y: 200, size: 150 })}<text x="500" y="230" font-family="${FONT}" font-size="190" text-anchor="middle" dominant-baseline="middle" fill="#fff">♥</text>${textBlock([a.slice(0, 14) + '  +  ' + (b || '?').slice(0, 14)], { x: 500, y: 360, size: 48 })}${textBlock([`${pct}% match`], { x: 500, y: 430, size: 56, weight: 400 })}`, gradDef('g', ['#ee0979', '#ff6a00'])); }
  }));
  const greet = (name, word, emoji, usage) => def(name, { cat: 'editor', heavy: true, usage, desc: `${word} card for a person or group.` }, ctx => card(ctx, {
    w: 1100, h: 500, usage,
    build: (a, b, th, w, h) => svgDoc(w, h, BG(w, h, th, `<circle cx="1000" cy="80" r="170" fill="#fff" fill-opacity="0.09"/>`) + textBlock([word.toUpperCase()], { x: w / 2, y: 150, size: 100, extra: 'letter-spacing="6"' }) + textBlock(wrap(a, 22).slice(0, 2), { x: w / 2, y: 290, size: 78 }) + (b ? textBlock(wrap(b, 44).slice(0, 1), { x: w / 2, y: 420, size: 40, weight: 400 }) : textBlock([emoji], { x: w / 2, y: 420, size: 60, weight: 400 })), gradDef('g', th))
  }));
  greet('welcomeimage', 'Welcome', '🎉', 'welcomeimage Sam | to the group');
  greet('goodbyeimage', 'Goodbye', '👋', 'goodbyeimage Sam | we will miss you');
  def('birthdayimage', { cat: 'editor', heavy: true, usage: 'birthdayimage <name>', desc: 'A birthday card with confetti.' }, ctx => card(ctx, {
    w: 1000, h: 1000, usage: 'birthdayimage Sam',
    build: (a, b, th, w, h) => svgDoc(w, h, BG(w, h, th, Array.from({ length: 60 }, (_, i) => { const hsh = crypto.createHash('md5').update(a + i).digest(); return `<rect x="${(hsh[0] / 255) * w}" y="${(hsh[1] / 255) * h}" width="14" height="28" rx="3" fill="hsl(${hsh[2] * 1.4},85%,60%)" transform="rotate(${hsh[3]} ${(hsh[0] / 255) * w} ${(hsh[1] / 255) * h})"/>`; }).join('')) + textBlock(['HAPPY'], { x: w / 2, y: 330, size: 150 }) + textBlock(['BIRTHDAY'], { x: w / 2, y: 480, size: 150 }) + textBlock(wrap(a, 16).slice(0, 2), { x: w / 2, y: 700, size: 110, fill: '#ffe66d' }) + textBlock(['🎂 🎈 🎁'], { x: w / 2, y: 880, size: 90, weight: 400 }), gradDef('g', th, 'v'))
  }));
  def(['couple', 'couplewallpaper'], { cat: 'editor', heavy: true, usage: 'couple <name> | <name>', desc: 'A matching two-part couple wallpaper (sent as 2 images).' }, async ctx => {
    const [a, b = ''] = needText(ctx, 'couple Sam | Alex').split('|').map(x => x.trim());
    for (const [n, c] of [[a, '#ee0979'], [b || '♥', '#2575fc']]) await ctx.image(await toPng(svgDoc(1080, 1920, `<rect width="1080" height="1920" fill="url(#g)"/><text x="540" y="860" font-family="${FONT}" font-size="420" text-anchor="middle" fill="#fff" fill-opacity="0.9">♥</text>${textBlock([n.slice(0, 14)], { x: 540, y: 1260, size: 130 })}`, gradDef('g', [c, '#1a1a2e'], 'v'))), '');
  });
  const flora = (name, petal, emoji) => def(name, { cat: 'editor', heavy: true, usage: `${name} [text]`, desc: `A drawn ${name}, with optional text.` }, async ctx => {
    const t = ctx.input().trim(); const petals = Array.from({ length: 8 }, (_, i) => `<ellipse cx="400" cy="250" rx="${name === 'rose' ? 70 : 52}" ry="${name === 'rose' ? 110 : 120}" fill="${petal}" fill-opacity="${name === 'rose' ? 0.85 : 0.9}" transform="rotate(${i * 45} 400 330)"/>`).join('');
    await ctx.image(await toPng(svgDoc(800, 1000, `<rect width="800" height="1000" fill="#fdf6ec"/><path d="M400 440 C 380 620, 420 760, 400 940" stroke="#2e7d32" stroke-width="16" fill="none"/><ellipse cx="330" cy="700" rx="80" ry="34" fill="#43a047" transform="rotate(-30 330 700)"/><ellipse cx="470" cy="790" rx="80" ry="34" fill="#43a047" transform="rotate(30 470 790)"/>${petals}<circle cx="400" cy="330" r="${name === 'rose' ? 55 : 60}" fill="${name === 'rose' ? '#b71c1c' : '#ffb300'}"/>${t ? textBlock(wrap(t, 20).slice(0, 2), { x: 400, y: 90, size: 56, fill: '#6d4c41', weight: 600 }) : ''}`)), emoji);
  });
  flora('rose', '#e53935', '🌹'); flora('flower', '#ec407a', '🌸');

  /* --------------------------------------- aliases --------------------------------------- */
  alias('cartoon', 'anime'); alias('url', 'imageurl', 'tourl', 'fileupload', 'filelink');
};

module.exports.helpers = { wrap, themeFor, initials: s => s };
