'use strict';
/**
 * "Bad MAC" / "failed to decrypt message" means the end-to-end encryption session with ONE contact is out of sync,
 * so every message from that person is dropped before the bot ever sees it (their commands "do nothing").
 * Typical causes: the same WhatsApp session running in two places at once (e.g. a hosted copy and a local copy),
 * a restored/copied session folder, or an interrupted write.
 *
 * This module:
 *  1. watches Baileys' "failed to decrypt message" log lines and, when the same contact fails several times in a
 *     row, removes just that contact's broken Signal session so a fresh one is negotiated (WhatsApp resends);
 *  2. offers heal()/healAll() for the .fixsession command;
 *  3. turns libsignal's console spam (which also prints private session keys) into one short summary line.
 */
const jidUser = j => String(j || '').split('@')[0].split(':')[0];
const THRESHOLD = 4;            // failures ...
const WINDOW_MS = 90 * 1000;    // ... within this window trigger a repair
const COOLDOWN_MS = 10 * 60 * 1000; // never repair the same contact more often than this
const mask = u => (u.length > 6 ? u.slice(0, 3) + '•••' + u.slice(-3) : '•••');

function createHealer({ record, keys, flush, logger, note = () => {}, sessionId }) {
  // Delete through the (cached) signal key store when given, so the in-memory cache forgets the session too.
  const drop = async ids => { if (!ids.length) return; if (keys?.set) await keys.set({ session: Object.fromEntries(ids.map(id => [id, null])) }); else for (const id of ids) delete record.keys.session[id]; };
  const fails = new Map();       // user -> [timestamps]
  const healedAt = new Map();    // user -> timestamp
  const stats = { healed: 0, failures: 0 };

  const addressRe = user => new RegExp(`^${user.replace(/[^\d]/g, '')}(?:_\\d+)?\\.\\d+$`);
  /** Remove every Signal session of this contact (all their devices). Returns how many were removed. */
  async function heal(user, { manual = false } = {}) {
    user = jidUser(user); if (!/^\d{5,20}$/.test(user)) return 0;
    if (!manual && Date.now() - (healedAt.get(user) || 0) < COOLDOWN_MS) return 0;
    const sessions = record.keys?.session || {}; const re = addressRe(user);
    const ids = Object.keys(sessions).filter(id => re.test(id));
    await drop(ids);
    healedAt.set(user, Date.now()); fails.delete(user);
    if (ids.length) { stats.healed++; try { await flush(); } catch (e) { logger.warn({ sessionId, error: e.message }, 'Could not save the repaired session'); } }
    logger.warn({ sessionId, contact: mask(user), removed: ids.length }, ids.length ? 'Repaired a broken encryption session after repeated decrypt failures' : 'Decrypt failures from a contact with no stored session (nothing to repair)');
    note('WARN', ids.length ? `Repaired encryption session for ${mask(user)}` : `Decrypt failures from ${mask(user)}`);
    return ids.length;
  }
  /** Remove all contact sessions (not your own credentials). Used by ".fixsession all". */
  async function healAll() {
    const sessions = record.keys?.session || {}; const n = Object.keys(sessions).length;
    await drop(Object.keys(sessions));
    if (n) await flush(); fails.clear();
    logger.warn({ sessionId, removed: n }, 'Cleared all contact encryption sessions (they re-form on the next message)');
    return n;
  }
  function noteFailure(users) {
    const now = Date.now(); stats.failures++;
    for (const u of new Set(users.map(jidUser).filter(x => /^\d{5,20}$/.test(x)))) {
      const arr = (fails.get(u) || []).filter(t => now - t < WINDOW_MS); arr.push(now); fails.set(u, arr);
      if (arr.length >= THRESHOLD) heal(u).catch(() => {});
    }
  }
  /** Pull the contact out of Baileys' log object: { key: { remoteJid, participant, ...Alt } } */
  function inspect(obj, msg) {
    if (typeof msg !== 'string' || !/failed to decrypt message/i.test(msg)) return;
    const k = obj?.key || obj?.fullMessage?.key || obj?.msg?.key; if (!k) return;
    const isGroup = String(k.remoteJid || '').endsWith('@g.us');
    noteFailure([k.participant, k.participantAlt, ...(isGroup ? [] : [k.remoteJid, k.remoteJidAlt])].filter(Boolean));
  }
  /** Wrap a pino logger so its .error() calls are inspected (children stay wrapped too). */
  function wrap(base) {
    return new Proxy(base, {
      get(target, prop) {
        if (prop === 'error') return function (...args) { try { inspect(args[0], args[1]); } catch { /* never break logging */ } return target.error.apply(target, args); };
        if (prop === 'child') return function (...args) { return wrap(target.child.apply(target, args)); };
        const v = Reflect.get(target, prop, target); return typeof v === 'function' ? v.bind(target) : v;
      }
    });
  }
  return { heal, healAll, noteFailure, inspect, wrap, stats, THRESHOLD };
}

/** libsignal prints whole session objects (including private keys) and a stack trace per failure. Replace that with one line a minute. */
const NOISE = [/^Closing session/i, /^Opening session/i, /^Removing old closed session/i, /^Migrating session/i, /^Session already (closed|open)/i, /^Failed to decrypt message with any known session/i, /^Session error:/i, /^Bad MAC/i, /^Decrypted message with closed session/i];
function silenceSignalNoise(logger) {
  if (String(process.env.SIGNAL_LOGS || '').toLowerCase() === 'verbose' || silenceSignalNoise.done) return () => 0;
  silenceSignalNoise.done = true; let suppressed = 0, badMac = 0;
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => { const first = typeof args[0] === 'string' ? args[0] : ''; if (first && NOISE.some(re => re.test(first))) { suppressed++; if (/bad mac/i.test(first)) badMac++; return; } orig(...args); };
  }
  const t = setInterval(() => {
    if (!suppressed) return;
    logger.warn({ lines: suppressed, badMac }, `${suppressed} low-level encryption log lines hidden${badMac ? ` (${badMac} "Bad MAC")` : ''}. Bad MAC means one contact's encryption session is out of sync; the bot repairs it automatically, or send .fixsession. Make sure this WhatsApp number is not also running somewhere else. (Set SIGNAL_LOGS=verbose to see everything.)`);
    suppressed = 0; badMac = 0;
  }, 60 * 1000); t.unref?.();
  return () => suppressed;
}

module.exports = { createHealer, silenceSignalNoise, THRESHOLD, WINDOW_MS, COOLDOWN_MS };
