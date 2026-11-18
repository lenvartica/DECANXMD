'use strict';
/**
 * Song search + download that survives YouTube blocking datacenter IPs:
 *   1. search YouTube, download the best match (retried automatically with other player clients)
 *   2. if YouTube refuses, search SoundCloud for the same title and download that instead
 */
const U = require('./util');
const SC = require('./searchcache');
const { UserError } = U;

const blocked = e => /bot check|login|sign in|not a bot|403|unavailable|HTTP/i.test(String(e?.message));

/** @returns {{buffer, title, ext, source, info}} info = the YouTube search hit (or null) */
async function getAudio(query, { cookies, onInfo } = {}) {
  const input = String(query || '').trim();
  if (!input) throw new UserError('Give a song name, artist, or a direct media link.');
  const directUrl = U.findUrl(input);
  if (directUrl) {
    const host = (() => { try { return new URL(directUrl).hostname.toLowerCase(); } catch { return ''; } })();
    const isYouTube = /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/.test(host);
    const downloaded = await U.ytDownload(directUrl, 'audio', { cookies });
    return { ...downloaded, info: null, source: isYouTube ? 'YouTube' : host || 'link' };
  }
  // Short-lived cache: a .music menu immediately followed by .play/.song for the same text
  // (or a double-tapped selection) re-uses the lookup instead of searching YouTube again.
  let info = SC.get(input);
  if (info === undefined) {
    info = null;
    try { [info] = await U.ytSearch(input, 1); } catch { /* search fallback below may still work */ }
    if (info) SC.set(input, info); // never cache a failed search
  }
  if (info && onInfo) await Promise.resolve(onInfo(info)).catch(() => {});

  let youtubeError = null;
  if (info) {
    try { return { ...(await U.ytDownload(info.url, 'audio', { cookies })), info, source: 'YouTube' }; }
    catch (e) {
      youtubeError = e;
      // Setup problems (no yt-dlp / no ffmpeg) and "too long" cannot be fixed by another source: tell the person now.
      if (/engine|yt-dlp|ffmpeg is missing/i.test(String(e?.message)) || (e instanceof UserError && /too long/i.test(e.message))) throw e;
      if (!(e instanceof UserError) && !blocked(e)) throw e;
    }
  }
  try {
    const r = await U.ytDownload('scsearch1:' + input, 'audio');
    return { ...r, info, source: 'SoundCloud' };
  } catch (e) {
    if (e instanceof UserError && /too long|engine|ffmpeg is missing/i.test(e.message)) throw e;
    const why = youtubeError?.message || e?.message || '';
    if (/bot check|login/i.test(why)) throw new UserError('YouTube is blocking this server and SoundCloud had no match for that song. Try the artist name too (for example "song artist"), or owner: send fresh cookies with .ytlogin.');
    if (!info && /reach the site|network/i.test(String(e?.message))) throw new UserError('Could not reach YouTube or SoundCloud from this server. Check the panel\'s internet access and try again.');
    throw new UserError('I could not find a downloadable copy of that song. Try a different spelling or add the artist name.' + (why ? `\n_(${String(why).slice(0, 120)})_` : ''));
  }
}

module.exports = { getAudio };
