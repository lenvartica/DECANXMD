'use strict';
/**
 * Tiny short-lived memo for song/video search lookups. Keeps a `.music` menu and a quick
 * follow-up `.play`/`.song`/`.video` of the same query from hitting YouTube twice in a row,
 * without ever serving results past their TTL. Bounded size + bounded age; never persisted.
 */
const TTL_MS = 30 * 1000;
const MAX_ENTRIES = 200;
const cache = new Map();

const key = q => String(q || '').trim().toLowerCase();

function get(q) {
  const k = key(q);
  const hit = cache.get(k);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) { cache.delete(k); return undefined; }
  return hit.value;
}

function set(q, value) {
  const k = key(q);
  cache.delete(k); // re-insert at the end so the Map stays in least-recently-set order
  cache.set(k, { value, expiresAt: Date.now() + TTL_MS });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  return value;
}

module.exports = { get, set };
