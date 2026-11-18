'use strict';
/**
 * DECAN XMD v1.2.0 — fourth pack: .movie / .drama / .cartoon download as documents.
 *
 *   .movie <title>          details card (as before) + free full-length copies found, numbered
 *   .movie <number>         download that copy and send it as a document
 *   .movie <video link>     download any supported link (YouTube, Archive…) as a document
 *   .drama <title> / .cartoon <title>   same flow for series episodes and cartoons
 *
 * Sources are legal and free: Internet Archive (public-domain / freely licensed) and YouTube full-length uploads. No pirate sites.
 * Files are streamed to disk and sent from disk, so big files work (limits: MAX_MOVIE_MB, MAX_MOVIE_MINUTES).
 */
const U = require('../lib/util');
const { UserError, bold } = U;
const fm = require('../lib/freemovies');
const bm = require('../lib/bigmedia');
const flows = require('../lib/appflow');

const SINCE = '1.2.0';

module.exports = ({ def, registry }) => {
  const P = ctx => ctx.var('PREFIX');

  async function showList(ctx, kind, q, { quietEmpty = false } = {}) {
    const { items, failed } = await fm.search(q, kind);
    if (!items.length) {
      if (quietEmpty) return false;
      throw new UserError(failed.length === 2 ? 'Neither Internet Archive nor YouTube answered. Try again in a minute.' : `No free full-length ${kind} found for *${q}*. Most recent films are not legally free; try an older title or a different spelling.`);
    }
    flows.savePicks(ctx, kind, items);
    await ctx.reply(`${items.map(fm.line).join('\n\n')}\n\n⬇️ Send *${P(ctx)}${kind} <number>* to get it as a document.\n_Free & legal sources only: Internet Archive and YouTube._${failed.length ? `\n⚠️ Not reachable right now: ${failed.join(', ')}` : ''}`, { title: `🎬 ${fm.KINDS[kind].label}: ${q}`.slice(0, 60) });
    return true;
  }

  async function sendCopy(ctx, kind, it) {
    const L = bm.limits();
    await ctx.react?.('⏳');
    await ctx.reply(`⏳ Fetching ${bold(it.title)}…\nBig files take a few minutes. I will send it here as a document when it is ready.`, { title: fm.KINDS[kind].label });
    let file, cleanup;
    if (it.src === 'archive') {
      const f = await fm.archiveFileFor(it, L.movie * bm.MB);
      const d = await bm.downloadToFile(f.url, { maxBytes: L.movie * bm.MB });
      file = { path: d.path, name: d.name }; cleanup = d.cleanup;
    } else {
      const r = await bm.fetchVideo(it.url, { quality: 720, maxMb: L.movie, maxMinutes: L.movieMinutes, cookies: ctx.get('yt_cookies', '') || undefined });
      file = { path: r.items[0].path, name: `${bm.safeName(r.title)}.${r.items[0].ext || 'mp4'}` }; cleanup = r.cleanup;
    }
    try {
      const size = require('fs').statSync(file.path).size;
      const ext = (/\.([a-z0-9]{2,4})$/i.exec(file.name) || [, 'mp4'])[1].toLowerCase();
      await bm.sendDoc(ctx, file.path, `${bm.safeName(it.title)}.${ext}`, ext === 'mp4' ? 'video/mp4' : 'application/octet-stream', `🎬 ${it.title}${it.year ? ` (${it.year})` : ''}\n💾 ${U.fmtBytes(size)} · ${it.src === 'archive' ? 'Internet Archive' : 'YouTube'}`);
      await ctx.react?.('✅');
    } finally { cleanup(); }
  }

  /** shared entry: number -> download that pick; link -> download it; text -> search */
  async function flow(ctx, kind, q, before) {
    if (/^\d{1,2}$/.test(q)) return sendCopy(ctx, kind, flows.loadPick(ctx, kind, Number(q)));
    if (U.isUrl(q)) {
      const url = U.findUrl(q);
      return sendCopy(ctx, kind, { src: 'youtube', title: 'Video', url });
    }
    let infoErr = null;
    let found;
    if (before) {
      const [, search] = await Promise.allSettled([
        before().catch(e => { if (e instanceof UserError) infoErr = e; }),
        showList(ctx, kind, q, { quietEmpty: true })
      ]);
      if (search.status === 'rejected') throw search.reason;
      found = search.value;
    } else {
      found = await showList(ctx, kind, q);
    }
    if (!found && infoErr) throw infoErr;
    if (!found) await ctx.reply(`No free full-length copy was found for *${q}*.\nMost recent films are not legally free to download.`, { title: fm.KINDS[kind].label });
  }

  /* ---- .movie keeps its details card; the download list is added underneath. A separate command object so imdb/tmdb/movieinfo stay as they were. */
  const origMovie = registry.get('movie');
  if (origMovie) {
    const run = async ctx => {
      const q = ctx.input().trim();
      if (!q) throw new UserError(`Which movie? Example: *${P(ctx)}movie night of the living dead* (then *${P(ctx)}movie 1* to download).`);
      return flow(ctx, 'movie', q, /^\d{1,2}$/.test(q) || U.isUrl(q) ? null : () => origMovie.run(ctx));
    };
    const movie = { ...origMovie, name: 'movie', names: ['movie'], since: SINCE, usage: 'movie <title> • movie <number> • movie <link>', desc: 'Movie details, plus free full-length copies you can download as a document (Internet Archive, YouTube).', run };
    registry.set('movie', movie);
    registry.set('movies', { ...movie, name: 'movies', names: ['movies'] });
  }

  def(['drama', 'dramas', 'episode'], { since: SINCE, cat: 'download', heavy: true, usage: 'drama <title> • drama <number> • drama <link>', desc: 'Find a free full drama / series episode and download it as a document.' }, async ctx => {
    const q = ctx.input().trim();
    if (!q) throw new UserError(`Which drama? Example: *${P(ctx)}drama the twilight zone* (then *${P(ctx)}drama 1*).`);
    return flow(ctx, 'drama', q);
  });

  /* ---- .cartoon was a photo effect; with a photo it still is, with a title it finds cartoons */
  const origCartoon = registry.get('cartoon');
  const cartoonRun = async ctx => {
    const q = ctx.input().trim();
    const hasPhoto = Boolean(ctx.quoted) || Boolean(ctx.mediaTypeOf?.(ctx.unwrap?.(ctx.msg?.message)));
    if (hasPhoto && origCartoon) return origCartoon.run(ctx);
    if (!q) throw new UserError(`Which cartoon? Example: *${P(ctx)}cartoon popeye* (then *${P(ctx)}cartoon 1*). Reply to a photo instead to cartoonize it.`);
    return flow(ctx, 'cartoon', q);
  };
  const animeRun = async ctx => {
    const q = ctx.input().trim();
    const hasPhoto = Boolean(ctx.quoted) || Boolean(ctx.mediaTypeOf?.(ctx.unwrap?.(ctx.msg?.message)));
    if (hasPhoto && origCartoon) return origCartoon.run(ctx);
    if (!q) throw new UserError(`Which anime? Example: *${P(ctx)}anime astro boy* (then *${P(ctx)}anime 1*). Reply to a photo instead to cartoonize it.`);
    return flow(ctx, 'cartoon', q);
  };
  if (origCartoon) {
    const cartoon = { ...origCartoon, name: 'cartoon', names: ['cartoon'], since: SINCE, usage: 'cartoon <title> • cartoon <number> • (reply to a photo to cartoonize it)', desc: 'Find free full cartoons and download them as documents; reply to a photo to turn it into a cartoon.', run: cartoonRun };
    registry.set('cartoon', cartoon);
    registry.set('anime', { ...cartoon, name: 'anime', names: ['anime'], usage: 'anime <title> • anime <number> • (reply to a photo to cartoonize it)', desc: 'Find free anime and cartoons; reply to a photo to turn it into a cartoon.', run: animeRun });
  }
  else def('cartoon', { since: SINCE, cat: 'download', heavy: true, usage: 'cartoon <title>', desc: 'Find free full cartoons and download them as documents.' }, cartoonRun);
};

module.exports.__test = { SINCE };
