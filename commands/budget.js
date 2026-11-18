'use strict';
const { UserError, bold, tzParts } = require('../lib/util');

module.exports = ({ def }) => {
  const monthKey = ctx => tzParts(ctx.tz()).iso.slice(0, 7);
  const load = ctx => ctx.get('budget', { tx: [], limits: {} });
  const money = (ctx, n) => `${ctx.var('CURRENCY')} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const parseAmt = s => { const n = Number(String(s || '').replace(/[, ]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
  const bar = (used, limit) => { const p = Math.min(1, used / limit); const n = Math.round(p * 10); return '▰'.repeat(n) + '▱'.repeat(10 - n) + ` ${Math.round(used / limit * 100)}%`; };
  const spentIn = (ctx, b, cat) => b.tx.filter(t => t.type === 'expense' && t.m === monthKey(ctx) && (cat ? t.cat === cat : true)).reduce((a, t) => a + t.amt, 0);

  def('income', { cat: 'budget', owner: true, usage: 'income <amount> [source]', desc: 'Record money you received.' }, async ctx => {
    const amt = parseAmt(ctx.argv[0]);
    if (!amt) throw new UserError(`Usage: *${ctx.var('PREFIX')}income 50000 salary*`);
    const note = ctx.args.slice(ctx.argv[0].length).trim() || 'income';
    ctx.update('budget', { tx: [], limits: {} }, b => { b.tx.push({ id: Date.now(), type: 'income', amt, cat: note.toLowerCase(), note, m: monthKey(ctx), at: Date.now() }); });
    await ctx.reply(`💰 Income recorded: ${bold(money(ctx, amt))} — ${note}`);
  });

  def('expense', { cat: 'budget', owner: true, usage: 'expense <amount> <category> [note]', desc: 'Record money you spent. Warns you when a category budget is passed.' }, async ctx => {
    const amt = parseAmt(ctx.argv[0]);
    if (!amt || !ctx.argv[1]) throw new UserError(`Usage: *${ctx.var('PREFIX')}expense 250 food lunch*`);
    const cat = ctx.argv[1].toLowerCase();
    const note = ctx.argv.slice(2).join(' ');
    ctx.update('budget', { tx: [], limits: {} }, b => { b.tx.push({ id: Date.now(), type: 'expense', amt, cat, note, m: monthKey(ctx), at: Date.now() }); });
    const b = load(ctx);
    let warn = '';
    const lim = b.limits[cat], total = b.limits['*'];
    if (lim && spentIn(ctx, b, cat) > lim) warn += `\n⚠️ Over your *${cat}* budget (${money(ctx, spentIn(ctx, b, cat))} / ${money(ctx, lim)})`;
    if (total && spentIn(ctx, b) > total) warn += `\n⚠️ Over your monthly budget (${money(ctx, spentIn(ctx, b))} / ${money(ctx, total)})`;
    await ctx.reply(`🧾 Expense recorded: ${bold(money(ctx, amt))} — ${cat}${note ? ' (' + note + ')' : ''}${warn}`);
  });

  def('budget', { cat: 'budget', owner: true, usage: 'budget <category> <limit> • budget <monthly limit> • budget', desc: 'Set a monthly spending limit (per category, or overall), or view your budgets.' }, async ctx => {
    const b = load(ctx);
    if (!ctx.args) {
      const rows = Object.entries(b.limits);
      if (!rows.length) return ctx.reply(`No budgets yet.\nTry *${ctx.var('PREFIX')}budget food 8000* or *${ctx.var('PREFIX')}budget 60000* (overall).`);
      return ctx.reply(rows.map(([c, l]) => { const used = spentIn(ctx, b, c === '*' ? null : c); return `${bold(c === '*' ? 'overall' : c)}: ${money(ctx, used)} / ${money(ctx, l)}\n${bar(used, l)}`; }).join('\n\n'), { title: 'Budgets this month' });
    }
    let cat = '*', amt = parseAmt(ctx.argv[0]);
    if (!amt) { cat = ctx.argv[0].toLowerCase(); amt = parseAmt(ctx.argv[1]); }
    if (!amt) throw new UserError('Example: *budget food 8000* or *budget 60000*');
    ctx.update('budget', { tx: [], limits: {} }, x => { x.limits[cat] = amt; });
    await ctx.reply(`🎯 Budget set: ${bold(cat === '*' ? 'overall' : cat)} → ${money(ctx, amt)} per month`);
  });

  def('delbudget', { cat: 'budget', owner: true, usage: 'delbudget <category> | all', desc: 'Remove a budget limit.' }, async ctx => {
    const a = (ctx.argv[0] || '').toLowerCase();
    if (!a) throw new UserError('Which budget? Give the category, *overall*, or *all*.');
    const key = a === 'overall' ? '*' : a;
    const b = load(ctx);
    if (a !== 'all' && !(key in b.limits)) throw new UserError('No budget with that name.');
    ctx.update('budget', { tx: [], limits: {} }, x => { if (a === 'all') x.limits = {}; else delete x.limits[key]; });
    await ctx.reply('🗑️ Budget removed.');
  });

  def('summary', { cat: 'budget', owner: true, usage: 'summary [last]', desc: 'Your income, spending and balance for this month (or "last" month).' }, async ctx => {
    const b = load(ctx);
    let m = monthKey(ctx);
    if (/^last$/i.test(ctx.argv[0] || '')) { const [y, mo] = m.split('-').map(Number); m = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; }
    const tx = b.tx.filter(t => t.m === m);
    if (!tx.length) return ctx.reply(`No records for ${m}.`);
    const inc = tx.filter(t => t.type === 'income').reduce((a, t) => a + t.amt, 0);
    const exp = tx.filter(t => t.type === 'expense').reduce((a, t) => a + t.amt, 0);
    const byCat = {};
    for (const t of tx.filter(t => t.type === 'expense')) byCat[t.cat] = (byCat[t.cat] || 0) + t.amt;
    const cats = Object.entries(byCat).sort((a, b2) => b2[1] - a[1]).map(([c, v]) => {
      const lim = b.limits[c];
      return `• ${c}: ${money(ctx, v)}${lim ? `  ${bar(v, lim)}` : ''}`;
    });
    const recent = tx.slice(-5).reverse().map(t => `${t.type === 'income' ? '➕' : '➖'} ${money(ctx, t.amt)} ${t.cat}`);
    await ctx.reply([
      `📆 ${bold(m)}`, `💰 ${bold('Income')}: ${money(ctx, inc)}`, `🧾 ${bold('Spent')}: ${money(ctx, exp)}`, `⚖️ ${bold('Balance')}: ${money(ctx, inc - exp)}`,
      b.limits['*'] ? `🎯 ${bold('Monthly budget')}: ${bar(exp, b.limits['*'])}` : null,
      '', cats.length ? `${bold('By category')}\n${cats.join('\n')}` : null, '', `${bold('Latest')}\n${recent.join('\n')}`
    ].filter(x => x !== null).join('\n'), { title: 'Budget summary' });
  });
};
