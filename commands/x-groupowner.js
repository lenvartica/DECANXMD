'use strict';
/**
 * Group extras: members, membercount, admincount, randommember, randomadmin, groupstats, groupcreated, groupowner,
 *   groupname, resetgpp, unwarn, grouprequests, rejectall, welcometoggle, goodbyetoggle, groupconfig, groupbackup/restore
 * Owner tools: enable/disable commands, resetsettings, timezone, private, setpresence/offline, premium codes,
 *   exportgroups/exportusers, cleardata, and a heavily gated shell (.exec / .shell)
 */
const crypto = require('crypto');
const { execFile } = require('child_process');
const U = require('../lib/util');
const { UserError, bold } = U;
const { requireHost } = require('../lib/host');

const GUARDS = ['antilink', 'antiword', 'antispam', 'antibot', 'antifake', 'antigm', 'antigstatus', 'antimedia', 'antisticker', 'antilinkgc', 'antiinvite', 'antiabuse', 'antiforward', 'antiimage'];
const PROTECT = ['antidemote', 'antipromote', 'antikick', 'antiout', 'antiraid'];
const rnd = n => crypto.randomInt(n);
const csv = rows => rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');

module.exports = ({ def: rawDef, alias: rawAlias, registry }) => {
  const def = (names, opts, run) => { const n = [].concat(names).filter(x => !registry.has(x.toLowerCase())); if (n.length) rawDef(n, opts, run); };
  const alias = (existing, ...names) => { if (!registry.has(existing)) return; const f = names.filter(x => !registry.has(x.toLowerCase())); if (f.length) rawAlias(existing, ...f); };
  const P = ctx => ctx.var('PREFIX');
  const G = { cat: 'group', group: true };
  const phone = (ctx, p) => ctx.jidUser(p.phoneNumber || p.id);
  const members = async ctx => { const m = await ctx.group(true); if (!m) throw new UserError('I could not read this group right now.'); return m; };

  /* --------------------------------------- group info --------------------------------------- */
  def('members', { ...G, usage: 'members', desc: 'List the group members (numbers only, nobody is tagged).' }, async ctx => {
    const m = await members(ctx); const list = m.participants || [];
    await ctx.reply(`👥 *${m.subject}* — ${list.length} members\n\n${list.slice(0, 120).map((p, i) => `${i + 1}. +${phone(ctx, p)}${p.admin ? ' 👑' : ''}`).join('\n')}${list.length > 120 ? `\n… and ${list.length - 120} more` : ''}`, { title: 'Members' });
  });
  def('membercount', { ...G, desc: 'How many members this group has.' }, async ctx => { const m = await members(ctx); await ctx.reply(`👥 *${m.participants.length}* members in *${m.subject}*.`); });
  def('admincount', { ...G, desc: 'How many admins this group has.' }, async ctx => { const m = await members(ctx); const a = m.participants.filter(p => p.admin); await ctx.reply(`👑 *${a.length}* admin(s) out of ${m.participants.length} members.`); });
  const randomOf = (name, onlyAdmin) => def(name, { ...G, desc: `Pick a random ${onlyAdmin ? 'admin' : 'member'} (tags them).` }, async ctx => {
    const m = await members(ctx); const pool = m.participants.filter(p => (onlyAdmin ? p.admin : true) && ctx.jidUser(p.id) !== ctx.jidUser(ctx.sock.user?.id || ''));
    if (!pool.length) throw new UserError('There is nobody to pick.'); const p = pool[rnd(pool.length)];
    await ctx.send({ text: `🎯 Random ${onlyAdmin ? 'admin' : 'member'}: @${phone(ctx, p)}`, mentions: [p.id] }, { quoted: ctx.msg });
  });
  randomOf('randommember', false); randomOf('randomadmin', true);
  def('groupstats', { ...G, desc: 'Size, admins, age and activity of this group.' }, async ctx => {
    const m = await members(ctx); const adm = m.participants.filter(p => p.admin).length; const msgs = ctx.get('msgs', {})[ctx.chat]; const total = msgs ? Object.values(msgs).reduce((a, b) => a + (Number(b?.n ?? b) || 0), 0) : null;
    const days = m.creation ? Math.floor((Date.now() / 1000 - m.creation) / 86400) : null;
    await ctx.reply(`👥 *${m.subject}*\n🧑‍🤝‍🧑 Members: *${m.participants.length}* • 👑 Admins: *${adm}*\n📅 Created: ${m.creation ? new Date(m.creation * 1000).toISOString().slice(0, 10) + ` (${days} days ago)` : 'unknown'}\n🔒 Messages: ${m.announce ? 'admins only' : 'everyone'} • Settings: ${m.restrict ? 'admins only' : 'everyone'}${m.joinApprovalMode ? '\n✅ Join approval is on' : ''}${total != null ? `\n💬 Messages counted by the bot: ${total.toLocaleString('en-US')}` : ''}`, { title: 'Group stats' });
  });
  def('groupcreated', { ...G, desc: 'When this group was created.' }, async ctx => { const m = await members(ctx); await ctx.reply(m.creation ? `📅 Created *${new Date(m.creation * 1000).toISOString().slice(0, 10)}* (${Math.floor((Date.now() / 1000 - m.creation) / 86400)} days ago)` : 'WhatsApp did not give the creation date.'); });
  def('groupowner', { ...G, desc: 'Who created this group.' }, async ctx => { const m = await members(ctx); const o = m.ownerPn || m.owner; if (!o) throw new UserError('WhatsApp did not say who created this group.'); await ctx.send({ text: `👑 Group creator: @${ctx.jidUser(o)}`, mentions: [o] }, { quoted: ctx.msg }); });

  /* ---------------------------------------- group admin ---------------------------------------- */
  const adminOnly = async ctx => { if (!ctx.isOwner && !(await ctx.admin())) throw new UserError('Only group admins can do this.'); };
  const botAdminOnly = async ctx => { if (!(await ctx.botAdmin())) throw new UserError('I need to be a group admin to do this.'); };
  def('groupname', { ...G, usage: 'groupname <new name>', desc: 'Change the group name (admins).' }, async ctx => {
    await adminOnly(ctx); const n = ctx.input().trim(); if (!n) throw new UserError(`Usage: *${P(ctx)}groupname My New Group*`); if (n.length > 100) throw new UserError('Group names can be at most 100 characters.');
    await botAdminOnly(ctx); await ctx.sock.groupUpdateSubject(ctx.chat, n); await ctx.react('✅');
  });
  def('resetgpp', { ...G, desc: 'Remove the group picture (admins).' }, async ctx => { await adminOnly(ctx); await botAdminOnly(ctx); await ctx.sock.removeProfilePicture(ctx.chat); await ctx.react('✅'); });
  def(['unwarn', 'delwarn'], { ...G, usage: 'unwarn @user', desc: 'Remove one warning from a member (admins).' }, async ctx => {
    await adminOnly(ctx); const t = ctx.targets?.(true)?.[0]; if (!t) throw new UserError('Mention the member or reply to their message.');
    const id = ctx.jidUser(t); let left = null;
    ctx.update('warns:' + ctx.chat, {}, w => { for (const k of Object.keys(w)) if (k === id || k.endsWith(id)) { w[k] = Math.max(0, (w[k] || 0) - 1); left = w[k]; if (!w[k]) delete w[k]; } });
    await ctx.send({ text: left === null ? `@${id} has no warnings.` : `✅ Removed one warning from @${id}. Now ${left || 0}/${Number(ctx.var('WARN_LIMIT')) || 3}.`, mentions: [t] }, { quoted: ctx.msg });
  });
  def(['grouprequests', 'joinrequest', 'joinrequests'], { ...G, usage: 'grouprequests', desc: 'List people waiting to join this group (admins). Approve with .approve, decline with .reject or .rejectall.' }, async ctx => {
    await adminOnly(ctx); await botAdminOnly(ctx); const r = await ctx.sock.groupRequestParticipantsList(ctx.chat).catch(() => null);
    if (!r) throw new UserError('I could not read the join requests (is join approval on?).');
    await ctx.reply(r.length ? `📥 ${r.length} waiting:\n${r.slice(0, 60).map((x, i) => `${i + 1}. +${ctx.jidUser(x.phone_number || x.jid)}`).join('\n')}\n\n*${P(ctx)}approve all* or *${P(ctx)}rejectall*` : 'No pending requests. ✅', { title: 'Join requests' });
  });
  def('rejectall', { ...G, desc: 'Decline every pending join request (admins).' }, async ctx => {
    await adminOnly(ctx); await botAdminOnly(ctx); const r = await ctx.sock.groupRequestParticipantsList(ctx.chat).catch(() => []);
    if (!r.length) return ctx.reply('No pending requests.');
    await ctx.sock.groupRequestParticipantsUpdate(ctx.chat, r.map(x => x.jid), 'reject'); await ctx.reply(`🚫 Declined ${r.length} request(s).`);
  });
  for (const name of ['welcome', 'goodbye']) def(`${name}toggle`, { ...G, usage: `${name}toggle`, desc: `Switch the ${name} message on/off (admins).` }, async ctx => {
    await adminOnly(ctx); const k = `${name}:${ctx.chat}`; const dflt = name === 'welcome' ? '👋 Welcome {user} to *{group}*!\nYou are member #{count}.\n\n{desc}' : '👋 Goodbye {user}. We will miss you!';
    const cfg = ctx.get(k, { on: false, text: dflt }); cfg.on = !cfg.on; ctx.set(k, cfg); await ctx.reply(`${name} is now *${cfg.on ? 'ON' : 'OFF'}*.`);
  });
  def(['groupconfig', 'groupsecurity'], { ...G, desc: 'One-screen summary of every guard and message setting of this group.' }, async ctx => {
    const mode = n => { const c = ctx.get(`${n}:${ctx.chat}`, null); return c?.mode && c.mode !== 'off' ? `✅ ${c.mode}` : '▫️ off'; };
    const w = ctx.get('welcome:' + ctx.chat, { on: false }), g = ctx.get('goodbye:' + ctx.chat, { on: false });
    await ctx.reply(`🛡️ *Guards*\n${GUARDS.map(n => `${mode(n).padEnd(8)} ${n}`).join('\n')}\n\n🧯 *Protection*\n${PROTECT.map(n => `${mode(n).padEnd(8)} ${n}`).join('\n')}\n\n📣 Welcome: ${w.on ? '✅' : '▫️'} • Goodbye: ${g.on ? '✅' : '▫️'} • Promote/demote notices: ${ctx.get('pdm:' + ctx.chat, false) ? '✅' : '▫️'}\n📜 Rules: ${ctx.get('rules', {})[ctx.chat] ? '✅ set' : '▫️ none'} • Warn limit: ${Number(ctx.var('WARN_LIMIT')) || 3}`, { title: 'Group settings' });
  });
  def(['groupcheck', 'guardcheck', 'groupdoctor'], { ...G, desc: 'Find out why a protection or command is not working in this group: admin rights, mode, disabled commands and what is switched on.' }, async ctx => {
    await adminOnly(ctx); const m = await ctx.group(true); const botAdmin = await ctx.botAdmin(); const lines = []; const problems = [];
    const guardsOn = [...GUARDS, ...PROTECT].map(n => [n, ctx.get(`${n}:${ctx.chat}`, null)]).filter(([, c]) => c?.mode && c.mode !== 'off');
    lines.push(`${botAdmin ? '✅' : '❌'} I am ${botAdmin ? '' : 'NOT '}a group admin`);
    if (!botAdmin && guardsOn.length) problems.push('Make me a group admin: without it I cannot delete messages, remove people or lock the group, so every protection stays silent.');
    lines.push(`${m.announce ? 'ℹ️' : '✅'} Messages: ${m.announce ? 'only admins can send' : 'everyone can send'}`);
    lines.push(guardsOn.length ? `🛡️ Switched on (${guardsOn.length}): ${guardsOn.map(([n, c]) => `${n}${c.mode !== 'on' ? ' (' + c.mode + ')' : ''}`).join(', ')}` : '▫️ No protections are switched on in this group.');
    const mode = String(ctx.var('MODE') || 'public').toLowerCase(); lines.push(`${mode === 'public' ? '✅' : '⚠️'} Bot mode: ${mode}${mode !== 'public' ? ' — only the owner and sudo users can run commands' : ''}`);
    if (mode !== 'public') problems.push(`The bot is in ${mode} mode, so group members cannot use commands. Switch with *${P(ctx)}public*.`);
    const dis = ctx.get('disabled', []), disCats = ctx.get('disabledCats', []);
    if (dis.length || disCats.length) { lines.push(`⛔ Switched off by the owner: ${[...disCats.map(c => 'category ' + c), ...dis.slice(0, 8)].join(', ')}${dis.length > 8 ? ' …' : ''}`); problems.push(`Some commands are disabled for this bot number. Re-enable with *${P(ctx)}enable <name or category>* or in the dashboard.`); }
    lines.push(`📌 Prefix: *${ctx.var('PREFIX')}*`);
    lines.push('ℹ️ Admins, the owner and trusted people are exempt from protections — test with a normal member\'s account.');
    await ctx.reply(`${lines.join('\n')}${problems.length ? `\n\n🔧 *What to fix*\n${problems.map(x => '• ' + x).join('\n')}` : '\n\n👍 Nothing looks wrong. If something still fails, send me the terminal line that appears when it should have worked.'}`, { title: 'Group check' });
  });
  def('groupbackup', { ...G, desc: 'Send a JSON backup of this group\'s bot settings (admins).' }, async ctx => {
    await adminOnly(ctx); const keys = [...GUARDS, ...PROTECT, 'welcome', 'goodbye', 'pdm']; const out = { format: 'decanxmd-group-backup', version: 1, at: new Date().toISOString(), settings: {} };
    for (const k of keys) { const v = ctx.get(`${k}:${ctx.chat}`, undefined); if (v !== undefined) out.settings[k] = v; }
    const rules = ctx.get('rules', {})[ctx.chat]; if (rules) out.rules = rules;
    await ctx.doc(Buffer.from(JSON.stringify(out, null, 2)), 'group-settings-backup.json', 'application/json');
  });
  def('grouprestore', { ...G, desc: 'Restore this group\'s settings from a backup file: reply to the JSON file from .groupbackup (admins).' }, async ctx => {
    await adminOnly(ctx); const m = await ctx.media().catch(() => null); if (!m) throw new UserError(`Reply to the backup file made by *${P(ctx)}groupbackup*.`);
    let j; try { j = JSON.parse(m.buffer.toString('utf8')); } catch { throw new UserError('That file is not valid JSON.'); }
    if (j.format !== 'decanxmd-group-backup' || typeof j.settings !== 'object') throw new UserError('That is not a group backup from this bot.');
    let n = 0; for (const [k, v] of Object.entries(j.settings)) if ([...GUARDS, ...PROTECT, 'welcome', 'goodbye', 'pdm'].includes(k)) { ctx.set(`${k}:${ctx.chat}`, v); n++; }
    if (typeof j.rules === 'string') { ctx.update('rules', {}, o => { o[ctx.chat] = j.rules.slice(0, 1500); }); n++; }
    await ctx.reply(`♻️ Restored ${n} setting(s).`);
  });

  /* ----------------------------------------- owner tools ----------------------------------------- */
  const O = { cat: 'bot', owner: true };
  const resolveCmd = n => registry.get(String(n || '').toLowerCase());
  def('disable', { ...O, usage: 'disable <command or category>', desc: 'Turn a command (or a whole category) off for this bot number. Same as the dashboard switches.' }, async ctx => {
    const n = (ctx.argv[0] || '').toLowerCase(); if (!n) throw new UserError(`Usage: *${P(ctx)}disable ping* or *${P(ctx)}disable games*`);
    const d = resolveCmd(n);
    if (d) { if (d.core) throw new UserError('That command is essential and cannot be disabled.'); ctx.update('disabled', [], l => { if (!l.includes(d.name)) l.push(d.name); }); return ctx.reply(`⛔ *${d.name}* is now disabled. Re-enable with *${P(ctx)}enable ${d.name}*`); }
    const cats = new Set([...registry.values()].map(x => x.cat)); const cat = cats.has(n) ? n : cats.has(n.replace(/s$/, '')) ? n.replace(/s$/, '') : null; if (!cat) throw new UserError(`I do not know that command or category. Categories: ${[...cats].join(', ')}`);
    ctx.update('disabledCats', [], l => { if (!l.includes(cat)) l.push(cat); }); await ctx.reply(`⛔ Category *${cat}* is now disabled. Re-enable with *${P(ctx)}enable ${cat}*`);
  });
  def('enable', { ...O, usage: 'enable <command or category>', desc: 'Turn a disabled command (or category) back on.' }, async ctx => {
    const n = (ctx.argv[0] || '').toLowerCase(); if (!n) throw new UserError(`Usage: *${P(ctx)}enable ping*`);
    const d = resolveCmd(n); let did = false;
    ctx.update('disabled', [], l => { const i = l.indexOf(d?.name || n); if (i >= 0) { l.splice(i, 1); did = true; } });
    ctx.update('disabledCats', [], l => { const i = l.indexOf(n); if (i >= 0) { l.splice(i, 1); did = true; } });
    const catOff = !did && d && ctx.get('disabledCats', []).includes(d.cat);
    await ctx.reply(did ? `✅ *${n}* is enabled again.` : catOff ? `*${n}* is not disabled itself, but its whole category *${d.cat}* is. Turn it back on with *${P(ctx)}enable ${d.cat}*.` : `*${n}* was not disabled.`);
  });
  def('resetsettings', { ...O, usage: 'resetsettings confirm', desc: 'Reset every .setvar setting (prefix, mode, messages…) to its default. Does not touch groups or data.' }, async ctx => {
    if ((ctx.argv[0] || '').toLowerCase() !== 'confirm') return ctx.reply(`⚠️ This resets all settings changed with *${P(ctx)}setvar*. Send *${P(ctx)}resetsettings confirm* to continue.`);
    ctx.set('vars', {}); await ctx.reply('♻️ All settings are back to their defaults. Check with *.allvar*.');
  });
  def(['timezone', 'settimezone'], { ...O, usage: 'timezone [Area/City]', desc: 'Show or change the bot timezone, e.g. timezone Africa/Nairobi.' }, async ctx => {
    const z = ctx.argv[0]; if (!z) return ctx.reply(`🕒 Timezone: *${ctx.var('TIMEZONE') || process.env.TIMEZONE || 'Africa/Nairobi'}*\nChange: *${P(ctx)}timezone Africa/Lagos*`);
    try { new Intl.DateTimeFormat('en', { timeZone: z }); } catch { throw new UserError('Unknown timezone. Use names like Africa/Nairobi, Europe/London, America/New_York.'); }
    ctx.update('vars', {}, o => { o.TIMEZONE = z; }); await ctx.reply(`🕒 Timezone is now *${z}* (${new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit' }).format(new Date())} there).`);
  });
  def('private', { ...O, desc: 'Private mode: only you and sudo users can use commands (same as .setvar MODE:private).' }, async ctx => { ctx.update('vars', {}, o => { o.MODE = 'private'; }); await ctx.reply('🔒 Mode is now *private*. Undo with *' + P(ctx) + 'public*.'); });
  def('setpresence', { ...O, usage: 'setpresence <available|unavailable|composing|recording|paused>', desc: 'Show a presence in this chat (or online/offline for the account).' }, async ctx => {
    const s = (ctx.argv[0] || '').toLowerCase(); if (!['available', 'unavailable', 'composing', 'recording', 'paused'].includes(s)) throw new UserError(`Use: ${P(ctx)}setpresence available | unavailable | composing | recording | paused`);
    await ctx.sock.sendPresenceUpdate(s, ['composing', 'recording', 'paused'].includes(s) ? ctx.chat : undefined); await ctx.react('✅');
  });
  def('offline', { ...O, desc: 'Appear offline (sends the "unavailable" presence).' }, async ctx => { await ctx.sock.sendPresenceUpdate('unavailable'); await ctx.react('✅'); });

  /* encryption repair */
  def(['fixsession', 'fixdecrypt', 'fixmac'], { ...O, usage: 'fixsession <number> | fixsession all', desc: 'Repair "Bad MAC / failed to decrypt": clear the broken encryption session with one contact (or all contacts). Their next message arrives normally.' }, async ctx => {
    const h = ctx.entry?.healer; if (!h) throw new UserError('Session repair is not available for this session.');
    const a = (ctx.argv[0] || '').toLowerCase();
    if (a === 'all') { if ((ctx.argv[1] || '').toLowerCase() !== 'confirm') return ctx.reply(`⚠️ This clears the encryption sessions with *all* contacts. Nothing is lost; each contact's next message re-creates the session (their first message after this may need a moment). Send *${P(ctx)}fixsession all confirm* to continue.`); const n = await h.healAll(); return ctx.reply(`🔧 Cleared ${n} contact session(s). Ask people to send a message again.`); }
    const nums = [...new Set([...(ctx.targets?.(true) || []).map(j => ctx.jidUser(j)), ...ctx.argv.map(x => x.replace(/\D/g, '')).filter(x => x.length >= 7)])];
    if (!nums.length) throw new UserError(`Usage: *${P(ctx)}fixsession 2547XXXXXXXX* (or reply to / mention the person), or *${P(ctx)}fixsession all*\n\nIf the problem keeps coming back, make sure this WhatsApp number is not also running in another copy of the bot (for example a hosted one).`);
    let n = 0; for (const u of nums) n += await h.heal(u, { manual: true });
    await ctx.reply(n ? `🔧 Repaired ${n} session(s). Ask them to send a message again.` : 'I had no stored session for that number (nothing to repair). If their messages still do not arrive, try *' + P(ctx) + 'fixsession all*.');
  });

  /* exports */
  def('exportgroups', { ...O, heavy: true, desc: 'Send a CSV of every group this account is in (name, id, members, created).' }, async ctx => {
    const g = await ctx.sock.groupFetchAllParticipating().catch(() => null); if (!g) throw new UserError('Could not read the group list right now.');
    const rows = [['name', 'jid', 'members', 'admins', 'created', 'announce_only']].concat(Object.values(g).map(x => [x.subject, x.id, x.participants?.length || 0, x.participants?.filter(p => p.admin).length || 0, x.creation ? new Date(x.creation * 1000).toISOString().slice(0, 10) : '', x.announce ? 'yes' : 'no']));
    await ctx.doc(Buffer.from('\ufeff' + csv(rows)), 'groups.csv', 'text/csv');
  });
  def('exportusers', { ...O, desc: 'Send a CSV of the people who have messaged the bot (number, last seen).' }, async ctx => {
    const u = ctx.rt.usage?.users || ctx.get('usage:users', {}); const rows = [['number', 'last_seen']].concat(Object.entries(u).map(([n, t]) => ['+' + n, new Date(t).toISOString()]));
    if (rows.length < 2) throw new UserError('No users recorded yet.');
    await ctx.doc(Buffer.from('\ufeff' + csv(rows)), 'users.csv', 'text/csv');
  });
  def('cleardata', { ...O, usage: 'cleardata confirm', desc: 'Reset the usage statistics and clear in-memory caches. Settings, groups and economy data are kept.' }, async ctx => {
    if ((ctx.argv[0] || '').toLowerCase() !== 'confirm') return ctx.reply(`⚠️ This clears usage statistics and caches. Settings and economy data stay. Send *${P(ctx)}cleardata confirm* to continue.`);
    ctx.del?.('usage:totals'); ctx.del?.('usage:users'); ctx.del?.('statusAudience'); delete ctx.rt.usage; for (const v of Object.values(ctx.rt)) if (v instanceof Map || v instanceof Set) v.clear();
    await ctx.reply('🧹 Statistics and caches cleared.');
  });

  /* premium codes (bookkeeping: other features can check the "premium" list) */
  const premium = ctx => ctx.get('premium', {});
  const active = (ctx, n) => (premium(ctx)[n] || 0) > Date.now();
  const days = s => { const d = Math.floor(Number(s)); if (!(d >= 1 && d <= 3650)) throw new UserError('Give a number of days between 1 and 3650.'); return d; };
  const grant = (ctx, n, d) => ctx.update('premium', {}, p => { p[n] = Math.max(p[n] || 0, Date.now()) + d * 864e5; return p[n]; });
  const who = ctx => { const n = [...new Set([...(ctx.targets?.(true) || []).map(j => ctx.jidUser(j)), ...ctx.argv.map(a => a.replace(/\D/g, '')).filter(x => x.length >= 7)])]; if (!n.length) throw new UserError('Mention, reply to, or type the number of the person.'); return n[0]; };
  def(['addpremium', 'giftpremium', 'gift'], { ...O, usage: 'addpremium @user <days>', desc: 'Give someone premium for a number of days.' }, async ctx => {
    const n = who(ctx); const d = days(ctx.argv.find(a => /^\d{1,4}$/.test(a) && a !== n)); const until = grant(ctx, n, d);
    await ctx.reply(`⭐ +${n} is premium until *${new Date(until).toISOString().slice(0, 10)}*.`);
  });
  def('delpremium', { ...O, usage: 'delpremium @user', desc: 'Remove someone\'s premium.' }, async ctx => { const n = who(ctx); ctx.update('premium', {}, p => { delete p[n]; }); await ctx.reply(`✅ Premium removed for +${n}.`); });
  def('premiumlist', { ...O, desc: 'List active premium users.' }, async ctx => {
    const l = Object.entries(premium(ctx)).filter(([, t]) => t > Date.now()).sort((a, b) => a[1] - b[1]);
    await ctx.reply(l.length ? l.map(([n, t]) => `⭐ +${n} — until ${new Date(t).toISOString().slice(0, 10)}`).join('\n') : 'Nobody has premium right now.', { title: 'Premium' });
  });
  def(['premiumcheck', 'premium'], { cat: 'bot', desc: 'Check your premium status.' }, async ctx => {
    const t = premium(ctx)[ctx.senderNum] || 0; await ctx.reply(t > Date.now() ? `⭐ You are premium until *${new Date(t).toISOString().slice(0, 10)}* (${Math.ceil((t - Date.now()) / 864e5)} days left).` : `You are not premium. Got a code? Send *${P(ctx)}redeemcode CODE*`, { title: 'Premium' });
  });
  def('generatecode', { ...O, usage: 'generatecode <days> [how many]', desc: 'Create premium codes that people can redeem.' }, async ctx => {
    const d = days(ctx.argv[0]); const n = Math.min(10, Math.max(1, Math.floor(Number(ctx.argv[1])) || 1)); const out = [];
    ctx.update('premiumCodes', {}, c => { for (let i = 0; i < n; i++) { const code = 'DX-' + crypto.randomBytes(2).toString('hex').toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(); c[code] = { days: d, at: Date.now() }; out.push(code); } });
    await ctx.reply(`🎟️ ${d}-day code(s):\n${out.map(c => '`' + c + '`').join('\n')}\n\nRedeem with *${P(ctx)}redeemcode CODE*`);
  });
  def(['redeemcode', 'redeem'], { cat: 'bot', usage: 'redeemcode <CODE>', desc: 'Redeem a premium code.' }, async ctx => {
    const code = (ctx.argv[0] || '').toUpperCase(); if (!code) throw new UserError(`Usage: *${P(ctx)}redeemcode DX-XXXX-XXXX*`);
    if (!ctx.cooldown(5, 'redeem')) throw new UserError('Please wait a few seconds between attempts.');
    let d = null; ctx.update('premiumCodes', {}, c => { if (c[code]) { d = c[code].days; delete c[code]; } });
    if (!d) throw new UserError('That code is invalid or was already used.');
    const until = grant(ctx, ctx.senderNum, d); await ctx.reply(`🎉 Code accepted! Premium for *${d} days*, until *${new Date(until).toISOString().slice(0, 10)}*.`);
  });
  def('coupons', { ...O, desc: 'List premium codes that have not been redeemed yet.' }, async ctx => { const c = Object.entries(ctx.get('premiumCodes', {})); await ctx.reply(c.length ? c.map(([k, v]) => `🎟️ \`${k}\` — ${v.days} days`).join('\n') : 'No unused codes.', { title: 'Codes' }); });

  /* the shell: server operator only, and only when ALLOW_SHELL=on is set on the server */
  const shell = async ctx => {
    requireHost(ctx);
    if (String(process.env.ALLOW_SHELL || '').toLowerCase() !== 'on') throw new UserError('🔒 The shell is switched off. Running commands from WhatsApp is risky, so it only works if the server operator sets ALLOW_SHELL=on (and HOST_ADMINS to their own number).');
    if (!String(process.env.HOST_ADMINS || '').trim() && !ctx.fromMe) throw new UserError('🔒 Set HOST_ADMINS to your own number before enabling the shell.');
    const cmd = ctx.input().trim(); if (!cmd) throw new UserError(`Usage: *${P(ctx)}exec ls -la*`);
    ctx.logger?.warn?.({ by: ctx.senderNum, command: cmd.slice(0, 200) }, 'Shell command run from WhatsApp');
    const out = await new Promise(res => { const isWin = process.platform === 'win32'; execFile(isWin ? 'cmd.exe' : '/bin/sh', isWin ? ['/c', cmd] : ['-c', cmd], { timeout: 20000, maxBuffer: 256 * 1024, cwd: process.cwd(), env: { ...process.env, TOKEN: undefined } }, (e, so, se) => res(`${so || ''}${se ? '\n' + se : ''}${e && !so && !se ? e.message : ''}`.trim() || '(no output)')); });
    await ctx.reply('```' + out.slice(0, 3000) + '```', { title: 'Shell' });
  };
  def(['exec', 'shell'], { ...O, heavy: true, usage: 'exec <command>', desc: 'Run a server command (operator only, needs ALLOW_SHELL=on on the server).' }, shell);
};
