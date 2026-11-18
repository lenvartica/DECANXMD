'use strict';

/**
 * Per-session key/value settings. Reads are served from memory; writes are
 * debounced and saved to the local JSON storage adapter. If that table does not
 * exist yet, everything keeps working in memory (and a warning is logged).
 */
class Store {
  constructor(request, logger) {
    this.request = request;
    this.logger = logger;
    this.cache = new Map();
    this.available = true;
    this.warned = false;
  }

  slot(sid) {
    let s = this.cache.get(sid);
    if (!s) {
      s = { data: {}, dirty: new Set(), deleted: new Set(), timer: null, loaded: false };
      this.cache.set(sid, s);
    }
    return s;
  }

  isMissingTable(e) {
    return e && (e.supabaseStatus === 404 || ['PGRST205', '42P01', 'PGRST204'].includes(e.supabaseCode || e.code));
  }

  markUnavailable(e) {
    this.available = false;
    if (!this.warned) {
      this.warned = true;
      this.logger.warn({ error: e?.message }, 'Local settings persistence unavailable; settings are kept in memory only. Check local file permissions and the data folder.');
    }
  }

  async load(sid) {
    const s = this.slot(sid);
    if (s.loaded) return;
    s.loaded = true;
    try {
      const rows = await this.request('tanda_data', { query: { select: 'key,value', session_id: `eq.${sid}`, limit: '5000' } });
      for (const r of Array.isArray(rows) ? rows : []) if (!(r.key in s.data)) s.data[r.key] = r.value;
    } catch (e) {
      if (this.isMissingTable(e)) this.markUnavailable(e);
      else { s.loaded = false; this.logger.warn({ error: e.message, sid }, 'Could not load settings'); }
    }
  }

  get(sid, key, def) {
    const v = this.slot(sid).data[key];
    return v === undefined || v === null ? def : v;
  }

  /** Live reference to a stored object (created if missing). Call touch() after mutating. */
  ref(sid, key, def) {
    const s = this.slot(sid);
    if (s.data[key] === undefined || s.data[key] === null) { s.data[key] = def; s.dirty.add(key); this.schedule(sid); }
    return s.data[key];
  }

  set(sid, key, value) {
    const s = this.slot(sid);
    s.data[key] = value;
    s.dirty.add(key);
    s.deleted.delete(key);
    this.schedule(sid);
    return value;
  }

  /** Mark a key (mutated in place) as changed. */
  touch(sid, key) {
    const s = this.slot(sid);
    if (key in s.data) { s.dirty.add(key); this.schedule(sid); }
  }

  del(sid, key) {
    const s = this.slot(sid);
    delete s.data[key];
    s.dirty.delete(key);
    s.deleted.add(key);
    this.schedule(sid);
  }

  /** Mutate a value with fn(draft) and persist it. Returns fn's result. */
  update(sid, key, def, fn) {
    const draft = structuredClone(this.get(sid, key, def));
    const result = fn(draft);
    this.set(sid, key, draft);
    return result;
  }

  keys(sid, prefix = '') {
    return Object.keys(this.slot(sid).data).filter(k => k.startsWith(prefix));
  }

  schedule(sid) {
    const s = this.slot(sid);
    if (s.timer || !this.available) return;
    s.timer = setTimeout(() => this.flush(sid).catch(() => {}), 1500);
    s.timer.unref?.();
  }

  async flush(sid) {
    const s = this.slot(sid);
    clearTimeout(s.timer);
    s.timer = null;
    if (!this.available) { s.dirty.clear(); s.deleted.clear(); return; }
    const keys = [...s.dirty], dels = [...s.deleted];
    s.dirty.clear();
    s.deleted.clear();
    try {
      if (keys.length) {
        await this.request('tanda_data', {
          method: 'POST',
          query: { on_conflict: 'session_id,key' },
          prefer: 'resolution=merge-duplicates,return=minimal',
          body: keys.map(k => ({ session_id: sid, key: k, value: s.data[k] ?? null, updated_at: new Date().toISOString() }))
        });
      }
      for (const k of dels) {
        await this.request('tanda_data', { method: 'DELETE', query: { session_id: `eq.${sid}`, key: `eq.${k}` }, prefer: 'return=minimal' });
      }
    } catch (e) {
      if (this.isMissingTable(e)) { this.markUnavailable(e); return; }
      keys.forEach(k => s.dirty.add(k));
      dels.forEach(k => s.deleted.add(k));
      this.schedule(sid);
    }
  }

  async flushAll() {
    await Promise.all([...this.cache.keys()].map(k => this.flush(k).catch(() => {})));
  }

  export(sid) {
    return structuredClone(this.slot(sid).data);
  }

  async purge(sid) {
    this.cache.delete(sid);
    if (!this.available) return;
    try {
      await this.request('tanda_data', { method: 'DELETE', query: { session_id: `eq.${sid}` }, prefer: 'return=minimal' });
    } catch {}
  }
}

module.exports = { Store };
