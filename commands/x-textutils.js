'use strict';
/**
 * Everyday utilities that run fully offline: calculators, unit conversion, encoders/decoders, hashes, text styles,
 * colour tools, QR variants, time/zone tools, JSON helpers, JWT/OTP helpers and small random generators.
 */
const crypto = require('crypto');
const U = require('../lib/util');
const { UserError, bold, escXml } = U;

const pick = a => a[Math.floor(Math.random() * a.length)];
const num = s => { const n = Number(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : NaN; };
const fmt = (n, d = 4) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(d))));

/* ---------------------------- unit conversion tables ---------------------------- */
const UNITS = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, mile: 1609.344, miles: 1609.344, ft: 0.3048, feet: 0.3048, in: 0.0254, inch: 0.0254, yd: 0.9144, nmi: 1852 },
  weight: { kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237, oz: 0.028349523125, st: 6.35029318 },
  volume: { l: 1, litre: 1, liter: 1, liters: 1, litres: 1, ml: 0.001, gal: 3.785411784, gallon: 3.785411784, gallons: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735295625, tbsp: 0.01478676478, tsp: 0.00492892159 },
  area: { m2: 1, km2: 1e6, cm2: 1e-4, ha: 1e4, acre: 4046.8564224, acres: 4046.8564224, ft2: 0.09290304, in2: 0.00064516, mi2: 2589988.110336, yd2: 0.83612736 },
  speed: { ms: 1, 'm/s': 1, kmh: 1 / 3.6, 'km/h': 1 / 3.6, kph: 1 / 3.6, mph: 0.44704, knot: 0.514444, knots: 0.514444, kn: 0.514444, fps: 0.3048 },
  data: { b: 1, byte: 1, bytes: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, pb: 1024 ** 5, bit: 0.125, bits: 0.125 },
  temp: { c: 1, f: 1, k: 1, celsius: 1, fahrenheit: 1, kelvin: 1 }
};
const TEMP = { celsius: 'c', fahrenheit: 'f', kelvin: 'k' };
function unitCategory(u) { for (const [cat, t] of Object.entries(UNITS)) if (u in t) return cat; return null; }
function convert(value, from, to) {
  from = from.toLowerCase(); to = to.toLowerCase();
  const cat = unitCategory(from);
  if (!cat || cat !== unitCategory(to)) throw new UserError(`I cannot convert *${from}* to *${to}*. Units must be of the same kind (length, weight, volume, area, speed, data or temperature).`);
  if (cat === 'temp') {
    const f = TEMP[from] || from, t = TEMP[to] || to;
    const c = f === 'c' ? value : f === 'f' ? (value - 32) * 5 / 9 : value - 273.15;
    return t === 'c' ? c : t === 'f' ? c * 9 / 5 + 32 : c + 273.15;
  }
  return value * UNITS[cat][from] / UNITS[cat][to];
}
const prettyBytes = n => { const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${fmt(n, 2)} ${u[i]}`; };

/* ---------------------------------- text styles --------------------------------- */
const range = (s, lo, hi, base) => ch => { const c = ch.codePointAt(0); return c >= lo && c <= hi ? String.fromCodePoint(base + c - lo) : null; };
const mapper = (...rs) => text => [...text].map(ch => { for (const r of rs) { const o = r(ch); if (o) return o; } return ch; }).join('');
const STYLES = {
  bold: mapper(range('', 65, 90, 0x1D400), range('', 97, 122, 0x1D41A), range('', 48, 57, 0x1D7CE)),
  italic: text => mapper(range('', 65, 90, 0x1D434), range('', 97, 122, 0x1D44E))(text).replace(/\u{1D455}/gu, '\u210E'),
  bolditalic: mapper(range('', 65, 90, 0x1D468), range('', 97, 122, 0x1D482)),
  script: mapper(range('', 65, 90, 0x1D49C), range('', 97, 122, 0x1D4B6)),
  monospace: mapper(range('', 65, 90, 0x1D670), range('', 97, 122, 0x1D68A), range('', 48, 57, 0x1D7F6)),
  double: mapper(range('', 65, 90, 0x1D538), range('', 97, 122, 0x1D552), range('', 48, 57, 0x1D7D8)),
  circled: mapper(range('', 65, 90, 0x24B6), range('', 97, 122, 0x24D0), range('', 49, 57, 0x2460)),
  squared: mapper(range('', 65, 90, 0x1F130), range('', 97, 122, 0x1F130 - 32))
};
const SMALL = { a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ' };
const FLIP = { a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᴉ', j: 'ɾ', k: 'ʞ', l: 'l', m: 'ɯ', n: 'u', o: 'o', p: 'd', q: 'b', r: 'ɹ', s: 's', t: 'ʇ', u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z', '?': '¿', '!': '¡', '.': '˙', ',': '\'', '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', _: '‾' };
const smallCaps = t => [...t.toLowerCase()].map(c => SMALL[c] || c).join('');
const upsideDown = t => [...t.toLowerCase()].map(c => FLIP[c] || c).reverse().join('');
const MARKS = [...'\u0300\u0301\u0302\u0303\u0304\u0305\u0306\u0307\u0308\u030A\u030B\u030C\u0316\u0317\u0318\u0319\u031C\u031D\u031E\u031F\u0320\u0323\u0324\u0325\u0326\u0329\u032A\u032B\u032C\u032D\u032E\u032F\u0330\u0331\u0332\u0333'];
const zalgo = (t, n = 4) => [...t].map(c => (/\s/.test(c) ? c : c + Array.from({ length: n }, () => pick(MARKS)).join(''))).join('');

const MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.', '@': '.--.-.', '-': '-....-' };
const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
const toMorse = t => [...t.toLowerCase()].map(c => (c === ' ' ? '/' : MORSE[c] || '')).filter(Boolean).join(' ');
const fromMorse = t => t.trim().split(/\s*\/\s*|\s{3,}/).map(w => w.split(/\s+/).map(c => UNMORSE[c] || '?').join('')).join(' ');

/* ----------------------------------- colours ------------------------------------ */
const NAMED = { red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', black: '#000000', white: '#ffffff', gray: '#808080', grey: '#808080', brown: '#a52a2a', cyan: '#00ffff', magenta: '#ff00ff', gold: '#ffd700', teal: '#008080', navy: '#000080', maroon: '#800000', lime: '#00ff00', silver: '#c0c0c0' };
function parseColor(s) {
  s = String(s || '').trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  let m = s.match(/^#?([0-9a-f]{3})$/); if (m) s = '#' + [...m[1]].map(c => c + c).join('');
  m = s.match(/^#?([0-9a-f]{6})$/);
  if (m) { const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  m = s.match(/^rgb\(?\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*\)?$/);
  if (m && [1, 2, 3].every(i => Number(m[i]) <= 255)) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}
function fromHsl(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
async function swatch(colors, w = 600, h = 200) {
  const sharp = U.sharp();
  const cw = w / colors.length;
  const rects = colors.map((c, i) => `<rect x="${i * cw}" y="0" width="${cw}" height="${h}" fill="${c}"/><text x="${i * cw + cw / 2}" y="${h - 14}" font-family="sans-serif" font-size="16" text-anchor="middle" fill="${luma(parseColor(c)) > 140 ? '#111' : '#fff'}">${c}</text>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${rects}</svg>`)).png().toBuffer();
}
const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

/* ------------------------------- time zone helpers ------------------------------ */
function tzOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}
function zonedToUtc(y, mo, d, h, mi, tz) {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  guess -= tzOffsetMs(guess, tz);
  return guess - (tzOffsetMs(guess, tz) - tzOffsetMs(guess + 0, tz));
}
const validTz = tz => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const CITY_TZ = { nairobi: 'Africa/Nairobi', kenya: 'Africa/Nairobi', london: 'Europe/London', newyork: 'America/New_York', ny: 'America/New_York', losangeles: 'America/Los_Angeles', la: 'America/Los_Angeles', dubai: 'Asia/Dubai', mumbai: 'Asia/Kolkata', delhi: 'Asia/Kolkata', india: 'Asia/Kolkata', tokyo: 'Asia/Tokyo', sydney: 'Australia/Sydney', lagos: 'Africa/Lagos', johannesburg: 'Africa/Johannesburg', cairo: 'Africa/Cairo', paris: 'Europe/Paris', berlin: 'Europe/Berlin', moscow: 'Europe/Moscow', beijing: 'Asia/Shanghai', shanghai: 'Asia/Shanghai', singapore: 'Asia/Singapore', toronto: 'America/Toronto', saopaulo: 'America/Sao_Paulo', kampala: 'Africa/Kampala', dar: 'Africa/Dar_es_Salaam', accra: 'Africa/Accra', riyadh: 'Asia/Riyadh', utc: 'UTC', gmt: 'UTC' };
const toTz = s => { const k = String(s || '').toLowerCase().replace(/[\s_]/g, ''); return CITY_TZ[k] || (validTz(s) ? s : null); };

/* ------------------------------------ helpers ----------------------------------- */
const wrap = ctx => ({ P: ctx.var('PREFIX') });
const need = (ctx, usage) => { const t = ctx.input().trim(); if (!t) throw new UserError(`Usage: *${ctx.var('PREFIX')}${usage}*`); return t; };
const b32 = s => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '', out = []; for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += A.indexOf(c).toString(2).padStart(5, '0'); for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
function totp(secret, step = 30, digits = 6, now = Date.now()) {
  const key = b32(secret); if (!key.length) throw new UserError('That is not a valid base32 secret.');
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / step)));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits)).padStart(digits, '0');
}
const b64u = b => Buffer.from(b).toString('base64url');
const unb64u = s => Buffer.from(s, 'base64url').toString('utf8');
const WORDS = 'amber anchor autumn beacon breeze canyon cobalt copper crystal dawn ember falcon forest galaxy harbor horizon island jungle kernel lantern meadow meteor nectar ocean orchid pebble phoenix quartz river saffron silver summit sunrise thunder tundra velvet voyage willow zenith'.split(' ');
const FIRST = 'Amani Baraka Faith Grace Joseph Kevin Lucy Mercy Nia Omar Peter Rose Samuel Tabitha Wanjiru Zawadi Brian Cynthia David Esther Felix Halima Ian Janet'.split(' ');
const LAST = 'Mwangi Otieno Kamau Njoroge Wafula Kiptoo Achieng Hassan Mutua Njeri Odhiambo Karanja Omondi Chebet Mbugua Ndungu Okello Wekesa'.split(' ');
const EMOJIS = [...'😀😎🤖🔥🌈🍕🚀🎉🦄🐱🐶🌍⚡🍀🎧📚🏆💡🎯🌟🍉🦋🎸🧠🛸'];

module.exports = ({ def: rawDef, alias: rawAlias, registry }) => {
  // Never crash the whole bot because a name is already taken: skip the clashing name instead.
  const def = (names, opts, run) => { const n = [].concat(names).filter(x => !registry.has(x.toLowerCase())); if (n.length) rawDef(n, opts, run); };
  const alias = (existing, ...names) => { if (!registry.has(existing)) return; const f = names.filter(x => !registry.has(x.toLowerCase())); if (f.length) rawAlias(existing, ...f); };
  const P = ctx => ctx.var('PREFIX');

  /* --------------------------------- calculators --------------------------------- */
  def('calculator', { cat: 'tools', usage: 'calculator <expression>', desc: 'Calculate an expression, e.g. calculator (12+8)*3/4. Same as calc.' }, async ctx => registry.get('calc').run(ctx));
  def('percentage', { cat: 'tools', usage: 'percentage 20 of 150 • percentage 30 150 • percentage 50 to 75', desc: 'Percent of a number, what percent one number is of another, or % change.' }, async ctx => {
    const t = need(ctx, 'percentage 20 of 150');
    let m;
    if ((m = t.match(/^([\d.,]+)\s*%?\s*of\s*([\d.,]+)$/i))) return ctx.reply(`📐 ${m[1]}% of ${m[2]} = *${fmt(num(m[1]) * num(m[2]) / 100)}*`, { title: 'Percentage' });
    if ((m = t.match(/^([\d.,]+)\s*(?:to|->|→)\s*([\d.,]+)$/i))) { const a = num(m[1]), b = num(m[2]); return ctx.reply(`📈 Change from ${a} to ${b} = *${fmt((b - a) / a * 100, 2)}%*`, { title: 'Percentage' }); }
    if ((m = t.match(/^([\d.,]+)\s+([\d.,]+)$/))) return ctx.reply(`📐 ${m[1]} is *${fmt(num(m[1]) / num(m[2]) * 100, 2)}%* of ${m[2]}`, { title: 'Percentage' });
    throw new UserError('Try: *percentage 20 of 150*, *percentage 30 150* or *percentage 50 to 75*');
  });
  def(['average', 'avg'], { cat: 'tools', usage: 'average 4 8 15 16 23 42', desc: 'Mean, median, min, max and sum of a list of numbers.' }, async ctx => {
    const n = ctx.input().split(/[\s,;]+/).map(num).filter(Number.isFinite);
    if (!n.length) throw new UserError(`Usage: *${P(ctx)}average 4 8 15 16 23 42*`);
    const s = [...n].sort((a, b) => a - b), sum = n.reduce((a, b) => a + b, 0);
    const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    await ctx.reply(`🧮 Count: *${n.length}*\nSum: *${fmt(sum)}*\nMean: *${fmt(sum / n.length)}*\nMedian: *${fmt(med)}*\nMin: *${fmt(s[0])}*  •  Max: *${fmt(s[s.length - 1])}*`, { title: 'Average' });
  });
  def(['bmi'], { cat: 'tools', usage: 'bmi <kg> <cm>', desc: 'Body-mass index, e.g. bmi 70 175.' }, async ctx => {
    const [w, h] = ctx.argv.map(num);
    if (!(w > 0 && h > 0)) throw new UserError(`Usage: *${P(ctx)}bmi 70 175* (kg then cm)`);
    const v = w / ((h / 100) ** 2);
    const cls = v < 18.5 ? 'Underweight' : v < 25 ? 'Healthy range' : v < 30 ? 'Overweight' : 'Obese range';
    await ctx.reply(`⚖️ BMI: *${fmt(v, 1)}*\n📋 ${cls}\n\n_BMI is a rough screening number, not a diagnosis. Talk to a doctor about your health._`, { title: 'BMI' });
  });
  def(['calories', 'tdee'], { cat: 'tools', usage: 'calories <male|female> <age> <kg> <cm> [activity 1.2-1.9]', desc: 'Estimate daily calorie needs (Mifflin-St Jeor).' }, async ctx => {
    const [sex, age, w, h, act] = [ctx.argv[0], ...ctx.argv.slice(1).map(num)];
    if (!/^(male|female|m|f)$/i.test(sex || '') || !(age > 0 && w > 0 && h > 0)) throw new UserError(`Usage: *${P(ctx)}calories male 25 70 175 1.4*`);
    const bmr = 10 * w + 6.25 * h - 5 * age + (/^m/i.test(sex) ? 5 : -161);
    const f = act >= 1.2 && act <= 2.2 ? act : 1.4;
    await ctx.reply(`🔥 Resting (BMR): *${Math.round(bmr)} kcal/day*\n🏃 With activity ×${f}: *${Math.round(bmr * f)} kcal/day*\n\n_An estimate only. Activity: 1.2 desk job • 1.4 light • 1.6 active • 1.8 very active._`, { title: 'Calories' });
  });
  def(['water', 'hydration'], { cat: 'tools', usage: 'water <kg>', desc: 'Rough daily water target for your body weight.' }, async ctx => {
    const w = num(ctx.argv[0]);
    if (!(w > 0)) throw new UserError(`Usage: *${P(ctx)}water 70* (your weight in kg)`);
    await ctx.reply(`💧 About *${fmt(w * 0.035, 1)} litres* a day (${Math.round(w * 35)} ml), a bit more when it is hot or you exercise.`, { title: 'Water' });
  });

  /* ------------------------------- unit conversion ------------------------------- */
  const convReply = async (ctx, v, from, to) => {
    if (!Number.isFinite(v)) throw new UserError('Give a number to convert.');
    const r = convert(v, from, to);
    await ctx.reply(`🔁 ${fmt(v)} ${from} = *${from.toLowerCase() === 'bytes' || unitCategory(to) === 'data' ? fmt(r, 4) : fmt(r)} ${to}*`, { title: 'Convert' });
  };
  def(['unitconvert', 'uconvert'], { cat: 'tools', usage: 'unitconvert 10 km mi', desc: 'Convert length, weight, volume, area, speed, data size and temperature.' }, async ctx => {
    const [v, from, to] = ctx.argv;
    if (!from || !to) throw new UserError(`Usage: *${P(ctx)}unitconvert 10 km mi*`);
    await convReply(ctx, num(v), from, to);
  });
  for (const [cat, hint] of [['length', 'length 5 km mi'], ['weight', 'weight 70 kg lb'], ['area', 'area 3 acre m2'], ['speed', 'speed 100 kmh mph'], ['temperature', 'temperature 30 c f']]) {
    def(cat, { cat: 'tools', usage: hint, desc: `Convert ${cat} units.` }, async ctx => {
      const [v, from, to] = ctx.argv;
      if (!from || !to) throw new UserError(`Usage: *${P(ctx)}${hint}*`);
      const c = unitCategory(from.toLowerCase());
      if (c && c !== (cat === 'temperature' ? 'temp' : cat)) throw new UserError(`*${from}* is not a ${cat} unit.`);
      await convReply(ctx, num(v), from, to);
    });
  }
  alias('speed', 'speedconvert');
  // "volume" means two things: unit conversion (volume 2 l gal) or audio loudness (reply to audio: volume 1.5).
  def('volume', { cat: 'tools', usage: 'volume 2 l gal • or reply to audio: volume 1.5', desc: 'Convert volume units, or change the loudness of a replied audio/video.' }, async ctx => {
    if (ctx.argv.length >= 3) return convReply(ctx, num(ctx.argv[0]), ctx.argv[1], ctx.argv[2]);
    const t = registry.get('audiovolume');
    if (!t) throw new UserError(`Usage: *${P(ctx)}volume 2 l gal*`);
    return t.run(ctx);
  });
  const quick = (name, from, to, desc) => def(name, { cat: 'tools', usage: `${name} <number>`, desc }, async ctx => convReply(ctx, num(ctx.argv[0]), from, to));
  quick('km', 'km', 'mi', 'Kilometres to miles.'); quick('miles', 'mi', 'km', 'Miles to kilometres.');
  quick('kg', 'kg', 'lb', 'Kilograms to pounds.'); quick('pounds', 'lb', 'kg', 'Pounds to kilograms.');
  quick('celsius', 'c', 'f', 'Celsius to Fahrenheit.'); quick('fahrenheit', 'f', 'c', 'Fahrenheit to Celsius.');
  quick('liters', 'l', 'gal', 'Litres to US gallons.'); quick('gallons', 'gal', 'l', 'US gallons to litres.');
  def(['bytes', 'filesize'], { cat: 'tools', usage: 'bytes <number>', desc: 'Turn a byte count into KB/MB/GB.' }, async ctx => { const n = num(ctx.argv[0]); if (!(n >= 0)) throw new UserError(`Usage: *${P(ctx)}bytes 1048576*`); await ctx.reply(`💾 ${fmt(n)} bytes = *${prettyBytes(n)}*`, { title: 'Bytes' }); });
  def('mb', { cat: 'tools', usage: 'mb <megabytes>', desc: 'Megabytes to KB / GB.' }, async ctx => { const n = num(ctx.argv[0]); if (!(n >= 0)) throw new UserError(`Usage: *${P(ctx)}mb 2048*`); await ctx.reply(`💾 ${fmt(n)} MB = *${fmt(n * 1024, 2)} KB* = *${fmt(n / 1024, 4)} GB*`, { title: 'MB' }); });
  def('gb', { cat: 'tools', usage: 'gb <gigabytes>', desc: 'Gigabytes to MB / TB.' }, async ctx => { const n = num(ctx.argv[0]); if (!(n >= 0)) throw new UserError(`Usage: *${P(ctx)}gb 2*`); await ctx.reply(`💾 ${fmt(n)} GB = *${fmt(n * 1024, 2)} MB* = *${fmt(n / 1024, 6)} TB*`, { title: 'GB' }); });

  /* ------------------------------- random generators ------------------------------ */
  def(['random', 'randomnumber', 'rand'], { cat: 'tools', usage: 'random [min] [max]', desc: 'A random whole number (default 1-100).' }, async ctx => {
    let [a, b] = ctx.argv.map(num);
    if (!Number.isFinite(a)) { a = 1; b = 100; } else if (!Number.isFinite(b)) { b = a; a = 1; }
    if (a > b) [a, b] = [b, a];
    await ctx.reply(`🎲 *${a + Math.floor(Math.random() * (b - a + 1))}*  _(between ${a} and ${b})_`, { title: 'Random' });
  });
  def('randomchoice', { cat: 'tools', usage: 'randomchoice pizza | burger | salad', desc: 'Pick one option at random.' }, async ctx => {
    const o = need(ctx, 'randomchoice pizza | burger | salad').split(/\s*[|,]\s*|\s+or\s+/i).filter(Boolean);
    if (o.length < 2) throw new UserError('Give at least two options separated by | or commas.');
    await ctx.reply(`🎯 I pick: *${pick(o)}*`, { title: 'Random choice' });
  });
  def('randomword', { cat: 'tools', desc: 'A random word.' }, ctx => ctx.reply(`🔤 *${pick(WORDS)}*`, { title: 'Random word' }));
  def('randomemoji', { cat: 'tools', desc: 'A random emoji.' }, ctx => ctx.reply(pick(EMOJIS), { title: 'Random emoji' }));
  def('randomname', { cat: 'tools', desc: 'A random full name.' }, ctx => ctx.reply(`🧑 *${pick(FIRST)} ${pick(LAST)}*`, { title: 'Random name' }));
  def('randomstring', { cat: 'tools', usage: 'randomstring [length]', desc: 'A random letters-and-digits string (default 16).' }, async ctx => {
    const n = Math.min(200, Math.max(1, Math.floor(num(ctx.argv[0])) || 16));
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    await ctx.reply('`' + Array.from({ length: n }, () => A[crypto.randomInt(A.length)]).join('') + '`', { title: 'Random string' });
  });
  def('randomcolor', { cat: 'tools', desc: 'A random colour swatch.' }, async ctx => {
    const c = hex([crypto.randomInt(256), crypto.randomInt(256), crypto.randomInt(256)]);
    await ctx.image(await swatch([c], 400, 200), `🎨 ${c}`);
  });
  def(['token', 'randomtoken'], { cat: 'tools', usage: 'token [bytes]', desc: 'A secure random hex token (default 32 bytes).' }, async ctx => {
    const n = Math.min(128, Math.max(4, Math.floor(num(ctx.argv[0])) || 32));
    await ctx.reply('`' + crypto.randomBytes(n).toString('hex') + '`', { title: 'Token' });
  });

  /* ----------------------------- encode / decode / hash ----------------------------- */
  const ENC = {
    base64: [t => Buffer.from(t).toString('base64'), t => Buffer.from(t, 'base64').toString('utf8')],
    hex: [t => Buffer.from(t).toString('hex'), t => Buffer.from(t.replace(/\s+/g, ''), 'hex').toString('utf8')],
    binary: [t => [...Buffer.from(t)].map(b => b.toString(2).padStart(8, '0')).join(' '), t => Buffer.from(t.trim().split(/\s+/).map(b => parseInt(b, 2)).filter(Number.isFinite)).toString('utf8')],
    url: [encodeURIComponent, decodeURIComponent],
    morse: [toMorse, fromMorse]
  };
  const encDec = (ctx, dir) => {
    const [type, ...rest] = ctx.input().trim().split(/\s+/);
    const t = rest.join(' ');
    if (!ENC[(type || '').toLowerCase()] || !t) throw new UserError(`Usage: *${P(ctx)}${dir ? 'decode' : 'encode'} <${Object.keys(ENC).join('|')}> <text>*`);
    let out; try { out = ENC[type.toLowerCase()][dir](t); } catch { throw new UserError('That text is not valid for that format.'); }
    return ctx.reply(out || '(empty)', { title: dir ? 'Decoded' : 'Encoded' });
  };
  def('encode', { cat: 'tools', usage: 'encode <base64|hex|binary|url|morse> <text>', desc: 'Encode text.' }, ctx => encDec(ctx, 0));
  def('decode', { cat: 'tools', usage: 'decode <base64|hex|binary|url|morse> <text>', desc: 'Decode text.' }, ctx => encDec(ctx, 1));
  for (const t of ['hex', 'binary']) def(t, { cat: 'tools', usage: `${t} <text or ${t}>`, desc: `Text to ${t}, or ${t} back to text.` }, async ctx => {
    const x = need(ctx, `${t} hello`);
    const isEnc = t === 'hex' ? /^([0-9a-f]{2}\s*)+$/i.test(x) && x.replace(/\s/g, '').length % 2 === 0 : /^([01]{8}\s*)+$/.test(x);
    await ctx.reply(isEnc ? ENC[t][1](x) : ENC[t][0](x), { title: t });
  });
  for (const algo of ['md5', 'sha256', 'sha1', 'sha512']) def(algo, { cat: 'tools', usage: `${algo} <text>`, desc: `${algo.toUpperCase()} hash of some text.` }, async ctx => ctx.reply('`' + crypto.createHash(algo).update(need(ctx, `${algo} hello`)).digest('hex') + '`', { title: algo.toUpperCase() }));
  def(['morse', 'morsecode'], { cat: 'tools', usage: 'morse <text or morse>', desc: 'Text to Morse code, or Morse back to text.' }, async ctx => {
    const t = need(ctx, 'morse hello world');
    await ctx.reply(/^[.\-/\s]+$/.test(t) ? fromMorse(t) : toMorse(t), { title: 'Morse' });
  });

  /* ------------------------------------ text styles ------------------------------------ */
  const styled = (name, fn, desc) => def(name, { cat: 'tools', usage: `${name} <text>`, desc }, ctx => ctx.reply(fn(need(ctx, `${name} hello`)), { title: name }));
  styled('boldtext', STYLES.bold, '𝐁𝐨𝐥𝐝 text.'); styled('italictext', STYLES.italic, '𝐼𝑡𝑎𝑙𝑖𝑐 text.');
  styled('smalltext', smallCaps, 'Small-caps text.'); styled('upside', upsideDown, 'Upside-down text.');
  styled('zalgo', t => zalgo(t, 5), 'Z̷a̸l̶g̵o̷ glitch text.'); styled('glitchtext', t => zalgo(t, 2), 'Light glitch text.');
  def(['fonts', 'font'], { cat: 'tools', usage: 'fonts <text>', desc: 'Show your text in many Unicode font styles.' }, async ctx => {
    const t = need(ctx, 'fonts hello');
    await ctx.reply([...Object.entries(STYLES).map(([k, f]) => `*${k}*: ${f(t)}`), `*smallcaps*: ${smallCaps(t)}`, `*upside*: ${upsideDown(t)}`].join('\n'), { title: 'Fonts' });
  });

  /* ------------------------------------- colours ------------------------------------- */
  def(['colorinfo', 'colourinfo'], { cat: 'tools', usage: 'colorinfo #ff8800 | rgb(255,136,0) | red', desc: 'HEX, RGB and HSL of a colour, with a swatch.' }, async ctx => {
    const rgb = parseColor(need(ctx, 'colorinfo #ff8800'));
    if (!rgb) throw new UserError('I could not read that colour. Try #ff8800, rgb(255,136,0) or a name like red.');
    const [h, s, l] = hsl(rgb);
    await ctx.image(await swatch([hex(rgb)], 400, 160), `🎨 HEX *${hex(rgb)}*\nRGB *${rgb.join(', ')}*\nHSL *${h}°, ${s}%, ${l}%*`);
  });
  def('colorpicker', { cat: 'tools', usage: 'colorpicker [#hex]', desc: 'Pick a colour: a random one, or the shades of one you give.' }, async ctx => {
    const base = ctx.argv[0] ? parseColor(ctx.argv[0]) : [crypto.randomInt(256), crypto.randomInt(256), crypto.randomInt(256)];
    if (!base) throw new UserError('I could not read that colour.');
    const [h, s] = hsl(base);
    const shades = [20, 35, 50, 65, 80].map(l => hex(fromHsl(h, s, l)));
    await ctx.image(await swatch(shades, 750, 200), `🎨 Base *${hex(base)}* — five shades from dark to light`);
  });
  def('palette', { cat: 'tools', usage: 'palette [#hex]', desc: 'A five-colour palette built around a colour (random if none given).' }, async ctx => {
    const base = ctx.argv[0] ? parseColor(ctx.argv[0]) : [crypto.randomInt(256), crypto.randomInt(256), crypto.randomInt(256)];
    if (!base) throw new UserError('I could not read that colour.');
    const [h, s, l] = hsl(base);
    const cols = [h, h + 30, h + 180, h + 210, h - 30].map((x, i) => hex(fromHsl((x + 360) % 360, s, i === 2 ? Math.min(90, l + 15) : l)));
    await ctx.image(await swatch(cols, 750, 200), `🎨 Palette: ${cols.join('  ')}`);
  });
  def(['gradient', 'cssgradient'], { cat: 'tools', usage: 'gradient #ff0000 #0000ff', desc: 'A two-colour gradient image plus its CSS.' }, async ctx => {
    const a = parseColor(ctx.argv[0]), b = parseColor(ctx.argv[1]);
    if (!a || !b) throw new UserError(`Usage: *${P(ctx)}gradient #ff0000 #0000ff*`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hex(a)}"/><stop offset="1" stop-color="${hex(b)}"/></linearGradient></defs><rect width="700" height="300" fill="url(#g)"/></svg>`;
    await ctx.image(await U.sharp()(Buffer.from(svg)).png().toBuffer(), `background: linear-gradient(135deg, ${hex(a)}, ${hex(b)});`);
  });
  def('shadow', { cat: 'tools', usage: 'shadow [x] [y] [blur] [#color]', desc: 'CSS box-shadow code.' }, ctx => { const [x = 0, y = 4, b = 12, c = 'rgba(0,0,0,.25)'] = ctx.argv; return ctx.reply('```box-shadow: ' + `${x}px ${y}px ${b}px ${c};` + '```', { title: 'CSS shadow' }); });
  def('border', { cat: 'tools', usage: 'border [width] [style] [#color] [radius]', desc: 'CSS border code.' }, ctx => { const [w = 1, s = 'solid', c = '#333', r = 8] = ctx.argv; return ctx.reply('```' + `border: ${w}px ${s} ${c};\nborder-radius: ${r}px;` + '```', { title: 'CSS border' }); });
  def('flexbox', { cat: 'tools', usage: 'flexbox [row|column] [center|space-between|...]', desc: 'CSS flexbox snippet.' }, ctx => { const [dir = 'row', jc = 'center'] = ctx.argv; return ctx.reply('```.container {\n  display: flex;\n  flex-direction: ' + dir + ';\n  justify-content: ' + jc + ';\n  align-items: center;\n  gap: 16px;\n}```', { title: 'CSS flexbox' }); });
  def('grid', { cat: 'tools', usage: 'grid [columns] [gap]', desc: 'CSS grid snippet.' }, ctx => { const c = Math.min(12, Math.max(1, Math.floor(num(ctx.argv[0])) || 3)); return ctx.reply('```.grid {\n  display: grid;\n  grid-template-columns: repeat(' + c + ', 1fr);\n  gap: ' + (ctx.argv[1] || 16) + 'px;\n}```', { title: 'CSS grid' }); });

  /* ----------------------------------- JSON & validation ----------------------------------- */
  const json = (ctx, indent) => {
    const t = need(ctx, `${ctx.cmd} {"a":1}`);
    let v; try { v = JSON.parse(t); } catch (e) { throw new UserError('That is not valid JSON: ' + String(e.message).slice(0, 120)); }
    return ctx.reply('```' + JSON.stringify(v, null, indent) + '```', { title: indent ? 'JSON' : 'JSON (minified)' });
  };
  def(['jsonformat', 'beautify', 'format', 'prettyjson'], { cat: 'tools', usage: 'jsonformat <json>', desc: 'Pretty-print JSON (also reads a replied message).' }, ctx => json(ctx, 2));
  def(['jsonminify', 'minify'], { cat: 'tools', usage: 'jsonminify <json>', desc: 'Minify JSON.' }, ctx => json(ctx, 0));
  def('validate', { cat: 'tools', usage: 'validate <email|url|json|ip|phone> <value>', desc: 'Check whether a value is a valid email, URL, JSON, IP address or phone number.' }, async ctx => {
    const [type, ...r] = ctx.input().trim().split(/\s+/); const v = r.join(' ');
    const T = {
      email: x => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x), url: x => { try { return ['http:', 'https:'].includes(new URL(x).protocol); } catch { return false; } },
      json: x => { try { JSON.parse(x); return true; } catch { return false; } }, ip: x => require('net').isIP(x) > 0, phone: x => /^\+?\d{8,15}$/.test(x.replace(/[\s()-]/g, ''))
    };
    if (!T[(type || '').toLowerCase()] || !v) throw new UserError(`Usage: *${P(ctx)}validate <${Object.keys(T).join('|')}> <value>*`);
    await ctx.reply(T[type.toLowerCase()](v) ? `✅ Valid ${type}` : `❌ Not a valid ${type}`, { title: 'Validate' });
  });
  def('regex', { cat: 'tools', usage: 'regex <pattern> | <text>', desc: 'Test a regular expression against some text, e.g. regex \\d+ | a1b22c333' }, async ctx => {
    const [pat, ...rest] = need(ctx, 'regex \\d+ | a1b22c333').split('|'); const text = rest.join('|').trim();
    if (!text) throw new UserError(`Usage: *${P(ctx)}regex \\d+ | a1b22c333*`);
    let re; try { re = new RegExp(pat.trim(), 'g'); } catch (e) { throw new UserError('Bad pattern: ' + e.message); }
    const out = []; let m; const t0 = Date.now();
    while ((m = re.exec(text)) && out.length < 20) { out.push(`• "${m[0]}" at ${m.index}${m.length > 1 ? ' groups: ' + m.slice(1).map(g => `"${g}"`).join(', ') : ''}`); if (m[0] === '') re.lastIndex++; if (Date.now() - t0 > 500) break; }
    await ctx.reply(out.length ? `🔎 ${out.length} match(es)\n${out.join('\n')}` : '🔎 No matches.', { title: 'Regex' });
  });

  /* ---------------------------------- passwords, OTP, JWT ---------------------------------- */
  def(['passwordstrength', 'checkpassword', 'pwcheck'], { cat: 'tools', usage: 'passwordstrength <password>', desc: 'Rate a password (do not use a real one in a group).' }, async ctx => {
    const p = need(ctx, 'passwordstrength Tr0ub4dor&3');
    let pool = 0; if (/[a-z]/.test(p)) pool += 26; if (/[A-Z]/.test(p)) pool += 26; if (/\d/.test(p)) pool += 10; if (/[^A-Za-z0-9]/.test(p)) pool += 32;
    const bits = Math.round(p.length * Math.log2(pool || 1));
    const common = /^(password|123456|qwerty|admin|letmein|welcome|iloveyou)/i.test(p);
    const label = common || bits < 36 ? '🔴 Weak' : bits < 60 ? '🟠 Fair' : bits < 80 ? '🟡 Good' : '🟢 Strong';
    const tips = [p.length < 12 && 'use 12+ characters', !/[A-Z]/.test(p) && 'add capitals', !/\d/.test(p) && 'add digits', !/[^A-Za-z0-9]/.test(p) && 'add symbols', common && 'avoid common passwords'].filter(Boolean);
    await ctx.reply(`🔐 ${label}\nLength ${p.length} • about ${bits} bits\n${tips.length ? '💡 ' + tips.join(', ') : '👍 Looks good.'}\n\n_Checked on the bot only; delete this message and never share real passwords in chats._`, { title: 'Password check' });
  });
  alias('password', 'passwordgen', 'generatepassword', 'genpass');
  def('otp', { cat: 'tools', usage: 'otp [base32 secret]', desc: 'No secret: a random 6-digit code. With a TOTP secret: the current authenticator code.' }, async ctx => {
    const s = ctx.argv[0];
    if (!s) return ctx.reply(`🔢 *${String(crypto.randomInt(1000000)).padStart(6, '0')}*`, { title: 'Random code' });
    const left = 30 - (Math.floor(Date.now() / 1000) % 30);
    await ctx.reply(`🔢 *${totp(s)}*  _(valid for ~${left}s)_\n\n_Delete your message afterwards, a secret in chat is no longer secret._`, { title: 'TOTP' });
  });
  const jwtParts = t => { const p = t.trim().split('.'); if (p.length !== 3) throw new UserError('That does not look like a JWT (three dot-separated parts).'); try { return [JSON.parse(unb64u(p[0])), JSON.parse(unb64u(p[1])), p]; } catch { throw new UserError('Could not decode that JWT.'); } };
  def(['jwt', 'jwtdecode'], { cat: 'tools', usage: 'jwtdecode <token>', desc: 'Decode a JWT header and payload (does not verify it).' }, async ctx => {
    const [h, p] = jwtParts(need(ctx, 'jwtdecode <token>'));
    const exp = p.exp ? `\n⏰ Expires: ${new Date(p.exp * 1000).toISOString()}${p.exp * 1000 < Date.now() ? ' (expired)' : ''}` : '';
    await ctx.reply('Header:\n```' + JSON.stringify(h, null, 2) + '```\nPayload:\n```' + JSON.stringify(p, null, 2) + '```' + exp + '\n\n_Decoded only — not verified._', { title: 'JWT' });
  });
  def('jwtverify', { cat: 'tools', usage: 'jwtverify <token> <secret>', desc: 'Verify an HS256/HS384/HS512 JWT signature with a shared secret.' }, async ctx => {
    const [tok, ...sec] = ctx.argv; if (!tok || !sec.length) throw new UserError(`Usage: *${P(ctx)}jwtverify <token> <secret>*`);
    const [h, , p] = jwtParts(tok);
    const alg = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' }[h.alg];
    if (!alg) throw new UserError(`I can only verify HS256/384/512 tokens (this one is ${h.alg || 'unknown'}).`);
    const sig = crypto.createHmac(alg, sec.join(' ')).update(`${p[0]}.${p[1]}`).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(p[2]);
    await ctx.reply(a.length === b.length && crypto.timingSafeEqual(a, b) ? '✅ Signature is valid.' : '❌ Signature does NOT match.', { title: 'JWT verify' });
  });

  /* ------------------------------------ time & zones ------------------------------------ */
  def('timestamp', { cat: 'tools', desc: 'The current Unix timestamp and ISO time.' }, ctx => ctx.reply(`🕒 Unix: *${Math.floor(Date.now() / 1000)}*\nMillis: *${Date.now()}*\nISO: *${new Date().toISOString()}*`, { title: 'Timestamp' }));
  def(['unix', 'epoch'], { cat: 'tools', usage: 'unix <seconds|date>', desc: 'Unix time to a date, or a date to Unix time.' }, async ctx => {
    const t = need(ctx, 'unix 1700000000');
    const d = /^\d{9,13}$/.test(t) ? new Date(t.length > 11 ? Number(t) : Number(t) * 1000) : new Date(t);
    if (Number.isNaN(d.getTime())) throw new UserError('I could not read that date. Try 1700000000 or 2026-01-31 14:00.');
    await ctx.reply(`🕒 ${d.toISOString()}\nUnix: *${Math.floor(d.getTime() / 1000)}*\nYour zone: ${d.toLocaleString('en-GB', { timeZone: ctx.tz ? ctx.tz() : 'UTC' })}`, { title: 'Unix time' });
  });
  def('timeconvert', { cat: 'tools', usage: 'timeconvert 14:30 nairobi newyork', desc: 'Convert a clock time between zones or cities (today\'s date).' }, async ctx => {
    const [t, f, to] = ctx.argv; const m = (t || '').match(/^(\d{1,2}):(\d{2})$/);
    const fz = toTz(f), tz = toTz(to);
    if (!m || !fz || !tz) throw new UserError(`Usage: *${P(ctx)}timeconvert 14:30 nairobi newyork* (cities or zones like Africa/Nairobi)`);
    const now = new Date(); const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: fz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(x => [x.type, x.value]));
    const utc = zonedToUtc(Number(p.year), Number(p.month), Number(p.day), Number(m[1]), Number(m[2]), fz);
    const out = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(utc));
    await ctx.reply(`🌍 ${t} in ${fz} = *${out}* in ${tz}`, { title: 'Time convert' });
  });
  def(['worldclock', 'clock'], { cat: 'tools', usage: 'worldclock [city city ...]', desc: 'Current time in major cities (or the ones you list).' }, async ctx => {
    const list = ctx.argv.length ? ctx.argv.map(c => [c, toTz(c)]).filter(x => x[1]) : [['Nairobi', 'Africa/Nairobi'], ['London', 'Europe/London'], ['New York', 'America/New_York'], ['Dubai', 'Asia/Dubai'], ['Mumbai', 'Asia/Kolkata'], ['Tokyo', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney']];
    if (!list.length) throw new UserError('I did not recognise those cities. Try nairobi, london, newyork, dubai, tokyo or a zone like Africa/Lagos.');
    await ctx.reply(list.map(([n, z]) => `🕒 *${n}*: ${new Intl.DateTimeFormat('en-GB', { timeZone: z, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())}`).join('\n'), { title: 'World clock' });
  });

  /* ------------------------------------- QR variants ------------------------------------- */
  const qrImg = async (ctx, text, label) => ctx.image(await require('qrcode').toBuffer(text, { width: 600, margin: 2 }), label);
  alias('qr', 'qrcode', 'toqr', 'fromqr');
  def('textqr', { cat: 'tools', usage: 'textqr <text>', desc: 'QR code for any text.' }, ctx => qrImg(ctx, need(ctx, 'textqr hello'), '📱 QR code'));
  def('urlqr', { cat: 'tools', usage: 'urlqr <link>', desc: 'QR code for a web link.' }, ctx => { let u = need(ctx, 'urlqr example.com'); if (!/^https?:\/\//i.test(u)) u = 'https://' + u; return qrImg(ctx, u, `🔗 ${u}`); });
  def('emailqr', { cat: 'tools', usage: 'emailqr <address> [subject]', desc: 'QR code that opens a new email.' }, ctx => { const [a, ...s] = ctx.argv; if (!a || !a.includes('@')) throw new UserError(`Usage: *${P(ctx)}emailqr me@example.com Hello*`); return qrImg(ctx, `mailto:${a}${s.length ? '?subject=' + encodeURIComponent(s.join(' ')) : ''}`, `✉️ ${a}`); });
  def('wifiqr', { cat: 'tools', usage: 'wifiqr <network name> <password> [WPA|WEP|nopass]', desc: 'QR code that joins a Wi-Fi network when scanned.' }, async ctx => {
    const a = ctx.argv; if (a.length < 2) throw new UserError(`Usage: *${P(ctx)}wifiqr HomeWifi mypassword WPA* (names with spaces: use underscores)`);
    const sec = /^(WPA|WEP|nopass)$/i.test(a[a.length - 1]) && a.length > 2 ? a.pop().toUpperCase() : 'WPA';
    const esc = s => s.replace(/([\\;,":])/g, '\\$1');
    await qrImg(ctx, `WIFI:T:${sec === 'NOPASS' ? 'nopass' : sec};S:${esc(a[0].replace(/_/g, ' '))};P:${esc(a.slice(1).join(' '))};;`, `📶 ${a[0].replace(/_/g, ' ')} — scan to join\n_Delete this message if the password is private._`);
  });
  def('locationqr', { cat: 'tools', usage: 'locationqr <lat> <lon>', desc: 'QR code that opens a map location.' }, ctx => { const [la, lo] = ctx.argv.map(num); if (!(Math.abs(la) <= 90 && Math.abs(lo) <= 180)) throw new UserError(`Usage: *${P(ctx)}locationqr -1.286 36.817*`); return qrImg(ctx, `geo:${la},${lo}`, `📍 ${la}, ${lo}`); });
  def(['contactcard', 'makevcard'], { cat: 'tools', usage: 'contactcard <name> | <phone> [| email]', desc: 'Create a contact card (.vcf) you can share.' }, async ctx => {
    const [name, phone, email] = need(ctx, 'contactcard Jane Doe | +254700000000').split('|').map(s => s.trim());
    if (!name || !/^\+?\d{6,15}$/.test((phone || '').replace(/[\s()-]/g, ''))) throw new UserError(`Usage: *${P(ctx)}contactcard Jane Doe | +254700000000 | jane@mail.com*`);
    const v = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;TYPE=CELL:${phone}\n${email ? `EMAIL:${email}\n` : ''}END:VCARD\n`;
    await ctx.doc(Buffer.from(v), `${name.replace(/[^\w ]/g, '')}.vcf`, 'text/vcard');
  });
};

module.exports.helpers = { convert, parseColor, hsl, toMorse, fromMorse, totp, zonedToUtc, STYLES, prettyBytes, swatch, fmt };
