'use strict';
process.env.TERMINAL_MODE = '1';
const path = require('path');
// Load .env when it exists. (`node --env-file=.env` crashes the whole bot on panels that have no .env file.)
(() => {
  const fs = require('fs');
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  try { if (typeof process.loadEnvFile === 'function') return process.loadEnvFile(file); } catch {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();
const https = require('https');
const pino = require('pino');

// Must run before lib/bot.js (or anything else) is required: BOT_NAME, OWNER_NAME, CHANNEL_URL,
// TIMEZONE, FOOTER_TEXT and LOG_LEVEL are all read once into module-level constants below and in
// lib/bot.js, so any value saved from the Environment & Settings dashboard panel has to already be
// in process.env before those reads happen. See lib/envsettings.js for the editor itself.
const envSettings = require('./lib/envsettings');
envSettings.applyToEnv();

const { createTerminalDestination, printBanner } = require('./lib/terminal');
const { Store } = require('./lib/store');
const { getHostingPlatform } = require('./lib/platform');
const { createBot, frame, adContext, LOG_RING } = require('./lib/bot');
const { redact, redactDeep } = require('./lib/redact');

const BOT_NAME = process.env.BOT_NAME || 'DECAN XMD';
const logger = pino({ level: process.env.LOG_LEVEL || 'info' }, createTerminalDestination());
const { createHealer, silenceSignalNoise } = require('./lib/sessionhealer');
silenceSignalNoise(logger); // libsignal prints private session keys on every Bad MAC; show one summary line instead

const sessions = new Map();
const reconnectAttempts = new Map(); // sessionId -> consecutive failed reconnects (exponential backoff, v1.2.0)
const pairingRequests = new Map();
const authLocks = new Map();
const runtimeEvents = [];
const runtimeStartedAt = Date.now();
let previousCpu = process.cpuUsage();
let previousCpuAt = Date.now();
let latestCpuPercent = 0;
function recordRuntime(level, message, details = {}) {
  runtimeEvents.unshift({ time: new Date().toISOString(), level, message: String(message).slice(0, 240), ...details });
  if (runtimeEvents.length > 160) runtimeEvents.length = 160;
}
recordRuntime('INFO', 'Runtime telemetry initialized');
setInterval(() => {
  const now = Date.now();
  const cpu = process.cpuUsage(previousCpu);
  const elapsed = Math.max(1, now - previousCpuAt);
  latestCpuPercent = Math.min(100, Math.round(((cpu.user + cpu.system) / 1000 / elapsed) * 1000) / 10);
  previousCpu = process.cpuUsage();
  previousCpuAt = now;
}, 5000).unref();

let B; // Baileys exports (loaded with dynamic import so ESM or CJS builds both work)
let bot; // message router
let store; // per-session settings


/* ------------------------------------------------------------------ */
/* Baileys loader                                                      */
/* ------------------------------------------------------------------ */
async function loadBaileys() {
  const mod = await import('@whiskeysockets/baileys');
  const pick = k => mod[k] ?? mod.default?.[k];
  const makeWASocket = typeof mod.default === 'function' ? mod.default : (mod.default?.default || mod.makeWASocket);
  if (typeof makeWASocket !== 'function') throw new Error('Could not load makeWASocket from @whiskeysockets/baileys');
  return {
    makeWASocket,
    DisconnectReason: pick('DisconnectReason'),
    initAuthCreds: pick('initAuthCreds'),
    BufferJSON: pick('BufferJSON'),
    Browsers: pick('Browsers'),
    fetchLatestBaileysVersion: pick('fetchLatestBaileysVersion'),
    makeCacheableSignalKeyStore: pick('makeCacheableSignalKeyStore'),
    downloadMediaMessage: pick('downloadMediaMessage'),
    generateWAMessageContent: pick('generateWAMessageContent'),
    generateWAMessageFromContent: pick('generateWAMessageFromContent'),
    proto: pick('proto') // needed to build native-flow interactive messages — see lib/bot.js sendNativeFlow()
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const encodeAuth = v => JSON.parse(JSON.stringify(v, B.BufferJSON.replacer));
const decodeAuth = v => (v ? JSON.parse(JSON.stringify(v), B.BufferJSON.reviver) : v);
const isRegistered = creds => Boolean(creds && (creds.registered || creds.me));
const normalizePhone = v => String(v || '').replace(/\D/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let cachedVersion = null;
let cachedVersionAt = 0;
async function getWaVersion() {
  if (cachedVersion && Date.now() - cachedVersionAt < 6 * 3600 * 1000) return cachedVersion;
  try {
    const { version } = await B.fetchLatestBaileysVersion();
    cachedVersion = version;
    cachedVersionAt = Date.now();
    return version;
  } catch (error) {
    logger.warn({ error: error.message }, 'Could not fetch latest WhatsApp version; using Baileys default');
    return cachedVersion || undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Local JSON storage                                                   */
/* ------------------------------------------------------------------ */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const DATA_DIR = path.join(__dirname, 'data');
const LOCAL_DB_PATH = path.join(DATA_DIR, 'local-store.json');
const localTables = { tanda_sessions: [], tanda_data: [] };
let localWriteQueue = Promise.resolve();
let localDbReady = false;

async function initializeLocalDatabase() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(await fsp.readFile(LOCAL_DB_PATH, 'utf8'));
    for (const table of Object.keys(localTables)) {
      localTables[table] = Array.isArray(parsed?.[table]) ? parsed[table] : [];
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      const backup = `${LOCAL_DB_PATH}.corrupt-${Date.now()}`;
      try { await fsp.rename(LOCAL_DB_PATH, backup); } catch {}
      logger.error({ error: error.message, backup }, 'Local database file was invalid; starting an empty local store');
    }
    await persistLocalDatabase();
  }
  localDbReady = true;
  logger.info({ path: LOCAL_DB_PATH }, 'Local persistent storage ready');
}

function persistLocalDatabase() {
  const task = localWriteQueue.catch(() => {}).then(async () => {
    const snapshot = JSON.stringify({ version: 1, updated_at: new Date().toISOString(), ...localTables }, null, 2);
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tempPath = `${LOCAL_DB_PATH}.${process.pid}.tmp`;
    await fsp.writeFile(tempPath, snapshot, { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(tempPath, LOCAL_DB_PATH);
  });
  localWriteQueue = task;
  return task;
}

function rowMatches(row, query) {
  for (const [column, expression] of Object.entries(query || {})) {
    if (['select', 'limit', 'on_conflict', 'order'].includes(column)) continue;
    const text = String(expression);
    if (!text.startsWith('eq.')) continue;
    const expected = text.slice(3);
    if (String(row?.[column] ?? '') !== expected) return false;
  }
  return true;
}

async function localStoreRequest(table, options = {}) {
  if (!localDbReady) await initializeLocalDatabase();
  if (!Object.hasOwn(localTables, table)) throw new Error('Invalid local storage table.');
  const query = options.query || {};
  const method = String(options.method || 'GET').toUpperCase();
  const rows = localTables[table];
  if (method === 'GET') {
    const limit = Math.max(1, Math.min(5000, Number(query.limit || 5000)));
    const columns = String(query.select || '*').split(',').map(value => value.trim());
    return rows.filter(row => rowMatches(row, query)).slice(0, limit).map(row => {
      if (columns.includes('*')) return structuredClone(row);
      const selected = {};
      for (const column of columns) if (Object.hasOwn(row, column)) selected[column] = structuredClone(row[column]);
      return selected;
    });
  }
  if (method === 'POST') {
    const incoming = Array.isArray(options.body) ? options.body : [options.body];
    const conflictColumns = String(query.on_conflict || (table === 'tanda_sessions' ? 'session_id' : 'session_id,key')).split(',').map(value => value.trim());
    const output = [];
    for (const item of incoming) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const index = rows.findIndex(existing => conflictColumns.every(column => String(existing[column] ?? '') === String(item[column] ?? '')));
      if (index >= 0) rows[index] = { ...rows[index], ...structuredClone(item) };
      else rows.push(structuredClone(item));
      output.push(structuredClone(index >= 0 ? rows[index] : item));
    }
    await persistLocalDatabase();
    return output;
  }
  if (method === 'DELETE') {
    const matching = rows.filter(row => rowMatches(row, query));
    const filters = Object.keys(query).filter(key => !['select', 'limit', 'on_conflict', 'order'].includes(key));
    if (!filters.length) throw new Error('Refusing to delete local records without a filter.');
    localTables[table] = rows.filter(row => !rowMatches(row, query));
    await persistLocalDatabase();
    return matching.map(row => structuredClone(row));
  }
  throw new Error(`Unsupported local storage method: ${method}`);
}

async function getStoredSession(sessionId) {
  const rows = await localStoreRequest('tanda_sessions', { query: { select: '*', session_id: `eq.${sessionId}`, limit: '1' } });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function deleteStoredSession(sessionId) {
  await localStoreRequest('tanda_sessions', { method: 'DELETE', query: { session_id: `eq.${sessionId}` }, prefer: 'return=minimal' });
}

async function saveStoredSession(sessionId, patch) {
  const existing = sessions.get(sessionId);
  const row = {
    session_id: sessionId,
    phone: patch.phone || existing?.phone || sessionId,
    creds: encodeAuth(patch.creds || existing?.creds || {}),
    keys: encodeAuth(patch.keys || existing?.keys || {}),
    connected: patch.connected ?? existing?.connected ?? false,
    updated_at: new Date().toISOString()
  };
  return localStoreRequest('tanda_sessions', { method: 'POST', query: { on_conflict: 'session_id' }, body: row });
}

/* ------------------------------------------------------------------ */
/* Auth state (debounced persistence)                                  */
/* ------------------------------------------------------------------ */
async function createAuthState(sessionId, phone, { fresh = false } = {}) {
  const memory = sessions.get(sessionId);
  let creds, keys, connected = false;

  if (fresh) {
    creds = B.initAuthCreds();
    keys = {};
  } else if (memory?.creds) {
    creds = memory.creds;
    keys = memory.keys || {};
    connected = Boolean(memory.connected);
  } else {
    const stored = await getStoredSession(sessionId);
    creds = stored?.creds && Object.keys(stored.creds).length ? decodeAuth(stored.creds) : B.initAuthCreds();
    keys = decodeAuth(stored?.keys || {});
    connected = Boolean(stored?.connected);
  }

  const record = { session_id: sessionId, phone, creds, keys, connected, lastReg: isRegistered(creds) };

  const entry = { ...record, socket: null, starting: false, stale: false, rt: null, api: null };
  sessions.set(sessionId, entry);

  const writeQueue = async task => {
    const previous = authLocks.get(sessionId) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    authLocks.set(sessionId, next);
    try { await next; } finally { if (authLocks.get(sessionId) === next) authLocks.delete(sessionId); }
  };

  let timer = null;
  const flush = async () => {
    clearTimeout(timer);
    timer = null;
    await writeQueue(() => saveStoredSession(sessionId, { creds: record.creds, keys: record.keys, phone }));
  };
  const queue = (now = false) => {
    if (now) return flush();
    if (!timer) {
      timer = setTimeout(() => flush().catch(e => logger.error({ error: e.message, sessionId }, 'Could not persist session')), 1500);
      timer.unref?.();
    }
    return Promise.resolve();
  };
  entry.flush = flush;

  const keyStore = {
    get: async (type, ids) => {
      const output = {};
      for (const id of ids) {
        const value = record.keys?.[type]?.[id];
        output[id] = value === undefined ? null : value;
      }
      return output;
    },
    set: async data => {
      for (const [type, entries] of Object.entries(data)) {
        record.keys[type] ||= {};
        for (const [id, value] of Object.entries(entries)) {
          if (value === null || value === undefined) delete record.keys[type][id];
          else record.keys[type][id] = value;
        }
      }
      await queue();
    }
  };

  return {
    state: { creds: record.creds, keys: B.makeCacheableSignalKeyStore(keyStore, logger) },
    saveCreds: () => {
      const reg = isRegistered(record.creds);
      const changed = reg !== record.lastReg;
      record.lastReg = reg;
      return queue(changed);
    },
    flush,
    record,
    entry
  };
}

/* ------------------------------------------------------------------ */
/* Session lifecycle                                                   */
/* ------------------------------------------------------------------ */
function teardownSession(sessionId) {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  entry.stale = true;
  sessions.delete(sessionId);
  try { entry.socket?.end(undefined); } catch {}
}

function waitForHandshake(sock, timeoutMs = 10000) {
  return new Promise(resolve => {
    let timer;
    const done = () => { clearTimeout(timer); sock.ev.off('connection.update', onUpdate); resolve(); };
    const onUpdate = u => { if (u.qr || u.connection === 'close') done(); };
    timer = setTimeout(done, timeoutMs);
    sock.ev.on('connection.update', onUpdate);
  });
}

async function startSession(phone, requestPairing = false, requestQr = false) {
  const sessionId = phone;
  const existing = sessions.get(sessionId);

  if (requestPairing || requestQr) {
    if (existing?.connected && existing.socket && !existing.socket.ws?.isClosed) return { connected: true };
    const stored = await getStoredSession(sessionId);
    if (isRegistered(stored?.creds)) {
      if (!existing?.socket) startSession(phone).catch(e => logger.error({ error: e.message, sessionId }, 'Could not start registered session'));
      return { alreadyRegistered: true };
    }
    if (existing) teardownSession(sessionId);
    await deleteStoredSession(sessionId);
  } else {
    if (existing?.socket && !existing.socket.ws?.isClosed) return { connected: Boolean(existing.connected) };
    if (existing?.starting) throw Object.assign(new Error('This phone session is already starting. Wait a moment.'), { status: 409 });
    if (existing) existing.stale = true;
  }

  const prevRt = (requestPairing || requestQr) ? null : existing?.rt;
  const auth = await createAuthState(sessionId, phone, { fresh: requestPairing || requestQr });
  const entry = auth.entry;
  entry.rt = prevRt || bot.newRuntime();
  entry.starting = true;

  try {
    await bot.prepare(entry);
  } catch (error) {
    logger.warn({ error: error.message, sessionId }, 'Bot preparation had a problem (continuing)');
  }

  // Repairs a contact's broken encryption session after repeated "failed to decrypt" errors (see lib/sessionhealer.js).
  const healer = createHealer({ record: auth.record, keys: auth.state.keys, flush: auth.flush, logger, note: recordRuntime, sessionId });
  entry.healer = healer;

  const version = await getWaVersion();
  let sock;
  try {
    sock = B.makeWASocket({
      version,
      auth: auth.state,
      logger: healer.wrap(logger.child({ sessionId })),
      printQRInTerminal: false,
      browser: B.Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      cachedGroupMetadata: bot.groupCacheGetter(entry),
      getMessage: async () => undefined
    });
  } catch (error) {
    entry.starting = false;
    sessions.delete(sessionId);
    throw error;
  }

  entry.socket = sock;
  const handshake = (requestPairing || requestQr) ? waitForHandshake(sock) : null;
  entry.qr = null;

  sock.ev.on('creds.update', async () => {
    try { await auth.saveCreds(); }
    catch (error) { logger.error({ error: error.message, sessionId }, 'Could not persist credentials');
    recordRuntime('ERROR', 'Could not persist WhatsApp credentials'); }
  });

  bot.attach(entry);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (entry.stale) return;
    if (qr) entry.qr = qr;

    if (connection === 'open') {
      entry.connected = true;
      entry.starting = false;
      entry.connectedAt = Date.now();
      reconnectAttempts.delete(sessionId);
      try {
        await auth.flush();
        await saveStoredSession(sessionId, { connected: true, creds: auth.record.creds, keys: auth.record.keys, phone });
      } catch (error) {
        logger.error({ error: error.message, sessionId }, 'Could not store connected status');
      }
      logger.info({ sessionId }, 'WhatsApp session connected');
      recordRuntime('INFO', 'WhatsApp session connected', { session: String(sessionId).slice(-4) });

      if (!entry.rt.welcomed) {
        entry.rt.welcomed = true;
        try {
          const prefix = entry.api ? entry.api.var('PREFIX') : '.';
          const userName = String(sock.user?.name || auth.record.creds?.me?.name || 'there').trim();
          const version = require('./package.json').version;
          const mode = String(entry.api ? entry.api.var('MODE') : 'public').toUpperCase();
          const welcome = `┏❒ 👑 ✦ 𝐃𝐄𝐂𝐀𝐍 𝐗𝐌𝐃 ✦ 👑 ❒
   "Welcome to a smarter WhatsApp experience."
┃
┃ 👋 Hᴇʟʟᴏ: ${userName}
┃ 🆔 Usᴇʀ: ${phone}
┃
┃ ⚡ Prefix: ${prefix}
┃ 📌 Version: ${version}
┃ 🤖 Mode: ${mode}
┃
┃ Type ${prefix}menu to explore commands.
┃ Type ${prefix}doctor if anything misbehaves.
┃
╭━━〔 ⚜️ A MESSAGE FROM THE FOUNDER 〕
│ Lenny Decan welcomes you
│ to the DECAN XMD community.
│ Thank you for choosing our bot.
╰━━━━━━━━━━━━━━━━━━
┗❒ ❤️ POWERED BY DECAN KONNECT`;
          await entry.api.sendTo(`${phone}@s.whatsapp.net`, {
            text: welcome,
            contextInfo: adContext(true)
          });
        } catch (error) {
          logger.warn({ error: error.message, sessionId }, 'Could not send connection confirmation');
          recordRuntime('WARN', 'Connection confirmation message failed');
        }
      }
    }

    if (connection === 'close') {
      entry.connected = false;
      entry.starting = false;
      entry.disconnectedAt = Date.now();
      const status = lastDisconnect?.error?.output?.statusCode;
      const registered = isRegistered(auth.record.creds);
      logger.info({ sessionId, status, registered }, 'WhatsApp connection closed');

      if (status === B.DisconnectReason.loggedOut) {
        sessions.delete(sessionId);
        try { await deleteStoredSession(sessionId); } catch (error) { logger.error({ error: error.message, sessionId }, 'Could not remove logged-out session'); }
        store.purge(sessionId).catch(() => {});
        return;
      }

      if (registered || status === B.DisconnectReason.restartRequired) {
        try { await auth.flush(); await saveStoredSession(sessionId, { connected: false, creds: auth.record.creds, keys: auth.record.keys, phone }); }
        catch (error) { logger.error({ error: error.message, sessionId }, 'Could not store disconnect status'); }
        // "Connection replaced" (440) means this same WhatsApp login was opened somewhere else (a second copy of the bot,
        // a hosted copy, WhatsApp Web...). Reconnecting immediately just kicks that other copy off and starts a tug-of-war
        // that corrupts encryption sessions (the "Bad MAC" / bot-stops-answering bug), so stop and tell the owner.
        if (status === (B.DisconnectReason?.connectionReplaced ?? 440)) {
          logger.warn({ sessionId }, 'This WhatsApp session was opened somewhere else (connection replaced). Not reconnecting, to avoid a tug-of-war. Stop the other copy, then restart this bot.');
          recordRuntime('WARN', 'Session replaced by another login; auto-reconnect paused', { session: String(sessionId).slice(-4) });
          return;
        }
        const n = (reconnectAttempts.get(sessionId) || 0) + 1;
        reconnectAttempts.set(sessionId, n);
        const delay = Math.min(3000 * 2 ** (n - 1), 60000); // 3s, 6s, 12s ... capped at 60s
        if (n > 1) logger.warn({ sessionId, attempt: n, retryInMs: delay }, 'Reconnecting with backoff');
        setTimeout(() => {
          startSession(phone).catch(error => logger.error({ error: error.message, sessionId }, 'Reconnect failed'));
        }, delay);
      } else {
        // Pairing never completed: don't reconnect (it would invalidate the code on screen).
        sessions.delete(sessionId);
      }
    }
  });

  if (requestPairing || requestQr) {
    await handshake;
    if (requestQr) {
      if (!entry.qr) {
        teardownSession(sessionId);
        throw Object.assign(new Error('WhatsApp did not provide a QR code. Please retry.'), { status: 502 });
      }
      return { phone, qr: await QRCode.toDataURL(entry.qr), qrText: entry.qr };
    }
    try {
      const code = await sock.requestPairingCode(phone);
      return { code: code.match(/.{1,4}/g)?.join('-') || code };
    } catch (error) {
      logger.error({ error: error.message, sessionId }, 'requestPairingCode failed');
      teardownSession(sessionId);
      throw Object.assign(new Error('WhatsApp did not return a pairing code. Please try again in a moment.'), { status: 502 });
    }
  }

  return { connected: false };
}

/* Web panel intentionally removed: DECAN XMD runs terminal-only on hosting panels. */

/* ------------------------------------------------------------------ */
/* Terminal pairing                                                    */
/* ------------------------------------------------------------------ */
const pairNumber = async input => {
  const phone = normalizePhone(input);
  if (!phone || phone.length < 8 || phone.length > 15) {
    throw Object.assign(new Error('Invalid phone number. Use country code, for example 2547XXXXXXXX.'), { status: 400 });
  }
  return startSession(phone, true, false);
};

async function runTerminalPairing() {
  let phone = normalizePhone(process.env.PAIR_PHONE);
  const configured = Boolean(phone);

  if (!phone) {
    if (!stdin.isTTY) {
      throw new Error('PAIR_PHONE is required when the hosting panel does not provide an interactive terminal. Example: PAIR_PHONE=2547XXXXXXXX');
    }
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      console.log('');
      console.log('╔══════════════════════════════════════════════╗');
      console.log('║          DECAN XMD • TERMINAL PAIRING      ║');
      console.log('╠══════════════════════════════════════════════╣');
      console.log('║ Enter your WhatsApp number with country     ║');
      console.log('║ code. Example: 2547XXXXXXXX                 ║');
      console.log('╚══════════════════════════════════════════════╝');
      phone = normalizePhone(await rl.question('Phone number: '));
    } finally {
      rl.close();
    }
  }

  if (!phone || phone.length < 8 || phone.length > 15) {
    throw new Error('Invalid phone number. Use country code, for example 2547XXXXXXXX.');
  }

  logger.info({ phone: phone.slice(0, 3) + '******' + phone.slice(-2), source: configured ? 'PAIR_PHONE' : 'terminal' }, 'Requesting WhatsApp pairing code');
  const result = await startSession(phone, true, false);

  if (result?.alreadyRegistered || result?.connected) {
    logger.info({ phone: phone.slice(-4) }, 'This WhatsApp number is already registered; starting the saved session.');
    if (result?.alreadyRegistered) {
      await sleep(1000);
    }
    return result;
  }

  if (!result?.code) throw new Error('WhatsApp did not return a pairing code. Please restart the panel and try again.');

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║              DECAN XMD PAIRING              ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║ Pairing code: ${String(result.code).padEnd(29)}║`);
  console.log('║                                              ║');
  console.log('║ WhatsApp → Linked devices → Link a device   ║');
  console.log('║ → Link with phone number instead            ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  logger.info('Keep this terminal running until WhatsApp confirms the device is linked.');
  return result;
};

/* ------------------------------------------------------------------ */
/* Startup / shutdown                                                  */
/* ------------------------------------------------------------------ */
async function restoreSessions() {
  try {
    const rows = await localStoreRequest('tanda_sessions', { query: { select: 'session_id,phone,connected,creds' } });
    if (!Array.isArray(rows)) throw new Error('Local storage returned an unexpected response for saved sessions.');

    const restorable = rows.filter(r => r?.phone && isRegistered(r.creds));
    logger.info({ savedRows: rows.length, restorableSessions: restorable.length }, 'Loaded saved sessions from local storage');
    recordRuntime('INFO', `Session restore scan complete: ${restorable.length} restorable session(s)`);

    for (const row of restorable) {
      startSession(row.phone).catch(error => {
        logger.error({ error: error.message, phone: row.phone, status: error.status, code: error.code }, 'Session restore failed');
      });
      await sleep(1500); // stagger so many sessions don't start at once
    }
  } catch (error) {
    logger.error({
      message: error.message, status: error.status, code: error.code,
      storagePath: LOCAL_DB_PATH
    }, 'Could not restore sessions from local storage.');
  }
}

async function main() {
  await initializeLocalDatabase();
  B = await loadBaileys();
  store = new Store(localStoreRequest, logger);
  bot = createBot({ baileys: B, store, logger, pairNumber });

  printBanner({ name: BOT_NAME, version: require('./package.json').version });
  logger.info({ mode: 'terminal-only', name: BOT_NAME }, 'Terminal-only runtime is online; no web server is started');
  setInterval(() => bot.tick(sessions).catch(e => logger.error({ error: e.message }, 'Tick failed')), 5000).unref();

  await restoreSessions();
  await runTerminalPairing();
}


process.on('unhandledRejection', reason => logger.error({ reason: reason?.message || String(reason) }, 'Unhandled promise rejection'));
process.on('uncaughtException', error => logger.error({ error: error?.message, stack: String(error?.stack || '').split('\n').slice(0, 4).join(' | ') }, 'Uncaught exception'));

let shuttingDown = false;
process.on('SIGTERM', async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('SIGTERM received; saving sessions and closing sockets');
  const work = Promise.allSettled([
    ...[...sessions.values()].map(i => i.flush?.()),
    store?.flushAll()
  ]);
  await Promise.race([work, sleep(6000)]);
  for (const item of sessions.values()) {
    item.stale = true;
    try { item.socket?.end(undefined); } catch {}
  }
  process.exit(0);
});

main().catch(error => {
  logger.fatal({ error: error.message, stack: error.stack }, 'Fatal startup error');
  process.exit(1);
});
