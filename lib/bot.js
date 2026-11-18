'use strict';
const U = require('./util');
const { UserError, bold } = U;
const commands = require('../commands');
const access = require('./access');

// Command lifecycle collections are part of the DECAN command API. Older/local copies
// of the bot sometimes contain only a registry, which used to crash every restored
// session with `commands.events/hooks/tickers is not iterable`. Normalise once here so
// the WhatsApp runtime can safely continue even if an old command bundle is present.
const toList = value => {
  if (Array.isArray(value)) return value;
  if (value && typeof value[Symbol.iterator] === 'function') return [...value];
  return [];
};
const commandHooks = toList(commands?.hooks);
const commandEvents = toList(commands?.events);
const commandTickers = toList(commands?.tickers);

const BOT_NAME = process.env.BOT_NAME || 'DECANXMD';
const OWNER_NAME = process.env.OWNER_NAME || '';
const COMPANY_NAME = process.env.COMPANY_NAME || 'DECANXMD';
const CHANNEL_URL = process.env.CHANNEL_URL || 'https://whatsapp.com/channel/0029VbDqBjyFnSzHeIHAzH3m';
const SOURCE_URL = CHANNEL_URL;
// Only a small signature goes under messages (no link, no "powered by"). Change the text with FOOTER_TEXT.
const FOOTER = `> *${process.env.FOOTER_TEXT || 'decan konnect'}*`;
const FRAMED_RE = /^(?:╔═══|━━━━━━━━|▰▰▰▰|👑 ═══|• • •|🔥━━|📢 ━━━|╭━━|✦ ═══|╭─|┏❒)/;
/** Media captions get the same frame as text replies (short captions only: WhatsApp truncates long ones). */
const frameCaption = (c, fr) => { const t = String(c ?? '').trim(); return !t || t.length > 700 || FRAMED_RE.test(t) ? c : fr(t); };
const withChannel = c => { const body = String(c ?? ''); return body.includes(FOOTER) || /^┏❒/.test(body.trim()) ? body : `${body}\n\n${FOOTER}`; };
const decorateOutgoing = content => {
  if (!content || typeof content !== 'object') return content;
  const out = { ...content };
  if (typeof out.text === 'string') out.text = withChannel(out.text);
  if (typeof out.caption === 'string') out.caption = withChannel(out.caption);
  if (out.templateButtons && Array.isArray(out.templateButtons)) return out;
  if (out.interactiveButtons && Array.isArray(out.interactiveButtons)) return out; // native-flow menus (see lib/interactive.js) own their own buttons
  // Legacy URL buttons are dropped or rejected by current WhatsApp clients, so they are opt-in (USE_URL_BUTTON=1).
  // The channel header (see forwardify) is the primary channel link now.
  if (process.env.USE_URL_BUTTON === '1' && (typeof out.text === 'string' || typeof out.caption === 'string')) {
    out.templateButtons = [{ index: 1, urlButton: { displayText: '📢 View Channel', url: CHANNEL_URL } }];
  }
  return out;
};

/**
 * Makes a message render in WhatsApp with the "Forwarded from <channel>" header, exactly like a post that was
 * forwarded out of the DECANXMD channel. This is the standard contextInfo that WhatsApp itself writes when a
 * channel post is forwarded; the header opens the channel when tapped.
 */
const FORWARDABLE = ['text', 'image', 'video', 'audio', 'sticker', 'document'];
function forwardify(content, info) {
  if (!info?.jid || !content || typeof content !== 'object') return content;
  if (!FORWARDABLE.some(k => content[k] !== undefined)) return content; // reactions, deletes, polls, forwards, etc.
  return {
    ...content,
    contextInfo: {
      ...(content.contextInfo || {}),
      isForwarded: true,
      forwardingScore: 999,
      forwardedNewsletterMessageInfo: { newsletterJid: info.jid, newsletterName: info.name || BOT_NAME, serverMessageId: info.msgId || 143 }
    }
  };
}

/**
 * A button tap arrives as an interactiveResponseMessage. Quoting it in a reply produces a malformed stanza
 * that WhatsApp rejects ("smax-invalid (479)"), so the reply to a tap is sent without a quote — which is why
 * tapping a button used to produce a warning and no answer. Typed commands are unaffected.
 */
function dropTapQuote(opts) {
  const q = opts?.quoted;
  if (!q?.message) return opts;
  let m = q.message;
  for (let i = 0; i < 4 && m; i++) { // unwrap ephemeral / view-once / device-sent wrappers
    if (m.interactiveResponseMessage) { const { quoted, ...rest } = opts; return rest; }
    m = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.documentWithCaptionMessage?.message || m.deviceSentMessage?.message;
  }
  return opts;
}

const DEFAULT_VARS = {
  PREFIX: '.',
  MODE: 'public',
  STICKER_PACK: BOT_NAME,
  STICKER_AUTHOR: OWNER_NAME,
  WARN_LIMIT: '3',
  TIMEZONE: process.env.TIMEZONE || 'Africa/Nairobi',
  CURRENCY: 'KES',
  ALIVE_MESSAGE: '',
  COOLDOWN: '0', // seconds each non-owner must wait between commands; 0 = no limit (v1.2.0). Set with: setvar COOLDOWN:2
  BUTTON_MENUS: 'on', // on = .music shows tappable buttons; off = plain numbered text menu (use if buttons never show on your phone)
  CHANNEL_FORWARD: 'on', // on = every reply shows "Forwarded from <channel>"; off = plain replies
  CHANNEL_JID: process.env.CHANNEL_JID || '', // optional: 1203630xxxxxxxxxx@newsletter (auto-detected from CHANNEL_URL when empty)
  CHANNEL_MSG_ID: process.env.CHANNEL_MSG_ID || '', // optional: id of any real post in your channel (makes WhatsApp show the View channel button)
  FRAME_STYLE: 'decan', // decan | classic | neon | royal | minimal | dots | fire | clean (see .frame)
  CHANNEL_NAME: process.env.CHANNEL_NAME || '' // optional: name shown in the forwarded header (auto-detected when empty)
};

