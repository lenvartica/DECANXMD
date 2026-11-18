'use strict';
/**
 * DECAN XMD v1.2.0 command pack.
 *
 *  Control:  access, alias, unalias, aliases, limits, doctor
 *  Money:    loan, savings, splitbill, vat
 *  Dates:    age, daysbetween, dateadd
 *  Text:     wordcount, textcase, slug, lorem, mock, clap, vapor
 *  Numbers:  roman, numwords, prime, baseconv, anagram, palindrome
 *  Game:     wordle
 *
 * Everything here is computed locally (no third-party API), so it keeps working when a website is down.
 */
const fs = require('fs');
const path = require('path');
const U = require('../lib/util');
const access = require('../lib/access');
const { UserError, bold, tzParts } = U;

const SINCE = '1.2.0';

/* ------------------------------------------------------------------ helpers */
/** "50k" -> 50000, "1.5m" -> 1500000, "1,200" -> 1200, "12%" -> 12. Returns NaN when it is not a number. */
function num(s) {
  const t = String(s ?? '').trim().toLowerCase().replace(/[,_\s%]/g, '');
  const m = t.match(/^(-?\d*\.?\d+)([kmb])?$/);
  if (!m) return NaN;
  return Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1);
}
const money = (n, d = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** "2001-04-09", "09/04/2001", "9-4-2001" (day first) -> Date at UTC midnight, or null. */
function parseDate(s) {
  s = String(s || '').trim();
  let y, mo, d, m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [y, mo, d] = [m[1], m[2], m[3]];
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, mo, y] = [m[1], m[2], m[3]];
  else return null;
  y = +y; mo = +mo; d = +d;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}
const todayUtc = ctx => { const [y, m, d] = tzParts(ctx.tz()).iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const dayDiff = (a, b) => Math.round((b - a) / 864e5);
const fmtDate = d => d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** a + n calendar months at UTC midnight, clamping the day to the end of the month (Jan 31 + 1 month = Feb 28/29). */
function addMonths(a, n) {
  const y = a.getUTCFullYear() + Math.floor((a.getUTCMonth() + n) / 12), m = ((a.getUTCMonth() + n) % 12 + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(a.getUTCDate(), last)));
}
/** Whole years, months and leftover days between two UTC-midnight dates (a <= b). */
function ymd(a, b) {
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (addMonths(a, months) > b) months--;
  return { y: Math.floor(months / 12), m: months % 12, d: dayDiff(addMonths(a, months), b) };
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];
function below1000(n) {
  const out = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)], 'hundred'); n %= 100; if (n) out.push('and'); }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')); }
  else if (n > 0 || !out.length) out.push(ONES[n]);
  return out.join(' ');
}
function numberToWords(n) {
  n = BigInt(n);
  if (n === 0n) return 'zero';
  const neg = n < 0n; if (neg) n = -n;
  const parts = []; let i = 0;
  while (n > 0n) { const chunk = Number(n % 1000n); if (chunk) parts.unshift(below1000(chunk) + (SCALES[i] ? ' ' + SCALES[i] : '')); n /= 1000n; i++; }
  return (neg ? 'minus ' : '') + parts.join(', ');
}

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const toRoman = n => { let s = ''; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s; };
function fromRoman(s) {
  s = s.toUpperCase(); if (!/^[MDCLXVI]+$/.test(s)) return NaN;
  const val = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let t = 0; for (let i = 0; i < s.length; i++) { const a = val[s[i]], b = val[s[i + 1]] || 0; t += a < b ? -a : a; }
  return toRoman(t) === s ? t : NaN; // only canonical numerals
}

function factorize(n) {
  const f = []; let x = n;
  for (let p = 2; p * p <= x; p += p === 2 ? 1 : 2) while (x % p === 0) { f.push(p); x /= p; }
  if (x > 1) f.push(x);
  return f;
}

