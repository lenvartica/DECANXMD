'use strict';
/**
 * Extra names for existing commands. Every alias below points at a command that really does that job
 * (for example .groupopen → .open, .tiktokdl → .tiktok). Names that are already taken are skipped, so this
 * file can never break loading. Loaded last (zz- prefix) so all targets exist.
 *
 * Also here: a few small commands that were missing — channel unfollow/mute/stats and a QR-pairing pointer.
 */
const U = require('../lib/util');
const { UserError } = U;

/** target command -> extra names */
const ALIASES = {
  // owner & sudo
  broadcast: ['bc'], setsudo: ['addowner', 'addsudo', 'setowner'], delsudo: ['delowner'], getsudo: ['ownerlist', 'sudolist'],
  backup: ['exportdb', 'backupsession', 'sessionbackup'], restore: ['importdb', 'restoredb', 'sessionrestore'],
  // group
  ginfo: ['group', 'groupall'], invite: ['glink', 'ginvite', 'groupinvitecode'], tagall: ['tagmembers'], close: ['lock', 'groupclose'], open: ['unlock', 'groupopen'],
  gpp: ['setgpp', 'groupicon'], approve: ['accept', 'groupapprove'], reject: ['groupreject'], rules: ['grouprules'], welcome: ['setwelcome'], goodbye: ['setgoodbye'],
  mute: ['groupmute'], unmute: ['groupunmute'], warn: ['groupwarn'], reset: ['groupreset'], setdesc: ['groupdesc'], admins: ['groupadmins', 'leaders'], members: ['groupmembers'],
  msgs: ['groupactivity'], modlog: ['groupaudit'], hidetag: ['announce'], promote: ['mod'], demote: ['unmod'], left: ['leavegroup'],
  // music & downloads
  yta: ['audio'], lyrics: ['lyric'], song: ['downloadsong'], video: ['yt', 'youtube', 'youtubedl'], tiktok: ['tiktokdl', 'tiktokvideo'], insta: ['reels', 'instadl', 'instagramdl'],
  fb: ['fbdown', 'facebookdl', 'facebookstory'], twitter: ['x', 'twitterdl', 'twittervideo'], pinterest: ['pinterestdl', 'pinterestvideo'], story: ['instagramstory'], reddit: ['redditsave'],
  videothumbnail: ['screenshotvideo'], short: ['shorturl'], expandurl: ['unshorturl'], apk: ['downloadapk'], doc: ['document'],
  filecheck: ['fileinfo', 'filetype', 'filemime', 'filemetadata'], hashcheck: ['filehash'], ss: ['downloadstatus', 'statusdl', 'statusdownload', 'statussave', 'savestatus'],
  yts: ['youtube-search'], img: ['image-search'], enhance: ['restorephoto'],
  // utilities & status
  remind: ['remindme', 'alarmset', 'alarm'], note: ['notepad'], quote: ['randomquote'], fancy: ['fancytext'],
  autoreactstatus: ['statusreact', 'statusreaction', 'autolike'], privacy: ['statusprivacy'], autoviewstatus: ['readstatus', 'autoview', 'autostatus'],
  vv: ['readvo', 'viewonce', 'reveal', 'recover', 'savevo', 'getvo', 'voimage', 'vovideo', 'voaudio', 'voextract', 'vosave', 'vodownload', 'vopreview'],
  vv2: ['readvo2', 'viewonce2', 'reveal2', 'recover2', 'savevo2', 'getvo2', 'voprivate', 'vome'],
  // channel
  channel: ['channelinfo', 'channelinvite', 'channelview', 'channelshare', 'channelpreview'], creact: ['channelreact', 'channelreaction'], postupdate: ['channelupdate'], forwardmode: ['channelforward'],
  // stickers
  take: ['rename'], emix: ['emojimix'], sticker: ['stickermaker'], gifconvert: ['gif', 'gifmaker'], videocaption: ['gifcaption'], reverse: ['gifreverse'], react: ['reaction'],
  photo: ['stickerconvert', 'stickerextract', 'stickerdownload'], url: ['stickerupload'],
  // config
  allvar: ['getconfig'], setvar: ['setconfig'], resetsettings: ['resetconfig'], language: ['lang', 'setlanguage'], autoreadmessages: ['autoread', 'setread'], autoreact: ['setreaction'],
  filter: ['autoreply', 'setautoreply', 'addfilter', 'setfilter'], stop: ['delautoreply', 'delfilter'], filters: ['listautoreply'], antidelete: ['setantidelete'], antiviewonce: ['setantiviewonce'],
  antilink: ['setantilink'], antispam: ['setantispam', 'setantiflood'], setgreet: ['autogreet'], typing: ['settyping'], recording: ['setrecording'],
  // stats & pairing
  stats: ['botstats'], memoryusage: ['ram'], queue: ['queueinfo'], jobs: ['jobstatus'], connection: ['session'], owner: ['ownerinfo'], ping: ['latency', 'response'], errors: ['errorlogs'],
  pair: ['connect', 'paircode', 'pairingcode', 'botpair', 'devicepair', 'devicecode', 'link', 'linkdevice', 'adddevice', 'deviceadd', 'relink'],
  logout: ['disconnect', 'botlogout', 'botdisconnect', 'unlink', 'unlinkdevice', 'devicedisconnect', 'sessiondelete'],
  reconnect: ['botreconnect', 'botconnect', 'deviceconnect', 'reauth', 'refreshsession'], restart: ['botrestart'], sessions: ['botlist', 'sessionlist']
};

