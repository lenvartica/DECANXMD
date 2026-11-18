'use strict';
/** Command flows for the multi-source .apk family and the numbered "pick from the last search" memory shared with .movie/.drama/.cartoon. */
const U = require('./util');
const apps = require('./apps');
const bm = require('./bigmedia');
const { UserError, bold } = U;

/* ------------- "reply with a number" memory: the last list shown to this person in this chat (15 minutes) ------------- */
const PICK_TTL = 15 * 60 * 1000;
const key = ctx => `${ctx.chat}|${ctx.senderNum}`;
function savePicks(ctx, kind, items) { const m = (ctx.rt.picks ||= new Map()); m.set(key(ctx), { kind, items, at: Date.now() }); if (m.size > 200) m.delete(m.keys().next().value); }
function loadPick(ctx, kind, n) {
  const e = ctx.rt.picks?.get(key(ctx));
  if (!e || e.kind !== kind || Date.now() - e.at > PICK_TTL) throw new UserError(`That list has expired. Search again first, e.g. *${ctx.var('PREFIX')}${kind} <name>*.`);
  const it = e.items[n - 1];
  if (!it) throw new UserError(`Pick a number from 1 to ${e.items.length}.`);
  return it;
}

const fileNameFor = it => bm.safeName(it.fileName || `${it.name}${it.version ? '-' + it.version : ''}.apk`);

/** Download a resolved item and send it as an APK document. */
async function sendApk(ctx, it) {
  const lim = bm.limits().apk * bm.MB;
  const info = `📱 ${bold(it.name)}\n${apps.SRC[it.src].icon} ${apps.SRC[it.src].name}${it.pkg ? `\n📦 ${it.pkg}` : ''}${it.version ? `\n🔢 v${it.version}` : ''}${it.size ? `\n💾 ${U.fmtBytes(it.size)}` : ''}`;
  if (it.size && it.size > lim) return ctx.reply(`${info}\n\nToo large to send here (limit ${U.fmtBytes(lim)}).\n⬇️ ${it.url}`, { title: 'APK' });
  await ctx.reply(`${info}\n\n⏳ Downloading…`, { title: 'APK' });
  const f = await bm.downloadToFile(it.url, { maxBytes: lim, ext: 'apk' });
  try { await bm.sendDoc(ctx, f.path, fileNameFor(it), 'application/vnd.android.package-archive', `📱 ${it.name}${it.version ? ` v${it.version}` : ''} · ${U.fmtBytes(f.size)}`); await ctx.react?.('✅'); }
  finally { f.cleanup(); }
}

async function showList(ctx, q) {
  const { items, failed } = await apps.searchAll(q, 10);
  if (!items.length) throw new UserError(failed.length === 3 ? 'None of the app stores answered. Try again in a minute.' : 'No apps found for that name in any source.');
  savePicks(ctx, 'apk', items);
  const p = ctx.var('PREFIX');
  await ctx.reply(`${items.map(apps.line).join('\n\n')}\n\n⬇️ Reply *${p}apk <number>* to download one${failed.length ? `\n⚠️ Not reachable right now: ${failed.join(', ')}` : ''}`, { title: `📱 Apps: ${q}` });
}

/** .apk <name> | .apk <number> | .apk list <name> */
async function apkCommand(ctx) {
  const q = ctx.input().trim();
  if (!q) throw new UserError(`Give an app name, e.g. *${ctx.var('PREFIX')}apk whatsapp*. See choices first with *${ctx.var('PREFIX')}apksearch <name>*.`);
  if (/^\d{1,2}$/.test(q)) return sendApk(ctx, await apps.resolve(loadPick(ctx, 'apk', Number(q))));
  const list = /^(?:list|search)\s+(.+)/i.exec(q);
  if (list) return showList(ctx, list[1]);
  await ctx.react?.('🔎');
  const it = await apps.findAndResolve(q);
  await sendApk(ctx, it);
}
async function apksearchCommand(ctx) {
  const q = ctx.input().trim();
  if (!q) throw new UserError(`Give an app name, e.g. *${ctx.var('PREFIX')}apksearch telegram*`);
  await showList(ctx, q);
}
async function apkdlCommand(ctx) {
  const pkg = ctx.argv[0] || '';
  if (!/^[a-z][a-z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(pkg)) throw new UserError(`Give the package name, e.g. *${ctx.var('PREFIX')}apkdl org.telegram.messenger* (find it with *${ctx.var('PREFIX')}apksearch*).`);
  await sendApk(ctx, await apps.findAndResolve(pkg, { pkg: true }));
}

module.exports = { savePicks, loadPick, sendApk, apkCommand, apksearchCommand, apkdlCommand, PICK_TTL };
