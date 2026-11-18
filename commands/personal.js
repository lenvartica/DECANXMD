'use strict';
const { UserError } = require('../lib/util');

module.exports = ({ def, hooks }) => {
  def('setgreet', { cat: 'personal', owner: true, usage: 'setgreet <text>', desc: 'Set an automatic greeting sent to people who message you privately (once a day each). Use {name} for their name.' }, async ctx => {
    if (!ctx.args) throw new UserError('Write the greeting, e.g. *setgreet Hi {name}! I will reply soon.*');
    ctx.set('greet', ctx.args);
    await ctx.reply('✅ Greeting saved.');
  });
  def('getgreet', { cat: 'personal', owner: true, desc: 'Show the current private-chat greeting.' }, async ctx => {
    const g = ctx.get('greet', null);
    await ctx.reply(g ? g : 'No greeting set.', { title: 'Greeting' });
  });
  def('delgreet', { cat: 'personal', owner: true, desc: 'Remove the private-chat greeting.' }, async ctx => {
    if (!ctx.get('greet', null)) throw new UserError('No greeting is set.');
    ctx.del('greet');
    await ctx.reply('🗑️ Greeting removed.');
  });
  hooks.push({
    name: 'greet', run: async ctx => {
      if (ctx.isGroup || ctx.fromMe || !ctx.fresh || ctx.chat === 'status@broadcast' || !ctx.content || ctx.type === 'protocolMessage' || ctx.type === 'reactionMessage') return false;
      if (ctx.text.startsWith(ctx.prefix || '.')) return false;
      const g = ctx.get('greet', null);
      if (!g) return false;
      const last = ctx.rt.greetSeen.get(ctx.chat) || 0;
      if (Date.now() - last < 24 * 3600 * 1000) return false;
      ctx.rt.greetSeen.set(ctx.chat, Date.now());
      await ctx.send({ text: g.replace(/\{name\}/gi, ctx.name || 'there') }, { quoted: ctx.msg });
      return false;
    }
  });
};
