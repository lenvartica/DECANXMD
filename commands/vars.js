'use strict';
const { UserError, bold } = require('../lib/util');

const VALIDATORS = {
  PREFIX: v => (/^[^\sA-Za-z0-9]{1,3}$/.test(v) ? null : 'PREFIX must be 1-3 symbol characters, e.g. . or ! or #'),
  MODE: v => (['public', 'private'].includes(v) ? null : 'MODE must be public or private'),
  MENU_FONT: v => (require('../lib/fonts').find(v) ? null : 'Unknown font. Send .menufont list to see the choices.'),
  COOLDOWN: v => (/^\d+(\.\d+)?$/.test(v) && +v <= 60 ? null : 'COOLDOWN is seconds between commands per person, 0 to 60 (0 = no limit)'),
  BUTTON_MENUS: v => (['on', 'off'].includes(v) ? null : 'BUTTON_MENUS must be on or off'),
  WARN_LIMIT: v => (/^\d+$/.test(v) && +v >= 1 && +v <= 20 ? null : 'WARN_LIMIT must be a number from 1 to 20'),
  TIMEZONE: v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return null; } catch { return 'Unknown timezone. Use a name like Africa/Nairobi'; } }
};
const KNOWN = 'PREFIX, MODE (public/private), ALIVE_MESSAGE, STICKER_PACK, STICKER_AUTHOR, WARN_LIMIT, TIMEZONE, CURRENCY, COOLDOWN (seconds, 0 = none), BUTTON_MENUS (on/off)';

module.exports = ({ def }) => {
  def('setvar', { cat: 'vars', owner: true, core: true, usage: 'setvar KEY:value', desc: `Change a bot setting. Known keys: ${KNOWN}.` }, async ctx => {
    const m = ctx.args.match(/^([A-Za-z0-9_]{2,32})\s*[:=\s]\s*([\s\S]+)$/);
    if (!m) throw new UserError(`Usage: *${ctx.var('PREFIX')}setvar KEY:value*\nKnown keys: ${KNOWN}`);
    const key = m[1].toUpperCase(), val = m[2].trim();
    const bad = VALIDATORS[key]?.(val);
    if (bad) throw new UserError(bad);
    ctx.update('vars', {}, v => { v[key] = val; });
    await ctx.reply(`✅ ${bold(key)} = ${val}${key === 'PREFIX' ? `\n\nNew prefix is *${val}* — try *${val}menu*` : ''}`);
  });
  def('mode', { cat: 'vars', owner: true, core: true, usage: 'mode public | mode private', desc: 'Switch the bot between public (everyone can use it) and private (only you and sudo users).' }, async ctx => {
    const a = (ctx.argv[0] || '').toLowerCase();
    const cur = ctx.var('MODE');
    if (!a) return ctx.reply(`⚙️ Current mode: *${cur.toUpperCase()}*\n\n• *public* — everyone can use my commands\n• *private* — only you and sudo users can use commands; everyone else (group admins too) is ignored\n\nChange it: *${ctx.var('PREFIX')}mode private* or *${ctx.var('PREFIX')}mode public*`, { title: 'Mode' });
    if (!['public', 'private'].includes(a)) throw new UserError('Use *mode public* or *mode private*.');
    ctx.update('vars', {}, v => { v.MODE = a; });
    await ctx.reply(a === 'private' ? '🔒 Mode is now *PRIVATE*. Only you and sudo users can use commands; I ignore everyone else, including group admins.' : '🌍 Mode is now *PUBLIC*. Everyone can use my commands.', { title: 'Mode' });
  });
  def('getvar', { cat: 'vars', owner: true, core: true, usage: 'getvar KEY', desc: 'Show one setting.' }, async ctx => {
    const k = (ctx.argv[0] || '').toUpperCase();
    if (!k) throw new UserError('Which setting? e.g. *getvar PREFIX*');
    const v = ctx.var(k, null);
    await ctx.reply(v === null || v === '' ? `${k} is not set.` : `${bold(k)} = ${v}`);
  });
  def('delvar', { cat: 'vars', owner: true, core: true, usage: 'delvar KEY', desc: 'Reset a setting to its default.' }, async ctx => {
    const k = (ctx.argv[0] || '').toUpperCase();
    if (!k || !(k in ctx.get('vars', {}))) throw new UserError('That setting has not been changed.');
    ctx.update('vars', {}, v => { delete v[k]; });
    await ctx.reply(`♻️ ${k} reset to default.`);
  });
  def('allvar', { cat: 'vars', owner: true, core: true, desc: 'Show all settings.' }, async ctx => {
    const set = ctx.get('vars', {});
    const keys = [...new Set(['PREFIX', 'MODE', 'ALIVE_MESSAGE', 'STICKER_PACK', 'STICKER_AUTHOR', 'WARN_LIMIT', 'TIMEZONE', 'CURRENCY', ...Object.keys(set)])];
    await ctx.reply(keys.map(k => `${bold(k)}: ${ctx.var(k, '') || '—'}${k in set ? '' : ' _(default)_'}`).join('\n'), { title: 'Settings' });
  });

  async function sudoIds(ctx) {
    const raw = ctx.targets();
    if (!raw.length) throw new UserError('Mention the person, reply to them, or give their number.');
    const ids = new Set();
    let meta = null;
    if (ctx.isGroup) meta = await ctx.group().catch(() => null);
    for (const j of raw) {
      ids.add(ctx.jidUser(j));
      const p = meta && ctx.participantByJid(meta, j);
      if (p) ctx.pids(p).forEach(i => ids.add(i));
    }
    return [...ids];
  }
  def('setsudo', { cat: 'vars', owner: true, core: true, usage: 'setsudo @user | reply | number', desc: 'Give someone owner-level access to the bot.' }, async ctx => {
    const ids = await sudoIds(ctx);
    ctx.update('sudo', [], s => { for (const i of ids) if (!s.includes(i)) s.push(i); });
    await ctx.reply(`✅ Added ${ids.filter(i => /^\d{7,15}$/.test(i)).map(i => '+' + i).join(', ') || 'user'} as sudo.`);
  });
  def('delsudo', { cat: 'vars', owner: true, core: true, usage: 'delsudo @user | reply | number', desc: 'Remove someone\'s sudo access.' }, async ctx => {
    const ids = await sudoIds(ctx);
    ctx.update('sudo', [], s => { for (const i of ids) { const k = s.indexOf(i); if (k >= 0) s.splice(k, 1); } });
    await ctx.reply('✅ Sudo access removed.');
  });
  def('getsudo', { cat: 'vars', owner: true, core: true, desc: 'List sudo users.' }, async ctx => {
    const s = ctx.sudo();
    await ctx.reply(s.length ? s.map(i => '• ' + (/^\d{7,15}$/.test(i) ? '+' + i : i)).join('\n') : 'No sudo users.', { title: 'Sudo users' });
  });
};
