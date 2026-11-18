'use strict';
/**
 * WWE coverage: Raw, SmackDown, NXT, premium live events, results, schedule, champions, rumors.
 * There is no free live-score feed for wrestling, so this reads fresh headlines from Google News
 * (the same source as the .news command). Results and match cards come from the headlines.
 */
const U = require('../lib/util');
const { UserError, bold } = U;

const TOPICS = {
  news: { q: 'WWE', title: 'WWE News' },
  results: { q: 'WWE results', title: 'WWE Results' },
  raw: { q: 'WWE Raw results', title: 'WWE Raw' },
  smackdown: { q: 'WWE SmackDown results', title: 'WWE SmackDown' },
  nxt: { q: 'WWE NXT results', title: 'WWE NXT' },
  ple: { q: 'WWE premium live event results', title: 'WWE Premium Live Events' },
  schedule: { q: 'WWE upcoming events schedule', title: 'WWE Schedule' },
  card: { q: 'WWE match card preview', title: 'WWE Match Cards' },
  champions: { q: 'WWE champions title change', title: 'WWE Champions' },
  rumors: { q: 'WWE rumors backstage news', title: 'WWE Rumors' },
  wrestlemania: { q: 'WrestleMania', title: 'WrestleMania' }
};
const ALIAS = { smack: 'smackdown', sd: 'smackdown', ple: 'ple', ppv: 'ple', events: 'schedule', upcoming: 'schedule', champs: 'champions', titles: 'champions', rumours: 'rumors', mania: 'wrestlemania', cards: 'card', result: 'results', latest: 'news' };

const dec = s => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const tag = (x, n) => dec((x.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`)) || [])[1] || '');

function parseRss(xml, limit) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map(m => {
    const full = tag(m[1], 'title');
    const i = full.lastIndexOf(' - ');
    return { title: i > 20 ? full.slice(0, i) : full, source: i > 20 ? full.slice(i + 3) : '', link: tag(m[1], 'link'), date: tag(m[1], 'pubDate') };
  });
}

async function headlines(q, limit = 7) {
  const reg = process.env.NEWS_REGION || 'KE';
  const get = query => U.getText(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-${reg}&gl=${reg}&ceid=${reg}:en`, { timeout: 12000 });
  let items = parseRss(await get(`${q} when:7d`), limit);
  if (!items.length) items = parseRss(await get(q), limit);
  return items;
}

module.exports = ({ def }) => {
  def(['wwe', 'raw', 'smackdown', 'nxt', 'wrestling'], { cat: 'sports', heavy: true, usage: 'wwe [news|results|raw|smackdown|nxt|ple|schedule|card|champions|rumors|wrestlemania|<anything>]', desc: 'All of WWE: latest news, Raw / SmackDown / NXT results, premium live events, schedule, match cards, champions and rumors. Example: wwe raw  •  wwe roman reigns' }, async ctx => {
    let key = ['raw', 'smackdown', 'nxt'].includes(ctx.cmd) ? ctx.cmd : null;
    let free = '';
    if (!key) {
      const first = (ctx.argv[0] || '').toLowerCase();
      const k = TOPICS[first] ? first : ALIAS[first];
      if (k) { key = k; free = ctx.argv.slice(1).join(' '); }
      else if (ctx.argv.length) { key = 'news'; free = ctx.args; }
      else key = 'news';
    } else free = ctx.args;
    const t = TOPICS[key];
    const q = free ? `WWE ${free}` : t.q;
    const items = await headlines(q);
    if (!items.length) throw new UserError('No WWE stories found right now. Try *' + ctx.var('PREFIX') + 'wwe results*.');
    const body = items.map((n, i) => `${bold(`${i + 1}.`)} ${n.title}${n.source ? `\n_${n.source}_` : ''}\n🔗 ${n.link}`).join('\n\n');
    const topics = Object.keys(TOPICS).filter(x => x !== key).slice(0, 8).join(' • ');
    await ctx.reply(`${body}\n\n💡 ${topics}`, { title: free ? `WWE: ${free}` : t.title });
  });

  def(['sportnews', 'footynews', 'transfers'], { cat: 'sports', heavy: true, usage: 'sportnews [team|league|topic]  •  transfers [team]', desc: 'Latest sports headlines. Example: sportnews arsenal  •  transfers  •  sportnews kpl' }, async ctx => {
    const topic = ctx.args || (ctx.cmd === 'transfers' ? '' : 'football');
    const q = ctx.cmd === 'transfers' ? `${topic} football transfer news` : topic;
    const items = await headlines(q.trim() || 'football transfer news');
    if (!items.length) throw new UserError('No stories found for that topic right now.');
    await ctx.reply(items.map((n, i) => `${bold(`${i + 1}.`)} ${n.title}${n.source ? `\n_${n.source}_` : ''}\n🔗 ${n.link}`).join('\n\n'), { title: ctx.cmd === 'transfers' ? 'Transfer news' : `Sports news${ctx.args ? ': ' + ctx.args : ''}` });
  });
};

module.exports._test = { parseRss, TOPICS };
module.exports.headlines = headlines;

// Sports headlines for any team, league or topic (football by default)
module.exports.extra = true;
