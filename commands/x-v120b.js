'use strict';
/**
 * DECAN XMD v1.2.0 — second pack: fonts, text tools, finance, dates, dev helpers, converters.
 * Everything is computed locally (no third-party API).
 */
const U = require('../lib/util');
const fonts = require('../lib/fonts');
const H = require('./x-v120').__test;
const { UserError } = U;
const { num, parseDate, money, fmtDate, todayUtc, dayDiff } = H;
const SINCE = '1.2.0';

const NATO = { a: 'Alfa', b: 'Bravo', c: 'Charlie', d: 'Delta', e: 'Echo', f: 'Foxtrot', g: 'Golf', h: 'Hotel', i: 'India', j: 'Juliett', k: 'Kilo', l: 'Lima', m: 'Mike', n: 'November', o: 'Oscar', p: 'Papa', q: 'Quebec', r: 'Romeo', s: 'Sierra', t: 'Tango', u: 'Uniform', v: 'Victor', w: 'Whiskey', x: 'X-ray', y: 'Yankee', z: 'Zulu', 0: 'Zero', 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine' };
const STONES = ['Garnet', 'Amethyst', 'Aquamarine', 'Diamond', 'Emerald', 'Pearl', 'Ruby', 'Peridot', 'Sapphire', 'Opal', 'Topaz', 'Turquoise'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const toUwu = t => t.replace(/[rl]/g, 'w').replace(/[RL]/g, 'W').replace(/n([aeiou])/g, 'ny$1').replace(/N([aeiou])/g, 'Ny$1').replace(/N([AEIOU])/g, 'NY$1').replace(/ove/g, 'uv') + ' uwu';
const toLeet = t => t.replace(/[aeiost]/gi, c => ({ a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' })[c.toLowerCase()]);
function pig(word) {
  const m = word.match(/^([^aeiouAEIOU]*)(.*)$/);
  let out = !m[1] ? word + 'way' : m[2] + m[1].toLowerCase() + 'ay';
  if (m[1] && /^[A-Z]/.test(word)) out = out[0].toUpperCase() + out.slice(1);
  return out;
}
const toPig = t => t.replace(/[A-Za-z]+/g, pig);

/** Parse #fff, #ff8800, ff8800, "255,136,0", "rgb 255 136 0" -> [r,g,b] or null. */
function parseColor(s) {
  s = String(s).trim().toLowerCase();
  let m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) { let h = m[1]; if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
  m = s.match(/^(?:rgb\s*\(?\s*)?(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*\)?$/);
  if (m) { const v = m.slice(1).map(Number); return v.every(x => x <= 255) ? v : null; }
  return null;
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function ipcalc(input) {
  const m = String(input).trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/);
  if (!m) return null;
  const oct = m.slice(1, 5).map(Number), pre = m[5] === undefined ? 24 : Number(m[5]);
  if (oct.some(x => x > 255) || pre > 32) return null;
  const ip = ((oct[0] << 24) | (oct[1] << 16) | (oct[2] << 8) | oct[3]) >>> 0;
  const mask = pre === 0 ? 0 : (0xFFFFFFFF << (32 - pre)) >>> 0;
  const net = (ip & mask) >>> 0, bc = (net | (~mask >>> 0)) >>> 0;
  const str = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  const hosts = pre >= 31 ? (pre === 32 ? 1 : 2) : Math.pow(2, 32 - pre) - 2;
  return { ip: str(ip), prefix: pre, mask: str(mask), network: str(net), broadcast: str(bc), first: pre >= 31 ? str(net) : str(net + 1), last: pre >= 31 ? str(bc) : str(bc - 1), hosts };
}

function isoWeek(d) { // d: UTC-midnight Date
  const t = new Date(d); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return { week: 1 + Math.round(((t - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7), year: t.getUTCFullYear() };
}
function businessDays(a, b) { // inclusive both ends; a <= b
  let n = 0; for (let t = a.getTime(); t <= b.getTime(); t += 864e5) { const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) n++; } return n;
}
const hhmm = mins => { mins = ((Math.round(mins) % 1440) + 1440) % 1440; return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; };
const parseClock = s => { const m = String(s || '').match(/^(\d{1,2})[:.h]?(\d{2})?\s*(am|pm)?$/i); if (!m) return null; let h = +m[1]; const mi = +(m[2] || 0); const ap = (m[3] || '').toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; return h < 24 && mi < 60 ? h * 60 + mi : null; };
const generation = y => (y <= 1927 ? 'Greatest Generation' : y <= 1945 ? 'Silent Generation' : y <= 1964 ? 'Baby Boomer' : y <= 1980 ? 'Generation X' : y <= 1996 ? 'Millennial' : y <= 2012 ? 'Generation Z' : y <= 2024 ? 'Generation Alpha' : 'Generation Beta');

module.exports = ({ def }) => {
  const D = (names, opts, run) => def(names, { since: SINCE, ...opts }, run);
  const P = ctx => ctx.var('PREFIX') || '.';
  const cur = ctx => ctx.var('CURRENCY') || 'KES';
  const text = ctx => String(ctx.input() || '').trim();
  const lines = ctx => String(ctx.input() || '').replace(/\r/g, '').split('\n').map(l => l.trimEnd());
  const need = (ctx, usage) => { const t = text(ctx); if (!t) throw new UserError(`Usage: *${P(ctx)}${usage}*`); return t; };

  /* ============================== FONTS ============================== */
  D('style', { cat: 'tools', usage: 'style <font name or number> <text>', desc: 'Write text in any of 29 Unicode fonts (see fontlist).' }, async ctx => {
    const key = ctx.argv[0]; const f = fonts.find(key);
    const body = ctx.args.replace(/^\S+\s*/, '').trim() || (ctx.quoted ? text(ctx) : '');
    if (!f || !body) throw new UserError(`Usage: *${P(ctx)}style <font> <text>*  e.g. *${P(ctx)}style script Hello*\nSee all fonts: *${P(ctx)}fontlist*`);
    await ctx.reply(f.fn(body), { title: `Style: ${f.label || f.id}` });
  });
  D('fontlist', { cat: 'tools', usage: 'fontlist [sample text]', desc: 'Preview every font style with its number.' }, async ctx => {
    const sample = (text(ctx) || 'Decan XMD').slice(0, 24);
    await ctx.reply(`${fonts.list().map(s => `${s.n < 10 ? ' ' : ''}*${s.n}.* ${s.fn(sample)}  _${s.label}_`).join('\n')}\n\nUse: *${P(ctx)}style <number or name> <text>*`, { title: 'Fonts' });
  });
  for (const [name, id, label] of [['bold', 'bold', 'bold'], ['italic', 'italic', 'italic'], ['mono', 'mono', 'monospace'], ['smallcaps', 'smallcaps', 'small caps'], ['bubble', 'circled', 'bubble'], ['strike', 'strike', 'strikethrough'], ['underline', 'underline', 'underlined']]) {
    D(name, { cat: 'tools', usage: `${name} <text>`, desc: `Turn text into ${label} Unicode text that works anywhere.` }, async ctx => {
      await ctx.reply(fonts.apply(id, need(ctx, `${name} your text here`)), { title: label[0].toUpperCase() + label.slice(1) });
    });
  }

  /* ============================== TEXT ============================== */
  D('uwu', { cat: 'tools', usage: 'uwu <text>', desc: 'Make text uwu.' }, async ctx => ctx.reply(toUwu(need(ctx, 'uwu hello there')), { title: 'UwU' }));
  D('leet', { cat: 'tools', usage: 'leet <text>', desc: 'Write in 1337 speak.' }, async ctx => ctx.reply(toLeet(need(ctx, 'leet elite hacker')), { title: '1337' }));
  D('piglatin', { cat: 'tools', usage: 'piglatin <text>', desc: 'Translate English to Pig Latin.' }, async ctx => ctx.reply(toPig(need(ctx, 'piglatin hello world')), { title: 'Pig Latin' }));
  D('nato', { cat: 'tools', usage: 'nato <text>', desc: 'Spell out text in the NATO phonetic alphabet.' }, async ctx => {
    const t = need(ctx, 'nato DECAN 7').toLowerCase();
    const out = [...t].map(c => (c === ' ' ? '/' : NATO[c] || null)).filter(Boolean).join(' ');
    if (!out) throw new UserError('Use letters and numbers only.');
    await ctx.reply(out, { title: 'NATO alphabet' });
  });
  D('acronym', { cat: 'tools', usage: 'acronym <phrase>', desc: 'Make an acronym from the first letters of each word.' }, async ctx => {
    const w = need(ctx, 'acronym portable network graphics').split(/\s+/).filter(x => /\p{L}/u.test(x));
    if (!w.length) throw new UserError('Give me some words.');
    await ctx.reply(`*${w.map(x => [...x.replace(/^[^\p{L}]+/u, '')][0].toUpperCase()).join('')}*`, { title: 'Acronym' });
  });
  D('initials', { cat: 'tools', usage: 'initials <full name>', desc: 'Get the initials of a name.' }, async ctx => {
    const w = need(ctx, 'initials Lenny Muriuki').split(/\s+/).filter(x => /\p{L}/u.test(x));
    await ctx.reply(`*${w.map(x => [...x.replace(/^[^\p{L}]+/u, '')][0].toUpperCase() + '.').join('')}*`, { title: 'Initials' });
  });
  D('charcount', { cat: 'tools', usage: 'charcount <text>', desc: 'Letter frequency of a text (top 10).' }, async ctx => {
    const letters = [...need(ctx, 'charcount some text here').toLowerCase()].filter(c => /\p{L}/u.test(c));
    if (!letters.length) throw new UserError('No letters found.');
    const freq = {}; for (const c of letters) freq[c] = (freq[c] || 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
    const max = top[0][1];
    await ctx.reply([`🔤 Letters: *${letters.length}*  •  Distinct: *${Object.keys(freq).length}*`, '', ...top.map(([c, n]) => `${c.toUpperCase()}  ${'█'.repeat(Math.max(1, Math.round(n / max * 12)))} ${n} (${(n / letters.length * 100).toFixed(1)}%)`)].join('\n'), { title: 'Letter count' });
  });
  D('sortlines', { cat: 'tools', usage: 'sortlines [desc|num|len] <lines>', desc: 'Sort lines A-Z, Z-A, by number or by length. Reply to a list or put lines under the command.' }, async ctx => {
    let l = lines(ctx), mode = '';
    if (/^(desc|num|numdesc|len)$/i.test(l[0] || '')) mode = l.shift().toLowerCase(); else { const m = (l[0] || '').match(/^(desc|num|numdesc|len)\s+(.*)$/i); if (m) { mode = m[1].toLowerCase(); l[0] = m[2]; } }
    l = l.filter(x => x.trim()); if (!l.length) throw new UserError(`Usage: *${P(ctx)}sortlines* then your lines on the next lines (options: desc, num, numdesc, len)`);
    const cmp = { '': (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }), desc: (a, b) => b.localeCompare(a, undefined, { sensitivity: 'base' }), num: (a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b), numdesc: (a, b) => parseFloat(b) - parseFloat(a) || a.localeCompare(b), len: (a, b) => a.length - b.length || a.localeCompare(b) }[mode];
    await ctx.reply(l.sort(cmp).join('\n'), { title: 'Sorted' });
  });
  D('uniquelines', { cat: 'tools', usage: 'uniquelines <lines>', desc: 'Remove duplicate lines (keeps first occurrence).' }, async ctx => {
    const l = lines(ctx).filter(x => x.trim()); if (!l.length) throw new UserError(`Usage: *${P(ctx)}uniquelines* then your lines on the next lines`);
    const seen = new Set(), out = l.filter(x => { const k = x.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    await ctx.reply(`${out.join('\n')}\n\n_Removed ${l.length - out.length} duplicate(s)._`, { title: 'Unique lines' });
  });
  D('reverselines', { cat: 'tools', usage: 'reverselines <lines>', desc: 'Reverse the order of lines.' }, async ctx => {
    const l = lines(ctx).filter(x => x.trim()); if (!l.length) throw new UserError(`Usage: *${P(ctx)}reverselines* then your lines on the next lines`);
    await ctx.reply(l.reverse().join('\n'), { title: 'Reversed' });
  });
  D('numberlines', { cat: 'tools', usage: 'numberlines <lines>', desc: 'Number every line.' }, async ctx => {
    const l = lines(ctx).filter(x => x.trim()); if (!l.length) throw new UserError(`Usage: *${P(ctx)}numberlines* then your lines on the next lines`);
    await ctx.reply(l.map((x, i) => `${i + 1}. ${x}`).join('\n'), { title: 'Numbered' });
  });
  const extractor = (name, re, what, clean = x => x) => D(name, { cat: 'tools', usage: `${name} <text>  (or reply to a message)`, desc: `Pull every ${what} out of a text.` }, async ctx => {
    const found = [...new Set((need(ctx, `${name} <paste text>`).match(re) || []).map(clean))];
    await ctx.reply(found.length ? `${found.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n_${found.length} found._` : `No ${what}s found.`, { title: `${what[0].toUpperCase()}${what.slice(1)}s` });
  });
  extractor('extractemails', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'email address', x => x.toLowerCase());
  extractor('extracturls', /https?:\/\/[^\s<>"')]+/gi, 'link', x => x.replace(/[.,;:!?]+$/, ''));
  extractor('extractnumbers', /-?\d+(?:,\d{3})*(?:\.\d+)?/g, 'number');

  /* ============================== DEV ============================== */
  D('hexcolor', { cat: 'tools', usage: 'hexcolor <#ff8800 | 255,136,0>', desc: 'Convert a colour between HEX, RGB and HSL.' }, async ctx => {
    const c = parseColor(need(ctx, 'hexcolor #ff8800')); if (!c) throw new UserError(`Give a colour like *#ff8800*, *f80* or *255,136,0*.`);
    const [h, s, l] = rgbToHsl(c);
    await ctx.reply([`🎨 HEX: *#${c.map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()}*`, `🔴 RGB: *${c.join(', ')}*`, `🌈 HSL: *${h}°, ${s}%, ${l}%*`].join('\n'), { title: 'Colour' });
  });
  D('ipcalc', { cat: 'tools', usage: 'ipcalc <ip>/<prefix>', desc: 'IPv4 subnet calculator: network, broadcast, mask, usable hosts.' }, async ctx => {
    const r = ipcalc(need(ctx, 'ipcalc 192.168.1.10/24')); if (!r) throw new UserError(`Give an IPv4 address with an optional prefix, e.g. *${P(ctx)}ipcalc 10.0.0.5/22*`);
    await ctx.reply([`🌐 ${r.ip}/${r.prefix}`, `🎭 Mask: *${r.mask}*`, `🏠 Network: *${r.network}*`, `📣 Broadcast: *${r.broadcast}*`, `➡️ Hosts: *${r.first}* – *${r.last}*`, `👥 Usable hosts: *${r.hosts.toLocaleString('en-US')}*`].join('\n'), { title: 'Subnet' });
  });
  D('urlparse', { cat: 'tools', usage: 'urlparse <url>', desc: 'Break a link into protocol, host, path and query parameters.' }, async ctx => {
    let u; try { u = new URL(need(ctx, 'urlparse https://example.com/a?b=1')); } catch { throw new UserError('That is not a valid URL (include https://).'); }
    const q = [...u.searchParams.entries()];
    await ctx.reply([`🔗 Protocol: *${u.protocol.replace(':', '')}*`, `🖥️ Host: *${u.hostname}*${u.port ? `  •  Port: *${u.port}*` : ''}`, `📂 Path: *${u.pathname}*`, q.length ? `❓ Query:\n${q.map(([k, v]) => `   • ${k} = ${v}`).join('\n')}` : null, u.hash ? `#️⃣ Fragment: *${u.hash.slice(1)}*` : null].filter(Boolean).join('\n'), { title: 'URL' });
  });

  /* ============================== MONEY ============================== */
  D('compound', { cat: 'tools', usage: 'compound <amount> <yearly %> <years> [times per year]', desc: 'Compound interest on a lump sum.' }, async ctx => {
    const [pr, rate, years, n = 12] = ctx.argv.map(num);
    if (![pr, rate, years, n].every(Number.isFinite) || pr <= 0 || rate < 0 || years <= 0 || years > 100 || n < 1 || n > 365) throw new UserError(`Usage: *${P(ctx)}compound 100k 10 5*  (amount, yearly %, years, optional compounds per year — default 12)`);
    const fv = pr * (1 + rate / 100 / n) ** (n * years);
    await ctx.reply([`🌱 *${cur(ctx)} ${money(pr)}* at *${rate}%* for *${years} years* (compounded ${n}×/year)`, `🎯 Grows to: *${cur(ctx)} ${money(fv)}*`, `📈 Interest earned: *${cur(ctx)} ${money(fv - pr)}*`].join('\n'), { title: 'Compound interest' });
  });
  D('tip', { cat: 'tools', usage: 'tip <bill> [tip %]', desc: 'Work out a tip and the total (default 10%).' }, async ctx => {
    const [bill, pct = 10] = ctx.argv.map(num);
    if (!Number.isFinite(bill) || !Number.isFinite(pct) || bill <= 0 || pct < 0 || pct > 100) throw new UserError(`Usage: *${P(ctx)}tip 3500 10*`);
    await ctx.reply([`🧾 Bill: *${cur(ctx)} ${money(bill)}*`, `💝 Tip (${pct}%): *${cur(ctx)} ${money(bill * pct / 100)}*`, `✅ Total: *${cur(ctx)} ${money(bill * (1 + pct / 100))}*`].join('\n'), { title: 'Tip' });
  });
  D('discount', { cat: 'tools', usage: 'discount <price> <off %> [extra off %]', desc: 'Price after a discount (second discount stacks).' }, async ctx => {
    const [price, off, off2 = 0] = ctx.argv.map(num);
    if (![price, off, off2].every(Number.isFinite) || price < 0 || off < 0 || off > 100 || off2 < 0 || off2 > 100) throw new UserError(`Usage: *${P(ctx)}discount 2500 20*  or  *${P(ctx)}discount 2500 20 10* (20% then another 10%)`);
    const pay = price * (1 - off / 100) * (1 - off2 / 100);
    await ctx.reply([`🏷️ Price: *${cur(ctx)} ${money(price)}*  −${off}%${off2 ? ` −${off2}%` : ''}`, `💳 You pay: *${cur(ctx)} ${money(pay)}*`, `🎉 You save: *${cur(ctx)} ${money(price - pay)}* (${money((1 - pay / price) * 100 || 0, 1)}%)`].join('\n'), { title: 'Discount' });
  });
  D('percent', { cat: 'tools', usage: 'percent 15 of 2000  •  percent 300 is 2000', desc: 'X% of Y, or what percent one number is of another.' }, async ctx => {
    const t = need(ctx, 'percent 15 of 2000').toLowerCase();
    let m = t.match(/^(\S+)\s+of\s+(\S+)$/);
    if (m) { const [x, y] = [num(m[1]), num(m[2])]; if (Number.isFinite(x) && Number.isFinite(y)) return ctx.reply(`📐 *${x}%* of *${money(y, 2)}* = *${money(y * x / 100)}*`, { title: 'Percent' }); }
    m = t.match(/^(\S+)\s+is\s+(\S+)$/);
    if (m) { const [x, y] = [num(m[1]), num(m[2])]; if (Number.isFinite(x) && Number.isFinite(y) && y !== 0) return ctx.reply(`📐 *${money(x)}* is *${money(x / y * 100)}%* of *${money(y)}*`, { title: 'Percent' }); }
    throw new UserError(`Usage: *${P(ctx)}percent 15 of 2000*  or  *${P(ctx)}percent 300 is 2000*`);
  });
  D('percentchange', { cat: 'tools', usage: 'percentchange <old> <new>', desc: 'Percentage increase or decrease between two numbers.' }, async ctx => {
    const [a, b] = ctx.argv.map(num);
    if (![a, b].every(Number.isFinite) || a === 0) throw new UserError(`Usage: *${P(ctx)}percentchange 80 100*  (old value cannot be 0)`);
    const ch = (b - a) / Math.abs(a) * 100;
    await ctx.reply(`${ch >= 0 ? '📈 Increase' : '📉 Decrease'} of *${money(Math.abs(ch))}%*\n${money(a)} → ${money(b)}  (${ch >= 0 ? '+' : '−'}${money(Math.abs(b - a))})`, { title: 'Percent change' });
  });
  D('roi', { cat: 'tools', usage: 'roi <amount invested> <amount returned>', desc: 'Return on investment.' }, async ctx => {
    const [c, r] = ctx.argv.map(num);
    if (![c, r].every(Number.isFinite) || c <= 0 || r < 0) throw new UserError(`Usage: *${P(ctx)}roi 50000 65000*`);
    await ctx.reply([`💼 Invested: *${cur(ctx)} ${money(c)}*`, `💵 Returned: *${cur(ctx)} ${money(r)}*`, `${r >= c ? '✅ Profit' : '⚠️ Loss'}: *${cur(ctx)} ${money(Math.abs(r - c))}*`, `📊 ROI: *${money((r - c) / c * 100)}%*`].join('\n'), { title: 'ROI' });
  });
  D('margin', { cat: 'tools', usage: 'margin <cost> <selling price>', desc: 'Profit, profit margin and markup.' }, async ctx => {
    const [c, p] = ctx.argv.map(num);
    if (![c, p].every(Number.isFinite) || c < 0 || p <= 0) throw new UserError(`Usage: *${P(ctx)}margin 700 1000*  (cost, selling price)`);
    await ctx.reply([`🛒 Cost: *${cur(ctx)} ${money(c)}*  →  Price: *${cur(ctx)} ${money(p)}*`, `💰 Profit: *${cur(ctx)} ${money(p - c)}*`, `📊 Margin: *${money((p - c) / p * 100)}%*  (of the price)`, `📈 Markup: *${c ? money((p - c) / c * 100) + '%' : 'n/a'}*  (on the cost)`].join('\n'), { title: 'Margin' });
  });
  D('breakeven', { cat: 'tools', usage: 'breakeven <fixed costs> <price per unit> <cost per unit>', desc: 'How many units you must sell to cover your costs.' }, async ctx => {
    const [fixed, price, vc] = ctx.argv.map(num);
    if (![fixed, price, vc].every(Number.isFinite) || fixed < 0 || price <= 0 || vc < 0) throw new UserError(`Usage: *${P(ctx)}breakeven 30000 500 300*  (fixed costs, price per unit, cost per unit)`);
    if (price <= vc) throw new UserError('Your price must be higher than your cost per unit, otherwise you never break even.');
    const units = Math.ceil(fixed / (price - vc));
    await ctx.reply([`⚖️ Each unit earns *${cur(ctx)} ${money(price - vc)}*`, `📦 Break-even at *${units.toLocaleString('en-US')} units*`, `💵 That is *${cur(ctx)} ${money(units * price)}* in sales`].join('\n'), { title: 'Break-even' });
  });

  /* ============================== DATES ============================== */
  D('workdays', { cat: 'tools', usage: 'workdays <start date> [end date]', desc: 'Working days (Mon–Fri) between two dates, both included.' }, async ctx => {
    const a = parseDate(ctx.argv[0]), b = ctx.argv[1] ? parseDate(ctx.argv[1]) : todayUtc(ctx);
    if (!a || !b) throw new UserError(`Usage: *${P(ctx)}workdays 2026-11-01 2026-12-31*  (one date counts to today). Public holidays are not excluded.`);
    const [x, y] = a <= b ? [a, b] : [b, a];
    if (dayDiff(x, y) > 36600) throw new UserError('That range is over 100 years — please narrow it.');
    const total = dayDiff(x, y) + 1, w = businessDays(x, y);
    await ctx.reply([`📆 ${fmtDate(x)} → ${fmtDate(y)}`, `💼 Working days: *${w}*`, `🛋️ Weekend days: *${total - w}*`, `🗓️ Total days: *${total}*`, '_Public holidays are not excluded._'].join('\n'), { title: 'Working days' });
  });
  D('weeknum', { cat: 'tools', usage: 'weeknum [date]', desc: 'ISO week number of a date (default today).' }, async ctx => {
    const d = ctx.argv[0] ? parseDate(ctx.argv[0]) : todayUtc(ctx); if (!d) throw new UserError(`Usage: *${P(ctx)}weeknum 2026-12-25*`);
    const w = isoWeek(d); await ctx.reply(`🗓️ ${fmtDate(d)}\nISO week *${w.week}* of *${w.year}*`, { title: 'Week number' });
  });
  D('dayofweek', { cat: 'tools', usage: 'dayofweek <date>', desc: 'Which weekday a date falls on, plus day-of-year.' }, async ctx => {
    const d = parseDate(ctx.argv[0]); if (!d) throw new UserError(`Usage: *${P(ctx)}dayofweek 2030-01-01* (or 01/01/2030)`);
    const y = d.getUTCFullYear(), doy = dayDiff(new Date(Date.UTC(y, 0, 1)), d) + 1, len = dayDiff(new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1)));
    await ctx.reply(`📅 *${WEEKDAYS[d.getUTCDay()]}*\n${fmtDate(d)}\nDay *${doy}* of ${len} (${len - doy} left in the year)`, { title: 'Day of week' });
  });
  D('leapyear', { cat: 'tools', usage: 'leapyear [year]', desc: 'Is it a leap year? Shows the next one too.' }, async ctx => {
    const y = ctx.argv[0] ? Number(ctx.argv[0]) : Number(todayUtc(ctx).getUTCFullYear());
    if (!Number.isInteger(y) || y < 1 || y > 9999) throw new UserError(`Usage: *${P(ctx)}leapyear 2028*`);
    const leap = n => (n % 4 === 0 && n % 100 !== 0) || n % 400 === 0; let nx = y + 1; while (!leap(nx)) nx++;
    await ctx.reply(`${leap(y) ? '✅' : '❌'} *${y}* ${leap(y) ? 'is' : 'is not'} a leap year.\n➡️ Next leap year: *${nx}*`, { title: 'Leap year' });
  });
  D('sleepcalc', { cat: 'tools', usage: 'sleepcalc wake 06:30  •  sleepcalc bed 22:30  •  sleepcalc now', desc: 'Best bedtimes or wake-up times using 90-minute sleep cycles.' }, async ctx => {
    const mode = (ctx.argv[0] || '').toLowerCase(); let t;
    if (mode === 'now') { const p = require('../lib/util').tzParts(ctx.tz()); t = parseClock(`${p.time}`); }
    else t = parseClock(ctx.argv[1]);
    if (!['wake', 'bed', 'now'].includes(mode) || t === null) throw new UserError(`Usage: *${P(ctx)}sleepcalc wake 06:30*  (when to go to bed)  •  *${P(ctx)}sleepcalc bed 22:30*  (when to wake up)  •  *${P(ctx)}sleepcalc now*\nAssumes about 15 minutes to fall asleep.`);
    if (mode === 'wake') return ctx.reply(`⏰ To wake at *${hhmm(t)}*, fall asleep at one of these (go to bed ~15 min earlier):\n${[6, 5, 4].map(c => `🛏️ *${hhmm(t - c * 90 - 15)}*  — ${c} cycles (${c * 1.5} h)`).join('\n')}`, { title: 'Sleep calculator' });
    await ctx.reply(`🛏️ Going to bed at *${hhmm(t)}*, wake up at one of these:\n${[4, 5, 6].map(c => `⏰ *${hhmm(t + 15 + c * 90)}*  — ${c} cycles (${c * 1.5} h)`).join('\n')}`, { title: 'Sleep calculator' });
  });
  D('generation', { cat: 'tools', usage: 'generation <birth year>', desc: 'Which generation a birth year belongs to.' }, async ctx => {
    const y = Number(String(ctx.argv[0] || '').slice(0, 4)); const now = todayUtc(ctx).getUTCFullYear();
    if (!Number.isInteger(y) || y < 1800 || y > now) throw new UserError(`Usage: *${P(ctx)}generation 1999*`);
    await ctx.reply(`👥 Born in *${y}* → *${generation(y)}*\n_(Pew Research year ranges.)_`, { title: 'Generation' });
  });
  D('birthstone', { cat: 'tools', usage: 'birthstone <month name or number>', desc: 'The birthstone for a month.' }, async ctx => {
    const a = (ctx.argv[0] || '').toLowerCase(); let i = /^\d+$/.test(a) ? Number(a) - 1 : MONTHS.findIndex(m => a.length >= 3 && m.startsWith(a));
    if (!(i >= 0 && i < 12)) throw new UserError(`Usage: *${P(ctx)}birthstone march*  or  *${P(ctx)}birthstone 3*`);
    await ctx.reply(`💎 ${MONTHS[i][0].toUpperCase() + MONTHS[i].slice(1)}: *${STONES[i]}*`, { title: 'Birthstone' });
  });

  /* ============================== CONVERT ============================== */
  D('temp', { cat: 'tools', usage: 'temp <value><C|F|K>', desc: 'Convert a temperature between Celsius, Fahrenheit and Kelvin.' }, async ctx => {
    const m = String(ctx.args || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([cfk])$/i);
    if (!m) throw new UserError(`Usage: *${P(ctx)}temp 36.6c*  or  *${P(ctx)}temp 98f*  or  *${P(ctx)}temp 300k*`);
    const v = Number(m[1]), u = m[2].toLowerCase();
    const c = u === 'c' ? v : u === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
    if (c < -273.15) throw new UserError('That is below absolute zero.');
    await ctx.reply(`🌡️ *${(c).toFixed(2)} °C*\n🌡️ *${(c * 9 / 5 + 32).toFixed(2)} °F*\n🌡️ *${(c + 273.15).toFixed(2)} K*`, { title: 'Temperature' });
  });
};

module.exports.__test = { toUwu, toLeet, toPig, parseColor, rgbToHsl, ipcalc, isoWeek, businessDays, hhmm, parseClock, generation };
