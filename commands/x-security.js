'use strict';
/**
 * Security tools.
 *  Group guards (same on|off|warn|kick pattern as .antilink): antilinkgc/antiinvite, antiabuse, antiforward, antiimage
 *  Group protection events (on|off): antidemote, antipromote, antikick, antiout, antiraid
 *  Trust list: trust / untrust / trusted (trusted people are never touched by the guards above)
 *  Checkers: spamcheck, scamcheck, linkcheck, filecheck, hashcheck, sslcheck, domaincheck, headers
 *  Account: blocklist, unblockall
 */
const crypto = require('crypto');
const tls = require('tls');
const dns = require('dns').promises;
const U = require('../lib/util');
const { UserError, bold, escRe } = U;
const { assertPublicUrl, safeFetch } = require('../lib/safeurl');

const MODES = { on: 'on', delete: 'on', warn: 'warn', kick: 'kick', off: 'off' };
const INVITE_RE = /chat\.whatsapp\.com\/[A-Za-z0-9]{8,}|whatsapp\.com\/channel\/[A-Za-z0-9]{8,}/i;
const ABUSE = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dickhead', 'pussy', 'cunt', 'motherfucker', 'whore', 'slut', 'malaya', 'mjinga', 'kuma', 'mbwa wewe', 'nyinyi wajinga'];
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 'wa.link']);
const RISKY_TLDS = new Set(['zip', 'mov', 'xyz', 'top', 'tk', 'ml', 'ga', 'cf', 'gq', 'click', 'work', 'loan', 'win', 'bid', 'icu', 'monster', 'rest', 'country', 'stream']);
const SCAM_WORDS = [
  [/\b(you (have )?won|congratulations|winner|prize|lottery|jackpot)\b/i, 'claims you won something'],
  [/\b(claim (your|now)|click (the )?link|click here|tap (the )?link)\b/i, 'pushes you to click a link'],
  [/\b(urgent|immediately|within \d+ ?(hours?|minutes?)|expires? (today|soon)|last chance|act now)\b/i, 'creates urgency'],
  [/\b(otp|one[- ]?time (pin|password|code)|verification code|your pin|cvv|password)\b/i, 'asks for a code or password'],
  [/\b(send (me )?(money|cash)|wrongly (sent|received)|reverse (the )?(transaction|payment|mpesa)|sent (to )?(you )?by mistake)\b/i, 'fake "sent by mistake / reversal" story'],
  [/\b(double (your )?money|guaranteed (profit|returns?)|investment (opportunity|plan)|forex (signals|trading)|crypto giveaway|binary options)\b/i, 'promises unrealistic returns'],
  [/\b(account (suspended|blocked|locked|verification)|verify your (account|identity)|bank (alert|notice))\b/i, 'fake account-security alert'],
  [/\b(job (offer|opportunity)|work from home|earn \$?\d+ ?(daily|per day|weekly)|registration fee|pay (a )?(fee|deposit))\b/i, 'job offer asking for a fee'],
  [/\b(mpesa|m-pesa|safaricom|airtel money|equity|kcb)\b.*\b(pin|code|link|suspend|reverse|bonus)\b/i, 'mobile-money lure'],
  [/\b(free (data|airtime|bundles?|gift)|giveaway)\b/i, 'free-gift bait']
];
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

/** the contextInfo of whatever kind of message this is */
const ctxInfo = content => { const v = content && Object.values(content).find(x => x && typeof x === 'object' && x.contextInfo); return v?.contextInfo || null; };

