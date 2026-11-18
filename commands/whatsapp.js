'use strict';
const U = require('../lib/util');
const { UserError, bold } = U;
const { STATUS_EMOJIS } = require('../lib/dashboard-automations');

const viewOnceMedia = async ctx => {
  const quotedId = ctx.quoted?.key?.id;
  // 1. If already buffered in voCache, return instantly
  if (quotedId && ctx.rt?.voCache?.has(quotedId)) {
    return ctx.rt.voCache.get(quotedId);
  }
  // 2. Try ctx.media() which unwraps and inspects quoted message
  try {
    const m = await ctx.media();
    if (m && ['image', 'video', 'audio'].includes(m.kind)) return m;
  } catch (err) {
    ctx.logger?.debug?.({ error: err?.message, quotedId }, 'ctx.media() for view-once deferred to cache fallback');
  }
  // 3. Fall back to cached original message in msgCache
  if (quotedId && ctx.rt?.msgCache?.has(quotedId)) {
    const cached = ctx.rt.msgCache.get(quotedId);
    if (cached?.mediaResult) return cached.mediaResult;
    if (cached?.message) {
      try {
        const u = ctx.unwrap(cached.message);
        const t = ctx.mediaTypeOf(u);
        if (t && u[t]) {
          const node = u[t];
          if (node.directPath && !node.url) node.url = 'https://mmg.whatsapp.net' + node.directPath;
          const buffer = await ctx.download({ key: cached.key || ctx.quoted.key, message: cached.message });
          let kind = t.replace('Message', '');
          const mime = node.mimetype || '';
          if (kind === 'document') { const major = mime.split('/')[0]; if (['image', 'video', 'audio'].includes(major)) kind = major; }
          const res = { buffer, mime, kind, node, ptt: Boolean(node.ptt), name: node.fileName, caption: node.caption, animated: Boolean(node.isAnimated), seconds: node.seconds };
          ctx.rt.voCache ||= new Map();
          ctx.rt.voCache.set(quotedId, res);
          return res;
        }
      } catch (e) {
        ctx.logger?.warn?.({ error: e?.message, quotedId }, 'Fallback download from cached view-once message failed');
      }
    }
  }
  throw new UserError('Could not retrieve this view-once media. I can only open view-once messages that arrived while the bot was online (the copy is kept in memory, so a bot restart clears it). Reply directly to the view-once photo, video or voice note, and ask the sender to resend it if it came before the bot started.');
};

