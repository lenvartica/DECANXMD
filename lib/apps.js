'use strict';
/**
 * Multi-source Android app finder (v1.2.0). One search asks several stores at once and merges the answers:
 *   🅰 Aptoide (huge catalogue)   🟢 F-Droid (open-source apps)   🐙 GitHub releases (apps published as .apk release files)
 * A download tries the best match first and falls back to the next source if one is down or has no file.
 */
const U = require('./util');
const { UserError } = U;

const GH_HEAD = { 'User-Agent': 'decanxmd', Accept: 'application/vnd.github+json' };
const SRC = { aptoide: { icon: '🅰️', name: 'Aptoide' }, fdroid: { icon: '🟢', name: 'F-Droid' }, github: { icon: '🐙', name: 'GitHub' } };

/* ------------------------------------------------------------------ pure parsers */
const fromAptoide = a => ({ src: 'aptoide', name: a.name, pkg: a.package, version: a.file?.vername || '', size: Number(a.size || a.file?.filesize) || 0, url: a.file?.path || '', icon: a.icon || a.graphic || '', downloads: a.stats?.downloads ?? null, rating: a.stats?.rating?.avg ?? null, added: a.added || '' });
const parseAptoide = data => (data?.datalist?.list || []).filter(a => a?.name && a.package).map(fromAptoide);
/** F-Droid search payload -> items (package comes from the app page URL .../packages/<id>/) */
const parseFdroid = data => (data?.apps || []).map(a => {
  const pkg = /\/packages\/([^/?#]+)/.exec(a.url || '')?.[1];
  return pkg ? { src: 'fdroid', name: a.name, pkg, version: '', size: 0, url: '', icon: a.icon || '', summary: a.summary || '' } : null;
}).filter(Boolean);
const parseGithubRepos = data => (data?.items || []).map(r => ({ src: 'github', name: r.name, pkg: '', repo: r.full_name, version: '', size: 0, url: '', icon: r.owner?.avatar_url || '', summary: r.description || '', stars: r.stargazers_count || 0 }));
/** Pick the best .apk among release assets: universal/arm64 builds first, never x86-only or debug. */
function pickApkAsset(assets) {
  const apks = (assets || []).filter(a => /\.apk$/i.test(a.name || ''));
  const score = a => { const n = a.name.toLowerCase(); return (/universal|all|fat/.test(n) ? 5 : 0) + (/arm64|aarch64|v8a/.test(n) ? 4 : 0) + (/arm|v7a/.test(n) ? 1 : 0) - (/x86|x64|i386/.test(n) ? 6 : 0) - (/debug/.test(n) ? 3 : 0); };
  return apks.sort((a, b) => score(b) - score(a))[0] || null;
}
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/** Merge per-source lists: Aptoide first, then F-Droid, then GitHub; same package listed once; exact-name matches float to the top. */
function mergeResults(lists, query, limit = 10) {
  const q = norm(query), seen = new Set(), all = [];
  for (const l of lists) for (const it of l || []) {
    const key = it.pkg ? 'p:' + it.pkg : 'r:' + it.repo;
    if (seen.has(key)) continue; seen.add(key); all.push(it);
  }
  const rank = it => (norm(it.name) === q ? 0 : norm(it.name).startsWith(q) ? 1 : norm(it.name).includes(q) ? 2 : 3);
  return all.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it) - rank(b.it) || a.i - b.i).map(x => x.it).slice(0, limit);
}

