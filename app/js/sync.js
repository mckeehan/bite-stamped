// Offline-first sync with the Bite-Stamped server. The device's own copy is always
// what the app shows; this module, whenever it can reach the server,
//   1. uploads files changed here (each based on the version it last saw;
//      when someone else changed it first, the two versions are merged), then
//   2. downloads what changed elsewhere since the last sync (a cursor).
// The store and fetch are passed in, so tests can run two "devices" against
// the Worker without a browser.

import { mergeMarkdown } from './model.js';

class SignedOut extends Error {}

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');
const decode = (bytes) => new TextDecoder().decode(bytes);

export function createSync({ store, fetch: doFetch = (...a) => fetch(...a), base = '', onRemoteChange = () => {}, onState = () => {} }) {
  const state = { status: 'idle', email: null, lastSync: null, pending: 0, error: '', fallbackSearch: false };
  let running = null;
  let again = false;

  const set = (patch) => {
    Object.assign(state, patch);
    onState({ ...state });
  };

  async function api(path, opts = {}) {
    const res = await doFetch(base + path, {
      credentials: 'same-origin',
      ...opts,
      headers: { 'X-Bite-Stamped': '1', ...(opts.headers || {}) },
    });
    if (res.status === 401) throw new SignedOut();
    return res;
  }

  async function fetchFile(path, rev) {
    const res = await api(`/api/files/${encodePath(path)}?rev=${encodeURIComponent(rev)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function pushOne(rec, attempt = 0) {
    const headers = rec.rev ? { 'If-Match': `"${rec.rev}"` } : {};
    const url = `/api/files/${encodePath(rec.path)}`;
    const res = rec.deleted
      ? await api(url, { method: 'DELETE', headers })
      : await api(url, { method: 'PUT', headers: { ...headers, 'Content-Type': rec.type || 'application/octet-stream' }, body: rec.bytes });

    if (res.ok) {
      const { rev } = await res.json();
      await store.markSynced(rec.path, rec.mtime, rev);
      return;
    }
    if (res.status === 409 && attempt < 3) {
      const { current } = await res.json();
      await resolveConflict(rec, current);
      const next = await store.getRecord(rec.path);
      if (next?.dirty) await pushOne(next, attempt + 1);
      return;
    }
    throw new Error(`Upload of ${rec.path} failed (${res.status})`);
  }

  async function resolveConflict(rec, current) {
    if (!current) return store.rebase(rec.path, rec.mtime, null);
    if (rec.deleted) {
      // Deleted here, but changed elsewhere after that: keep the newer version.
      if (current.deleted) return store.markSynced(rec.path, rec.mtime, current.rev);
      const bytes = await fetchFile(rec.path, current.rev);
      if (bytes) await store.applyRemote(rec.path, bytes, current.type, current.rev, rec.mtime);
      return;
    }
    // Deleted elsewhere, changed here: the change wins.
    if (current.deleted) return store.rebase(rec.path, rec.mtime, current.rev);
    const remote = await fetchFile(rec.path, current.rev);
    if (!remote) return store.rebase(rec.path, rec.mtime, current.rev);
    if (rec.path.endsWith('.md')) {
      const merged = mergeMarkdown(rec.path, decode(rec.bytes), decode(remote));
      await store.rebase(rec.path, rec.mtime, current.rev, new TextEncoder().encode(merged).buffer);
      onRemoteChange();
    } else {
      // Two different images under one name (practically never: names are random).
      await store.applyRemote(rec.path, remote, current.type, current.rev, rec.mtime);
      onRemoteChange();
    }
  }

  async function push() {
    const dirty = await store.listDirty();
    // Images before the Markdown that refers to them.
    dirty.sort((a, b) => Number(a.path.endsWith('.md')) - Number(b.path.endsWith('.md')));
    set({ pending: dirty.length });
    for (const rec of dirty) {
      await pushOne(rec);
      set({ pending: state.pending - 1 });
    }
  }

  async function pull() {
    let cursor = (await store.getMeta('cursor')) || 0;
    let changed = false;
    for (;;) {
      const res = await api(`/api/changes?since=${cursor}`);
      if (!res.ok) throw new Error(`Sync failed (${res.status})`);
      const page = await res.json();
      for (const c of page.changes) {
        const local = await store.getRecord(c.path);
        if (local?.dirty) continue; // uploaded next, merged if needed
        if (c.deleted) {
          if (local) { await store.removeRemote(c.path); changed = true; }
        } else if (!local || local.rev !== c.rev) {
          const bytes = await fetchFile(c.path, c.rev);
          if (bytes) {
            await store.applyRemote(c.path, bytes, c.type, c.rev, local ? local.mtime : null);
            changed = true;
          }
        }
      }
      cursor = page.cursor;
      await store.setMeta('cursor', cursor);
      if (!page.more) break;
    }
    if (changed) onRemoteChange();
  }

  // A different server id means new or restored server data: what this
  // device knows about server versions no longer holds, so it uploads its
  // whole copy again (merging with anything already there) and re-downloads.
  async function checkServer() {
    const res = await api('/api/changes?since=9007199254740991');
    if (!res.ok) throw new Error(`Sync failed (${res.status})`);
    const { server } = await res.json();
    const known = await store.getMeta('server');
    if (known === server) return;
    if (known || (await store.getMeta('cursor'))) await store.resetSync();
    await store.setMeta('server', server);
  }

  async function run() {
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (!online) return set({ status: 'offline', pending: (await store.listDirty()).length });
    if (!state.email) return set({ status: 'signed-out', pending: (await store.listDirty()).length });
    set({ status: 'syncing', error: '' });
    try {
      await checkServer();
      await push();
      await pull();
      const lastSync = new Date().toISOString();
      await store.setMeta('lastSync', lastSync);
      set({ status: 'idle', lastSync, pending: (await store.listDirty()).length });
    } catch (e) {
      if (e instanceof SignedOut) {
        await store.setMeta('account', null);
        set({ status: 'signed-out', email: null });
      } else {
        const offline = e instanceof TypeError; // fetch could not reach the server
        set({ status: offline ? 'offline' : 'error', error: offline ? '' : e.message, pending: (await store.listDirty()).length });
      }
    }
  }

  // Runs a sync; calls while one is running make it run once more afterwards.
  async function sync() {
    if (running) { again = true; return running; }
    running = (async () => {
      do { again = false; await run(); } while (again);
    })();
    try { await running; } finally { running = null; }
  }

  async function init() {
    set({ email: (await store.getMeta('account')) || null, lastSync: (await store.getMeta('lastSync')) || null });
    try {
      const res = await doFetch(`${base}/api/auth/me`, { credentials: 'same-origin' });
      if (res.ok) {
        // fallbackSearch: the server offers /api/places/search to this account.
        const { email, fallbackSearch } = await res.json();
        await store.setMeta('account', email);
        set({ email, fallbackSearch: Boolean(fallbackSearch) });
      }
    } catch {
      // offline: keep the remembered account
    }
  }

  async function postJSON(path, body) {
    const res = await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  return {
    state,
    init,
    sync,
    sendCode: (email) => postJSON('/api/auth/start', { email }),
    async verify(email, code, device = '') {
      const data = await postJSON('/api/auth/verify', { email, code, device });
      await store.setMeta('account', data.email);
      set({ email: data.email, status: 'idle' });
      await init(); // learns what the server offers this account
      await sync();
      return data;
    },
    async signOut() {
      try { await postJSON('/api/auth/logout', {}); } catch {}
      await store.setMeta('account', null);
      set({ email: null, status: 'signed-out', fallbackSearch: false });
    },
  };
}