/* ------------------------------------------------------------------ wordle */
const WORDS = ('about above actor adult after again agent agree ahead alarm album alert alive allow alone along alter among angle angry apple apply argue arise armor array aside asset audio avoid awake award aware bacon badge baker basic basin batch beach beard beast begin being below bench berry birth black blade blame blank blast blaze bleed blend bless blind block blood bloom board boast bonus boost booth bound brain brake brand brave bread break brick bride brief bring broad brown brush build bunch burst buyer cabin cable candy carry catch cause chain chair chalk charm chart chase cheap check cheek cheer chess chest chief child chill choir chose civil claim class clean clear clerk click cliff climb clock close cloth cloud coach coast color couch could count court cover crack craft crane crash crawl crazy cream crime crisp cross crowd crown cruel crush curve cycle daily dance dealt death debut delay depth dirty doubt dozen draft drain drama drank dream dress dried drift drill drink drive drown eager early earth eight elbow elder elect elite empty enemy enjoy enter entry equal error essay event every exact exist extra faith false fancy fault feast fence fever fiber field fifth fifty fight final first flame flash fleet flesh float flood floor flour fluid focus force forge forth forty forum found frame frank fresh front frost fruit fully funny ghost giant given glass globe gloom glory glove grace grade grain grand grant grape graph grasp grass grave great green greet grief grill grind groom gross group grown guard guess guest guide habit happy harsh heart heavy hello hence honey honor horse hotel house human humor hurry ideal image imply index inner input issue ivory jelly jewel joint judge juice knife knock known label labor large laser later laugh layer learn lease least leave legal lemon level light limit linen liver lobby local logic loose lover lucky lunch magic major maker march match maybe mayor meant medal media melon mercy merge merit metal meter might minor minus mixed model money month moral motor mount mouse mouth movie music naive nerve never newly night noble noise north novel nurse ocean offer often olive onion opera orbit order organ other ought outer owner paint panel paper party pasta patch pause peace pearl phase phone photo piano piece pilot pitch pizza place plain plane plant plate plaza point polar porch pound power press price pride prime print prior prize proof proud prove queen query quest quick quiet quite quota quote radar radio raise rally ranch range rapid ratio reach react ready realm rebel refer relax reply rider ridge rifle right rigid risky rival river roast robot rocky rough round route royal rural sadly saint salad sauce scale scare scene scope score scout screw sense serve seven shade shake shall shame shape share sharp sheep sheet shelf shell shift shine shirt shock shoot shore short shout shown sight sigma silly since sixty skill sleep slice slide slope small smart smell smile smoke snake solid solve sorry sound south space spare speak speed spell spend spice spike split spoke sport spray squad stack staff stage stair stake stamp stand start state steam steel steep steer stick still stock stone stood store storm story strip stuck study stuff style sugar suite sunny super sweet swept swift swing sword table taste teach thank theme thick thing think third those three threw throw thumb tiger tight timer title toast today token tooth topic total touch tough towel tower toxic trace track trade trail train trait trash treat trend trial tribe trick tried troop truck truly trunk trust truth twice twist ultra uncle under union unite unity until upper upset urban usage usual valid value video virus visit vital vivid vocal voice waste watch water weary weigh weird whale wheat wheel where which while white whole whose widow width woman world worry worse worst worth would wound wrist write wrong yield young youth zebra').split(' ');

function scoreGuess(guess, answer) {
  const res = Array(5).fill('⬛'); const left = {};
  for (let i = 0; i < 5; i++) { if (guess[i] === answer[i]) res[i] = '🟩'; else left[answer[i]] = (left[answer[i]] || 0) + 1; }
  for (let i = 0; i < 5; i++) if (res[i] === '⬛' && left[guess[i]] > 0) { res[i] = '🟨'; left[guess[i]]--; }
  return res.join('');
}

