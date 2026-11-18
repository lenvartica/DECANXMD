'use strict';
/**
 * Per-command access overrides (v1.2.0) — the owner decides who may run a command with  .access <command> everyone|admin|owner
 *
 * An override only replaces the command's built-in owner/admin gate; "group only" and "bot must be admin" are
 * technical requirements and always still apply. Some commands can never be opened to other people because they run
 * code on the host, change the bot's login/credentials/settings, drive the owner's own WhatsApp account, or are
 * destructive moderation. Those stay owner-only no matter what is saved (see canOpen()).
 */
const LEVELS = ['everyone', 'admin', 'owner'];

// Categories whose owner-only commands act on the host, on the bot's own settings, or on the owner's own WhatsApp account.
const LOCKED_CATS = new Set(['bot', 'vars', 'developer', 'plugin', 'user', 'whatsapp', 'stats']);
// Individually locked names (destructive moderation, code execution, credentials) regardless of category.
const LOCKED_NAMES = new Set([
  'exec', 'shell', 'execute', 'eval', 'run', 'terminal', 'fetch',
  'kick', 'kickall', 'promote', 'demote', 'removeadmins', 'revoke', 'rejectall', 'acceptall', 'add', 'join', 'leave', 'leavegroup',
  'ban', 'unban', 'allow', 'deny', 'setsudo', 'delsudo', 'addsudo', 'delcmd', 'setcmd', 'access', 'alias', 'unalias',
  'broadcast', 'broadcastgroup', 'forward', 'mforward', 'reply', 'edit', 'save', 'logout', 'restart', 'update'
]);

const norm = n => String(n || '').toLowerCase().replace(/^[^a-z0-9]+/, '');

/** Can this command's gate be opened up to other people? (Restricting a command to the owner is always allowed except for core commands.) */
function canOpen(d) {
  if (!d) return false;
  if (d.core) return false;
  if (LOCKED_NAMES.has(d.name) || d.names?.some(n => LOCKED_NAMES.has(n))) return false;
  if (d.owner && LOCKED_CATS.has(d.cat)) return false;
  return true;
}
const canRestrict = d => Boolean(d) && !d.core;

/** The saved override for a command, or null. A saved override that is no longer allowed (e.g. after an upgrade) is ignored. */
function levelFor(saved, d) {
  const lvl = saved?.[d.name];
  if (!LEVELS.includes(lvl)) return null;
  if (lvl === 'owner') return canRestrict(d) ? 'owner' : null;
  return canOpen(d) ? lvl : null;
}

/**
 * Resolve the gates for one command run.
 * Returns { deny: string|null, needOwner, needAdmin } — deny is a ready-to-send message when the override itself blocks the caller.
 */
function resolve(d, saved, isOwner) {
  const lvl = levelFor(saved, d);
  if (!lvl) return { deny: null, needOwner: Boolean(d.owner), needAdmin: Boolean(d.admin), level: null };
  if (lvl === 'owner') return { deny: isOwner ? null : '🔒 The bot owner has restricted this command to themselves.', needOwner: false, needAdmin: false, level: lvl };
  if (lvl === 'admin') return { deny: null, needOwner: false, needAdmin: true, level: lvl };
  return { deny: null, needOwner: false, needAdmin: false, level: lvl };
}

module.exports = { LEVELS, LOCKED_CATS, LOCKED_NAMES, norm, canOpen, canRestrict, levelFor, resolve };
