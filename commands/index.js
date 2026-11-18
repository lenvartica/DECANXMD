'use strict';
const fs = require('fs');
const path = require('path');

const registry = new Map();
const categories = new Map();
const hooks = [];
const events = [];
const tickers = [];

/**
 * def(names, options, run)
 * options: cat, desc, owner, group, admin, botAdmin, heavy, core, public
 */
function def(names, opts, run) {
  if (typeof opts === 'function') { run = opts; opts = {}; }
  names = [].concat(names).map(n => n.toLowerCase());
  const d = { ...opts, names, name: names[0], run };
  for (const n of names) {
    if (registry.has(n)) throw new Error(`Duplicate command name: ${n}`);
    registry.set(n, d);
  }
  const cat = d.cat || 'misc';
  if (!categories.has(cat)) categories.set(cat, []);
  categories.get(cat).push(d);
}

/** alias('sticker', 's', 'stick'): extra names for an already-defined command (shown in its help) */
function alias(existing, ...names) {
  const d = registry.get(existing);
  if (!d) throw new Error(`alias target missing: ${existing}`);
  for (const n of names.map(x => x.toLowerCase())) {
    if (registry.has(n)) throw new Error(`Duplicate command name: ${n}`);
    registry.set(n, d); d.names.push(n);
  }
}

// Keep the command API shape stable even when an older command module or a protected
// build is mixed into the installation. Runtime consumers always receive real arrays.
const api = { def, alias, registry, hooks, events, tickers };
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && f !== 'index.js').sort();
for (const f of files) require(path.join(__dirname, f))(api);

hooks.sort((a, b) => (a.priority || 0) - (b.priority || 0));

const CATEGORY_ORDER = ['ai', 'audio', 'autoreply', 'bot', 'budget', 'community', 'developer', 'document', 'download', 'editor', 'game', 'group', 'logia', 'media', 'misc', 'personal', 'plugin', 'schedule', 'search', 'sports', 'stats', 'sticker', 'textmaker', 'tools', 'user', 'vars', 'video', 'whatsapp'];

// Never expose undefined/non-array lifecycle collections. Some older DECAN/Tanda builds
// exported only the registry; normalising here prevents `not iterable` crashes during
// session restore while preserving every loaded hook/event/ticker from this build.
const commandHooks = Array.isArray(hooks) ? hooks : [];
const commandEvents = Array.isArray(events) ? events : [];
const commandTickers = Array.isArray(tickers) ? tickers : [];

module.exports = {
  registry,
  categories,
  hooks: commandHooks,
  events: commandEvents,
  tickers: commandTickers,
  CATEGORY_ORDER
};
