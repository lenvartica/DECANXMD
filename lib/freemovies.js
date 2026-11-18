'use strict';
/**
 * Legal, free sources for .movie / .drama / .cartoon downloads (v1.2.0):
 *   🏛 Internet Archive  — public-domain & freely licensed films, classic TV and cartoons (direct file download)
 *   ▶️ YouTube           — full-length uploads (studio free-with-ads channels, classic TV, cartoon channels) fetched with yt-dlp
 * It does not scrape pirate streaming sites.
 */
const U = require('./util');
const { UserError } = U;

const KINDS = {
  movie: { archive: 'collection:(feature_films OR moviesandfilms)', yt: 'full movie', minMin: 40, label: 'Movie' },
  drama: { archive: 'collection:(classic_tv OR television)', yt: 'full episode drama', minMin: 15, label: 'Drama' },
  cartoon: { archive: 'collection:(animationandcartoons OR classic_cartoons)', yt: 'cartoon full episode', minMin: 4, label: 'Cartoon' }
};

/** "1:23:45" / "23:45" / "LIVE" -> minutes (LIVE -> 0) */
function minutesOf(d) {
  if (!d || /live/i.test(d)) return 0;
  const p = String(d).split(':').map(Number);
  if (p.some(n => !Number.isFinite(n))) return 0;
  const s = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0];
  return s / 60;
}
const fmtMin = m => (m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m` : `${Math.round(m)}m`);
const luceneSafe = q => String(q).replace(/[+\-&|!(){}\[\]^"~*?:\\\/]/g, ' ').replace(/\s+/g, ' ').trim();

/** archive.org advancedsearch response -> items */
function parseArchive(data) {
  return (data?.response?.docs || []).filter(d => d.identifier && d.title).map(d => {
    const title = Array.isArray(d.title) ? d.title[0] : d.title;
    return { src: 'archive', id: d.identifier, title: String(title), year: d.year ? String(d.year).slice(0, 4) : '', downloads: Number(d.downloads) || 0, runtime: d.runtime || '' };
  });
}
/** archive.org metadata -> best video file within the size cap: { name, size, url } or null */
function pickArchiveFile(meta, id, maxBytes) {
  const files = (meta?.files || []).filter(f => /\.(mp4|m4v|mkv|avi|ogv|webm|mov)$/i.test(f.name || '') && !/_(thumb|sample|trailer)\b/i.test(f.name) && f.source !== 'metadata');
  const score = f => (/\.mp4$|\.m4v$/i.test(f.name) ? 4 : /\.mkv$/i.test(f.name) ? 3 : /\.webm$/i.test(f.name) ? 2 : 1) + (/h\.?264|mpeg4/i.test(f.format || '') ? 2 : 0);
  const ok = files.map(f => ({ ...f, size: Number(f.size) || 0 })).filter(f => !maxBytes || !f.size || f.size <= maxBytes);
  const best = ok.sort((a, b) => score(b) - score(a) || b.size - a.size)[0];
  return best ? { name: best.name, size: best.size, url: `https://archive.org/download/${encodeURIComponent(id)}/${best.name.split('/').map(encodeURIComponent).join('/')}` } : null;
}

async function searchArchive(q, kind, n = 6) {
  const t = luceneSafe(q), k = KINDS[kind];
  const run = async query => parseArchive(await U.getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=downloads&fl%5B%5D=runtime&sort%5B%5D=downloads+desc&rows=${n}&output=json`, { timeout: 8000, retries: 0 }));
  let r = await run(`title:(${t}) AND mediatype:movies AND ${k.archive}`);
  if (!r.length) r = await run(`(${t}) AND mediatype:movies AND ${k.archive}`);
  return r;
}
async function searchYoutube(q, kind, n = 8) {
  const k = KINDS[kind];
  const res = await U.ytSearch(`${q} ${k.yt}`, n + 4, { timeout: 8000, retries: 0, fallback: false });
  return res.map(v => ({ src: 'youtube', title: v.title, url: v.url, channel: v.channel, minutes: minutesOf(v.duration), views: v.views }))
    .filter(v => v.minutes >= k.minMin).slice(0, n);
}

/** Search both sources. Returns { items, failed:[names] } with Internet Archive items first. */
async function search(q, kind) {
  const [a, y] = await Promise.allSettled([searchArchive(q, kind), searchYoutube(q, kind)]);
  const items = [...(a.status === 'fulfilled' ? a.value.slice(0, 5) : []), ...(y.status === 'fulfilled' ? y.value.slice(0, 5) : [])];
  const failed = [a.status === 'rejected' && 'Internet Archive', y.status === 'rejected' && 'YouTube'].filter(Boolean);
  return { items, failed };
}

const line = (it, i) => it.src === 'archive'
  ? `*${i + 1}.* 🏛 ${it.title}${it.year ? ` (${it.year})` : ''}\n   Internet Archive${it.runtime ? ` · ${it.runtime}` : ''}${it.downloads ? ` · ⬇ ${it.downloads.toLocaleString('en-US')}` : ''}`
  : `*${i + 1}.* ▶️ ${it.title}\n   YouTube · ${fmtMin(it.minutes)}${it.channel ? ` · ${it.channel}` : ''}`;

async function archiveFileFor(item, maxBytes) {
  const meta = await U.getJson(`https://archive.org/metadata/${encodeURIComponent(item.id)}`, { timeout: 20000 });
  const f = pickArchiveFile(meta, item.id, maxBytes);
  if (!f) throw new UserError('That title has no downloadable video file within the size limit.');
  return f;
}

module.exports = { KINDS, minutesOf, fmtMin, luceneSafe, parseArchive, pickArchiveFile, searchArchive, searchYoutube, search, line, archiveFileFor };
