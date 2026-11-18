'use strict';
/**
 * Lookups that use free public APIs (no keys): CoinGecko, open.er-api.com, Yahoo Finance chart feed, REST Countries,
 * OpenStreetMap Nominatim, GitHub, npm, PyPI, StackExchange, dev.to, Hacker News, Open Library, TVmaze, Jikan (MyAnimeList),
 * Datamuse, Urban Dictionary, AlQuran Cloud, Nager.Date holidays and ESPN scoreboards.
 * Every call has a timeout and a friendly error, so a down service never breaks the bot.
 */
const U = require('../lib/util');
const { UserError, bold, getJson, getText } = U;

const trim = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const money = (n, cur = 'USD') => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: n < 1 ? 6 : 2 }).format(n); } catch { return `${n} ${cur}`; } };
const big = n => (n >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Number(n).toLocaleString('en-US'));
const arrow = p => (p > 0 ? '🟢 ▲' : p < 0 ? '🔴 ▼' : '⚪');
const haversine = (a, b) => { const R = 6371, rad = x => x * Math.PI / 180, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const ESPN = { f1: ['racing', 'f1', 'Formula 1', '🏎️'], tennis: ['tennis', 'atp', 'Tennis (ATP)', '🎾'], ufc: ['mma', 'ufc', 'UFC', '🥊'], nhl: ['hockey', 'nhl', 'NHL', '🏒'], mlb: ['baseball', 'mlb', 'MLB', '⚾'], rugby: ['rugby', '267979', 'Rugby', '🏉'], cricket: ['cricket', '8039', 'Cricket', '🏏'] };

module.exports = ({ def: rawDef, alias: rawAlias, registry }) => {
  const def = (names, opts, run) => { const n = [].concat(names).filter(x => !registry.has(x.toLowerCase())); if (n.length) rawDef(n, { cat: 'search', heavy: true, ...opts }, run); };
  const alias = (existing, ...names) => { if (!registry.has(existing)) return; const f = names.filter(x => !registry.has(x.toLowerCase())); if (f.length) rawAlias(existing, ...f); };
  const P = ctx => ctx.var('PREFIX');
  const J = async (url, o = {}) => { try { return await getJson(url, { timeout: 15000, ...o }); } catch (e) { if (/404/.test(String(e.message))) throw new UserError('I could not find that.'); throw new UserError('That service did not answer just now. Please try again in a moment.'); } };
  const q = (ctx, usage) => { const t = ctx.input().trim(); if (!t) throw new UserError(`Usage: *${P(ctx)}${usage}*`); return t; };
  const delegate = (ctx, target, args) => { const d = registry.get(target); if (!d) throw new UserError(`The ${target} command is not available.`); return d.run(Object.assign(Object.create(ctx), { cmd: target, args, argv: args.split(/\s+/).filter(Boolean), input: () => args })); };

  /* -------------------------------------- crypto -------------------------------------- */
  async function coin(query) {
    const s = await J(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
    const c = s.coins?.[0]; if (!c) throw new UserError(`No coin found for "${query}".`);
    return c;
  }
  async function coinCard(ctx, query, cur = 'usd') {
    const c = await coin(query); cur = (cur || 'usd').toLowerCase();
    const m = (await J(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${cur}&ids=${c.id}&price_change_percentage=7d`))[0];
    if (!m) throw new UserError('No market data for that coin / currency.');
    const ch = m.price_change_percentage_24h || 0;
    await ctx.reply(`${arrow(ch)} *${m.name}* (${m.symbol.toUpperCase()})\n💵 Price: *${money(m.current_price, cur)}*\n📊 24h: *${ch.toFixed(2)}%*${m.price_change_percentage_7d_in_currency != null ? ` • 7d: *${m.price_change_percentage_7d_in_currency.toFixed(2)}%*` : ''}\n⬆️ 24h high ${money(m.high_24h, cur)}  ⬇️ low ${money(m.low_24h, cur)}\n🏦 Market cap: ${big(m.market_cap)}  • Rank #${m.market_cap_rank}`, { title: 'Crypto' });
  }
  def('coinprice', { usage: 'coinprice <coin> [currency]', desc: 'Live price of a cryptocurrency (CoinGecko).' }, ctx => { const [n, c] = q(ctx, 'coinprice solana kes').split(/\s+/); return coinCard(ctx, n, c); });
  def('bitcoin', { usage: 'bitcoin [currency]', desc: 'Bitcoin price.' }, ctx => coinCard(ctx, 'bitcoin', ctx.argv[0]));
  def('ethereum', { usage: 'ethereum [currency]', desc: 'Ethereum price.' }, ctx => coinCard(ctx, 'ethereum', ctx.argv[0]));
  def('cryptochart', { usage: 'cryptochart <coin> [days 1-90]', desc: '7-day (or custom) price chart of a coin.' }, async ctx => {
    const [name, d] = q(ctx, 'cryptochart bitcoin 30').split(/\s+/); const days = Math.min(90, Math.max(1, Number(d) || 7)); const c = await coin(name);
    const j = await J(`https://api.coingecko.com/api/v3/coins/${c.id}/market_chart?vs_currency=usd&days=${days}`); const pts = (j.prices || []).map(p => p[1]);
    if (pts.length < 2) throw new UserError('No chart data for that coin.');
    const W = 900, H = 450, pad = 50, min = Math.min(...pts), max = Math.max(...pts), step = (W - pad * 2) / (pts.length - 1);
    const line = pts.map((v, i) => `${(pad + i * step).toFixed(1)},${(H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2)).toFixed(1)}`).join(' ');
    const up = pts[pts.length - 1] >= pts[0], col = up ? '#16a34a' : '#dc2626';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#0f172a"/><text x="${pad}" y="34" font-family="Arial" font-size="24" font-weight="700" fill="#fff">${U.escXml(c.name || name)} — ${days}d (USD)</text><polyline points="${line}" fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="round"/><text x="${pad}" y="${H - 16}" font-family="Arial" font-size="18" fill="#94a3b8">low ${money(min)}</text><text x="${W - pad}" y="${H - 16}" font-family="Arial" font-size="18" fill="#94a3b8" text-anchor="end">high ${money(max)}</text></svg>`;
    await ctx.image(await U.sharp()(Buffer.from(svg)).png().toBuffer(), `${arrow(pts[pts.length - 1] - pts[0])} ${c.name || name}: ${money(pts[0])} → *${money(pts[pts.length - 1])}* (${(((pts[pts.length - 1] - pts[0]) / pts[0]) * 100).toFixed(2)}%)`);
  });

  /* ------------------------------------ money & markets ------------------------------------ */
  def(['exchange', 'forex', 'fx'], { usage: 'exchange 100 usd kes', desc: 'Convert between currencies with live rates (about 160 currencies, incl. KES).' }, async ctx => {
    const m = q(ctx, 'exchange 100 usd kes').match(/^([\d.,]+)?\s*([a-z]{3})\s*(?:to|in|->)?\s*([a-z]{3})$/i);
    if (!m) throw new UserError(`Usage: *${P(ctx)}exchange 100 usd kes*`);
    const amt = Number((m[1] || '1').replace(/,/g, '')), from = m[2].toUpperCase(), to = m[3].toUpperCase();
    const j = await J(`https://open.er-api.com/v6/latest/${from}`);
    if (j.result !== 'success' || !j.rates?.[to]) throw new UserError('Unknown currency code. Use 3-letter codes like USD, KES, EUR, GBP.');
    await ctx.reply(`💱 ${amt.toLocaleString('en-US')} ${from} = *${(amt * j.rates[to]).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${to}*\n📈 1 ${from} = ${j.rates[to].toFixed(4)} ${to}`, { title: 'Exchange' });
  });
  async function yahoo(symbol) {
    const j = await J(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
    const r = j.chart?.result?.[0]; if (!r?.meta?.regularMarketPrice) throw new UserError('I could not find that symbol.');
    return r.meta;
  }
  const quote = (m, label) => { const prev = m.chartPreviousClose ?? m.previousClose, ch = prev ? ((m.regularMarketPrice - prev) / prev) * 100 : 0; return `${arrow(ch)} *${label || m.shortName || m.symbol}* (${m.symbol})\n💵 *${money(m.regularMarketPrice, m.currency || 'USD')}*  (${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%)\n⬆️ ${money(m.regularMarketDayHigh ?? m.regularMarketPrice, m.currency || 'USD')}  ⬇️ ${money(m.regularMarketDayLow ?? m.regularMarketPrice, m.currency || 'USD')}\n🏛️ ${m.exchangeName || ''}`; };
  def(['stock', 'share'], { usage: 'stock <symbol e.g. AAPL, TSLA, SCOM.NR>', desc: 'Latest stock price (Yahoo Finance).' }, async ctx => ctx.reply(quote(await yahoo(q(ctx, 'stock AAPL').split(/\s+/)[0].toUpperCase())), { title: 'Stock' }));
  def('goldprice', { desc: 'Gold futures price (USD per ounce).' }, async ctx => ctx.reply(quote(await yahoo('GC=F'), 'Gold (per oz)'), { title: 'Gold' }));
  def('oilprice', { desc: 'Crude oil prices (WTI and Brent).' }, async ctx => { const [w, b] = await Promise.all([yahoo('CL=F'), yahoo('BZ=F')]); await ctx.reply(`${quote(w, 'WTI crude')}\n\n${quote(b, 'Brent crude')}`, { title: 'Oil' }); });
  def('marketnews', { usage: 'marketnews', desc: 'Latest stock-market headlines.' }, ctx => delegate(ctx, 'news', 'stock market'));
  def('stocknews', { usage: 'stocknews [company]', desc: 'News about a company or the stock market.' }, ctx => delegate(ctx, 'news', `${ctx.input().trim() || 'stock market'} stock`));

  /* ------------------------------------ places & countries ------------------------------------ */
  async function geocode(place) {
    const r = await J(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(place)}`, { headers: { 'user-agent': 'DECANXMD-WhatsApp-Bot/1.0' } });
    if (!r[0]) throw new UserError(`I could not find "${place}".`);
    return { lat: Number(r[0].lat), lon: Number(r[0].lon), name: r[0].display_name };
  }
  def(['maps', 'map'], { usage: 'maps <place>', desc: 'Find a place and send its location pin.' }, async ctx => {
    const p = await geocode(q(ctx, 'maps Nairobi National Park'));
    await ctx.send({ location: { degreesLatitude: p.lat, degreesLongitude: p.lon, name: trim(p.name.split(',')[0], 60), address: trim(p.name, 150) } }, { quoted: ctx.msg });
    await ctx.reply(`📍 ${trim(p.name, 160)}\n🧭 ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}\n🗺️ https://www.google.com/maps?q=${p.lat},${p.lon}`, { title: 'Maps' });
  });
  def('distance', { usage: 'distance Nairobi | Mombasa', desc: 'Straight-line distance between two places.' }, async ctx => {
    const [a, b] = q(ctx, 'distance Nairobi | Mombasa').split('|').map(s => s.trim()); if (!a || !b) throw new UserError(`Usage: *${P(ctx)}distance Nairobi | Mombasa*`);
    const [pa, pb] = await Promise.all([geocode(a), geocode(b)]); const km = haversine(pa, pb);
    await ctx.reply(`📏 *${trim(pa.name.split(',')[0], 40)}* → *${trim(pb.name.split(',')[0], 40)}*\n✈️ ${km.toFixed(1)} km (${(km * 0.621371).toFixed(1)} mi) in a straight line\n_Road distance will be longer._`, { title: 'Distance' });
  });
  async function country(name) {
    const r = await J(`https://restcountries.com/v3.1/name/${encodeURIComponent(name)}?fields=name,capital,region,subregion,population,languages,currencies,idd,cca2,flag,area,tld,timezones`);
    if (!Array.isArray(r) || !r.length) throw new UserError('I could not find that country.');
    return r.find(c => c.name.common.toLowerCase() === name.toLowerCase()) || r[0];
  }
  def(['country', 'countryinfo'], { usage: 'country <name>', desc: 'Facts about a country.' }, async ctx => {
    const c = await country(q(ctx, 'country Kenya'));
    await ctx.reply(`${c.flag} *${c.name.common}* (${c.name.official})\n🏛️ Capital: ${(c.capital || ['—']).join(', ')}\n🌍 ${c.region}${c.subregion ? ' • ' + c.subregion : ''}\n👥 Population: ${Number(c.population).toLocaleString('en-US')}\n📐 Area: ${Number(c.area).toLocaleString('en-US')} km²\n🗣️ ${Object.values(c.languages || {}).join(', ')}\n💰 ${Object.values(c.currencies || {}).map(x => `${x.name} (${x.symbol || ''})`).join(', ')}\n📞 ${c.idd?.root || ''}${(c.idd?.suffixes || [])[0] || ''} • 🌐 ${(c.tld || []).join(' ')}\n🕒 ${(c.timezones || []).slice(0, 2).join(', ')}`, { title: 'Country' });
  });
  def('flag', { usage: 'flag <country>', desc: 'Show a country\'s flag.' }, async ctx => {
    const c = await country(q(ctx, 'flag Kenya')); await ctx.image((await U.download(`https://flagcdn.com/w640/${c.cca2.toLowerCase()}.png`)).buffer, `${c.flag} ${c.name.common}`);
  });
  def(['holiday', 'holidays', 'events'], { usage: 'holiday [country code e.g. KE, US] [year]', desc: 'Public holidays (default: Kenya, this year; shows the upcoming ones).' }, async ctx => {
    const cc = (ctx.argv.find(a => /^[a-z]{2}$/i.test(a)) || process.env.NEWS_REGION || 'KE').toUpperCase(); const y = Number(ctx.argv.find(a => /^\d{4}$/.test(a))) || new Date().getFullYear();
    const r = await J(`https://date.nager.at/api/v3/PublicHolidays/${y}/${cc}`); const today = new Date().toISOString().slice(0, 10);
    const list = (ctx.argv.some(a => /^\d{4}$/.test(a)) ? r : r.filter(h => h.date >= today)).slice(0, 12);
    await ctx.reply(list.length ? list.map(h => `📅 ${h.date} — *${h.localName}*${h.localName !== h.name ? ` (${h.name})` : ''}`).join('\n') : 'No more public holidays listed this year.', { title: `Holidays ${cc} ${y}` });
  });

  /* --------------------------------------- developer --------------------------------------- */
  const GH = () => ({ headers: { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } });
  def('githubuser', { usage: 'githubuser <username>', desc: 'GitHub profile summary.' }, async ctx => {
    const u = await J(`https://api.github.com/users/${encodeURIComponent(q(ctx, 'githubuser torvalds').split(/\s+/)[0])}`, GH());
    await ctx.reply(`👤 *${u.name || u.login}* (@${u.login})\n${u.bio ? trim(u.bio, 160) + '\n' : ''}📦 ${u.public_repos} repos • 👥 ${u.followers} followers • ➡️ ${u.following} following\n${u.location ? '📍 ' + u.location + '\n' : ''}🗓️ Joined ${String(u.created_at).slice(0, 10)}\n🔗 ${u.html_url}`, { title: 'GitHub user' });
  });
  def('githubrepo', { usage: 'githubrepo <owner/repo>', desc: 'GitHub repository summary.' }, async ctx => {
    const n = q(ctx, 'githubrepo nodejs/node').replace(/^https?:\/\/github\.com\//, '').split(/\s+/)[0]; if (!/^[\w.-]+\/[\w.-]+$/.test(n)) throw new UserError('Use owner/repo, e.g. nodejs/node');
    const r = await J(`https://api.github.com/repos/${n}`, GH());
    await ctx.reply(`📦 *${r.full_name}*${r.fork ? ' (fork)' : ''}\n${trim(r.description || 'No description', 200)}\n⭐ ${r.stargazers_count.toLocaleString('en-US')} • 🍴 ${r.forks_count.toLocaleString('en-US')} • 👁️ ${r.subscribers_count?.toLocaleString('en-US') ?? '?'}\n💻 ${r.language || '—'} • 📜 ${r.license?.spdx_id || 'no license'}\n🐞 ${r.open_issues_count} open issues\n🕒 Updated ${String(r.pushed_at).slice(0, 10)}\n🔗 ${r.html_url}`, { title: 'GitHub repo' });
  });
  def('githubissues', { usage: 'githubissues <owner/repo>', desc: 'Latest open issues of a repository.' }, async ctx => {
    const n = q(ctx, 'githubissues nodejs/node').split(/\s+/)[0]; if (!/^[\w.-]+\/[\w.-]+$/.test(n)) throw new UserError('Use owner/repo, e.g. nodejs/node');
    const r = (await J(`https://api.github.com/repos/${n}/issues?state=open&per_page=10`, GH())).filter(i => !i.pull_request).slice(0, 6);
    await ctx.reply(r.length ? r.map(i => `🐞 #${i.number} *${trim(i.title, 80)}*\n   ${i.html_url}`).join('\n') : 'No open issues. 🎉', { title: `Issues — ${n}` });
  });
  def('npm', { usage: 'npm <package>', desc: 'Info about an npm package.' }, async ctx => {
    const n = q(ctx, 'npm express').split(/\s+/)[0]; const [p, d] = await Promise.all([J(`https://registry.npmjs.org/${encodeURIComponent(n).replace('%40', '@')}/latest`), J(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(n).replace('%40', '@')}`).catch(() => ({}))]);
    await ctx.reply(`📦 *${p.name}* v${p.version}\n${trim(p.description || '', 200)}\n⬇️ ${d.downloads ? d.downloads.toLocaleString('en-US') + ' downloads last week' : 'downloads unknown'}\n📜 ${p.license || '—'}${p.homepage ? '\n🏠 ' + p.homepage : ''}\n📥 npm i ${p.name}`, { title: 'npm' });
  });
  def('npmsearch', { usage: 'npmsearch <words>', desc: 'Search npm packages.' }, async ctx => {
    const r = (await J(`https://registry.npmjs.org/-/v1/search?size=6&text=${encodeURIComponent(q(ctx, 'npmsearch http client'))}`)).objects || [];
    await ctx.reply(r.length ? r.map(o => `📦 *${o.package.name}* v${o.package.version}\n   ${trim(o.package.description || '', 90)}`).join('\n') : 'No packages found.', { title: 'npm search' });
  });
  def('pypi', { usage: 'pypi <package>', desc: 'Info about a PyPI package.' }, async ctx => {
    const i = (await J(`https://pypi.org/pypi/${encodeURIComponent(q(ctx, 'pypi requests').split(/\s+/)[0])}/json`)).info;
    await ctx.reply(`🐍 *${i.name}* v${i.version}\n${trim(i.summary || '', 200)}\n👤 ${i.author || '—'} • 📜 ${i.license ? trim(i.license, 30) : '—'}\n🐍 Python ${i.requires_python || 'any'}\n📥 pip install ${i.name}\n🔗 ${i.package_url}`, { title: 'PyPI' });
  });
  def('pypisearch', { usage: 'pypisearch <name>', desc: 'Look up a PyPI package by name (PyPI has no keyword-search API).' }, async ctx => {
    const n = q(ctx, 'pypisearch requests').split(/\s+/)[0];
    try { const i = (await J(`https://pypi.org/pypi/${encodeURIComponent(n)}/json`)).info; await ctx.reply(`🐍 *${i.name}* v${i.version} — ${trim(i.summary || '', 120)}\n🔗 ${i.package_url}`, { title: 'PyPI' }); }
    catch { await ctx.reply(`No package is named exactly "${n}". Search by keyword here:\nhttps://pypi.org/search/?q=${encodeURIComponent(n)}`, { title: 'PyPI' }); }
  });
  def('stackoverflow', { usage: 'stackoverflow <question>', desc: 'Top Stack Overflow questions for a search.' }, async ctx => {
    const r = (await J(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&pagesize=5&q=${encodeURIComponent(q(ctx, 'stackoverflow how to reverse a string'))}`)).items || [];
    await ctx.reply(r.length ? r.map(i => `${i.is_answered ? '✅' : '❓'} *${strip(i.title)}*\n   ⭐ ${i.score} • 💬 ${i.answer_count} • ${i.link}`).join('\n\n') : 'No questions found.', { title: 'Stack Overflow' });
  });
  def('devto', { usage: 'devto [tag]', desc: 'Latest DEV Community articles (optionally by tag).' }, async ctx => {
    const t = ctx.argv[0]; const r = await J(`https://dev.to/api/articles?per_page=6${t ? '&tag=' + encodeURIComponent(t) : ''}`);
    await ctx.reply(r.length ? r.map(a => `📝 *${trim(a.title, 90)}*\n   ${a.user?.name || ''} • ❤️ ${a.public_reactions_count}\n   ${a.url}`).join('\n\n') : 'No articles found.', { title: 'DEV' });
  });
  def('hackernews', { usage: 'hackernews', desc: 'Top Hacker News stories right now.' }, async ctx => {
    const ids = (await J('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, 6); const items = await Promise.all(ids.map(id => J(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
    await ctx.reply(items.filter(Boolean).map((s, i) => `${i + 1}. *${trim(s.title, 90)}*\n   ▲ ${s.score} • 💬 ${s.descendants || 0}\n   ${s.url || 'https://news.ycombinator.com/item?id=' + s.id}`).join('\n\n'), { title: 'Hacker News' });
  });
  def('medium', { usage: 'medium <tag>', desc: 'Latest Medium articles for a tag.' }, async ctx => {
    const xml = await getText(`https://medium.com/feed/tag/${encodeURIComponent(q(ctx, 'medium javascript').split(/\s+/)[0].toLowerCase())}`, { timeout: 15000 }).catch(() => { throw new UserError('Medium did not answer just now.'); });
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6).map(m => ({ t: strip((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1]).replace(/<!\[CDATA\[|\]\]>/g, ''), l: strip((m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1]).split('?')[0] }));
    await ctx.reply(items.length ? items.map(i => `📝 *${trim(i.t, 90)}*\n   ${i.l}`).join('\n\n') : 'No articles found.', { title: 'Medium' });
  });
  const siteSearch = (name, site, label) => def(name, { usage: `${name} <search>`, desc: `Search ${label} through the web.` }, async ctx => {
    const r = await require('../lib/websearch').ddg(`site:${site} ${q(ctx, `${name} marketing`)}`, 6);
    await ctx.reply(r.length ? r.map(x => `🔎 *${trim(x.title, 80)}*\n   ${trim(x.snippet, 110)}\n   ${x.link}`).join('\n\n') : 'No results.', { title: label });
  });
  siteSearch('quora', 'quora.com', 'Quora'); siteSearch('linkedin', 'linkedin.com', 'LinkedIn'); siteSearch('producthunt', 'producthunt.com', 'Product Hunt'); siteSearch('twitchsearch', 'twitch.tv', 'Twitch');

  /* ------------------------------------ books, TV, anime ------------------------------------ */
  def(['books', 'booksearch', 'book'], { usage: 'books <title or author>', desc: 'Search books (Open Library).' }, async ctx => {
    const r = (await J(`https://openlibrary.org/search.json?limit=6&fields=title,author_name,first_publish_year,key,edition_count&q=${encodeURIComponent(q(ctx, 'books atomic habits'))}`)).docs || [];
    await ctx.reply(r.length ? r.map(b => `📚 *${trim(b.title, 70)}*\n   ✍️ ${(b.author_name || ['?']).slice(0, 2).join(', ')} • ${b.first_publish_year || '?'} • ${b.edition_count || 1} editions\n   https://openlibrary.org${b.key}`).join('\n\n') : 'No books found.', { title: 'Books' });
  });
  def(['tv', 'series', 'seriesinfo', 'tvinfo'], { usage: 'series <show name>', desc: 'TV show details (TVmaze).' }, async ctx => {
    const s = await J(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(q(ctx, 'series Money Heist'))}`);
    await ctx.reply(`📺 *${s.name}* (${String(s.premiered || '').slice(0, 4) || '?'})\n⭐ ${s.rating?.average || '—'} • ${s.status} • ${s.type}\n🎭 ${(s.genres || []).join(', ') || '—'}\n📡 ${s.network?.name || s.webChannel?.name || '—'}\n\n${trim(strip(s.summary), 400)}\n\n🔗 ${s.url}`, { title: 'TV show' });
  });
  alias('movie', 'movies', 'imdb', 'tmdb', 'movieinfo');
  def('trailer', { usage: 'trailer <movie or show>', desc: 'Find the official trailer on YouTube.' }, async ctx => {
    const r = await U.ytSearch(`${q(ctx, 'trailer Black Panther')} official trailer`, 3); if (!r.length) throw new UserError('No trailer found.');
    await ctx.reply(r.map(v => `🎬 *${trim(v.title, 80)}*\n   ${v.channel} • ${v.duration}\n   ${v.url}`).join('\n\n'), { title: 'Trailers' });
  });
  const jikan = (kind, many, usage) => async ctx => {
    const r = (await J(`https://api.jikan.moe/v4/${kind}?limit=${many ? 5 : 1}&q=${encodeURIComponent(q(ctx, usage))}`)).data || []; if (!r.length) throw new UserError('Nothing found.');
    if (many) return ctx.reply(r.map(a => kind === 'characters' ? `🧑 *${a.name}*\n   ❤️ ${a.favorites} favourites\n   ${a.url}` : `🎌 *${a.title}* — ⭐ ${a.score || '—'} • ${a.type || ''}\n   ${a.url}`).join('\n\n'), { title: kind });
    const a = r[0];
    if (kind === 'characters') return ctx.reply(`🧑 *${a.name}* ${a.name_kanji ? '(' + a.name_kanji + ')' : ''}\n❤️ ${a.favorites} favourites\n\n${trim(a.about || '', 500)}\n🔗 ${a.url}`, { title: 'Character' });
    const text = `🎌 *${a.title}*${a.title_japanese ? ' (' + a.title_japanese + ')' : ''}\n⭐ ${a.score || '—'} • ${a.type} • ${a.status}\n${kind === 'anime' ? `📺 Episodes: ${a.episodes || '?'} • ${a.season ? a.season + ' ' + a.year : (a.aired?.string || '')}` : `📖 Chapters: ${a.chapters || '?'} • Volumes: ${a.volumes || '?'}`}\n🎭 ${(a.genres || []).map(g => g.name).join(', ')}\n\n${trim(a.synopsis || '', 450)}\n🔗 ${a.url}`;
    const img = a.images?.jpg?.image_url; if (img) { try { return await ctx.image((await U.download(img)).buffer, text); } catch {} }
    await ctx.reply(text, { title: kind });
  };
  def(['animeinfo'], { usage: 'animeinfo <title>', desc: 'Anime details (MyAnimeList via Jikan).' }, jikan('anime', false, 'animeinfo Naruto'));
  def('animesearch', { usage: 'animesearch <title>', desc: 'Search anime.' }, jikan('anime', true, 'animesearch one piece'));
  def(['mangainfo', 'manga'], { usage: 'mangainfo <title>', desc: 'Manga details.' }, jikan('manga', false, 'mangainfo Berserk'));
  def('mangasearch', { usage: 'mangasearch <title>', desc: 'Search manga.' }, jikan('manga', true, 'mangasearch blue lock'));
  def('character', { usage: 'character <name>', desc: 'Anime/manga character details.' }, jikan('characters', false, 'character Luffy'));

  /* ----------------------------------------- words ----------------------------------------- */
  const datamuse = (name, rel, label) => def(name, { usage: `${name} <word>`, desc: `${label} of a word.` }, async ctx => {
    const w = q(ctx, `${name} happy`).split(/\s+/)[0]; const r = await J(`https://api.datamuse.com/words?${rel}=${encodeURIComponent(w)}&max=16`);
    await ctx.reply(r.length ? r.map(x => x.word).join(', ') : `No ${label.toLowerCase()} found for "${w}".`, { title: `${label}: ${w}` });
  });
  datamuse('synonym', 'rel_syn', 'Synonyms'); datamuse('antonym', 'rel_ant', 'Antonyms');
  alias('define', 'meaning');
  def('urban', { usage: 'urban <slang>', desc: 'Urban Dictionary definition (can contain adult language).' }, async ctx => {
    const r = (await J(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(q(ctx, 'urban rizz'))}`)).list?.[0]; if (!r) throw new UserError('No definition found.');
    await ctx.reply(`📖 *${r.word}*\n\n${trim(r.definition.replace(/[\[\]]/g, ''), 450)}\n\n_"${trim(r.example.replace(/[\[\]]/g, ''), 200)}"_\n👍 ${r.thumbs_up} 👎 ${r.thumbs_down}`, { title: 'Urban Dictionary' });
  });
  def(['quran', 'ayah'], { usage: 'quran <surah>:<ayah>  e.g. quran 2:255', desc: 'A verse of the Quran in Arabic with an English translation.' }, async ctx => {
    const m = q(ctx, 'quran 2:255').match(/^(\d{1,3})\s*[: ]\s*(\d{1,3})$/); if (!m) throw new UserError(`Usage: *${P(ctx)}quran 2:255* (surah:ayah)`);
    const r = (await J(`https://api.alquran.cloud/v1/ayah/${m[1]}:${m[2]}/editions/quran-uthmani,en.sahih`)).data; if (!r?.[0]) throw new UserError('Verse not found.');
    await ctx.reply(`${r[0].text}\n\n_${r[1].text}_\n\n— ${r[0].surah.englishName} (${r[0].surah.name}) ${r[0].surah.number}:${r[0].numberInSurah}`, { title: 'Quran' });
  });

  /* -------------------------------------------- sports -------------------------------------------- */
  const LEAGUE_ALIASES = { premierleague: 'epl', epl: 'epl', laliga: 'laliga', seriea: 'seriea', bundesliga: 'bundesliga', ligue1: 'ligue1', championsleague: 'ucl', afcon: 'afcon', worldcup: 'wc', fifa: 'wc', uefa: 'ucl' };
  for (const [name, code] of Object.entries(LEAGUE_ALIASES)) def(name, { cat: 'sports', usage: `${name}`, desc: `${name} standings table.` }, ctx => delegate(ctx, 'table', code));
  def('league', { cat: 'sports', usage: 'league <code e.g. epl, laliga, kpl>', desc: 'League standings (see .leagues for codes).' }, ctx => delegate(ctx, 'table', ctx.input().trim() || 'epl'));
  def('team', { cat: 'sports', usage: 'team <name>', desc: 'Latest match card for a team.' }, ctx => delegate(ctx, 'match', q(ctx, 'team Arsenal')));
  def(['football', 'footballnews', 'transfernews', 'sportstats'], { cat: 'sports', desc: 'Football headlines (transfer news, scores in .livescore).' }, ctx => delegate(ctx, 'sportnews', ctx.input()));
  def('nba', { cat: 'sports', desc: 'NBA live scores and today\'s games.' }, ctx => delegate(ctx, 'livescore', 'nba'));
  def('nfl', { cat: 'sports', desc: 'NFL live scores and games.' }, ctx => delegate(ctx, 'livescore', 'nfl'));
  for (const [name, [sport, league, label, icon]] of Object.entries(ESPN)) {
    def(name, { cat: 'sports', desc: `${label} scoreboard (ESPN).` }, async ctx => {
      const j = await J(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`);
      const ev = (j.events || []).slice(0, 8); if (!ev.length) return ctx.reply(`${icon} No ${label} events on the scoreboard right now.`, { title: label });
      await ctx.reply(ev.map(e => { const c = e.competitions?.[0]?.competitors || []; const sc = c.length === 2 && c.every(x => x.score != null && x.score !== '') ? `  ${c[0].score}–${c[1].score}` : ''; return `${icon} *${trim(e.shortName || e.name, 50)}*${sc}\n   ${e.status?.type?.shortDetail || ''}`; }).join('\n\n'), { title: label });
    });
  }
  def(['boxing'], { cat: 'sports', desc: 'Boxing news.' }, ctx => delegate(ctx, 'news', 'boxing fights'));
};

module.exports.helpers = { haversine, money, big, trim, strip };
