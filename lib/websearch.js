'use strict';
const U = require('./util');

const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** DuckDuckGo HTML results: [{ title, snippet, link }] (empty array if the page cannot be read) */
async function ddg(q, n = 5) {
  let html = '';
  try { html = await U.http('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { as: 'text', timeout: 15000, headers: { 'user-agent': 'Mozilla/5.0 (compatible; DecanBot/1.0)' } }); } catch { return []; }
  return [...String(html).matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g)].slice(0, n).map(m => {
    let link = m[1].replace(/&amp;/g, '&');
    const u = link.match(/uddg=([^&]+)/); if (u) link = decodeURIComponent(u[1]);
    return { title: strip(m[2]), snippet: m[3] ? strip(m[3]) : '', link };
  });
}
module.exports = { ddg, strip };
