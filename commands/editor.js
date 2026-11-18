'use strict';
const { UserError, sharp } = require('../lib/util');
const { base, svg, out, rnd, heart, vignette, textPng } = require('../lib/img');

const LAPLACIAN = { width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1], scale: 1, offset: 0 };

const EFFECTS = {
  bloody: ['Blood-splattered horror look', async ({ s, b, w, h }) => {
    let drips = '';
    for (let i = 0; i < 16; i++) {
      const x = rnd(0, w), wd = rnd(w * 0.008, w * 0.022), len = rnd(h * 0.06, h * 0.32);
      drips += `<path d="M${x} 0 h${wd} v${len} a${wd / 2} ${wd / 2} 0 0 1 ${-wd} 0 z" fill="#a80000"/>`;
    }
    const over = svg(w, h, `<defs>${vignette('v', '#5a0000', 0.85)}</defs><rect width="100%" height="100%" fill="#b00000" opacity="0.2"/><rect width="100%" height="100%" fill="url(#v)"/>${drips}`);
    return out(s(b).modulate({ saturation: 1.25 }).linear(1.12, -10).composite([{ input: over }]));
  }],
  bokeh: ['Blurred background with glowing bokeh lights', async ({ s, b, w, h }) => {
    const blurred = await s(b).blur(14).toBuffer();
    const mask = svg(w, h, `<defs><radialGradient id="m" cx="50%" cy="50%" r="62%"><stop offset="42%" stop-color="#fff"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#m)"/>`);
    const center = await s(b).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    let c = '';
    for (let i = 0; i < 22; i++) c += `<circle cx="${rnd(0, w)}" cy="${rnd(0, h)}" r="${rnd(14, Math.min(w, h) * 0.07)}" fill="#fff" opacity="${rnd(0.08, 0.2).toFixed(2)}"/>`;
    return out(s(blurred).composite([{ input: center }, { input: svg(w, h, c) }]));
  }],
  cartoon: ['Cartoon / comic effect', async ({ s, b }) => {
    const col = await s(b).median(5).modulate({ saturation: 1.7, brightness: 1.05 }).linear(1.15, -10).toBuffer();
    const edges = await s(b).greyscale().blur(1).convolve(LAPLACIAN).negate().threshold(235).toColourspace('srgb').png().toBuffer();
    return out(s(col).composite([{ input: edges, blend: 'multiply' }]));
  }],
  dark: ['Dark moody look', async ({ s, b, w, h }) => out(s(b).modulate({ brightness: 0.55, saturation: 0.8 }).gamma(1.4).composite([{ input: svg(w, h, `<defs>${vignette('v', '#000', 0.85, 30)}</defs><rect width="100%" height="100%" fill="url(#v)"/>`) }]))],
  demon: ['Demonic red look', async ({ s, b, w, h }) => out(s(b).modulate({ brightness: 0.7, saturation: 1.1 }).linear(1.3, -35).tint('#ff2a2a').composite([{ input: svg(w, h, `<defs>${vignette('v', '#000', 0.9, 30)}</defs><rect width="100%" height="100%" fill="url(#v)"/>`) }]))],
  enhance: ['Sharpen and boost colors', async ({ s, b }) => out(s(b).normalise().sharpen({ sigma: 1.3 }).modulate({ saturation: 1.15 }))],
  gandm: ['Gold & magenta duotone', async ({ s, b, w, h }) => {
    const grey = await s(b).greyscale().normalise().toColourspace('srgb').png().toBuffer();
    const g = svg(w, h, `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff00aa"/><stop offset="1" stop-color="#ffc400"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`);
    return out(s(g).composite([{ input: grey, blend: 'soft-light' }]).modulate({ saturation: 1.3 }));
  }],
  horned: ['Add devil horns', async ({ s, b, w, h }) => {
    const horn = (flip) => {
      const X = x => (flip ? w - x : x);
      return `<path d="M${X(0.36 * w)} ${0.2 * h} Q${X(0.27 * w)} ${0.02 * h} ${X(0.19 * w)} ${0.05 * h} Q${X(0.27 * w)} ${0.11 * h} ${X(0.42 * w)} ${0.22 * h}Z" fill="#b30000" stroke="#350000" stroke-width="${Math.max(2, w * 0.004)}"/>`;
    };
    return out(s(b).modulate({ saturation: 1.1 }).composite([{ input: svg(w, h, horn(false) + horn(true)) }]));
  }],
  kiss: ['Pink glow with floating hearts', async ({ s, b, w, h }) => {
    let hs = '';
    for (let i = 0; i < 16; i++) hs += `<path d="${heart(rnd(0, w), rnd(0, h), rnd(w * 0.02, w * 0.06))}" fill="#ff4d94" opacity="${rnd(0.45, 0.9).toFixed(2)}"/>`;
    return out(s(b).modulate({ saturation: 1.15, brightness: 1.05 }).composite([{ input: svg(w, h, `<rect width="100%" height="100%" fill="#ff7eb3" opacity="0.18"/>${hs}`) }]));
  }],
  look: ['Cinematic teal-orange look with letterbox', async ({ s, b, w, h }) => {
    const g = svg(w, h, `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00a5b5"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`);
    const bars = svg(w, h, `<rect width="100%" height="${h * 0.1}" fill="#000"/><rect y="${h * 0.9}" width="100%" height="${h * 0.1}" fill="#000"/>`);
    return out(s(b).modulate({ saturation: 1.2 }).linear(1.1, -10).composite([{ input: g, blend: 'soft-light' }, { input: bars }]));
  }],
  makeup: ['Soft glam skin and warm tone', async ({ s, b, w, h }) => {
    const soft = await s(b).blur(3).modulate({ saturation: 1.15 }).ensureAlpha(0.55).png().toBuffer();
    return out(s(b).modulate({ saturation: 1.2, brightness: 1.03 }).composite([{ input: soft }, { input: svg(w, h, `<rect width="100%" height="100%" fill="#ff7a9a" opacity="0.1"/>`) }]));
  }],
  pencil: ['Pencil drawing', async ({ s, b }) => {
    const grey = await s(b).greyscale().toColourspace('srgb').png().toBuffer();
    const inv = await s(b).greyscale().negate().blur(12).toColourspace('srgb').png().toBuffer();
    return out(s(grey).composite([{ input: inv, blend: 'colour-dodge' }]));
  }],
  sketch: ['Line-art sketch', async ({ s, b }) => out(s(b).greyscale().blur(0.8).convolve(LAPLACIAN).negate().linear(1.5, -60))],
  skull: ['X-ray look with a skull overlay', async ({ s, b, w, h }) => {
    const cx = w / 2, cy = h * 0.52, r = Math.min(w, h) * 0.2;
    const skull = `<g opacity="0.8" fill="#f2f2f2"><circle cx="${cx}" cy="${cy}" r="${r}"/><rect x="${cx - r * 0.6}" y="${cy + r * 0.6}" width="${r * 1.2}" height="${r * 0.9}" rx="${r * 0.2}"/></g>
      <g fill="#050505"><ellipse cx="${cx - r * 0.38}" cy="${cy - r * 0.05}" rx="${r * 0.26}" ry="${r * 0.3}"/><ellipse cx="${cx + r * 0.38}" cy="${cy - r * 0.05}" rx="${r * 0.26}" ry="${r * 0.3}"/>
      <path d="M${cx} ${cy + r * 0.2} l${-r * 0.12} ${r * 0.3} h${r * 0.24}z"/></g>
      <g stroke="#050505" stroke-width="${r * 0.04}">${[-0.4, -0.2, 0, 0.2, 0.4].map(k => `<line x1="${cx + r * k}" y1="${cy + r * 0.95}" x2="${cx + r * k}" y2="${cy + r * 1.45}"/>`).join('')}</g>`;
    return out(s(b).greyscale().linear(1.3, -25).tint('#5aa0ff').composite([{ input: svg(w, h, skull) }]));
  }],
  zombie: ['Undead green look', async ({ s, b, w, h }) => out(s(b).modulate({ saturation: 0.6, brightness: 0.8 }).tint('#78b45a').gamma(1.3).composite([{ input: svg(w, h, `<defs>${vignette('v', '#0b1a05', 0.8, 35)}</defs><rect width="100%" height="100%" fill="url(#v)"/>`) }]))]
};