/* ------------------------------ jid helpers ------------------------------ */
const jidUser = j => String(j || '').split('@')[0].split(':')[0];
const isGroupJid = j => /@g\.us$/.test(String(j || ''));
const pids = p => [p?.id, p?.lid, p?.phoneNumber, p?.jid].map(jidUser).filter(Boolean);

/* ----------------------------- message helpers --------------------------- */
const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'associatedChildMessage',
  'groupStatusMessage',
  'groupStatusMessageV2',
  'editedMessage'
];
function unwrap(m) {
  for (let i = 0; m && i < 8; i++) {
    const k = WRAPPERS.find(w => m[w]);
    if (!k) break;
    m = m[k].message || m[k];
  }
  return m;
}
const SKIP = new Set(['messageContextInfo', 'senderKeyDistributionMessage']);
const ctype = m => (m ? Object.keys(m).find(k => !SKIP.has(k)) : undefined);
/**
 * A tap on a modern native-flow interactive button/list (see lib/interactive.js) lands as
 * interactiveResponseMessage.nativeFlowResponseMessage.paramsJson — a JSON string with an `id`
 * field — not as the legacy buttonsResponseMessage/listResponseMessage selection types below.
 */
function nativeFlowId(m) {
  const paramsJson = m?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (!paramsJson) return '';
  try { return String(JSON.parse(paramsJson)?.id || ''); } catch { return ''; }
}
function textOf(m) {
  if (!m) return '';
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId || m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    m.templateButtonReplyMessage?.selectedId || nativeFlowId(m) || '';
}
const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];
const mediaTypeOf = m => {
  const u = unwrap(m);
  return MEDIA_TYPES.find(t => u?.[t]);
};
function isViewOnceMsg(m) {
  if (!m) return false;
  if (m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension) return true;
  const u = unwrap(m);
  return Boolean(u?.imageMessage?.viewOnce || u?.videoMessage?.viewOnce || u?.audioMessage?.viewOnce);
}
const node_len = n => (n?.fileLength && typeof n.fileLength === 'object' ? (n.fileLength.toNumber ? n.fileLength.toNumber() : n.fileLength.low) : Number(n?.fileLength)) || 0;
function tsOf(msg) {
  const t = msg.messageTimestamp;
  const n = typeof t === 'object' && t ? (t.toNumber ? t.toNumber() : t.low) : Number(t);
  return n || Math.floor(Date.now() / 1000);
}

