'use strict';
/**
 * Live games & scores (football + NBA) using ESPN's public scoreboard feed (no API key needed).
 *
 *   .livescore [league|team]     matches being played right now
 *   .fixtures  [league|team] [today|tomorrow|YYYY-MM-DD]
 *   .results   [league|team] [today|yesterday|YYYY-MM-DD]
 *   .table <league>              league standings
 *   .match <team>                full match card with goals and cards
 *   .livealerts on|off|list ...  push alerts (kick-off, goals, red cards, HT, FT) into this chat
 *   .leagues                     supported league codes
 *
 * Alerts are sent by a background ticker, so they arrive on their own, in the same
 * "forwarded from channel" style as every other reply.
 */
const U = require('../lib/util');
const { UserError, bold } = U;

const API = 'https://site.api.espn.com/apis';
const LEAGUES = {
  epl: { sport: 'soccer', slug: 'eng.1', name: 'Premier League', icon: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', aka: ['pl', 'premier', 'premierleague', 'england'] },
  laliga: { sport: 'soccer', slug: 'esp.1', name: 'La Liga', icon: '🇪🇸', aka: ['liga', 'spain'] },
  seriea: { sport: 'soccer', slug: 'ita.1', name: 'Serie A', icon: '🇮🇹', aka: ['italy'] },
  bundesliga: { sport: 'soccer', slug: 'ger.1', name: 'Bundesliga', icon: '🇩🇪', aka: ['germany', 'bundes'] },
  ligue1: { sport: 'soccer', slug: 'fra.1', name: 'Ligue 1', icon: '🇫🇷', aka: ['france', 'l1'] },
  ucl: { sport: 'soccer', slug: 'uefa.champions', name: 'Champions League', icon: '🏆', aka: ['championsleague', 'cl'] },
  uel: { sport: 'soccer', slug: 'uefa.europa', name: 'Europa League', icon: '🏆', aka: ['europa', 'el'] },
  kpl: { sport: 'soccer', slug: 'ken.1', name: 'Kenyan Premier League', icon: '🇰🇪', aka: ['kenya', 'fkf'] },
  afcon: { sport: 'soccer', slug: 'caf.nations', name: 'Africa Cup of Nations', icon: '🌍', aka: ['africa', 'can'] },
  cafcl: { sport: 'soccer', slug: 'caf.champions', name: 'CAF Champions League', icon: '🌍', aka: ['caf'] },
  facup: { sport: 'soccer', slug: 'eng.fa', name: 'FA Cup', icon: '🏆', aka: ['fa'] },
  mls: { sport: 'soccer', slug: 'usa.1', name: 'MLS', icon: '🇺🇸', aka: ['usa'] },
  wc: { sport: 'soccer', slug: 'fifa.world', name: 'World Cup', icon: '🌎', aka: ['worldcup', 'fifa'] },
  nba: { sport: 'basketball', slug: 'nba', name: 'NBA', icon: '🏀', aka: ['basketball'] },
  uecl: { sport: 'soccer', slug: 'uefa.europa.conf', name: 'Conference League', icon: '🏆', aka: ['conference'] },
  championship: { sport: 'soccer', slug: 'eng.2', name: 'EFL Championship', icon: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', aka: ['efl', 'eng2'] },
  carabao: { sport: 'soccer', slug: 'eng.league_cup', name: 'Carabao Cup', icon: '🏆', aka: ['leaguecup', 'eflcup'] },
  copadelrey: { sport: 'soccer', slug: 'esp.copa_del_rey', name: 'Copa del Rey', icon: '🇪🇸', aka: ['copa'] },
  dfb: { sport: 'soccer', slug: 'ger.dfb_pokal', name: 'DFB Pokal', icon: '🇩🇪', aka: ['pokal'] },
  coppa: { sport: 'soccer', slug: 'ita.coppa_italia', name: 'Coppa Italia', icon: '🇮🇹', aka: ['coppaitalia'] },
  coupe: { sport: 'soccer', slug: 'fra.coupe_de_france', name: 'Coupe de France', icon: '🇫🇷', aka: ['coupedefrance'] },
  eredivisie: { sport: 'soccer', slug: 'ned.1', name: 'Eredivisie', icon: '🇳🇱', aka: ['netherlands', 'dutch'] },
  primeira: { sport: 'soccer', slug: 'por.1', name: 'Primeira Liga', icon: '🇵🇹', aka: ['portugal'] },
  scottish: { sport: 'soccer', slug: 'sco.1', name: 'Scottish Premiership', icon: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', aka: ['scotland', 'spl'] },
  super_lig: { sport: 'soccer', slug: 'tur.1', name: 'Süper Lig', icon: '🇹🇷', aka: ['turkey', 'superlig'] },
  saudi: { sport: 'soccer', slug: 'ksa.1', name: 'Saudi Pro League', icon: '🇸🇦', aka: ['spl2', 'roshn'] },
  brasileirao: { sport: 'soccer', slug: 'bra.1', name: 'Brasileirão', icon: '🇧🇷', aka: ['brazil'] },
  argentina: { sport: 'soccer', slug: 'arg.1', name: 'Argentine Primera', icon: '🇦🇷', aka: ['arg'] },
  libertadores: { sport: 'soccer', slug: 'conmebol.libertadores', name: 'Copa Libertadores', icon: '🌎', aka: ['conmebol'] },
  euro: { sport: 'soccer', slug: 'uefa.euro', name: 'UEFA Euro', icon: '🇪🇺', aka: ['euros'] },
  nations: { sport: 'soccer', slug: 'uefa.nations', name: 'UEFA Nations League', icon: '🇪🇺', aka: ['nationsleague'] },
  nfl: { sport: 'football', slug: 'nfl', name: 'NFL', icon: '🏈', aka: ['americanfootball'] },
  nhl: { sport: 'hockey', slug: 'nhl', name: 'NHL', icon: '🏒', aka: ['hockey'] },
  mlb: { sport: 'baseball', slug: 'mlb', name: 'MLB', icon: '⚾', aka: ['baseball'] },
  wnba: { sport: 'basketball', slug: 'wnba', name: 'WNBA', icon: '🏀', aka: [] },
};
const KEYS = Object.keys(LEAGUES);
const DEFAULT_LEAGUES = ['epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'ucl', 'uel', 'kpl'];
const ALIAS = new Map();
for (const k of KEYS) { ALIAS.set(k, k); for (const a of LEAGUES[k].aka) ALIAS.set(a, k); }
const leagueOf = w => ALIAS.get(String(w || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

/* ------------------------------ data layer ------------------------------ */
const cache = new Map(); // url -> { at, data }
async function getFeed(url, ttl = 30000) {
  const c = cache.get(url);
  if (c && Date.now() - c.at < ttl) return c.data;
  const data = await U.getJson(url, { timeout: 9000 });
  cache.set(url, { at: Date.now(), data });
  if (cache.size > 120) cache.delete(cache.keys().next().value);
  return data;
}

const ymd = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

/** local calendar date (in the bot timezone) shifted by n days, as YYYYMMDD */
function dayStamp(tz, n = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + n * 86400000));
  return parts.replace(/-/g, '');
}

function parseEvent(ev, key) {
  const lg = LEAGUES[key];
  const comp = ev?.competitions?.[0];
  if (!comp?.competitors?.length) return null;
  const side = ha => comp.competitors.find(c => c.homeAway === ha) || comp.competitors[ha === 'home' ? 0 : 1];
  const h = side('home'), a = side('away');
  if (!h || !a) return null;
  const st = ev.status || {};
  const tp = st.type || {};
  const team = c => ({ id: String(c.team?.id ?? c.id ?? ''), name: c.team?.displayName || c.team?.name || '?', short: c.team?.shortDisplayName || c.team?.abbreviation || c.team?.displayName || '?', abbr: c.team?.abbreviation || '', score: Number.parseInt(c.score, 10) || 0 });
  const details = (comp.details || []).map(d => {
    const t = String(d.type?.text || '');
    const who = d.athletesInvolved?.[0];
    return {
      kind: d.redCard ? 'red' : d.scoringPlay ? 'goal' : d.yellowCard ? 'yellow' : 'other',
      minute: d.clock?.displayValue || '', teamId: String(d.team?.id ?? ''), player: who?.displayName || who?.shortName || '',
      own: /own/i.test(t), pen: /penalty/i.test(t)
    };
  });
  return {
    id: `${key}:${ev.id}`, league: key, leagueName: lg.name, icon: lg.icon, sport: lg.sport,
    state: tp.state || 'pre', statusName: tp.name || '', detail: tp.shortDetail || tp.detail || '', clock: st.displayClock || '', period: st.period || 0,
    date: ev.date, venue: comp.venue?.fullName || '', home: team(h), away: team(a), details,
    note: comp.notes?.[0]?.headline || ''
  };
}

async function board(key, date) {
  const lg = LEAGUES[key];
  const url = `${API}/site/v2/sports/${lg.sport}/${lg.slug}/scoreboard${date ? `?dates=${date}` : ''}`;
  const data = await getFeed(url, date ? 120000 : 30000);
  return (data.events || []).map(ev => parseEvent(ev, key)).filter(Boolean);
}

/** fetch several leagues in parallel; failed or unknown leagues are skipped silently */
async function boards(keys, date) {
  const res = await Promise.allSettled(keys.map(k => board(k, date)));
  const ok = res.filter(r => r.status === 'fulfilled');
  if (!ok.length) throw new UserError('Live data is unreachable right now. Try again in a minute.');
  return ok.flatMap(r => r.value);
}

async function standings(key) {
  const lg = LEAGUES[key];
  const data = await getFeed(`${API}/v2/sports/${lg.sport}/${lg.slug}/standings`, 300000);
  const entries = data.children?.[0]?.standings?.entries || data.standings?.entries || [];
  return entries.map(e => {
    const s = {};
    for (const x of e.stats || []) s[x.name] = x.value;
    return { name: e.team?.displayName || '?', rank: s.rank ?? s.playoffSeed ?? 0, p: s.gamesPlayed ?? 0, w: s.wins ?? 0, d: s.ties ?? 0, l: s.losses ?? 0, gd: s.pointDifferential ?? 0, pts: s.points ?? 0 };
  }).sort((a, b) => (a.rank || 99) - (b.rank || 99));
}

/* ------------------------------ formatting ------------------------------ */
const clean = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const teamMatch = (m, q) => { const n = clean(q); return !n || [m.home, m.away].some(t => [t.name, t.short, t.abbr].some(x => clean(x).includes(n))); };
const isHT = m => /half_?time/i.test(m.statusName) || /^(ht|half[- ]?time)$/i.test(m.detail);

function clockTime(iso, tz) {
  try { return new Date(iso).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }); } catch { return '--:--'; }
}
function dayLabel(iso, tz) {
  try { return new Date(iso).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }); } catch { return ''; }
}

