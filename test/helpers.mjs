// Test doubles: the real server (createApp) on a temporary data folder, a
// fetch that sends one device's requests to it (keeping that device's cookie),
// and a device's IndexedDB store in memory (same rules as app/js/store.js).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { createApp } from '../server/app.js';

export function testServer(overrides = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'bite-stamped-test-'));
  const codes = new Map();
  const config = {
    dataDir,
    allowedEmails: ['me@example.com', 'partner@example.com'],
    sendCode: async (email, code) => { codes.set(email, code); },
    ...overrides,
  };
  const app = createApp(config);
  after(() => { app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return { app, config, codes, dataDir };
}

// A fetch for one device: keeps its cookie, talks to the server directly.
export function deviceFetch(app, origin = 'https://bite-stamped.test') {
  let cookie = '';
  return async (url, opts = {}) => {
    const headers = new Headers(opts.headers || {});
    if (cookie) headers.set('Cookie', cookie);
    const body = opts.body instanceof ArrayBuffer ? new Uint8Array(opts.body) : opts.body;
    const req = new Request(new URL(url, origin), { method: opts.method || 'GET', headers, body });
    const res = await app.handle(req, '203.0.113.1');
    const set = res.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return res;
  };
}

// In-memory version of app/js/store.js (same rules for rev / dirty / deleted).
export function memoryStore() {
  const files = new Map();
  const meta = new Map();
  let last = 0;
  const next = () => (last = Math.max(Date.now(), last + 1));
  const enc = (s) => new TextEncoder().encode(s).buffer;
  return {
    files,
    async writeFile(path, data, type = 'text/markdown') {
      const old = files.get(path);
      files.set(path, { path, bytes: typeof data === 'string' ? enc(data) : data, type, mtime: next(), rev: old?.rev ?? null, dirty: true, deleted: false });
    },
    async deleteFile(path) {
      const rec = files.get(path);
      if (!rec || rec.deleted) return;
      if (rec.rev) files.set(path, { path, bytes: null, type: '', mtime: next(), rev: rec.rev, dirty: true, deleted: true });
      else files.delete(path);
    },
    readText: async (path) => {
      const r = files.get(path);
      return r && !r.deleted ? new TextDecoder().decode(r.bytes) : undefined;
    },
    live: () => [...files.values()].filter((r) => !r.deleted).map((r) => r.path).sort(),
    getRecord: async (path) => (files.has(path) ? { ...files.get(path) } : undefined),
    listDirty: async () => [...files.values()].filter((r) => r.dirty).map((r) => ({ ...r })),
    async applyRemote(path, bytes, type, rev, expectedMtime) {
      if (expectedMtime !== undefined && (files.get(path)?.mtime ?? null) !== expectedMtime) return;
      files.set(path, { path, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), type, mtime: next(), rev, dirty: false, deleted: false });
    },
    removeRemote: async (path) => { files.delete(path); },
    async rebase(path, mtime, rev, bytes) {
      const rec = files.get(path);
      if (!rec || rec.mtime !== mtime) return;
      files.set(path, bytes ? { ...rec, bytes, rev, dirty: true, deleted: false, mtime: next() } : { ...rec, rev, dirty: true });
    },
    async markSynced(path, mtime, rev) {
      const rec = files.get(path);
      if (!rec) return;
      if (rec.deleted && rec.mtime === mtime) files.delete(path);
      else files.set(path, { ...rec, rev, dirty: rec.mtime !== mtime });
    },
    async resetSync() {
      for (const [path, rec] of files) {
        if (rec.deleted) files.delete(path);
        else files.set(path, { ...rec, rev: null, dirty: true, mtime: next() });
      }
      meta.delete('cursor');
    },
    getMeta: async (k) => meta.get(k),
    setMeta: async (k, v) => { meta.set(k, v); },
  };
}