module.exports = ({ def: rawDef, alias, registry }) => {
  let added = 0;
  for (const [target, names] of Object.entries(ALIASES)) {
    if (!registry.has(target)) continue;
    const fresh = names.filter(n => !registry.has(n.toLowerCase()));
    if (fresh.length) { alias(target, ...fresh); added += fresh.length; }
  }
  const def = (names, opts, run) => { const n = [].concat(names).filter(x => !registry.has(x.toLowerCase())); if (n.length) rawDef(n, opts, run); };
  const P = ctx => ctx.var('PREFIX');

  /* ------------------------------- channel: unfollow / mute / stats ------------------------------- */
  const channel = async ctx => { const i = await ctx.channelInfo?.(); if (!i?.jid) throw new UserError('I could not find your channel. Set CHANNEL_URL (or use .setchannel) first.'); return i; };
  def('unfollowchannel', { cat: 'community', owner: true, desc: 'Unfollow the bot\'s configured channel with this account.' }, async ctx => {
    const i = await channel(ctx); if (typeof ctx.sock.newsletterUnfollow !== 'function') throw new UserError('This WhatsApp library version cannot unfollow channels.');
    await ctx.sock.newsletterUnfollow(i.jid); await ctx.reply(`✅ Unfollowed *${i.name}*.`);
  });
  for (const [name, fn, word] of [['channelmute', 'newsletterMute', 'muted'], ['channelunmute', 'newsletterUnmute', 'unmuted']]) {
    def(name, { cat: 'community', owner: true, desc: `Mute or unmute the bot's channel notifications for this account.` }, async ctx => {
      const i = await channel(ctx); if (typeof ctx.sock[fn] !== 'function') throw new UserError('This WhatsApp library version cannot change channel notifications.');
      await ctx.sock[fn](i.jid); await ctx.reply(`🔔 *${i.name}* is now ${word}.`);
    });
  }
  def(['channelstats', 'channelfollowers', 'channelmembers'], { cat: 'community', desc: 'Followers and details of the bot\'s channel.' }, async ctx => {
    const i = await channel(ctx); const m = await ctx.sock.newsletterMetadata('jid', i.jid).catch(() => null); if (!m) throw new UserError('WhatsApp did not return the channel details right now.');
    const subs = m.subscribers ?? m.thread_metadata?.subscribers_count; const name = m.name || m.thread_metadata?.name?.text || i.name;
    await ctx.reply(`📢 *${name}*\n👥 Followers: *${subs != null ? Number(subs).toLocaleString('en-US') : 'unknown'}*\n${m.verification || m.thread_metadata?.verification ? '✅ Verified\n' : ''}🔗 ${process.env.CHANNEL_URL || ''}`.trim(), { title: 'Channel' });
  });

  /* --------------------------------------- pairing by QR --------------------------------------- */
  def(['getqr', 'refreshqr', 'pairingqr', 'botqr', 'deviceqr'], { cat: 'bot', owner: true, desc: 'How to link a number with a QR code.' }, ctx =>
    ctx.reply(`📷 QR pairing is shown on the bot's web page (the pairing page of your dashboard). Open it, choose *QR code*, then scan it from WhatsApp → Linked devices.\n\nPrefer a code? Send *${P(ctx)}pair <number with country code>* and enter the 8-letter code in WhatsApp → Linked devices → Link with phone number.`, { title: 'Link with QR' }));

  void added;
};

module.exports.ALIASES = ALIASES;
