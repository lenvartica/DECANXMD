'use strict';
/**
 * Post to the WhatsApp channel from the bot (works when the account linked to the bot owns or administers the channel).
 *   .postupdate <text>            post text   (reply to a photo/video to post it with that text as the caption)
 *   .postupdate release           post the release notes of the running version (from CHANGELOG.md)
 *   .channelauto on|off|status    auto-post release notes whenever the bot is updated to a new version
 *   .channelstatus                shows the channel, the bot account's role and whether posting is allowed
 * Live scores can also go to the channel: .livealerts channel on epl • .matchday channel on 08:00
 */
const fs = require('fs');
const path = require('path');
const { UserError, bold } = require('../lib/util');

const VERSION = require('../package.json').version;

/**
 * Parsed release notes of a version: { version, title, items[] } or null.
 * CHANGELOG.md headers look like "## 🔥 VERSION 3.6.1" (an emoji + "VERSION " before the number,
 * not the bare version number itself) — matching on a literal startsWith(version) never found
 * anything, which is why `.postupdate release` and the auto-post-on-update ticker below were both
 * silently broken. This matches the version number anywhere in the header line instead.
 */
function parseNotes(version = VERSION) {
  let md = '';
  try { md = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'); } catch { return null; }
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerRe = new RegExp(`^## .*?\\bVERSION\\s+${escaped}\\b\\s*[—-]?\\s*(.*)$`, 'm');
  const sections = md.split(/^## /m).slice(1);
  const sec = sections.find(p => headerRe.test('## ' + p.split('\n')[0]));
  if (!sec) return null;
  const [head, ...rest] = sec.trim().split('\n');
  const title = (headerRe.exec('## ' + head)?.[1] || '').trim();
  const items = rest.map(l => l.trim()).filter(Boolean).filter(l => l !== '---')
    .map(l => (/^###\s+/.test(l) ? `*${l.replace(/^###\s+/, '')}*` : l.replace(/^[-*]\s+/, '')))
    .map(l => l.replace(/`([^`]+)`/g, '*$1*').replace(/\*\*(.+?)\*\*/g, '*$1*')); // markdown bold -> WhatsApp bold
  return { version, title, items };
}

/**
 * Release notes split into WhatsApp-sized pages. Items under the same "*Section*" heading are listed together with one
 * line break between them (not a blank line each), so a long changelog stays readable instead of one endless wall.
 */
function notesPages(version = VERSION, max = 2800) {
  const n = parseNotes(version);
  if (!n) return null;
  const lines = [];
  for (const it of n.items) {
    if (/^\*[^*]+\*$/.test(it)) lines.push('', `📌 ${it}`);           // section heading
    else lines.push(`◈ ${it}`);
  }
  const pages = []; let cur = '';
  for (const l of lines) {
    const piece = (cur ? '\n' : '') + l;
    if (cur && (cur + piece).length > max) { pages.push(cur.trim()); cur = l.replace(/^\n/, ''); } else cur += piece;
  }
  if (cur.trim()) pages.push(cur.trim());
  return { ...n, pages: pages.length ? pages : [''] };
}
/** one framed page of the release notes (1-based). Without a page number the first page is returned. */
function notesText(api, version = VERSION, page = 1) {
  const n = notesPages(version);
  if (!n) return '';
  const i = Math.min(Math.max(1, page | 0), n.pages.length);
  const head = i === 1 ? `🚀 ${bold('What\'s new')}${n.title ? ` — ${n.title}` : ''}\n\n` : '';
  const foot = `\n\n🔖 ${bold('Version')} v${n.version}${n.pages.length > 1 ? `  ·  📄 ${i}/${n.pages.length}` : ''}`;
  return api.frame(`${head}${n.pages[i - 1]}${foot}`, `Update v${n.version}`);
}
const releaseNotes = (version = VERSION) => { const n = parseNotes(version); return n ? `${n.title} ${n.items.join(' ')}` : ''; };

const friendly = e => {
  const m = String(e?.message || e);
  if (/forbidden|403|not.?authorized|admin|permission|401/i.test(m)) return new UserError('WhatsApp refused the post. Only the account that owns or administers the channel can post. Link the bot with that account, or make the bot account an admin of the channel. Check with *.channelstatus*.');
  return new UserError(`Could not post to the channel (${m.slice(0, 90)}).`);
};

module.exports = ({ def, tickers }) => {
  async function channelJid(ctx) {
    const info = await ctx.channelInfo();
    if (!info?.jid) throw new UserError('I could not find your channel. Set it with *' + ctx.var('PREFIX') + 'setchannel 1203630…@newsletter*.');
    return info.jid;
  }

  def(['postupdate', 'channelpost', 'cpost'], { cat: 'community', owner: true, usage: 'postupdate <text> • postupdate release • (reply to a photo or video to post it)', desc: 'Post an update to your WhatsApp channel. Use "release" to post the current version\'s release notes.' }, async ctx => {
    const jid = await channelJid(ctx);
    let text = ctx.input().trim(), releasePages = 0;
    const media = await ctx.media().catch(() => null);
    if (/^(release|changelog|notes)$/i.test(text)) {
      text = notesText(ctx);
      if (!text) throw new UserError('No release notes found for this version in CHANGELOG.md.');
      releasePages = notesPages().pages.length;
    } else if (text && !media) text = ctx.frame(text, 'Update');
    if (!text && !media) throw new UserError(`Give me something to post: *${ctx.var('PREFIX')}postupdate New feature: live scores are here!* or reply to a photo.`);
    try {
      if (media?.kind === 'image') await ctx.sendTo(jid, { image: media.buffer, caption: text });
      else if (media?.kind === 'video') await ctx.sendTo(jid, { video: media.buffer, caption: text, mimetype: 'video/mp4' });
      else if (media) throw new UserError('Only photos and videos can be posted this way.');
      else {
        await ctx.sendTo(jid, { text });
        for (let pg = 2; pg <= releasePages; pg++) await ctx.sendTo(jid, { text: notesText(ctx, VERSION, pg) });
      }
    } catch (e) { throw e instanceof UserError ? e : friendly(e); }
    await ctx.reply('✅ Posted to your channel.', { title: 'Channel update' });
  });

  def('channelauto', { cat: 'community', owner: true, usage: 'channelauto on|off|status', desc: 'Automatically post release notes to your channel each time the bot is updated to a new version.' }, async ctx => {
    const a = (ctx.argv[0] || 'status').toLowerCase();
    if (a === 'on') {
      ctx.update('vars', {}, v => { v.CHANNEL_AUTOPOST = 'on'; });
      if (!ctx.get('announcedVersion', '')) ctx.set('announcedVersion', VERSION);
      return ctx.reply(`📡 Auto-posting is ON.\nThe next update after v${VERSION} will be announced in your channel automatically.\nPost the current notes now with *${ctx.var('PREFIX')}postupdate release*.`, { title: 'Channel auto-post' });
    }
    if (a === 'off') { ctx.update('vars', {}, v => { v.CHANNEL_AUTOPOST = 'off'; }); return ctx.reply('🔕 Auto-posting is OFF.', { title: 'Channel auto-post' }); }
    await ctx.reply(`Auto-post: ${bold(ctx.var('CHANNEL_AUTOPOST') === 'on' ? 'ON' : 'OFF')}\nRunning version: ${bold('v' + VERSION)}\nLast announced: ${ctx.get('announcedVersion', '') ? 'v' + ctx.get('announcedVersion', '') : 'none'}`, { title: 'Channel auto-post' });
  });

  tickers.push({
    name: 'release-notes', run: async api => {
      if (api.var('CHANNEL_AUTOPOST') !== 'on') return;
      if (Date.now() - (api.rt.relCheck || 0) < 120000) return;
      api.rt.relCheck = Date.now();
      const done = api.get('announcedVersion', '');
      if (done === VERSION) return;
      if (!done) { api.set('announcedVersion', VERSION); return; } // first time: never post old history
      const notes = notesText(api);
      api.set('announcedVersion', VERSION);
      if (!notes) return;
      try {
        const info = await api.channelInfo();
        if (info?.jid) { await api.sendTo(info.jid, { text: notes }); for (let pg = 2; pg <= notesPages().pages.length; pg++) await api.sendTo(info.jid, { text: notesText(api, VERSION, pg) }); }
      } catch (e) { api.logger.warn({ error: e?.message }, 'Release notes post failed'); }
    }
  });
};

module.exports._test = { releaseNotes, parseNotes, notesText, notesPages, VERSION };
