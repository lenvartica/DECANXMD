'use strict';
const crypto = require('crypto');
const U = require('../lib/util');
const { UserError, bold } = U;

const jidUser = j => String(j || '').split('@')[0].split(':')[0];
const pids = p => [p?.id, p?.lid, p?.phoneNumber, p?.jid].map(jidUser).filter(Boolean);
const isAdminP = p => Boolean(p && (p.admin === 'admin' || p.admin === 'superadmin' || p.admin === true));
const phoneOf = p => {
  const cand = [p?.phoneNumber, p?.jid, p?.id].find(x => String(x || '').endsWith('@s.whatsapp.net'));
  return cand ? jidUser(cand) : null;
};
const label = p => '+' + (phoneOf(p) || jidUser(p.id));
const LINK_RE = /(https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+|wa\.me\/\S+/i;

module.exports = ({ def, hooks, events, tickers }) => {
  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */
  async function resolve(ctx, { allowBot = false, allowAdmins = true } = {}) {
    const meta = await ctx.group();
    const raw = ctx.targets();
    const botIds = ctx.botIds();
    const found = [];
    const missing = [];
    for (const j of raw) {
      const p = ctx.participantByJid(meta, j);
      if (!p) { missing.push(j); continue; }
      if (!allowBot && pids(p).some(i => botIds.includes(i))) continue;
      if (!allowAdmins && isAdminP(p)) continue;
      found.push(p);
    }
    return { meta, found, missing, raw };
  }

  async function addWarn(api, chat, userJid) {
    const limit = Number(api.var('WARN_LIMIT')) || 3;
    const u = jidUser(userJid);
    const n = api.update('warns:' + chat, {}, w => (w[u] = (w[u] || 0) + 1));
    if (n >= limit) {
      await api.sock.groupParticipantsUpdate(chat, [userJid], 'remove');
      api.update('warns:' + chat, {}, w => { delete w[u]; });
      return { kicked: true, n, limit };
    }
    return { kicked: false, n, limit };
  }

  const mentionText = (jid, text) => ({ text, mentions: [jid] });

  /* ------------------------------------------------------------------ */
  /* member management                                                    */
  /* ------------------------------------------------------------------ */
  def('add', { cat: 'group', group: true, admin: true, botAdmin: true, usage: 'add <number> [more numbers]', desc: 'Add people to the group by phone number (with country code).' }, async ctx => {
    const nums = ctx.args.split(/[\s,]+/).map(x => x.replace(/\D/g, '')).filter(x => x.length >= 7 && x.length <= 15).slice(0, 10);
    if (!nums.length) throw new UserError('Give numbers with country code, e.g. *add 254712345678*');
    const res = await ctx.sock.groupParticipantsUpdate(ctx.chat, nums.map(n => n + '@s.whatsapp.net'), 'add');
    const lines = [];
    for (const r of res) {
      const num = jidUser(r.jid || r.content?.attrs?.jid || '');
      const st = String(r.status);
      if (st === '200') lines.push(`✅ +${num} added`);
      else if (st === '409') lines.push(`ℹ️ +${num} is already in the group`);
      else if (st === '403' || st === '408') {
        lines.push(`📩 +${num} can't be added directly; sent an invite link`);
        try { const code = await ctx.sock.groupInviteCode(ctx.chat); await ctx.sendTo(r.jid, { text: `You're invited to join: https://chat.whatsapp.com/${code}` }); } catch {}
      } else if (st === '401') lines.push(`🚫 +${num} has blocked the bot`);
      else lines.push(`❌ +${num} failed (status ${st})`);
    }
    await ctx.reply(lines.join('\n'), { title: 'Add members' });
  });

  def('kick', { cat: 'group', group: true, admin: true, botAdmin: true, usage: 'kick @user | reply', desc: 'Remove people from the group (admins cannot be kicked).' }, async ctx => {
    const { found } = await resolve(ctx, { allowAdmins: false });
    if (!found.length) throw new UserError('Mention or reply to a non-admin member to kick.');
    await ctx.sock.groupParticipantsUpdate(ctx.chat, found.slice(0, 10).map(p => p.id), 'remove');
    await ctx.send({ text: ctx.frame(`👢 Removed ${found.slice(0, 10).map(label).join(', ')}`), mentions: [] }, { quoted: ctx.msg });
  });

  for (const [name, action, verb, already] of [['promote', 'promote', 'promoted to admin', true], ['demote', 'demote', 'demoted to member', false]]) {
    def(name, { cat: 'group', group: true, admin: true, botAdmin: true, usage: `${name} @user | reply`, desc: `${name === 'promote' ? 'Make' : 'Remove admin from'} a member.` }, async ctx => {
      const { found } = await resolve(ctx);
      const list = found.filter(p => isAdminP(p) !== already && p.admin !== 'superadmin');
      if (!list.length) throw new UserError(found.length ? `They are already ${already ? 'admins' : 'regular members'}.` : 'Mention or reply to a member.');
      await ctx.sock.groupParticipantsUpdate(ctx.chat, list.map(p => p.id), action);
      await ctx.send({ text: ctx.frame(`${already ? '⬆️' : '⬇️'} ${list.map(p => '@' + jidUser(p.id)).join(', ')} ${verb}`), mentions: list.map(p => p.id) }, { quoted: ctx.msg });
    });
  }

  /* ------------------------------------------------------------------ */
  /* group info & links                                                   */
  /* ------------------------------------------------------------------ */
  def('ginfo', { cat: 'group', heavy: true, usage: 'ginfo [invite link]', desc: 'Show details about this group or about a group invite link.' }, async ctx => {
    const code = (ctx.args.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/) || [])[1];
    let g;
    if (code) g = await ctx.sock.groupGetInviteInfo(code);
    else if (ctx.isGroup) g = await ctx.group(true);
    else throw new UserError('Use this in a group, or give an invite link.');
    const admins = (g.participants || []).filter(isAdminP).length;
    const lines = [
      `📛 ${bold('Name')}: ${g.subject}`, `🆔 ${bold('ID')}: ${g.id}`,
      `👥 ${bold('Members')}: ${g.size ?? g.participants?.length ?? '-'}`,
      g.participants ? `🛡️ ${bold('Admins')}: ${admins}` : null,
      g.owner ? `👑 ${bold('Owner')}: +${jidUser(g.ownerPn || g.owner)}` : null,
      g.creation ? `📅 ${bold('Created')}: ${new Date(g.creation * 1000).toDateString()}` : null,
      `🔒 ${bold('Only admins can send')}: ${g.announce ? 'yes' : 'no'}`,
      g.desc ? `\n📝 ${g.desc}` : null
    ].filter(Boolean);
    await ctx.reply(lines.join('\n'), { title: 'Group info' });
  });

  def('invite', { cat: 'group', group: true, admin: true, botAdmin: true, desc: 'Get this group\'s invite link.' }, async ctx => {
    await ctx.reply('https://chat.whatsapp.com/' + await ctx.sock.groupInviteCode(ctx.chat), { title: 'Invite link' });
  });
  def('revoke', { cat: 'group', group: true, admin: true, botAdmin: true, desc: 'Reset the invite link (the old one stops working).' }, async ctx => {
    const code = await ctx.sock.groupRevokeInvite(ctx.chat);
    await ctx.reply('♻️ Link reset.\nhttps://chat.whatsapp.com/' + code, { title: 'New invite link' });
  });
  def('join', { cat: 'group', owner: true, usage: 'join <invite link>', desc: 'Make the bot join a group.' }, async ctx => {
    const code = (ctx.input().match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/) || [])[1];
    if (!code) throw new UserError('Send a group invite link.');
    await ctx.sock.groupAcceptInvite(code);
    await ctx.reply('✅ Joined the group.');
  });
  def('gpp', { cat: 'group', group: true, admin: true, botAdmin: true, heavy: true, usage: 'gpp [full] (reply to an image)', desc: 'Set the group picture. Add "full" to avoid cropping.' }, async ctx => {
    const m = await ctx.needMedia('image');
    let img = m.buffer;
    if (/full/i.test(ctx.args)) img = await U.sharp()(img).rotate().resize(720, 720, { fit: 'contain', background: '#000000' }).jpeg({ quality: 92 }).toBuffer();
    await ctx.sock.updateProfilePicture(ctx.chat, img);
    await ctx.reply('✅ Group picture updated.');
  });
  def('gstatus', { cat: 'group', group: true, heavy: true, usage: 'gstatus <text> (or reply to a photo/video)', desc: 'Post a text, photo or video status to this group. Anyone can run it — you do not need to be a group admin.' }, async ctx => {
    const text = ctx.input().trim();
    let m;
    try { m = await ctx.media(); }
    catch (error) {
      throw new UserError(`Could not download the replied media: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
    if (!text && !m) throw new UserError('Write status text, or send/reply to a photo or video.');
    if (m && !['image', 'video'].includes(m.kind)) throw new UserError('Group statuses support text, photos, or videos. Reply to a photo/video, or send text.');

    // The only thing that stops a non-admin is WhatsApp itself: in a group set to "only admins can send
    // messages" every non-admin message is rejected, status included. Say so up front instead of failing late.
    if (typeof ctx.group === 'function' && typeof ctx.botAdmin === 'function') {
      try {
        const meta = await ctx.group();
        if (meta?.announce && !(await ctx.botAdmin())) {
          throw new UserError('This group only lets admins send messages, and the linked account is not an admin, so WhatsApp will not accept a status from it. Ask an admin to open the group to everyone (or make the account an admin) and try again.');
        }
      } catch (e) { if (e instanceof UserError) throw e; /* metadata lookup failed — just try posting */ }
    }

    const bl = ctx.baileys;
    try {
      const inner = m
        ? await bl.generateWAMessageContent(
          { [m.kind]: m.buffer, caption: text || m.caption || '' },
          { upload: ctx.sock.waUploadToServer, mediaUploadTimeoutMs: 120000, logger: ctx.logger, jid: ctx.chat }
        )
        : { extendedTextMessage: { text } };
      // WhatsApp ties a group status to a per-message secret, present on both the wrapper and the inner
      // message. Without it the status is silently not shown (this was the missing piece before 3.6.3).
      const messageSecret = crypto.randomBytes(32);
      inner.messageContextInfo = { ...(inner.messageContextInfo || {}), messageSecret };
      const statusMessage = bl.proto.Message.fromObject({
        messageContextInfo: { messageSecret },
        groupStatusMessageV2: { message: inner }
      });
      if (!statusMessage?.groupStatusMessageV2) {
        throw new Error('This Baileys build has no groupStatusMessageV2 support — run "npm update @whiskeysockets/baileys" and restart.');
      }
      const full = bl.generateWAMessageFromContent(ctx.chat, statusMessage, { userJid: ctx.sock.user?.id });
      await ctx.sock.relayMessage(ctx.chat, full.message, { messageId: full.key.id });
      await ctx.react('✅');
    } catch (e) {
      const detail = String(e?.message || e).replace(/\s+/g, ' ').slice(0, 180);
      ctx.logger?.warn?.({ command: 'gstatus', error: detail, status: e?.output?.statusCode || e?.statusCode }, 'Group status post failed');
      if (e?.output?.statusCode === 403 || e?.statusCode === 403 || /forbidden|not.?authorized|admin.*required|not.?admin|permission denied/i.test(detail)) {
        throw new UserError('❌ WhatsApp refused this group status. You do not need to be a group admin to run the command, but the group must allow the linked account to post (check that members are allowed to send messages). Group restrictions cannot be bypassed.');
      }
      throw new UserError('❌ Could not post the group status: ' + detail);
    }
  });

  /* ------------------------------------------------------------------ */
  /* tagging                                                              */
  /* ------------------------------------------------------------------ */
  def('tag', { cat: 'group', group: true, admin: true, usage: 'tag all | tag admins | tag <text> | reply + tag', desc: 'Mention everyone (all), admins only, or send a hidden-tag message.' }, async ctx => {
    const meta = await ctx.group();
    const ids = meta.participants.map(p => p.id);
    const a = ctx.argv[0]?.toLowerCase();
    if (a === 'all' || a === 'everyone') {
      const note = ctx.args.slice(a.length).trim() || '📢 Attention everyone!';
      return ctx.send({ text: `${note}\n\n${ids.map(i => '@' + jidUser(i)).join('\n')}`, mentions: ids }, { quoted: ctx.msg });
    }
    if (a === 'admins' || a === 'admin') {
      const ad = meta.participants.filter(isAdminP).map(p => p.id);
      return ctx.send({ text: `🛡️ ${bold('Admins')}\n\n${ad.map(i => '@' + jidUser(i)).join('\n')}`, mentions: ad }, { quoted: ctx.msg });
    }
    const m = ctx.quoted ? await ctx.media().catch(() => null) : null;
    if (m && ['image', 'video', 'audio', 'sticker'].includes(m.kind)) {
      const base = { mentions: ids };
      const c = m.kind === 'image' ? { image: m.buffer, caption: ctx.args || m.caption || '' }
        : m.kind === 'video' ? { video: m.buffer, caption: ctx.args || m.caption || '' }
          : m.kind === 'audio' ? { audio: m.buffer, mimetype: m.mime || 'audio/mpeg', ptt: m.ptt } : { sticker: m.buffer };
      return ctx.send({ ...c, ...base });
    }
    const text = ctx.args || ctx.textOf(ctx.quoted?.message) || '📢';
    await ctx.send({ text, mentions: ids });
  });

  /* ------------------------------------------------------------------ */
  /* mute / unmute                                                        */
  /* ------------------------------------------------------------------ */
  def('mute', { cat: 'group', group: true, admin: true, botAdmin: true, usage: 'mute [minutes]', desc: 'Only admins can send messages. Add minutes to unmute automatically.' }, async ctx => {
    await ctx.sock.groupSettingUpdate(ctx.chat, 'announcement');
    const mins = Number(ctx.argv[0]);
    if (mins > 0) {
      ctx.update('unmuteAt', {}, o => { o[ctx.chat] = Date.now() + mins * 60000; });
      return ctx.reply(`🔇 Group muted for ${mins} minute(s). Only admins can send messages.`);
    }
    await ctx.reply('🔇 Group muted. Only admins can send messages.');
  });
  for (const [name, setting, emoji, text] of [['open', 'not_announcement', '🔓', 'Group opened — everyone can send messages.'], ['close', 'announcement', '🔒', 'Group closed — only admins can send messages.']]) {
    def(name, { cat: 'group', group: true, admin: true, botAdmin: true, usage: name === 'close' ? 'close [minutes]' : 'open', desc: name === 'open' ? 'Open the group so everyone can send messages.' : 'Close the group so only admins can send messages (add minutes to reopen automatically).' }, async ctx => {
      await ctx.sock.groupSettingUpdate(ctx.chat, setting);
      const mins = name === 'close' ? Number(ctx.argv[0]) : 0;
      if (mins > 0) ctx.update('unmuteAt', {}, o => { o[ctx.chat] = Date.now() + mins * 60000; });
      else ctx.update('unmuteAt', {}, o => { delete o[ctx.chat]; });
      await ctx.reply(`${emoji} ${text}${mins > 0 ? `\n⏱ It reopens automatically in ${mins} minute(s).` : ''}`);
    });
  }
  def('unmute', { cat: 'group', group: true, admin: true, botAdmin: true, desc: 'Allow everyone to send messages.' }, async ctx => {
    await ctx.sock.groupSettingUpdate(ctx.chat, 'not_announcement');
    ctx.update('unmuteAt', {}, o => { delete o[ctx.chat]; });
    await ctx.reply('🔊 Group unmuted. Everyone can send messages.');
  });
  for (const [name, setting, text] of [['amute', 'amute', 'mute'], ['aunmute', 'aunmute', 'unmute']]) {
    def(name, { cat: 'group', group: true, admin: true, usage: `${name} HH:MM | ${name} off`, desc: `Automatically ${text} the group every day at a set time (bot timezone).` }, async ctx => {
      const key = `${setting}:${ctx.chat}`;
      const a = ctx.argv[0];
      if (!a) { const t = ctx.get(key, null); return ctx.reply(t ? `⏰ Auto-${text} is set for *${t}* daily (${ctx.tz()}).` : `Not set. Use *${ctx.var('PREFIX')}${name} 22:00*`); }
      if (/^off$/i.test(a)) { ctx.del(key); return ctx.reply(`⏰ Auto-${text} removed.`); }
      const m = a.match(/^(\d{1,2}):(\d{2})$/);
      if (!m || +m[1] > 23 || +m[2] > 59) throw new UserError('Use 24-hour time like *22:30*');
      ctx.set(key, `${m[1].padStart(2, '0')}:${m[2]}`);
      await ctx.reply(`⏰ The group will be ${text}d every day at *${m[1].padStart(2, '0')}:${m[2]}* (${ctx.tz()}).${await ctx.botAdmin() ? '' : '\n⚠️ I must be an admin for this to work.'}`);
    });
  }

  /* ------------------------------------------------------------------ */
  /* warnings                                                             */
  /* ------------------------------------------------------------------ */
  def('warn', { cat: 'group', group: true, admin: true, usage: 'warn @user [reason] | warn list', desc: 'Warn a member; they are removed after WARN_LIMIT warnings (default 3).' }, async ctx => {
    const limit = Number(ctx.var('WARN_LIMIT')) || 3;
    if (/^list$/i.test(ctx.argv[0] || '')) {
      const w = Object.entries(ctx.get('warns:' + ctx.chat, {}));
      return ctx.reply(w.length ? w.map(([u, n]) => `+${u}: ${n}/${limit}`).join('\n') : 'No warnings yet.', { title: 'Warnings' });
    }
    const { found } = await resolve(ctx, { allowAdmins: false });
    if (!found.length) throw new UserError('Mention or reply to a non-admin member to warn.');
    if (!(await ctx.botAdmin())) throw new UserError('Make me admin so I can remove members who reach the limit.');
    const p = found[0];
    const r = await addWarn(ctx, ctx.chat, p.id);
    const reason = ctx.args.replace(/@\d+/g, '').replace(/\+?\d{7,}/g, '').trim();
    await ctx.send({
      text: ctx.frame(r.kicked ? `🚫 @${jidUser(p.id)} reached ${r.limit}/${r.limit} warnings and was removed.` : `⚠️ @${jidUser(p.id)} warned (${r.n}/${r.limit})${reason ? `\n📝 ${reason}` : ''}`),
      mentions: [p.id]
    }, { quoted: ctx.msg });
  });
  def('reset', { cat: 'group', group: true, admin: true, usage: 'reset @user | reset all', desc: 'Reset warnings for a member or for everyone.' }, async ctx => {
    if (/^all$/i.test(ctx.argv[0] || '')) { ctx.del('warns:' + ctx.chat); return ctx.reply('♻️ All warnings cleared.'); }
    const { found } = await resolve(ctx, { allowAdmins: true });
    if (!found.length) throw new UserError('Mention or reply to a member, or use *reset all*.');
    ctx.update('warns:' + ctx.chat, {}, w => { for (const p of found) for (const i of pids(p)) delete w[i]; });
    await ctx.reply(`♻️ Warnings cleared for ${found.map(label).join(', ')}.`);
  });

  /* ------------------------------------------------------------------ */
  /* protections                                                          */
  /* ------------------------------------------------------------------ */
  const MODES = { on: 'delete', delete: 'delete', warn: 'warn', kick: 'kick', off: 'off' };
  function guard(name, desc, defaults, extra) {
    def(name, { cat: 'group', group: true, admin: true, usage: `${name} on|off|warn|kick`, desc }, async ctx => {
      const key = `${name}:${ctx.chat}`;
      const cfg = { mode: 'off', ...defaults, ...ctx.get(key, {}) };
      const a = ctx.argv[0]?.toLowerCase();
      if (!a) return ctx.reply(`🛡️ ${bold(name)} is *${cfg.mode.toUpperCase()}*${extra?.show ? '\n' + extra.show(cfg) : ''}\n\nUse: ${name} on | warn | kick | off${extra?.help ? '\n' + extra.help : ''}`);
      let changed = false;
      if (MODES[a]) { cfg.mode = MODES[a]; changed = true; }
      else if (extra?.handle) { const r = extra.handle(ctx, cfg, a); if (r === undefined) throw new UserError(`Unknown option. Try: ${name} on | warn | kick | off${extra.help ? ' | ' + extra.help : ''}`); changed = true; }
      else throw new UserError(`Use: ${name} on | warn | kick | off`);
      if (changed) ctx.set(key, cfg);
      await ctx.reply(`🛡️ ${bold(name)} is now *${cfg.mode.toUpperCase()}*${cfg.mode !== 'off' && !(await ctx.botAdmin()) ? '\n⚠️ I must be a group admin to enforce this.' : ''}${extra?.show ? '\n' + extra.show(cfg) : ''}${cfg.mode !== 'off' ? `\nℹ️ Group admins and the bot owner are never touched, so test it with a normal member\'s account. Check everything with *${ctx.var('PREFIX')}groupcheck*.` : ''}`);
    });
  }
  guard('antilink', 'Delete (or warn/kick for) links posted by non-admins.', { allow: [] }, {
    help: 'allow <domain> | disallow <domain>',
    show: c => (c.allow?.length ? `✅ Allowed: ${c.allow.join(', ')}` : ''),
    handle: (ctx, c, a) => {
      const d = ctx.argv[1]?.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (a === 'allow' && d) { c.allow = [...new Set([...(c.allow || []), d])]; return true; }
      if (a === 'disallow' && d) { c.allow = (c.allow || []).filter(x => x !== d); return true; }
    }
  });
  guard('antiword', 'Delete (or warn/kick for) banned words used by non-admins.', { words: [] }, {
    help: 'add w1,w2 | remove w | list',
    show: c => (c.words?.length ? `🚫 Words: ${c.words.join(', ')}` : 'No banned words yet.'),
    handle: (ctx, c, a) => {
      const list = ctx.args.slice(a.length).split(/[,\n]/).map(x => x.trim().toLowerCase()).filter(Boolean);
      if (a === 'add' && list.length) { c.words = [...new Set([...(c.words || []), ...list])]; return true; }
      if (a === 'remove' && list.length) { c.words = (c.words || []).filter(w => !list.includes(w)); return true; }
      if (a === 'list') return true;
    }
  });
  guard('antispam', 'Act on members who send too many messages too fast.', { limit: 6, window: 10 }, {
    help: 'limit <messages> <seconds>',
    show: c => `⏱ Limit: ${c.limit} messages / ${c.window}s`,
    handle: (ctx, c, a) => {
      if (a !== 'limit') return undefined;
      const n = Number(ctx.argv[1]), s = Number(ctx.argv[2]);
      if (!(n >= 2 && n <= 50 && s >= 2 && s <= 120)) throw new UserError('Example: *antispam limit 6 10* (6 messages in 10 seconds)');
      c.limit = n; c.window = s; return true;
    }
  });
  guard('antigm', 'Act on mass-mentions and group-mention status spam from non-admins.', {});
  guard('antigstatus', 'Delete group status posts from non-admins.', {});
  guard('antimedia', 'Delete photos, videos, audio and documents sent by non-admins.', {});
  guard('antisticker', 'Delete stickers sent by non-admins.', {});
  guard('antibot', 'Act on messages that come from other bots (detected by their message id pattern; best effort).', {});
  guard('antifake', 'Remove new members whose number is not from allowed country codes.', { codes: [] }, {
    help: 'codes 254,255',
    show: c => (c.codes?.length ? `🌍 Allowed codes: ${c.codes.join(', ')}` : '⚠️ No country codes set yet — use: antifake codes 254'),
    handle: (ctx, c, a) => {
      if (a !== 'codes') return undefined;
      const codes = (ctx.argv[1] || '').split(',').map(x => x.replace(/\D/g, '')).filter(Boolean);
      if (!codes.length) throw new UserError('Example: *antifake codes 254,255*');
      c.codes = codes; return true;
    }
  });

  hooks.push({
    name: 'protect', priority: -10, run: async ctx => {
      if (!ctx.isGroup || ctx.fromMe || !ctx.fresh || ctx.chat === 'status@broadcast') return false;
      const gid = ctx.chat;
      const link = ctx.get('antilink:' + gid, null), word = ctx.get('antiword:' + gid, null), spam = ctx.get('antispam:' + gid, null),
        gm = ctx.get('antigm:' + gid, null), gs = ctx.get('antigstatus:' + gid, null),
        am = ctx.get('antimedia:' + gid, null), as = ctx.get('antisticker:' + gid, null), ab = ctx.get('antibot:' + gid, null);
      const on = c => c && c.mode && c.mode !== 'off';
      if (!(on(link) || on(word) || on(spam) || on(gm) || on(gs) || on(am) || on(as) || on(ab))) return false;

      let hit = null, mode = null;
      const text = ctx.text || '';
      if (on(spam)) {
        const k = gid + ctx.senderNum;
        const arr = (ctx.rt.spam.get(k) || []).filter(t => Date.now() - t < spam.window * 1000);
        arr.push(Date.now());
        ctx.rt.spam.set(k, arr);
        if (arr.length > spam.limit) { hit = 'spam'; mode = spam.mode; ctx.rt.spam.delete(k); }
      }
      if (!hit && on(link) && LINK_RE.test(text)) {
        const urls = text.match(/(?:https?:\/\/|www\.)[^\s/]+|chat\.whatsapp\.com|wa\.me/gi) || [];
        const allowed = (link.allow || []).length && urls.every(u => link.allow.some(a => u.toLowerCase().includes(a)));
        if (!allowed) { hit = 'link'; mode = link.mode; }
      }
      if (!hit && on(word) && word.words?.length) {
        const low = text.toLowerCase();
        if (word.words.some(w => new RegExp(`(^|[^\\p{L}\\p{N}])${U.escRe(w)}($|[^\\p{L}\\p{N}])`, 'iu').test(low))) { hit = 'banned word'; mode = word.mode; }
      }
      if (!hit && on(gm)) {
        const meta = await ctx.group().catch(() => null);
        const big = ctx.mentioned.length >= 10 || (meta && ctx.mentioned.length >= Math.max(5, meta.participants.length * 0.5));
        if (big || ctx.content?.groupStatusMentionMessage || ctx.content?.groupMentionedMessage) { hit = 'mass mention'; mode = gm.mode; }
      }
      if (!hit && on(gs) && (ctx.content?.groupStatusMessageV2 || ctx.content?.groupStatusMessage || ctx.content?.groupStatusMentionMessage)) { hit = 'group status'; mode = gs.mode; }
      if (!hit && on(am) && (ctx.content?.imageMessage || ctx.content?.videoMessage || ctx.content?.audioMessage || ctx.content?.documentMessage)) { hit = 'media'; mode = am.mode; }
      if (!hit && on(as) && ctx.content?.stickerMessage) { hit = 'sticker'; mode = as.mode; }
      if (!hit && on(ab) && /^(BAE5|BAEB|LAXO|SUKI)/.test(String(ctx.key?.id || ''))) { hit = 'bot message'; mode = ab.mode; }
      if (!hit) return false;

      if (ctx.isOwner || await ctx.admin()) return false;
      if (!(await ctx.botAdmin())) {
        // the most common reason a guard "does nothing": say so (at most once every 10 minutes per group)
        if (ctx.cooldown(600, 'guard-noadmin:' + gid)) await ctx.send({ text: ctx.frame(`⚠️ I spotted a ${hit} from @${jidUser(ctx.key.participant)}, but I am not a group admin so I cannot remove it. Please make me an admin for the protections to work.`), mentions: [ctx.key.participant] }).catch(() => {});
        return false;
      }
      await ctx.sock.sendMessage(gid, { delete: ctx.key }).catch(() => {});
      const user = ctx.key.participant;
      if (mode === 'kick') {
        await ctx.sock.groupParticipantsUpdate(gid, [user], 'remove').catch(() => {});
        await ctx.send({ text: ctx.frame(`🚫 @${jidUser(user)} was removed for ${hit}.`), mentions: [user] });
      } else if (mode === 'warn') {
        const r = await addWarn(ctx, gid, user).catch(() => null);
        if (r) await ctx.send({ text: ctx.frame(r.kicked ? `🚫 @${jidUser(user)} reached the warning limit (${hit}) and was removed.` : `⚠️ @${jidUser(user)} — ${hit} is not allowed here. Warning ${r.n}/${r.limit}.`), mentions: [user] });
      } else if (hit !== 'spam' || ctx.cooldown(20, 'spamnote')) {
        await ctx.send({ text: ctx.frame(`🛡️ @${jidUser(user)}'s message was removed (${hit}).`), mentions: [user] });
      }
      return true;
    }
  });

  /* ------------------------------------------------------------------ */
  /* welcome / goodbye / pdm / antifake events                            */
  /* ------------------------------------------------------------------ */
  const DEFAULT_WELCOME = '👋 Welcome {user} to *{group}*!\nYou are member #{count}.\n\n{desc}';
  const DEFAULT_GOODBYE = '👋 Goodbye {user}. We will miss you!';
  for (const [name, key, dflt] of [['welcome', 'welcome', DEFAULT_WELCOME], ['goodbye', 'goodbye', DEFAULT_GOODBYE]]) {
    def(name, { cat: 'group', group: true, admin: true, usage: `${name} on | off | <your text>`, desc: `Set the ${name} message. Placeholders: {user} {group} {count} {desc}.` }, async ctx => {
      const k = `${key}:${ctx.chat}`;
      const cfg = ctx.get(k, { on: false, text: dflt });
      const a = ctx.args.trim();
      if (!a) return ctx.reply(`${name} is *${cfg.on ? 'ON' : 'OFF'}*\n\n${bold('Message')}:\n${cfg.text}\n\nUse: ${name} on | off | <text>`);
      if (/^on$/i.test(a)) cfg.on = true;
      else if (/^off$/i.test(a)) cfg.on = false;
      else if (/^reset$/i.test(a)) { cfg.text = dflt; cfg.on = true; }
      else { cfg.text = a; cfg.on = true; }
      ctx.set(k, cfg);
      await ctx.reply(`${name} is now *${cfg.on ? 'ON' : 'OFF'}*.`);
    });
  }
  def('pdm', { cat: 'group', group: true, admin: true, usage: 'pdm on|off', desc: 'Announce promotions and demotions in the group.' }, async ctx => {
    const a = ctx.argv[0]?.toLowerCase();
    if (!['on', 'off'].includes(a)) return ctx.reply(`PDM is *${ctx.get('pdm:' + ctx.chat, false) ? 'ON' : 'OFF'}*. Use *${ctx.var('PREFIX')}pdm on|off*.`);
    ctx.set('pdm:' + ctx.chat, a === 'on');
    await ctx.reply(`📣 Promote/demote announcements are *${a.toUpperCase()}*.`);
  });

  events.push({
    name: 'group-participants.update', run: async (api, ev) => {
      const gid = ev.id;
      const list = (ev.participants || []).map(p => (typeof p === 'string' ? { id: p } : p));
      if (!list.length) return;
      const meta = await api.groupMeta(gid, true).catch(() => null);
      const fill = (t, jid) => t.replace(/\{user\}/g, '@' + jidUser(jid)).replace(/\{group\}/g, meta?.subject || 'the group').replace(/\{count\}/g, String(meta?.participants?.length ?? '')).replace(/\{desc\}/g, meta?.desc || '');

      if (ev.action === 'add') {
        const fake = api.get('antifake:' + gid, null);
        if (fake?.mode && fake.mode !== 'off' && fake.codes?.length) {
          const bad = list.filter(p => { const ph = phoneOf(p) || phoneOf(meta?.participants.find(x => pids(x).includes(jidUser(p.id)))); return ph && !fake.codes.some(c => ph.startsWith(c)); });
          if (bad.length) {
            try {
              await api.sock.groupParticipantsUpdate(gid, bad.map(p => p.id), 'remove');
              await api.sendTo(gid, { text: api.frame(`🚫 Removed ${bad.length} member(s) with non-allowed country codes.`) });
            } catch {}
            return;
          }
        }
        const w = api.get('welcome:' + gid, null);
        if (w?.on) for (const p of list) {
          const text = fill(w.text, p.id);
          let pic = null;
          try { pic = await api.sock.profilePictureUrl(p.id, 'image'); } catch {}
          await api.sendTo(gid, pic ? { image: { url: pic }, caption: text, mentions: [p.id] } : { text, mentions: [p.id] }).catch(() => {});
        }
      } else if (ev.action === 'remove') {
        const g = api.get('goodbye:' + gid, null);
        if (g?.on) for (const p of list) await api.sendTo(gid, { text: fill(g.text, p.id), mentions: [p.id] }).catch(() => {});
      } else if ((ev.action === 'promote' || ev.action === 'demote') && api.get('pdm:' + gid, false)) {
        const by = ev.author ? ` by @${jidUser(ev.author)}` : '';
        for (const p of list) await api.sendTo(gid, { text: api.frame(`${ev.action === 'promote' ? '⬆️' : '⬇️'} @${jidUser(p.id)} was ${ev.action}d${by}`), mentions: [p.id, ev.author].filter(Boolean) }).catch(() => {});
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* activity tracking: msgs / inactive / common                          */
  /* ------------------------------------------------------------------ */
  hooks.push({
    name: 'counter', priority: -5, run: async ctx => {
      if (!ctx.isGroup || ctx.fromMe || ctx.chat === 'status@broadcast') return false;
      if (ctx.type === 'protocolMessage' || ctx.type === 'reactionMessage') return false;
      const key = 'msgcount:' + ctx.chat;
      const c = ctx.store.ref(ctx.sid, key, {});
      const id = ctx.senderIds[0];
      if (!id) return false;
      const e = c[id] || (c[id] = { n: 0 });
      e.n++; e.last = Date.now(); if (ctx.name) e.name = ctx.name;
      if (!c._since) c._since = Date.now();
      ctx.rt.dirtyCounts.add(key);
      return false;
    }
  });
  const counts = (ctx, p) => {
    const c = ctx.store.ref(ctx.sid, 'msgcount:' + ctx.chat, {});
    const id = pids(p).find(i => c[i]);
    return id ? c[id] : null;
  };

  def('msgs', { cat: 'group', group: true, usage: 'msgs [@user]', desc: 'Show how many messages members sent (counted since the bot started tracking).' }, async ctx => {
    const meta = await ctx.group();
    const c = ctx.store.ref(ctx.sid, 'msgcount:' + ctx.chat, {});
    const since = c._since ? new Date(c._since).toDateString() : 'now';
    const target = ctx.targets()[0];
    if (target) {
      const p = ctx.participantByJid(meta, target);
      const e = p && counts(ctx, p);
      return ctx.reply(`${label(p || { id: target })}: ${e ? e.n : 0} message(s)\n_(since ${since})_`, { title: 'Messages' });
    }
    const rows = meta.participants.map(p => ({ p, e: counts(ctx, p) })).filter(r => r.e).sort((a, b) => b.e.n - a.e.n).slice(0, 15);
    if (!rows.length) return ctx.reply('No messages counted yet.');
    await ctx.reply(rows.map((r, i) => `${i + 1}. ${r.e.name || label(r.p)} — ${bold(String(r.e.n))}`).join('\n') + `\n\n_Counting since ${since}_`, { title: 'Top chatters' });
  });

  def('inactive', { cat: 'group', group: true, admin: true, usage: 'inactive [days] | inactive kick [days]', desc: 'List (or kick) members with no messages for N days (default 7), counted since tracking started.' }, async ctx => {
    const kick = /^kick$/i.test(ctx.argv[0] || '');
    const days = Number(kick ? ctx.argv[1] : ctx.argv[0]) || 7;
    const meta = await ctx.group(true);
    const c = ctx.store.ref(ctx.sid, 'msgcount:' + ctx.chat, {});
    const since = c._since || Date.now();
    const cutoff = Date.now() - days * 86400000;
    const botIds = ctx.botIds();
    const idle = meta.participants.filter(p => !isAdminP(p) && !pids(p).some(i => botIds.includes(i))).filter(p => { const e = counts(ctx, p); return !e || e.last < cutoff; });
    if (!idle.length) return ctx.reply(`🎉 Nobody has been inactive for ${days}+ days.`);
    const note = Date.now() - since < days * 86400000 ? `\n⚠️ I only started counting ${U.fmtDur((Date.now() - since) / 1000)} ago, so this may include people who were simply not tracked yet.` : '';
    if (!kick) return ctx.send({ text: ctx.frame(`😴 ${idle.length} inactive member(s) (${days}+ days):\n\n${idle.slice(0, 60).map(p => '• ' + label(p)).join('\n')}${note}\n\nUse *${ctx.var('PREFIX')}inactive kick ${days}* to remove them.`) }, { quoted: ctx.msg });
    if (!(await ctx.botAdmin())) throw new UserError('Make me a group admin first.');
    const batch = idle.slice(0, 20);
    await ctx.sock.groupParticipantsUpdate(ctx.chat, batch.map(p => p.id), 'remove');
    await ctx.reply(`👢 Removed ${batch.length} inactive member(s).${idle.length > batch.length ? ` ${idle.length - batch.length} more remain; run it again.` : ''}${note}`);
  });

  def('common', { cat: 'group', group: true, admin: true, heavy: true, usage: 'common <other group JID>', desc: 'List members this group has in common with another group (get JIDs with gjid).' }, async ctx => {
    const other = ctx.argv[0];
    if (!other || !other.endsWith('@g.us')) throw new UserError('Give the other group\'s JID (use *gjid* to list them).');
    const [a, b] = await Promise.all([ctx.group(), ctx.sock.groupMetadata(other).catch(() => null)]);
    if (!b) throw new UserError('I am not in that group.');
    const ids = new Set(b.participants.flatMap(pids));
    const both = a.participants.filter(p => pids(p).some(i => ids.has(i)));
    await ctx.send({ text: ctx.frame(`👥 ${both.length} member(s) in common with *${b.subject}*:\n\n${both.slice(0, 80).map(p => '• ' + label(p)).join('\n')}`) }, { quoted: ctx.msg });
  });

  /* ------------------------------------------------------------------ */
  /* vote                                                                 */
  /* ------------------------------------------------------------------ */
  def('vote', { cat: 'group', group: true, usage: 'vote <question> • vote yes|no • vote result • vote end', desc: 'Start a yes/no vote in the group.' }, async ctx => {
    const v = ctx.rt.votes.get(ctx.chat);
    const a = (ctx.argv[0] || '').toLowerCase();
    const tally = x => `✅ Yes: ${x.yes.size}\n❌ No: ${x.no.size}`;
    if (['yes', 'no'].includes(a)) {
      if (!v) throw new UserError('There is no vote running. Start one with *vote <question>*.');
      v.yes.delete(ctx.senderNum); v.no.delete(ctx.senderNum);
      v[a].add(ctx.senderNum);
      return ctx.react(a === 'yes' ? '✅' : '❌');
    }
    if (a === 'result' || a === 'end') {
      if (!v) throw new UserError('There is no vote running.');
      if (a === 'end') {
        if (!ctx.isOwner && ctx.senderNum !== v.by && !(await ctx.admin())) throw new UserError('Only the starter or an admin can end the vote.');
        ctx.rt.votes.delete(ctx.chat);
      }
      return ctx.reply(`🗳️ ${bold(v.q)}\n\n${tally(v)}${a === 'end' ? '\n\n🏁 Voting closed.' : ''}`, { title: 'Vote' });
    }
    if (!ctx.args) throw new UserError(`Start with *${ctx.var('PREFIX')}vote Should we change the rules?*`);
    if (v) throw new UserError('A vote is already running. Use *vote end* first.');
    if (!ctx.isOwner && !(await ctx.admin())) throw new UserError('Only admins can start a vote.');
    ctx.rt.votes.set(ctx.chat, { q: ctx.args, yes: new Set(), no: new Set(), by: ctx.senderNum });
    await ctx.reply(`🗳️ ${bold(ctx.args)}\n\nReply with:\n*${ctx.var('PREFIX')}vote yes* or *${ctx.var('PREFIX')}vote no*\n\nAdmins: *${ctx.var('PREFIX')}vote end* to close.`, { title: 'New vote' });
  });

  /* ------------------------------------------------------------------ */
  /* timers: scheduled mute/unmute, timed mute, count flush               */
  /* ------------------------------------------------------------------ */
  tickers.push({
    name: 'groupTimers', run: async api => {
      const p = api.U.tzParts(api.tz());
      const minute = `${p.iso} ${p.time}`;
      if (api.rt.lastMinute !== minute) {
        api.rt.lastMinute = minute;
        for (const [prefix, setting, msg] of [['amute:', 'announcement', '🔇 Scheduled mute: only admins can send messages now.'], ['aunmute:', 'not_announcement', '🔊 Scheduled unmute: everyone can send messages now.']]) {
          for (const k of api.keys(prefix)) {
            if (api.get(k) !== p.time) continue;
            const gid = k.slice(prefix.length);
            try { await api.sock.groupSettingUpdate(gid, setting); await api.sendTo(gid, { text: api.frame(msg) }); } catch {}
          }
        }
      }
      const um = api.get('unmuteAt', {});
      const due = Object.entries(um).filter(([, t]) => Date.now() >= t);
      if (due.length) {
        for (const [gid] of due) { try { await api.sock.groupSettingUpdate(gid, 'not_announcement'); await api.sendTo(gid, { text: api.frame('🔊 Mute time is over. Everyone can send messages again.') }); } catch {} }
        api.update('unmuteAt', {}, o => { for (const [g] of due) delete o[g]; });
      }
      if (Date.now() - (api.rt.countFlush || 0) > 60000) {
        api.rt.countFlush = Date.now();
        for (const k of api.rt.dirtyCounts) api.store.touch(api.sid, k);
        api.rt.dirtyCounts.clear();
      }
    }
  });
};