function line(m, tz) {
  const sc = `${m.home.score} - ${m.away.score}`;
  if (m.state === 'in') {
    const when = isHT(m) ? 'HT' : (m.sport === 'basketball' ? (m.detail || `Q${m.period}`) : (m.detail || m.clock || 'LIVE'));
    return `🔴 ${bold(when)}  ${m.home.name} ${bold(sc)} ${m.away.name}`;
  }
  if (m.state === 'post') return `✅ ${bold('FT')}  ${m.home.name} ${bold(sc)} ${m.away.name}`;
  const stat = /postpone|cancel|delay|suspend/i.test(m.statusName) ? `⚠️ ${m.detail || 'Postponed'}` : `🕒 ${bold(clockTime(m.date, tz))}`;
  return `${stat}  ${m.home.name} vs ${m.away.name}`;
}

function grouped(list, tz, { cap = 40 } = {}) {
  const by = new Map();
  for (const m of list.slice(0, cap)) { if (!by.has(m.league)) by.set(m.league, []); by.get(m.league).push(m); }
  const blocks = [...by.entries()].map(([k, ms]) => `${LEAGUES[k].icon} ${bold(LEAGUES[k].name)}\n${ms.map(m => line(m, tz)).join('\n')}`);
  const more = list.length > cap ? `\n\n…and ${list.length - cap} more. Narrow it down, e.g. *livescore epl*.` : '';
  return blocks.join('\n\n') + more;
}

