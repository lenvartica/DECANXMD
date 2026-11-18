'use strict';
/** Fetch helpers that refuse to touch private/internal addresses (protects the server from SSRF). */
const dns = require('dns').promises;
const net = require('net');
const { UserError } = require('./util');

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { throw new UserError('That does not look like a valid link.'); }
  if (!/^https?:$/.test(u.protocol)) throw new UserError('Only http and https links are supported.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => { throw new UserError('That domain could not be found.'); })).map(r => r.address);
  if (!ips.length || ips.some(isPrivateIp)) throw new UserError('That address points to a private network, so I will not open it.');
  return u;
}

/** follows redirects manually, checking every hop. Returns { status, headers, url, hops, ms, body } */
async function safeFetch(raw, { method = 'GET', timeout = 10000, maxHops = 6, maxBytes = 300000 } = {}) {
  const hops = [];
  let url = (await assertPublicUrl(raw)).href;
  const t0 = Date.now();
  for (let i = 0; i <= maxHops; i++) {
    const res = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'Mozilla/5.0 (compatible; DecanBot/1.0)' } }).catch(e => { throw new UserError(`Could not connect (${String(e.cause?.code || e.message).slice(0, 60)}).`); });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      hops.push({ status: res.status, url });
      url = (await assertPublicUrl(new URL(loc, url).href)).href;
      continue;
    }
    let body = '';
    if (method === 'GET') {
      const buf = Buffer.from(await res.arrayBuffer()).subarray(0, maxBytes);
      body = buf.toString('utf8');
    }
    return { status: res.status, headers: res.headers, url, hops, ms: Date.now() - t0, body };
  }
  throw new UserError(`Too many redirects (more than ${maxHops}).`);
}

module.exports = { assertPublicUrl, safeFetch, isPrivateIp };
