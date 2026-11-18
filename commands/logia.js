'use strict';
const { base, svg, out, rnd, vignette } = require('../lib/img');

/** Logia-fruit themed image filters (inspired by One Piece fruit powers). */
const FX = {
  ope: ['Ope Ope: a blue "Room" dome with a grid over the image', async ({ s, b, w, h }) => {
    const r = Math.min(w, h) * 0.46, cx = w / 2, cy = h / 2;
    let grid = '';
    for (let i = -8; i <= 8; i++) {
      grid += `<line x1="${cx + i * r / 8}" y1="${cy - r}" x2="${cx + i * r / 8}" y2="${cy + r}" stroke="#7ee8ff" stroke-opacity="0.35"/>`;
      grid += `<line x1="${cx - r}" y1="${cy + i * r / 8}" x2="${cx + r}" y2="${cy + i * r / 8}" stroke="#7ee8ff" stroke-opacity="0.35"/>`;
    }
    const over = svg(w, h, `<defs><clipPath id="c"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
      <radialGradient id="d" cx="50%" cy="50%" r="50%"><stop offset="60%" stop-color="#00c8ff" stop-opacity="0.12"/><stop offset="100%" stop-color="#00c8ff" stop-opacity="0.42"/></radialGradient></defs>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#d)"/><g clip-path="url(#c)">${grid}</g>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#9ff1ff" stroke-width="${Math.max(3, w * 0.006)}"/>
      <circle cx="${cx}" cy="${cy}" r="${r * 1.04}" fill="none" stroke="#00c8ff" stroke-opacity="0.5" stroke-width="2"/>`);
    return out(s(b).modulate({ saturation: 1.1, brightness: 0.95 }).composite([{ input: over }]));
  }],
  yami: ['Yami Yami: darkness swallowing the image in a vortex', async ({ s, b, w, h }) => {
    const cx = w / 2, cy = h / 2, k = Math.min(w, h) * 0.012;
    let pts = '';
    for (let t = 0.2; t < 18; t += 0.12) pts += `${(cx + Math.cos(t) * t * k * 2.2).toFixed(1)},${(cy + Math.sin(t) * t * k * 2.2).toFixed(1)} `;
    const over = svg(w, h, `<defs>${vignette('v', '#050008', 0.97, 15)}</defs><rect width="100%" height="100%" fill="url(#v)"/>
      <polyline points="${pts}" fill="none" stroke="#9b5cff" stroke-opacity="0.55" stroke-width="${Math.max(2, w * 0.004)}"/>
      <circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) * 0.05}" fill="#000"/>`);
    return out(s(b).modulate({ brightness: 0.6, saturation: 0.7 }).composite([{ input: over }]));
  }],
  zushi: ['Zushi Zushi: gravity rings pulling toward the center', async ({ s, b, w, h }) => {
    const cx = w / 2, cy = h / 2, m = Math.min(w, h);
    let rings = '', lines = '';
    for (let i = 1; i <= 6; i++) rings += `<circle cx="${cx}" cy="${cy}" r="${m * 0.07 * i}" fill="none" stroke="#e8c27a" stroke-opacity="${(0.8 - i * 0.1).toFixed(2)}" stroke-width="${Math.max(2, w * 0.004)}"/>`;
    for (let a = 0; a < 40; a++) {
      const ang = (a / 40) * Math.PI * 2, r1 = m * rnd(0.5, 0.75), r2 = m * rnd(0.3, 0.45);
      lines += `<line x1="${cx + Math.cos(ang) * r1}" y1="${cy + Math.sin(ang) * r1}" x2="${cx + Math.cos(ang) * r2}" y2="${cy + Math.sin(ang) * r2}" stroke="#fff" stroke-opacity="0.35" stroke-width="2"/>`;
    }
    const over = svg(w, h, `<defs>${vignette('v', '#2a1500', 0.7, 35)}</defs><rect width="100%" height="100%" fill="url(#v)"/>${lines}${rings}`);
    return out(s(b).modulate({ saturation: 0.85 }).tint('#c89a5a').composite([{ input: over }]));
  }]
};

module.exports = ({ def }) => {
  for (const [name, [desc, fn]] of Object.entries(FX)) {
    def(name, { cat: 'logia', heavy: true, desc: `${desc}. Reply to an image.` }, async ctx => {
      const m = await ctx.needMedia('image');
      await ctx.image(await fn(await base(m.buffer)), `🍎 ${name}`);
    });
  }
};