function timeline(m) {
  const items = m.details.filter(d => d.kind !== 'other' && d.kind !== 'yellow').map(d => {
    const side = d.teamId === m.home.id ? m.home.short : d.teamId === m.away.id ? m.away.short : '';
    const icon = d.kind === 'goal' ? (d.own ? '⚽(OG)' : d.pen ? '⚽(P)' : '⚽') : '🟥';
    return `${icon} ${d.minute} ${d.player || 'Unknown'}${side ? ` (${side})` : ''}`;
  });
  return items.length ? items.join('\n') : '';
}

function matchCard(m, tz) {
  const head = m.state === 'in' ? (isHT(m) ? '⏸ Half time' : `🔴 LIVE ${m.detail || m.clock}`) : m.state === 'post' ? '✅ Full time' : `🕒 ${dayLabel(m.date, tz)} ${clockTime(m.date, tz)}`;
  const tl = timeline(m);
  const out = [`${m.icon} ${bold(m.leagueName)}`, '', `${m.home.name}  ${bold(`${m.home.score} - ${m.away.score}`)}  ${m.away.name}`, head];
  if (m.venue) out.push(`📍 ${m.venue}`);
  if (tl) out.push('', bold('Match events'), tl);
  return out.join('\n');
}

/* --------------------------- query understanding ------------------------ */
function parseQuery(ctx, { dateWords = false } = {}) {
  let league = null, date = null;
  const rest = [];
  for (const w of ctx.argv) {
    const lw = w.toLowerCase();
    if (dateWords && /^(today|tomorrow|yesterday)$/.test(lw)) date = dayStamp(ctx.tz(), lw === 'tomorrow' ? 1 : lw === 'yesterday' ? -1 : 0);
    else if (dateWords && /^\d{4}-\d{2}-\d{2}$/.test(lw)) date = lw.replace(/-/g, '');
    else if (!league && leagueOf(lw) && !rest.length) league = leagueOf(lw);
    else rest.push(w);
  }
  return { league, date, team: rest.join(' ').trim() };
}
const defaultKeys = ctx => {
  const v = String(ctx.var('SPORTS_LEAGUES', '') || '').split(/[\s,]+/).map(leagueOf).filter(Boolean);
  return [...new Set(v.length ? v : DEFAULT_LEAGUES)];
};
const searchKeys = (ctx, q) => q.league ? [q.league] : (q.team ? KEYS : defaultKeys(ctx));

