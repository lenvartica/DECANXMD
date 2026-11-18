'use strict';
/**
 * Allowlisted, non-secret runtime settings the owner may view and change from the dashboard's
 * Environment & Settings panel. Values are stored in a local JSON file (no Postgres/Supabase),
 * validated against a strict per-key schema, and backed up before every change.
 *
 * Every one of these settings is read once into a module-level constant when server.js / lib/bot.js
 * load (e.g. `const BOT_NAME = process.env.BOT_NAME || '...'`), so a saved change only takes effect
 * after the process restarts. applyToEnv() must run before those modules are required — see the top
 * of server.js — so a saved value is already in process.env by the time anything reads it.
 *
 * This module intentionally has no knowledge of secrets (API keys, session credentials, pairing
 * codes, tokens, cookies): those are never written here and never returned by describe().
 */
const fs = require('fs');
const path = require('path');

// Overridable so the offline self-tests (scripts/selftest.js) can point this at a throwaway
// directory instead of touching a real install's data/ folder. Unset in normal operation.
const DATA_DIR = process.env.DECANXMD_DATA_DIR || path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'env-settings.json');
const BACKUP_DIR = path.join(DATA_DIR, 'env-backups');
const MAX_BACKUPS = 20;

const isHttpsUrl = v => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };
const isTimezone = v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } };
// What the bot actually uses when the variable is not set (must match lib/bot.js / server.js). Showing these in the
// form (instead of blanks) is what makes "SAVE CHANGES" work on a fresh install: the form posts every field, and
// blank BOT_NAME / TIMEZONE / LOG_LEVEL used to fail validation, so saving always errored.
const DEFAULTS = {
  BOT_NAME: 'DECANXMD',
  OWNER_NAME: '',
  CHANNEL_URL: 'https://whatsapp.com/channel/0029VbDqBjyFnSzHeIHAzH3m',
  TIMEZONE: 'Africa/Nairobi',
  FOOTER_TEXT: 'decan konnect',
  HOST_ADMINS: '',
  LOG_LEVEL: 'info',
  MAX_DOWNLOAD_MB: '150',
  MAX_MEDIA_MINUTES: '60',
  MAX_MEDIA_MB: '100',
  MAX_VIDEO_MB: '700',
  MAX_MOVIE_MB: '1500',
  MAX_MOVIE_MINUTES: '300',
  MAX_APK_MB: '400'
};
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/** label: shown in the dashboard. requiresRestart: true for every key here (see header comment). */
const ALLOWED = {
  BOT_NAME: { label: 'Bot name', requiresRestart: true, validate: v => (v.length >= 1 && v.length <= 60 ? null : 'Bot name must be 1-60 characters.') },
  OWNER_NAME: { label: 'Owner display name', requiresRestart: true, allowEmpty: true, validate: v => (v.length <= 60 ? null : 'Owner name must be 60 characters or fewer.') },
  CHANNEL_URL: { label: 'Channel URL', requiresRestart: true, allowEmpty: true, validate: v => (v === '' || isHttpsUrl(v) ? null : 'Channel URL must be a valid https:// link.') },
  TIMEZONE: { label: 'Timezone', requiresRestart: true, validate: v => (isTimezone(v) ? null : 'Unknown IANA timezone, e.g. Africa/Nairobi.') },
  FOOTER_TEXT: { label: 'Footer', requiresRestart: true, validate: v => (v.length <= 40 ? null : 'Footer must be 40 characters or fewer.') },
  HOST_ADMINS: { label: 'Host admins (comma-separated phone numbers)', requiresRestart: false, allowEmpty: true, validate: v => (v.length <= 300 && /^[\d,\s+]*$/.test(v) ? null : 'Host admins must be comma-separated phone numbers.') },
  MAX_DOWNLOAD_MB: { label: 'Max download size (MB)', requiresRestart: false, validate: v => (/^\d+$/.test(v) && +v >= 5 && +v <= 1000 ? null : 'Max download size must be a whole number from 5 to 1000 MB.') },
  MAX_MEDIA_MINUTES: { label: 'Max video/audio length (minutes)', requiresRestart: false, validate: v => (/^\d+$/.test(v) && +v >= 1 && +v <= 600 ? null : 'Max media length must be 1 to 600 minutes.') },
  MAX_MEDIA_MB: { label: 'Max video/audio file size (MB)', requiresRestart: false, validate: v => (/^\d+$/.test(v) && +v >= 5 && +v <= 1000 ? null : 'Max media size must be a whole number from 5 to 1000 MB.') },
  MAX_VIDEO_MB: { label: 'Max video size for .video .insta .fb … (MB)', requiresRestart: false, validate: v => (/^\d+$/.test(v) && +v >= 5 && +v <= 4000 ? null : 'Max video size for .video .insta .fb … (MB) must be a whole number from 5 to 4000.') },
  MAX_MOVIE_MB: { label: 'Max movie/drama/cartoon size (MB)', requiresRestart: false, validate: v => (/^\d+$/.test(v) && +v >= 5 && +v <= 2000 ? null : 'Max movie/drama/cartoon size (MB) must be a whole number from 5 to 2000.') },
  MAX_APK_MB: { label: 'Max APK size (MB)', requiresRestart: false, validate: v => (/^\d+$/.test(v) && +v >= 5 && +v <= 2000 ? null : 'Max APK size (MB) must be a whole number from 5 to 2000.') },
  MAX_MOVIE_MINUTES: { label: 'Max movie/episode length (minutes)', requiresRestart: false, validate: v => (/^\d+$/.test(v) && +v >= 5 && +v <= 720 ? null : 'Movie length must be 5 to 720 minutes.') },
  LOG_LEVEL: { label: 'Log level', requiresRestart: true, validate: v => (LOG_LEVELS.includes(v) ? null : `Log level must be one of: ${LOG_LEVELS.join(', ')}.`) }
};

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function readRaw() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/** Current effective value of every allowed key: stored override, else the live process.env, else ''. */
function current() {
  const stored = readRaw();
  const out = {};
  for (const key of Object.keys(ALLOWED)) out[key] = (key in stored ? stored[key] : (process.env[key] || DEFAULTS[key])) ?? '';
  return out;
}

