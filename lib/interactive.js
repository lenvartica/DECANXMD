'use strict';
/**
 * Genuine WhatsApp interactive menus, built on the native-flow interactive message (the same
 * mechanism WhatsApp's own multi-device clients use for list/single-select menus today). This is
 * NOT the old templateButtons/buttonsMessage/listMessage system — this project already treats
 * those as unreliable (see decorateOutgoing in lib/bot.js: URL buttons are opt-in because current
 * WhatsApp clients drop or reject them). The actual send happens via ctx.sendInteractive(), defined
 * in lib/bot.js, because building a native-flow message requires Baileys' generateWAMessageFromContent
 * + proto + sock.relayMessage directly — there's no sock.sendMessage() content shorthand for it.
 *
 * A tap on a native-flow row/button comes back as `interactiveResponseMessage.nativeFlowResponseMessage
 * .paramsJson`, a JSON string containing the row's `id` — NOT as the legacy buttonsResponseMessage or
 * listResponseMessage types. lib/bot.js's textOf() understands all of these, so a hook can read the
 * selection from ctx.text the same way regardless of which path WhatsApp actually used.
 *
 * If the installed Baileys build/session can't send that content shape (ctx.sendInteractive throws),
 * sendMenu() falls back to a plain numbered-reply message: "1. Play Audio / 2. Send as Document / ...".
 * The caller gets back which path was actually used ('interactive' | 'fallback') so it can bind the
 * right matcher (a native-flow row id vs. a bare number) to the pending selection.
 */

const MAX_ROWS = 10; // WhatsApp's own single_select list limit

/**
 * @param {object} ctx - command context (needs ctx.send / ctx.reply)
 * @param {object} opts
 * @param {string} opts.body - message body shown above the menu
 * @param {string} [opts.title] - list section title
 * @param {string} [opts.buttonText] - text on the "open menu" button
 * @param {{id:string, title:string, description?:string}[]} opts.rows - selectable rows, in order
 * @returns {Promise<'interactive'|'fallback'>}
 */
async function sendMenu(ctx, { body, title, buttonText, rows }) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('sendMenu needs at least one row.');
  if (rows.length > MAX_ROWS) throw new Error(`sendMenu supports at most ${MAX_ROWS} rows.`);

  const numbered = rows.map((r, i) => `*${i + 1}.* ${r.title}${r.description ? ` — _${r.description}_` : ''}`).join('\n');
  const fullBody = `${body}\n\n${numbered}\n\n💡 _Tap an option below or reply with its number (1-${rows.length})_`;

  const buttons = rows.map(r => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: String(r.title).slice(0, 24),
      id: r.id
    })
  }));

  if (String(ctx.var?.('BUTTON_MENUS') ?? 'on').toLowerCase() === 'off') return sendFallback(ctx, { body, rows });

  if (typeof ctx.sendInteractive !== 'function') {
    ctx.logger?.warn?.({ command: 'music', event: 'interactive_unavailable' }, 'ctx.sendInteractive is missing — falling back to a numbered menu.');
    return sendFallback(ctx, { body, rows });
  }

  try {
    const sent = await ctx.sendInteractive({ body: fullBody, title, buttons });
    if (!sent?.key?.id) throw new Error('Interactive menu was not accepted by this session.');
    ctx.logger?.info?.({ command: 'music', event: 'interactive_sent', sessionId: ctx.sid }, 'Native-flow interactive menu sent.');
    return 'interactive';
  } catch (e) {
    ctx.logger?.warn?.({ command: 'music', event: 'interactive_fallback', sessionId: ctx.sid, error: e?.message }, 'Native-flow menu failed — falling back to a numbered menu.');
    return sendFallback(ctx, { body, rows });
  }
}

async function sendFallback(ctx, { body, rows }) {
  const numbered = rows.map((r, i) => `*${i + 1}.* ${r.title}${r.description ? ` — ${r.description}` : ''}`).join('\n');
  await ctx.reply(`${body}\n\n${numbered}\n\nReply with the number of your choice.`);
  return 'fallback';
}

/**
 * Quick-action buttons: each button runs a bot command when TAPPED BY ANYONE in the chat. The button id is
 * "cmd:<command line>"; lib/bot.js turns a tap on such an id into that command, run as the person who tapped
 * (so owner/admin-only commands still refuse everybody else with the normal message).
 * Falls back to a plain message listing the commands when buttons are off or cannot be sent.
 * @param {{label:string, cmd:string}[]} opts.buttons - at most 4 shown (what WhatsApp renders reliably)
 */
async function sendButtons(ctx, { body, title, buttons }) {
  const list = (buttons || []).slice(0, 4);
  const p = ctx.prefix || '.';
  const fallback = () => ctx.reply(`${body}\n\n${list.map(b => `▫️ *${p}${b.cmd.split(' ')[0]}*${b.cmd.includes(' ') ? ' ' + b.cmd.split(' ').slice(1).join(' ') : ''} — ${b.label}`).join('\n')}`, { title });
  if (!list.length || String(ctx.var?.('BUTTON_MENUS') ?? 'on').toLowerCase() === 'off' || typeof ctx.sendInteractive !== 'function') { await fallback(); return 'fallback'; }
  try {
    const sent = await ctx.sendInteractive({
      body: ctx.frame ? ctx.frame(body, title) : body,
      buttons: list.map(b => ({ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: String(b.label).slice(0, 24), id: 'cmd:' + b.cmd }) }))
    });
    if (!sent?.key?.id) throw new Error('Buttons were not accepted by this session.');
    return 'interactive';
  } catch (e) {
    ctx.logger?.warn?.({ event: 'buttons_fallback', error: e?.message }, 'Button message failed — sent plain text instead.');
    await fallback();
    return 'fallback';
  }
}

module.exports = { sendMenu, sendButtons, MAX_ROWS };