async function wanted(buf, name) {
  const s = sharp();
  const { b } = await base(buf);
  const PW = 800, PH = 1100;
  const bg = svg(PW, PH, `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6c999"/><stop offset="1" stop-color="#c79c64"/></linearGradient></defs>
    <rect width="${PW}" height="${PH}" fill="url(#g)"/><rect x="24" y="24" width="${PW - 48}" height="${PH - 48}" fill="none" stroke="#4a2c12" stroke-width="10"/>
    <rect x="48" y="48" width="${PW - 96}" height="${PH - 96}" fill="none" stroke="#4a2c12" stroke-width="3"/><rect x="80" y="260" width="640" height="640" fill="#3b2412"/>`);
  const photo = await s(b).resize(630, 630, { fit: 'cover' }).greyscale().tint('#a67c4a').toBuffer();
  const place = async (img, top) => { const m = await s(img).metadata(); return { input: img, top, left: Math.round((PW - m.width) / 2) }; };
  const title = await place(await textPng('WANTED', 640, 170, '#3b2412'), 70);
  const sub = await place(await textPng('DEAD OR ALIVE', 560, 60, '#3b2412'), 915);
  const reward = await place(await textPng(name ? name.slice(0, 22) : 'REWARD $1,000,000', 620, 90, '#3b2412'), 985);
  return s(bg).composite([{ input: photo, top: 265, left: 85 }, title, sub, reward]).jpeg({ quality: 90 }).toBuffer();
}

module.exports = ({ def }) => {
  for (const [name, [desc, fn]] of Object.entries(EFFECTS)) {
    def(name, { cat: 'editor', heavy: true, desc: `${desc}. Reply to an image.` }, async ctx => {
      const m = await ctx.needMedia('image');
      await ctx.image(await fn(await base(m.buffer)), `✨ ${name}`);
    });
  }
  def('color', { cat: 'editor', heavy: true, usage: 'color <name or #hex>', desc: 'Tint an image with a color (default purple). Reply to an image.' }, async ctx => {
    const m = await ctx.needMedia('image');
    const c = ctx.argv[0] || 'purple';
    const { s, b } = await base(m.buffer);
    try { await ctx.image(await out(s(b).tint(c)), `🎨 ${c}`); }
    catch (e) { if (/colou?r/i.test(e.message)) throw new UserError('Unknown color. Try a name like *red* or a hex like *#ff8800*.'); throw e; }
  });
  def('wanted', { cat: 'editor', heavy: true, usage: 'wanted [name]', desc: 'Put the image on a "WANTED" poster. Reply to an image.' }, async ctx => {
    const m = await ctx.needMedia('image');
    await ctx.image(await wanted(m.buffer, ctx.args), '🏴‍☠️ WANTED');
  });
};
module.exports.EFFECTS = EFFECTS;