/** What the dashboard renders: one row per editable setting. Never includes anything outside ALLOWED. */
function describe() {
  const values = current();
  return Object.entries(ALLOWED).map(([key, def]) => ({ key, label: def.label, requiresRestart: def.requiresRestart, value: values[key] }));
}

/** Copies the current settings file into data/env-backups/ before a change is applied. */
function backup() {
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `env-settings-${stamp}.json`);
  const existing = fs.existsSync(SETTINGS_FILE) ? fs.readFileSync(SETTINGS_FILE, 'utf8') : '{}';
  fs.writeFileSync(dest, existing);
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('env-settings-')).sort();
  while (files.length > MAX_BACKUPS) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  return dest;
}

/**
 * Validates and writes one or more allowlisted keys. Rejects unknown keys, non-string values,
 * oversized values and anything that fails its own validator — the whole patch is all-or-nothing.
 * Returns { saved, restartNeeded, backupFile }.
 */
function update(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings payload.');
  const keys = Object.keys(patch);
  if (!keys.length) throw new Error('No settings to update.');
  const cleaned = {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(ALLOWED, key)) throw new Error(`"${key}" is not an editable setting.`);
    const raw = patch[key];
    if (typeof raw !== 'string') throw new Error(`"${key}" must be a string.`);
    if (raw.length > 300) throw new Error(`"${key}" is too long.`);
    const value = raw.trim();
    const bad = ALLOWED[key].validate(value);
    if (bad) throw new Error(bad);
    cleaned[key] = value;
  }
  ensureDirs();
  const backupFile = backup();
  const stored = readRaw();
  const restartNeeded = [];
  for (const [key, value] of Object.entries(cleaned)) {
    stored[key] = value;
    if (ALLOWED[key].requiresRestart) restartNeeded.push(key);
    else process.env[key] = value; // read at call time (e.g. HOST_ADMINS) — applies immediately
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(stored, null, 2));
  return { saved: Object.keys(cleaned), restartNeeded, backupFile: path.relative(path.join(__dirname, '..'), backupFile) };
}

/** Reset one allowlisted key back to its environment/default value (removes the stored override). */
function reset(key) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED, key)) throw new Error(`"${key}" is not an editable setting.`);
  ensureDirs();
  const backupFile = backup();
  const stored = readRaw();
  delete stored[key];
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(stored, null, 2));
  if (!ALLOWED[key].requiresRestart) delete process.env[key];
  return { reset: key, requiresRestart: ALLOWED[key].requiresRestart, backupFile: path.relative(path.join(__dirname, '..'), backupFile) };
}

/** Applies stored overrides onto process.env. Must run before anything reads these into constants. */
function applyToEnv() {
  const stored = readRaw();
  for (const key of Object.keys(ALLOWED)) {
    if (key in stored && typeof stored[key] === 'string' && (stored[key] !== '' || ALLOWED[key].allowEmpty)) process.env[key] = stored[key];
  }
}

module.exports = { ALLOWED, DEFAULTS, describe, update, reset, backup, applyToEnv, SETTINGS_FILE };
