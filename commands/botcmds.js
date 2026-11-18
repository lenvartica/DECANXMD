'use strict';
const U = require('../lib/util');
const { UserError, bold } = U;

module.exports = ({ def, tickers }) => {
  const idx = () => require('./index');
  const normalizeRepo = value => String(value || '').trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');

  /* ---------------- pair new numbers ---------------- */
  def('pair', { cat: 'bot', owner: true, heavy: true, usage: 'pair <number with country code>', desc: 'Get a pairing code to link another WhatsApp number to this bot.' }, async ctx => {
    const num = ctx.args.replace(/\D/g, '');
    if (num.length < 8 || num.length > 15 || num.startsWith('0')) throw new UserError(`Give the number with country code, no + or spaces, e.g. *${ctx.var('PREFIX')}pair 254712345678*`);
    let r;
    try { r = await ctx.pairNumber(num); }
    catch (e) { throw new UserError(e.message); }
    if (r.connected || r.alreadyRegistered || !r.code) throw new UserError(`+${num} is already linked. Unlink it in WhatsApp > Linked devices first if you want to pair it again.`);
    const to = ctx.isGroup ? ctx.ownerJid : ctx.chat;
    const pretty = r.code.length === 8 ? `${r.code.slice(0, 4)}-${r.code.slice(4)}` : r.code;
    const steps = [
      `${bold('Number')}: +${num}`,
      '',
      '*How to link it* 👇',
      '1️⃣ Open WhatsApp on that phone',
      '2️⃣ Tap *Settings* → *Linked devices* → *Link a device*',
      '3️⃣ Choose *Link with phone number instead*',
      '4️⃣ Enter the code I am sending in the next message',
      '',
      '⏱ The code expires in about a minute, so be quick.',
      '🔐 Never share it with anyone you do not trust.'
    ].join('\n');
    await ctx.sendTo(to, { text: ctx.frame(steps, { title: '🔗 Pair a device' }) }, { quoted: ctx.msg });
    // The code goes alone in its own message so it is easy to long-press and copy.
    await ctx.sendTo(to, { text: pretty });
    if (ctx.isGroup) await ctx.reply('📩 I sent the pairing steps and code to your private chat.');
    else await Promise.resolve(ctx.react?.('✅')).catch(() => {});
  });

  /* ---------------- repo ---------------- */
  def('repo', { cat: 'bot', public: true, desc: 'Show the bot\'s source code repository and channel.' }, async ctx => {
    const repo = normalizeRepo(process.env.GITHUB_REPO);
    const url = process.env.REPO_URL || (repo ? `https://github.com/${repo}` : null);
    const lines = [];
    if (!url) lines.push('📦 Repository link is not set. Add *REPO_URL* or *GITHUB_REPO* to the local .env file and restart the bot.');
    else {
      lines.push(`📦 ${bold('Repository')}: ${url}`);
      if (repo) {
        try {
          const g = await U.getJson(`https://api.github.com/repos/${repo}`, { headers: { accept: 'application/vnd.github+json' }, timeout: 10000 });
          lines.push(`⭐ ${bold('Stars')}: ${g.stargazers_count}   🍴 ${bold('Forks')}: ${g.forks_count}`, `🕒 ${bold('Updated')}: ${new Date(g.pushed_at).toDateString()}`);
          if (g.description) lines.push(`📝 ${g.description}`);
        } catch {}
      }
    }
    lines.push('', `👤 ${bold('Owner')}: ${ctx.OWNER_NAME} • ${ctx.COMPANY_NAME}`);
    await ctx.send({ text: ctx.frame(lines.join('\n'), { title: 'Repo' }), contextInfo: ctx.adContext(true) }, { quoted: ctx.msg });
  });

  /* ---------------- backup ---------------- */
  def('backup', { cat: 'bot', owner: true, desc: 'Send yourself a JSON backup of your bot settings (secrets are hidden).' }, async ctx => {
    const data = ctx.store.export(ctx.sid);
    for (const k of ['yt_cookies', 'gdrive']) if (data[k]) data[k] = '[hidden]';
    const buf = Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), session: ctx.sid, data }, null, 2));
    await ctx.sendTo(ctx.ownerJid, { document: buf, fileName: `decanxmd-backup-${new Date().toISOString().slice(0, 10)}.json`, mimetype: 'application/json', caption: '🗄️ Settings backup' });
    if (ctx.chat !== ctx.ownerJid) await ctx.reply('🗄️ Backup sent to your own chat.');
  });

  /* ---------------- reminders ---------------- */
  def('reminder', { cat: 'bot', owner: true, usage: 'reminder <10m|2h|1d|HH:MM> <text> • reminder list • reminder del <n>', desc: 'Get a reminder after a delay or at a time of day (bot timezone).' }, async ctx => {
    const a = ctx.argv[0]?.toLowerCase();
    const all = ctx.get('reminders', []);
    if (!a || a === 'list') {
      const mine = all.filter(r => r.chat === ctx.chat);
      return ctx.reply(mine.length ? mine.map((r, i) => `${i + 1}. ⏰ ${new Date(r.at).toLocaleString('en-GB', { timeZone: ctx.tz() })} — ${r.text}`).join('\n') : `No reminders. Try *${ctx.var('PREFIX')}reminder 30m call mum*`, { title: 'Reminders' });
    }
    if (a === 'del' || a === 'delete') {
      const mine = all.filter(r => r.chat === ctx.chat);
      const drop = ctx.argv[1] === 'all' ? mine : [mine[Number(ctx.argv[1]) - 1]].filter(Boolean);
      if (!drop.length) throw new UserError('No reminder with that number.');
      const ids = new Set(drop.map(r => r.id));
      ctx.update('reminders', [], l => { for (let i = l.length - 1; i >= 0; i--) if (ids.has(l[i].id)) l.splice(i, 1); });
      return ctx.reply(`🗑️ Deleted ${drop.length} reminder(s).`);
    }
    let at = null;
    const rest = () => ctx.args.slice(ctx.argv[0].length).trim();
    const clock = ctx.argv[0].match(/^(\d{1,2}):(\d{2})$/);
    if (clock && +clock[1] < 24 && +clock[2] < 60) at = U.nextClock(ctx.tz(), +clock[1], +clock[2]);
    else { const ms = U.parseDuration(ctx.argv[0]); if (ms) at = Date.now() + ms; }
    const text = rest() || ctx.textOf(ctx.quoted?.message);
    if (!at || !text) throw new UserError(`Usage: *${ctx.var('PREFIX')}reminder 30m drink water* or *${ctx.var('PREFIX')}reminder 18:30 gym*`);
    if (at - Date.now() < 5000) throw new UserError('That time is too soon.');
    ctx.update('reminders', [], l => { l.push({ id: Date.now().toString(36), at, chat: ctx.chat, text, by: ctx.senderNum }); });
    await ctx.reply(`⏰ Reminder set for ${new Date(at).toLocaleString('en-GB', { timeZone: ctx.tz() })} (in ${U.fmtDur((at - Date.now()) / 1000)}):\n${text}`);
  });
  tickers.push({
    name: 'reminders', run: async api => {
      const due = api.get('reminders', []).filter(r => Date.now() >= r.at);
      if (!due.length) return;
      for (const r of due) { try { await api.sendTo(r.chat, { text: api.frame(`⏰ ${bold('Reminder')}\n\n${r.text}`) }); } catch {} }
      const ids = new Set(due.map(r => r.id));
      api.update('reminders', [], l => { for (let i = l.length - 1; i >= 0; i--) if (ids.has(l[i].id)) l.splice(i, 1); });
    }
  });

  /* ---------------- tasks ---------------- */
  def('task', { cat: 'bot', owner: true, usage: 'task add <text> • task list • task done <n> • task del <n> • task clear', desc: 'A simple to-do list.' }, async ctx => {
    const a = (ctx.argv[0] || 'list').toLowerCase();
    const list = ctx.get('tasks', []);
    const show = l => (l.length ? l.map((t, i) => `${i + 1}. ${t.done ? '✅ ~' + t.text + '~' : '⬜ ' + t.text}`).join('\n') : 'Your list is empty. Add one with *task add buy milk*');
    if (a === 'list') return ctx.reply(show(list), { title: 'Tasks' });
    if (a === 'add') {
      const t = ctx.args.slice(3).trim();
      if (!t) throw new UserError('What is the task?');
      ctx.update('tasks', [], l => { l.push({ text: t, done: false }); });
      return ctx.reply(`➕ Added.\n\n${show(ctx.get('tasks', []))}`, { title: 'Tasks' });
    }
    if (a === 'clear') { ctx.set('tasks', list.filter(t => !t.done)); return ctx.reply('🧹 Completed tasks cleared.'); }
    const n = Number(ctx.argv[1]) - 1;
    if (!['done', 'del', 'delete', 'undo'].includes(a) || !(n >= 0 && n < list.length)) throw new UserError('Use: task add <text> | list | done <n> | del <n> | clear');
    ctx.update('tasks', [], l => { if (a === 'done') l[n].done = true; else if (a === 'undo') l[n].done = false; else l.splice(n, 1); });
    await ctx.reply(show(ctx.get('tasks', [])), { title: 'Tasks' });
  });

  /* ---------------- tog ---------------- */
  def('tog', { cat: 'bot', owner: true, core: true, usage: 'tog <command>', desc: 'Switch a single command on or off.' }, async ctx => {
    const { registry } = idx();
    const n = (ctx.argv[0] || '').toLowerCase().replace(/^[^a-z0-9]+/, '');
    const off = ctx.get('disabled', []);
    if (!n) return ctx.reply(off.length ? `⛔ Switched off: ${off.join(', ')}` : 'No commands are switched off.\nUse *tog <command>* to toggle one.', { title: 'Toggles' });
    const d = registry.get(n);
    if (!d || !d.cat) throw new UserError('Unknown command.');
    if (d.core) throw new UserError('That command is needed to manage the bot and cannot be switched off.');
    let nowOff;
    ctx.update('disabled', [], l => { const i = l.indexOf(d.name); if (i >= 0) { l.splice(i, 1); nowOff = false; } else { l.push(d.name); nowOff = true; } });
    await ctx.reply(nowOff ? `⛔ *${d.name}* is now OFF.` : `✅ *${d.name}* is now ON.`);
  });

  /* ---------------- update ---------------- */
  def('update', { cat: 'bot', owner: true, core: true, heavy: true, usage: 'update • update now', desc: 'Check for a new version or get local update instructions.' }, async ctx => {
    const now = /^now$/i.test(ctx.argv[0] || '');
    const current = (process.env.RENDER_GIT_COMMIT || '').slice(0, 7);
    if (now) {
      const hook = process.env.RENDER_DEPLOY_HOOK_URL;
      if (hook) {
        await U.http(hook, { method: 'POST', timeout: 20000, as: 'text' });
        return ctx.reply('🚀 Redeploy triggered. I will restart shortly and come back online in a minute or two.');
      }
      if (process.env.RENDER) throw new UserError('No deploy hook is configured. Update the connected service from its hosting dashboard.');
      return ctx.reply('This command does not download or replace code. Update the project files on this PC, then restart START.bat; it will start the bot again.');
    }
    const repo = normalizeRepo(process.env.GITHUB_REPO);
    const lines = [`${bold('Version')}: ${require('../package.json').version}`, `${bold('Running commit')}: ${current || 'unknown'}`];
    if (!repo) {
      lines.push('', 'To check for upstream commits, add GITHUB_REPO (owner/repo) to the local .env file and restart the bot.');
    } else {
      const branch = process.env.GITHUB_BRANCH || 'main';
      const c = await U.getJson(`https://api.github.com/repos/${repo}/commits/${branch}`, { headers: { accept: 'application/vnd.github+json' } });
      const latest = String(c.sha || '').slice(0, 7);
      lines.push(`${bold('Latest commit')}: ${latest} — ${String(c.commit?.message || '').split('\n')[0]}`);
      lines.push('', !current ? `Latest upstream commit: ${latest}. This local install has no Git commit metadata; update the project files on this PC, then restart START.bat.` : latest === current ? '✅ You are up to date.' : `⬆️ Update available! Update the project files on this PC, then restart START.bat.`);
    }
    await ctx.reply(lines.join('\n'), { title: 'Update' });
  });

  /* ---------------- ytlogin ---------------- */
  def('ytlogin', { cat: 'bot', owner: true, usage: 'ytlogin <cookies> (or reply to a cookies.txt file) • ytlogin off', desc: 'Give the downloader your browser cookies (Netscape cookies.txt) so YouTube/Instagram downloads work from the server.' }, async ctx => {
    if (/^(off|delete|remove)$/i.test(ctx.args)) { ctx.del('yt_cookies'); return ctx.reply('🗑️ Cookies removed.'); }
    let text = ctx.args;
    const m = await ctx.media().catch(() => null);
    if (m && ['document', 'text'].includes(m.kind) || (m && m.mime.startsWith('text/'))) text = m.buffer.toString('utf8');
    if (!text) text = ctx.textOf(ctx.quoted?.message);
    if (!text || !/(youtube|instagram|google|tiktok)\.com|# Netscape/i.test(text) || text.length < 40) {
      throw new UserError('Export your cookies with a browser extension ("Get cookies.txt LOCALLY"), then send the file here with *ytlogin* as the caption, or reply to it with *ytlogin*.');
    }
    ctx.set('yt_cookies', text.trim().replace(/\r/g, ''));
    await ctx.sock.sendMessage(ctx.chat, { delete: ctx.key }).catch(() => {});
    await ctx.sendTo(ctx.ownerJid, { text: ctx.frame('🍪 Cookies saved. Downloads will now use them.\n\n⚠️ Cookies give access to your account. Use a throwaway account and run *ytlogin off* when finished.') });
  });

  /* ---------------- Google Drive ---------------- */
  const gEnv = () => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new UserError('Google Drive needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the local .env file (OAuth client of type "TVs and Limited Input devices"); restart the bot after adding them.');
    return { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
  };
  const form = o => new URLSearchParams(o).toString();
  const post = (url, o) => U.getJson(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(o) });

  def('gauth', { cat: 'bot', owner: true, heavy: true, desc: 'Connect your Google Drive (device login).' }, async ctx => {
    const { id, secret } = gEnv();
    const d = await post('https://oauth2.googleapis.com/device/code', { client_id: id, scope: 'https://www.googleapis.com/auth/drive.file' });
    await ctx.reply(`1️⃣ Open: ${d.verification_url}\n2️⃣ Enter code: *${d.user_code}*\n3️⃣ Approve access.\n\nI will confirm here when it is done (you have ${Math.round(d.expires_in / 60)} minutes).`, { title: 'Google Drive login' });
    const deadline = Date.now() + d.expires_in * 1000;
    (async () => {
      while (Date.now() < deadline) {
        await U.sleep((d.interval || 5) * 1000);
        try {
          const t = await post('https://oauth2.googleapis.com/token', { client_id: id, client_secret: secret, device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
          if (t.refresh_token) { ctx.set('gdrive', { refresh_token: t.refresh_token }); return ctx.sendTo(ctx.chat, { text: ctx.frame('✅ Google Drive connected! Use *gupload* to upload files.') }); }
        } catch (e) { if (!/428|authorization_pending|slow_down|HTTP 4(00|28)/i.test(e.message)) { return ctx.sendTo(ctx.chat, { text: ctx.frame('❌ Google login failed: ' + e.message.slice(0, 120)) }).catch(() => {}); } }
      }
      ctx.sendTo(ctx.chat, { text: ctx.frame('⌛ Google login expired. Run *gauth* again.') }).catch(() => {});
    })();
  });

  def('gupload', { cat: 'bot', owner: true, heavy: true, usage: 'gupload [link] (or reply to a file)', desc: 'Upload a replied file or a direct link to your Google Drive.' }, async ctx => {
    const { id, secret } = gEnv();
    const g = ctx.get('gdrive', null);
    if (!g?.refresh_token) throw new UserError(`Not connected. Run *${ctx.var('PREFIX')}gauth* first.`);
    let buffer, name, mime;
    const link = U.findUrl(ctx.args);
    if (link) { const f = await U.download(link); ({ buffer, name, mime } = f); }
    else {
      const m = await ctx.needMedia(['image', 'video', 'audio', 'document', 'sticker'], 'Reply to a file, or give a direct link.');
      buffer = m.buffer; mime = m.mime || 'application/octet-stream';
      name = m.name || `upload.${(mime.split('/')[1] || 'bin').split(';')[0]}`;
    }
    const tok = await post('https://oauth2.googleapis.com/token', { client_id: id, client_secret: secret, refresh_token: g.refresh_token, grant_type: 'refresh_token' });
    const boundary = 'tanda' + Date.now();
    const meta = JSON.stringify({ name });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`),
      buffer, Buffer.from(`\r\n--${boundary}--`)
    ]);
    const r = await U.getJson('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,size', {
      method: 'POST', timeout: 120000, headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': `multipart/related; boundary=${boundary}` }, body
    });
    await ctx.reply(`☁️ ${bold('Uploaded')}: ${r.name}\n💾 ${U.fmtBytes(Number(r.size) || buffer.length)}\n🔗 ${r.webViewLink || 'https://drive.google.com/file/d/' + r.id}`, { title: 'Google Drive' });
  });
};
