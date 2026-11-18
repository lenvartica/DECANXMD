'use strict';
/**
 * DECAN XMD v1.2.0 — third pack: football deep-dive, WWE shortcuts, picture editing, more downloaders.
 *
 *  Football (ESPN public feed, no key):  squad, nextmatch, lastresults, scorers, leaguenews, injuries, fulltable,
 *                                        titlerace, relegation, wcgroups, ustable, sportsmenu
 *  WWE (Google News headlines):          wwechamps, wweschedule, wweresults, wwerumors, wwemania, royalrumble,
 *                                        summerslam, survivorseries, aew, superstar, wwedraft, wwehof, wwewomen
 *  Picture editing (sharp, local):       hd, autofix, hdr, brighten, darken, contrast, saturate, fade, warm, cool, vintage,
 *                                        noir, glow, dreamy, cyberpunk, sunset, emboss, duotone, oldphoto, polaroid,
 *                                        vignettefx, cleanimg, roundcorners, mirrorfx, picfilters
 *  Downloaders:                          apksearch, apkdl, appinfo, gitclone, ghrelease, ytthumb
 *
 * Every command here is skipped (not an error) if an older file already owns the name.
 * Football/WWE parsers are written against ESPN's documented payload shapes and are unit-tested with fixtures.
 */
const U = require('../lib/util');
const { UserError, bold } = U;
const sports = require('./sports');
const wwe = require('./wwe');
const img = require('../lib/img');

