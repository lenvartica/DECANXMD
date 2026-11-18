'use strict';
const path = require('path');
const { UserError, sharp, escXml } = require('../lib/util');

const W = 1000, H = 420, B = 30;
const FONT = path.join(__dirname, '..', 'assets', 'fonts', 'Poppins-Bold.ttf');

const STYLES = {
  '3d': { bg: ['#1b1b3a', '#0b0b1d'], fill: ['#ffe082', '#ff9800'], depth: { color: '#8a5200', n: 16, dx: 1, dy: 1 } },
  angel: { bg: ['#eaf5ff', '#b6d7ff'], fill: ['#ffffff', '#fff1a8'], glow: [{ color: '#fff7b0', sigma: 16 }], stroke: { color: '#d4a82a', w: 3 } },
  avenger: { bg: ['#0a1230', '#000000'], fill: ['#f2f2ff', '#7d86ff'], glow: [{ color: '#3d5afe', sigma: 14 }], stroke: { color: '#1a237e', w: 4 } },
  blub: { bg: ['#06223d', '#0a4c7a'], fill: ['#9ae9ff', '#2b8cff'], glow: [{ color: '#00e5ff', sigma: 10 }], stroke: { color: '#ffffff', w: 4 } },
  bpink: { bg: ['#000000', '#12000b'], fill: ['#ff9bd5', '#ff2e93'], glow: [{ color: '#ff2e93', sigma: 16 }], stroke: { color: '#ffffff', w: 2 } },
  cat: { bg: ['#ffe9c7', '#ffcf8a'], fill: ['#6d4c41', '#3e2723'], stroke: { color: '#ffffff', w: 4 }, depth: { color: '#a1887f', n: 6, dx: 2, dy: 3 } },
  glitch: { bg: ['#080808', '#080808'], fill: '#ffffff', rgb: true },
  glitter: { bg: ['#000000', '#12081f'], fill: ['#fff3a0', '#e6a800', '#fff3a0'], glow: [{ color: '#ffd54f', sigma: 8 }], sparkle: true },
  graffiti: { bg: ['#546e7a', '#263238'], fill: ['#ff5252', '#ffeb3b'], stroke: { color: '#000000', w: 7 }, depth: { color: '#000000', n: 8, dx: 3, dy: 3 } },
  hacker: { bg: ['#000000', '#001a05'], fill: '#00ff41', glow: [{ color: '#00ff41', sigma: 9 }], scan: true },
  light: { bg: ['#04040f', '#0a0a24'], fill: '#ffffff', glow: [{ color: '#ffffff', sigma: 20 }, { color: '#8fb4ff', sigma: 40 }] },
  marvel: { bg: ['#c62828', '#8e0000'], fill: '#ffffff', stroke: { color: '#000000', w: 8 }, depth: { color: '#000000', n: 8, dx: 4, dy: 4 } },
  neon: { bg: ['#0a0014', '#14002b'], fill: '#ffffff', glow: [{ color: '#ff00e6', sigma: 10 }, { color: '#ff00e6', sigma: 24 }, { color: '#7a00ff', sigma: 46 }] },
  sci: { bg: ['#001524', '#000a12'], fill: ['#7df9ff', '#2979ff'], glow: [{ color: '#00e5ff', sigma: 12 }], stroke: { color: '#003c52', w: 3 }, scan: true },
  sign: { bg: ['#4e342e', '#2e1c18'], fill: ['#fff59d', '#fbc02d'], glow: [{ color: '#ffb300', sigma: 14 }], stroke: { color: '#000000', w: 5 } },
  tatto: { bg: ['#e3b38d', '#c68e65'], fill: '#161616', soft: true },
  watercolor: { bg: ['#fffdf7', '#f6efe2'], fill: ['#ff6f91', '#845ec2', '#00c9a7'], soft: true, glow: [{ color: '#845ec2', sigma: 6 }] }
};

const grad = (w, h, cols) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${cols.map((c, i) => `<stop offset="${cols.length === 1 ? 0 : i / (cols.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);

async function textMask(text) {
  const s = sharp();
  const t = await s({ text: { text: `<span foreground="white">${escXml(text)}</span>`, font: 'Poppins Bold', fontfile: FONT, width: W - 160, height: H - 160, align: 'centre', rgba: true } }).png().toBuffer();
  return s({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: t, gravity: 'centre' }]).png().toBuffer();
}
async function fillMask(mask, fill) {
  const s = sharp();
  const base = Array.isArray(fill) ? s(grad(W, H, fill)) : s({ create: { width: W, height: H, channels: 4, background: fill } });
  return base.ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function render(text, name) {
  const st = STYLES[name];
  const s = sharp();
  const mask = await textMask(text);
  const layers = [];
  const at = (input, dx = 0, dy = 0) => layers.push({ input, left: B + dx, top: B + dy });
  if (st.depth) {
    const d = await fillMask(mask, st.depth.color);
    for (let i = st.depth.n; i >= 1; i--) at(d, i * st.depth.dx, i * st.depth.dy);
  }
  if (st.rgb) {
    at(await fillMask(mask, '#00e5ff'), -7, 0);
    at(await fillMask(mask, '#ff0055'), 7, 0);
  }
  for (const g of st.glow || []) {
    const blurred = await s(await fillMask(mask, g.color)).blur(g.sigma).png().toBuffer();
    at(blurred); at(blurred);
  }
  if (st.stroke) {
    const sm = await fillMask(mask, st.stroke.color);
    const w = st.stroke.w;
    for (let a = 0; a < 16; a++) at(sm, Math.round(Math.cos(a * Math.PI / 8) * w), Math.round(Math.sin(a * Math.PI / 8) * w));
  }
  let main = await fillMask(mask, st.fill);
  if (st.soft) main = await s(main).blur(0.9).png().toBuffer();
  at(main);
  if (st.sparkle) {
    let dots = '';
    for (let i = 0; i < 90; i++) dots += `<circle cx="${Math.random() * W}" cy="${Math.random() * H}" r="${(Math.random() * 2.2 + 0.6).toFixed(1)}" fill="#fff" opacity="${(Math.random() * 0.8 + 0.2).toFixed(2)}"/>`;
    layers.push({ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${dots}</svg>`), left: B, top: B });
  }
  if (st.scan) {
    let lines = '';
    for (let y = 0; y < H; y += 4) lines += `<rect x="0" y="${y}" width="${W}" height="1.5" fill="#000" opacity="0.28"/>`;
    layers.push({ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${lines}</svg>`), left: B, top: B });
  }
  const bg = await s(grad(W + B * 2, H + B * 2, st.bg)).png().toBuffer();
  const composed = await s(bg).composite(layers).png().toBuffer();
  return s(composed).extract({ left: B, top: B, width: W, height: H }).jpeg({ quality: 90 }).toBuffer();
}

module.exports = ({ def }) => {
  for (const name of Object.keys(STYLES)) {
    def(name, { cat: 'textmaker', heavy: true, usage: `${name} <text>`, desc: `Create a "${name}" style text image.` }, async ctx => {
      const text = ctx.input().trim();
      if (!text) throw new UserError(`Give me some text, e.g. *${ctx.var('PREFIX')}${name} Shadow Monarch*`);
      if (text.length > 40) throw new UserError('Keep the text under 40 characters.');
      await ctx.image(await render(text, name), `✨ ${name}`);
    });
  }
};
module.exports.render = render;
