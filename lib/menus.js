'use strict';
/**
 * The on/off control panel (.menu toggles) with tappable buttons. Buttons carry "cmd:<command line>" ids, so anyone in the chat can tap them and the tap runs as
 * that person (see lib/interactive.js sendButtons and the tap handler in lib/bot.js).
 */
const { sendButtons } = require('./interactive');

const guardOn = name => c => ((c.get(`${name}:${c.chat}`, {}) || {}).mode || 'off') !== 'off';
/** Everything that is an on/off switch. scope 'owner' = bot-wide (owner only); 'group' = this group (admins). */
const TOGGLES = [
  { name: 'autoreadmessages', label: 'Auto Read', scope: 'owner', get: c => !!c.get('autoread', false) },
  { name: 'autoreact', label: 'Auto React', scope: 'owner', get: c => !!c.get('autoreact', null) },
  { name: 'autoviewstatus', label: 'Auto View Status', scope: 'owner', get: c => !!c.get('autoviewstatus', false) },
  { name: 'autoreactstatus', label: 'Auto React Status', scope: 'owner', get: c => !!c.get('autoreactstatus', null) },
  { name: 'autotyping', label: 'Auto Typing', scope: 'owner', get: c => !!c.get('autotyping', false) },
  { name: 'autorecording', label: 'Auto Recording', scope: 'owner', get: c => !!c.get('autorecording', false) },
  { name: 'autobio', label: 'Auto Bio', scope: 'owner', get: c => !!c.get('autobio', false) },
  { name: 'antidelete', label: 'Anti Delete', scope: 'owner', get: c => !!c.get('antidelete', false) },
  { name: 'antiedit', label: 'Anti Edit', scope: 'owner', get: c => !!c.get('antiedit', false) },
  { name: 'antiviewonce', label: 'Anti View-Once', scope: 'owner', get: c => !!c.get('vv2', false) },
  { name: 'call', label: 'Anti Call', scope: 'owner', get: c => !!(c.get('anticall', {}) || {}).on },
  { name: 'forwardmode', label: 'Forward Mode', scope: 'owner', get: c => c.var('CHANNEL_FORWARD') !== 'off' },
  { name: 'antilink', label: 'Anti Link', scope: 'group', get: guardOn('antilink') },
  { name: 'antiword', label: 'Anti Word', scope: 'group', get: guardOn('antiword') },
  { name: 'antispam', label: 'Anti Spam', scope: 'group', get: guardOn('antispam') },
  { name: 'antigm', label: 'Anti Group-Mention', scope: 'group', get: guardOn('antigm') },
  { name: 'antigstatus', label: 'Anti Group Status', scope: 'group', get: guardOn('antigstatus') },
  { name: 'antimedia', label: 'Anti Media', scope: 'group', get: guardOn('antimedia') },
  { name: 'antisticker', label: 'Anti Sticker', scope: 'group', get: guardOn('antisticker') },
  { name: 'antibot', label: 'Anti Bot', scope: 'group', get: guardOn('antibot') },
  { name: 'antifake', label: 'Anti Fake', scope: 'group', get: guardOn('antifake') },
  { name: 'pdm', label: 'Promote/Demote Notices', scope: 'group', get: c => !!c.get('pdm:' + c.chat, false) }
];
const PER_PAGE = 3; // 3 toggles + 1 navigation button = 4 buttons, which WhatsApp renders reliably

const visibleToggles = ctx => TOGGLES.filter(t => t.scope === 'owner' || ctx.isGroup);
const isOn = (ctx, t) => { try { return Boolean(t.get(ctx)); } catch { return false; } };
const findToggle = name => TOGGLES.find(t => t.name === String(name || '').toLowerCase());

async function sendToggles(ctx, page = 1) {
  const list = visibleToggles(ctx);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  page = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const slice = list.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const lines = slice.map(t => `${isOn(ctx, t) ? '✅ ON ' : '❌ OFF'} — ${t.label}${t.scope === 'group' ? ' _(this group)_' : ''}`);
  await sendButtons(ctx, {
    title: `On/Off Controls ${page}/${pages}`,
    body: `${lines.join('\n')}\n\n👆 Tap a button to switch it. Bot-wide switches are for the owner; group switches are for group admins.`,
    buttons: [
      ...slice.map(t => ({ label: `${isOn(ctx, t) ? '✅' : '❌'} ${t.label}`, cmd: `toggle ${t.name} ${page}` })),
      page < pages ? { label: '➡️ More', cmd: `menu toggles ${page + 1}` } : { label: '📋 Menu', cmd: 'menu' }
    ]
  });
}

module.exports = { TOGGLES, PER_PAGE, visibleToggles, findToggle, isOn, sendToggles };
