'use strict';
const crypto = require('crypto');
const U = require('../lib/util');
const { UserError, bold } = U;

const COINS = {
  btc: 'bitcoin', eth: 'ethereum', usdt: 'tether', bnb: 'binancecoin', sol: 'solana', xrp: 'ripple', usdc: 'usd-coin',
  ada: 'cardano', doge: 'dogecoin', trx: 'tron', ton: 'the-open-network', dot: 'polkadot', ltc: 'litecoin', matic: 'matic-network', shib: 'shiba-inu'
};
const money = n => (n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(Number(n.toPrecision(4))));

let rates = null; // { at, data }
async function getRates() {
  if (rates && Date.now() - rates.at < 3600e3) return rates.data;
  const d = await U.getJson('https://open.er-api.com/v6/latest/USD', { timeout: 10000 });
  if (d?.result !== 'success' || !d.rates) throw new Error('rates unavailable');
  rates = { at: Date.now(), data: d.rates };
  return d.rates;
}

const { sendButtons } = require('../lib/interactive');

module.exports = ({ def }) => {
  def('joke', { cat: 'tools', usage: 'joke', desc: 'A random joke.' }, async ctx => {
    const j = await U.getJson('https://official-joke-api.appspot.com/random_joke', { timeout: 9000 });
    if (!j?.setup) throw new UserError('No joke came back. Try again.');
    await sendButtons(ctx, { body: `${j.setup}\n\n😂 ${bold(j.punchline)}`, title: 'Joke', buttons: [{ label: '🔁 Another joke', cmd: 'joke' }, { label: '💡 Fun fact', cmd: 'fact' }, { label: '📋 Menu', cmd: 'menu' }] });
  });

  def(['quote', 'inspire'], { cat: 'tools', usage: 'quote', desc: 'A random inspirational quote.' }, async ctx => {
    const q = await U.getJson('https://zenquotes.io/api/random', { timeout: 9000 });
    const x = Array.isArray(q) ? q[0] : null;
    if (!x?.q) throw new UserError('No quote came back. Try again.');
    await sendButtons(ctx, { body: `“${x.q}”\n\n— ${bold(x.a || 'Unknown')}`, title: 'Quote', buttons: [{ label: '🔁 Another quote', cmd: 'quote' }, { label: '😂 Joke', cmd: 'joke' }, { label: '📋 Menu', cmd: 'menu' }] });
  });

  def(['fact', 'funfact'], { cat: 'tools', usage: 'fact', desc: 'A random fun fact.' }, async ctx => {
    const f = await U.getJson('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', { timeout: 9000 });
    if (!f?.text) throw new UserError('No fact came back. Try again.');
    await sendButtons(ctx, { body: `🧠 ${f.text}`, title: 'Did you know?', buttons: [{ label: '🔁 Another fact', cmd: 'fact' }, { label: '😂 Joke', cmd: 'joke' }, { label: '📋 Menu', cmd: 'menu' }] });
  });

  def(['define', 'dict'], { cat: 'tools', usage: 'define <word>', desc: 'English dictionary: meaning, part of speech and an example.' }, async ctx => {
    const w = ctx.input().trim().split(/\s+/)[0];
    if (!w) throw new UserError(`Usage: *${ctx.var('PREFIX')}define serendipity*`);
    let d;
    try { d = await U.getJson('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w.toLowerCase()), { timeout: 9000 }); }
    catch (e) { if (/HTTP 404/.test(e.message)) throw new UserError(`No definition found for *${w}*.`); throw e; }
    const e = d?.[0];
    if (!e) throw new UserError(`No definition found for *${w}*.`);
    const out = (e.meanings || []).slice(0, 3).map(m => {
      const df = m.definitions?.[0];
      return `${bold(m.partOfSpeech || '')}\n${df?.definition || ''}${df?.example ? `\n_e.g. ${df.example}_` : ''}`;
    });
    await ctx.reply(`${bold(e.word)}${e.phonetic ? `  ${e.phonetic}` : ''}\n\n${out.join('\n\n')}`, { title: 'Dictionary' });
  });

  def(['wiki', 'wikipedia'], { cat: 'tools', heavy: true, usage: 'wiki <topic>', desc: 'Short Wikipedia summary of a topic.' }, async ctx => {
    const t = ctx.input().trim();
    if (!t) throw new UserError(`Usage: *${ctx.var('PREFIX')}wiki Nairobi*`);
    const s = await U.getJson(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(t)}&limit=1`, { timeout: 9000 });
    const hit = s?.pages?.[0];
    if (!hit) throw new UserError(`Nothing found on Wikipedia for *${t}*.`);
    const p = await U.getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.key)}`, { timeout: 9000 });
    const text = String(p.extract || '').slice(0, 900);
    if (!text) throw new UserError(`Nothing found on Wikipedia for *${t}*.`);
    await ctx.reply(`${bold(p.title || hit.title)}\n\n${text}${p.extract.length > 900 ? '…' : ''}\n\n🔗 ${p.content_urls?.mobile?.page || p.content_urls?.desktop?.page || ''}`, { title: 'Wikipedia' });
  });

  def(['crypto', 'coin', 'price'], { cat: 'tools', usage: 'crypto <coin>  e.g. crypto btc eth', desc: 'Live crypto price in USD and KES with the 24h change (up to 5 coins).' }, async ctx => {
    const list = (ctx.argv.length ? ctx.argv : ['btc', 'eth']).slice(0, 5).map(c => COINS[c.toLowerCase()] || c.toLowerCase().replace(/[^a-z0-9-]/g, ''));
    const d = await U.getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${list.join(',')}&vs_currencies=usd,kes&include_24hr_change=true`, { timeout: 10000 });
    const rows = list.filter(id => d?.[id]?.usd !== undefined).map(id => {
      const x = d[id], ch = x.usd_24h_change;
      return `${ch >= 0 ? '🟢' : '🔴'} ${bold(id.toUpperCase())}\n$${money(x.usd)}  •  KES ${money(x.kes)}${typeof ch === 'number' ? `  •  ${ch >= 0 ? '+' : ''}${ch.toFixed(2)}% (24h)` : ''}`;
    });
    if (!rows.length) throw new UserError(`Coin not found. Try codes like btc, eth, sol, bnb, xrp, doge.`);
    await ctx.reply(rows.join('\n\n'), { title: 'Crypto prices' });
  });

  def(['convert', 'currency', 'fx'], { cat: 'tools', usage: 'convert 100 usd kes', desc: 'Convert between currencies using current exchange rates.' }, async ctx => {
    const m = ctx.args.match(/^([\d.,]+)\s*([a-zA-Z]{3})\s*(?:to|in|->)?\s*([a-zA-Z]{3})$/i);
    if (!m) throw new UserError(`Usage: *${ctx.var('PREFIX')}convert 100 usd kes*`);
    const amount = Number(m[1].replace(/,/g, '')), from = m[2].toUpperCase(), to = m[3].toUpperCase();
    if (!Number.isFinite(amount)) throw new UserError('That amount is not a valid number.');
    const r = await getRates();
    if (!r[from] || !r[to]) throw new UserError(`Unknown currency. Use 3-letter codes such as USD, KES, EUR, GBP.`);
    const out = amount / r[from] * r[to];
    await ctx.reply(`💱 ${bold(amount.toLocaleString('en-US'))} ${from} = ${bold(out.toLocaleString('en-US', { maximumFractionDigits: 2 }))} ${to}\n1 ${from} = ${(r[to] / r[from]).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${to}`, { title: 'Currency' });
  });

  def(['password', 'genpass'], { cat: 'tools', usage: 'password [length 8-64]', desc: 'Generate a strong random password.' }, async ctx => {
    const n = Math.min(64, Math.max(8, parseInt(ctx.argv[0], 10) || 16));
    const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?';
    let pw = '';
    for (let i = 0; i < n; i++) pw += set[crypto.randomInt(set.length)];
    await ctx.reply(`🔐 \`\`\`${pw}\`\`\`\nGenerated locally. Delete this message after copying it.`, { title: 'Password' });
  });

  def(['short', 'shorten'], { cat: 'tools', usage: 'short <link>', desc: 'Shorten a long link.' }, async ctx => {
    const url = ctx.input().trim().split(/\s+/)[0];
    if (!/^https?:\/\/\S+$/i.test(url)) throw new UserError(`Usage: *${ctx.var('PREFIX')}short https://example.com/very/long/link*`);
    const out = String(await U.getText('https://tinyurl.com/api-create.php?url=' + encodeURIComponent(url), { timeout: 10000 })).trim();
    if (!/^https?:\/\//.test(out)) throw new UserError('The link could not be shortened.');
    await ctx.reply(`🔗 ${out}`, { title: 'Short link' });
  });

  def(['verse', 'bible'], { cat: 'tools', usage: 'verse [reference]  e.g. verse john 3:16', desc: 'Bible verse by reference, or a random verse.' }, async ctx => {
    const ref = ctx.input().trim() || 'random';
    const d = await U.getJson(`https://bible-api.com/${encodeURIComponent(ref)}${ref === 'random' ? '' : '?translation=kjv'}`, { timeout: 10000 }).catch(e => { if (/HTTP 404/.test(e.message)) throw new UserError(`Verse not found. Try *${ctx.var('PREFIX')}verse john 3:16*`); throw e; });
    if (!d?.text) throw new UserError('No verse came back. Try again.');
    await ctx.reply(`📖 ${bold(d.reference || ref)}\n\n${String(d.text).trim()}\n\n_${d.translation_name || 'KJV'}_`, { title: 'Bible' });
  });

  def(['github', 'gh'], { cat: 'tools', usage: 'github <username>', desc: 'GitHub profile summary.' }, async ctx => {
    const u = ctx.argv[0];
    if (!u || !/^[\w-]{1,39}$/.test(u)) throw new UserError(`Usage: *${ctx.var('PREFIX')}github octocat*`);
    const d = await U.getJson('https://api.github.com/users/' + u, { timeout: 10000 }).catch(e => { if (/HTTP 404/.test(e.message)) throw new UserError('GitHub user not found.'); throw e; });
    const text = `👤 ${bold(d.name || d.login)} (@${d.login})\n${d.bio ? d.bio + '\n' : ''}\n📦 Repos: ${d.public_repos}   👥 Followers: ${d.followers}   ➡️ Following: ${d.following}${d.location ? `\n📍 ${d.location}` : ''}${d.blog ? `\n🌐 ${d.blog}` : ''}\n🔗 ${d.html_url}`;
    await ctx.reply(text, { title: 'GitHub' });
  });

  def(['ipinfo', 'ip'], { cat: 'tools', usage: 'ipinfo <ip or domain>', desc: 'Where an IP address or domain is located.' }, async ctx => {
    const q = ctx.argv[0];
    if (!q || !/^[\w.:-]{3,100}$/.test(q)) throw new UserError(`Usage: *${ctx.var('PREFIX')}ipinfo 8.8.8.8*`);
    const d = await U.getJson('https://ipwho.is/' + encodeURIComponent(q), { timeout: 10000 });
    if (!d?.success) throw new UserError('Could not look that up. Check the address.');
    await ctx.reply(`🌐 ${bold(d.ip)}\n📍 ${[d.city, d.region, d.country].filter(Boolean).join(', ')} ${d.flag?.emoji || ''}\n🏢 ${d.connection?.org || d.connection?.isp || 'n/a'}\n🕒 ${d.timezone?.id || 'n/a'}`, { title: 'IP lookup' });
  });

  const pic = (names, url, key, label) => def(names, { cat: 'tools', desc: `A random ${label} picture.` }, async ctx => {
    const j = await U.getJson(url, { timeout: 10000 });
    const link = key(j);
    if (!link) throw new UserError('No picture came back. Try again.');
    const buf = await U.http(link, { timeout: 20000, maxBytes: 8 * 1024 * 1024 });
    await ctx.image(buf, `🖼️ ${label}`);
  });
  pic(['catpic', 'kitty'], 'https://api.thecatapi.com/v1/images/search', j => j?.[0]?.url, 'cat');
  pic(['dogpic', 'puppy'], 'https://dog.ceo/api/breeds/image/random', j => j?.message, 'dog');
  pic(['meme'], 'https://meme-api.com/gimme', j => (j?.nsfw ? null : j?.url), 'meme');
};
