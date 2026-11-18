'use strict';
/**
 * Statistics and system information.
 *  Usage counters: totalmessages, totalcommands, commandstats, activity, users, totaldownloads
 *  This session: connection, botinfo, performance, cacheinfo, totalgroups
 *  Server (operator only): disk, host, processes, gc, storage, totalconnections, warninglogs
 *  WhatsApp status posting: textstatus, statusimage, statusvideo, statusaudio (to people the bot has chatted with)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../lib/util');
const { UserError, bold } = U;
const { requireHost } = require('../lib/host');

const DOWNLOADERS = new Set(['play', 'song', 'ytmp3', 'yta', 'ytv', 'video', 'tiktok', 'insta', 'fb', 'twitter', 'pinterest', 'reddit', 'mediafire', 'spotify', 'gdrive', 'apk', 'story', 'download', 'upload', 'ytmp4']);
const day = () => new Date().toISOString().slice(0, 10);
const mask = n => (String(n).length > 6 ? String(n).slice(0, 3) + '•••' + String(n).slice(-3) : '•••');
const dur = s => { s = Math.floor(s); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return `${d ? d + 'd ' : ''}${h ? h + 'h ' : ''}${m}m ${s % 60}s`; };
const mem = () => { const m = process.memoryUsage(); return `RSS ${U.fmtBytes(m.rss)} • heap ${U.fmtBytes(m.heapUsed)}/${U.fmtBytes(m.heapTotal)}`; };
function dirSize(p, depth = 0) { let total = 0, files = 0; try { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory() && depth < 4) { const r = dirSize(f, depth + 1); total += r.total; files += r.files; } else if (e.isFile()) { total += fs.statSync(f).size; files++; } } } catch {} return { total, files }; }
async function loopLag(n = 5) { const out = []; for (let i = 0; i < n; i++) { const t = process.hrtime.bigint(); await new Promise(r => setImmediate(r)); out.push(Number(process.hrtime.bigint() - t) / 1e6); } return out; }

module.exports = ({ def: rawDef, alias: rawAlias, registry, hooks }) => {
  const def = (names, opts, run) => { const n = [].concat(names).filter(x => !registry.has(x.toLowerCase())); if (n.length) rawDef(n, opts, run); };
  const alias = (existing, ...names) => { if (!registry.has(existing)) return; const f = names.filter(x => !registry.has(x.toLowerCase())); if (f.length) rawAlias(existing, ...f); };
  const P = ctx => ctx.var('PREFIX');
  const host = (ctx, fn) => { requireHost(ctx); return fn(); };

  /* ----------------------------------- usage counters ----------------------------------- */
  hooks.push({
    name: 'x-usage', priority: -100, run: async ctx => {
      try {
        if (!ctx.fresh || ctx.chat === 'status@broadcast') return false;
        const rt = ctx.rt; const s = (rt.usage ||= { msgs: 0, cmds: 0, recent: [], users: null, dirty: false, flushed: 0 });
        if (!s.users) s.users = ctx.get('usage:users', {});
        const text = String(ctx.text || ''); const p = ctx.prefix || '.';
        const isCmd = text.startsWith(p) && /^[a-z0-9]/i.test(text.slice(p.length));
        const cmd = isCmd ? text.slice(p.length).split(/\s+/)[0].toLowerCase() : null;
        s.msgs++; if (cmd) s.cmds++;
        if (ctx.senderNum && !ctx.fromMe) { if (!(ctx.senderNum in s.users) && Object.keys(s.users).length < 20000) s.dirty = true; s.users[ctx.senderNum] = Date.now(); }
        if (cmd) { s.recent.push({ t: Date.now(), cmd, g: ctx.isGroup, who: ctx.senderNum }); if (s.recent.length > 40) s.recent.shift(); }
        ctx.update('usage:totals', { msgs: 0, cmds: 0, byCmd: {}, since: Date.now() }, t => { t.msgs++; if (cmd) { t.cmds++; if (cmd in t.byCmd || Object.keys(t.byCmd).length < 500) t.byCmd[cmd] = (t.byCmd[cmd] || 0) + 1; } });
        ctx.update('usage:day:' + day(), { msgs: 0, cmds: 0, byCmd: {} }, t => { t.msgs++; if (cmd) { t.cmds++; t.byCmd[cmd] = (t.byCmd[cmd] || 0) + 1; } });
        if (s.dirty && Date.now() - s.flushed > 60000) { ctx.set('usage:users', s.users); s.flushed = Date.now(); s.dirty = false; }
        // remember private chats: they become the audience of statuses posted with .textstatus / .statusimage
        if (!ctx.isGroup && !ctx.fromMe && ctx.chat.endsWith('@s.whatsapp.net')) { ctx.update('statusAudience', {}, a => { a[ctx.chat] = Date.now(); const k = Object.keys(a); if (k.length > 600) delete a[k.sort((x, y) => a[x] - a[y])[0]]; }); }
      } catch { /* statistics must never block a message */ }
      return false;
    }
  });
  const totals = ctx => ctx.get('usage:totals', { msgs: 0, cmds: 0, byCmd: {}, since: Date.now() });
  const today = ctx => ctx.get('usage:day:' + day(), { msgs: 0, cmds: 0, byCmd: {} });
  const top = (o, n = 10) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

  def(['totalmessages', 'messagestats'], { cat: 'stats', desc: 'How many messages this bot has seen (today and since counting began).' }, async ctx => {
    const t = totals(ctx), d = today(ctx);
    await ctx.reply(`💬 Today: *${d.msgs.toLocaleString('en-US')}* messages (${d.cmds} commands)\n📊 Since ${new Date(t.since).toISOString().slice(0, 10)}: *${t.msgs.toLocaleString('en-US')}* messages (${t.cmds.toLocaleString('en-US')} commands)\n🔁 Since last restart: ${(ctx.rt.usage?.msgs || 0).toLocaleString('en-US')}`, { title: 'Messages' });
  });
  def(['totalcommands', 'commandcount'], { cat: 'stats', desc: 'How many commands the bot has, and how many were used.' }, async ctx => {
    const seen = new Set(); const cats = {}; for (const d of registry.values()) { if (seen.has(d)) continue; seen.add(d); cats[d.cat] = (cats[d.cat] || 0) + 1; }
    const t = totals(ctx);
    await ctx.reply(`🧩 *${seen.size}* commands in *${Object.keys(cats).length}* categories (${registry.size} names with aliases)\n▶️ Used so far: *${t.cmds.toLocaleString('en-US')}* times • ${Object.keys(t.byCmd).length} different commands\n\n${Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c, n]) => `• ${c}: ${n}`).join('\n')}`, { title: 'Commands' });
  });
  def(['commandstats', 'usage', 'analytics'], { cat: 'stats', usage: 'commandstats', desc: 'Most used commands today and all-time.' }, async ctx => {
    const t = totals(ctx), d = today(ctx); const fmt = o => (top(o).map(([c, n], i) => `${i + 1}. *${P(ctx)}${c}* — ${n}`).join('\n') || '—');
    await ctx.reply(`📅 *Today* (${d.cmds} commands)\n${fmt(d.byCmd)}\n\n🏆 *All-time* (${t.cmds.toLocaleString('en-US')})\n${fmt(t.byCmd)}`, { title: 'Command stats' });
  });
  def(['activity', 'activitylog'], { cat: 'stats', owner: true, desc: 'The most recent commands run (numbers are partly hidden).' }, async ctx => {
    const r = (ctx.rt.usage?.recent || []).slice(-15).reverse();
    await ctx.reply(r.length ? r.map(x => `🕒 ${new Date(x.t).toLocaleTimeString('en-GB', { timeZone: ctx.tz(), hour: '2-digit', minute: '2-digit', second: '2-digit' })} • *${P(ctx)}${x.cmd}* • ${x.g ? 'group' : 'private'} • ${mask(x.who)}`).join('\n') : 'No commands since the last restart.', { title: 'Recent activity' });
  });
  def(['users', 'totalusers', 'userstats'], { cat: 'stats', desc: 'How many different people have messaged the bot (since counting began).' }, async ctx => {
    const u = ctx.rt.usage?.users || ctx.get('usage:users', {}); const all = Object.values(u); const now = Date.now();
    const within = ms => all.filter(t => now - t < ms).length;
    await ctx.reply(`👥 Known users: *${all.length.toLocaleString('en-US')}*\n🟢 Active last 24h: *${within(864e5)}*\n📆 Last 7 days: *${within(7 * 864e5)}*\n🗓️ Last 30 days: *${within(30 * 864e5)}*`, { title: 'Users' });
  });
  def('totaldownloads', { cat: 'stats', desc: 'How many download commands have been used.' }, async ctx => {
    const t = totals(ctx); const n = Object.entries(t.byCmd).filter(([c]) => DOWNLOADERS.has(c)).reduce((a, [, v]) => a + v, 0);
    await ctx.reply(`📥 Download commands used: *${n.toLocaleString('en-US')}*\n${top(Object.fromEntries(Object.entries(t.byCmd).filter(([c]) => DOWNLOADERS.has(c))), 5).map(([c, v]) => `• ${P(ctx)}${c}: ${v}`).join('\n')}`, { title: 'Downloads' });
  });
  def('totalgroups', { cat: 'stats', owner: true, desc: 'How many groups this account is in.' }, async ctx => {
    const g = await ctx.sock.groupFetchAllParticipating().catch(() => null); if (!g) throw new UserError('Could not read the group list right now.');
    const list = Object.values(g); const members = list.reduce((a, x) => a + (x.participants?.length || 0), 0);
    await ctx.reply(`👥 In *${list.length}* groups with ${members.toLocaleString('en-US')} member slots in total.\n🛡️ Admin in ${list.filter(x => x.participants?.some(p => [ctx.sock.user?.id, ctx.sock.user?.lid].filter(Boolean).some(b => ctx.jidUser(b) === ctx.jidUser(p.id)) && p.admin)).length}`, { title: 'Groups' });
  });

  /* --------------------------------------- this session --------------------------------------- */
  def(['connection', 'connectioninfo', 'connectionstatus', 'botstatus', 'pairingstatus', 'sessioninfo'], { cat: 'stats', owner: true, desc: 'Connection state of this WhatsApp session.' }, async ctx => {
    const e = ctx.entry || {}; const u = ctx.sock?.user || {};
    await ctx.reply(`${e.connected === false ? '🔴 Disconnected' : '🟢 Connected'}\n📱 Number: +${mask(ctx.jidUser(u.id || e.phone || ''))}\n🏷️ Name: ${u.name || '—'}\n🔌 Socket: ${['connecting', 'open', 'closing', 'closed'][ctx.sock?.ws?.readyState] || 'unknown'}\n⏱️ Bot uptime: ${dur((Date.now() - (ctx.rt.started || Date.now())) / 1000)}\n🧠 ${mem()}`, { title: 'Connection' });
  });
  def('botinfo', { cat: 'stats', desc: 'Everything about this bot at a glance.' }, async ctx => {
    const seen = new Set(registry.values()); const t = totals(ctx);
    await ctx.reply(`🤖 *${ctx.var('BOT_NAME') || process.env.BOT_NAME || 'DECANXMD'}* v${require('../package.json').version}\n📌 Prefix: ${P(ctx)} • Mode: ${ctx.var('MODE')}\n🧩 ${seen.size} commands\n💬 ${t.msgs.toLocaleString('en-US')} messages seen\n⏱️ Up ${dur((Date.now() - (ctx.rt.started || Date.now())) / 1000)}\n🟢 Node ${process.version}`, { title: 'Bot info' });
  });
  def('performance', { cat: 'stats', desc: 'Event-loop lag, memory and CPU load right now.' }, async ctx => {
    const lag = await loopLag(); const a = process.cpuUsage(), t0 = process.hrtime.bigint(); await U.sleep(400); const b = process.cpuUsage(a), pct = (b.user + b.system) / (Number(process.hrtime.bigint() - t0) / 1000) * 100;
    const avg = lag.reduce((x, y) => x + y, 0) / lag.length;
    await ctx.reply(`${avg < 10 ? '🟢' : avg < 50 ? '🟡' : '🔴'} Event-loop lag: *${avg.toFixed(1)} ms* (max ${Math.max(...lag).toFixed(1)})\n⚙️ Bot CPU: *${pct.toFixed(1)}%*\n🧠 ${mem()}\n📈 System load: ${os.loadavg().map(x => x.toFixed(2)).join(' / ')}`, { title: 'Performance' });
  });
  def('cacheinfo', { cat: 'stats', owner: true, desc: 'Sizes of the bot\'s in-memory caches.' }, async ctx => {
    const rows = Object.entries(ctx.rt).filter(([, v]) => v instanceof Map || v instanceof Set || Array.isArray(v)).map(([k, v]) => `• ${k}: ${v.size ?? v.length}`);
    await ctx.reply(`${rows.join('\n') || 'No caches yet.'}\n\n🧠 ${mem()}\nClear them with *${P(ctx)}clearcache*`, { title: 'Caches' });
  });

  /* ------------------------------------- server (operator) ------------------------------------- */
  def('disk', { cat: 'stats', desc: 'Free disk space where the bot runs (server operator).' }, ctx => host(ctx, async () => {
    const s = fs.statfsSync(process.cwd()); const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    await ctx.reply(`💽 Total: *${U.fmtBytes(total)}*\n🟢 Free: *${U.fmtBytes(free)}* (${(free / total * 100).toFixed(1)}%)\n📦 Used: ${U.fmtBytes(total - free)}`, { title: 'Disk' });
  }));
  def(['host', 'server', 'serverinfo'], { cat: 'stats', desc: 'Where and on what the bot runs (server operator).' }, ctx => host(ctx, async () => {
    let platform = ''; try { platform = require('../lib/platform').getHostingPlatform?.() || ''; } catch {}
    await ctx.reply(`🖥️ ${os.type()} ${os.release()} • ${os.arch()}\n☁️ Platform: ${platform || 'unknown'}\n⚙️ ${os.cpus().length} cores • ${os.cpus()[0]?.model || ''}\n🧠 Memory: ${U.fmtBytes(os.totalmem() - os.freemem())} used of ${U.fmtBytes(os.totalmem())}\n🟢 Node ${process.version}\n⏱️ Host up ${dur(os.uptime())}`, { title: 'Server' });
  }));
  def('processes', { cat: 'stats', desc: 'The bot process: id, versions, memory, uptime (server operator).' }, ctx => host(ctx, async () => {
    await ctx.reply(`🧾 PID ${process.pid} (parent ${process.ppid})\n🟢 Node ${process.version} • V8 ${process.versions.v8}\n⏱️ Process up ${dur(process.uptime())}\n🧠 ${mem()}\n📂 Open handles: ${process._getActiveHandles?.().length ?? '?'}`, { title: 'Process' });
  }));
  def('gc', { cat: 'stats', desc: 'Run garbage collection now (needs node --expose-gc) (server operator).' }, ctx => host(ctx, async () => {
    if (typeof global.gc !== 'function') throw new UserError('Garbage collection is not exposed. Start the bot with *node --expose-gc server.js* to use this.');
    const before = process.memoryUsage().heapUsed; global.gc(); const after = process.memoryUsage().heapUsed;
    await ctx.reply(`🧹 Freed ${U.fmtBytes(Math.max(0, before - after))}\n🧠 ${mem()}`, { title: 'Garbage collection' });
  }));
  def(['storage', 'totalstorage', 'databaseinfo', 'backupinfo'], { cat: 'stats', desc: 'How much space the bot\'s data and backups use (server operator).' }, ctx => host(ctx, async () => {
    const root = process.cwd(); const rows = ['data', 'sessions', 'backups', 'logs', 'downloads', 'tmp'].map(d => [d, dirSize(path.join(root, d))]).filter(([, r]) => r.files);
    await ctx.reply(`${rows.map(([d, r]) => `📁 ${d}: *${U.fmtBytes(r.total)}* (${r.files} files)`).join('\n') || 'No data folders found.'}\n\n_Folder: ${path.basename(root)}_`, { title: 'Storage' });
  }));
  def('totalconnections', { cat: 'stats', desc: 'How many WhatsApp numbers this server is running (server operator).' }, ctx => host(ctx, async () => {
    const live = require('../lib/bot').liveSessions?.(); const n = live?.size ?? live?.length ?? 0; await ctx.reply(`🔗 *${n}* live session(s) on this server.`, { title: 'Connections' });
  }));
  def(['warninglogs', 'warnlogs'], { cat: 'stats', desc: 'Recent warnings from the server log (server operator).' }, ctx => host(ctx, async () => {
    const { LOG_RING } = require('../lib/bot'); const r = LOG_RING.filter(x => /warn/i.test(x.level || x.severity || '')).slice(-12).reverse();
    await ctx.reply(r.length ? r.map(x => `⚠️ ${new Date(x.at || x.time || Date.now()).toISOString().slice(11, 19)} ${String(x.message || x.msg || '').slice(0, 110)}`).join('\n') : '✅ No warnings in the recent log.', { title: 'Warnings' });
  }));
  def('clearlogs', { cat: 'stats', desc: 'Empty the in-memory log view (server operator).' }, ctx => host(ctx, async () => { const { LOG_RING } = require('../lib/bot'); const n = LOG_RING.length; LOG_RING.length = 0; await ctx.reply(`🧹 Cleared ${n} log lines from memory.`); }));

  /* ------------------------------- task / schedule wrappers ------------------------------- */
  const delegate = (ctx, target, args) => { const d = registry.get(target); if (!d) throw new UserError(`The ${target} command is not available.`); return d.run(Object.assign(Object.create(ctx), { cmd: target, args, argv: args.split(/\s+/).filter(Boolean), input: () => args })); };
  def('addtask', { cat: 'bot', owner: true, usage: 'addtask <text>', desc: 'Add an item to your to-do list.' }, ctx => delegate(ctx, 'task', `add ${ctx.input()}`));
  def('deltask', { cat: 'bot', owner: true, usage: 'deltask <number>', desc: 'Remove an item from your to-do list.' }, ctx => delegate(ctx, 'task', `del ${ctx.input()}`));
  def(['tasks', 'tasklist'], { cat: 'bot', owner: true, desc: 'Show your to-do list.' }, ctx => delegate(ctx, 'task', 'list'));
  def(['cron', 'scheduler'], { cat: 'bot', owner: true, usage: 'cron daily 08:00 <message> • cron (list)', desc: 'Schedule a message (same as .setschedule) or list them.' }, ctx => (ctx.input().trim() ? delegate(ctx, 'setschedule', ctx.input()) : delegate(ctx, 'getschedule', '')));

  /* ---------------------------------- post a WhatsApp status ---------------------------------- */
  async function postStatus(ctx, content, kind) {
    const aud = await require('../lib/statusaudience').collect(ctx);
    if (!aud.list.length) throw new UserError('I do not know who should see the status yet.');
    await ctx.sock.sendMessage('status@broadcast', content, { statusJidList: aud.list, backgroundColor: content.backgroundColor, font: content.font }).catch(e => { throw new UserError(`WhatsApp refused the status (${String(e.message).slice(0, 80)}).`); });
    await ctx.reply(`✅ ${kind} status posted.\n👥 Visible to *${aud.total}* people (${aud.chats} chats, ${aud.groupMembers} group members, you).\n_People see it in their Status tab if they have your number saved._`, { title: 'Status' });
  }
  def('textstatus', { cat: 'whatsapp', owner: true, usage: 'textstatus <text>', desc: 'Post a text status (WhatsApp "Updates") with a random background.' }, async ctx => {
    const t = ctx.input().trim(); if (!t) throw new UserError(`Usage: *${P(ctx)}textstatus Good morning!*`);
    const bg = pick(['#7C3AED', '#0EA5E9', '#16A34A', '#EA580C', '#DB2777', '#334155']);
    await postStatus(ctx, { text: t.slice(0, 700), backgroundColor: bg, font: Math.floor(Math.random() * 5) }, 'Text');
  });
  const media = (name, kinds, label, build) => def(name, { cat: 'whatsapp', owner: true, usage: `${name} [caption] (reply to ${label})`, desc: `Post a replied ${label} as your WhatsApp status.` }, async ctx => {
    const m = await ctx.needMedia(kinds, `Reply to a ${label} with this command.`); await postStatus(ctx, build(m, ctx.input().trim()), label[0].toUpperCase() + label.slice(1));
  });
  media('statusimage', ['image'], 'photo', (m, c) => ({ image: m.buffer, caption: c }));
  media('statusvideo', ['video'], 'video', (m, c) => ({ video: m.buffer, caption: c, mimetype: 'video/mp4' }));
  media('statusaudio', ['audio'], 'voice note', m => ({ audio: m.buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }));
  alias('textstatus', 'poststatus');
};
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

module.exports.helpers = { dur, mask, dirSize, DOWNLOADERS };