module.exports = ({ def: rawDef, alias: rawAlias, registry, hooks, events }) => {
  const def = (names, opts, run) => { const n = [].concat(names).filter(x => !registry.has(x.toLowerCase())); if (n.length) rawDef(n, opts, run); };
  const alias = (existing, ...names) => { if (!registry.has(existing)) return; const f = names.filter(x => !registry.has(x.toLowerCase())); if (f.length) rawAlias(existing, ...f); };
  const P = ctx => ctx.var('PREFIX');
  const input = (ctx, usage) => { const t = ctx.input().trim(); if (!t) throw new UserError(`Usage: *${P(ctx)}${usage}*`); return t; };
  const trusted = ctx => ctx.get('trusted', {});

  /* ---------------------------------- trust list ---------------------------------- */
  const numbersFrom = ctx => [...new Set([...(ctx.targets?.(true) || []).map(j => ctx.jidUser(j)), ...ctx.argv.map(a => a.replace(/\D/g, '')).filter(n => n.length >= 7)])];
  def('trust', { cat: 'group', owner: true, usage: 'trust @user | number | reply', desc: 'Trust someone: the extra group guards (antilinkgc, antiabuse, antiforward, antiimage) never touch their messages.' }, async ctx => {
    const n = numbersFrom(ctx); if (!n.length) throw new UserError('Mention, reply to, or type the number of the person to trust.');
    ctx.update('trusted', {}, t => { for (const x of n) t[x] = Date.now(); });
    await ctx.reply(`🤝 Trusted: ${n.map(x => '+' + x).join(', ')}`, { title: 'Trust list' });
  });
  def('untrust', { cat: 'group', owner: true, usage: 'untrust @user | number | reply', desc: 'Remove someone from the trust list.' }, async ctx => {
    const n = numbersFrom(ctx); if (!n.length) throw new UserError('Mention, reply to, or type the number of the person.');
    ctx.update('trusted', {}, t => { for (const x of n) delete t[x]; });
    await ctx.reply(`✅ Removed from trust list: ${n.map(x => '+' + x).join(', ')}`, { title: 'Trust list' });
  });
  def('trusted', { cat: 'group', owner: true, desc: 'Show the trust list.' }, async ctx => {
    const t = Object.keys(trusted(ctx)); await ctx.reply(t.length ? t.map(x => `🤝 +${x}`).join('\n') : 'Nobody is on the trust list yet.', { title: 'Trust list' });
  });

  /* ------------------------------------- guards ------------------------------------- */
  const GUARDS = {};
  function guard(name, desc, detect, defaults = {}) {
    GUARDS[name] = detect;
    def(name, { cat: 'group', group: true, admin: true, usage: `${name} on|off|warn|kick`, desc }, async ctx => {
      const key = `${name}:${ctx.chat}`; const cfg = { mode: 'off', ...defaults, ...ctx.get(key, {}) }; const a = (ctx.argv[0] || '').toLowerCase();
      if (!a) return ctx.reply(`🛡️ ${bold(name)} is *${cfg.mode.toUpperCase()}*\n\nUse: ${name} on | warn | kick | off`);
      if (!MODES[a]) throw new UserError(`Use: ${name} on | warn | kick | off`);
      cfg.mode = MODES[a]; ctx.set(key, cfg);
      await ctx.reply(`🛡️ ${bold(name)} is now *${cfg.mode.toUpperCase()}*${cfg.mode !== 'off' && !(await ctx.botAdmin()) ? '\n⚠️ I must be a group admin to enforce this.' : ''}${cfg.mode !== 'off' ? `\nℹ️ Admins, the owner and trusted people are never touched, so test with a normal member\'s account. Check everything with *${P(ctx)}groupcheck*.` : ''}`);
    });
  }
  guard('antilinkgc', 'Delete WhatsApp group/channel invite links posted by non-admins.', ctx => (INVITE_RE.test(ctx.text || '') ? 'group invite link' : null));
  guard('antiinvite', 'Same as antilinkgc: delete WhatsApp invite links posted by non-admins.', ctx => (INVITE_RE.test(ctx.text || '') ? 'group invite link' : null));
  guard('antiabuse', 'Delete abusive language from non-admins (built-in word list).', ctx => { const low = (ctx.text || '').toLowerCase(); return ABUSE.some(w => new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(w)}($|[^\\p{L}\\p{N}])`, 'iu').test(low)) ? 'abusive language' : null; });
  guard('antiforward', 'Delete forwarded messages posted by non-admins.', ctx => (ctxInfo(ctx.content)?.isForwarded ? 'forwarded message' : null));
  guard('antiimage', 'Delete photos posted by non-admins.', ctx => (ctx.content?.imageMessage ? 'photo' : null));

  hooks.push({
    name: 'x-guards', priority: -9, run: async ctx => {
      if (!ctx.isGroup || ctx.fromMe || !ctx.fresh || ctx.chat === 'status@broadcast') return false;
      let hit = null, mode = null;
      for (const [name, detect] of Object.entries(GUARDS)) {
        const cfg = ctx.get(`${name}:${ctx.chat}`, null); if (!cfg || !cfg.mode || cfg.mode === 'off') continue;
        const why = detect(ctx); if (why) { hit = why; mode = cfg.mode; break; }
      }
      if (!hit) return false;
      if (ctx.isOwner || trusted(ctx)[ctx.senderNum] || await ctx.admin()) return false;
      if (!(await ctx.botAdmin())) {
        if (ctx.cooldown(600, 'guard-noadmin:' + ctx.chat)) await ctx.send({ text: ctx.frame(`⚠️ I spotted a ${hit} from @${ctx.jidUser(ctx.key.participant)}, but I am not a group admin so I cannot remove it. Please make me an admin for the protections to work.`), mentions: [ctx.key.participant] }).catch(() => {});
        return false;
      }
      const user = ctx.key.participant;
      await ctx.sock.sendMessage(ctx.chat, { delete: ctx.key }).catch(() => {});
      if (mode === 'kick') { await ctx.sock.groupParticipantsUpdate(ctx.chat, [user], 'remove').catch(() => {}); await ctx.send({ text: ctx.frame(`🚫 @${ctx.jidUser(user)} was removed for ${hit}.`), mentions: [user] }); }
      else if (mode === 'warn') {
        const limit = Number(ctx.var('WARN_LIMIT')) || 3; let n = 0;
        ctx.update('warns:' + ctx.chat, {}, w => { const k = ctx.jidUser(user); w[k] = (w[k] || 0) + 1; n = w[k]; });
        if (n >= limit) { await ctx.sock.groupParticipantsUpdate(ctx.chat, [user], 'remove').catch(() => {}); await ctx.send({ text: ctx.frame(`🚫 @${ctx.jidUser(user)} reached ${limit}/${limit} warnings (${hit}) and was removed.`), mentions: [user] }); }
        else await ctx.send({ text: ctx.frame(`⚠️ @${ctx.jidUser(user)} — ${hit} is not allowed here. Warning ${n}/${limit}.`), mentions: [user] });
      } else if (ctx.cooldown(15, 'x-guard-note')) await ctx.send({ text: ctx.frame(`🛡️ @${ctx.jidUser(user)}'s message was removed (${hit}).`), mentions: [user] });
      return true;
    }
  });

  /* ------------------------------ protection events (on/off) ------------------------------ */
  const PROTECT = {
    antidemote: 'When a non-owner demotes an admin, promote them straight back.',
    antipromote: 'When a non-owner promotes someone to admin, undo it.',
    antikick: 'When a non-owner removes a member, try to add them back.',
    antiout: 'When a member leaves, try to add them back.',
    antiraid: 'If many people join within a minute, lock the group (admins only can send). Optional: antiraid on <joins, default 8>'
  };
  for (const [name, desc] of Object.entries(PROTECT)) {
    def(name, { cat: 'group', group: true, admin: true, usage: name === 'antiraid' ? 'antiraid on [joins] | off' : `${name} on|off`, desc }, async ctx => {
      const key = `${name}:${ctx.chat}`; const cfg = { mode: 'off', limit: 8, ...ctx.get(key, {}) }; const a = (ctx.argv[0] || '').toLowerCase();
      if (!a) return ctx.reply(`🛡️ ${bold(name)} is *${cfg.mode.toUpperCase()}*${name === 'antiraid' ? ` (lock after ${cfg.limit} joins/min)` : ''}\n\nUse: ${name} on | off`);
      if (!['on', 'off'].includes(a)) throw new UserError(`Use: ${name} on | off`);
      cfg.mode = a; if (name === 'antiraid' && Number(ctx.argv[1]) >= 3) cfg.limit = Math.min(100, Number(ctx.argv[1]));
      ctx.set(key, cfg);
      await ctx.reply(`🛡️ ${bold(name)} is now *${a.toUpperCase()}*${a === 'on' && !(await ctx.botAdmin()) ? '\n⚠️ I must be a group admin to enforce this.' : ''}`);
    });
  }
  events.push({
    name: 'group-participants.update', run: async (api, ev) => {
      const gid = ev.id; if (!String(gid).endsWith('@g.us')) return;
      const on = n => { const c = api.get(`${n}:${gid}`, null); return c && c.mode === 'on' ? c : null; };
      const num = j => String(j || '').split('@')[0].split(':')[0];
      const botIds = [api.sock?.user?.id, api.sock?.user?.lid].filter(Boolean).map(num);
      const author = ev.author ? num(ev.author) : null;
      const byBotOrOwner = author && (botIds.includes(author) || author === num(api.ownerJid));
      const list = (ev.participants || []).map(p => (typeof p === 'string' ? p : p.id));
      if (!list.length) return;
      const say = text => api.sendTo(gid, { text: api.frame(text), mentions: list }).catch(() => {});
      try {
        if (ev.action === 'demote' && on('antidemote') && !byBotOrOwner) { await api.sock.groupParticipantsUpdate(gid, list, 'promote'); await say(`🛡️ Anti-demote: ${list.map(j => '@' + num(j)).join(', ')} restored as admin.`); }
        if (ev.action === 'promote' && on('antipromote') && !byBotOrOwner) { await api.sock.groupParticipantsUpdate(gid, list, 'demote'); await say(`🛡️ Anti-promote: removed admin from ${list.map(j => '@' + num(j)).join(', ')}.`); }
        if (ev.action === 'remove') {
          const left = author && list.length === 1 && num(list[0]) === author;
          if (left && on('antiout')) { const r = await api.sock.groupParticipantsUpdate(gid, list, 'add').catch(() => []); if (r?.some?.(x => String(x.status) === '200')) await say(`🛡️ Anti-out: @${num(list[0])} was added back.`); }
          else if (!left && on('antikick') && !byBotOrOwner) { const r = await api.sock.groupParticipantsUpdate(gid, list, 'add').catch(() => []); if (r?.some?.(x => String(x.status) === '200')) await say(`🛡️ Anti-kick: ${list.map(j => '@' + num(j)).join(', ')} added back.`); }
        }
        if (ev.action === 'add') {
          const c = on('antiraid');
          if (c && !byBotOrOwner) {
            api.rt.raid = api.rt.raid || new Map(); const arr = (api.rt.raid.get(gid) || []).filter(t => Date.now() - t < 60000); for (let i = 0; i < list.length; i++) arr.push(Date.now()); api.rt.raid.set(gid, arr);
            if (arr.length >= (c.limit || 8)) { api.rt.raid.delete(gid); await api.sock.groupSettingUpdate(gid, 'announcement'); await api.sendTo(gid, { text: api.frame(`🚨 *Anti-raid:* ${arr.length} people joined within a minute, so the group is locked (admins only). An admin can reopen it with *${api.var('PREFIX')}unmute*.`) }).catch(() => {}); }
          }
        }
      } catch (e) { if (/forbidden|not-authorized|403|admin/i.test(String(e?.message || e))) await api.sendTo(gid, { text: api.frame('⚠️ A group protection tried to act, but WhatsApp refused. I need to be a group admin for it to work.') }).catch(() => {}); }
    }
  });

  /* ------------------------------------- checkers ------------------------------------- */
  const urlsIn = t => [...String(t).matchAll(URL_RE)].map(m => m[1].replace(/[.,;:!?)\]]+$/, ''));
  function linkRisk(raw) {
    const flags = []; let u; try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { return { flags: ['not a valid link'], score: 0, host: raw }; }
    const host = u.hostname.toLowerCase(); const parts = host.split('.'); const tld = parts[parts.length - 1];
    if (u.protocol !== 'https:') flags.push('not using HTTPS');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) flags.push('uses a raw IP address');
    if (host.includes('xn--')) flags.push('uses look-alike (punycode) characters');
    if (SHORTENERS.has(host)) flags.push('is a link shortener (hides the real destination)');
    if (RISKY_TLDS.has(tld)) flags.push(`uses the .${tld} ending, common in throw-away or scam sites`);
    if (parts.length > 4) flags.push('has many sub-domains');
    if (u.username || u.href.includes('@')) flags.push('contains "@" which can hide the real site');
    if (/(login|verify|secure|account|update|wallet|bonus|claim|mpesa|safaricom|paypal|bank)/i.test(host) && !/^(www\.)?(paypal\.com|safaricom\.co\.ke|mpesa\.co\.ke)$/.test(host)) flags.push('has a bait word in the domain name');
    if (u.href.length > 150) flags.push('is unusually long');
    if (/\.(apk|exe|scr|bat|msi|jar|vbs)(\?|$)/i.test(u.pathname)) flags.push('points to a program file');
    return { flags, score: Math.min(100, flags.length * 22), host };
  }
  const verdict = s => (s >= 60 ? '🔴 High risk' : s >= 30 ? '🟠 Suspicious' : s > 0 ? '🟡 Some warning signs' : '🟢 No obvious red flags');
  def('linkcheck', { cat: 'tools', heavy: true, usage: 'linkcheck <link>', desc: 'Look for warning signs in a link and see where it really leads (no guarantee of safety).' }, async ctx => {
    const raw = urlsIn(input(ctx, 'linkcheck https://example.com')).concat(ctx.input().trim().split(/\s+/)[0])[0];
    const r = linkRisk(raw); let dest = '';
    try { const f = await safeFetch(raw, { method: 'HEAD', timeout: 8000 }); const same = new URL(f.url).hostname !== r.host; dest = `\n➡️ Ends at: ${f.url.slice(0, 120)}${f.hops.length ? ` (${f.hops.length} redirect${f.hops.length > 1 ? 's' : ''})` : ''}${same ? '\n⚠️ It lands on a different site than the one shown.' : ''}\n📡 HTTP ${f.status}`; if (same) r.score = Math.min(100, r.score + 15); } catch (e) { dest = `\n📡 Could not open it: ${String(e.message).slice(0, 80)}`; }
    await ctx.reply(`${verdict(r.score)}\n🌐 ${r.host}${r.flags.length ? '\n' + r.flags.map(f => `• ${f}`).join('\n') : ''}${dest}\n\n_This is a quick heuristic check, not a virus scan. When in doubt, do not open it._`, { title: 'Link check' });
  });
  def('scamcheck', { cat: 'tools', usage: 'scamcheck <message text> (or reply to a message)', desc: 'Check a message for common scam patterns (fake prizes, M-Pesa reversal tricks, OTP requests…).' }, async ctx => {
    const t = input(ctx, 'scamcheck <text>'); const hits = SCAM_WORDS.filter(([re]) => re.test(t)).map(x => x[1]);
    const links = urlsIn(t).map(linkRisk); const linkScore = links.reduce((m, l) => Math.max(m, l.score), 0);
    const score = Math.min(100, hits.length * 22 + linkScore * 0.6);
    await ctx.reply(`${verdict(score)} (${Math.round(score)}/100)\n${hits.length ? hits.map(h => `• ${h}`).join('\n') : '• no classic scam phrases found'}${links.length ? '\n' + links.map(l => `🔗 ${l.host}${l.flags.length ? ' — ' + l.flags[0] : ''}`).join('\n') : ''}\n\n🛟 Never share your PIN, OTP or password. Real companies do not ask for them. Verify through the official number or app, not through the message.`, { title: 'Scam check' });
  });
  def('spamcheck', { cat: 'tools', usage: 'spamcheck <text> (or reply to a message)', desc: 'Score how spammy a message looks.' }, async ctx => {
    const t = input(ctx, 'spamcheck <text>'); const letters = t.replace(/[^A-Za-z]/g, ''); const caps = letters.length > 12 ? letters.replace(/[^A-Z]/g, '').length / letters.length : 0;
    const f = []; if (urlsIn(t).length >= 2) f.push('several links'); if (caps > 0.6) f.push('mostly CAPITAL LETTERS'); if (/(.)\1{4,}/.test(t)) f.push('repeated characters'); if ((t.match(/[!?]{2,}/g) || []).length) f.push('lots of !!! or ???');
    if (/\b(buy now|limited offer|discount|promo|sale|cheap|win|free|cash|loan|click|subscribe|follow me|dm me|inbox me)\b/i.test(t)) f.push('sales / promo words'); if ((t.match(/\+?\d[\d\s-]{8,}/g) || []).length) f.push('contains phone numbers'); if (t.length > 700) f.push('very long');
    if ((t.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length > 8) f.push('emoji overload');
    const score = Math.min(100, f.length * 20); await ctx.reply(`${score >= 60 ? '🔴 Very spammy' : score >= 40 ? '🟠 Spammy' : score > 0 ? '🟡 Slightly spammy' : '🟢 Looks normal'} (${score}/100)\n${f.length ? f.map(x => `• ${x}`).join('\n') : '• nothing suspicious'}`, { title: 'Spam check' });
  });
  const virusLinks = h => `🔎 VirusTotal: https://www.virustotal.com/gui/file/${h}`;
  const analyse = async ctx => {
    const m = await ctx.media().catch(() => null); if (!m) throw new UserError('Reply to a file, photo, video or audio with this command.');
    const b = m.buffer; const sha = crypto.createHash('sha256').update(b).digest('hex'); const md5 = crypto.createHash('md5').update(b).digest('hex');
    const head = b.subarray(0, 16); const sig = (b.subarray(0, 4).toString('hex'));
    const MAG = { '504b0304': 'ZIP / Office / APK / JAR', '25504446': 'PDF', '89504e47': 'PNG', ffd8ffe0: 'JPEG', ffd8ffe1: 'JPEG', ffd8ffdb: 'JPEG', '47494638': 'GIF', '4d5a9000': 'Windows program (EXE/DLL)', '4d5a5000': 'Windows program', '7f454c46': 'Linux program (ELF)', '52617221': 'RAR archive', '1f8b0808': 'GZIP', '1f8b0800': 'GZIP', '52494646': 'RIFF (WAV/WEBP/AVI)', '494433': 'MP3 (ID3)' };
    const kind = MAG[sig] || MAG[sig.slice(0, 6)] || 'unrecognised';
    return { m, sha, md5, kind, size: b.length, name: m.fileName || '(unnamed)', head };
  };
  def(['filecheck', 'virustotal'], { cat: 'tools', heavy: true, desc: 'Inspect a replied file: real type vs name, size, hashes, red flags, and a VirusTotal link.' }, async ctx => {
    const a = await analyse(ctx); const flags = []; const ext = (a.name.split('.').pop() || '').toLowerCase();
    if (/^(exe|scr|bat|cmd|msi|jar|vbs|js|apk|ps1|lnk)$/.test(ext)) flags.push(`.${ext} files can run code`);
    if (/Windows program|Linux program/.test(a.kind) && !/^(exe|dll)$/.test(ext)) flags.push('it is a program disguised under another file name');
    if ((a.name.match(/\./g) || []).length > 1 && /\.(pdf|jpg|png|docx?|xlsx?|mp4|mp3)\.(exe|scr|bat|apk|js)$/i.test(a.name)) flags.push('double extension trick');
    await ctx.reply(`📄 ${a.name}\n🔬 Real type: *${a.kind}* • mime ${a.m.mime || '?'}\n💾 ${U.fmtBytes(a.size)}\n#️⃣ SHA-256: \`${a.sha}\`\n${flags.length ? '⚠️ ' + flags.join('\n⚠️ ') : '✅ No obvious file-type tricks.'}\n\n${virusLinks(a.sha)}\n_A real malware scan needs an antivirus; this checks the basics._`, { title: 'File check' });
  });
  def('hashcheck', { cat: 'tools', heavy: true, desc: 'MD5 / SHA-1 / SHA-256 of a replied file (to compare with a published checksum).' }, async ctx => {
    const a = await analyse(ctx); const b = a.m.buffer;
    await ctx.reply(`MD5: \`${a.md5}\`\nSHA-1: \`${crypto.createHash('sha1').update(b).digest('hex')}\`\nSHA-256: \`${a.sha}\`\n💾 ${U.fmtBytes(a.size)}\n\n${virusLinks(a.sha)}`, { title: 'Hashes' });
  });

  /* ------------------------------ network inspection (read-only) ------------------------------ */
  const cleanHost = s => { const h = String(s).trim().replace(/^https?:\/\//i, '').replace(/[/:?#].*$/, '').toLowerCase(); if (!/^[a-z0-9.-]{3,253}$/.test(h) || !h.includes('.')) throw new UserError('Give a domain name like example.com'); return h; };
  def('sslcheck', { cat: 'tools', heavy: true, usage: 'sslcheck <domain>', desc: 'Show a website\'s HTTPS certificate: issuer, expiry and name match.' }, async ctx => {
    const host = cleanHost(input(ctx, 'sslcheck example.com')); await assertPublicUrl(host);
    const cert = await new Promise((res, rej) => { const s = tls.connect({ host, port: 443, servername: host, timeout: 8000, rejectUnauthorized: false }, () => { const c = s.getPeerCertificate(); const ok = s.authorized; const err = s.authorizationError; s.end(); res({ c, ok, err }); }); s.on('error', rej); s.on('timeout', () => { s.destroy(); rej(new Error('timed out')); }); }).catch(e => { throw new UserError(`Could not connect to ${host}:443 (${String(e.message).slice(0, 60)}).`); });
    const c = cert.c; if (!c?.valid_to) throw new UserError('No certificate was presented.');
    const days = Math.round((new Date(c.valid_to) - Date.now()) / 864e5);
    await ctx.reply(`${cert.ok && days > 0 ? '🟢' : '🔴'} *${host}*\n🔐 Trusted by system roots: *${cert.ok ? 'yes' : 'NO' + (cert.err ? ' (' + cert.err + ')' : '')}*\n📛 Subject: ${c.subject?.CN || '?'}\n🏢 Issuer: ${c.issuer?.O || c.issuer?.CN || '?'}\n📅 Valid: ${new Date(c.valid_from).toISOString().slice(0, 10)} → ${new Date(c.valid_to).toISOString().slice(0, 10)} (${days >= 0 ? days + ' days left' : 'EXPIRED ' + -days + ' days ago'})\n🔖 Alt names: ${String(c.subjectaltname || '').replace(/DNS:/g, '').split(', ').slice(0, 5).join(', ') || '—'}`, { title: 'SSL check' });
  });
  def('domaincheck', { cat: 'tools', heavy: true, usage: 'domaincheck <domain>', desc: 'Domain registration age, name servers and mail records (RDAP + DNS).' }, async ctx => {
    const host = cleanHost(input(ctx, 'domaincheck example.com')); const base = host.split('.').slice(-2).join('.');
    const [rdap, ns, mx] = await Promise.all([U.getJson(`https://rdap.org/domain/${base}`, { timeout: 12000 }).catch(() => null), dns.resolveNs(base).catch(() => []), dns.resolveMx(base).catch(() => [])]);
    const ev = a => rdap?.events?.find(e => e.eventAction === a)?.eventDate?.slice(0, 10);
    const created = ev('registration'); const age = created ? Math.floor((Date.now() - new Date(created)) / 864e5) : null;
    await ctx.reply(`🌐 *${base}*\n📅 Registered: ${created || 'unknown'}${age != null ? ` (${age < 90 ? '⚠️ only ' : ''}${age} days old)` : ''}\n⏳ Expires: ${ev('expiration') || 'unknown'}\n🏢 Registrar: ${rdap?.entities?.find(e => e.roles?.includes('registrar'))?.vcardArray?.[1]?.find(x => x[0] === 'fn')?.[3] || 'unknown'}\n🧭 Name servers: ${ns.slice(0, 4).join(', ') || '—'}\n✉️ Mail: ${mx.slice(0, 3).map(m => m.exchange).join(', ') || 'none'}\n\n_Very new domains asking for money or logins deserve extra suspicion._`, { title: 'Domain check' });
  });
  def('headers', { cat: 'tools', heavy: true, usage: 'headers <url>', desc: 'HTTP response headers of a website (and its security headers).' }, async ctx => {
    const raw = input(ctx, 'headers example.com'); const f = await safeFetch(raw, { method: 'HEAD', timeout: 9000 });
    const h = Object.fromEntries(f.headers.entries()); const sec = ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy'];
    await ctx.reply(`📡 HTTP ${f.status} • ${f.ms} ms${f.hops.length ? ` • ${f.hops.length} redirect(s)` : ''}\n🔗 ${f.url.slice(0, 100)}\n🖥️ Server: ${h.server || '—'}\n📦 Type: ${h['content-type'] || '—'}\n\n🛡️ *Security headers*\n${sec.map(k => `${h[k] ? '✅' : '❌'} ${k}`).join('\n')}`, { title: 'Headers' });
  });
  alias('ipinfo', 'iplookup'); alias('dns', 'dnslookup'); alias('linkcheck', 'urlscan'); alias('modlog', 'securitylog', 'auditlog', 'audit');
  alias('antispam', 'antibulk'); alias('antigm', 'antimention'); alias('antidelete', 'antirevoke', 'antirevokechat', 'antideletechat'); alias('call', 'anticall'); alias('report', 'reportuser', 'reportgroup', 'reportspam', 'reportlink');

  /* ------------------------------------ blocklist ------------------------------------ */
  def('blocklist', { cat: 'user', owner: true, desc: 'List the numbers this account has blocked.' }, async ctx => {
    const l = await ctx.sock.fetchBlocklist().catch(() => null); if (!l) throw new UserError('Could not read the block list right now.');
    await ctx.reply(l.length ? `🚫 ${l.length} blocked:\n${l.slice(0, 60).map(j => '+' + ctx.jidUser(j)).join('\n')}${l.length > 60 ? `\n… and ${l.length - 60} more` : ''}` : 'Nobody is blocked.', { title: 'Block list' });
  });
  def('unblockall', { cat: 'user', owner: true, usage: 'unblockall confirm', desc: 'Unblock every blocked number (type "unblockall confirm").' }, async ctx => {
    const l = await ctx.sock.fetchBlocklist().catch(() => []); if (!l.length) return ctx.reply('Nobody is blocked.');
    if ((ctx.argv[0] || '').toLowerCase() !== 'confirm') return ctx.reply(`⚠️ This will unblock ${l.length} number(s). Send *${P(ctx)}unblockall confirm* to continue.`);
    let n = 0; for (const j of l) { try { await ctx.sock.updateBlockStatus(j, 'unblock'); n++; } catch {} await U.sleep(400); }
    await ctx.reply(`✅ Unblocked ${n} of ${l.length}.`);
  });
};

module.exports.helpers = { SCAM_WORDS, ABUSE, ctxInfo };
