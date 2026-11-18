'use strict';
/** Developer and diagnostic commands. Server-level ones need the server operator (see lib/host.js). */
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const U = require('../lib/util');
const { requireHost } = require('../lib/host');
const { UserError, bold } = U;

const mb = n => (n / 1048576).toFixed(0) + ' MB';
const dur = s => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return `${d ? d + 'd ' : ''}${h}h ${m}m`; };
const bin = (cmd, args) => new Promise(res => execFile(cmd, args, { timeout: 2500 }, (e, out) => res(e ? null : String(out).split('\n')[0].trim())));
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };

const KNOWN_ENV = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'REMOVEBG_API_KEY', 'AUDD_API_TOKEN', 'TENOR_API_KEY', 'OMDB_API_KEY', 'TELEGRAM_BOT_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'RENDER_DEPLOY_HOOK_URL', 'HOST_ADMINS', 'CHANNEL_URL', 'CHANNEL_JID', 'TIMEZONE', 'BOT_NAME', 'OWNER_NAME', 'FOOTER_TEXT', 'YTDLP_PATH', 'OCR_SPACE_KEY'];

module.exports = ({ def, alias, tickers, registry }) => {
  const P = ctx => ctx.var('PREFIX');

  def(['health', 'healthcheck'], { cat: 'developer', owner: true, desc: 'Quick health check of this bot session.' }, async ctx => {
    const t0 = Date.now(); await ctx.store.get?.(ctx.sid, 'vars', {}); const lag = Date.now() - t0;
    const mem = process.memoryUsage().rss / os.totalmem();
    const rows = [[ctx.entry.connected, 'WhatsApp connection'], [mem < 0.85, `Memory ${(mem * 100).toFixed(0)}% of server`], [os.loadavg()[0] < os.cpus().length * 1.5, `CPU load ${os.loadavg()[0].toFixed(2)}`], [lag < 1500, `Settings store ${lag} ms`]];
    await ctx.reply(`${rows.map(([ok, t]) => `${ok ? '🟢' : '🔴'} ${t}`).join('\n')}\n\n${rows.every(r => r[0]) ? '✅ Everything looks healthy.' : '⚠️ Something needs attention.'}`, { title: 'Health' });
  });

  def('diagnostics', { cat: 'developer', owner: true, heavy: true, desc: 'Full system report: Node, OS, memory, CPU, tools and connection.' }, async ctx => {
    const [ff, yt] = await Promise.all([bin(U.ffmpegBin(), ['-version']), (async () => {
      try { const p = await U.ensureYtDlp(); const r = await U.run(p === 'yt-dlp' || /\.pyz$/.test(p) ? p : p, ['--version'], { timeout: 60000 }).catch(() => null); return r ? r.out.trim() : (U.TMP && p ? `ready (${p})` : null); }
      catch (e) { return null; }
    })()]);
    await ctx.reply([
      `${bold('Node')}: ${process.version}  ${bold('OS')}: ${os.platform()} ${os.arch()}`,
      `${bold('Uptime')}: ${dur(process.uptime())}`,
      `${bold('Memory')}: ${mb(process.memoryUsage().rss)} used • ${mb(os.freemem())} free of ${mb(os.totalmem())}`,
      `${bold('CPU')}: ${os.cpus().length} core(s) • load ${os.loadavg().map(x => x.toFixed(2)).join(' ')}`,
      `${bold('ffmpeg')}: ${ff ? ff.slice(0, 40) : '❌ not found'}`,
      `${bold('yt-dlp')}: ${yt ? yt : '❌ not found'}`,
      `${bold('WhatsApp')}: ${ctx.entry.connected ? '🟢 connected' : '🔴 disconnected'}`,
      `${bold('Version')}: v${require('../package.json').version}`
    ].join('\n'), { title: 'Diagnostics' });
  });

  def(['memoryusage', 'mem'], { cat: 'developer', owner: true, desc: 'Memory used by the bot process.' }, async ctx => {
    const m = process.memoryUsage();
    await ctx.reply(`${bold('RSS')}: ${mb(m.rss)}\n${bold('Heap used')}: ${mb(m.heapUsed)} of ${mb(m.heapTotal)}\n${bold('External')}: ${mb(m.external)}\n${bold('Server')}: ${mb(os.totalmem() - os.freemem())} used of ${mb(os.totalmem())}`, { title: 'Memory' });
  });

  def('cpu', { cat: 'developer', owner: true, heavy: true, desc: 'CPU model, cores, load and how busy the bot is right now.' }, async ctx => {
    const a = process.cpuUsage(), t = process.hrtime.bigint();
    await U.sleep(600);
    const b = process.cpuUsage(a), pct = (b.user + b.system) / (Number(process.hrtime.bigint() - t) / 1000) * 100;
    await ctx.reply(`${bold('Model')}: ${os.cpus()[0]?.model || 'unknown'}\n${bold('Cores')}: ${os.cpus().length}\n${bold('Load (1/5/15m)')}: ${os.loadavg().map(x => x.toFixed(2)).join(' / ')}\n${bold('Bot CPU now')}: ${pct.toFixed(1)}%`, { title: 'CPU' });
  });

  def('dependencies', { cat: 'developer', owner: true, desc: 'The libraries the bot uses and their installed versions.' }, async ctx => {
    const deps = require('../package.json').dependencies || {};
    const rows = Object.keys(deps).map(n => { let v = 'not installed'; try { v = JSON.parse(fs.readFileSync(require.resolve(`${n}/package.json`), 'utf8')).version; } catch { try { v = require(`${n}/package.json`).version; } catch { /* keep */ } } return `${v === 'not installed' ? '❌' : '✅'} ${n} ${v}`; });
    await ctx.reply(rows.join('\n') || 'No dependencies listed.', { title: 'Dependencies' });
  });

  def('envcheck', { cat: 'developer', owner: true, desc: 'Which server settings are present (names only, never the values).' }, async ctx => {
    requireHost(ctx);
    await ctx.reply(KNOWN_ENV.map(k => `${process.env[k] ? '✅' : '▫️'} ${k}`).join('\n') + '\n\n✅ set • ▫️ not set', { title: 'Environment' });
  });

  def('database', { cat: 'developer', owner: true, heavy: true, desc: 'Check the laptop-local persistent storage file.' }, async ctx => {
    requireHost(ctx);
    const storagePath = path.join(__dirname, '..', 'data', 'local-store.json');
    const started = Date.now();
    try {
      const stat = fs.statSync(storagePath);
      const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
      const sessions = Array.isArray(parsed.tanda_sessions) ? parsed.tanda_sessions.length : 0;
      const settings = Array.isArray(parsed.tanda_data) ? parsed.tanda_data.length : 0;
      await ctx.reply(`🟢 Local storage is healthy\n${bold('Mode')}: Laptop file storage\n${bold('File')}: data/local-store.json\n${bold('Size')}: ${mb(stat.size)}\n${bold('Saved sessions')}: ${sessions}\n${bold('Settings records')}: ${settings}\n${bold('Check time')}: ${Date.now() - started} ms`, { title: 'Local Storage' });
    } catch (error) {
      await ctx.reply(`🔴 Local storage problem\n${bold('File')}: data/local-store.json\n${bold('Error')}: ${String(error.message).slice(0, 180)}\n${bold('Check time')}: ${Date.now() - started} ms`, { title: 'Local Storage' });
    }
  });

  def(['queue', 'pending'], { cat: 'developer', owner: true, desc: 'What is waiting to happen: reminders, alerts, games.' }, async ctx => {
    const n = (k, d = []) => ctx.get(k, d).length;
    await ctx.reply([`⏰ Reminders: ${n('reminders')}`, `🗓️ Scheduled messages: ${n('schedules')}`, `⚽ Live alert chats: ${n('sportsSubs')}`, `📅 Daily fixture chats: ${n('matchdaySubs')}`, `🎮 Games running: ${(ctx.rt.games?.size || 0) + (ctx.rt.arcade?.size || 0)}`].join('\n'), { title: 'Queue' });
  });
  def('jobs', { cat: 'developer', owner: true, desc: 'The background jobs the bot runs.' }, async ctx => {
    await ctx.reply(tickers.map(t => `⚙️ ${t.name}`).join('\n') + `\n\n${tickers.length} jobs, checked every few seconds.`, { title: 'Jobs' });
  });

  def('logs', { cat: 'developer', owner: true, usage: 'logs [count]', desc: 'Recent warnings and errors from the server log (server operator).' }, async ctx => {
    requireHost(ctx);
    const { LOG_RING } = require('../lib/bot');
    const n = Math.min(25, Math.max(5, parseInt(ctx.argv[0], 10) || 12));
    const rows = LOG_RING.filter(l => l.level !== 'info').slice(-n).reverse().map(l => `${l.level === 'error' ? '🔴' : '🟡'} ${ago(l.at)} ${l.command ? `[${l.command}] ` : ''}${l.msg}${l.error ? ' — ' + l.error : ''}`);
    await ctx.reply(rows.join('\n') || '✅ No warnings or errors recorded since the last restart.', { title: 'Logs' });
  });
  def('errors', { cat: 'developer', owner: true, desc: 'Recent errors only (server operator).' }, async ctx => {
    requireHost(ctx);
    const { LOG_RING } = require('../lib/bot');
    const rows = LOG_RING.filter(l => l.level === 'error').slice(-10).reverse().map(l => `🔴 ${ago(l.at)} ${l.command ? `[${l.command}] ` : ''}${l.msg}${l.error ? ' — ' + l.error : ''}`);
    await ctx.reply(rows.join('\n') || '✅ No errors since the last restart.', { title: 'Errors' });
  });
  def('sessions', { cat: 'developer', owner: true, desc: 'How many WhatsApp numbers this server is running (server operator).' }, async ctx => {
    requireHost(ctx);
    const live = require('../lib/bot').liveSessions();
    const limit = process.env.MAX_SESSIONS || 'default';
    let savedList = '';
    try {
      const storagePath = path.join(__dirname, '..', 'data', 'local-store.json');
      if (fs.existsSync(storagePath)) {
        const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
        if (Array.isArray(parsed.tanda_sessions) && parsed.tanda_sessions.length) {
          savedList = '\n\n' + bold('Saved Sessions') + ':\n' + parsed.tanda_sessions.map((s, idx) => {
            const phone = s.phone || s.session_id || `Session ${idx + 1}`;
            const conn = s.connected ? '🟢' : '⚪';
            return `${conn} ${phone}`;
          }).join('\n');
        }
      }
    } catch {}
    await ctx.reply(`📱 ${bold('Live sessions')}: ${live}\n🧮 ${bold('Limit')}: ${limit}${savedList}`, { title: 'Sessions' });
  });

  def('testapi', { cat: 'developer', owner: true, heavy: true, desc: 'Check that the outside services the bot depends on answer (live scores, news, downloads).' }, async ctx => {
    const checks = [['ESPN live scores', 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard'], ['Google News', 'https://news.google.com/rss/search?q=test'], ['CoinGecko', 'https://api.coingecko.com/api/v3/ping'], ['Exchange rates', 'https://open.er-api.com/v6/latest/USD'], ['Wikipedia', 'https://en.wikipedia.org/api/rest_v1/'], ['SoundCloud', 'https://soundcloud.com'], ['YouTube', 'https://www.youtube.com/generate_204']];
    const rows = await Promise.all(checks.map(async ([name, url]) => {
      const t = Date.now();
      try { const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 DecanBot' } }); return `${r.status < 500 ? '🟢' : '🔴'} ${name} ${r.status} • ${Date.now() - t} ms`; }
      catch { return `🔴 ${name} unreachable`; }
    }));
    await ctx.reply(rows.join('\n'), { title: 'API test' });
  });

  def('clearcache', { cat: 'developer', owner: true, desc: 'Empty the bot\'s in-memory caches (scores, rates, chat cache).' }, async ctx => {
    let n = 0;
    try { const sp = require('./sports')._test.cache; n += sp.size; sp.clear(); } catch { /* module optional */ }
    for (const k of ['groupCache', 'msgCache', 'spam', 'cool']) if (ctx.rt[k]?.clear) { n += ctx.rt[k].size; ctx.rt[k].clear(); }
    ctx.rt.sportsPoll = 0;
    await ctx.reply(`🧹 Cleared ${n} cached item${n === 1 ? '' : 's'}.`, { title: 'Cache' });
  });

  def('restore', { cat: 'developer', owner: true, heavy: true, desc: 'Restore your settings from a backup file. Reply to the JSON file from the backup command.' }, async ctx => {
    const m = await ctx.media().catch(() => null);
    if (!m || m.kind !== 'document') throw new UserError(`Reply to the backup file (JSON) with *${P(ctx)}restore*.`);
    let j; try { j = JSON.parse(m.buffer.toString('utf8')); } catch { throw new UserError('That file is not valid JSON.'); }
    const data = j?.data;
    if (!data || typeof data !== 'object') throw new UserError('That does not look like a backup from this bot.');
    const skip = new Set(['yt_cookies', 'gdrive', 'chats', 'banned']);
    let n = 0;
    for (const [k, v] of Object.entries(data)) { if (skip.has(k) || v === '[hidden]' || /^__|token|secret|password/i.test(k)) continue; ctx.set(k, v); n++; }
    await ctx.reply(`✅ Restored ${n} setting group${n === 1 ? '' : 's'} from the backup.\nSecrets such as YouTube cookies are never restored; set them again with *${P(ctx)}ytlogin*.`, { title: 'Restore' });
  });
};
