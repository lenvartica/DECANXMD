'use strict';
/** Messaging + time tools: reply edit pin unpin typing recording contact location remind timer countdown stopwatch calendar note notes */
const U = require('../lib/util');
const { UserError, bold, sleep } = U;

module.exports = ({ def }) => {
  const P = ctx => ctx.var('PREFIX');
  const needQuoted = (ctx, what) => { if (!ctx.quoted) throw new UserError(what); return ctx.quoted; };

  def('reply', { cat: 'whatsapp', owner: true, usage: 'reply <text> (reply to a message)', desc: 'Send a message that quotes the message you replied to.' }, async ctx => {
    const q = needQuoted(ctx, `Reply to a message with *${P(ctx)}reply your text*.`);
    const t = ctx.args.trim();
    if (!t) throw new UserError(`Write the text: *${P(ctx)}reply Thanks, noted!*`);
    await ctx.sendTo(ctx.chat, { text: t }, { quoted: { key: q.key, message: q.message } });
  });

  def('edit', { cat: 'whatsapp', owner: true, usage: 'edit <new text> (reply to a message the bot sent)', desc: 'Change the text of a message the bot sent earlier.' }, async ctx => {
    const q = needQuoted(ctx, `Reply to one of my messages with *${P(ctx)}edit new text*.`);
    if (!q.key.fromMe) throw new UserError('I can only edit messages that I sent myself.');
    const t = ctx.args.trim();
    if (!t) throw new UserError(`Write the new text: *${P(ctx)}edit Updated text*`);
    await ctx.sock.sendMessage(ctx.chat, { text: t, edit: q.key }).catch(e => { throw new UserError('WhatsApp would not edit that message (' + String(e.message).slice(0, 60) + '). Messages can be edited for 15 minutes.'); });
  });

  const DUR = { '24h': 86400, '1d': 86400, '7d': 604800, '1w': 604800, '30d': 2592000, '1m': 2592000 };
  def('pin', { cat: 'whatsapp', usage: 'pin [24h|7d|30d] (reply to a message)', desc: 'Pin a message in this chat (default 7 days). Group admins and the owner.' }, async ctx => {
    const q = needQuoted(ctx, `Reply to the message you want to pin with *${P(ctx)}pin*.`);
    if (ctx.isGroup && !ctx.isOwner && !(await ctx.admin())) throw new UserError('🛡️ Only group admins can pin messages.');
    else if (!ctx.isGroup && !ctx.isOwner) throw new UserError('🔒 Only the bot owner can pin messages here.');
    const time = DUR[(ctx.argv[0] || '7d').toLowerCase()];
    if (!time) throw new UserError('Choose 24h, 7d or 30d.');
    await ctx.sock.sendMessage(ctx.chat, { pin: q.key, type: 1, time }).catch(e => { throw new UserError('WhatsApp refused to pin it (' + String(e.message).slice(0, 60) + '). In groups I may need to be an admin.'); });
    await ctx.react('📌');
  });
  def('unpin', { cat: 'whatsapp', usage: 'unpin (reply to the pinned message)', desc: 'Remove a pinned message.' }, async ctx => {
    const q = needQuoted(ctx, `Reply to the pinned message with *${P(ctx)}unpin*.`);
    if (ctx.isGroup && !ctx.isOwner && !(await ctx.admin())) throw new UserError('🛡️ Only group admins can unpin messages.');
    else if (!ctx.isGroup && !ctx.isOwner) throw new UserError('🔒 Only the bot owner can unpin messages here.');
    await ctx.sock.sendMessage(ctx.chat, { pin: q.key, type: 2, time: 86400 }).catch(e => { throw new UserError('WhatsApp refused to unpin it (' + String(e.message).slice(0, 60) + ').'); });
    await ctx.react('✅');
  });

  for (const [name, state, icon] of [['typing', 'composing', '⌨️'], ['recording', 'recording', '🎙️']]) {
    def(name, { cat: 'whatsapp', owner: true, usage: `${name} [seconds up to 60]`, desc: `Show "${state === 'composing' ? 'typing…' : 'recording audio…'}" in this chat for a while.` }, async ctx => {
      const s = Math.min(60, Math.max(2, parseInt(ctx.argv[0], 10) || 8));
      await ctx.sock.sendPresenceUpdate(state, ctx.chat);
      setTimeout(() => ctx.sock.sendPresenceUpdate('paused', ctx.chat).catch(() => {}), s * 1000);
      await ctx.react(icon);
    });
  }

  def(['contact', 'vcard'], { cat: 'whatsapp', usage: 'contact <number> [name]', desc: 'Send a phone number as a contact card.' }, async ctx => {
    const num = (ctx.argv[0] || '').replace(/\D/g, '');
    if (num.length < 7 || num.length > 15) throw new UserError(`Give a number with country code: *${P(ctx)}contact 254712345678 Brian*`);
    const name = ctx.argv.slice(1).join(' ') || '+' + num;
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;type=VOICE;waid=${num}:+${num}\nEND:VCARD`;
    await ctx.sendTo(ctx.chat, { contacts: { displayName: name, contacts: [{ vcard }] } }, { quoted: ctx.msg });
  });

  def(['location', 'loc', 'sendlocation'], { cat: 'whatsapp', heavy: true, usage: 'location <place> • location -1.2921,36.8219 [name]', desc: 'Send a map pin for a place name or coordinates.' }, async ctx => {
    const t = ctx.input().trim();
    if (!t) throw new UserError(`Give a place or coordinates: *${P(ctx)}location Meru town*`);
    let lat, lng, name = '', addr = '';
    const m = t.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*(.*)$/);
    if (m) { lat = +m[1]; lng = +m[2]; name = m[3] || 'Location'; }
    else {
      const j = await U.getJson('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(t), { timeout: 12000, headers: { 'user-agent': 'DecanBot/1.0 (WhatsApp bot)' } });
      if (!j?.[0]) throw new UserError('I could not find that place. Try a more specific name.');
      lat = +j[0].lat; lng = +j[0].lon; name = String(j[0].display_name).split(',')[0]; addr = String(j[0].display_name).slice(0, 120);
    }
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new UserError('Those coordinates are out of range.');
    await ctx.sendTo(ctx.chat, { location: { degreesLatitude: lat, degreesLongitude: lng, name, address: addr } }, { quoted: ctx.msg });
  });

  /* ---------------- reminders & timers (shared store with .reminder) ---------------- */
  function schedule(ctx, ms, text) {
    if (ms < 5000 || ms > 30 * 86400000) throw new UserError('Choose a time between 5 seconds and 30 days, for example 10m, 2h, 1d or 1h30m.');
    const mine = ctx.get('reminders', []).filter(r => r.by === ctx.senderNum).length;
    if (mine >= 10 && !ctx.isOwner) throw new UserError('You already have 10 reminders waiting.');
    const at = Date.now() + ms;
    ctx.update('reminders', [], l => { l.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at, chat: ctx.chat, text, by: ctx.senderNum }); });
    return at;
  }
  def('remind', { cat: 'schedule', usage: 'remind <time> <message>  e.g. remind 30m call mum', desc: 'Remind you (or this chat) after a delay. Times: 30s, 10m, 2h, 1d, 1h30m.' }, async ctx => {
    const ms = U.parseDuration(ctx.argv[0] || '');
    const text = ctx.argv.slice(1).join(' ').trim();
    if (!ms || !text) throw new UserError(`Format: *${P(ctx)}remind 30m call mum*`);
    const at = schedule(ctx, ms, `@${ctx.senderNum} ${text}`);
    await ctx.reply(`⏰ I will remind you in ${bold(U.fmtDur(ms / 1000))}\n📝 ${text}`, { title: 'Reminder set' });
  });
  def('timer', { cat: 'schedule', usage: 'timer <time> [label]  e.g. timer 10m pasta', desc: 'A countdown timer: I message you when time is up.' }, async ctx => {
    const ms = U.parseDuration(ctx.argv[0] || '');
    if (!ms) throw new UserError(`Format: *${P(ctx)}timer 10m pasta*`);
    schedule(ctx, ms, `⏱️ Time is up! ${ctx.argv.slice(1).join(' ') || ''}`.trim());
    await ctx.reply(`⏱️ Timer started: ${bold(U.fmtDur(ms / 1000))}${ctx.argv[1] ? `\n🏷️ ${ctx.argv.slice(1).join(' ')}` : ''}`, { title: 'Timer' });
  });

  def('countdown', { cat: 'schedule', usage: 'countdown <YYYY-MM-DD> [event name]', desc: 'How long until a date. Example: countdown 2026-12-25 Christmas' }, async ctx => {
    const m = (ctx.argv[0] || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
    if (!m) throw new UserError(`Format: *${P(ctx)}countdown 2026-12-25 Christmas*`);
    const target = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    if (Number.isNaN(target)) throw new UserError('That date is not valid.');
    const diff = target - Date.now();
    const label = ctx.argv.slice(1).join(' ') || ctx.argv[0];
    if (diff < 0) return ctx.reply(`🎉 ${bold(label)} was ${Math.floor(-diff / 86400000)} day(s) ago.`, { title: 'Countdown' });
    const d = Math.floor(diff / 86400000), h = Math.floor(diff % 86400000 / 3600000), mi = Math.floor(diff % 3600000 / 60000);
    await ctx.reply(`⏳ ${bold(label)}\n\n${bold(String(d))} days, ${h} hours, ${mi} minutes\n(${Math.floor(d / 7)} weeks and ${d % 7} days)`, { title: 'Countdown' });
  });

  def(['stopwatch', 'sw'], { cat: 'schedule', usage: 'stopwatch start|lap|stop', desc: 'A personal stopwatch with laps.' }, async ctx => {
    const all = (ctx.rt.stopwatch ||= new Map());
    const key = ctx.chat + '|' + ctx.senderNum;
    const a = (ctx.argv[0] || 'start').toLowerCase();
    const cur = all.get(key);
    const f = ms => { const s = ms / 1000, m = Math.floor(s / 60); return `${m ? m + 'm ' : ''}${(s % 60).toFixed(1)}s`; };
    if (a === 'start') { if (cur) throw new UserError(`It is already running (${f(Date.now() - cur.t0)}). Use *${P(ctx)}stopwatch lap* or *stop*.`); all.set(key, { t0: Date.now(), laps: [] }); return ctx.reply('▶️ Stopwatch started.', { title: 'Stopwatch' }); }
    if (!cur) throw new UserError(`Start it first with *${P(ctx)}stopwatch start*.`);
    if (a === 'lap') { const last = cur.laps.at(-1) || cur.t0; cur.laps.push(Date.now()); return ctx.reply(`🏁 Lap ${cur.laps.length}: ${bold(f(Date.now() - last))}\nTotal: ${f(Date.now() - cur.t0)}`, { title: 'Stopwatch' }); }
    if (a === 'stop') { all.delete(key); const laps = cur.laps.map((t, i) => `Lap ${i + 1}: ${f(t - (cur.laps[i - 1] || cur.t0))}`); return ctx.reply(`⏹️ Stopped at ${bold(f(Date.now() - cur.t0))}${laps.length ? '\n\n' + laps.join('\n') : ''}`, { title: 'Stopwatch' }); }
    throw new UserError('Use start, lap or stop.');
  });

  def(['calendar', 'cal'], { cat: 'schedule', usage: 'calendar [month] [year]', desc: 'A month calendar with today marked. Example: calendar 12 2026' }, async ctx => {
    const tz = ctx.tz();
    const now = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()) + 'T00:00:00Z');
    let month = now.getUTCMonth() + 1, year = now.getUTCFullYear();
    const nums = ctx.argv.map(Number).filter(n => Number.isFinite(n));
    if (nums[0]) { if (nums[0] >= 1 && nums[0] <= 12) month = nums[0]; else if (nums[0] > 1900) year = nums[0]; }
    if (nums[1] > 1900 && nums[1] < 3000) year = nums[1];
    const first = new Date(Date.UTC(year, month - 1, 1)), days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const offset = (first.getUTCDay() + 6) % 7; // Monday first
    const isNow = year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;
    let out = 'Mo Tu We Th Fr Sa Su\n' + '   '.repeat(offset);
    for (let d = 1; d <= days; d++) {
      out += String(d).padStart(2) + ((offset + d) % 7 === 0 ? '\n' : ' ');
    }
    await ctx.reply('```\n' + out.trimEnd() + '\n```' + (isNow ? `\n📍 Today is ${now.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}` : ''), { title: first.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) });
  });

  /* ---------------- notes ---------------- */
  const notesOf = ctx => (ctx.get('notes', {})[ctx.senderNum] || []);
  const showNotes = (ctx, l) => ctx.reply(l.length ? l.map((n, i) => `${i + 1}. ${n.t}`).join('\n') + `\n\nDelete: *${P(ctx)}note del <number>* • Clear all: *${P(ctx)}note clear*` : `No notes yet. Save one: *${P(ctx)}note buy milk*`, { title: `Your notes (${l.length})` });
  def(['note', 'notes'], { cat: 'personal', usage: 'note <text> • notes • note del <n> • note clear', desc: 'Your private notebook. Save text, list it, delete one or clear all.' }, async ctx => {
    const a = (ctx.argv[0] || '').toLowerCase();
    if (ctx.cmd === 'notes' || !ctx.args || a === 'list') return showNotes(ctx, notesOf(ctx));
    if (a === 'clear') { ctx.update('notes', {}, o => { delete o[ctx.senderNum]; }); return ctx.reply('🗑️ All your notes were deleted.', { title: 'Notes' }); }
    if (a === 'del' || a === 'delete' || a === 'rm') {
      const n = parseInt(ctx.argv[1], 10), l = notesOf(ctx);
      if (!(n >= 1 && n <= l.length)) throw new UserError(`Pick a number from 1 to ${l.length || 1}.`);
      ctx.update('notes', {}, o => { o[ctx.senderNum].splice(n - 1, 1); });
      return ctx.reply(`🗑️ Deleted note ${n}.`, { title: 'Notes' });
    }
    const t = (a === 'add' ? ctx.args.slice(3) : ctx.args).trim();
    if (!t) throw new UserError(`Write the note: *${P(ctx)}note buy milk*`);
    if (notesOf(ctx).length >= 50) throw new UserError('You have 50 notes. Delete some first.');
    ctx.update('notes', {}, o => { (o[ctx.senderNum] ||= []).push({ t: t.slice(0, 500), at: Date.now() }); });
    await ctx.reply(`📝 Saved as note ${notesOf(ctx).length}.`, { title: 'Notes' });
  });
};
