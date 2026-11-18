'use strict';
const { UserError, escRe, bold } = require('../lib/util');

module.exports = ({ def, hooks }) => {
  // storage: filters = { chat: { <jid>: {kw: reply} }, group: {kw: reply}, pm: {kw: reply} }
  const load = ctx => ctx.get('filters', { chat: {}, group: {}, pm: {} });
  const bucket = (f, scope, chat) => (scope === 'chat' ? (f.chat[chat] ||= {}) : f[scope]);
  const parse = a => {
    const i = a.indexOf(':');
    if (i < 1) return null;
    const kw = a.slice(0, i).trim().toLowerCase(), rp = a.slice(i + 1).trim();
    return kw && rp ? { kw, rp } : null;
  };

  const SCOPES = {
    filter: ['chat', 'this chat'], gfilter: ['group', 'all groups'], pfilter: ['pm', 'all private chats']
  };
  for (const [name, [scope, where]] of Object.entries(SCOPES)) {
    def(name, { cat: 'autoreply', owner: true, usage: `${name} keyword: reply text`, desc: `Auto-reply to a word in ${where}. Without arguments it lists them.` }, async ctx => {
      const f = load(ctx);
      if (!ctx.args) {
        const b = bucket(f, scope, ctx.chat);
        const rows = Object.entries(b);
        return ctx.reply(rows.length ? rows.map(([k, v]) => `• ${bold(k)} → ${v}`).join('\n') : `No filters for ${where}.\nAdd one: *${ctx.var('PREFIX')}${name} hello: Hi there!*`, { title: `Filters (${where})` });
      }
      const p = parse(ctx.args);
      if (!p) throw new UserError(`Format: *${ctx.var('PREFIX')}${name} keyword: reply text*`);
      bucket(f, scope, ctx.chat)[p.kw] = p.rp;
      ctx.set('filters', f);
      await ctx.reply(`✅ Filter saved for ${where}: *${p.kw}*`);
    });
  }
  const STOPS = { stop: 'chat', gstop: 'group', pstop: 'pm' };
  for (const [name, scope] of Object.entries(STOPS)) {
    def(name, { cat: 'autoreply', owner: true, usage: `${name} <keyword> | ${name} all`, desc: `Remove ${scope === 'chat' ? 'a filter from this chat' : scope === 'group' ? 'a group filter' : 'a private-chat filter'}.` }, async ctx => {
      const f = load(ctx);
      const b = bucket(f, scope, ctx.chat);
      const a = ctx.args.trim().toLowerCase();
      if (!a) throw new UserError('Which keyword? Use *all* to remove every filter in this scope.');
      if (a === 'all') { for (const k of Object.keys(b)) delete b[k]; }
      else if (b[a] !== undefined) delete b[a];
      else throw new UserError('No filter with that keyword.');
      ctx.set('filters', f);
      await ctx.reply(a === 'all' ? '🧹 All filters removed.' : `🗑️ Filter *${a}* removed.`);
    });
  }

  hooks.push({
    name: 'autoreply', run: async ctx => {
      if (ctx.fromMe || !ctx.fresh || !ctx.text || ctx.text.startsWith(ctx.prefix || '.') || ctx.chat === 'status@broadcast') return false;
      const f = ctx.get('filters', null);
      if (!f) return false;
      const sets = [f.chat?.[ctx.chat], ctx.isGroup ? f.group : f.pm].filter(Boolean);
      const low = ctx.text.toLowerCase();
      for (const b of sets) {
        for (const [kw, rp] of Object.entries(b)) {
          if (new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(kw)}($|[^\\p{L}\\p{N}])`, 'iu').test(low)) {
            if (!ctx.cooldown(5, 'filter:' + kw)) return false;
            await ctx.send({ text: rp.replace(/\{name\}/gi, ctx.name || '') }, { quoted: ctx.msg });
            return false;
          }
        }
      }
      return false;
    }
  });
};