/* ------------------------------ alert engine ---------------------------- */
const reds = m => m.details.filter(d => d.kind === 'red').length;

function diffMatch(prev, m) {
  const ev = [];
  if (prev.state === 'pre' && m.state === 'in') ev.push({ type: 'kickoff' });
  if (m.state !== 'pre' && (m.home.score !== prev.hs || m.away.score !== prev.as)) {
    const homeUp = m.home.score > prev.hs, awayUp = m.away.score > prev.as;
    if (homeUp || awayUp) {
      const tid = homeUp ? m.home.id : m.away.id;
      const g = [...m.details].reverse().find(d => d.kind === 'goal' && d.teamId === tid) || [...m.details].reverse().find(d => d.kind === 'goal');
      ev.push({ type: 'goal', side: homeUp ? 'home' : 'away', goal: g });
    } else ev.push({ type: 'var' });
  }
  if (reds(m) > prev.reds && m.state === 'in') {
    const r = [...m.details].reverse().find(d => d.kind === 'red');
    ev.push({ type: 'red', card: r });
  }
  if (m.state === 'in' && isHT(m) && !prev.ht) ev.push({ type: 'ht' });
  if (prev.state === 'in' && m.state === 'post') ev.push({ type: 'ft' });
  return ev;
}

function alertText(e, m, tz) {
  const score = `${m.home.name} ${bold(`${m.home.score} - ${m.away.score}`)} ${m.away.name}`;
  const tag = `${m.icon} ${m.leagueName}`;
  switch (e.type) {
    case 'kickoff': return { title: 'Kick-off', body: `🟢 ${bold('KICK OFF!')}\n${m.home.name} vs ${m.away.name}\n${tag}${m.venue ? `\n📍 ${m.venue}` : ''}` };
    case 'goal': {
      const g = e.goal;
      const who = g ? `\n👤 ${g.player || 'Goal'}${g.minute ? ` ${g.minute}` : ''}${g.own ? ' (own goal)' : g.pen ? ' (penalty)' : ''}` : '';
      const scorer = e.side === 'home' ? m.home.name : m.away.name;
      return { title: 'Goal', body: `⚽ ${bold('GOAL!')} ${scorer}\n${score}${who}\n${tag}` };
    }
    case 'var': return { title: 'Score changed', body: `🖥️ ${bold('Score corrected / goal disallowed')}\n${score}\n${tag}` };
    case 'red': return { title: 'Red card', body: `🟥 ${bold('RED CARD!')}${e.card?.player ? `\n👤 ${e.card.player} ${e.card.minute}` : ''}\n${score}\n${tag}` };
    case 'ht': return { title: 'Half time', body: `⏸ ${bold('HALF TIME')}\n${score}\n${tag}` };
    case 'ft': return { title: 'Full time', body: `🏁 ${bold('FULL TIME')}\n${score}\n${tag}` };
    default: return null;
  }
}

