// The app's files live in IndexedDB as a flat path → content table, so they
// are available offline. Content is kept as bytes plus a media type; the
// Markdown files are UTF-8 text. Export writes the same paths into a ZIP.

const DB_NAME = 'eats';
const STORE = 'files';
let dbPromise;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'path' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const textTypes = /^text\/|json|yaml/;

export async function writeFile(path, data, type) {
  let bytes;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data).buffer;
    type ??= 'text/markdown';
  } else if (data instanceof Uint8Array) {
    bytes = data.slice().buffer;
  } else {
    bytes = await data.arrayBuffer();
    type ??= data.type;
  }
  await tx('readwrite', (s) => s.put({ path, bytes, type: type || guessType(path), mtime: Date.now() }));
}

export async function readText(path) {
  const rec = await tx('readonly', (s) => s.get(path));
  return rec ? new TextDecoder().decode(rec.bytes) : undefined;
}

export async function readBlob(path) {
  const rec = await tx('readonly', (s) => s.get(path));
  return rec ? new Blob([rec.bytes], { type: rec.type }) : undefined;
}

// All records under a prefix: [{ path, bytes, type, mtime }]
export async function listFiles(prefix = '') {
  const range = prefix ? IDBKeyRange.bound(prefix, prefix + '￿') : undefined;
  return tx('readonly', (s) => s.getAll(range));
}

export async function deleteFile(path) {
  await tx('readwrite', (s) => s.delete(path));
}

export async function deletePrefix(prefix) {
  await tx('readwrite', (s) => s.delete(IDBKeyRange.bound(prefix, prefix + '￿')));
}

export async function clearAll() {
  await tx('readwrite', (s) => s.clear());
}

export function isText(type) {
  return textTypes.test(type || '');
}

export function guessType(path) {
  const ext = path.split('.').pop().toLowerCase();
  return {
    md: 'text/markdown', txt: 'text/plain', json: 'application/json', yaml: 'text/yaml', yml: 'text/yaml',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    heic: 'image/heic', avif: 'image/avif',
  }[ext] || 'application/octet-stream';
}