/* ------------------------------------------------------------------ module */
module.exports = ({ def, registry }) => {
  const P = ctx => ctx.var('PREFIX') || '.';
  const D = (names, opts, run) => def(names, { since: SINCE, ...opts }, run);
  const cur = ctx => ctx.var('CURRENCY') || 'KES';
  const text = ctx => String(ctx.input() || '').trim();

  /* ============================== CONTROL ============================== */
  D('access', { cat: 'bot', owner: true, core: true, usage: 'access <command> everyone|admin|owner|reset  •  access list', desc: 'Choose who may use a command: everyone, group admins only, or only you. Dangerous commands stay locked.' }, async ctx => {
    const a = ctx.argv.map(x => x.toLowerCase());
    const saved = ctx.get('access', {});
    if (!a.length || a[0] === 'list') {
      const rows = Object.entries(saved).map(([k, v]) => `• ${P(ctx)}${k} → *${v}*`);
      return ctx.reply(`${rows.length ? rows.join('\n') : 'No custom access rules yet.'}\n\n*Set:* ${P(ctx)}access <command> everyone|admin|owner\n*Undo:* ${P(ctx)}access <command> reset  •  ${P(ctx)}access resetall\n\nShell, sessions, settings, kick/promote and commands that drive your own WhatsApp account can never be opened to others.`, { title: 'Command access' });
    }
    if (a[0] === 'resetall') { ctx.set('access', {}); return ctx.reply('✅ All access rules cleared. Every command is back to its default.'); }
    const d = registry.get(access.norm(a[0]));
    if (!d) throw new UserError(`No command called *${a[0]}*. Usage: *${P(ctx)}access <command> everyone|admin|owner|reset*`);
    const protectedMsg = `*${P(ctx)}${d.name}* is a protected command (it runs on the host, changes the bot's login or settings, acts on your own WhatsApp account, or is destructive moderation), so its access cannot be changed.`;
    if (!d.cat) throw new UserError(protectedMsg); // hidden built-ins such as menu/help
    const level = a[1];
    if (level === 'reset') {
      ctx.update('access', {}, o => { delete o[d.name]; });
      return ctx.reply(`✅ *${P(ctx)}${d.name}* is back to its default access.`);
    }
    if (!access.LEVELS.includes(level)) throw new UserError(`Choose *everyone*, *admin*, *owner* or *reset*.\nExample: *${P(ctx)}access tagall everyone*`);
    if (level === 'owner' ? !access.canRestrict(d) : !access.canOpen(d)) throw new UserError(protectedMsg);
    ctx.update('access', {}, o => { o[d.name] = level; });
    const words = { everyone: 'anyone who can message me', admin: 'group admins (and you)', owner: 'only you' };
    await ctx.reply(`✅ *${P(ctx)}${d.name}* can now be used by ${words[level]}.${d.group ? '\n(It still only works inside groups.)' : ''}${d.botAdmin ? '\n(I still need to be a group admin for it to work.)' : ''}`);
  });

  D('alias', { cat: 'bot', owner: true, core: true, usage: 'alias <shortcut> <command> [preset text]', desc: 'Create your own shortcut for a command, e.g. alias hi menu.' }, async ctx => {
    const [short, target, ...preset] = ctx.argv;
    if (!short || !target) throw new UserError(`Usage: *${P(ctx)}alias <shortcut> <command> [preset text]*\nExample: *${P(ctx)}alias w weather Nairobi*`);
    const s = short.toLowerCase().replace(/^[^a-z0-9]+/, '');
    if (!/^[a-z0-9_]{1,20}$/.test(s)) throw new UserError('A shortcut can use letters, numbers and _ only (max 20 characters).');
    if (registry.has(s)) throw new UserError(`*${s}* is already a built-in command, so it cannot be a shortcut.`);
    const real = registry.get(target.toLowerCase().replace(/^[^a-z0-9]+/, ''));
    if (!real || !real.cat) throw new UserError(`No command called *${target}*.`);
    const aliases = ctx.get('aliases', {});
    if (!(s in aliases) && Object.keys(aliases).length >= 100) throw new UserError('You already have 100 shortcuts. Remove some with unalias.');
    ctx.update('aliases', {}, o => { o[s] = [real.name, ...preset].join(' ').slice(0, 200); });
    await ctx.reply(`✅ *${P(ctx)}${s}* now runs *${P(ctx)}${real.name}${preset.length ? ' ' + preset.join(' ') : ''}*`);
  });
  D('unalias', { cat: 'bot', owner: true, core: true, usage: 'unalias <shortcut>', desc: 'Remove one of your shortcuts.' }, async ctx => {
    const s = (ctx.argv[0] || '').toLowerCase().replace(/^[^a-z0-9]+/, '');
    if (!s || !(s in ctx.get('aliases', {}))) throw new UserError('That shortcut does not exist. See *' + P(ctx) + 'aliases*.');
    ctx.update('aliases', {}, o => { delete o[s]; });
    await ctx.reply(`✅ Shortcut *${s}* removed.`);
  });
  D('aliases', { cat: 'bot', owner: true, core: true, usage: 'aliases', desc: 'List your shortcuts.' }, async ctx => {
    const rows = Object.entries(ctx.get('aliases', {})).map(([k, v]) => `• ${P(ctx)}${k} → ${P(ctx)}${v}`);
    await ctx.reply(rows.length ? rows.join('\n') : `You have no shortcuts yet. Make one: *${P(ctx)}alias <shortcut> <command>*`, { title: 'Shortcuts' });
  });

  D('limits', { cat: 'bot', owner: true, core: true, usage: 'limits  •  limits download|minutes|size|cooldown <number>', desc: 'See or change the bot limits: download size, media length, media size and the per-user cooldown.' }, async ctx => {
    const envs = require('../lib/envsettings');
    const view = () => [
      `📥 Max download: *${U.envNum('MAX_DOWNLOAD_MB', 150)} MB*  (limits download <MB>)`,
      `🎬 Max media length: *${U.maxMediaMinutes()} min*  (limits minutes <n>)`,
      `📦 Max media file: *${U.maxMediaMb()} MB*  (limits size <MB>)`,
      `⏱️ Cooldown per person: *${Number(ctx.var('COOLDOWN', 0)) || 0}s*  (limits cooldown <seconds>, 0 = none)`
    ].join('\n');
    const [what, raw] = ctx.argv.map(x => x.toLowerCase());
    if (!what) return ctx.reply(view(), { title: 'Limits' });
    const n = num(raw);
    if (!Number.isFinite(n) || n < 0) throw new UserError(`Give a number, e.g. *${P(ctx)}limits ${what} 200*`);
    const keys = { download: 'MAX_DOWNLOAD_MB', minutes: 'MAX_MEDIA_MINUTES', size: 'MAX_MEDIA_MB' };
    if (what === 'cooldown') {
      if (n > 60) throw new UserError('Cooldown can be 0 to 60 seconds.');
      ctx.update('vars', {}, v => { v.COOLDOWN = String(n); });
    } else if (keys[what]) {
      try { envs.update({ [keys[what]]: String(Math.round(n)) }); } catch (e) { throw new UserError(e.message); }
    } else throw new UserError('Choose download, minutes, size or cooldown.');
    await ctx.reply(`✅ Updated.\n\n${view()}`, { title: 'Limits' });
  });

  D('doctor', { cat: 'bot', owner: true, heavy: true, usage: 'doctor', desc: 'Self-check: connection, tools, API keys and network, with a fix for anything that is wrong.' }, async ctx => {
    const ok = [], warn = [], bad = [];
    const e = ctx.entry;
    // runtime
    const major = Number(process.versions.node.split('.')[0]);
    const minor = Number(process.versions.node.split('.')[1]);
    const supported = major > 20 || (major === 20 && minor >= 6);
    (supported ? ok : bad).push(supported ? `Node ${process.versions.node}` : `Node ${process.versions.node} is too old → install Node 20.6 or newer`);
    const rss = process.memoryUsage().rss, total = require('os').totalmem();
    (rss / total > 0.85 ? warn : ok).push(`Memory ${Math.round(rss / 1048576)} MB of ${Math.round(total / 1048576)} MB${rss / total > 0.85 ? ' → nearly full; restart the bot or give it more RAM' : ''}`);
    // WhatsApp session
    if (e?.connected && !e.socket?.ws?.isClosed) ok.push(`WhatsApp connected (up ${U.fmtDur((Date.now() - (e.connectedAt || ctx.rt.started)) / 1000)})`);
    else bad.push('WhatsApp is not connected → re-pair from the dashboard');
    const hs = e?.healer?.stats;
    if (hs?.failures) warn.push(`${hs.failures} decrypt failure(s), ${hs.healed} repaired → make sure this number is not logged in on another copy of the bot; try ${P(ctx)}fixsession`);
    // storage
    (ctx.store?.available === false ? warn : ok).push(ctx.store?.available === false ? 'Settings storage is in memory only → check that the data/ folder is writable' : 'Settings storage OK');
    // tools
    try { await U.run(U.ffmpegBin(), ['-version'], { timeout: 8000 }); ok.push('ffmpeg found (audio/video/sticker tools)'); }
    catch { bad.push('ffmpeg missing → run npm install again (ffmpeg-static) or install ffmpeg / set FFMPEG_PATH. Music still works without it (sent as m4a) but audio/video/sticker tools need it'); }
    try { await U.ensureYtDlp(); ok.push('yt-dlp ready (music/video downloads)'); }
    catch (e) { bad.push(`yt-dlp cannot start → ${String(e.message).slice(0, 220)}`); }
    // AI keys (names only — never values)
    const keys = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'].filter(k => process.env[k]);
    (keys.length ? ok : warn).push(keys.length ? `AI keys: ${keys.map(k => k.replace('_API_KEY', '')).join(', ')}` : 'No AI key set → .gpt/.ai use a free keyless model that is often slow or down. Add a free GROQ_API_KEY (console.groq.com) for fast replies');
    // network
    const hosts = [['WhatsApp Web', 'https://web.whatsapp.com'], ['GitHub', 'https://api.github.com'], ['Wikipedia', 'https://en.wikipedia.org'], ['Free AI', 'https://text.pollinations.ai']];
    const results = await Promise.all(hosts.map(async ([name, url]) => {
      const t0 = Date.now();
      try { const r = await fetch(url, { signal: AbortSignal.timeout(7000), redirect: 'manual', headers: { 'user-agent': U.UA } }); try { await r.body?.cancel(); } catch {} return [name, true, Date.now() - t0]; }
      catch (err) { return [name, false, U.netError(url, err).message]; }
    }));
    const down = results.filter(r => !r[1]);
    for (const [name, up, info] of results) (up ? ok : warn).push(up ? `${name} reachable (${info} ms)` : `${name}: ${info}`);
    if (down.length === results.length) bad.push('No internet from this host → check the connection / firewall / hosting plan');
    // config
    const acc = Object.keys(ctx.get('access', {})).length, al = Object.keys(ctx.get('aliases', {})).length;
    ok.push(`Mode ${String(ctx.var('MODE')).toUpperCase()} • prefix ${P(ctx)} • cooldown ${Number(ctx.var('COOLDOWN', 0)) || 0}s • ${acc} access rule(s) • ${al} shortcut(s)`);
    const lines = [...bad.map(x => '❌ ' + x), ...warn.map(x => '⚠️ ' + x), ...ok.map(x => '✅ ' + x)];
    const verdict = bad.length ? `🔴 ${bad.length} problem(s) need attention` : warn.length ? `🟡 Working, with ${warn.length} warning(s)` : '🟢 Everything looks healthy';
    await ctx.reply(`${verdict}\n\n${lines.join('\n')}`, { title: `Doctor • v${require('../package.json').version}` });
  });

  /* ============================== MONEY ============================== */
  D('loan', { cat: 'tools', usage: 'loan <amount> <yearly %> <months>', desc: 'Monthly repayment, total paid and total interest for a loan.' }, async ctx => {
    const [P0, rate, months] = ctx.argv.map(num);
    if (![P0, rate, months].every(Number.isFinite) || P0 <= 0 || rate < 0 || months < 1 || months > 1200) throw new UserError(`Usage: *${P(ctx)}loan 500k 14 24*  (amount, yearly interest %, months)`);
    const r = rate / 1200, n = Math.round(months);
    const pay = r === 0 ? P0 / n : P0 * r / (1 - (1 + r) ** -n);
    await ctx.reply([`💰 Loan: *${cur(ctx)} ${money(P0)}* at *${rate}%* a year for *${n} months*`, `📆 Monthly payment: *${cur(ctx)} ${money(pay)}*`, `💸 Total paid: *${cur(ctx)} ${money(pay * n)}*`, `📈 Total interest: *${cur(ctx)} ${money(pay * n - P0)}*`, '', '_Standard reducing-balance formula; your lender\'s fees are not included._'].join('\n'), { title: 'Loan calculator' });
  });
  D('savings', { cat: 'tools', usage: 'savings <monthly> <yearly %> <years> [starting amount]', desc: 'How much regular monthly saving grows to with interest.' }, async ctx => {
    const [m, rate, years, start = 0] = ctx.argv.map(num);
    if (![m, rate, years, start].every(Number.isFinite) || m < 0 || rate < 0 || years <= 0 || years > 100) throw new UserError(`Usage: *${P(ctx)}savings 5000 8 10*  (monthly amount, yearly %, years, optional starting amount)`);
    const r = rate / 1200, n = Math.round(years * 12);
    const fv = r === 0 ? start + m * n : start * (1 + r) ** n + m * (((1 + r) ** n - 1) / r);
    const put = start + m * n;
    await ctx.reply([`🏦 Saving *${cur(ctx)} ${money(m)}* a month at *${rate}%* for *${years} years*${start ? ` (starting with ${cur(ctx)} ${money(start)})` : ''}`, `💵 You put in: *${cur(ctx)} ${money(put)}*`, `🌱 Interest earned: *${cur(ctx)} ${money(fv - put)}*`, `🎯 Ends at: *${cur(ctx)} ${money(fv)}*`].join('\n'), { title: 'Savings growth' });
  });
  D('splitbill', { cat: 'tools', usage: 'splitbill <total> <people> [tip %]', desc: 'Split a bill between people, with an optional tip.' }, async ctx => {
    const [total, people, tip = 0] = ctx.argv.map(num);
    if (![total, people, tip].every(Number.isFinite) || total <= 0 || people < 1 || people > 500 || tip < 0 || tip > 100) throw new UserError(`Usage: *${P(ctx)}splitbill 4800 4 10*  (total, people, optional tip %)`);
    const n = Math.round(people), grand = total * (1 + tip / 100);
    await ctx.reply([`🧾 Bill: *${cur(ctx)} ${money(total)}*${tip ? ` + ${tip}% tip = *${cur(ctx)} ${money(grand)}*` : ''}`, `👥 People: *${n}*`, `➡️ Each pays: *${cur(ctx)} ${money(grand / n)}*`].join('\n'), { title: 'Split the bill' });
  });
  D('vat', { cat: 'tools', usage: 'vat <amount> [rate %] [inc]', desc: 'Add VAT to a price, or take it out of a VAT-inclusive price (default 16%).' }, async ctx => {
    const inc = ctx.argv.some(x => /^inc/i.test(x));
    const [amt, rate = 16] = ctx.argv.filter(x => !/^inc/i.test(x)).map(num);
    if (!Number.isFinite(amt) || !Number.isFinite(rate) || amt < 0 || rate < 0 || rate > 100) throw new UserError(`Usage: *${P(ctx)}vat 1000*  or  *${P(ctx)}vat 1160 16 inc*  (price already includes VAT)`);
    const net = inc ? amt / (1 + rate / 100) : amt, vat = net * rate / 100;
    await ctx.reply([`🧮 Price without VAT: *${cur(ctx)} ${money(net)}*`, `➕ VAT (${rate}%): *${cur(ctx)} ${money(vat)}*`, `✅ Price with VAT: *${cur(ctx)} ${money(net + vat)}*`].join('\n'), { title: 'VAT' });
  });

  /* ============================== DATES ============================== */
  D('age', { cat: 'tools', usage: 'age <birth date: 2001-04-09 or 09/04/2001>', desc: 'Exact age, days lived and days until the next birthday.' }, async ctx => {
    const b = parseDate(ctx.argv[0]);
    if (!b) throw new UserError(`Give a real date, e.g. *${P(ctx)}age 2001-04-09* or *${P(ctx)}age 09/04/2001* (day first).`);
    const now = todayUtc(ctx);
    if (b > now) throw new UserError('That date is in the future.');
    const { y, m, d } = ymd(b, now);
    let next = new Date(Date.UTC(now.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
    if (next < now) next = new Date(Date.UTC(now.getUTCFullYear() + 1, b.getUTCMonth(), b.getUTCDate()));
    const left = dayDiff(now, next);
    await ctx.reply([`🎂 Born: *${fmtDate(b)}*`, `⏳ Age: *${y} years, ${m} months, ${d} days*`, `📅 Days lived: *${dayDiff(b, now).toLocaleString('en-US')}*`, left === 0 ? '🎉 *Happy birthday today!*' : `🎁 Next birthday: *${left} day${left === 1 ? '' : 's'}* (turning ${y + 1})`].join('\n'), { title: 'Age' });
  });
  D('daysbetween', { cat: 'tools', usage: 'daysbetween <date> [date]', desc: 'Days between two dates (or from today).' }, async ctx => {
    const a = parseDate(ctx.argv[0]), b = ctx.argv[1] ? parseDate(ctx.argv[1]) : todayUtc(ctx);
    if (!a || !b) throw new UserError(`Usage: *${P(ctx)}daysbetween 2026-01-01 2026-12-25*  (one date compares with today)`);
    const [from, to] = a <= b ? [a, b] : [b, a];
    const days = dayDiff(from, to), { y, m, d } = ymd(from, to);
    await ctx.reply([`📆 ${fmtDate(from)}\n➡️ ${fmtDate(to)}`, `🗓️ *${days.toLocaleString('en-US')} days*  (${Math.floor(days / 7)} weeks ${days % 7} days)`, `≈ ${y}y ${m}m ${d}d`].join('\n'), { title: 'Days between' });
  });
  D('dateadd', { cat: 'tools', usage: 'dateadd <days (negative allowed)> [start date]', desc: 'The date that is N days from today or from a date.' }, async ctx => {
    const n = num(ctx.argv[0]), start = ctx.argv[1] ? parseDate(ctx.argv[1]) : todayUtc(ctx);
    if (!Number.isFinite(n) || !Number.isInteger(n) || Math.abs(n) > 365000 || !start) throw new UserError(`Usage: *${P(ctx)}dateadd 90*  or  *${P(ctx)}dateadd -30 2026-12-25*`);
    await ctx.reply(`📅 ${fmtDate(start)} ${n >= 0 ? '+' : '−'} ${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'}\n➡️ *${fmtDate(new Date(start.getTime() + n * 864e5))}*`, { title: 'Date math' });
  });

  /* ============================== TEXT ============================== */
  D('wordcount', { cat: 'tools', usage: 'wordcount <text>  (or reply to a message)', desc: 'Count words, characters, sentences and reading time.' }, async ctx => {
    const t = text(ctx); if (!t) throw new UserError(`Send some text, or reply to a message: *${P(ctx)}wordcount <text>*`);
    const words = (t.match(/\S+/g) || []).length, sentences = (t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).filter(s => s.trim()).length;
    const mins = words / 200;
    await ctx.reply([`🔤 Words: *${words}*`, `✏️ Characters: *${t.length}* (${t.replace(/\s/g, '').length} without spaces)`, `📄 Sentences: *${sentences}*  •  Lines: *${t.split(/\n/).length}*`, `⏱️ Reading time: *${mins < 1 ? 'under a minute' : Math.round(mins) + ' min'}*`].join('\n'), { title: 'Word count' });
  });
  const splitWords = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const CASES = {
    upper: s => s.toUpperCase(), lower: s => s.toLowerCase(),
    title: s => s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase()),
    sentence: s => s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, a, c) => a + c.toUpperCase()),
    snake: s => splitWords(s).map(w => w.toLowerCase()).join('_'), kebab: s => splitWords(s).map(w => w.toLowerCase()).join('-'),
    camel: s => splitWords(s).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(''),
    pascal: s => splitWords(s).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(''),
    constant: s => splitWords(s).map(w => w.toUpperCase()).join('_')
  };
  D('textcase', { cat: 'tools', usage: `textcase <${Object.keys(CASES).join('|')}> <text>`, desc: 'Convert text to UPPER, lower, Title, snake_case, camelCase and more.' }, async ctx => {
    const style = (ctx.argv[0] || '').toLowerCase(); const t = ctx.args.replace(/^\S+\s*/, '').trim() || (ctx.quoted ? String(ctx.input() || '').trim() : '');
    if (!CASES[style] || !t) throw new UserError(`Usage: *${P(ctx)}textcase <style> <text>*\nStyles: ${Object.keys(CASES).join(', ')}`);
    await ctx.reply(CASES[style](t), { title: style });
  });
  D('slug', { cat: 'tools', usage: 'slug <title>', desc: 'Turn a title into a clean URL slug.' }, async ctx => {
    const t = text(ctx); if (!t) throw new UserError(`Usage: *${P(ctx)}slug My Great Post Title!*`);
    await ctx.reply(t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'n-a', { title: 'Slug' });
  });
  const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(' ');
  D('lorem', { cat: 'tools', usage: 'lorem [paragraphs 1-5]', desc: 'Placeholder text for designs and mock-ups.' }, async ctx => {
    const n = Math.min(5, Math.max(1, parseInt(ctx.argv[0], 10) || 1)); let i = 0;
    const para = () => { const sents = []; for (let s = 0; s < 4; s++) { const len = 8 + ((i * 7 + s * 3) % 9); const ws = Array.from({ length: len }, () => LOREM[(i++ * 13 + 5) % LOREM.length]); sents.push(ws[0][0].toUpperCase() + ws.join(' ').slice(1) + '.'); } return sents.join(' '); };
    await ctx.reply(Array.from({ length: n }, para).join('\n\n'), { title: 'Lorem ipsum' });
  });
  D('mock', { cat: 'tools', usage: 'mock <text>', desc: 'sPoNgEbOb mOcKiNg tExT.' }, async ctx => {
    const t = text(ctx); if (!t) throw new UserError(`Usage: *${P(ctx)}mock you cannot be serious*`);
    let k = 0; await ctx.reply([...t].map(c => (/\p{L}/u.test(c) ? (k++ % 2 ? c.toUpperCase() : c.toLowerCase()) : c)).join(''), { title: 'Mock' });
  });
  D('clap', { cat: 'tools', usage: 'clap <text>', desc: 'Put 👏 between 👏 every 👏 word.' }, async ctx => {
    const t = text(ctx); if (!t) throw new UserError(`Usage: *${P(ctx)}clap this is important*`);
    await ctx.reply(t.split(/\s+/).join(' 👏 ') + ' 👏', { title: 'Clap' });
  });
  D('vapor', { cat: 'tools', usage: 'vapor <text>', desc: 'ｖａｐｏｒｗａｖｅ　ｔｅｘｔ.' }, async ctx => {
    const t = text(ctx); if (!t) throw new UserError(`Usage: *${P(ctx)}vapor aesthetic*`);
    await ctx.reply([...t].map(c => { const k = c.codePointAt(0); return k === 32 ? '　' : k > 32 && k < 127 ? String.fromCodePoint(k + 0xFEE0) : c; }).join(''), { title: 'Vaporwave' });
  });

  /* ============================== NUMBERS ============================== */
  D('roman', { cat: 'tools', usage: 'roman <1-3999 or numeral>', desc: 'Convert between normal and Roman numerals.' }, async ctx => {
    const a = (ctx.argv[0] || '').trim();
    if (/^\d+$/.test(a)) { const n = +a; if (n < 1 || n > 3999) throw new UserError('Roman numerals cover 1 to 3999.'); return ctx.reply(`🏛️ ${n} = *${toRoman(n)}*`, { title: 'Roman numerals' }); }
    const v = fromRoman(a);
    if (!Number.isFinite(v)) throw new UserError(`Usage: *${P(ctx)}roman 2026*  or  *${P(ctx)}roman MMXXVI*`);
    await ctx.reply(`🏛️ ${a.toUpperCase()} = *${v}*`, { title: 'Roman numerals' });
  });
  D('numwords', { cat: 'tools', usage: 'numwords <number>', desc: 'Write a number in words (cheque style).' }, async ctx => {
    const raw = (ctx.argv[0] || '').replace(/,/g, '');
    if (!/^-?\d{1,15}(\.\d+)?$/.test(raw)) throw new UserError(`Usage: *${P(ctx)}numwords 1250*  (up to 15 digits)`);
    const [ip, fp] = raw.split('.');
    let out = numberToWords(BigInt(ip));
    if (fp) out += ' point ' + [...fp].map(c => ONES[+c]).join(' ');
    await ctx.reply(out.charAt(0).toUpperCase() + out.slice(1), { title: 'Number in words' });
  });
  D('prime', { cat: 'tools', usage: 'prime <number>', desc: 'Is it prime? If not, its prime factors.' }, async ctx => {
    const n = Number((ctx.argv[0] || '').replace(/,/g, ''));
    if (!Number.isSafeInteger(n) || n < 2 || n > 1e13) throw new UserError(`Usage: *${P(ctx)}prime 97*  (whole number from 2 to 10 trillion)`);
    const f = factorize(n);
    if (f.length === 1) return ctx.reply(`✅ *${n.toLocaleString('en-US')}* is a prime number.`, { title: 'Prime check' });
    const counts = {}; for (const p of f) counts[p] = (counts[p] || 0) + 1;
    await ctx.reply(`❌ *${n.toLocaleString('en-US')}* is not prime.\n🧩 ${Object.entries(counts).map(([p, c]) => (c > 1 ? `${p}^${c}` : p)).join(' × ')}`, { title: 'Prime check' });
  });
  D('baseconv', { cat: 'tools', usage: 'baseconv <number> <from base> <to base>', desc: 'Convert a number between bases 2-36 (e.g. ff 16 10).' }, async ctx => {
    const [v, from, to] = ctx.argv; const f = parseInt(from, 10), t = parseInt(to, 10);
    if (!v || !(f >= 2 && f <= 36 && t >= 2 && t <= 36)) throw new UserError(`Usage: *${P(ctx)}baseconv ff 16 2*  (value, from base, to base — bases 2 to 36)`);
    const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, f);
    if (![...v.toLowerCase()].every(c => digits.includes(c))) throw new UserError(`"${v}" is not a valid base-${f} number.`);
    let n = 0n; for (const c of v.toLowerCase()) n = n * BigInt(f) + BigInt(digits.indexOf(c));
    await ctx.reply(`🔢 ${v} (base ${f}) = *${n.toString(t)}* (base ${t})`, { title: 'Base converter' });
  });
  const letters = s => [...s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')];
  D('anagram', { cat: 'tools', usage: 'anagram <word or phrase> | <word or phrase>', desc: 'Check whether two words or phrases are anagrams.' }, async ctx => {
    const [a, b] = ctx.args.split(/\s*[|,]\s*|\s+vs\s+/i);
    if (!a || !b) throw new UserError(`Usage: *${P(ctx)}anagram listen | silent*`);
    const A = letters(a).sort().join(''), B = letters(b).sort().join('');
    await ctx.reply(!A ? 'Those have no letters to compare.' : A === B ? `✅ *${a.trim()}* and *${b.trim()}* are anagrams.` : `❌ *${a.trim()}* and *${b.trim()}* are not anagrams.`, { title: 'Anagram' });
  });
  D('palindrome', { cat: 'tools', usage: 'palindrome <text>', desc: 'Does it read the same backwards?' }, async ctx => {
    const t = text(ctx); const L = letters(t); if (!L.length) throw new UserError(`Usage: *${P(ctx)}palindrome A man, a plan, a canal: Panama*`);
    await ctx.reply(L.join('') === [...L].reverse().join('') ? `✅ Yes — "${t}" reads the same both ways.` : `❌ No — "${t}" does not.`, { title: 'Palindrome' });
  });

  /* ============================== GAME ============================== */
  D('wordle', { cat: 'game', usage: 'wordle  •  wordle <5-letter guess>  •  wordle stop', desc: 'Guess the hidden 5-letter word in 6 tries. 🟩 right spot, 🟨 wrong spot, ⬛ not in the word.' }, async ctx => {
    const games = (ctx.rt.wordle ||= new Map());
    const key = `${ctx.chat}|${ctx.senderNum}`;
    const a = (ctx.argv[0] || '').toLowerCase();
    let g = games.get(key);
    if (a === 'stop' || a === 'giveup') {
      if (!g) throw new UserError('You have no Wordle running.');
      games.delete(key); return ctx.reply(`🏳️ The word was *${g.answer.toUpperCase()}*.`, { title: 'Wordle' });
    }
    if (!a || !g) {
      if (!g) { g = { answer: U.pick(WORDS), rows: [], at: Date.now() }; games.set(key, g); if (games.size > 500) games.delete(games.keys().next().value); }
      if (!a) return ctx.reply(`🟩🟨⬛ Wordle started! Guess the 5-letter word.\nSend *${P(ctx)}wordle <word>* (6 tries). Each player has their own game.${g.rows.length ? '\n\n' + g.rows.map(r => `${r.score}  ${r.word.toUpperCase()}`).join('\n') : ''}`, { title: 'Wordle' });
    }
    if (!/^[a-z]{5}$/.test(a)) throw new UserError('Your guess must be exactly 5 letters, e.g. *' + P(ctx) + 'wordle crane*');
    if (g.rows.some(r => r.word === a)) throw new UserError('You already tried that word.');
    const score = scoreGuess(a, g.answer);
    g.rows.push({ word: a, score });
    const board = g.rows.map(r => `${r.score}  ${r.word.toUpperCase()}`).join('\n');
    if (a === g.answer) { games.delete(key); return ctx.reply(`${board}\n\n🎉 Solved in *${g.rows.length}/6*!`, { title: 'Wordle' }); }
    if (g.rows.length >= 6) { games.delete(key); return ctx.reply(`${board}\n\n💀 Out of tries. The word was *${g.answer.toUpperCase()}*.`, { title: 'Wordle' }); }
    await ctx.reply(`${board}\n\n${6 - g.rows.length} ${6 - g.rows.length === 1 ? 'try' : 'tries'} left.`, { title: 'Wordle' });
  });
};

module.exports.__test = { num, parseDate, ymd, numberToWords, toRoman, fromRoman, factorize, scoreGuess, WORDS, money, fmtDate, todayUtc, dayDiff, addMonths };
