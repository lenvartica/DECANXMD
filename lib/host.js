'use strict';
/**
 * Server-level permission. The bot can host many paired WhatsApp numbers on one server, so commands that affect the
 * whole server (restart, logs, sessions, database, environment) must not be open to every session owner.
 *   - If HOST_ADMINS is set (comma-separated phone numbers), only those numbers qualify.
 *   - If it is not set, the session owner qualifies only while this server hosts a single live session.
 */
const { UserError } = require('./util');

function isHost(ctx) {
  if (ctx.fromMe) return true;
  const admins = String(process.env.HOST_ADMINS || '').split(/[\s,]+/).map(x => x.replace(/\D/g, '')).filter(Boolean);
  if (admins.length) return [ctx.senderNum, ...(ctx.senderIds || [])].some(id => admins.includes(id));
  return Boolean(ctx.isOwner);
}
function requireHost(ctx) {
  if (!isHost(ctx)) throw new UserError('🔧 This is a server-level command. It works for the server operator only (set HOST_ADMINS on the server to choose who).');
}
module.exports = { isHost, requireHost };