module.exports = ({ def, hooks, events, tickers }) => {
  /* ---------- anti-edit ---------- */
  def('antiedit', { cat: 'whatsapp', owner: true, usage: 'antiedit on|off', desc: 'Get a private notice when someone edits a message (shows before/after).' }, async ctx => {
    const a = ctx.argv[0]?.toLowerCase();
    if (!['on', 'off'].includes(a)) return ctx.reply(`Anti-edit is *${ctx.get('antiedit', false) ? 'ON' : 'OFF'}*. Use *${ctx.var('PREFIX')}antiedit on|off*.`);
    ctx.set('antiedit', a === 'on');
    await ctx.reply(`✏️ Anti-edit is now *${a.toUpperCase()}*. Notices are sent to your own chat.`);
  });
  hooks.push({
    name: 'antiedit', run: async ctx => {
      const pm = ctx.content?.protocolMessage;
      if (!pm?.editedMessage || !pm.key?.id) return false;
      if (!ctx.get('antiedit', false) || ctx.fromMe) return true;
      const prev = ctx.rt.msgCache.get(pm.key.id);
      const next = ctx.textOf(ctx.unwrap(pm.editedMessage));
      if (prev && next && prev.text !== next) {
        const where = ctx.isGroup ? 'in a group' : 'in a private chat';
        await ctx.sendTo(ctx.ownerJid, { text: ctx.frame(`✏️ ${bold('Message edited')} ${where}\n👤 +${ctx.senderNum}\n\n${bold('Before')}:\n${prev.text}\n\n${bold('After')}:\n${next}`) });
      }
      if (next) ctx.rt.msgCache.set(pm.key.id, { ...(prev || { sender: ctx.sender, chat: ctx.chat }), text: next, at: Date.now() });
      return true;
    }
  });

  /* ---------- anti-call ---------- */
  def('call', { cat: 'whatsapp', owner: true, usage: 'call on|off|block|msg <text>', desc: 'Auto-reject incoming calls (on), also block callers (block), or set the reply message.' }, async ctx => {
    const cfg = ctx.get('anticall', { on: false, block: false, msg: '📵 Calls are not allowed. Please send a message instead.' });
    const a = ctx.argv[0]?.toLowerCase();
    if (a === 'on') { cfg.on = true; cfg.block = false; }
    else if (a === 'block') { cfg.on = true; cfg.block = true; }
    else if (a === 'off') cfg.on = false;
    else if (a === 'msg' && ctx.argv[1]) cfg.msg = ctx.args.slice(3).trim();
    else return ctx.reply(`Call guard: *${cfg.on ? (cfg.block ? 'REJECT + BLOCK' : 'REJECT') : 'OFF'}*\nMessage: ${cfg.msg}\n\nUse: call on | call block | call off | call msg <text>`);
    ctx.set('anticall', cfg);
    await ctx.reply(`📵 Call guard: *${cfg.on ? (cfg.block ? 'reject + block' : 'reject') : 'off'}*`);
  });
  events.push({
    name: 'call', run: async (api, calls) => {
      const cfg = api.get('anticall', null);
      if (!cfg?.on) return;
      for (const c of calls) {
        if (c.status !== 'offer' || !c.id || !c.from) continue;
        try { await api.sock.rejectCall(c.id, c.from); } catch {}
        try { await api.sendTo(c.chatId || c.from, { text: cfg.msg }); } catch {}
        if (cfg.block) { try { await api.sock.updateBlockStatus(c.from, 'block'); } catch {} }
      }
    }
  });

  /* ---------- media tools ---------- */
  def('caption', { cat: 'whatsapp', heavy: true, usage: 'caption <text> (reply to media)', desc: 'Re-send replied media with a new caption.' }, async ctx => {
    const m = await ctx.needMedia(['image', 'video']);
    if (!ctx.args) throw new UserError('Write the new caption after the command.');
    await (m.kind === 'image' ? ctx.image(m.buffer, ctx.args) : ctx.video(m.buffer, ctx.args));
  });
  def('doc', { cat: 'whatsapp', heavy: true, usage: 'doc [file name] (reply to media or text)', desc: 'Send replied media or text as a document file.' }, async ctx => {
    const m = await ctx.media().catch(() => null);
    if (m) {
      const ext = (m.mime.split('/')[1] || 'bin').split(';')[0].replace('jpeg', 'jpg');
      const name = ctx.args || m.name || `file.${ext}`;
      return ctx.doc(m.buffer, /\.\w+$/.test(name) ? name : `${name}.${ext}`, m.mime || 'application/octet-stream');
    }
    const t = ctx.textOf(ctx.quoted?.message);
    if (!t) throw new UserError('Reply to media or a text message.');
    await ctx.doc(Buffer.from(t, 'utf8'), (ctx.args || 'note') + (/\.\w+$/.test(ctx.args) ? '' : '.txt'), 'text/plain');
  });
  def('vv', { cat: 'whatsapp', heavy: true, usage: 'vv [me] (reply to a view-once)', desc: 'Reveal a view-once photo/video/voice note (add "me" to get it privately).' }, async ctx => {
    if (!ctx.quoted) throw new UserError('Reply to a view-once message.');
    const m = await viewOnceMedia(ctx);
    const wantPrivate = /\bme\b/i.test(ctx.args);
    const to = wantPrivate ? (ctx.isOwner ? ctx.ownerJid : (ctx.sender || ctx.chat)) : ctx.chat;
    const caption = m.caption ? `👁️ ${bold('View-Once')}\n${m.caption}` : `👁️ ${bold('View-Once Revealed')}`;
    const content = m.kind === 'image'
      ? { image: m.buffer, caption }
      : m.kind === 'video'
        ? { video: m.buffer, caption }
        : { audio: m.buffer, mimetype: m.mime || 'audio/ogg; codecs=opus', ptt: m.ptt };
    await ctx.sendTo(to, content, to === ctx.chat ? { quoted: ctx.msg } : undefined);
    if (wantPrivate && ctx.chat !== to) await ctx.react('📥');
  });
  def('vv2', { cat: 'whatsapp', owner: true, heavy: true, usage: 'vv2 (reply to a view-once)', desc: 'Reveal a view-once photo/video/voice note straight to your own private chat — never back into the group or chat it came from.' }, async ctx => {
    if (!ctx.quoted) throw new UserError('Reply to a view-once message.');
    const m = await viewOnceMedia(ctx);
    const to = ctx.isOwner ? ctx.ownerJid : (ctx.sender || ctx.chat);
    const caption = m.caption ? `👁️ ${bold('View-Once (Private)')}\n${m.caption}` : `👁️ ${bold('View-Once Revealed (Private)')}`;
    const content = m.kind === 'image'
      ? { image: m.buffer, caption }
      : m.kind === 'video'
        ? { video: m.buffer, caption }
        : { audio: m.buffer, mimetype: m.mime || 'audio/ogg; codecs=opus', ptt: m.ptt };
    await ctx.sendTo(to, content);
    if (ctx.chat !== to) await ctx.react('📥');
  });
  def('ss', { cat: 'whatsapp', heavy: true, usage: 'ss [me] (reply to a status)', desc: 'Save a status that was replied to or forwarded to you — photo, video, voice note or text. Add "me" to get it privately instead of in this chat.' }, async ctx => {
    if (!ctx.quoted) throw new UserError('Reply to a status (photo, video or text someone sent you from their status) with this command to save it.');
    const wantPrivate = /\bme\b/i.test(ctx.args);
    const to = wantPrivate ? (ctx.isOwner ? ctx.ownerJid : (ctx.sender || ctx.chat)) : ctx.chat;
    const m = await ctx.media().catch(() => null);
    if (m && ['image', 'video', 'audio'].includes(m.kind)) {
      const caption = `💾 ${bold('Saved status')}${m.caption ? `\n${m.caption}` : ''}`;
      const content = m.kind === 'image' ? { image: m.buffer, caption } : m.kind === 'video' ? { video: m.buffer, caption } : { audio: m.buffer, mimetype: m.mime || 'audio/ogg; codecs=opus', ptt: m.ptt };
      await ctx.sendTo(to, content, to === ctx.chat ? { quoted: ctx.msg } : undefined);
      if (wantPrivate && ctx.chat !== to) await ctx.react('📥');
      return;
    }
    const t = ctx.textOf(ctx.quoted?.message);
    if (!t) throw new UserError('That reply has no photo, video or text I can save.');
    await ctx.sendTo(to, { text: `💾 ${bold('Saved status')}\n\n${t}` }, to === ctx.chat ? { quoted: ctx.msg } : undefined);
    if (wantPrivate && ctx.chat !== to) await ctx.react('📥');
  });

  /* ---------- messages ---------- */
  def('react', { cat: 'whatsapp', usage: 'react <emoji> (reply to a message)', desc: 'React to the replied message with an emoji.' }, async ctx => {
    const e = ctx.args.match(/\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}]*/u)?.[0];
    if (!e) throw new UserError('Give an emoji, e.g. *react 🔥*');
    await ctx.sock.sendMessage(ctx.chat, { react: { text: e, key: ctx.quoted?.key || ctx.key } });
  });
  def('poll', { cat: 'whatsapp', usage: 'poll Question; option 1; option 2; …', desc: 'Create a poll (2-12 options, separated by ; ).' }, async ctx => {
    const parts = ctx.args.split(/[;\n|]/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 3) throw new UserError(`Usage: *${ctx.var('PREFIX')}poll Best anime?; Solo Leveling; Naruto; One Piece*`);
    const [name, ...values] = parts;
    await ctx.send({ poll: { name, values: values.slice(0, 12), selectableCount: 1 } });
  });
  def(['delete', 'dlt'], { cat: 'whatsapp', usage: 'delete (reply to any message)', desc: 'Delete the replied message and this command message for everyone (bot must be admin in groups, unless it is the bot\'s own).' }, async ctx => {
    if (!ctx.quoted) throw new UserError('Reply to the message you want to delete.');
    if (ctx.isGroup && !ctx.quoted.key.fromMe) {
      if (!ctx.isOwner && !(await ctx.admin())) throw new UserError('Only admins can delete other people\'s messages.');
      if (!(await ctx.botAdmin())) throw new UserError('Make me a group admin first.');
    } else if (!ctx.isOwner && !ctx.quoted.key.fromMe) {
      throw new UserError('Only the bot owner can delete other people\'s messages in private chats.');
    }
    // Delete the replied-to message
    await ctx.sock.sendMessage(ctx.chat, { delete: ctx.quoted.key });
    // Also delete the command message itself
    await ctx.sock.sendMessage(ctx.chat, { delete: ctx.key }).catch(() => {});
  });
  def('clear', { cat: 'whatsapp', owner: true, desc: 'Clear all messages in this chat.' }, async ctx => {
    const last = [{ key: ctx.key, messageTimestamp: ctx.ts }];
    try { await ctx.sock.chatModify({ delete: true, lastMessages: last }, ctx.chat); }
    catch { await ctx.sock.chatModify({ clear: true, lastMessages: last }, ctx.chat); }
  });

  /* ---------- channels ---------- */
  const channelCode = s => (String(s).match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/) || [])[1];
  def('cinfo', { cat: 'whatsapp', heavy: true, usage: 'cinfo <channel link>', desc: 'Show info about a WhatsApp channel.' }, async ctx => {
    const code = channelCode(ctx.args);
    if (!code) throw new UserError('Send a channel link like https://whatsapp.com/channel/…');
    const m = await ctx.sock.newsletterMetadata('invite', code).catch(() => null);
    if (!m) throw new UserError('Could not read that channel.');
    await ctx.reply([
      `📢 ${bold('Name')}: ${m.name}`, `🆔 ${bold('ID')}: ${m.id}`, `👥 ${bold('Followers')}: ${m.subscribers ?? '-'}`,
      m.verification ? `✔️ ${bold('Verified')}: ${m.verification}` : null, m.description ? `📝 ${m.description}` : null
    ].filter(Boolean).join('\n'), { title: 'Channel info' });
  });
  def('creact', { cat: 'whatsapp', owner: true, usage: 'creact <channel post link> <emoji>', desc: 'React to a channel post once from this WhatsApp account.' }, async ctx => {
    const linkMatch = ctx.args.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)\/(\d+)/) || ctx.args.match(/(\d+@newsletter)\/(\d+)/);
    if (!linkMatch) throw new UserError(`Usage: *${ctx.var('PREFIX')}creact https://whatsapp.com/channel/XXXX/123 🔥*`);

    const postId = linkMatch[2];
    let channelId = linkMatch[1];
    let channelName = 'Channel';

    const emojis = ctx.args.match(/\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}]*/gu) || [];
    if (!emojis.length) throw new UserError('Give at least one emoji to react with, e.g. 🔥 or ❤️🔥');
    if (emojis.length > 1) throw new UserError('Choose one emoji. WhatsApp allows one channel reaction per account on each post.');

    const remainingText = ctx.args.replace(linkMatch[0], '');
    const numMatch = remainingText.match(/\b\d+\b/);
    const count = numMatch ? Number.parseInt(numMatch[0], 10) : 1;
    if (!Number.isSafeInteger(count) || count < 1) throw new UserError('Reaction count must be a positive whole number.');
    if (count > 1) throw new UserError(`WhatsApp counts one reaction per account per post. This command uses one account, so it cannot create ${count} separate likes; each additional like must come from a different WhatsApp account.`);

    if (!channelId.endsWith('@newsletter')) {
      const meta = await ctx.sock.newsletterMetadata('invite', channelId).catch(() => null);
      if (!meta?.id) throw new UserError('Could not resolve channel invite link. Verify the channel URL.');
      channelId = meta.id;
      channelName = meta.name || 'Channel';
    }

    await ctx.sock.newsletterReactMessage(channelId, postId, emojis[0]);
    return ctx.reply(`${emojis[0]} Reaction sent to *${channelName}* (post #${postId}).`);
  });

  /* ---------- profile & privacy ---------- */
  def('setstatus', { cat: 'whatsapp', owner: true, usage: 'setstatus <text>', desc: 'Change the About text of the bot account.' }, async ctx => {
    if (!ctx.args) throw new UserError('Write the new About text.');
    await ctx.sock.updateProfileStatus(ctx.args.slice(0, 139));
    await ctx.reply('✅ About updated.');
  });
  const privacy = (name, desc, values, call, label) => def(name, { cat: 'whatsapp', owner: true, usage: `${name} ${Object.keys(values).join('|')}`, desc }, async ctx => {
    const a = ctx.argv[0]?.toLowerCase();
    if (!values[a]) throw new UserError(`Choose one of: ${Object.keys(values).join(', ')}`);
    await ctx.sock[call](values[a]);
    await ctx.reply(`🔐 ${label} privacy set to *${a}*.`);
  });
  privacy('online', 'Who can see when the bot account is online.', { all: 'all', match: 'match_last_seen' }, 'updateOnlinePrivacy', 'Online');
  privacy('read', 'Read receipts (blue ticks).', { all: 'all', none: 'none' }, 'updateReadReceiptsPrivacy', 'Read receipts');
  privacy('status', 'Who can see the About text.', { all: 'all', contacts: 'contacts', blacklist: 'contact_blacklist', none: 'none' }, 'updateStatusPrivacy', 'About');

  /* ---------- status viewer / reactor / saver ---------- */
  const onOff = (ctx, key, label, extra = '') => {
    const a = ctx.argv[0]?.toLowerCase();
    const cur = ctx.get(key, false);
    if (!['on', 'off'].includes(a)) { ctx.reply(`${label} is *${cur ? 'ON' : 'OFF'}*.\nUse *${ctx.var('PREFIX')}${ctx.cmd} on* or *off*.${extra}`); return null; }
    ctx.set(key, a === 'on');
    return a === 'on';
  };

  def('scstatus', { cat: 'whatsapp', owner: true, usage: 'scstatus view|save|off', desc: 'Auto-view contacts\' statuses (view), or also copy them to your chat (save).' }, async ctx => {
    const a = ctx.argv[0]?.toLowerCase();
    if (!['view', 'save', 'off'].includes(a)) return ctx.reply(`Status watcher: *${ctx.get('scstatus', 'off').toUpperCase()}*\nUse *${ctx.var('PREFIX')}scstatus view | save | off*`);
    ctx.set('scstatus', a);
    await ctx.reply(a === 'off' ? '👁️ Status watcher off.' : a === 'view' ? '👁️ I will now view statuses automatically.' : '💾 I will view statuses and copy photos/videos/text to your chat.');
  });

  def('autoviewstatus', { cat: 'whatsapp', owner: true, usage: 'autoviewstatus on|off', desc: 'Automatically view everyone\'s statuses.' }, async ctx => {
    const on = onOff(ctx, 'autoviewstatus', 'Auto view status');
    if (on !== null) await ctx.reply(on ? '👁️ Auto view status is *ON*. I will mark statuses as seen.' : '👁️ Auto view status is *OFF*.');
  });

  def(['autoreactstatus', 'autolikestatus'], { cat: 'whatsapp', owner: true, usage: 'autoreactstatus on|off|<emoji> • autolikestatus on|off', desc: 'Automatically react to statuses with a chosen emoji or emoji list. autolikestatus uses a heart by default.' }, async ctx => {
    const a = ctx.argv[0]?.toLowerCase();
    const cur = ctx.get('autoreactstatus', null);
    const emojis = ctx.args.match(/\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}\p{Emoji_Modifier}]*/gu) || [];
    const emoji = emojis[0];
    if (['off', 'stop', 'disable'].includes(a)) { ctx.set('autoreactstatus', null); return ctx.reply('❤️ Auto react status is *OFF*.'); }
    if (['on', 'enable', 'start'].includes(a) || emoji) {
      const chosen = ctx.cmd === 'autolikestatus' ? (emojis.length ? [...new Set(emojis)] : ['❤️']) : emojis.length ? [...new Set(emojis)] : cur?.emojis || null;
      ctx.set('autoreactstatus', { emoji: chosen?.length === 1 ? chosen[0] : cur?.emoji || null, emojis: chosen });
      return ctx.reply(`❤️ Auto react status is *ON* ${chosen?.length ? `with ${chosen.join(' ')}` : '(random emojis)'}.`);
    }
    await ctx.reply(`Auto react status is *${cur ? 'ON' : 'OFF'}*${cur?.emojis?.length ? ` (${cur.emojis.join(' ')})` : cur?.emoji ? ` (${cur.emoji})` : ''}.\nUse *${ctx.var('PREFIX')}autoreactstatus on*, *off*, or emojis like *${ctx.var('PREFIX')}autoreactstatus 🔥 😂*`);
  });

  def('autoreadmessages', { cat: 'whatsapp', owner: true, usage: 'autoreadmessages on|off', desc: 'Automatically mark incoming messages as read (blue ticks).' }, async ctx => {
    const on = onOff(ctx, 'autoread', 'Auto read messages');
    if (on !== null) await ctx.reply(on ? '✅ Auto read messages is *ON*.' : '✅ Auto read messages is *OFF*.');
  });

  def('autoreact', { cat: 'whatsapp', owner: true, usage: 'autoreact on|off|<emoji>', desc: 'React to incoming messages automatically (random emoji, or your chosen one). Use sparingly: heavy auto-reacting can get a number restricted.' }, async ctx => {
    const a = ctx.argv[0]?.toLowerCase();
    const cur = ctx.get('autoreact', null);
    const emojis = ctx.args.match(/\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}\p{Emoji_Modifier}]*/gu) || [];
    const emoji = emojis[0];
    if (a === 'off') { ctx.set('autoreact', null); return ctx.reply('😎 Auto react is *OFF*.'); }
    if (a === 'on' || emoji) {
      const chosen = emojis.length ? [...new Set(emojis)] : cur?.emojis || null;
      ctx.set('autoreact', { emoji: chosen?.length === 1 ? chosen[0] : cur?.emoji || null, emojis: chosen });
      return ctx.reply(`😎 Auto react is *ON* ${chosen?.length ? `with ${chosen.join(' ')}` : '(random emojis)'}.\n⚠️ I react at most once every few seconds to stay safe.`);
    }
    await ctx.reply(`Auto react is *${cur ? 'ON' : 'OFF'}*${cur?.emojis?.length ? ` (${cur.emojis.join(' ')})` : cur?.emoji ? ` (${cur.emoji})` : ''}.\nUse *${ctx.var('PREFIX')}autoreact on*, *off*, or emojis like *${ctx.var('PREFIX')}autoreact 🔥 😂*`);
  });

  /* ---------- autotyping / autorecording / autobio ---------- */
  def('autotyping', { cat: 'whatsapp', owner: true, usage: 'autotyping on|off', desc: 'Show a brief "typing…" presence in the chat while a command is running.' }, async ctx => {
    const on = onOff(ctx, 'autotyping', 'Auto typing');
    if (on !== null) await ctx.reply(on ? '⌨️ Auto typing is *ON*. I\'ll show "typing…" while I work on a command.' : '⌨️ Auto typing is *OFF*.');
  });

  def('autorecording', { cat: 'whatsapp', owner: true, usage: 'autorecording on|off', desc: 'Show a brief "recording audio…" presence in the chat while a command is running.' }, async ctx => {
    const on = onOff(ctx, 'autorecording', 'Auto recording');
    if (on !== null) await ctx.reply(on ? '🎙️ Auto recording is *ON*. I\'ll show "recording audio…" while I work on a command.' : '🎙️ Auto recording is *OFF*.');
  });

  def('autobio', { cat: 'whatsapp', owner: true, usage: 'autobio on|off', desc: 'Keep the bot account\'s About text showing its name and the current time, refreshed about once a minute.' }, async ctx => {
    const on = onOff(ctx, 'autobio', 'Auto bio');
    if (on !== null) {
      if (on) ctx.rt.lastBioText = ''; // forces the ticker below to push an update right away instead of waiting for the next tick
      await ctx.reply(on ? '🕒 Auto bio is *ON*. Your About text will show the bot name and the current time, updated about once a minute.' : '🕒 Auto bio is *OFF*.');
    }
  });
  tickers.push({
    name: 'autobio', run: async api => {
      if (!api.get('autobio', false)) return;
      if (Date.now() - (api.rt.lastBioCheck || 0) < 55000) return; // WhatsApp rate-limits profile updates — check at most once a minute
      api.rt.lastBioCheck = Date.now();
      const time = new Date().toLocaleTimeString('en-GB', { timeZone: api.tz(), hour: '2-digit', minute: '2-digit' });
      const text = `🤖 ${api.BOT_NAME} • ${time}`.slice(0, 139);
      if (text === api.rt.lastBioText) return; // same minute, nothing changed — skip the call entirely
      try { await api.sock.updateProfileStatus(text); api.rt.lastBioText = text; }
      catch (e) { api.logger.warn({ error: e?.message }, 'Auto bio update failed'); }
    }
  });

  const EMOJIS = STATUS_EMOJIS;

  hooks.push({
    name: 'statuswatch', priority: -2, run: async ctx => {
      if (ctx.chat !== 'status@broadcast') return false;
      if (ctx.fromMe) return true;
      const mode = ctx.get('scstatus', 'off');
      const react = ctx.get('autoreactstatus', null);
      const view = mode !== 'off' || ctx.get('autoviewstatus', false) || react;
      if (!view) return true;
      const poster = ctx.key.participant || ctx.msg.participant || (ctx.chat === 'status@broadcast' ? ctx.sender : null);
      if (!poster) return true;

      const readKey = {
        remoteJid: 'status@broadcast',
        id: ctx.key.id,
        participant: poster
      };
      try { await ctx.sock.readMessages([readKey]); } catch {}

      const rt = ctx.rt;
      rt.reactedStatuses ||= new Set();
      rt.reactingStatuses ||= new Set();
      const statusId = `${poster}:${ctx.key.id}`;
      const alreadyReacted = rt.reactedStatuses.has(statusId) || rt.reactingStatuses.has(statusId);
      const isRecent = !ctx.ts || (Date.now() / 1000 - ctx.ts < 86400);

      if (react && isRecent && !alreadyReacted) {
        const emojiList = Array.isArray(react.emojis) && react.emojis.length ? react.emojis : EMOJIS;
        const emoji = react.emoji || emojiList[Math.floor(Math.random() * emojiList.length)];
        const userJids = [ctx.sock?.user?.id, ctx.sock?.user?.lid].filter(Boolean);
        if (!userJids.length && ctx.ownerJid) userJids.push(ctx.ownerJid);
        const normalizeJid = jid => String(jid).replace(/:\d+@/, '@');
        const statusJidList = [...new Set([
          poster, ctx.key.participantAlt, ctx.msg.participant,
          ...userJids.map(normalizeJid)
        ].filter(Boolean).map(normalizeJid))];
        const reactionKey = {
          ...ctx.key,
          remoteJid: 'status@broadcast',
          id: ctx.key.id,
          participant: poster,
          fromMe: false
        };
        rt.reactingStatuses.add(statusId);
        try {
          await ctx.sock.sendMessage('status@broadcast', { react: { text: emoji, key: reactionKey } }, { statusJidList });
          rt.reactedStatuses.add(statusId);
          if (rt.reactedStatuses.size > 2000) {
            const first = rt.reactedStatuses.keys().next().value;
            rt.reactedStatuses.delete(first);
          }
        } catch (err) {
          ctx.logger?.warn?.({ error: err?.message, poster, id: ctx.key?.id }, 'Failed to send auto status reaction');
        } finally {
          rt.reactingStatuses.delete(statusId);
        }
      }

      if (mode === 'save' && isRecent) {
        try {
          const who = '+' + ctx.jidUser(poster || '');
          if (ctx.text && (ctx.type === 'extendedTextMessage' || ctx.type === 'conversation')) await ctx.sendTo(ctx.ownerJid, { text: `📥 Status from ${who}:\n\n${ctx.text}` });
          else {
            const m = await ctx.media();
            if (m && ['image', 'video'].includes(m.kind)) await ctx.sendTo(ctx.ownerJid, { [m.kind]: m.buffer, caption: `📥 Status from ${who}${m.caption ? '\n' + m.caption : ''}` });
          }
        } catch {}
      }
      return true;
    }
  });

  /* ---------- auto read / auto react to messages ---------- */
  const SKIP_TYPES = new Set(['protocolMessage', 'reactionMessage', 'senderKeyDistributionMessage', 'pollUpdateMessage', 'encReactionMessage']);
  hooks.push({
    name: 'autoread', priority: -9, run: async ctx => {
      if (ctx.fromMe || !ctx.fresh || ctx.chat === 'status@broadcast' || !ctx.get('autoread', false)) return false;
      ctx.sock.readMessages([ctx.key]).catch(() => {});
      return false;
    }
  });
  hooks.push({
    name: 'autoreact', priority: -8, run: async ctx => {
      if (ctx.fromMe || !ctx.fresh || ctx.chat === 'status@broadcast' || SKIP_TYPES.has(ctx.type)) return false;
      const cfg = ctx.get('autoreact', null);
      if (!cfg || Date.now() - (ctx.rt.lastAutoReact || 0) < 3000) return false;
      ctx.rt.lastAutoReact = Date.now();
      const emojiList = Array.isArray(cfg.emojis) && cfg.emojis.length ? cfg.emojis : EMOJIS;
      const emoji = cfg.emoji || emojiList[Math.floor(Math.random() * emojiList.length)];
      ctx.sock.sendMessage(ctx.chat, { react: { text: emoji, key: ctx.key } }).catch(() => {});
      return false;
    }
  });
};
