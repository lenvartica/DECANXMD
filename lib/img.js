'use strict';
const path = require('path');
const { sharp, escXml } = require('./util');

const FONT = path.join(__dirname, '..', 'assets', 'fonts', 'Poppins-Bold.ttf');

/** Normalize any input to an RGB JPEG that fits in 1024px. */
async function base(buf) {
  const s = sharp();
  const b = await s(buf).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
  const m = await s(b).metadata();
  return { s, b, w: m.width, h: m.height };
}
const svg = (w, h, inner) => Buffer.from(`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`);
const out = img => img.jpeg({ quality: 90 }).toBuffer();
const rnd = (a, b) => a + Math.random() * (b - a);
const heart = (cx, cy, s) => `M${cx} ${cy + s * 0.35} C${cx - s} ${cy - s * 0.3} ${cx - s * 0.5} ${cy - s} ${cx} ${cy - s * 0.4} C${cx + s * 0.5} ${cy - s} ${cx + s} ${cy - s * 0.3} ${cx} ${cy + s * 0.35}Z`;
const vignette = (id, color, opacity, from = 45) =>
  `<radialGradient id="${id}" cx="50%" cy="50%" r="75%"><stop offset="${from}%" stop-color="${color}" stop-opacity="0"/><stop offset="100%" stop-color="${color}" stop-opacity="${opacity}"/></radialGradient>`;

async function textPng(text, w, h, color = '#000000') {
  return sharp()({ text: { text: `<span foreground="${color}">${escXml(text)}</span>`, font: 'Poppins Bold', fontfile: FONT, width: w, height: h, align: 'centre', rgba: true } }).png().toBuffer();
}

module.exports = { base, svg, out, rnd, heart, vignette, textPng, FONT };