/* ------------------------------------------------------------------ network */
const tryJson = (url, o = {}) => U.getJson(url, { timeout: 15000, ...o });
async function searchAptoide(q, n = 6) { return parseAptoide(await tryJson(`https://ws75.aptoide.com/api/7/apps/search?limit=${n}&query=${encodeURIComponent(q)}`)); }
async function searchFdroid(q, n = 4) { return parseFdroid(await tryJson(`https://search.f-droid.org/api/search_apps?q=${encodeURIComponent(q)}&lang=en`)).slice(0, n); }
async function searchGithub(q, n = 4) { return parseGithubRepos(await tryJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(q + ' topic:android')}&sort=stars&per_page=${n}`, { headers: GH_HEAD })); }

/** Ask every source at once. Returns { items, failed:[source names that did not answer] } */
async function searchAll(q, limit = 10) {
  const jobs = [['aptoide', searchAptoide(q)], ['fdroid', searchFdroid(q)], ['github', searchGithub(q)]];
  const res = await Promise.allSettled(jobs.map(j => j[1]));
  const failed = [], lists = [];
  res.forEach((r, i) => { if (r.status === 'fulfilled') lists.push(r.value); else failed.push(SRC[jobs[i][0]].name); });
  return { items: mergeResults(lists, q, limit), failed };
}

/** Make an item downloadable: fills url/version/size. Throws UserError when that source has no usable file. */
async function resolve(item) {
  if (item.src === 'aptoide') {
    if (item.url) return item;
    const a = (await tryJson(`https://ws75.aptoide.com/api/7/app/get/package_name=${item.pkg}`))?.nodes?.meta?.data;
    if (!a?.file?.path) throw new UserError('Aptoide has no file for that app.');
    return { ...item, ...fromAptoide(a) };
  }
  if (item.src === 'fdroid') {
    const p = await tryJson(`https://f-droid.org/api/v1/packages/${item.pkg}`);
    const code = p?.suggestedVersionCode || p?.packages?.[0]?.versionCode;
    if (!code) throw new UserError('F-Droid has no build for that app.');
    const v = (p.packages || []).find(x => x.versionCode === code);
    return { ...item, version: v?.versionName || '', url: `https://f-droid.org/repo/${item.pkg}_${code}.apk` };
  }
  if (item.src === 'github') {
    let rel = null;
    try { rel = await tryJson(`https://api.github.com/repos/${item.repo}/releases/latest`, { headers: GH_HEAD }); } catch {}
    let asset = rel && pickApkAsset(rel.assets);
    if (!asset) {
      const list = await tryJson(`https://api.github.com/repos/${item.repo}/releases?per_page=6`, { headers: GH_HEAD }).catch(() => []);
      for (const r of list) { asset = pickApkAsset(r.assets); if (asset) { rel = r; break; } }
    }
    if (!asset) throw new UserError('That repository does not publish an .apk in its releases.');
    return { ...item, version: String(rel.tag_name || '').replace(/^v/i, ''), size: asset.size || 0, url: asset.browser_download_url, fileName: asset.name };
  }
  throw new UserError('Unknown app source.');
}

/** A package name or app name -> resolved item, trying every source in turn. */
async function findAndResolve(query, { pkg = false } = {}) {
  const tried = [];
  if (pkg) {
    for (const src of ['aptoide', 'fdroid']) {
      try { return await resolve({ src, name: query, pkg: query, version: '', size: 0, url: '', icon: '' }); } catch (e) { tried.push(`${SRC[src].name}: ${e.message}`); }
    }
    throw new UserError('That package was not found in Aptoide or F-Droid.');
  }
  const { items, failed } = await searchAll(query, 12);
  if (!items.length) throw new UserError(failed.length === 3 ? 'None of the app stores answered. Try again in a minute.' : 'No apps found for that name in any source.');
  for (const it of items.slice(0, 6)) { try { return await resolve(it); } catch (e) { tried.push(`${it.name}: ${e.message}`); } }
  throw new UserError('I found matches but none had a downloadable file:\n' + tried.slice(0, 3).join('\n'));
}

const line = (it, i) => `*${i + 1}.* ${SRC[it.src].icon} ${it.name}${it.version ? ` v${it.version}` : ''}${it.size ? ` · ${U.fmtBytes(it.size)}` : ''}\n   ${SRC[it.src].name}${it.pkg ? ` · 📦 ${it.pkg}` : ` · 🐙 ${it.repo}${it.stars ? ` ★${it.stars}` : ''}`}`;

module.exports = { SRC, parseAptoide, parseFdroid, parseGithubRepos, pickApkAsset, mergeResults, searchAll, resolve, findAndResolve, line, norm };
