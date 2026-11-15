// The sync API. Every version of a file is kept (storage.writeVersion); the
// index knows the current rev of each path and numbers every change, so a
// device asks "what changed after number N?". Writes name the rev they are
// based on (If-Match) and fail with 409 when someone else changed it first.

import { json, readBody, randomToken, HttpError } from './http.js';
import { fromMarkdown } from '../app/js/model.js';

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

  // Edits made to place files in files/places/ on the server (in an editor):
  // each changed, new or deleted file becomes a change like one from a
  // device, so devices get it on their next sync. Run before each list of
  // changes (at most every few seconds) and at start. A file that was
  // saved a moment ago may still be being written: next time. One whose
  // header can't be read is left out (and said so in the log).
  const DISK_DIR = 'places/';
  const BY_DISK = 'files/ on the server';
  let lastScan = 0;
  const unreadable = new Map(); // path → the version of it already warned about
  function scanDisk({ force = false } = {}) {
    if (!force && Date.now() - lastScan < 3000) return;
    lastScan = Date.now();
    const onDisk = storage.listCurrent(DISK_DIR).filter((d) => d.path.endsWith('.md') && validPath(d.path));
    const rows = new Map(storage.all('SELECT path, rev, deleted FROM files WHERE path LIKE ?', `${DISK_DIR}%`).map((r) => [r.path, r]));
    const noted = new Map(storage.all('SELECT path, rev, mtime_ms, size, ino FROM disk_files WHERE path LIKE ?', `${DISK_DIR}%`).map((r) => [r.path, r]));
    for (const d of onDisk) {
      const row = rows.get(d.path);
      const note = noted.get(d.path);
      noted.delete(d.path);
      const live = row && !row.deleted;
      if (live && note && note.rev === row.rev && note.mtime_ms === d.mtimeMs && note.size === d.size && note.ino === d.ino) continue;
      if (Date.now() - d.mtimeMs < 2000) continue;
      const bytes = storage.readCurrent(d.path);
      if (!bytes) continue;
      const saved = live ? storage.readVersion(d.path, row.rev) : null;
      if (saved && Buffer.compare(saved, bytes) === 0) {
        // Unchanged (or a hard link from before 2.18.0): a copy of its own from now on.
        storage.setCurrent(d.path, row.rev);
        continue;
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (!/^\uFEFF?---\r?\n/.test(text)) throw new Error('no header (it must start with a line "---")');
        if (!String(fromMarkdown(d.path, text).name ?? '').trim()) throw new Error('no name in the header');
      } catch (e) {
        const seen = `${d.mtimeMs}:${d.size}`;
        if (unreadable.get(d.path) !== seen) console.warn(`[bite-stamped] not syncing files/${d.path}: ${e.message}`);
        unreadable.set(d.path, seen);
        continue;
      }
      unreadable.delete(d.path);
      const rev = newRev();
      storage.writeVersion(d.path, rev, bytes);
      if (commit({ path: d.path, rev, size: bytes.byteLength, type: 'text/markdown', deleted: false, by: BY_DISK }, row?.rev ?? '') === null) {
        storage.dropVersion(d.path, rev);
        continue;
      }
      storage.setCurrent(d.path, rev);
      console.log(`[bite-stamped] ${live ? 'changed' : 'new'} in files/: ${d.path}`);
    }
    // Files that were there and are gone: deleted there. Not when the folder
    // is empty or missing (moved away, or a disk not mounted).
    if (!onDisk.length) return;
    for (const note of noted.values()) {
      const row = rows.get(note.path);
      if (row && !row.deleted && row.rev === note.rev) {
        if (commit({ path: note.path, rev: newRev(), size: 0, type: '', deleted: true, by: BY_DISK }, row.rev) === null) continue;
        console.log(`[bite-stamped] deleted in files/: ${note.path}`);
      }
      storage.clearCurrent(note.path);
    }
  }
  try { scanDisk({ force: true }); } catch (e) { console.warn('[bite-stamped] could not check files/:', e); }

  function changes(url) {
    try { scanDisk(); } catch (e) { console.warn('[bite-stamped] could not check files/:', e); }
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const rows = storage.all('SELECT path, rev, seq, size, type, deleted FROM files WHERE seq > ? ORDER BY seq LIMIT ?', since, PAGE)
      .map((r) => ({ ...r, deleted: !!r.deleted }));
    const server = storage.get("SELECT value FROM settings WHERE key = 'server_id'").value;
    // remaining: changes after `since`, this page's included (for progress).
    const { remaining } = storage.get('SELECT COUNT(*) AS remaining FROM files WHERE seq > ?', since);
    return json({ server, changes: rows, cursor: rows.length ? rows[rows.length - 1].seq : since, more: rows.length === PAGE, remaining });
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

  return { changes, get, put, remove, scanDisk };
}
