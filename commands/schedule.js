'use strict';
const U = require('../lib/util');
const { UserError, bold } = U;

module.exports = ({ def, tickers }) => {
  // schedules: [{ id, chat, text, time:'HH:MM', daily, at }]
  def('setschedule', { cat: 'schedule', owner: true, usage: 'setschedule [daily] HH:MM <message>', desc: 'Send a message in this chat at a set time (once, or every day with "daily"). Uses the bot timezone.' }, async ctx => {
    const m = ctx.args.match(/^(daily\s+)?(\d{1,2}):(\d{2})\s+([\s\S]+)$/i);
    if (!m || +m[2] > 23 || +m[3] > 59) throw new UserError(`Usage: *${ctx.var('PREFIX')}setschedule 18:30 Meeting starts!* or *${ctx.var('PREFIX')}setschedule daily 07:00 Good morning!*`);
    const hh = +m[2], mm = +m[3];
    const item = { id: Date.now().toString(36), chat: ctx.chat, text: m[4].trim(), time: `${String(hh).padStart(2, '0')}:${m[3]}`, daily: Boolean(m[1]), at: U.nextClock(ctx.tz(), hh, mm) };
    ctx.update('schedules', [], l => { l.push(item); });
    await ctx.reply(`📅 Scheduled ${item.daily ? 'every day' : 'once'} at *${item.time}* (${ctx.tz()}):\n${item.text}`);
  });
  def('getschedule', { cat: 'schedule', owner: true, desc: 'List scheduled messages for this chat.' }, async ctx => {
    const l = ctx.get('schedules', []).filter(s => s.chat === ctx.chat);
    await ctx.reply(l.length ? l.map((s, i) => `${i + 1}. ${bold(s.time)} ${s.daily ? '(daily)' : '(once)'} — ${s.text.slice(0, 80)}`).join('\n') : 'No scheduled messages in this chat.', { title: 'Schedules' });
  });
  def('delschedule', { cat: 'schedule', owner: true, usage: 'delschedule <number> | all', desc: 'Delete a scheduled message of this chat.' }, async ctx => {
    const mine = ctx.get('schedules', []).filter(s => s.chat === ctx.chat);
    const a = ctx.argv[0]?.toLowerCase();
    if (!a) throw new UserError('Which one? Use *getschedule* to see numbers, or *delschedule all*.');
    const drop = a === 'all' ? mine : [mine[Number(a) - 1]].filter(Boolean);
    if (!drop.length) throw new UserError('No schedule with that number.');
    const ids = new Set(drop.map(s => s.id));
    ctx.update('schedules', [], l => { for (let i = l.length - 1; i >= 0; i--) if (ids.has(l[i].id)) l.splice(i, 1); });
    await ctx.reply(`🗑️ Deleted ${drop.length} schedule(s).`);
  });

  tickers.push({
    name: 'schedules', run: async api => {
      const list = api.get('schedules', []);
      const due = list.filter(s => Date.now() >= s.at);
      if (!due.length) return;
      for (const s of due) {
        try { await api.sendTo(s.chat, { text: s.text }); } catch (e) { api.logger.warn({ error: e.message }, 'Scheduled send failed'); }
      }
      api.update('schedules', [], l => {
        for (let i = l.length - 1; i >= 0; i--) {
          const s = l[i];
          if (Date.now() < s.at) continue;
          if (s.daily) { const [h, m] = s.time.split(':').map(Number); s.at = U.nextClock(api.tz(), h, m); } else l.splice(i, 1);
        }
      });
    }
  });
};