const SINCE = '1.2.0';
const { API, LEAGUES, leagueOf, getFeed, clean } = sports.helpers;
const SOCCER = Object.keys(LEAGUES).filter(k => LEAGUES[k].sport === 'soccer');
const TOP = ['epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'ucl', 'kpl', 'primeira', 'eredivisie', 'mls', 'saudi', 'championship', 'scottish', 'super_lig', 'brasileirao', 'argentina'];

/* =============================================================================================
 *  Pure parsers (exported for tests)
 * ============================================================================================= */
const val = x => (x && typeof x === 'object' ? (x.displayValue ?? x.value) : x);
const numOr = (x, d = 0) => { const n = Number(val(x)); return Number.isFinite(n) ? n : d; };

/** ESPN standings payload -> [{name, rows:[{rank,name,p,w,d,l,gf,ga,gd,pts,pct,gb}]}] (one group per conference/group) */
function parseStandings(data) {
  const rowsOf = entries => (entries || []).map((e, i) => {
    const s = {};
    for (const x of e.stats || []) s[x.name] = x.value;
    const gf = s.pointsFor ?? s.goalsFor, ga = s.pointsAgainst ?? s.goalsAgainst;
    return {
      rank: numOr(s.rank ?? s.playoffSeed, i + 1), name: e.team?.displayName || e.athlete?.displayName || '?',
      p: numOr(s.gamesPlayed), w: numOr(s.wins), d: numOr(s.ties ?? s.draws), l: numOr(s.losses),
      gf: gf == null ? null : numOr(gf), ga: ga == null ? null : numOr(ga),
      gd: numOr(s.pointDifferential ?? s.goalDifferential ?? (gf != null && ga != null ? gf - ga : 0)),
      pts: numOr(s.points), pct: s.winPercent == null ? null : numOr(s.winPercent), gb: s.gamesBehind == null ? null : numOr(s.gamesBehind)
    };
  }).sort((a, b) => (a.rank || 99) - (b.rank || 99));
  const groups = [];
  if (Array.isArray(data?.children) && data.children.length) {
    for (const c of data.children) { const rows = rowsOf(c.standings?.entries); if (rows.length) groups.push({ name: c.name || c.abbreviation || '', rows }); }
  } else if (data?.standings?.entries) {
    const rows = rowsOf(data.standings.entries);
    if (rows.length) groups.push({ name: '', rows });
  }
  return groups;
}

const signed = n => (n > 0 ? `+${n}` : String(n));
/** Monospace table rows. mode 'short' (P W D L GD Pts) or 'full' (adds GF GA). */
function tableText(rows, mode = 'short', nameW = 15) {
  const head = mode === 'full' ? ` #  ${'Team'.padEnd(nameW)} P  W  D  L  GF  GA   GD Pts` : ` #  ${'Team'.padEnd(nameW)} P  W  D  L   GD Pts`;
  const body = rows.map(r => {
    const base = `${String(r.rank).padStart(2)} ${r.name.slice(0, nameW).padEnd(nameW)} ${String(r.p).padStart(2)} ${String(r.w).padStart(2)} ${String(r.d).padStart(2)} ${String(r.l).padStart(2)}`;
    return mode === 'full'
      ? `${base} ${String(r.gf ?? '-').padStart(3)} ${String(r.ga ?? '-').padStart(3)} ${signed(r.gd).padStart(4)} ${String(r.pts).padStart(3)}`
      : `${base} ${signed(r.gd).padStart(4)} ${String(r.pts).padStart(3)}`;
  });
  return '```\n' + head + '\n' + body.join('\n') + '\n```';
}

/** ESPN teams list payload -> [{id,name,short,abbr}] */
function parseTeams(data) {
  const list = data?.sports?.[0]?.leagues?.[0]?.teams || data?.teams || [];
  return list.map(t => t.team || t).filter(t => t && t.id).map(t => ({ id: String(t.id), name: t.displayName || t.name || '?', short: t.shortDisplayName || t.name || '', abbr: t.abbreviation || '', location: t.location || '' }));
}
/** Best team for a query: exact name > startsWith > contains. */
function findTeam(teams, q) {
  const n = clean(q);
  if (!n) return null;
  const f = pick => teams.find(t => [t.name, t.short, t.abbr, t.location].some(x => pick(clean(x))));
  return f(x => x === n) || f(x => x.startsWith(n)) || f(x => n.length >= 3 && x.includes(n)) || null;
}

const POS_ORDER = ['G', 'GK', 'D', 'DF', 'M', 'MF', 'F', 'FW', 'ST'];
const POS_NAME = { G: 'Goalkeepers', GK: 'Goalkeepers', D: 'Defenders', DF: 'Defenders', M: 'Midfielders', MF: 'Midfielders', F: 'Forwards', FW: 'Forwards', ST: 'Forwards' };
/** ESPN roster payload (flat list or grouped) -> [{name, jersey, pos, age}] */
function parseRoster(data) {
  const flat = [];
  for (const a of data?.athletes || []) {
    if (Array.isArray(a?.items)) flat.push(...a.items); else flat.push(a);
  }
  return flat.filter(a => a && (a.displayName || a.fullName)).map(a => ({
    name: a.displayName || a.fullName, jersey: a.jersey ? String(a.jersey) : '', pos: String(a.position?.abbreviation || a.position?.name || '?').toUpperCase(), age: a.age || null
  }));
}
function rosterText(players) {
  const by = new Map();
  for (const p of players) { const k = POS_NAME[p.pos] || 'Others'; if (!by.has(k)) by.set(k, []); by.get(k).push(p); }
  const order = ['Goalkeepers', 'Defenders', 'Midfielders', 'Forwards', 'Others'];
  return order.filter(k => by.has(k)).map(k => {
    const ps = by.get(k).sort((a, b) => (Number(a.jersey) || 99) - (Number(b.jersey) || 99));
    return `*${k}* (${ps.length})\n` + ps.map(p => `${p.jersey ? `#${p.jersey}`.padEnd(4) : '•   '} ${p.name}${p.age ? ` · ${p.age}` : ''}`).join('\n');
  }).join('\n\n');
}

/** Team schedule payload (or scoreboard-like) -> events [{id,date,home,away,hs,as,done,live,comp}] */
function parseSchedule(data) {
  return (data?.events || []).map(ev => {
    const c = ev.competitions?.[0] || {};
    const cs = c.competitors || [];
    const h = cs.find(x => x.homeAway === 'home') || cs[0], a = cs.find(x => x.homeAway === 'away') || cs[1];
    if (!h || !a) return null;
    const t = c.status?.type || ev.status?.type || {};
    const hasScore = x => x.score != null && val(x.score) !== '';
    return {
      date: new Date(ev.date || c.date || 0), home: { id: String(h.id ?? h.team?.id ?? ''), name: h.team?.displayName || h.team?.name || '?', score: hasScore(h) ? numOr(h.score) : null, winner: h.winner },
      away: { id: String(a.id ?? a.team?.id ?? ''), name: a.team?.displayName || a.team?.name || '?', score: hasScore(a) ? numOr(a.score) : null, winner: a.winner },
      done: Boolean(t.completed) || t.state === 'post', live: t.state === 'in', comp: ev.league?.name || ev.season?.name || ''
    };
  }).filter(e => e && !Number.isNaN(e.date.getTime())).sort((a, b) => a.date - b.date);
}
/** W / D / L for a team in a finished event */
function outcome(ev, teamId) {
  if (!ev.done || ev.home.score == null || ev.away.score == null) return null;
  const mine = ev.home.id === String(teamId) ? ev.home : ev.away, other = mine === ev.home ? ev.away : ev.home;
  return mine.score > other.score ? 'W' : mine.score < other.score ? 'L' : 'D';
}
const FORM_EMOJI = { W: '🟩', D: '🟨', L: '🟥' };

/** ESPN news payload -> [{title, link}] */
function parseNews(data, limit = 8) {
  return (data?.articles || []).slice(0, limit).map(a => ({ title: a.headline || a.title || '', link: a.links?.web?.href || a.links?.mobile?.href || '' })).filter(a => a.title);
}
/** Leaders payload (several shapes) -> [{name, team, value}] for the goals category */
function parseScorers(data, limit = 10) {
  const cats = data?.leaders || data?.categories || data?.stats?.categories || [];
  const cat = cats.find(c => /goal/i.test(`${c.name || ''} ${c.displayName || ''}`) && !/assist|against/i.test(`${c.name || ''} ${c.displayName || ''}`)) || null;
  return ((cat && (cat.leaders || cat.athletes)) || []).slice(0, limit).map(l => ({
    name: l.athlete?.displayName || l.athlete?.fullName || l.displayName || '?', team: l.team?.displayName || l.athlete?.team?.displayName || '', value: numOr(l.value ?? l.displayValue)
  }));
}

/* =============================================================================================
 *  Data layer
 * ============================================================================================= */
async function teamsOf(key) {
  return parseTeams(await getFeed(`${API}/site/v2/sports/soccer/${LEAGUES[key].slug}/teams?limit=200`, 6 * 3600 * 1000));
}
/** Split "arsenal epl" -> {query:'arsenal', league:'epl'} (league is optional, last word) */
function splitLeague(argv) {
  const words = argv.filter(Boolean);
  const last = words[words.length - 1];
  const lk = words.length > 1 ? leagueOf(last) : null;
  return lk && LEAGUES[lk].sport === 'soccer' ? { query: words.slice(0, -1).join(' '), league: lk } : { query: words.join(' '), league: null };
}
/** Find a football team across the major leagues (or the one named). */
async function locateTeam(query, league) {
  const keys = league ? [league] : TOP;
  const res = await Promise.allSettled(keys.map(async k => ({ k, team: findTeam(await teamsOf(k), query) })));
  const ok = res.filter(r => r.status === 'fulfilled');
  if (!ok.length) throw new UserError('Football data is unreachable right now. Try again in a minute.');
  // prefer domestic leagues (earlier in TOP) over cups
  for (const k of keys) { const hit = ok.map(r => r.value).find(v => v.k === k && v.team); if (hit) return { key: hit.k, team: hit.team }; }
  throw new UserError(`I could not find a club called *${query}*. Try the full name, e.g. *Manchester United*, or add a league code: *arsenal epl*.`);
}

/* =============================================================================================
 *  Image effects (sharp). Each takes ({s, b, w, h, k}) where k is a 1-10 strength.
 * ============================================================================================= */
const LAP = { width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1], scale: 1, offset: 0 };
const EMBOSS = { width: 3, height: 3, kernel: [-2, -1, 0, -1, 1, 1, 0, 1, 2], scale: 1, offset: 128 };
const vig = (w, h, color, op, from = 40) => img.svg(w, h, `<defs>${img.vignette('v', color, op, from)}</defs><rect width="100%" height="100%" fill="url(#v)"/>`);
const hex = c => (/^#?[0-9a-f]{6}$/i.test(c || '') ? '#' + c.replace('#', '') : null);

const FX = {
  hd: ['HD upscale: 2x size with sharper detail and cleaner colours', async ({ s, b, w, h }) => {
    const f = Math.min(2, 2048 / Math.max(w, h));
    return img.out(s(b).resize(Math.round(w * f), Math.round(h * f), { kernel: 'lanczos3' }).median(3).normalise({ lower: 1, upper: 99 }).sharpen({ sigma: 1.2, m1: 1, m2: 2 }).modulate({ saturation: 1.08 }));
  }],
  autofix: ['One-tap fix: balance light, colour and sharpness', async ({ s, b }) => img.out(s(b).normalise({ lower: 1, upper: 99 }).gamma(1.1).sharpen({ sigma: 1 }).modulate({ saturation: 1.1 }))],
  hdr: ['HDR look: local contrast and punchy colour', async ({ s, b, w, h, k }) => img.out(s(b).clahe({ width: Math.max(4, Math.ceil(w / 8)), height: Math.max(4, Math.ceil(h / 8)), maxSlope: Math.min(8, 2 + Math.round(k / 2)) }).modulate({ saturation: 1.2 }).sharpen({ sigma: 1.1 }))],
  brighten: ['Make it brighter (strength 1-10)', async ({ s, b, k }) => img.out(s(b).modulate({ brightness: 1 + k * 0.06 }).gamma(1 + k * 0.03))],
  darken: ['Make it darker (strength 1-10)', async ({ s, b, k }) => img.out(s(b).modulate({ brightness: 1 - k * 0.06 }))],
  contrast: ['Boost contrast (strength 1-10)', async ({ s, b, k }) => img.out(s(b).linear(1 + k * 0.07, -(k * 9)))],
  saturate: ['Richer colours (strength 1-10)', async ({ s, b, k }) => img.out(s(b).modulate({ saturation: 1 + k * 0.12 }))],
  fade: ['Washed-out matte fade (strength 1-10)', async ({ s, b, k }) => img.out(s(b).modulate({ saturation: 1 - k * 0.06 }).linear(1 - k * 0.04, 20 + k * 3))],
  warm: ['Warm golden tone (strength 1-10)', async ({ s, b, k }) => img.out(s(b).linear([1 + k * 0.012, 1, 1 - k * 0.018], [0, 0, 0]))],
  cool: ['Cool blue tone (strength 1-10)', async ({ s, b, k }) => img.out(s(b).linear([1 - k * 0.018, 1, 1 + k * 0.012], [0, 0, 0]))],
  vintage: ['Faded retro film look', async ({ s, b, w, h }) => img.out(s(b).modulate({ saturation: 0.75, brightness: 1.03 }).linear([1.08, 1.0, 0.88], [6, 2, -4]).composite([{ input: vig(w, h, '#2a1500', 0.6) }]))],
  noir: ['High-contrast black & white with a dark vignette', async ({ s, b, w, h }) => img.out(s(b).greyscale().linear(1.35, -30).composite([{ input: vig(w, h, '#000', 0.85, 30) }]))],
  glow: ['Soft dreamy glow on highlights', async ({ s, b, k }) => {
    const bl = await s(b).blur(6 + k).modulate({ brightness: 1.15 }).toBuffer();
    return img.out(s(b).composite([{ input: bl, blend: 'screen' }]).modulate({ saturation: 1.1 }));
  }],
  dreamy: ['Soft pastel dream look', async ({ s, b }) => {
    const bl = await s(b).blur(5).toBuffer();
    return img.out(s(b).composite([{ input: bl, blend: 'soft-light' }]).modulate({ saturation: 1.15, brightness: 1.07 }).linear(0.94, 14));
  }],
  cyberpunk: ['Neon magenta and cyan grade', async ({ s, b, w, h }) => {
    const g = img.svg(w, h, '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00e5ff"/><stop offset="1" stop-color="#ff00c8"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>');
    return img.out(s(b).modulate({ saturation: 1.35 }).linear(1.15, -15).composite([{ input: g, blend: 'soft-light' }, { input: vig(w, h, '#12002b', 0.7, 35) }]));
  }],
  sunset: ['Golden-hour sunset grade', async ({ s, b, w, h }) => {
    const g = img.svg(w, h, '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5e62"/><stop offset="1" stop-color="#ffc371"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>');
    return img.out(s(b).modulate({ saturation: 1.15 }).composite([{ input: g, blend: 'soft-light' }]));
  }],
  emboss: ['Embossed relief effect', async ({ s, b }) => img.out(s(b).greyscale().convolve(EMBOSS))],
  oldphoto: ['Aged sepia photo with grain', async ({ s, b, w, h }) => {
    const grain = Buffer.alloc(w * h * 3);
    for (let i = 0; i < grain.length; i++) grain[i] = 100 + Math.floor(Math.random() * 56);
    const g = await s(grain, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    return img.out(s(b).greyscale().tint('#a67c4a').linear(0.95, 10).composite([{ input: g, blend: 'soft-light' }, { input: vig(w, h, '#2b1a08', 0.7, 35) }]));
  }],
  vignettefx: ['Dark cinematic edges (strength 1-10)', async ({ s, b, w, h, k }) => img.out(s(b).composite([{ input: vig(w, h, '#000', Math.min(0.95, 0.3 + k * 0.07), 30) }]))],
  cleanimg: ['Reduce noise and speckle, keep edges', async ({ s, b, k }) => img.out(s(b).median(k > 6 ? 5 : 3).sharpen({ sigma: 0.8 }))],
  mirrorfx: ['Mirror the left half onto the right (symmetry)', async ({ s, b, w, h }) => {
    const half = await s(b).extract({ left: 0, top: 0, width: Math.floor(w / 2), height: h }).toBuffer();
    const flipped = await s(half).flop().toBuffer();
    return img.out(s({ create: { width: Math.floor(w / 2) * 2, height: h, channels: 3, background: '#000' } }).composite([{ input: half, left: 0, top: 0 }, { input: flipped, left: Math.floor(w / 2), top: 0 }]));
  }],
  neonedge: ['Glowing neon outlines on black', async ({ s, b }) => img.out(s(b).greyscale().blur(0.8).convolve(LAP).linear(3, 0).tint('#00ffd5'))]
};

const ghRepo = s => {
  const m = String(s || '').trim().match(/(?:github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/tree\/([^\s/]+))?(?:[/?#].*)?$/);
  return m ? { owner: m[1], repo: m[2], branch: m[3] || null } : null;
};

/* =============================================================================================
 *  Command registration
 * ============================================================================================= */
module.exports = ({ def: rawDef, alias: rawAlias, registry, events }) => {
  const def = (names, opts, run) => {
    const n = [].concat(names).filter(x => !registry.has(x.toLowerCase()));
    if (n.length) rawDef(n, { since: SINCE, ...opts }, run);
  };
  const P = ctx => ctx.var('PREFIX');
  const tzOf = ctx => { try { return ctx.tz?.() || ctx.var('TIMEZONE') || 'UTC'; } catch { return 'UTC'; } };
  const when = (d, tz) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); } catch { return d.toISOString().slice(0, 16).replace('T', ' '); } };
  const need = (ctx, what) => { if (!ctx.args.trim()) throw new UserError(`Tell me ${what}. Example: *${P(ctx)}${ctx.cmd} ${what === 'a club' ? 'arsenal' : 'epl'}*`); };

  /* ------------------------------------------ football ------------------------------------------ */
  def(['squad', 'roster', 'players'], { cat: 'sports', heavy: true, usage: 'squad <club> [league]', desc: 'Full squad of a club by position with shirt numbers. Example: squad arsenal' }, async ctx => {
    need(ctx, 'a club');
    const { query, league } = splitLeague(ctx.argv);
    const { key, team } = await locateTeam(query, league);
    const data = await getFeed(`${API}/site/v2/sports/soccer/${LEAGUES[key].slug}/teams/${team.id}/roster`, 3600000).catch(() => { throw new UserError('Squad data is unavailable right now.'); });
    const players = parseRoster(data);
    if (!players.length) throw new UserError(`No squad list is published for *${team.name}* right now.`);
    await ctx.reply(`${rosterText(players)}\n\n👥 ${players.length} players · ${LEAGUES[key].name}`, { title: `⚽ ${team.name}` });
  });

  const scheduleFor = async (ctx) => {
    need(ctx, 'a club');
    const { query, league } = splitLeague(ctx.argv);
    const { key, team } = await locateTeam(query, league);
    const data = await getFeed(`${API}/site/v2/sports/soccer/${LEAGUES[key].slug}/teams/${team.id}/schedule`, 600000).catch(() => { throw new UserError('Fixture data is unavailable right now.'); });
    return { key, team, events: parseSchedule(data) };
  };
  def(['nextmatch', 'nextgame', 'nextfixtures'], { cat: 'sports', heavy: true, usage: 'nextmatch <club> [league]', desc: 'The next matches a club will play. Example: nextmatch chelsea' }, async ctx => {
    const { key, team, events } = await scheduleFor(ctx);
    const tz = tzOf(ctx);
    const next = events.filter(e => !e.done).slice(0, 5);
    if (!next.length) throw new UserError(`No upcoming matches are listed for *${team.name}* (${LEAGUES[key].name}).`);
    await ctx.reply(next.map((e, i) => `${i === 0 ? '🔜' : '▫️'} ${bold(`${e.home.name} vs ${e.away.name}`)}\n   🗓 ${when(e.date, tz)}${e.live ? ' · 🔴 LIVE' : ''}`).join('\n\n'), { title: `⚽ ${team.name}: next` });
  });
  def(['lastresults', 'form', 'recentresults'], { cat: 'sports', heavy: true, usage: 'lastresults <club> [league]', desc: 'Last five results and current form of a club. Example: form liverpool' }, async ctx => {
    const { key, team, events } = await scheduleFor(ctx);
    const done = events.filter(e => e.done && e.home.score != null).slice(-5).reverse();
    if (!done.length) throw new UserError(`No finished matches are listed for *${team.name}* (${LEAGUES[key].name}).`);
    const letters = done.map(e => outcome(e, team.id)).filter(Boolean);
    const lines = done.map(e => `${FORM_EMOJI[outcome(e, team.id)] || '▫️'} ${e.home.name} *${e.home.score}-${e.away.score}* ${e.away.name}`);
    const pts = letters.reduce((n, l) => n + (l === 'W' ? 3 : l === 'D' ? 1 : 0), 0);
    await ctx.reply(`${letters.map(l => FORM_EMOJI[l]).join(' ')}   ${bold(letters.join(' '))}\n\n${lines.join('\n')}\n\n📈 ${pts} points from ${letters.length} games`, { title: `⚽ ${team.name}: form` });
  });

  def(['scorers', 'topscorers', 'goldenboot', 'topscorer'], { cat: 'sports', heavy: true, usage: 'scorers [league]', desc: 'Top goalscorers of a league (default Premier League). Example: scorers laliga' }, async ctx => {
    const key = leagueOf(ctx.argv[0] || 'epl');
    if (!key || LEAGUES[key].sport !== 'soccer') throw new UserError(`Which league? Example: *${P(ctx)}scorers epl*. See *${P(ctx)}leagues*.`);
    const slug = LEAGUES[key].slug;
    let list = [];
    for (const url of [`https://site.web.api.espn.com/apis/site/v2/sports/soccer/${slug}/leaders`, `${API}/site/v2/sports/soccer/${slug}/leaders`, `https://site.web.api.espn.com/apis/v2/sports/soccer/${slug}/leaders`]) {
      try { list = parseScorers(await getFeed(url, 900000)); } catch { list = []; }
      if (list.length) break;
    }
    if (!list.length) throw new UserError(`The scorers chart for *${LEAGUES[key].name}* is not available from the data source right now. Try *${P(ctx)}table ${ctx.argv[0] || 'epl'}* or *${P(ctx)}leaguenews ${ctx.argv[0] || 'epl'}*.`);
    const medal = ['🥇', '🥈', '🥉'];
    await ctx.reply(list.map((p, i) => `${medal[i] || bold(`${i + 1}.`)} ${bold(p.name)}${p.team ? ` _(${p.team})_` : ''} — ⚽ ${p.value}`).join('\n'), { title: `${LEAGUES[key].icon} ${LEAGUES[key].name}: top scorers` });
  });

  def(['leaguenews', 'fnews'], { cat: 'sports', heavy: true, usage: 'leaguenews [league]', desc: 'Latest headlines for a football league. Example: leaguenews epl' }, async ctx => {
    const key = leagueOf(ctx.argv[0] || 'epl');
    if (!key) throw new UserError(`Which league? Example: *${P(ctx)}leaguenews epl*.`);
    const lg = LEAGUES[key];
    let items = [];
    try { items = parseNews(await getFeed(`${API}/site/v2/sports/${lg.sport}/${lg.slug}/news?limit=8`, 300000)); } catch { items = []; }
    if (!items.length) items = (await wwe.headlines(`${lg.name} football`).catch(() => [])).map(n => ({ title: n.title, link: n.link }));
    if (!items.length) throw new UserError('No headlines found right now.');
    await ctx.reply(items.map((n, i) => `${bold(`${i + 1}.`)} ${n.title}${n.link ? `\n🔗 ${n.link}` : ''}`).join('\n\n'), { title: `${lg.icon} ${lg.name} news` });
  });

  def(['injuries', 'injurynews', 'teamnews'], { cat: 'sports', heavy: true, usage: 'injuries <club>', desc: 'Latest injury and team news for a club. Example: injuries arsenal' }, async ctx => {
    need(ctx, 'a club');
    const items = await wwe.headlines(`${ctx.cmd === 'teamnews' ? '' : 'injury news '}${ctx.args} football`.trim());
    if (!items.length) throw new UserError('No stories found for that club right now.');
    await ctx.reply(items.map((n, i) => `${bold(`${i + 1}.`)} ${n.title}${n.source ? `\n_${n.source}_` : ''}\n🔗 ${n.link}`).join('\n\n'), { title: `🩹 ${ctx.args}` });
  });

  const tableFor = async (ctx, dflt = 'epl') => {
    const key = leagueOf(ctx.argv[0] || dflt);
    if (!key) throw new UserError(`Which league? Example: *${P(ctx)}${ctx.cmd} epl*. See *${P(ctx)}leagues*.`);
    const lg = LEAGUES[key];
    const data = await getFeed(`${API}/v2/sports/${lg.sport}/${lg.slug}/standings`, 300000).catch(() => { throw new UserError('The table is unavailable right now. Try again in a minute.'); });
    const groups = parseStandings(data);
    if (!groups.length) throw new UserError(`No table is available for *${lg.name}* right now.`);
    return { key, lg, groups };
  };
  def(['fulltable', 'bigtable', 'fullstandings'], { cat: 'sports', heavy: true, usage: 'fulltable [league]', desc: 'Complete league table with goals for/against. Example: fulltable epl' }, async ctx => {
    const { lg, groups } = await tableFor(ctx);
    if (lg.sport !== 'soccer') throw new UserError(`For ${lg.name} use *${P(ctx)}ustable ${ctx.argv[0]}*.`);
    await ctx.reply(tableText(groups[0].rows, 'full'), { title: `${lg.icon} ${lg.name}` });
  });
  def(['titlerace', 'topfour'], { cat: 'sports', heavy: true, usage: 'titlerace [league]', desc: 'Who is leading and how far ahead? Top 5 with gaps. Example: titlerace epl' }, async ctx => {
    const { lg, groups } = await tableFor(ctx);
    const rows = groups[0].rows.slice(0, 5), top = rows[0];
    const lines = rows.map((r, i) => `${['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]} ${bold(r.name)} — ${r.pts} pts${i ? ` _(${top.pts - r.pts} behind)_` : ` _(${r.p} played)_`}`);
    const gap = rows[1] ? top.pts - rows[1].pts : 0;
    await ctx.reply(`${lines.join('\n')}\n\n📊 ${gap ? `${top.name} lead by ${gap} point${gap === 1 ? '' : 's'}.` : 'Level at the top!'}`, { title: `${lg.icon} ${lg.name}: title race` });
  });
  def(['relegation', 'dropzone', 'survival'], { cat: 'sports', heavy: true, usage: 'relegation [league]', desc: 'The relegation battle: bottom five and the gap to safety. Example: relegation epl' }, async ctx => {
    const { lg, groups } = await tableFor(ctx);
    const rows = groups[0].rows;
    if (rows.length < 8) throw new UserError('This competition has no relegation zone.');
    const zone = 3, bottom = rows.slice(-5), safe = rows[rows.length - zone - 1];
    const lines = bottom.map((r, i) => {
      const inZone = rows.indexOf(r) >= rows.length - zone;
      return `${inZone ? '🔻' : '🟢'} ${bold(`${r.rank}.`)} ${r.name} — ${r.pts} pts ${inZone ? `_(${safe.pts - r.pts} from safety)_` : '_(safe)_'}`;
    });
    await ctx.reply(`${lines.join('\n')}\n\n🔻 = in the drop zone (bottom ${zone})`, { title: `${lg.icon} ${lg.name}: relegation battle` });
  });
  def(['wcgroups', 'tablegroups', 'groupstage'], { cat: 'sports', heavy: true, usage: 'wcgroups [wc|euro|afcon|ucl…]', desc: 'Every group of a tournament table (default World Cup). Example: wcgroups euro' }, async ctx => {
    const { lg, groups } = await tableFor(ctx, 'wc');
    const body = groups.slice(0, 12).map(g => `*${g.name || 'Table'}*\n${tableText(g.rows.slice(0, 6), 'short', 14)}`).join('\n');
    await ctx.reply(body, { title: `${lg.icon} ${lg.name}` });
  });
  def(['ustable', 'nbatable', 'nfltable', 'nhltable', 'mlbtable', 'conference'], { cat: 'sports', heavy: true, usage: 'ustable <nba|nfl|nhl|mlb> (or nbatable, nfltable…)', desc: 'US league standings by conference/division. Example: nbatable' }, async ctx => {
    const dflt = ctx.cmd.endsWith('table') && ctx.cmd !== 'ustable' ? ctx.cmd.slice(0, -5) : (ctx.argv[0] || 'nba');
    const key = leagueOf(dflt);
    if (!key || LEAGUES[key].sport === 'soccer') throw new UserError(`Pick a US league: *${P(ctx)}ustable nba* (nba, nfl, nhl, mlb, wnba).`);
    const fake = Object.assign(Object.create(ctx), { argv: [key] });
    const { lg, groups } = await tableFor(fake);
    const body = groups.slice(0, 6).map(g => {
      const rows = g.rows.slice(0, 8).map(r => `${String(r.rank).padStart(2)} ${r.name.slice(0, 18).padEnd(18)} ${String(r.w).padStart(3)}-${String(r.l).padEnd(3)}${r.pct != null ? ` ${r.pct.toFixed(3).replace(/^0/, '')}` : ''}`).join('\n');
      return `*${g.name || lg.name}*\n\`\`\`\n${rows}\n\`\`\``;
    }).join('\n');
    await ctx.reply(body, { title: `${lg.icon} ${lg.name}` });
  });

  def(['sportsmenu', 'sportshelp', 'footballhelp'], { cat: 'sports', usage: 'sportsmenu', desc: 'Everything sports in one cheat-sheet: football, WWE, tables, scores.' }, async ctx => {
    const seen = new Set();
    const rows = [];
    for (const d of registry.values()) {
      if (d.cat !== 'sports' || seen.has(d) || d.hidden) continue;
      seen.add(d);
      rows.push(`▫️ *${P(ctx)}${d.name}*${d.usage && d.usage.length < 48 && d.usage !== d.name ? ` — ${d.usage.replace(/^\S+\s*/, '') || ''}` : ''}`.replace(/ — $/, ''));
    }
    const p = P(ctx);
    await ctx.reply(`${rows.join('\n')}\n\n💡 Start here: *${p}livescore* · *${p}table epl* · *${p}squad arsenal* · *${p}wwe*`, { title: `🏟️ Sports hub (${rows.length})` });
  });

  /* -------------------------------------------- WWE -------------------------------------------- */
  const WWE = [
    [['wwechamps', 'wwechampions'], 'WWE champions title change', 'WWE Champions', 'Who holds the WWE titles right now (from fresh headlines).'],
    [['wweschedule', 'wweevents'], 'WWE upcoming events schedule', 'WWE Schedule', 'Upcoming WWE shows and premium live events.'],
    [['wweresults', 'rawresults'], 'WWE Raw SmackDown results', 'WWE Results', 'Latest Raw, SmackDown and PLE results.'],
    [['wwerumors', 'wwerumours', 'wwebackstage'], 'WWE rumors backstage news', 'WWE Rumors', 'Backstage news and rumours.'],
    [['wwemania'], 'WrestleMania', 'WrestleMania', 'WrestleMania news, card and results.'],
    [['royalrumble'], 'Royal Rumble', 'Royal Rumble', 'Royal Rumble news, entrants and winners.'],
    [['summerslam'], 'SummerSlam', 'SummerSlam', 'SummerSlam news, card and results.'],
    [['survivorseries'], 'Survivor Series', 'Survivor Series', 'Survivor Series news, card and results.'],
    [['aew', 'aewnews'], 'AEW All Elite Wrestling', 'AEW', 'All Elite Wrestling news and results.'],
    [['wwedraft'], 'WWE Draft', 'WWE Draft', 'WWE Draft picks and news.'],
    [['wwehof', 'halloffame'], 'WWE Hall of Fame', 'WWE Hall of Fame', 'Hall of Fame inductees and news.'],
    [['wwewomen', 'womensdivision'], 'WWE women\'s division', 'WWE Women', 'Women\'s division news and results.']
  ];
  for (const [names, q, title, desc] of WWE) {
    def(names, { cat: 'sports', heavy: true, usage: `${names[0]} [extra words]`, desc }, async ctx => {
      const items = await wwe.headlines(ctx.args ? `${q} ${ctx.args}` : q);
      if (!items.length) throw new UserError('No stories found right now. Try *' + P(ctx) + 'wwe*.');
      await ctx.reply(items.map((n, i) => `${bold(`${i + 1}.`)} ${n.title}${n.source ? `\n_${n.source}_` : ''}\n🔗 ${n.link}`).join('\n\n'), { title: `🤼 ${title}` });
    });
  }
  def(['superstar', 'wwestar', 'wrestler'], { cat: 'sports', heavy: true, usage: 'superstar <name>', desc: 'Latest news about a wrestler. Example: superstar cody rhodes' }, async ctx => {
    need(ctx, 'a wrestler');
    const items = await wwe.headlines(`${ctx.args} wrestling`);
    if (!items.length) throw new UserError(`No stories found for *${ctx.args}* right now.`);
    await ctx.reply(items.map((n, i) => `${bold(`${i + 1}.`)} ${n.title}${n.source ? `\n_${n.source}_` : ''}\n🔗 ${n.link}`).join('\n\n'), { title: `🤼 ${ctx.args}` });
  });

  /* ------------------------------------- one-command status posting ------------------------------------- */
  /** photo -> short vertical video with a blurred backdrop (so a photo can be posted as a status video) */
  const photoToVideo = (buffer, secs) => U.ff(buffer, {
    inExt: 'jpg', outExt: 'mp4',
    args: (i, o) => ['-loop', '1', '-i', i, '-t', String(secs), '-filter_complex',
      "[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=24:6[bg];[0:v]scale=720:1280:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,zoompan=z='min(zoom+0.0006,1.12)':d=1:s=720x1280:fps=25,format=yuv420p",
      '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast', '-movflags', '+faststart', '-an', o]
  });
  def(['tostatus', 'mystatus', 'poststory'], { cat: 'whatsapp', owner: true, usage: 'tostatus [caption] (reply to a photo, video, voice note or text) • tostatus video [seconds] (photo → video) • tostatus <text>', desc: 'Post anything to your WhatsApp status so your contacts and group members can see it. Reply to a photo/video/voice note, or type text. Add "video" to turn a photo into a short video.' }, async ctx => {
    let target = null, args = ctx.input().trim(), media = null;
    if (ctx.quoted) {
      media = await ctx.media().catch(() => null);
      if (media?.kind === 'image') target = 'statusimage'; else if (media?.kind === 'video') target = 'statusvideo'; else if (media?.kind === 'audio') target = 'statusaudio';
      else { const t = ctx.textOf?.(ctx.quoted?.message); if (t) { target = 'textstatus'; args = args || t; } }
    } else if (args) target = 'textstatus';
    if (!target || !registry.has(target)) throw new UserError(`Reply to a photo, video, voice note or text with *${P(ctx)}tostatus [caption]*, or type *${P(ctx)}tostatus Good morning!*\nTo turn a photo into a video: reply to it with *${P(ctx)}tostatus video*`);
    let run = ctx;
    if (target === 'statusimage' && /(?:^|\s)(video|animate|reel)(?=\s|$)/i.test(args)) {
      const secs = Math.min(30, Math.max(3, Number((/(?:^|\s)(\d{1,2})(?=\s|$)/.exec(args) || [])[1]) || 8));
      args = args.replace(/(?:^|\s)(video|animate|reel)(?=\s|$)/i, ' ').replace(/(?:^|\s)\d{1,2}(?=\s|$)/, ' ').trim();
      let mp4;
      try { mp4 = await photoToVideo(media.buffer, secs); } catch { throw new UserError('I could not turn that photo into a video on this host.'); }
      target = 'statusvideo';
      run = Object.assign(Object.create(ctx), { needMedia: async () => ({ kind: 'video', buffer: mp4 }) });
    }
    const d = registry.get(target);
    return d.run(Object.assign(Object.create(run), { cmd: target, args, argv: args.split(/\s+/).filter(Boolean), input: () => args }));
  });

  // learn your contacts from WhatsApp's own sync events so statuses reach them, not only people who messaged the bot
  const SA = require('../lib/statusaudience');
  const ids = list => (Array.isArray(list) ? list : []).map(x => x?.id || x?.jid || x?.phoneNumber).filter(Boolean);
  for (const [name, pick] of [['contacts.upsert', ids], ['contacts.update', ids], ['chats.upsert', ids], ['messaging-history.set', h => [...ids(h?.contacts), ...ids(h?.chats)]]]) {
    events.push({ name, run: async (api, payload) => { SA.remember(api, pick(payload)); } });
  }

  /* --------------------------------------- picture editing --------------------------------------- */
  const strength = ctx => { const n = Number(ctx.argv.find(a => /^\d+(\.\d+)?$/.test(a))); return Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n))) : 5; };
  for (const [name, [desc, fn]] of Object.entries(FX)) {
    def(name, { cat: 'editor', heavy: true, usage: `${name} [1-10]`, desc: `${desc}. Reply to an image.` }, async ctx => {
      const m = await ctx.needMedia('image', `Reply to an image with *${P(ctx)}${name}*.`);
      let b;
      try { b = await img.base(m.buffer); } catch { throw new UserError('I could not read that image. Send a normal photo (JPG, PNG or WebP).'); }
      await ctx.image(await fn({ ...b, k: strength(ctx) }), `✨ ${name}`);
    });
  }
  def(['duotone', 'twotone'], { cat: 'editor', heavy: true, usage: 'duotone [#colour1] [#colour2]', desc: 'Two-colour poster look, e.g. duotone #ff0080 #00e5ff. Reply to an image.' }, async ctx => {
    const m = await ctx.needMedia('image', `Reply to an image with *${P(ctx)}duotone*.`);
    const [c1, c2] = [hex(ctx.argv[0]) || '#1b0a3c', hex(ctx.argv[1]) || '#ff7ab8'];
    const { s, b, w, h } = await img.base(m.buffer);
    const grey = await s(b).greyscale().normalise().toColourspace('srgb').png().toBuffer();
    const g = img.svg(w, h, `<defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`);
    await ctx.image(await img.out(s(g).composite([{ input: grey, blend: 'overlay' }]).modulate({ saturation: 1.2 })), `🎨 duotone ${c1} → ${c2}`);
  });
  def(['polaroid', 'instantphoto'], { cat: 'editor', heavy: true, usage: 'polaroid [caption]', desc: 'Instant-photo frame with an optional handwritten-style caption. Reply to an image.' }, async ctx => {
    const m = await ctx.needMedia('image', `Reply to an image with *${P(ctx)}polaroid*.`);
    const { s, b, w, h } = await img.base(m.buffer);
    const pad = Math.round(Math.max(w, h) * 0.05), bottom = pad * 4;
    const framed = await s(b).rotate().extend({ top: pad, left: pad, right: pad, bottom, background: '#fbfbf7' }).png().toBuffer();
    let layers = [];
    if (ctx.args.trim()) {
      const cap = await img.textPng(ctx.args.trim().slice(0, 40), w, Math.round(bottom * 0.6), '#333333');
      layers = [{ input: cap, top: h + pad + Math.round(bottom * 0.2), left: pad }];
    }
    await ctx.image(await img.out(s(framed).composite(layers).flatten({ background: '#fbfbf7' }).resize({ width: 1024, withoutEnlargement: true })), '📸 polaroid');
  });
  def(['roundcorners', 'rounded'], { cat: 'editor', heavy: true, usage: 'roundcorners [1-10]', desc: 'Rounded corners on a transparent PNG (sent as a file). Reply to an image.' }, async ctx => {
    const m = await ctx.needMedia('image', `Reply to an image with *${P(ctx)}roundcorners*.`);
    const { s, b, w, h } = await img.base(m.buffer);
    const r = Math.round(Math.min(w, h) * 0.03 * strength(ctx));
    const mask = img.svg(w, h, `<rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/>`);
    const png = await s(b).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    await ctx.doc(png, 'rounded.png', 'image/png');
  });
  def(['picfilters', 'editmenu', 'photomenu'], { cat: 'editor', usage: 'picfilters', desc: 'List every picture-editing command.' }, async ctx => {
    const seen = new Set(), rows = [];
    for (const d of registry.values()) {
      if (d.cat !== 'editor' || seen.has(d)) continue;
      seen.add(d);
      rows.push(`▫️ *${P(ctx)}${d.name}*`);
    }
    await ctx.reply(`${rows.join('  ')}\n\n💡 Reply to a photo with any of these. Many accept a strength: *${P(ctx)}brighten 8*`, { title: `🖼️ Photo studio (${rows.length})` });
  });

  /* ----------------------------------------- downloaders ----------------------------------------- */
  const flows = require('../lib/appflow');
  def(['apksearch', 'apps'], { cat: 'download', heavy: true, usage: 'apksearch <app name>', desc: 'Search Aptoide, F-Droid and GitHub at once; then download with apk <number>. Example: apksearch telegram' }, ctx => flows.apksearchCommand(ctx));
  def(['apkdl', 'getapk'], { cat: 'download', heavy: true, usage: 'apkdl <package name>', desc: 'Download an APK by exact package name (Aptoide, then F-Droid). Example: apkdl org.telegram.messenger' }, ctx => flows.apkdlCommand(ctx));
  const aptoide = async q => (await U.getJson('https://ws75.aptoide.com/api/7/apps/search?limit=8&query=' + encodeURIComponent(q), { timeout: 15000 }))?.datalist?.list || [];
  def(['appinfo', 'playstore'], { cat: 'download', heavy: true, usage: 'appinfo <app name>', desc: 'Details of an Android app: version, size, downloads, rating.' }, async ctx => {
    const q = ctx.input().trim();
    if (!q) throw new UserError(`Give an app name, e.g. *${P(ctx)}appinfo whatsapp*`);
    const a = (await aptoide(q).catch(() => []))[0];
    if (!a) throw new UserError('App not found.');
    const st = a.stats || {};
    const lines = [`📱 ${bold(a.name)}`, `📦 ${a.package}`, `🔢 Version ${a.file?.vername || '?'}`, `💾 ${U.fmtBytes(a.size || a.file?.filesize || 0)}`];
    if (st.downloads != null) lines.push(`⬇️ ${Number(st.downloads).toLocaleString('en-US')} downloads`);
    if (st.rating?.avg) lines.push(`⭐ ${Number(st.rating.avg).toFixed(1)} / 5`);
    if (a.added) lines.push(`🗓 Added ${String(a.added).slice(0, 10)}`);
    await ctx.send({ image: { url: a.icon || a.graphic }, caption: ctx.frame(`${lines.join('\n')}\n\n⬇️ ${P(ctx)}apkdl ${a.package}`, 'App info') }, { quoted: ctx.msg }).catch(() => ctx.reply(`${lines.join('\n')}\n\n⬇️ ${P(ctx)}apkdl ${a.package}`, { title: 'App info' }));
  });

  def(['gitclone', 'repozip', 'githubzip'], { cat: 'download', heavy: true, usage: 'gitclone <owner/repo | github link>', desc: 'Download a GitHub repository as a ZIP. Example: gitclone nodejs/node' }, async ctx => {
    const r = ghRepo(ctx.input());
    if (!r) throw new UserError(`Give a repo like *${P(ctx)}gitclone owner/repo* or a github.com link.`);
    const meta = await U.getJson(`https://api.github.com/repos/${r.owner}/${r.repo}`, { timeout: 15000, headers: { 'User-Agent': 'decanxmd', Accept: 'application/vnd.github+json' } }).catch(() => { throw new UserError('Repository not found (or it is private).'); });
    const branch = r.branch || meta.default_branch || 'main';
    const approx = (meta.size || 0) * 1024;
    const info = `📦 ${bold(meta.full_name)}\n📝 ${meta.description || 'No description'}\n⭐ ${meta.stargazers_count} · 🍴 ${meta.forks_count} · 🌿 ${branch}`;
    if (approx > U.maxDownloadBytes()) throw new UserError(`${info}\n\nThis repo is about ${U.fmtBytes(approx)}, over the ${U.fmtBytes(U.maxDownloadBytes())} limit.`);
    await ctx.reply(`${info}\n\n⏳ Zipping…`, { title: 'GitHub' });
    const f = await U.download(`https://codeload.github.com/${meta.full_name}/zip/refs/heads/${encodeURIComponent(branch)}`, { maxBytes: U.maxDownloadBytes() });
    await ctx.doc(f.buffer, `${meta.name}-${branch}.zip`, 'application/zip');
  });
  def(['ghrelease', 'release'], { cat: 'download', heavy: true, usage: 'ghrelease <owner/repo> [file number]', desc: 'Latest release of a GitHub project. List its files, then pick one. Example: ghrelease termux/termux-app 1' }, async ctx => {
    const r = ghRepo(ctx.argv[0]);
    if (!r) throw new UserError(`Give a repo like *${P(ctx)}ghrelease owner/repo*.`);
    const rel = await U.getJson(`https://api.github.com/repos/${r.owner}/${r.repo}/releases/latest`, { timeout: 15000, headers: { 'User-Agent': 'decanxmd', Accept: 'application/vnd.github+json' } }).catch(() => { throw new UserError('No published release found for that repository.'); });
    const assets = rel.assets || [];
    if (!assets.length) throw new UserError(`*${rel.name || rel.tag_name}* has no downloadable files.`);
    const n = Number(ctx.argv[1]);
    if (!n && assets.length > 1) {
      await ctx.reply(`${bold(rel.name || rel.tag_name)} (${String(rel.published_at || '').slice(0, 10)})\n\n${assets.map((a, i) => `${bold(`${i + 1}.`)} ${a.name} · ${U.fmtBytes(a.size)}`).join('\n')}\n\n⬇️ Pick one: *${P(ctx)}ghrelease ${r.owner}/${r.repo} 1*`, { title: '📦 Release' });
      return;
    }
    const a = assets[(n || 1) - 1];
    if (!a) throw new UserError(`Choose a number from 1 to ${assets.length}.`);
    if (a.size > U.maxDownloadBytes()) throw new UserError(`${a.name} is ${U.fmtBytes(a.size)}, over the limit.\n⬇️ ${a.browser_download_url}`);
    const f = await U.download(a.browser_download_url, { maxBytes: U.maxDownloadBytes() });
    await ctx.doc(f.buffer, a.name, a.content_type || f.mime || 'application/octet-stream');
  });
  def(['ytthumb', 'ytthumbnail', 'thumbdl'], { cat: 'download', heavy: true, usage: 'ytthumb <YouTube link>', desc: 'Download the full-size thumbnail of a YouTube video.' }, async ctx => {
    const id = (ctx.input().match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/) || [])[1];
    if (!id) throw new UserError(`Send a YouTube link, e.g. *${P(ctx)}ytthumb https://youtu.be/dQw4w9WgXcQ*`);
    let f = null;
    for (const q of ['maxresdefault', 'sddefault', 'hqdefault']) { try { f = await U.download(`https://img.youtube.com/vi/${id}/${q}.jpg`, { maxBytes: 10e6 }); if (f.buffer.length > 2000) break; } catch { f = null; } }
    if (!f) throw new UserError('Could not fetch that thumbnail.');
    await ctx.image(f.buffer, '🖼️ Thumbnail');
  });
};

module.exports.__test = { parseStandings, tableText, parseTeams, findTeam, parseRoster, rosterText, parseSchedule, outcome, parseNews, parseScorers, splitLeague, FX, ghRepo };
