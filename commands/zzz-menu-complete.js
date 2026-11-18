'use strict';

const os = require('os');
const crypto = require('crypto');
const { UserError, http, getJson, getText, bold, tzParts } = require('../lib/util');

module.exports = ({ def, alias, registry, hooks }) => {
  const P = ctx => ctx.var('PREFIX') || '.';
  const runExisting = async (ctx, name, args = ctx.args) => {
    const d = registry.get(name);
    if (!d) throw new UserError(`Internal command mapping missing: ${name}`);
    const sub = Object.assign(Object.create(ctx), { cmd: name, args, argv: String(args || '').trim().split(/\s+/).filter(Boolean), text: P(ctx) + name + (args ? ' ' + args : '') });
    return d.run(sub);
  };
  const text = ctx => String(ctx.input() || '').trim();
  const url = ctx => {
    const u = text(ctx).split(/\s+/)[0];
    if (!/^https?:\/\//i.test(u || '')) throw new UserError(`Usage: ${P(ctx)}${ctx.cmd} https://example.com`);
    return u;
  };
  const toggle = (name, key, label, owner = true) => def(name, { cat: 'whatsapp', owner, usage: `${name} on|off`, desc: `Enable or disable ${label}.` }, async ctx => {
    const a = (ctx.argv[0] || '').toLowerCase();
    if (!['on', 'off'].includes(a)) return ctx.reply(`${label}: *${ctx.get(key, false) ? 'ON' : 'OFF'}*\nUse *${P(ctx)}${name} on|off*.`);
    ctx.set(key, a === 'on');
    await ctx.reply(`✅ ${label}: *${a.toUpperCase()}*`);
  });

  // Group commands missing from the requested menu.
  def('acceptall', { cat: 'group', group: true, admin: true, botAdmin: true, usage: 'acceptall', desc: 'Approve every pending group join request.' }, async ctx => runExisting(ctx, 'approve', 'all'));
  def('admincheck', { cat: 'group', group: true, desc: 'Check whether you and the bot are group admins.' }, async ctx => {
    const m = await ctx.group();
    const me = await ctx.admin();
    const bot = await ctx.botAdmin();
    const admins = m.participants.filter(p => ctx.isAdminP(p)).length;
    await ctx.reply(`👤 You: *${me ? 'ADMIN' : 'MEMBER'}*\n🤖 Bot: *${bot ? 'ADMIN' : 'NOT ADMIN'}*\n👑 Admins: *${admins}*`, { title: 'Admin check' });
  });
  def('antibad', { cat: 'group', group: true, admin: true, usage: 'antibad on|off|warn|kick', desc: 'Moderate abusive language using the built-in anti-abuse guard.' }, async ctx => runExisting(ctx, 'antiabuse', ctx.args));
  def('botadmin', { cat: 'group', group: true, desc: 'Check whether DECAN XMD has administrator rights.' }, async ctx => ctx.reply(`🤖 Bot administrator: *${await ctx.botAdmin() ? 'YES' : 'NO'}*`, { title: 'Bot admin' }));
  def('end', { cat: 'group', group: true, desc: 'Stop an active DECAN XMD game or timed group activity.' }, async ctx => {
    const had = ctx.rt.games.delete(ctx.chat) || ctx.rt.votes.delete(ctx.chat);
    await ctx.reply(had ? '🛑 Active group activity ended.' : 'ℹ️ There is no active game or vote to end.');
  });
  def('groupstatus', { cat: 'group', group: true, desc: 'Show group size, admins and bot permissions.' }, async ctx => {
    const m = await ctx.group();
    const admins = m.participants.filter(p => ctx.isAdminP(p));
    await ctx.reply(`👥 *${m.subject || 'Group'}*\n🆔 ${ctx.chat}\n👤 Members: ${m.participants.length}\n👑 Admins: ${admins.length}\n🤖 Bot admin: ${await ctx.botAdmin() ? 'YES' : 'NO'}`, { title: 'Group status' });
  });
  def('removeadmins', { cat: 'group', group: true, admin: true, botAdmin: true, usage: 'removeadmins', desc: 'Demote all other group admins while keeping the bot and requesting owner protected.' }, async ctx => {
    const m = await ctx.group();
    const protectedIds = new Set([...ctx.botIds(), ctx.senderNum, ...ctx.ownerIds()].map(ctx.jidUser));
    const targets = m.participants.filter(p => ctx.isAdminP(p) && !pids(p).some(x => protectedIds.has(x))).map(p => p.id).filter(Boolean);
    if (!targets.length) return ctx.reply('ℹ️ No removable admins found.');
    await ctx.sock.groupParticipantsUpdate(ctx.chat, targets, 'demote');
    await ctx.reply(`⬇️ Demoted *${targets.length}* admin(s).`);
  });
  def('requestlist', { cat: 'group', group: true, admin: true, botAdmin: true, usage: 'requestlist', desc: 'List pending group join requests.' }, async ctx => runExisting(ctx, 'approve', 'list'));

  // Utilities: real local transforms and public HTTP APIs, with no fake success responses.
  def('8d', { cat: 'tools', usage: '8d <text>', desc: 'Return an 8D-style text transformation for quick audio/edit captions.' }, async ctx => {
    const t = text(ctx); if (!t) throw new UserError(`Usage: ${P(ctx)}8d <text>`);
    await ctx.reply(`🎧 8D TEXT\n${[...t].reverse().join(' • ')}\n\nOriginal: ${t}`, { title: '8D' });
  });
  toggle('autoviewsview', 'autoviewstatus', 'Auto view status');
  def('caesar', { cat: 'tools', usage: 'caesar <shift> <text>', desc: 'Encode or decode text with a Caesar shift.' }, async ctx => {
    const n = Number(ctx.argv[0]); const body = ctx.args.replace(/^\S+\s*/, '');
    if (!Number.isInteger(n) || Math.abs(n) > 25 || !body) throw new UserError(`Usage: ${P(ctx)}caesar 3 hello world`);
    const out = body.replace(/[A-Za-z]/g, c => { const base = c <= 'Z' ? 65 : 97; return String.fromCharCode((c.charCodeAt(0) - base + n + 26 * 10) % 26 + base); });
    await ctx.reply(out, { title: `Caesar ${n}` });
  });
  def('cookies', { cat: 'tools', heavy: true, usage: 'cookies <url>', desc: 'Inspect public Set-Cookie response headers without storing browser credentials.' }, async ctx => {
    const u = url(ctx); const r = await http(u, { as: 'response', timeout: 12000 });
    const raw = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    await ctx.reply(raw.length ? raw.map((x, i) => `${i + 1}. ${x.split(';')[0]}`).join('\n') : 'No public Set-Cookie headers were returned.', { title: 'Cookies' });
  });
  def('corscheck', { cat: 'tools', heavy: true, usage: 'corscheck <url>', desc: 'Check CORS response headers.' }, async ctx => {
    const u = url(ctx); const r = await http(u, { method: 'OPTIONS', as: 'response', timeout: 12000 }).catch(() => null) || await http(u, { method: 'GET', as: 'response', timeout: 12000 });
    await ctx.reply(`Status: ${r.status}\nAccess-Control-Allow-Origin: ${r.headers.get('access-control-allow-origin') || 'not returned'}\nMethods: ${r.headers.get('access-control-allow-methods') || 'not returned'}\nHeaders: ${r.headers.get('access-control-allow-headers') || 'not returned'}`, { title: 'CORS check' });
  });
  def('cve', { cat: 'tools', heavy: true, usage: 'cve CVE-2024-1234', desc: 'Look up a CVE using the public CIRCL CVE service.' }, async ctx => {
    const id = (ctx.argv[0] || '').toUpperCase(); if (!/^CVE-\d{4}-\d{4,}$/.test(id)) throw new UserError(`Usage: ${P(ctx)}cve CVE-2024-1234`);
    const j = await getJson(`https://cve.circl.lu/api/cve/${encodeURIComponent(id)}`);
    const d = j.cve?.description?.description_data?.[0]?.value || j.containers?.cna?.descriptions?.[0]?.value || 'No description.';
    const cvss = j.cvss?.baseScore ?? j.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore ?? 'n/a';
    await ctx.reply(`🛡️ ${bold(id)}\nCVSS: *${cvss}*\n\n${d.slice(0, 3000)}`, { title: 'CVE lookup' });
  });
  def('filegoat', { cat: 'download', heavy: true, usage: 'filegoat (reply to a file)', desc: 'Upload a replied file to 0x0.st and return its public link.' }, async ctx => {
    const m = await ctx.media(); if (!m) throw new UserError('Reply to a file or media.');
    const form = new FormData(); form.append('file', new Blob([m.buffer], { type: m.mime || 'application/octet-stream' }), m.name || `decan-${Date.now()}`);
    const r = await fetch('https://0x0.st', { method: 'POST', body: form, signal: AbortSignal.timeout(90000) });
    if (!r.ok) throw new Error(`Upload failed: HTTP ${r.status}`);
    await ctx.reply((await r.text()).trim(), { title: 'FileGoat' });
  });
  def('gitverse', { cat: 'search', heavy: true, usage: 'gitverse <repository query>', desc: 'Search public GitHub repositories.' }, async ctx => {
    const q = text(ctx); if (!q) throw new UserError(`Usage: ${P(ctx)}gitverse whatsapp bot`);
    const j = await getJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=5`, { headers: { accept: 'application/vnd.github+json' } });
    await ctx.reply((j.items || []).map((r, i) => `${i + 1}. ${bold(r.full_name)}\n⭐ ${r.stargazers_count} • ${r.language || 'n/a'}\n${r.html_url}`).join('\n\n') || 'No repositories found.', { title: 'GitVerse' });
  });
  def('iss', { cat: 'tools', heavy: true, desc: 'Show the International Space Station position.' }, async ctx => {
    const j = await getJson('https://api.open-notify.org/iss-now.json');
    await ctx.reply(`🛰️ ISS position\nLatitude: *${j.iss_position.latitude}*\nLongitude: *${j.iss_position.longitude}*\nUTC: ${new Date(Number(j.timestamp) * 1000).toISOString()}`, { title: 'ISS tracker' });
  });
  def('mathfact', { cat: 'tools', heavy: true, usage: 'mathfact [number]', desc: 'Get a mathematical fact from Numbers API.' }, async ctx => {
    const q = ctx.argv[0] || 'random'; const j = await getText(`http://numbersapi.com/${encodeURIComponent(q)}/math`); await ctx.reply(j, { title: 'Math fact' });
  });
  def('pone', { cat: 'tools', usage: 'pone <text>', desc: 'Format a short poem from your text.' }, async ctx => {
    const t = text(ctx); if (!t) throw new UserError(`Usage: ${P(ctx)}pone moonlight over Nairobi`);
    const words = t.split(/\s+/); const lines = [words.slice(0, Math.ceil(words.length / 3)).join(' '), words.slice(Math.ceil(words.length / 3), Math.ceil(words.length * 2 / 3)).join(' '), words.slice(Math.ceil(words.length * 2 / 3)).join(' ')].filter(Boolean);
    await ctx.reply(`🌙 ${lines.join('\n')}`, { title: 'Poem' });
  });
  def('railway', { cat: 'tools', heavy: true, usage: 'railway <url>', desc: 'Check a Railway-hosted/public service URL.' }, async ctx => runExisting(ctx, 'checkurl', ctx.args));
  def('recipe', { cat: 'search', heavy: true, usage: 'recipe <meal>', desc: 'Find a recipe from TheMealDB.' }, async ctx => {
    const q = text(ctx); if (!q) throw new UserError(`Usage: ${P(ctx)}recipe chicken`); const j = await getJson(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(q)}`); const m = j.meals?.[0]; if (!m) throw new UserError('Recipe not found.');
    const ingredients = Array.from({length:20}, (_,i) => [m[`strIngredient${i+1}`],m[`strMeasure${i+1}`]]).filter(x=>x[0]).map(x=>`• ${x[1] || ''} ${x[0]}`);
    await ctx.reply(`🍽️ ${bold(m.strMeal)}\n🏷️ ${m.strCategory || '-'} • ${m.strArea || '-'}\n\nIngredients:\n${ingredients.join('\n')}\n\n${String(m.strInstructions || '').slice(0,2600)}${m.strSource ? `\n\nSource: ${m.strSource}` : ''}`, { title: 'Recipe' });
  });
  def('recipe-ingredient', { cat: 'search', heavy: true, usage: 'recipe-ingredient <ingredient>', desc: 'Find meals by ingredient.' }, async ctx => {
    const q = text(ctx); if (!q) throw new UserError(`Usage: ${P(ctx)}recipe-ingredient chicken`); const j = await getJson(`https://www.themealdb.com/api/json/v1/1/filter.php?i=${encodeURIComponent(q)}`); const a = (j.meals || []).slice(0,10); if (!a.length) throw new UserError('No recipes found.'); await ctx.reply(a.map((m,i)=>`${i+1}. ${m.strMeal}\nhttps://www.themealdb.com/meal/${m.idMeal}`).join('\n\n'), { title: 'Ingredient recipes' });
  });
  def('redirectcheck', { cat: 'tools', heavy: true, usage: 'redirectcheck <url>', desc: 'Trace HTTP redirects.' }, async ctx => runExisting(ctx, 'expandurl', ctx.args));
  def('robots', { cat: 'tools', heavy: true, usage: 'robots <url>', desc: 'Read a website robots.txt file.' }, async ctx => { const u = new URL(url(ctx)); const r = await getText(`${u.origin}/robots.txt`); await ctx.reply(r.slice(0,3500), { title: 'robots.txt' }); });
  def('rot13', { cat: 'tools', usage: 'rot13 <text>', desc: 'Encode/decode ROT13 text.' }, async ctx => { const t = text(ctx); if (!t) throw new UserError(`Usage: ${P(ctx)}rot13 hello`); const out = t.replace(/[A-Za-z]/g, c => String.fromCharCode((c.charCodeAt(0) - (c <= 'Z' ? 65 : 97) + 13) % 26 + (c <= 'Z' ? 65 : 97))); await ctx.reply(out, { title: 'ROT13' }); });
  def('securityheaders', { cat: 'tools', heavy: true, usage: 'securityheaders <url>', desc: 'Inspect common HTTP security headers.' }, async ctx => { const r=await http(url(ctx),{as:'response',timeout:12000}); const ks=['content-security-policy','strict-transport-security','x-content-type-options','x-frame-options','referrer-policy','permissions-policy']; await ctx.reply(ks.map(k=>`${k}: ${r.headers.get(k)||'missing'}`).join('\n'),{title:'Security headers'}); });
  def('sitekey', { cat: 'tools', heavy: true, usage: 'sitekey <url>', desc: 'Inspect public HTML for common site and verification keys.' }, async ctx => { const h=await getText(url(ctx),{timeout:12000}); const keys=[...h.matchAll(/(?:sitekey|site-key|data-sitekey|recaptcha|turnstile)[^>]{0,120}/ig)].map(m=>m[0]).slice(0,12); await ctx.reply(keys.length?keys.join('\n\n'):'No common public site-key markers found.',{title:'Site key scan'}); });
  def('sitemap', { cat: 'tools', heavy: true, usage: 'sitemap <url>', desc: 'Read sitemap.xml or a sitemap index.' }, async ctx => { const u=new URL(url(ctx)); const r=await getText(`${u.origin}/sitemap.xml`); const locs=[...r.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m=>m[1]).slice(0,30); await ctx.reply(locs.length?locs.join('\n'):'Sitemap was reachable but contained no readable <loc> entries.',{title:'Sitemap'}); });
  def('squirrel', { cat: 'search', heavy: true, usage: 'squirrel <topic>', desc: 'Look up a topic using Wikipedia and return a concise summary.' }, async ctx => runExisting(ctx, 'jean', ctx.args || 'squirrel'));
  def('subdomain', { cat: 'tools', heavy: true, usage: 'subdomain <domain>', desc: 'Discover common public subdomains through Certificate Transparency.' }, async ctx => { const d=(ctx.argv[0]||'').replace(/^https?:\/\//,'').split('/')[0]; if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) throw new UserError(`Usage: ${P(ctx)}subdomain example.com`); const j=await getJson(`https://crt.sh/?q=%25.${encodeURIComponent(d)}&output=json`); const names=[...new Set((j||[]).flatMap(x=>String(x.name_value||'').split(/\n/)).map(x=>x.replace(/^\*\./,'').trim()).filter(x=>x.endsWith(d)))].slice(0,50); await ctx.reply(names.length?names.join('\n'):'No certificate names found.',{title:'Subdomains'}); });
  def('tempgmail', { cat: 'tools', heavy: true, usage: 'tempgmail', desc: 'Create a temporary mailbox using the public 1secmail service; this is not a real Gmail account.' }, async ctx => { const u=`https://www.1secmail.com/api/v1/?action=genRandomMailbox&count=1`; const a=await getJson(u); const email=a?.[0]; if(!email) throw new Error('Temporary mailbox service returned no address.'); ctx.set('tempMail',{email,createdAt:Date.now()}); await ctx.reply(`📧 Temporary mailbox: *${email}*\nUse ${P(ctx)}tempmail2 to check new messages.\nExpires according to the provider.`,{title:'Temp mailbox'}); });
  def('tempmail2', { cat: 'tools', heavy: true, usage: 'tempmail2', desc: 'Check the saved 1secmail temporary mailbox.' }, async ctx => { const e=ctx.get('tempMail',null)?.email; if(!e) throw new UserError(`Create one first with ${P(ctx)}tempgmail`); const [login,domain]=e.split('@'); const j=await getJson(`https://www.1secmail.com/api/v1/?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`); await ctx.reply(j?.length?j.map(m=>`📩 #${m.id} ${m.from}\n${m.subject}\n${m.date}`).join('\n\n'):'📭 No messages yet.',{title:e}); });
  def('tempnumber', { cat: 'tools', usage: 'tempnumber', desc: 'Show configured temporary-number provider status without fabricating a phone number.' }, async ctx => { const provider=process.env.TEMP_NUMBER_API_URL; await ctx.reply(provider?`📱 Temporary-number provider configured: ${provider}`:'📱 No temporary-number API is configured. Set TEMP_NUMBER_API_URL and TEMP_NUMBER_API_KEY to enable live numbers.',{title:'Temp number'}); });
  def('tos', { cat: 'tools', heavy: true, usage: 'tos <url>', desc: 'Extract the beginning of a public Terms/ToS page.' }, async ctx => { const h=await getText(url(ctx)); const s=h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); await ctx.reply(s.slice(0,3000)||'No readable terms text found.',{title:'Terms of Service'}); });
  def('urlshort', { cat: 'tools', heavy: true, usage: 'urlshort <url>', desc: 'Shorten a URL using is.gd.' }, async ctx => { const u=url(ctx); const out=await getText(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(u)}`); await ctx.reply(out.trim(),{title:'Short URL'}); });
  def('userdrive', { cat: 'download', usage: 'userdrive', desc: 'Show the bot-managed user drive storage keys available to your session.' }, async ctx => { const keys=ctx.keys(''); await ctx.reply(keys.length?keys.slice(0,80).join('\n'):'No stored user-drive keys found.',{title:'User drive'}); });
  def('vocalremove', { cat: 'audio', heavy: true, usage: 'vocalremove (reply to audio)', desc: 'Remove vocals from replied audio when an external UVR API is configured.' }, async ctx => { const api=process.env.VOCAL_REMOVE_API_URL; if(!api) throw new UserError('Set VOCAL_REMOVE_API_URL to a vocal-separation service before using this command.'); const m=await ctx.needMedia('audio'); const r=await fetch(api,{method:'POST',headers:{'content-type':'audio/mpeg','authorization':process.env.VOCAL_REMOVE_API_KEY?`Bearer ${process.env.VOCAL_REMOVE_API_KEY}`:undefined},body:m.buffer,signal:AbortSignal.timeout(120000)}); if(!r.ok) throw new Error(`Vocal removal API returned HTTP ${r.status}`); const b=Buffer.from(await r.arrayBuffer()); await ctx.audio(b,false,'audio/mpeg'); });
  def('wareact', { cat: 'whatsapp', usage: 'wareact <emoji> (reply to message)', desc: 'React to a WhatsApp message with an emoji.' }, async ctx => runExisting(ctx,'react',ctx.args));
  def('webextract', { cat: 'tools', heavy: true, usage: 'webextract <url>', desc: 'Extract readable text from a public web page.' }, async ctx => runExisting(ctx,'fetch',ctx.args));
  def('webzip', { cat: 'tools', heavy: true, usage: 'webzip <url>', desc: 'Download a public URL and package it into a real ZIP archive.' }, async ctx => { const u=url(ctx); const r=await fetch(u,{signal:AbortSignal.timeout(60000)}); if(!r.ok) throw new Error(`HTTP ${r.status}`); const data=Buffer.from(await r.arrayBuffer()); const name=(new URL(u).pathname.split('/').pop()||'download.bin').replace(/[^\w.-]/g,'_'); const { makeZip }=require('./x-files').helpers; const archive=makeZip([{name,data}]); await ctx.doc(archive,`${name}.zip`,'application/zip',{caption:`📦 ${name} packaged as ZIP`}); });
  def('welcomecard', { cat: 'group', group: true, admin: true, usage: 'welcomecard', desc: 'Generate and send the current group welcome-card configuration.' }, async ctx => { const m=await ctx.group(); await ctx.reply(`👋 Welcome card for *${m.subject || 'this group'}*\n\nEnable/edit greetings with ${P(ctx)}setgreet and ${P(ctx)}getgreet.`,{title:'Welcome card'}); });
  def('xor', { cat: 'tools', usage: 'xor <key> <text>', desc: 'XOR text with a numeric or character key and return hex.' }, async ctx => { const k=ctx.argv[0]; const body=ctx.args.replace(/^\S+\s*/,''); if(!k||!body) throw new UserError(`Usage: ${P(ctx)}xor key text`); const key=Buffer.from(k); const b=Buffer.from(body); const out=Buffer.from(b.map((v,i)=>v^key[i%key.length])).toString('hex'); await ctx.reply(out,{title:'XOR'}); });

  // Exact requested owner command that was absent.
  def('antidelstatus', { cat: 'whatsapp', owner: true, usage: 'antidelstatus on|off', desc: 'Notify the owner when a status message is revoked, using cached status text when available.' }, async ctx => { const a=(ctx.argv[0]||'').toLowerCase(); if(!['on','off'].includes(a)) return ctx.reply(`Anti-delete status is *${ctx.get('antidelstatus',false)?'ON':'OFF'}*. Use ${P(ctx)}antidelstatus on|off.`); ctx.set('antidelstatus',a==='on'); await ctx.reply(`🗑️ Anti-delete status: *${a.toUpperCase()}*`); });

  // Missing exact names that map cleanly to already-tested commands.
  const maps = [
    ['Uptime','uptime'], ['dictionary','define'], ['owner','owner'], ['pair','pair'], ['base64','base64'], ['calc','calc'], ['country','country'], ['currency','currency'], ['deep','research'], ['dns','dns'], ['fast','google'], ['genpass','genpass'], ['github','github'], ['goodbye','goodbye'], ['hash','hash'], ['hex','hex'], ['ip','ip'], ['json','json'], ['mode','mode'], ['ocr','ocr'], ['qr','qr'], ['regex','regex'], ['reverse','reverse'], ['setprefix','setprefix'], ['shazam','shazam'], ['slow','google'], ['smooth','smooth'], ['sslcheck','sslcheck'], ['stackoverflow','google'], ['timestamp','timestamp'], ['urban','urban'], ['urldecode','urldecode'], ['urlencode','urlencode'], ['weather','weather'], ['whois','whois'], ['leave','leave'], ['unblock','unblock'], ['vv','vv'], ['vv2','vv2'], ['antidelete','antidelete'], ['antiedit','antiedit'], ['autobio','autobio'], ['anticall','call'], ['autoread','autoreadmessages'], ['autorecording','autorecording'], ['autotyping','autotyping'], ['autolikestatus','autolikestatus'], ['welcome','welcome']
  ];
  for (const [name,target] of maps) if (!registry.has(String(name).toLowerCase()) && registry.has(String(target).toLowerCase())) alias(target,name);

  // Ensure AI is explicitly available under the short .ai name even if an older alias file was removed.
  if (!registry.has('ai') && registry.has('ask')) alias('ask','ai');
};

function pids(p) { return [p?.id,p?.lid,p?.phoneNumber,p?.jid].map(x=>String(x||'').split('@')[0].split(':')[0]).filter(Boolean); }
