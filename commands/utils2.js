'use strict';
/** More utilities: dns, domain, uuid, base64, hash, json, url tools, google, lyrics info, WhatsApp profile lookups and privacy. */
const crypto = require('crypto');
const dns = require('dns').promises;
const U = require('../lib/util');
const { safeFetch } = require('../lib/safeurl');
const { UserError, bold } = U;

const qt = ctx => (ctx.quoted ? ctx.textOf(ctx.quoted.message) : '') || '';
const text = ctx => ctx.input().trim() || qt(ctx);
const need = (ctx, what, ex) => { throw new UserError(`${what} Example: *${ctx.var('PREFIX')}${ex}*`); };
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

module.exports = ({ def }) => {
  def('dns', { cat: 'tools', heavy: true, usage: 'dns <domain> [A|AAAA|MX|NS|TXT]', desc: 'DNS records of a domain.' }, async ctx => {
    const host = (ctx.argv[0] || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) need(ctx, 'Give a domain.', 'dns example.com');
    const types = ctx.argv[1] ? [ctx.argv[1].toUpperCase()] : ['A', 'AAAA', 'MX', 'NS', 'TXT'];
    const out = [];
    for (const t of types) {
      if (!['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME'].includes(t)) throw new UserError('Record types: A, AAAA, MX, NS, TXT, CNAME.');
      try {
        const r = await dns.resolve(host, t);
        const lines = r.map(x => (t === 'MX' ? `${x.priority} ${x.exchange}` : t === 'TXT' ? x.join('').slice(0, 90) : x));
        out.push(`${bold(t)}\n${lines.slice(0, 6).join('\n')}`);
      } catch { if (ctx.argv[1]) out.push(`${bold(t)}\nno records`); }
    }
    if (!out.length) throw new UserError('No DNS records found for that domain.');
    await ctx.reply(out.join('\n\n'), { title: `DNS • ${host}` });
  });

  def(['domain', 'domaininfo'], { cat: 'tools', heavy: true, usage: 'domain <name>', desc: 'Registration details of a domain (registrar, dates, name servers).' }, async ctx => {
    const host = (ctx.argv[0] || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) need(ctx, 'Give a domain.', 'domain example.com');
    const d = await U.getJson('https://rdap.org/domain/' + host, { timeout: 15000 }).catch(e => { if (/HTTP 404/.test(e.message)) throw new UserError('No registration record found (the domain may be unregistered or its registry does not publish RDAP).'); throw e; });
    const ev = a => (d.events || []).find(e => e.eventAction === a)?.eventDate?.slice(0, 10) || 'n/a';
    const reg = (d.entities || []).find(e => (e.roles || []).includes('registrar'));
    const regName = reg?.vcardArray?.[1]?.find(x => x[0] === 'fn')?.[3] || 'n/a';
    await ctx.reply([`🌐 ${bold(d.ldhName || host)}`, `🏢 Registrar: ${regName}`, `📅 Registered: ${ev('registration')}`, `⏳ Expires: ${ev('expiration')}`, `🔄 Updated: ${ev('last changed')}`, `📌 Status: ${(d.status || []).slice(0, 3).join(', ') || 'n/a'}`, `🧭 NS: ${(d.nameservers || []).map(n => n.ldhName).slice(0, 4).join(', ') || 'n/a'}`].join('\n'), { title: 'Domain info' });
  });

  def(['uuid', 'guid'], { cat: 'tools', usage: 'uuid [count 1-10]', desc: 'Generate random UUIDs.' }, async ctx => {
    const n = Math.min(10, Math.max(1, parseInt(ctx.argv[0], 10) || 1));
    await ctx.reply(Array.from({ length: n }, () => crypto.randomUUID()).join('\n'), { title: 'UUID' });
  });

  def(['base64', 'b64'], { cat: 'tools', usage: 'base64 <text> • base64 decode <text>', desc: 'Encode text to Base64, or decode it with "decode".' }, async ctx => {
    const dec = /^(decode|d|-d)$/i.test(ctx.argv[0] || '');
    const body = dec ? ctx.args.slice(ctx.argv[0].length).trim() || qt(ctx) : text(ctx);
    if (!body) need(ctx, 'Give some text.', 'base64 hello');
    if (dec) {
      if (!/^[A-Za-z0-9+/=_-]+$/.test(body)) throw new UserError('That is not valid Base64.');
      return ctx.reply(Buffer.from(body, 'base64').toString('utf8'), { title: 'Base64 decoded' });
    }
    await ctx.reply(Buffer.from(body, 'utf8').toString('base64'), { title: 'Base64' });
  });

  def('hash', { cat: 'tools', usage: 'hash [md5|sha1|sha256|sha512] <text>', desc: 'Hash text. Without an algorithm you get MD5, SHA-1 and SHA-256.' }, async ctx => {
    const algos = ['md5', 'sha1', 'sha256', 'sha512'];
    const first = (ctx.argv[0] || '').toLowerCase();
    const picked = algos.includes(first) ? [first] : ['md5', 'sha1', 'sha256'];
    const body = algos.includes(first) ? ctx.args.slice(first.length).trim() || qt(ctx) : text(ctx);
    if (!body) need(ctx, 'Give some text.', 'hash sha256 hello');
    await ctx.reply(picked.map(a => `${bold(a.toUpperCase())}\n${crypto.createHash(a).update(body).digest('hex')}`).join('\n\n'), { title: 'Hash' });
  });

  def('json', { cat: 'tools', usage: 'json <json> • json min <json>', desc: 'Validate and pretty-print JSON (or minify with "min").' }, async ctx => {
    const min = /^(min|minify)$/i.test(ctx.argv[0] || '');
    const body = min ? ctx.args.slice(ctx.argv[0].length).trim() || qt(ctx) : text(ctx);
    if (!body) need(ctx, 'Give some JSON.', 'json {"a":1}');
    let v;
    try { v = JSON.parse(body); } catch (e) { throw new UserError(`Invalid JSON: ${String(e.message).slice(0, 90)}`); }
    await ctx.reply('```' + (min ? JSON.stringify(v) : JSON.stringify(v, null, 2)).slice(0, 3500) + '```', { title: min ? 'JSON minified' : 'JSON valid ✅' });
  });

  def('urlencode', { cat: 'tools', usage: 'urlencode <text>', desc: 'Percent-encode text for use in a link.' }, async ctx => {
    const b = text(ctx); if (!b) need(ctx, 'Give some text.', 'urlencode hello world & more');
    await ctx.reply(encodeURIComponent(b), { title: 'URL encoded' });
  });
  def('urldecode', { cat: 'tools', usage: 'urldecode <text>', desc: 'Decode percent-encoded text.' }, async ctx => {
    const b = text(ctx); if (!b) need(ctx, 'Give some text.', 'urldecode hello%20world');
    let r; try { r = decodeURIComponent(b); } catch { throw new UserError('That is not valid percent-encoding.'); }
    await ctx.reply(r, { title: 'URL decoded' });
  });

  def('checkurl', { cat: 'tools', heavy: true, usage: 'checkurl <link>', desc: 'Check whether a website is up: status, speed, redirects, server.' }, async ctx => {
    const u = ctx.argv[0]; if (!u) need(ctx, 'Give a link.', 'checkurl example.com');
    let r;
    try { r = await safeFetch(u, { method: 'HEAD', timeout: 10000 }); if (r.status === 405 || r.status === 501) r = await safeFetch(u, { method: 'GET', timeout: 10000, maxBytes: 1000 }); }
    catch (e) { if (e instanceof UserError) throw e; throw new UserError('The site did not answer in time.'); }
    const up = r.status < 400;
    await ctx.reply([`${up ? '🟢 UP' : '🔴 PROBLEM'}  ${bold(String(r.status))}`, `⚡ ${r.ms} ms`, `🔗 ${r.url}`, r.hops.length ? `↪️ ${r.hops.length} redirect${r.hops.length > 1 ? 's' : ''}` : '', r.headers.get('server') ? `🖥️ ${r.headers.get('server')}` : '', r.headers.get('content-type') ? `📄 ${r.headers.get('content-type').split(';')[0]}` : ''].filter(Boolean).join('\n'), { title: 'Site check' });
  });

  def(['expandurl', 'unshorten', 'expand'], { cat: 'tools', heavy: true, usage: 'expandurl <short link>', desc: 'See where a shortened link really goes (every redirect step).' }, async ctx => {
    const u = ctx.argv[0] || qt(ctx).match(/https?:\/\/\S+/)?.[0]; if (!u) need(ctx, 'Give a short link.', 'expandurl https://bit.ly/xyz');
    const r = await safeFetch(u, { method: 'HEAD', timeout: 10000 }).catch(async e => { if (e instanceof UserError) throw e; return safeFetch(u, { method: 'GET', timeout: 10000, maxBytes: 500 }); });
    const steps = [...r.hops.map(h => `${h.status} ${h.url}`), `${r.status} ${r.url}`];
    await ctx.reply(`${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n✅ Final: ${r.url}`, { title: 'Link expander' });
  });

  def('fetch', { cat: 'tools', owner: true, heavy: true, usage: 'fetch <link>', desc: 'Fetch a web page and show its status, headers and the start of its text (public addresses only).' }, async ctx => {
    const u = ctx.argv[0]; if (!u) need(ctx, 'Give a link.', 'fetch https://example.com');
    const r = await safeFetch(u, { timeout: 12000, maxBytes: 200000 });
    const body = /html/i.test(r.headers.get('content-type') || '') ? strip(r.body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')) : r.body.trim();
    await ctx.reply(`${bold(String(r.status))} • ${r.ms} ms • ${(r.headers.get('content-type') || '').split(';')[0]}\n${r.url}\n\n${body.slice(0, 900)}${body.length > 900 ? '…' : ''}`, { title: 'Fetch' });
  });

  def(['google', 'search', 'web'], { cat: 'search', heavy: true, usage: 'google <query>', desc: 'Web search: top results with links (DuckDuckGo).' }, async ctx => {
    const q = text(ctx); if (!q) need(ctx, 'What should I search for?', 'google best laptops 2026');
    const items = (await require('../lib/websearch').ddg(q, 5)).map(r => `${bold(r.title)}\n${r.snippet ? r.snippet.slice(0, 140) + '\n' : ''}🔗 ${r.link}`);
    if (!items.length) return ctx.reply(`I could not read results right now. Open the search:\nhttps://www.google.com/search?q=${encodeURIComponent(q)}`, { title: 'Search' });
    await ctx.reply(items.join('\n\n'), { title: `Search: ${q.slice(0, 40)}` });
  });

  def('lyrics', { cat: 'search', heavy: true, usage: 'lyrics <song>', desc: 'Song details (artist, album, year, 30-second preview) with a link to the full lyrics.' }, async ctx => {
    const q = text(ctx); if (!q) need(ctx, 'Which song?', 'lyrics last last burna boy');
    const j = await U.getJson('https://itunes.apple.com/search?entity=song&limit=1&term=' + encodeURIComponent(q), { timeout: 12000 }).catch(() => null);
    const s = j?.results?.[0];
    const link = 'https://genius.com/search?q=' + encodeURIComponent(s ? `${s.artistName} ${s.trackName}` : q);
    if (!s) return ctx.reply(`I could not identify that song. Try the lyrics search:\n${link}`, { title: 'Lyrics' });
    await ctx.reply(`🎵 ${bold(s.trackName)}\n👤 ${s.artistName}\n💿 ${s.collectionName || 'Single'}${s.releaseDate ? ` • ${s.releaseDate.slice(0, 4)}` : ''}\n\n📖 Full lyrics: ${link}${s.previewUrl ? `\n🎧 Preview: ${s.previewUrl}` : ''}`, { title: 'Lyrics' });
  });

  /* ---------------- WhatsApp profile lookups ---------------- */
  const target = ctx => { const t = ctx.targets()[0]; const n = (ctx.argv[0] || '').replace(/\D/g, ''); return t || (n.length >= 7 ? n + '@s.whatsapp.net' : null) || (ctx.quoted?.sender) || (!ctx.isGroup ? ctx.chat : null); };

  def(['getstatus', 'about'], { cat: 'user', heavy: true, usage: 'getstatus [@user|number]', desc: 'Read someone\'s WhatsApp "About" text.' }, async ctx => {
    const jid = target(ctx); if (!jid) need(ctx, 'Whose status?', 'getstatus 254712345678');
    const r = await ctx.sock.fetchStatus(jid).catch(() => null);
    const s = Array.isArray(r) ? r[0]?.status : r;
    const txt = s?.status ?? s?.text;
    if (!txt) throw new UserError('No About text found (it may be hidden by their privacy settings).');
    await ctx.reply(`👤 +${ctx.jidUser(jid)}\n📝 ${txt}${s.setAt ? `\n🕒 ${new Date(s.setAt).toISOString().slice(0, 10)}` : ''}`, { title: 'About' });
  });

  def('businessinfo', { cat: 'user', heavy: true, usage: 'businessinfo [@user|number]', desc: 'Business profile of a WhatsApp Business account.' }, async ctx => {
    const jid = target(ctx); if (!jid) need(ctx, 'Which number?', 'businessinfo 254712345678');
    const b = await ctx.sock.getBusinessProfile(jid).catch(() => null);
    if (!b) throw new UserError('That number is not a WhatsApp Business account (or hides its profile).');
    await ctx.reply([`🏢 ${bold(b.wid ? '+' + ctx.jidUser(b.wid) : '+' + ctx.jidUser(jid))}`, b.description ? `📝 ${b.description}` : '', b.category ? `🏷️ ${b.category}` : '', b.email ? `✉️ ${b.email}` : '', b.website?.length ? `🌐 ${[].concat(b.website).join(', ')}` : '', b.address ? `📍 ${b.address}` : ''].filter(Boolean).join('\n'), { title: 'Business info' });
  });

  def('privacy', { cat: 'user', owner: true, heavy: true, desc: 'Show the privacy settings of the bot\'s WhatsApp account.' }, async ctx => {
    const p = await ctx.sock.fetchPrivacySettings(true).catch(() => null);
    if (!p) throw new UserError('Could not read the privacy settings right now.');
    const lab = { last: 'Last seen', online: 'Online', profile: 'Profile photo', status: 'About', readreceipts: 'Read receipts', groupadd: 'Add to groups', calladd: 'Calls', messages: 'Messages' };
    await ctx.reply(Object.entries(p).map(([k, v]) => `• ${bold(lab[k] || k)}: ${v}`).join('\n') + `\n\nChange: *${ctx.var('PREFIX')}lastseen all|contacts|none* • *${ctx.var('PREFIX')}readreceipts all|none*`, { title: 'Privacy' });
  });
  def('lastseen', { cat: 'user', owner: true, usage: 'lastseen all|contacts|contact_blacklist|none', desc: 'Who can see your last seen.' }, async ctx => {
    const v = (ctx.argv[0] || '').toLowerCase();
    if (!['all', 'contacts', 'contact_blacklist', 'none'].includes(v)) need(ctx, 'Choose all, contacts, contact_blacklist or none.', 'lastseen contacts');
    await ctx.sock.updateLastSeenPrivacy(v).catch(e => { throw new UserError('WhatsApp refused the change: ' + String(e.message).slice(0, 80)); });
    await ctx.reply(`👁️ Last seen: *${v}*`, { title: 'Privacy' });
  });
  def('readreceipts', { cat: 'user', owner: true, usage: 'readreceipts all|none', desc: 'Turn blue ticks (read receipts) on or off.' }, async ctx => {
    const v = (ctx.argv[0] || '').toLowerCase();
    if (!['all', 'none'].includes(v)) need(ctx, 'Choose all or none.', 'readreceipts none');
    await ctx.sock.updateReadReceiptsPrivacy(v).catch(e => { throw new UserError('WhatsApp refused the change: ' + String(e.message).slice(0, 80)); });
    await ctx.reply(`✔️ Read receipts: *${v === 'all' ? 'on' : 'off'}*`, { title: 'Privacy' });
  });
};
