// The app's files live in IndexedDB as a flat path → content table, so they
// are available offline. Content is kept as bytes plus a media type; the
// Markdown files are UTF-8 text. Export writes the same paths into a ZIP.
//
// For sync, each record also remembers the server version it matches (`rev`)
// and whether it changed here since (`dirty`). A deleted file that the server
// knows about stays behind as a tombstone (`deleted`) until the deletion is
// synced. The `meta` table holds sync state such as the change cursor.

const DB_NAME = 'bite-stamped';
const STORE = 'files';
const META = 'meta';
let dbPromise;
const listeners = new Set();

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const d = req.result;
      if (e.oldVersion < 1) d.createObjectStore(STORE, { keyPath: 'path' });
      if (e.oldVersion < 2) {
        d.createObjectStore(META);
        // Files from before sync existed have never been uploaded.
        if (e.oldVersion >= 1) {
          const files = req.transaction.objectStore(STORE);
          files.openCursor().onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) return;
            cursor.update({ ...cursor.value, rev: null, dirty: true, deleted: false });
            cursor.continue();
          };
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(storeName, mode);
    const result = fn(t.objectStore(storeName));
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const getRecord = (path) => tx(STORE, 'readonly', (s) => s.get(path));
const changed = () => listeners.forEach((fn) => fn());

// Strictly increasing, so the sync engine can tell two quick edits apart.
let lastMtime = 0;
const nextMtime = () => (lastMtime = Math.max(Date.now(), lastMtime + 1));

// Called after every local change (the sync engine uses it to schedule a sync).
export function onLocalChange(fn) {
  listeners.add(fn);
}

async function toBytes(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data).buffer;
  if (data instanceof Uint8Array) return data.slice().buffer;
  if (data instanceof ArrayBuffer) return data.slice(0);
  return data.arrayBuffer();
}

export async function writeFile(path, data, type) {
  const bytes = await toBytes(data);
  type ??= typeof data === 'string' ? 'text/markdown' : data.type;
  const old = await getRecord(path);
  await tx(STORE, 'readwrite', (s) => s.put({
    path, bytes, type: type || guessType(path), mtime: nextMtime(), rev: old?.rev ?? null, dirty: true, deleted: false,
  }));
  changed();
}

export async function readText(path) {
  const rec = await getRecord(path);
  return rec && !rec.deleted ? new TextDecoder().decode(rec.bytes) : undefined;
}

export async function readBlob(path) {
  const rec = await getRecord(path);
  return rec && !rec.deleted ? new Blob([rec.bytes], { type: rec.type }) : undefined;
}

// Live (not deleted) records under a prefix: [{ path, bytes, type, mtime, … }]
export async function listFiles(prefix = '') {
  const range = prefix ? IDBKeyRange.bound(prefix, prefix + '￿') : undefined;
  return (await tx(STORE, 'readonly', (s) => s.getAll(range))).filter((r) => !r.deleted);
}

function tombstone(s, rec) {
  if (rec.rev) s.put({ path: rec.path, bytes: null, type: '', mtime: nextMtime(), rev: rec.rev, dirty: true, deleted: true });
  else s.delete(rec.path);
}

export async function deleteFile(path) {
  const rec = await getRecord(path);
  if (!rec || rec.deleted) return;
  await tx(STORE, 'readwrite', (s) => tombstone(s, rec));
  changed();
}

export async function deletePrefix(prefix) {
  const recs = await listFiles(prefix);
  if (!recs.length) return;
  await tx(STORE, 'readwrite', (s) => recs.forEach((rec) => tombstone(s, rec)));
  changed();
}

// Forgets everything on this device, including sync state. If the device is
// signed in, the next sync downloads everything again.
export async function clearAll() {
  await tx(STORE, 'readwrite', (s) => s.clear());
  await tx(META, 'readwrite', (s) => s.delete('cursor'));
}

// --- for the sync engine ---

export { getRecord };

export async function listDirty() {
  return (await tx(STORE, 'readonly', (s) => s.getAll())).filter((r) => r.dirty);
}

// Runs fn(record, store) inside one read-write transaction.
function update(path, fn) {
  return tx(STORE, 'readwrite', (s) => {
    const req = s.get(path);
    req.onsuccess = () => fn(req.result, s);
  });
}

// Stores a version that came from the server. With `expectedMtime` (null for
// "no local file"), nothing happens if the local file changed in the meantime.
export async function applyRemote(path, bytes, type, rev, expectedMtime) {
  await update(path, (rec, s) => {
    if (expectedMtime !== undefined && (rec?.mtime ?? null) !== expectedMtime) return;
    s.put({ path, bytes, type, mtime: nextMtime(), rev, dirty: false, deleted: false });
  });
}

export async function removeRemote(path) {
  await tx(STORE, 'readwrite', (s) => s.delete(path));
}

// After a conflict: the local version (unchanged since `mtime`) is now based
// on the server's `rev`, optionally with merged content. It stays dirty.
export async function rebase(path, mtime, rev, bytes) {
  await update(path, (rec, s) => {
    if (!rec || rec.mtime !== mtime) return;
    s.put(bytes ? { ...rec, bytes, rev, dirty: true, deleted: false, mtime: nextMtime() } : { ...rec, rev, dirty: true });
  });
}

// Records that the version with this mtime is now on the server as `rev`.
// If the file changed again meanwhile, it stays dirty (with the new base rev).
export async function markSynced(path, mtime, rev) {
  await update(path, (rec, s) => {
    if (!rec) return;
    if (rec.deleted && rec.mtime === mtime) s.delete(path);
    else s.put({ ...rec, rev, dirty: rec.mtime !== mtime });
  });
}

// Forgets all server versions: every live file is uploaded again on the next
// sync, unsynced deletions are dropped, and everything is downloaded again.
export async function resetSync() {
  const all = await tx(STORE, 'readonly', (s) => s.getAll());
  await tx(STORE, 'readwrite', (s) => {
    for (const rec of all) {
      if (rec.deleted) s.delete(rec.path);
      else s.put({ ...rec, rev: null, dirty: true, mtime: nextMtime() });
    }
  });
  await tx(META, 'readwrite', (s) => s.delete('cursor'));
}

export const getMeta = (key) => tx(META, 'readonly', (s) => s.get(key));
export const setMeta = (key, value) => tx(META, 'readwrite', (s) => s.put(value, key));

export function isText(type) {
  return /^text\/|json|yaml/.test(type || '');
}

export function guessType(path) {
  const ext = path.split('.').pop().toLowerCase();
  return {
    md: 'text/markdown', txt: 'text/plain', json: 'application/json', yaml: 'text/yaml', yml: 'text/yaml',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    heic: 'image/heic', avif: 'image/avif',
  }[ext] || 'application/octet-stream';
}