const subMatches = (s, m) => (!s.leagues?.length || s.leagues.includes(m.league)) && (!s.teams?.length || s.teams.some(t => teamMatch(m, t)));

async function pollAndAlert(api, now = Date.now()) {
  const subs = api.get('sportsSubs', []);
  if (!subs.length) return;
  if (now - (api.rt.sportsPoll || 0) < 45000) return;
  api.rt.sportsPoll = now;

  const teamSub = subs.some(s => s.teams?.length && !s.leagues?.length);
  const keys = teamSub ? KEYS : [...new Set(subs.flatMap(s => (s.leagues?.length ? s.leagues : KEYS)))];
  let matches;
  try { matches = (await Promise.allSettled(keys.map(k => board(k)))).flatMap(r => (r.status === 'fulfilled' ? r.value : [])); }
  catch { return; }
  if (!matches.length) return;

  const state = (api.rt.sportsState ||= new Map());
  const outgoing = [];
  for (const m of matches) {
    const prev = state.get(m.id);
    const next = { state: m.state, hs: m.home.score, as: m.away.score, reds: reds(m), ht: isHT(m), at: now };
    state.set(m.id, next);
    if (!prev) continue; // first sighting only records the situation, so a restart never spams old events
    for (const e of diffMatch(prev, m)) outgoing.push({ e, m });
  }
  if (state.size > 600) for (const [k, v] of state) { if (now - v.at > 6 * 3600e3) state.delete(k); }

  let sent = 0;
  for (const { e, m } of outgoing) {
    const text = alertText(e, m, api.tz());
    if (!text) continue;
    for (const s of subs) {
      if (!subMatches(s, m)) continue;
      if (sent >= 30) return;
      try {
        await api.sendTo(s.chat, { text: api.frame(text.body, `Live • ${text.title}`), contextInfo: api.adContext() });
        sent++;
        await U.sleep(800);
      } catch (err) { api.logger.warn({ error: err?.message, chat: s.chat }, 'Live alert send failed'); }
    }
  }
}

async function matchdayDigest(api, now = new Date()) {
  const subs = api.get('matchdaySubs', []);
  if (!subs.length) return;
  const tz = api.tz();
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const today = dayStamp(tz);
  for (const s of subs) {
    if (s.time !== hm || s.last === today) continue;
    api.update('matchdaySubs', [], l => { const x = l.find(y => y.chat === s.chat); if (x) x.last = today; });
    try {
      const list = (await boards(s.leagues, today)).filter(m => m.state !== 'post').sort((a, b) => new Date(a.date) - new Date(b.date));
      if (!list.length) continue;
      await api.sendTo(s.chat, { text: api.frame(grouped(list, tz), `Today's games • ${new Date().toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'short' })}`), contextInfo: api.adContext() });
    } catch (err) { api.logger.warn({ error: err?.message }, 'Matchday digest failed'); }
  }
}

