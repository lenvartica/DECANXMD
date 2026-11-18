'use strict';
/**
 * Authentication for the dashboard's owner-only configuration and diagnostics endpoints
 * (Environment & Settings, log export, restart). Not used for the public pairing/health
 * endpoints, which stay open exactly as before.
 *
 * - A high-entropy credential (256 bits) is generated once on first run and stored locally,
 *   never logged and never accepted over a GET query string.
 * - Every protected request needs that credential in an Authorization: Bearer header (or
 *   X-Dashboard-Token), checked with a constant-time comparison.
 * - A failed-attempt limiter, a generous request-volume limiter and an Origin check sit in front of the credential check.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Overridable so the offline self-tests (scripts/selftest.js) can point this at a throwaway
// directory instead of touching a real install's data/ folder. Unset in normal operation.
const DATA_DIR = process.env.DECANXMD_DATA_DIR || path.join(__dirname, '..', 'data');
const CRED_FILE = path.join(DATA_DIR, 'dashboard-admin.json');

function loadOrCreateToken(logger) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const saved = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
    if (saved && typeof saved.token === 'string' && saved.token.length >= 32) return { token: saved.token, isNew: false };
  } catch { /* missing or unreadable — generate a fresh one below */ }
  const token = crypto.randomBytes(32).toString('base64url'); // 256 bits of entropy
  try { fs.writeFileSync(CRED_FILE, JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 }); }
  catch (e) { logger?.warn?.({ error: e.message }, 'Could not persist the dashboard admin credential; a new one will be generated on every restart.'); }
  return { token, isNew: true };
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  // Compare against a buffer of the same length as `a` when lengths differ, so the failure path
  // still does a fixed-cost comparison rather than returning instantly on a length mismatch.
  if (ab.length !== bb.length) { try { crypto.timingSafeEqual(ab, ab); } catch { /* ignore */ } return false; }
  return crypto.timingSafeEqual(ab, bb);
}

/** Client key for rate limiting (honours `trust proxy`, so hosted installs don't share one bucket). */
const clientKey = req => req.ip || req.socket?.remoteAddress || 'unknown';

/**
 * Simple in-memory fixed-window counter, keyed by client IP.
 * - hit(req)     counts one event and returns true while the client is still under `max`.
 * - blocked(req) says whether the client is already over `max` WITHOUT counting another event.
 * - reset(req)   forgets the client (used after a successful login).
 */
function windowCounter({ windowMs = 60000, max = 20 } = {}) {
  const hits = new Map();
  const fresh = (rec, now) => rec && now - rec.start <= windowMs;
  setInterval(() => { const now = Date.now(); for (const [k, r] of hits) if (!fresh(r, now)) hits.delete(k); }, windowMs).unref?.();
  return {
    hit(req) {
      const key = clientKey(req), now = Date.now(), rec = hits.get(key);
      if (!fresh(rec, now)) { hits.set(key, { start: now, count: 1 }); return true; }
      rec.count += 1;
      return rec.count <= max;
    },
    blocked(req) {
      const rec = hits.get(clientKey(req));
      return Boolean(fresh(rec, Date.now()) && rec.count > max);
    },
    reset(req) { hits.delete(clientKey(req)); }
  };
}

/**
 * Backwards-compatible middleware form (one counter for every request). Kept for callers/tests that
 * want a plain limiter; the dashboard itself now uses the two-tier scheme in createDashboardAuth().
 */
function rateLimiter(opts = {}) {
  const counter = windowCounter(opts);
  return (req, res, next) => {
    if (!counter.hit(req)) return res.status(429).json({ error: 'Too many requests to the dashboard admin API. Please wait a minute and try again.' });
    next();
  };
}

/** True when the request has no Origin header (same-origin navigations, curl) or one matching Host. */
function originAllowed(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const host = req.get('host') || '';
    const originHostPort = `${o.hostname}:${o.port || (o.protocol === 'https:' ? '443' : '80')}`;
    return o.host === host || originHostPort === host;
  } catch { return false; }
}

/**
 * @returns {{ token: string, isNew: boolean, requireAuth: Function[] }}
 * requireAuth is an Express middleware chain: rate limit -> origin check -> credential check.
 */
function createDashboardAuth(logger) {
  const { token, isNew } = loadOrCreateToken(logger);
  // Two tiers, so normal dashboard use can never lock the owner out:
  //  - failed-credential limiter: only WRONG/missing credentials count (brute-force protection, strict);
  //  - request limiter: a generous ceiling on total admin calls per minute (runaway-script protection).
  // Previously every request counted towards a 20/min cap, so the auto-refreshing log panel plus a few
  // toggle clicks produced "Too many requests" errors and even logged the owner out.
  const failures = windowCounter({ windowMs: 60000, max: 10 });
  const volume = windowCounter({ windowMs: 60000, max: 600 });
  const TOO_MANY = { error: 'Too many requests to the dashboard admin API. Please wait a minute and try again.' };
  const requireAuth = [
    (req, res, next) => {
      if (failures.blocked(req)) { res.set?.('Retry-After', '60'); return res.status(429).json({ error: 'Too many failed credential attempts. Please wait a minute and try again.' }); }
      if (!volume.hit(req)) { res.set?.('Retry-After', '60'); return res.status(429).json(TOO_MANY); }
      next();
    },
    (req, res, next) => {
      if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin is not allowed.' });
      const header = req.get('authorization') || '';
      const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : (req.get('x-dashboard-token') || '').trim();
      if (!supplied || !timingSafeEqual(supplied, token)) {
        failures.hit(req);
        return res.status(401).json({ error: 'Invalid or missing dashboard admin credential.' });
      }
      failures.reset(req);
      next();
    }
  ];
  return { token, isNew, requireAuth };
}

module.exports = { createDashboardAuth, rateLimiter, windowCounter, CRED_FILE };
