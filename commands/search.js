'use strict';
const U = require('../lib/util');
const { UserError, bold } = U;

const WMO = { 0: 'Clear sky ☀️', 1: 'Mostly clear 🌤️', 2: 'Partly cloudy ⛅', 3: 'Overcast ☁️', 45: 'Fog 🌫️', 48: 'Rime fog 🌫️', 51: 'Light drizzle 🌦️', 53: 'Drizzle 🌦️', 55: 'Heavy drizzle 🌧️', 61: 'Light rain 🌦️', 63: 'Rain 🌧️', 65: 'Heavy rain 🌧️', 71: 'Light snow 🌨️', 73: 'Snow 🌨️', 75: 'Heavy snow ❄️', 80: 'Rain showers 🌦️', 81: 'Rain showers 🌧️', 82: 'Violent showers ⛈️', 95: 'Thunderstorm ⛈️', 96: 'Thunderstorm + hail ⛈️', 99: 'Severe thunderstorm ⛈️' };

async function geocode(q) {
  const j = await U.getJson('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(q));
  const r = j.results?.[0];
  if (!r) throw new UserError(`Could not find a place called "${q}".`);
  return r;
}

module.exports = ({ def }) => {
  def('weather', { cat: 'search', heavy: true, usage: 'weather <city>', desc: 'Current weather and today\'s forecast.' }, async ctx => {
    const q = ctx.input();
    if (!q) throw new UserError('Give a city, e.g. *weather Nairobi*');
    const g = await geocode(q);
    const w = await U.getJson(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`);
    const c = w.current, d = w.daily;
    await ctx.reply([
      `📍 ${bold('Place')}: ${g.name}, ${g.country || ''}`,
      `🌡 ${bold('Now')}: ${c.temperature_2m}°C (feels ${c.apparent_temperature}°C)`,
      `☁️ ${bold('Sky')}: ${WMO[c.weather_code] || 'Unknown'}`,
      `💧 ${bold('Humidity')}: ${c.relative_humidity_2m}%`,
      `💨 ${bold('Wind')}: ${c.wind_speed_10m} km/h`,
      `📈 ${bold('Today')}: ${d.temperature_2m_min[0]}° – ${d.temperature_2m_max[0]}°C, rain chance ${d.precipitation_probability_max[0] ?? 0}%`
    ].join('\n'), { title: 'Weather' });
  });

  def('time', { cat: 'search', usage: 'time <city or timezone>', desc: 'Current time in a city (default: the bot timezone).' }, async ctx => {
    const q = ctx.input();
    let tz = ctx.tz(), place = tz;
    if (q) {
      if (/^[A-Za-z_]+\/[A-Za-z_\/-]+$/.test(q)) { tz = q; place = q; }
      else { const g = await geocode(q); tz = g.timezone; place = `${g.name}, ${g.country || ''}`; }
    }
    const p = U.tzParts(tz);
    await ctx.reply(`📍 ${bold('Place')}: ${place}\n🕒 ${bold('Time')}: ${p.time}:${p.s}\n📅 ${bold('Date')}: ${p.weekday}, ${p.date}\n🌐 ${bold('Zone')}: ${tz}`, { title: 'World time' });
  });

  def('trt', { cat: 'search', usage: 'trt <lang code> <text>  (or reply: trt fr)', desc: 'Translate text. Language is a code like en, sw, fr, es, ar.' }, async ctx => {
    let lang = 'en', text = ctx.args;
    const first = ctx.argv[0];
    if (first && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(first) && (ctx.argv.length > 1 || ctx.quoted)) { lang = first; text = ctx.args.slice(first.length).trim(); }
    if (!text && ctx.quoted) text = ctx.textOf(ctx.quoted.message);
    if (!text) throw new UserError('Usage: *trt sw Hello friend* or reply to a message with *trt fr*');
    const j = await U.getJson(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`);
    const out = (j[0] || []).map(x => x[0]).join('');
    await ctx.reply(`${out}\n\n🌐 ${j[2] || 'auto'} → ${lang}`, { title: 'Translation' });
  });

  def('yts', { cat: 'search', heavy: true, usage: 'yts <query>', desc: 'Search YouTube.' }, async ctx => {
    const q = ctx.input();
    if (!q) throw new UserError('What should I search for?');
    const r = await U.ytSearch(q, 8);
    if (!r.length) throw new UserError('No results.');
    await ctx.reply(r.map((v, i) => `${i + 1}. ${bold(v.title)}\n   ⏱ ${v.duration} • 👁 ${v.views}\n   🔗 ${v.url}`).join('\n\n'), { title: 'YouTube results' });
  });

  def('img', { cat: 'search', heavy: true, usage: 'img <query>[,count]', desc: 'Search for images (default 3, max 8).' }, async ctx => {
    const [qraw, cnt] = ctx.input().split(',');
    const q = (qraw || '').trim();
    if (!q) throw new UserError('What images? e.g. *img solo leveling wallpaper,4*');
    const n = Math.min(8, Math.max(1, Number(cnt) || 3));
    const html = await U.getText(`https://www.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC2&first=1&safeSearch=Moderate`, { headers: { 'accept-language': 'en-US,en;q=0.9' } });
    const urls = [...html.matchAll(/murl&quot;:&quot;(https?:[^&]+?)&quot;/g)].map(m => m[1]).filter(u => /\.(jpe?g|png|webp)(\?|$)/i.test(u));
    if (!urls.length) throw new UserError('No images found.');
    let sent = 0;
    for (const u of urls) {
      if (sent >= n) break;
      try { const buf = await U.http(u, { timeout: 15000, maxBytes: 8e6 }); await ctx.image(buf, `🖼️ ${q}`); sent++; } catch {}
    }
    if (!sent) throw new UserError('Found images, but none could be downloaded. Try again.');
  });

  def('movie', { cat: 'search', heavy: true, usage: 'movie <title>', desc: 'Movie / series details.' }, async ctx => {
    const q = ctx.input();
    if (!q) throw new UserError('Give a title, e.g. *movie Solo Leveling*');
    let m;
    if (process.env.OMDB_API_KEY) {
      const j = await U.getJson(`https://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&plot=short&t=${encodeURIComponent(q)}`, { timeout: 8000, retries: 0 });
      if (j.Response === 'False') throw new UserError('Movie not found.');
      m = { title: j.Title, year: j.Year, rating: j.imdbRating, genre: j.Genre, plot: j.Plot, cast: j.Actors, poster: j.Poster };
    } else {
      const j = await U.getJson('https://imdb.iamidiotareyoutoo.com/search?q=' + encodeURIComponent(q), { timeout: 8000, retries: 0 });
      const r = j.description?.[0];
      if (!r) throw new UserError('Movie not found.');
      m = { title: r['#TITLE'], year: r['#YEAR'], rating: r['#RANK'] ? '#' + r['#RANK'] : '-', genre: r['#CAT'] || '-', plot: '-', cast: r['#ACTORS'], poster: r['#IMG_POSTER'] };
    }
    const cap = `🎬 ${bold(m.title)} (${m.year})\n⭐ ${bold('Rating')}: ${m.rating}\n🎭 ${bold('Genre')}: ${m.genre}\n👥 ${bold('Cast')}: ${m.cast}\n📝 ${m.plot}`;
    if (m.poster && m.poster !== 'N/A') await ctx.send({ image: { url: m.poster }, caption: cap }, { quoted: ctx.msg }).catch(() => ctx.reply(cap));
    else await ctx.reply(cap);
  });

  def('jean', { cat: 'search', heavy: true, usage: 'jean <topic>', desc: 'Quick encyclopedia summary of any topic (Wikipedia).' }, async ctx => {
    const q = ctx.input();
    if (!q) throw new UserError('Give a topic, e.g. *jean Solo Leveling*');
    const s = await U.getJson('https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&search=' + encodeURIComponent(q));
    const title = s[1]?.[0];
    if (!title) throw new UserError('Nothing found.');
    const j = await U.getJson('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
    const cap = `📖 ${bold(j.title)}\n\n${j.extract}\n\n🔗 ${j.content_urls?.mobile?.page || ''}`;
    if (j.thumbnail?.source) await ctx.send({ image: { url: j.thumbnail.source }, caption: cap }, { quoted: ctx.msg }).catch(() => ctx.reply(cap));
    else await ctx.reply(cap);
  });

  def('ison', { cat: 'search', usage: 'ison <number> [more numbers]', desc: 'Check whether numbers are on WhatsApp.' }, async ctx => {
    const nums = ctx.args.split(/[\s,]+/).map(x => x.replace(/\D/g, '')).filter(x => x.length >= 7 && x.length <= 15).slice(0, 20);
    if (!nums.length) throw new UserError('Give numbers with country code, e.g. *ison 254712345678*');
    const res = await ctx.sock.onWhatsApp(...nums.map(n => n + '@s.whatsapp.net'));
    const map = new Map((res || []).map(r => [String(r.jid).split('@')[0].split(':')[0], r.exists]));
    await ctx.reply(nums.map(n => `${map.get(n) ? '✅' : '❌'} ${n}`).join('\n'), { title: 'On WhatsApp?' });
  });

  def('ig', { cat: 'search', heavy: true, usage: 'ig <username>', desc: 'Instagram profile info (best effort; Instagram often blocks servers).' }, async ctx => {
    const u = ctx.input().replace('@', '').trim();
    if (!u) throw new UserError('Give an Instagram username.');
    const j = await U.getJson('https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(u), { headers: { 'x-ig-app-id': '936619743392459' } }).catch(() => null);
    const p = j?.data?.user;
    if (!p) throw new UserError('Could not fetch that profile (Instagram blocked the request or the user does not exist).');
    const cap = `📸 ${bold(p.full_name || p.username)} (@${p.username})\n👥 ${bold('Followers')}: ${p.edge_followed_by?.count}\n➡️ ${bold('Following')}: ${p.edge_follow?.count}\n🖼 ${bold('Posts')}: ${p.edge_owner_to_timeline_media?.count}\n🔒 ${bold('Private')}: ${p.is_private ? 'yes' : 'no'}\n\n${p.biography || ''}`;
    if (p.profile_pic_url_hd) await ctx.send({ image: { url: p.profile_pic_url_hd }, caption: cap }, { quoted: ctx.msg }).catch(() => ctx.reply(cap));
    else await ctx.reply(cap);
  });

  def('find', { cat: 'search', heavy: true, usage: 'find (reply to a song)', desc: 'Identify a song from audio (needs AUDD_API_TOKEN on the server).' }, async ctx => {
    if (!process.env.AUDD_API_TOKEN) throw new UserError('Song recognition needs an AudD token. Add AUDD_API_TOKEN to the local .env file and restart the bot (free trial at audd.io).');
    const m = await ctx.needMedia(['audio', 'video']);
    const buf = await U.ff(m.buffer, { inExt: 'bin', outExt: 'mp3', args: ['-vn', '-t', '25', '-c:a', 'libmp3lame', '-b:a', '96k'] });
    const fd = new FormData();
    fd.append('api_token', process.env.AUDD_API_TOKEN);
    fd.append('return', 'spotify,apple_music');
    fd.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'clip.mp3');
    const j = await U.getJson('https://api.audd.io/', { method: 'POST', body: fd, timeout: 60000 });
    if (!j.result) throw new UserError('Could not recognise that song.');
    await ctx.reply(`🎵 ${bold('Title')}: ${j.result.title}\n🎤 ${bold('Artist')}: ${j.result.artist}\n💿 ${bold('Album')}: ${j.result.album || '-'}\n📅 ${bold('Released')}: ${j.result.release_date || '-'}\n🔗 ${j.result.song_link || ''}`, { title: 'Song found' });
  });

  /* Emoji → sticker */
  const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const emojis = s => [...seg.segment(s)].map(x => x.segment).filter(x => /\p{Extended_Pictographic}/u.test(x));
  const codes = e => [...e].map(c => c.codePointAt(0).toString(16)).filter(c => c !== 'fe0f').join('_');

  def('emoji', { cat: 'search', heavy: true, usage: 'emoji <emoji>', desc: 'Turn an emoji into a big sticker.' }, async ctx => {
    const e = emojis(ctx.input())[0];
    if (!e) throw new UserError('Send one emoji, e.g. *emoji 😎*');
    let png;
    try { png = await U.http(`https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/512/emoji_u${codes(e)}.png`, { timeout: 15000 }); }
    catch { png = await U.http(`https://fonts.gstatic.com/s/e/notoemoji/latest/${codes(e).replace(/_/g, '_')}/512.png`, { timeout: 15000 }).catch(() => { throw new UserError('That emoji is not available.'); }); }
    await ctx.sticker(await U.withExif(await U.imageToWebp(png), ctx.var('STICKER_PACK'), ctx.var('STICKER_AUTHOR')));
  });

  def('emix', { cat: 'search', heavy: true, usage: 'emix 😀+😍', desc: 'Mix two emojis into one sticker (Emoji Kitchen; needs TENOR_API_KEY).' }, async ctx => {
    if (!process.env.TENOR_API_KEY) throw new UserError('Emoji mixing needs a free Tenor API key. Add TENOR_API_KEY to the local .env file and restart the bot (Google Cloud console → Tenor API).');
    const es = emojis(ctx.input());
    if (es.length < 2) throw new UserError('Send two emojis, e.g. *emix 😀+😍*');
    const j = await U.getJson(`https://tenor.googleapis.com/v2/featured?key=${process.env.TENOR_API_KEY}&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${encodeURIComponent(es[0] + '_' + es[1])}`);
    const url = j.results?.[0]?.media_formats?.png_transparent?.url;
    if (!url) throw new UserError('Those two emojis cannot be mixed.');
    await ctx.sticker(await U.withExif(await U.imageToWebp(await U.http(url)), ctx.var('STICKER_PACK'), ctx.var('STICKER_AUTHOR')));
  });
};
