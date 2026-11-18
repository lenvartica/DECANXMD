'use strict';
/**
 * Last-line-of-defense redaction for anything leaving the process as a log export (JSON or text).
 * The application is not supposed to log secrets in the first place (see lib/bot.js's ring()
 * comment and lib/envsettings.js, which never stores them) — this scrubs common secret SHAPES
 * (API-key-looking tokens, bearer tokens, long base64/hex blobs, WhatsApp pairing codes) in case
 * one slips into a message or error string, rather than matching specific known key names.
 */
const PATTERNS = [
  [/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '[redacted-token]'], // JWT-shaped
  [/\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi, 'Bearer [redacted]'],
  [/\bsk-[A-Za-z0-9]{10,}\b/g, '[redacted-key]'], // common "sk-..." API key shape
  [/\b[A-Fa-f0-9]{32,}\b/g, '[redacted-hex]'], // long hex blobs (session keys, hashes used as secrets)
  [/\b\d{3}-\d{3}\b/g, '[redacted-code]'], // WhatsApp-style NNN-NNN pairing codes
  [/"cookie"\s*:\s*"[^"]*"/gi, '"cookie":"[redacted]"']
];

function redact(text) {
  let out = String(text ?? '');
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return out;
}

/** Deep-redacts string values in a plain object/array (used before JSON log export). */
function redactDeep(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}

module.exports = { redact, redactDeep };
