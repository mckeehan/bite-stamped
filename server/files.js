// The sync API. Every version of a file is kept (storage.writeVersion); the
// index knows the current rev of each path and numbers every change, so a
// device asks "what changed after number N?". Writes name the rev they are
// based on (If-Match) and fail with 409 when someone else changed it first.

import { json, readBody, randomToken, HttpError } from './http.js';

const MAX_BYTES = 25 * 1024 * 1024;
const PAGE = 500;

export function validPath(path) {
  return typeof path === 'string'
    && path.length <= 300
    && /^(places|restaurants|media)\//.test(path) // restaurants/: before 2.0.0
    && !/[\0\\]/.test(path)
    && path.split('/').every((part) => part && part !== '.' && part !== '..' && !part.endsWith('.tmp'));
}

function checkPath(path) {
  if (!validPath(path)) throw new HttpError(400, { error: 'Invalid path' });
}

function typeByExtension(path) {
  const ext = path.split('.').pop().toLowerCase();
  return { md: 'text/markdown', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic' }[ext]
    || 'application/octet-stream';
}

const newRev = () =>`${Date.now().toString(36)}-${randomToken(6)}`;

// If-Match: "<rev>" for a file the device has a version of; none for a new one.
function baseRev(request) {
  const m = (request.headers.get('If-Match') || '').match(/^"?([^"]*)"?$/);
  return m && m[1] ? m[1] : '';
}

export function createFiles({ storage }) {
  const current = (path) => {
    const row = storage.get('SELECT path, rev, seq, size, type, deleted FROM files WHERE path = ?', path);
    return row ? { ...row, deleted: !!row.deleted } : null;
  };

  // Writes the new row only when the stored rev is still `base` ('' = no row yet).
  function commit(row, base) {
    return storage.transaction(() => {
      if ((current(row.path)?.rev ?? '') !== base) return null;
      storage.run('UPDATE counter SET seq = seq + 1 WHERE id = 1');
      const { seq } = storage.get('SELECT seq FROM counter WHERE id = 1');
      storage.run(
        `INSERT INTO files (path, rev, seq, size, type, deleted, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET rev = excluded.rev, seq = excluded.seq, size = excluded.size, type = excluded.type,
           deleted = excluded.deleted, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        row.path, row.rev, seq, row.size, row.type, row.deleted ? 1 : 0, new Date().toISOString(), row.by,
      );
      return seq;
    });
  }

  function changes(url) {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const rows = storage.all('SELECT path, rev, seq, size, type, deleted FROM files WHERE seq > ? ORDER BY seq LIMIT ?', since, PAGE)
      .map((r) => ({ ...r, deleted: !!r.deleted }));
    const server = storage.get("SELECT value FROM settings WHERE key = 'server_id'").value;
    return json({ server, changes: rows, cursor: rows.length ? rows[rows.length - 1].seq : since, more: rows.length === PAGE });
  }

  function get(path, rev) {
    checkPath(path);
    const row = current(path);
    if (!rev) {
      if (!row || row.deleted) throw new HttpError(404, { error: 'Not found' });
      rev = row.rev;
    }
    if (!/^[\w-]+$/.test(rev)) throw new HttpError(400, { error: 'Invalid rev' });
    // The index has the type of the current version; older ones go by extension.
    const type = (row?.rev === rev && row.type) || typeByExtension(path);
    const found = storage.versionStream(path, rev);
    if (!found) throw new HttpError(404, { error: 'Not found' });
    return new Response(found.stream, {
      headers: {
        'Content-Type': type,
        'Content-Length': String(found.size),
        ETag: `"${rev}"`,
        // A rev's bytes never change.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  }

  async function put(request, path, user) {
    checkPath(path);
    const bytes = await readBody(request, MAX_BYTES);
    const base = baseRev(request);
    const rev = newRev();
    const type = (request.headers.get('Content-Type') || 'application/octet-stream').slice(0, 100);

    // Bytes first, so a device that sees the new rev can always fetch it.
    storage.writeVersion(path, rev, bytes);
    const seq = commit({ path, rev, size: bytes.byteLength, type, deleted: false, by: user.email }, base);
    if (seq === null) {
      storage.dropVersion(path, rev);
      throw new HttpError(409, { error: 'Changed elsewhere', current: current(path) });
    }
    storage.setCurrent(path, rev);
    return json({ rev, seq });
  }

  // Marks the file deleted; its earlier versions stay on disk as a backup.
  function remove(request, path, user) {
    checkPath(path);
    const now = current(path);
    if (!now) return json({ rev: null, seq: null });
    if (now.deleted) return json({ rev: now.rev, seq: now.seq });
    const rev = newRev();
    const seq = commit({ path, rev, size: 0, type: '', deleted: true, by: user.email }, baseRev(request));
    if (seq === null) throw new HttpError(409, { error: 'Changed elsewhere', current: current(path) });
    storage.clearCurrent(path);
    return json({ rev, seq });
  }

  return { changes, get, put, remove };
}