/* -------------------------------- commands ------------------------------ */
module.exports = ({ def, tickers }) => {
  const P = ctx => ctx.var('PREFIX');

  def(['livescore', 'live', 'scores'], { cat: 'sports', heavy: true, usage: 'livescore [league|team]', desc: 'Matches being played right now (football leagues + NBA). Example: livescore epl' }, async ctx => {
    const q = parseQuery(ctx);
    const all = (await boards(searchKeys(ctx, q))).filter(m => teamMatch(m, q.team));
    const live = all.filter(m => m.state === 'in');
    if (live.length) return ctx.reply(grouped(live, ctx.tz()) + `\n\n🔔 ${P(ctx)}livealerts on — get goals pushed to this chat`, { title: `Live now (${live.length})` });
    const next = all.filter(m => m.state === 'pre').sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 8);
    if (next.length) return ctx.reply(`No live games right now. Coming up:\n\n${grouped(next, ctx.tz())}`, { title: 'Live scores' });
    throw new UserError('No live or upcoming games found. Try *' + P(ctx) + 'fixtures tomorrow* or pick a league: *' + P(ctx) + 'leagues*.');
  });

  def(['fixtures', 'upcoming'], { cat: 'sports', heavy: true, usage: 'fixtures [league|team] [today|tomorrow|YYYY-MM-DD]', desc: 'Scheduled and ongoing games for a day (default today).' }, async ctx => {
    const q = parseQuery(ctx, { dateWords: true });
    const date = q.date || dayStamp(ctx.tz());
    const list = (await boards(searchKeys(ctx, q), date)).filter(m => m.state !== 'post' && teamMatch(m, q.team)).sort((a, b) => new Date(a.date) - new Date(b.date));
    if (!list.length) throw new UserError('No fixtures found for that day. Try *' + P(ctx) + 'fixtures tomorrow*.');
    await ctx.reply(grouped(list, ctx.tz()), { title: `Fixtures • ${date.replace(/(\d{4})(\d{2})(\d{2})/, '$3/$2/$1')}` });
  });

  def(['results', 'scoreboard'], { cat: 'sports', heavy: true, usage: 'results [league|team] [today|yesterday|YYYY-MM-DD]', desc: 'Finished games for a day (default: latest day with results).' }, async ctx => {
    const q = parseQuery(ctx, { dateWords: true });
    const keys = searchKeys(ctx, q);
    const tries = q.date ? [q.date] : [dayStamp(ctx.tz()), dayStamp(ctx.tz(), -1)];
    for (const date of tries) {
      const list = (await boards(keys, date)).filter(m => m.state === 'post' && teamMatch(m, q.team));
      if (list.length) return ctx.reply(grouped(list, ctx.tz()), { title: `Results • ${date.replace(/(\d{4})(\d{2})(\d{2})/, '$3/$2/$1')}` });
    }
    throw new UserError('No finished games found for that day.');
  });

  def(['table', 'standings'], { cat: 'sports', heavy: true, usage: 'table <league>', desc: 'League standings. Example: table epl' }, async ctx => {
    const key = leagueOf(ctx.argv[0]);
    if (!key) throw new UserError(`Which league? Example: *${P(ctx)}table epl*. See *${P(ctx)}leagues*.`);
    if (LEAGUES[key].sport !== 'soccer') throw new UserError('League tables are available for football leagues. Try *' + P(ctx) + 'table epl*.');
    const rows = await standings(key);
    if (!rows.length) throw new UserError('No table is available for that competition right now.');
    const lg = LEAGUES[key];
    const top = rows.slice(0, 20).map(r => `${String(r.rank).padStart(2)} ${r.name.slice(0, 15).padEnd(15)} ${String(r.p).padStart(2)} ${String(r.w).padStart(2)} ${String(r.d).padStart(2)} ${String(r.l).padStart(2)} ${String(r.gd > 0 ? '+' + r.gd : r.gd).padStart(4)} ${String(r.pts).padStart(3)}`);
    const body = '```' + `\n #  Team             P  W  D  L   GD Pts\n${top.join('\n')}\n` + '```';
    await ctx.reply(body, { title: `${lg.icon} ${lg.name}` });
  });

  def(['match', 'matchinfo'], { cat: 'sports', heavy: true, usage: 'match <team>', desc: 'Match card with score, goals and red cards. Example: match arsenal' }, async ctx => {
    const q = parseQuery(ctx);
    if (!q.team) throw new UserError(`Which team? Example: *${P(ctx)}match arsenal*`);
    const today = (await boards(KEYS)).filter(m => teamMatch(m, q.team));
    let m = today.find(x => x.state === 'in') || today.sort((a, b) => Math.abs(new Date(a.date) - Date.now()) - Math.abs(new Date(b.date) - Date.now()))[0];
    if (!m) {
      const y = (await boards(KEYS, dayStamp(ctx.tz(), -1))).filter(x => teamMatch(x, q.team));
      m = y[0];
    }
    if (!m) throw new UserError('No recent or upcoming match found for that team today.');
    await ctx.reply(matchCard(m, ctx.tz()), { title: 'Match centre' });
  });

  def('leagues', { cat: 'sports', desc: 'List supported leagues and their short codes.' }, async ctx => {
    const names = { soccer: '⚽ Football', basketball: '🏀 Basketball', football: '🏈 American football', hockey: '🏒 Hockey', baseball: '⚾ Baseball' };
    const blocks = Object.keys(names).map(sp => {
      const ks = KEYS.filter(k => LEAGUES[k].sport === sp);
      return ks.length ? `${bold(names[sp])}\n${ks.map(k => `${LEAGUES[k].icon} ${k} — ${LEAGUES[k].name}`).join('\n')}` : '';
    }).filter(Boolean);
    await ctx.reply(blocks.join('\n\n') + `\n\nUse a code in commands, e.g. *${P(ctx)}livescore epl*, *${P(ctx)}fixtures laliga tomorrow*, *${P(ctx)}table ucl*.\nWrestling: *${P(ctx)}wwe*.`, { title: 'Leagues' });
  });

  def(['livealerts', 'follow'], { cat: 'sports', usage: 'livealerts on [league…|team] • livealerts off • livealerts list • add "channel" (owner) to post into your channel', desc: 'Push live alerts (kick-off, goals, red cards, HT, FT) into this chat. Example: livealerts on arsenal  |  livealerts on epl ucl' }, async ctx => {
    const toChannel = ctx.argv.some(w => /^channel$/i.test(w));
    const argv = ctx.argv.filter(w => !/^channel$/i.test(w));
    let target = ctx.chat;
    if (toChannel) {
      if (!ctx.isOwner) throw new UserError('Only the bot owner can send alerts to the channel.');
      target = (await ctx.channelInfo())?.jid;
      if (!target) throw new UserError('Channel not found. Set it with *' + ctx.var('PREFIX') + 'setchannel*.');
    } else if (ctx.isGroup && !ctx.isOwner && !(await ctx.admin())) throw new UserError('Only group admins can change this here.');
    const sub = (argv[0] || 'list').toLowerCase();
    const mine = () => ctx.get('sportsSubs', []).find(s => s.chat === target);

    if (sub === 'off' || sub === 'stop') {
      if (!mine()) throw new UserError('Live alerts are not on in this chat.');
      ctx.update('sportsSubs', [], l => { for (let i = l.length - 1; i >= 0; i--) if (l[i].chat === target) l.splice(i, 1); });
      return ctx.reply('🔕 Live alerts switched off for this chat.');
    }
    if (sub === 'list') {
      const s = mine();
      if (!s) return ctx.reply(`Live alerts are off.\nTurn them on: *${P(ctx)}livealerts on* (top leagues), *${P(ctx)}livealerts on kpl*, or *${P(ctx)}livealerts on arsenal*.`, { title: 'Live alerts' });
      return ctx.reply(`✅ On\n${s.leagues?.length ? '🏆 ' + s.leagues.map(k => LEAGUES[k].name).join(', ') : ''}${s.teams?.length ? '\n👕 ' + s.teams.join(', ') : ''}`.trim(), { title: 'Live alerts' });
    }
    if (sub !== 'on' && !(ctx.cmd === 'follow')) throw new UserError(`Use *${P(ctx)}livealerts on [league or team]*, *off* or *list*.`);

    const words = (sub === 'on' ? argv.slice(1) : argv).filter(Boolean);
    const leagues = [], teams = [];
    let cur = [];
    for (const w of words) {
      const k = leagueOf(w);
      if (k) { leagues.push(k); if (cur.length) { teams.push(cur.join(' ')); cur = []; } } else cur.push(w);
    }
    if (cur.length) teams.push(cur.join(' '));
    const item = { chat: target, leagues: [...new Set(teams.length ? leagues : (leagues.length ? leagues : defaultKeys(ctx)))], teams: teams.slice(0, 5) };
    ctx.update('sportsSubs', [], l => {
      const i = l.findIndex(s => s.chat === target);
      if (i >= 0) l[i] = item; else l.push(item);
    });
    ctx.rt.sportsPoll = 0;
    const what = item.teams.length ? `👕 ${item.teams.join(', ')}${item.leagues.length ? ' in ' + item.leagues.map(k => LEAGUES[k].name).join(', ') : ''}` : `🏆 ${item.leagues.map(k => LEAGUES[k].name).join(', ')}`;
    await ctx.reply(`🔔 Live alerts are ON for this chat.\n${what}\n\nYou will get kick-off, goals, red cards, half-time and full-time automatically. Turn off with *${P(ctx)}livealerts off*.`, { title: 'Live alerts' });
  });

  def(['matchday', 'todaygames'], { cat: 'sports', usage: 'matchday on [HH:MM] [league…] • matchday off • add "channel" (owner) to post into your channel', desc: 'Get the day\'s fixtures posted in this chat every morning. Default 08:00. Example: matchday on 07:30 epl ucl' }, async ctx => {
    const toChannel = ctx.argv.some(w => /^channel$/i.test(w));
    const argv = ctx.argv.filter(w => !/^channel$/i.test(w));
    let target = ctx.chat;
    if (toChannel) {
      if (!ctx.isOwner) throw new UserError('Only the bot owner can send alerts to the channel.');
      target = (await ctx.channelInfo())?.jid;
      if (!target) throw new UserError('Channel not found. Set it with *' + ctx.var('PREFIX') + 'setchannel*.');
    } else if (ctx.isGroup && !ctx.isOwner && !(await ctx.admin())) throw new UserError('Only group admins can change this here.');
    const sub = (argv[0] || '').toLowerCase();
    if (sub === 'off') {
      ctx.update('matchdaySubs', [], l => { for (let i = l.length - 1; i >= 0; i--) if (l[i].chat === target) l.splice(i, 1); });
      return ctx.reply('🔕 Daily fixtures switched off for this chat.');
    }
    if (sub !== 'on') {
      const s = ctx.get('matchdaySubs', []).find(x => x.chat === target);
      return ctx.reply(s ? `✅ On at ${bold(s.time)}\n🏆 ${s.leagues.map(k => LEAGUES[k].name).join(', ')}` : `Off. Turn on: *${P(ctx)}matchday on 08:00 epl ucl*`, { title: 'Daily fixtures' });
    }
    let time = '08:00'; const leagues = [];
    for (const w of argv.slice(1)) { if (/^\d{1,2}:\d{2}$/.test(w)) time = w.padStart(5, '0'); else if (leagueOf(w)) leagues.push(leagueOf(w)); }
    const [hh, mm] = time.split(':').map(Number);
    if (hh > 23 || mm > 59) throw new UserError('Use a 24-hour time like 07:30.');
    const item = { chat: target, time, leagues: [...new Set(leagues.length ? leagues : defaultKeys(ctx))], last: '' };
    ctx.update('matchdaySubs', [], l => { const i = l.findIndex(x => x.chat === target); if (i >= 0) l[i] = item; else l.push(item); });
    await ctx.reply(`📅 Today's fixtures will be posted here every day at ${bold(time)}.\n🏆 ${item.leagues.map(k => LEAGUES[k].name).join(', ')}\nTurn off with *${P(ctx)}matchday off*.`, { title: 'Daily fixtures' });
  });

  tickers.push({ name: 'sports-alerts', run: api => pollAndAlert(api) });
  tickers.push({ name: 'sports-matchday', run: api => matchdayDigest(api) });
};

module.exports.helpers = { API, LEAGUES, leagueOf, getFeed, standings, clean };
module.exports._test = { matchdayDigest, cache, parseEvent, diffMatch, alertText, pollAndAlert, line, matchCard, leagueOf, teamMatch, grouped, dayStamp };