/** The signature DECAN XMD layout (same as the welcome message and the menu): ┏❒ header, ┃ rails, ┗❒ footer. Code blocks keep their own width. */
function decanWrap(t, body) {
  let fenced = false;
  const rows = String(body).split('\n').map(l => {
    if (/^\s*```/.test(l)) { fenced = !fenced; return l; }
    return fenced ? l : (l.trim() ? `┃ ${l}` : '┃');
  });
  return `┏❒ 👑 ✦ 𝐃𝐄𝐂𝐀𝐍 𝐗𝐌𝐃 ✦ 👑 ❒\n${t ? `┃ ✦ ${bold(t)}\n┃\n` : ''}${rows.join('\n')}\n┃\n┗❒ ❤️ POWERED BY DECAN KONNECT`;
}
const FRAME_STYLES = {
  decan: { name: 'Decan', own: true, wrap: (n, t, body) => decanWrap(t, body) },
  classic: { name: 'Classic', wrap: (n, t, body) => `━━━━━━━━━━━━━━━━━━━━\n   ✦ ${n} ✦\n━━━━━━━━━━━━━━━━━━━━\n${t ? `\n◈ ${bold(t)}\n` : ''}\n${body}\n\n━━━━━━━━━━━━━━━━━━━━` },
  neon: { name: 'Neon', wrap: (n, t, body) => `▰▰▰▰ ${n} ▰▰▰▰\n${t ? `⚡ ${bold(t)}\n` : ''}▱▱▱▱▱▱▱▱▱▱▱▱▱▱\n\n${body}\n\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰` },
  royal: { name: 'Royal', wrap: (n, t, body) => `👑 ═══ ${n} ═══ 👑\n${t ? `\n✦ ${bold(t)} ✦\n` : ''}\n${body}\n\n═══════════════════` },
  minimal: { name: 'Minimal', wrap: (n, t, body) => `${bold(t || n)}\n─────────────\n${body}` },
  dots: { name: 'Dots', wrap: (n, t, body) => `• • • ${n} • • •\n${t ? `\n➤ ${bold(t)}\n` : ''}\n${body}\n\n• • • • • • • • • •` },
  fire: { name: 'Fire', wrap: (n, t, body) => `🔥━━〔 ${n} 〕━━🔥\n${t ? `\n💥 ${bold(t)}\n` : ''}\n${body}\n\n🔥━━━━━━━━━━━━━━🔥` },
  channel: { name: 'Channel', wrap: (n, t, body) => `📢 ━━━〔 ${n} 〕━━━ 📢\n\n${t ? `✨ ${bold(t)}\n━━━━━━━━━━━━━━━━━━━━\n\n` : ''}${body}\n\n━━━━━━━━━━━━━━━━━━━━\n📡 DECANXMD OFFICIAL CHANNEL` },
  banner: { name: 'Banner', wrap: (n, t, body) => `╭━━━━━━━━━━━━━━━━━━━╮\n  🌟 ${n} 🌟\n╰━━━━━━━━━━━━━━━━━━━╯\n${t ? `\n📌 ${bold(t)}\n` : ''}\n${body}\n\n─────────────────────` },
  elegant: { name: 'Elegant', wrap: (n, t, body) => `✦ ══════════════════ ✦\n      ❖ ${n} ❖\n✦ ══════════════════ ✦\n${t ? `\n◈ ${bold(t)}\n` : ''}\n${body}\n\n✦ ══════════════════ ✦` },
  clean: { name: 'Clean', wrap: (n, t, body) => `${t ? `${bold(t)}\n\n` : ''}${body}` }
};
function frame(body, title, style) {
  if (title && typeof title === 'object') title = title.title; // accept frame(body, { title })
  const st = FRAME_STYLES[style] || FRAME_STYLES.decan;
  const out = st.wrap(bold(BOT_NAME.toUpperCase()), title, body);
  return st.own ? out : `${out}\n\n${FOOTER}`;
}
function adContext(large = false) {
  const thumbnail = U.thumbSync();
  if (!thumbnail) return undefined;
  return { externalAdReply: { title: BOT_NAME, body: '', thumbnail, mediaType: 1, renderLargerThumbnail: large, showAdAttribution: false, sourceUrl: SOURCE_URL } };
}

const LOG_RING_MAX = 500;
const LOG_RING = [];
let LIVE_SESSIONS = 0;
/**
 * Bounded in-memory ring of application log lines, independent of the terminal output.
 * Captures INFO as well as WARN/ERROR so the dashboard's Logs panel can filter by severity;
 * the owner-only .logs/.errors WhatsApp commands (commands/devtools.js) still work unchanged —
 * they just filter this same ring down to warnings/errors before showing it.
 * Never includes credentials, cookies, pairing codes, auth keys or full message bodies: only the
 * short log line text and (truncated) error message that pino was given, same as before.
 */
function ring(level, args) {
  try {
    const [a, b] = args;
    const msg = typeof a === 'string' ? a : (typeof b === 'string' ? b : '');
    const obj = typeof a === 'object' && a ? a : {};
    const subsystem = obj.hook ? `hook:${obj.hook}` : obj.ticker ? `ticker:${obj.ticker}` : obj.event ? `event:${obj.event}` : (obj.command || obj.terminalEvent) ? 'command' : 'bot';
    LOG_RING.push({
      at: Date.now(), level,
      msg: String(msg).slice(0, 160),
      error: String(obj.error || obj.err?.message || '').slice(0, 160),
      command: obj.command || obj.ticker || '',
      sessionId: obj.sessionId ? String(obj.sessionId).slice(-4) : '', // last 4 digits only, never the full number
      subsystem
    });
    if (LOG_RING.length > LOG_RING_MAX) LOG_RING.shift();
  } catch { /* logging must never break the bot */ }
}

function createBot({ baileys, store, logger, pairNumber }) {
  for (const level of ['info', 'warn', 'error']) {
    const orig = logger[level]?.bind(logger);
    if (orig) logger[level] = (...args) => { ring(level, args); return orig(...args); };
  }
  const downloadMediaMessage = baileys.downloadMediaMessage;
  const mediaLogger = logger.child({ module: 'media' }, { level: 'silent' });

  /**
   * Sends a real WhatsApp native-flow interactive message (the modern replacement for the old
   * buttonsMessage/listMessage, which current WhatsApp clients largely ignore — see decorateOutgoing
   * above). This is NOT a sock.sendMessage() content shorthand: Baileys' content normalizer has no
   * built-in key for it, so it has to be built as a raw proto.Message (viewOnceMessage wrapping an
   * interactiveMessage with a nativeFlowMessage) and sent with generateWAMessageFromContent +
   * sock.relayMessage, which is the pattern the WhatsApp/Baileys community actually uses for this.
   * Throws if the installed Baileys build doesn't expose what this needs, or if WhatsApp rejects the
   * send — callers (see lib/interactive.js) catch that and fall back to a plain numbered-reply menu.
   */
  const api_var = (entry, k) => (entry.api?.var ? entry.api.var(k) : undefined);
  async function sendNativeFlow(entry, jid, { body, title, footer, buttons }) {
    const { generateWAMessageFromContent, proto } = baileys;
    if (typeof generateWAMessageFromContent !== 'function' || !proto?.Message) {
      throw new Error('This Baileys build does not expose generateWAMessageFromContent/proto — native-flow buttons are unavailable.');
    }
    const sock = entry.socket;
    if (typeof sock?.relayMessage !== 'function') throw new Error('No active WhatsApp socket to relay the interactive message through.');
    // Same look as normal replies: the bot image card, plus the "Forwarded from <channel>" header when known.
    let contextInfo = { ...(adContext(false) || {}) };
    if (api_var(entry, 'CHANNEL_FORWARD') !== 'off') {
      const info = await entry.api?.channelInfo?.().catch(() => null);
      if (info?.jid) contextInfo = { ...contextInfo, isForwarded: true, forwardingScore: 999, forwardedNewsletterMessageInfo: { newsletterJid: info.jid, newsletterName: info.name || BOT_NAME, serverMessageId: info.msgId || 143 } };
    }
    const content = {
      viewOnceMessage: {
        message: {
          messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} },
          interactiveMessage: proto.Message.InteractiveMessage.create({
            body: proto.Message.InteractiveMessage.Body.create({ text: String(body || '') }),
            footer: footer ? proto.Message.InteractiveMessage.Footer.create({ text: String(footer) }) : undefined,
            header: proto.Message.InteractiveMessage.Header.create({ title: String(title || ''), hasMediaAttachment: false }),
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons }),
            ...(Object.keys(contextInfo).length ? { contextInfo } : {})
          })
        }
      }
    };
    const waMsg = generateWAMessageFromContent(jid, proto.Message.fromObject(content), { userJid: sock.user?.id || sock.authState?.creds?.me?.id });
    // WhatsApp only renders native-flow buttons from a linked (non-Business) account when the stanza carries
    // the "biz" interactive node; without it the server accepts the message but the phone shows no buttons.
    // That missing node is why .music "refused to make the button". 1:1 chats additionally need the bot node.
    const additionalNodes = [{
      tag: 'biz', attrs: {},
      content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }]
    }];
    if (!isGroupJid(jid)) additionalNodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
    await sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id, additionalNodes });
    if (waMsg.key?.id) rememberSent(entry.rt, waMsg.key.id);
    return waMsg;
  }

  function newRuntime() {
    return {
      started: Date.now(), sent: new Set(), msgCache: new Map(), voCache: new Map(), groupCache: new Map(), cool: new Map(), spam: new Map(),
      afkSeen: new Map(), greetSeen: new Map(), games: new Map(), merge: new Map(), votes: new Map(), dirtyCounts: new Set(), lastMinute: '',
      musicMenus: new Map() // pending interactive music-menu selections, see commands/download.js
    };
  }

  const rememberSent = (rt, id) => { rt.sent.add(id); if (rt.sent.size > 800) rt.sent.delete(rt.sent.values().next().value); };

  async function groupMeta(entry, jid, force = false) {
    const rt = entry.rt;
    const c = rt.groupCache.get(jid);
    if (c && !force && Date.now() - c.at < 120000) return c.meta;
    const meta = await entry.socket.groupMetadata(jid);
    rt.groupCache.set(jid, { meta, at: Date.now() });
    return meta;
  }

  const botIds = entry => {
    const u = entry.socket?.user || {};
    return [...new Set([jidUser(u.id), jidUser(u.lid), entry.phone].filter(Boolean))];
  };

  /* ---------------------- per-session API (shared by everything) ---------- */
  function makeApi(entry) {
    const sid = entry.sessionId;
    const rt = entry.rt;
    const api = {
      entry, sid, rt, store, logger, baileys, U, bold, frame: (b, t) => frame(b, t, api.var('FRAME_STYLE')), adContext, jidUser, isGroupJid, pids, unwrap, ctype, textOf, mediaTypeOf,
      BOT_NAME, OWNER_NAME, COMPANY_NAME, CHANNEL_URL, FOOTER,
      pairNumber: p => { if (!pairNumber) throw new UserError('Pairing is not available.'); return pairNumber(p); },
      get sock() { return entry.socket; },
      get phone() { return entry.phone; },
      get ownerJid() { return `${entry.phone}@s.whatsapp.net`; },
      get: (k, d) => store.get(sid, k, d),
      set: (k, v) => store.set(sid, k, v),
      del: k => store.del(sid, k),
      update: (k, d, fn) => store.update(sid, k, d, fn),
      keys: p => store.keys(sid, p),
      var(k, d) {
        const v = store.get(sid, 'vars', {})[k];
        return v ?? DEFAULT_VARS[k] ?? d;
      },
      tz() { return String(api.var('TIMEZONE')); },
      botIds: () => botIds(entry),
      sudo: () => store.get(sid, 'sudo', []),
      ownerIds: () => [...botIds(entry), ...store.get(sid, 'sudo', [])],
      isOwnerIds: ids => ids.some(i => api.ownerIds().includes(i)),
      groupMeta: (jid, force) => groupMeta(entry, jid, force),
      /** Resolves the channel's JID + name once (env/var first, then WhatsApp lookup from the invite link) and caches it. */
      channelInfo() {
        // Never make a reply wait on WhatsApp for the channel header: use what we already know (memory, then the
        // saved copy from the last run) and refresh in the background. Only the very first lookup is awaited, and
        // only briefly. A failed lookup is retried after 30 minutes instead of on every message.
        const now = Date.now();
        let c = rt.channelCache;
        if (!c) { const saved = store.get(sid, 'channelInfo', null); if (saved?.jid) c = rt.channelCache = { info: saved, at: 0 }; }
        const ttl = c ? (c.info ? 6 * 3600e3 : 30 * 60e3) : 0;
        const fresh = c && now - c.at < ttl;
        if (!fresh && !rt.channelLookup) {
          rt.channelLookup = (async () => {
            let info = null;
            try {
              const jid = String(api.var('CHANNEL_JID') || '').trim();
              const name = String(api.var('CHANNEL_NAME') || '').trim();
              if (/@newsletter$/.test(jid)) info = { jid, name: name || BOT_NAME };
              else {
                const code = (CHANNEL_URL.match(/channel\/([\w-]+)/) || [])[1];
                if (code && typeof entry.socket?.newsletterMetadata === 'function') {
                  const meta = await Promise.race([entry.socket.newsletterMetadata('invite', code), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
                  const id = meta?.id || meta?.thread_metadata?.id;
                  if (id) info = { jid: String(id).includes('@') ? id : `${id}@newsletter`, name: name || meta?.name || meta?.thread_metadata?.name?.text || BOT_NAME };
                }
              }
            } catch (e) { logger.warn({ sessionId: sid, error: e?.message }, 'Could not resolve channel for forwarded header; will retry later'); }
            if (info) {
              // Any positive message id makes WhatsApp show "View channel". The old code also asked WhatsApp for the newest
              // post (newsletterFetchMessages) with two guessed call signatures; the wrong one is sent as a malformed
              // request that WhatsApp rejects with "smax-invalid (479)" — that is gone. Set CHANNEL_MSG_ID to pin an id.
              const id = Number.parseInt(api.var('CHANNEL_MSG_ID'), 10);
              info.msgId = id > 0 ? id : 143;
              store.set(sid, 'channelInfo', info);
            }
            // keep serving the last good copy if this refresh failed
            rt.channelCache = { info: info || rt.channelCache?.info || null, at: Date.now() };
            rt.channelLookup = null;
            return rt.channelCache.info;
          })();
        }
        if (c?.info) return Promise.resolve(c.info);
        return rt.channelLookup ? Promise.race([rt.channelLookup, new Promise(res => setTimeout(() => res(null), 2500))]) : Promise.resolve(null);
      },
      resetChannel() { rt.channelCache = null; rt.channelLookup = null; },
      async sendTo(jid, content, opts) {
        const { noAd, ...rest } = content && typeof content === 'object' ? content : { };
        let out = decorateOutgoing(content && typeof content === 'object' ? rest : content);
        if (String(jid).endsWith('@newsletter')) { const { contextInfo, templateButtons, mentions, ...plain } = out; out = plain; } // channels accept plain posts only
        else {
          // Every text reply carries the bot image card unless the caller opted out (noAd) or it is an edit.
          if (!noAd && typeof out.text === 'string' && !out.edit && !out.contextInfo?.externalAdReply) {
            const ad = adContext(false);
            if (ad) out = { ...out, contextInfo: { ...(out.contextInfo || {}), ...ad } };
          }
          if (api.var('CHANNEL_FORWARD') !== 'off') out = forwardify(out, await api.channelInfo());
        }
        const r = await entry.socket.sendMessage(jid, out, dropTapQuote(opts));
        if (r?.key?.id) rememberSent(rt, r.key.id);
        return r;
      },
      participantByJid(meta, jid) {
        const u = jidUser(jid);
        return meta.participants.find(p => pids(p).includes(u));
      },
      isAdminP: p => Boolean(p && (p.admin === 'admin' || p.admin === 'superadmin' || p.admin === true)),
      async download(msgLike) {
        const m = unwrap(msgLike.message);
        const t = mediaTypeOf(m);
        if (t && m?.[t]) {
          const node = m[t];
          if (node.directPath && !node.url) {
            node.url = 'https://mmg.whatsapp.net' + node.directPath;
          }
        }
        return downloadMediaMessage({ key: msgLike.key, message: m }, 'buffer', {}, { logger: mediaLogger, reuploadRequest: entry.socket.updateMediaMessage });
      }
    };
    return api;
  }

  /* --------------------------------- ctx ---------------------------------- */
  function buildCtx(entry, msg, text) {
    const api = entry.api;
    const sock = entry.socket;
    const rt = entry.rt;
    const key = msg.key;
    const chat = key.remoteJid;
    const isGroup = isGroupJid(chat);
    const fromMe = Boolean(key.fromMe);
    const senderIds = fromMe
      ? botIds(entry)
      : [...new Set([key.participant, key.participantAlt, isGroup ? null : key.remoteJid, key.remoteJidAlt].map(jidUser).filter(Boolean))];
    const sender = fromMe ? api.ownerJid : (key.participant || key.remoteJid);
    const content = unwrap(msg.message);
    const type = ctype(content);
    const ci = content?.[type]?.contextInfo;
    const quotedId = ci?.stanzaId;
    const cachedQuoted = quotedId ? rt.msgCache.get(quotedId) : null;
    const rawQuotedMsg = ci?.quotedMessage ? unwrap(ci.quotedMessage) : (cachedQuoted?.message ? unwrap(cachedQuoted.message) : null);
    const quoted = (ci?.quotedMessage || cachedQuoted) ? {
      key: {
        remoteJid: chat,
        id: quotedId || cachedQuoted?.key?.id,
        participant: ci?.participant || cachedQuoted?.sender || cachedQuoted?.key?.participant,
        fromMe: botIds(entry).includes(jidUser(ci?.participant || cachedQuoted?.sender))
      },
      message: rawQuotedMsg,
      sender: ci?.participant || cachedQuoted?.sender,
      cached: cachedQuoted
    } : null;
    const mentioned = ci?.mentionedJid || [];
    const isOwner = fromMe || api.isOwnerIds(senderIds);
    const ts = tsOf(msg);
    const q = { quoted: msg };
    let metaP = null;

    const ctx = Object.assign(Object.create(api), {
      msg, key, chat, isGroup, fromMe, sender, senderIds, senderNum: senderIds[0] || '', content, type, quoted, mentioned, isOwner,
      text, name: msg.pushName || '', ts, fresh: Date.now() / 1000 - ts < 90, ci,
      cmd: '', args: '', argv: [], prefix: '.',
      // Every command response is framed by default. Commands that intentionally send a complete/raw layout can
      // opt out with `noFrame: true`. Text that is already framed is detected so it is never wrapped twice.
      send: (c = {}, o) => {
        const out = { ...c };
        if (typeof out.text === 'string' && !out.noFrame && !FRAMED_RE.test(out.text.trim())) {
          out.text = api.frame(out.text, out.title);
        }
        delete out.noFrame;
        return api.sendTo(chat, decorateOutgoing(out), o);
      },
      /** Real native-flow interactive menu — see sendNativeFlow() above. Throws on failure; callers fall back. */
      sendInteractive: ({ body, title, footer, buttons }) => sendNativeFlow(entry, chat, { body, title, footer: footer || FOOTER, buttons }),
      reply: (body, o = {}) => api.sendTo(chat, decorateOutgoing({ text: api.frame(body, o.title), contextInfo: adContext(o.large) }), q),
      plain: (body, extra = {}) => api.sendTo(chat, decorateOutgoing({ text: body, noAd: true, ...extra }), q),
      image: (buffer, caption, extra = {}) => api.sendTo(chat, decorateOutgoing({ image: buffer, caption: caption ? withChannel(frameCaption(caption, api.frame)) : caption, ...extra }), q),
      video: (buffer, caption, extra = {}) => api.sendTo(chat, decorateOutgoing({ video: buffer, caption: caption ? withChannel(frameCaption(caption, api.frame)) : caption, mimetype: 'video/mp4', ...extra }), q),
      audio: async (buffer, ptt = false, mimetype) => { const r = await api.sendTo(chat, { audio: buffer, ptt, mimetype: mimetype || (ptt ? 'audio/ogg; codecs=opus' : 'audio/mpeg') }, q); if (api.var('CHANNEL_FORWARD') === 'off') await api.sendTo(chat, decorateOutgoing({ text: '📡 *DECANXMD CHANNEL*\nUpdates and releases:' }), {}).catch(() => {}); return r; },
      doc: (buffer, fileName, mimetype = 'application/octet-stream', extra = {}) => api.sendTo(chat, decorateOutgoing({ document: buffer, fileName, mimetype, caption: extra.caption, ...extra }), q),
      sticker: async buffer => { const r = await api.sendTo(chat, { sticker: buffer }, q); if (api.var('CHANNEL_FORWARD') === 'off') await api.sendTo(chat, decorateOutgoing({ text: '✨ *DECANXMD* • More updates and tools:' }), {}).catch(() => {}); return r; },
      react: emoji => sock.sendMessage(chat, { react: { text: emoji, key } }).catch(() => {}),
      group: async (force = false) => {
        if (!isGroup) throw new UserError('This command works in groups only.');
        if (force) metaP = null;
        return (metaP ||= api.groupMeta(chat, force));
      },
      admin: async () => {
        if (!isGroup) return false;
        const meta = await ctx.group();
        return meta.participants.some(p => api.isAdminP(p) && pids(p).some(i => senderIds.includes(i)));
      },
      botAdmin: async () => {
        if (!isGroup) return false;
        const meta = await ctx.group();
        const ids = botIds(entry);
        return meta.participants.some(p => api.isAdminP(p) && pids(p).some(i => ids.includes(i)));
      },
      /** raw jids targeted by mention / reply / numbers in args */
      targets: (pmFallback = false) => {
        const out = [...mentioned];
        if (!out.length && quoted?.sender) out.push(quoted.sender);
        if (!out.length) {
          for (const w of ctx.args.split(/\s+/)) {
            const d = w.replace(/\D/g, '');
            if (d.length >= 7 && d.length <= 15 && /^\+?\d[\d\s-]*$/.test(w)) out.push(d + '@s.whatsapp.net');
          }
        }
        if (!out.length && pmFallback && !isGroup) out.push(chat);
        return [...new Set(out)];
      },
      /** download media from the replied message (preferred) or from this message */
      media: async () => {
        let target = quoted?.message && mediaTypeOf(quoted.message) ? quoted : (mediaTypeOf(content) ? { key, message: content } : null);
        const targetId = target?.key?.id || quoted?.key?.id;

        // Check if pre-cached media buffer exists (e.g. from view-once background buffering)
        if (targetId && rt.voCache?.has(targetId)) {
          return rt.voCache.get(targetId);
        }

        // If target is quoted or has a cached message, ensure full media keys from cached copy if available
        if (quoted?.key?.id && rt.msgCache.has(quoted.key.id)) {
          const cached = rt.msgCache.get(quoted.key.id);
          if (cached?.mediaResult) return cached.mediaResult;
          if (cached?.message) {
            const cachedUnwrapped = unwrap(cached.message);
            if (mediaTypeOf(cachedUnwrapped)) {
              target = { key: cached.key || quoted.key, message: cached.message };
            }
          }
        }

        if (!target) return null;
        let m = unwrap(target.message);
        let t = mediaTypeOf(m);
        if (!t) return null;
        const node = m[t];
        if (node.directPath && !node.url) {
          node.url = 'https://mmg.whatsapp.net' + node.directPath;
        }

        const buffer = await api.download(target);
        let kind = t.replace('Message', '');
        const mime = node.mimetype || '';
        if (kind === 'document') { const major = mime.split('/')[0]; if (['image', 'video', 'audio'].includes(major)) kind = major; }
        const result = { buffer, mime, kind, node, ptt: Boolean(node.ptt), name: node.fileName, caption: node.caption, animated: Boolean(node.isAnimated), seconds: node.seconds };

        // Cache result if target was a view-once message
        if (targetId && (node.viewOnce || isViewOnceMsg(target.message))) {
          rt.voCache ||= new Map();
          rt.voCache.set(targetId, result);
          if (rt.voCache.size > 40) rt.voCache.delete(rt.voCache.keys().next().value);
        }
        return result;
      },
      needMedia: async (kinds, hint) => {
        const m = await ctx.media();
        const want = [].concat(kinds);
        if (!m || !want.includes(m.kind)) throw new UserError(hint || `Reply to ${want.map(k => 'a ' + k).join(' or ')} with this command.`);
        return m;
      },
      /** text from args or the replied message */
      input: () => ctx.args || textOf(quoted?.message) || '',
      cooldown: (secs, k = 'x') => {
        const id = `${ctx.cmd}:${k}:${ctx.senderNum}`;
        const last = rt.cool.get(id) || 0;
        if (Date.now() - last < secs * 1000) return false;
        rt.cool.set(id, Date.now());
        return true;
      }
    });
    return ctx;
  }

  function parseCommand(text, prefix) {
    const t = text.trim();
    if (!t || !prefix.includes(t[0])) return null;
    const m = t.slice(1).trim().match(/^(\S+)\s*([\s\S]*)$/);
    return m ? { cmd: m[1].toLowerCase(), args: m[2].trim() } : null;
  }

  const shortErr = e => String(e?.message || e).replace(/\s+/g, ' ').slice(0, 220);

  async function runCommand(ctx, d) {
    const entry = ctx.entry;
    const disabled = ctx.get('disabled', []);
    const disabledCats = ctx.get('disabledCats', []);
    if (!d.core && (disabled.includes(d.name) || disabledCats.includes(d.cat))) return;
    if (!ctx.isOwner && ctx.get('banned', []).includes(ctx.senderNum)) return; // banned users are ignored silently
    if (!ctx.isOwner && ctx.var('MAINTENANCE') === 'on') { if (ctx.cooldown(30, 'maint')) await ctx.reply(`🛠️ ${ctx.var('MAINTENANCE_MESSAGE') || 'The bot is under maintenance. Please try again later.'}`).catch(() => {}); return; }
    // Private mode: only the owner, sudo users and allowed users get answers; everyone else (group admins included) is ignored silently.
    if (ctx.var('MODE') === 'private' && !ctx.isOwner && !ctx.get('allowed', []).includes(ctx.senderNum)) return;
    // Optional global per-user spacing. Off by default since v1.2.0 (it used to be a hard-coded 1.5s); owner can set COOLDOWN:<seconds>.
    const gap = Number(ctx.var('COOLDOWN', 0)) || 0;
    if (gap > 0 && !ctx.isOwner && !ctx.cooldown(gap, 'all')) return;
    // The owner can open ordinary commands to everyone / admins, or lock one to themselves, with .access (see lib/access.js).
    const gate = access.resolve(d, ctx.get('access', {}), ctx.isOwner);
    if (gate.deny) return ctx.reply(gate.deny);
    if (gate.needOwner && !ctx.isOwner) return ctx.reply('🔒 This command is for the bot owner only.');
    if (d.group && !ctx.isGroup) return ctx.reply('👥 This command works in groups only.');
    if (gate.needAdmin && !ctx.isOwner && !(await ctx.admin())) return ctx.reply('🛡️ Only group admins can use this command.');
    if (d.botAdmin && !(await ctx.botAdmin())) return ctx.reply('⚠️ Make me a group admin first, then try again.');
    if (d.heavy) ctx.react('⏳');
    const commandStartedAt = Date.now();
    logger.info({ terminalEvent: 'command_start', command: d.name, sessionId: entry.sessionId, chatType: ctx.isGroup ? 'group' : 'private' }, `Command received: ${ctx.prefix}${d.name}`);
    // .autotyping / .autorecording (commands/whatsapp.js): a brief presence shown in the chat
    // while a command is running, cleared again once it's done either way.
    const presenceMode = ctx.get('autorecording', false) ? 'recording' : ctx.get('autotyping', false) ? 'composing' : null;
    if (presenceMode) ctx.sock.sendPresenceUpdate(presenceMode, ctx.chat).catch(() => {});
    try {
      await d.run(ctx);
      logger.info({ terminalEvent: 'command_success', command: d.name, sessionId: entry.sessionId, durationMs: Date.now() - commandStartedAt }, `Command completed: ${ctx.prefix}${d.name}`);
      if (d.heavy) ctx.react('✅');
      if (ctx.isGroup && d.group && d.admin) { // moderation log: what admins did with the bot's moderation tools
        ctx.update('modlog', {}, o => { const l = (o[ctx.chat] ||= []); l.push({ at: Date.now(), by: ctx.senderNum, cmd: d.name, args: String(ctx.args || '').slice(0, 60) }); if (l.length > 50) l.shift(); });
      }
    } catch (e) {
      if (d.heavy) ctx.react('❌');
      if (e instanceof UserError) return ctx.reply('⚠️ ' + e.message).catch(() => {});
      logger.error({ terminalEvent: 'command_failed', command: d.name, sessionId: entry.sessionId, durationMs: Date.now() - commandStartedAt, error: e?.message, stack: String(e?.stack || '').split('\n').slice(0, 4).join(' | ') }, `Command failed: ${ctx.prefix}${d.name}`);
      await ctx.reply(`❌ *${d.name}* failed: ${shortErr(e)}`).catch(() => {});
    } finally {
      if (presenceMode) ctx.sock.sendPresenceUpdate('paused', ctx.chat).catch(() => {});
    }
  }

  async function onMessage(entry, msg, type) {
    const rt = entry.rt;
    const key = msg.key;
    if (!msg.message || !key?.remoteJid || !key.id) return;
    const chat = key.remoteJid;
    if (chat.endsWith('@newsletter') || chat.endsWith('@broadcast') && chat !== 'status@broadcast') return;
    if (rt.sent.has(key.id)) return;
    // WhatsApp sometimes delivers the same message twice (live + offline sync). Handle each message id once.
    rt.seenIds ||= new Set();
    const dedupeId = `${chat}|${key.id}`;
    if (rt.seenIds.has(dedupeId)) return;
    rt.seenIds.add(dedupeId);
    if (rt.seenIds.size > 1500) rt.seenIds.delete(rt.seenIds.values().next().value);

    const content = unwrap(msg.message);
    const text = textOf(content).trim();
    if (chat !== 'status@broadcast') {
      rt.msgCache.set(key.id, {
        key,
        message: msg.message,
        content,
        text,
        sender: key.participant || chat,
        chat,
        at: Date.now()
      });
      if (rt.msgCache.size > 5000) rt.msgCache.delete(rt.msgCache.keys().next().value);
    }

    // Proactively buffer view-once media so it is instantly retrievable even if deleted or opened later
    if (isViewOnceMsg(msg.message) && chat !== 'status@broadcast') {
      rt.voCache ||= new Map();
      (async () => {
        try {
          const u = unwrap(msg.message);
          const t = mediaTypeOf(u);
          if (t && u[t] && !(Number(node_len(u[t])) > 40 * 1024 * 1024)) { // very large clips are not kept in memory (small panels run out of RAM)
            const node = u[t];
            if (node.directPath && !node.url) node.url = 'https://mmg.whatsapp.net' + node.directPath;
            const buffer = await entry.api.download({ key, message: msg.message });
            let kind = t.replace('Message', '');
            const mime = node.mimetype || '';
            if (kind === 'document') { const major = mime.split('/')[0]; if (['image', 'video', 'audio'].includes(major)) kind = major; }
            const voItem = { buffer, mime, kind, node, ptt: Boolean(node.ptt), name: node.fileName, caption: node.caption, animated: Boolean(node.isAnimated), seconds: node.seconds };
            rt.voCache.set(key.id, voItem);
            if (rt.voCache.size > 40) rt.voCache.delete(rt.voCache.keys().next().value);
          }
        } catch (e) {
          logger.debug({ id: key.id, error: e?.message }, 'Background view-once buffer failed');
        }
      })();
    }

    const ctx = buildCtx(entry, msg, text);
    if (type === 'append' && !ctx.fresh && chat !== 'status@broadcast') return;
    ctx.prefix = String(ctx.var('PREFIX') || '.');

    for (const h of commandHooks) {
      try { if (await h.run(ctx)) return; }
      catch (e) { logger.error({ hook: h.name, error: e?.message, stack: String(e?.stack || '').split('\n').slice(0, 3).join(' | ') }, 'Hook failed'); }
    }

    if (!ctx.fresh || chat === 'status@broadcast' || !text) return;
    // A tap on a button whose id is "cmd:<command line>" runs that command as the person who tapped — anyone in
    // the chat can tap; owner/admin-only commands still apply their normal checks to the tapper.
    let line = text;
    if (content?.interactiveResponseMessage) {
      logger.info({ sessionId: entry.sessionId, chatType: ctx.isGroup ? 'group' : 'private', reason: String(text).slice(0, 60) }, 'Button tap received');
      const tap = /^cmd:([\w .\-:@+]{1,100})$/.exec(text);
      if (tap) { line = ctx.prefix + tap[1].trim(); ctx.text = line; logger.info({ sessionId: entry.sessionId, command: tap[1].trim().split(' ')[0] }, 'Button tapped'); }
    }
    const parsed = parseCommand(line, ctx.prefix);
    if (!parsed) return;
    let d = commands.registry.get(parsed.cmd);
    if (!d) { // owner-defined shortcut (.alias) — resolves to a real command and then goes through every normal check
      const target = String(ctx.get('aliases', {})?.[parsed.cmd] || '').trim();
      if (target) {
        const [name, ...preset] = target.split(/\s+/);
        const real = commands.registry.get(name.toLowerCase());
        if (real) { d = real; parsed.cmd = real.name; parsed.args = [preset.join(' '), parsed.args].filter(Boolean).join(' '); }
      }
    }
    if (!d) {
      logger.debug({ terminalEvent: 'unknown_command', sessionId: entry.sessionId, chatType: chat.endsWith('@g.us') ? 'group' : 'private', command: parsed.cmd }, `Unknown command: ${ctx.prefix}${parsed.cmd}`);
      return;
    }
    ctx.cmd = parsed.cmd;
    ctx.args = parsed.args;
    ctx.argv = parsed.args ? parsed.args.split(/\s+/) : [];
    await runCommand(ctx, d);
  }

  /* --------------------------------- attach -------------------------------- */
  function attach(entry) {
    const sock = entry.socket;
    entry.api ||= makeApi(entry);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (entry.stale) return;
      for (const msg of messages) {
        try { await onMessage(entry, msg, type); }
        catch (e) { logger.error({ error: e?.message, sessionId: entry.sessionId, stack: String(e?.stack || '').split('\n').slice(0, 3).join(' | ') }, 'Message handling failed'); }
      }
    });

    sock.ev.on('groups.update', ups => { for (const u of ups) if (u.id) entry.rt.groupCache.delete(u.id); });
    sock.ev.on('group-participants.update', ev => { if (ev.id) entry.rt.groupCache.delete(ev.id); });

    const seen = new Set();
    for (const e of commandEvents) {
      if (e.name === 'messages.upsert') continue;
      sock.ev.on(e.name, async payload => {
        if (entry.stale) return;
        try { await e.run(entry.api, payload); }
        catch (err) { logger.error({ event: e.name, error: err?.message, stack: String(err?.stack || '').split('\n').slice(0, 3).join(' | ') }, 'Event handler failed'); }
      });
      seen.add(e.name);
    }
  }

  async function prepare(entry) {
    await store.load(entry.sessionId);
    await U.getThumb();
    entry.api = makeApi(entry);
  }

  let lastTick = 0;
  async function tick(sessions) {
    if (Date.now() - lastTick < 4000) return;
    lastTick = Date.now();
    LIVE_SESSIONS = sessions.size;
    for (const entry of sessions.values()) {
      if (!entry.connected || !entry.socket || entry.stale || !entry.api) continue;
      for (const t of commandTickers) {
        try { await t.run(entry.api); }
        catch (e) { logger.error({ ticker: t.name, error: e?.message }, 'Ticker failed'); }
      }
    }
  }

  return { newRuntime, prepare, attach, tick, groupCacheGetter: entry => async jid => entry.rt?.groupCache.get(jid)?.meta };
}

module.exports = { dropTapQuote, createBot, LOG_RING, LOG_RING_MAX, liveSessions: () => LIVE_SESSIONS, forwardify, FOOTER, FRAME_STYLES, frame, adContext, CHANNEL_URL, DEFAULT_VARS, jidUser, isGroupJid, pids, unwrap, ctype, textOf };
