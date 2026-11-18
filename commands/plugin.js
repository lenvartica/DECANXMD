'use strict';
const { UserError, bold } = require('../lib/util');

module.exports = ({ def }) => {
  const idx = () => require('./index');

  def('plugin', { cat: 'plugin', owner: true, core: true, usage: 'plugin [category | command]', desc: 'List command categories, or the commands in one. Categories can be switched off with "remove".' }, async ctx => {
    const { categories, registry } = idx();
    const offCats = ctx.get('disabledCats', []);
    const a = ctx.argv[0]?.toLowerCase();
    if (!a) {
      return ctx.reply([...categories.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([c, list]) => `${offCats.includes(c) ? '⛔' : '✅'} ${bold(c)} — ${list.length} command(s)`).join('\n') +
        `\n\nSee one: *${ctx.var('PREFIX')}plugin <category>*\nSwitch off: *${ctx.var('PREFIX')}remove <category>*\nSwitch on: *${ctx.var('PREFIX')}remove <category> on*`, { title: 'Plugins' });
    }
    if (categories.has(a)) return ctx.reply(categories.get(a).map(d => `• ${bold(d.name)} — ${d.desc || ''}`).join('\n'), { title: `${a} plugin` });
    const d = registry.get(a);
    if (d) return ctx.reply(`${bold(d.name)} belongs to the *${d.cat}* plugin.\n${d.desc || ''}`);
    throw new UserError('No such plugin or command.');
  });

  def('remove', { cat: 'plugin', owner: true, core: true, usage: 'remove <category> [on]', desc: 'Switch a whole command category off (or back on with "on").' }, async ctx => {
    const { categories } = idx();
    const a = ctx.argv[0]?.toLowerCase();
    if (!a || !categories.has(a)) throw new UserError(`Pick a category: ${[...categories.keys()].join(', ')}`);
    if (['plugin', 'vars'].includes(a)) throw new UserError('That category is needed to manage the bot and cannot be switched off.');
    const on = /^on$/i.test(ctx.argv[1] || '');
    ctx.update('disabledCats', [], l => { const i = l.indexOf(a); if (on && i >= 0) l.splice(i, 1); if (!on && i < 0) l.push(a); });
    await ctx.reply(on ? `✅ *${a}* commands are back on.` : `⛔ *${a}* commands are switched off. Bring them back with *${ctx.var('PREFIX')}remove ${a} on*`);
  });
};
