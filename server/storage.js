// Everything the server keeps, under one data folder:
//   bite-stamped.sqlite     file index, change counter, login codes, sessions,
//                           calendar links
//   versions/<path>/<rev>   every version of every file (the backup history)
//   files/<path>            the current version of each file, as a plain folder
//                           to browse; place files (.md) there can be edited,
//                           and the server syncs the edits (files.js: scanDisk)

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, linkSync, copyFileSync, rmSync, existsSync, createReadStream, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

export function openStorage(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'bite-stamped.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  migrate(db);

  const versionPath = (path, rev) => join(dataDir, 'versions', path, rev);
  const currentPath = (path) => join(dataDir, 'files', path);

  return {
    db,
    dataDir,

    // Plain objects instead of node:sqlite's null-prototype rows.
    get: (sql, ...args) => {
      const row = db.prepare(sql).get(...args);
      return row ? { ...row } : null;
    },
    all: (sql, ...args) => db.prepare(sql).all(...args).map((r) => ({ ...r })),
    run: (sql, ...args) => db.prepare(sql).run(...args),

    // Runs fn inside a write transaction; rolls back if it throws.
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    writeVersion(path, rev, bytes) {
      const target = versionPath(path, rev);
      mkdirSync(dirname(target), { recursive: true });
      const tmp = `${target}.tmp`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, target);
    },
    dropVersion(path, rev) {
      rmSync(versionPath(path, rev), { force: true });
    },
    readVersion(path, rev) {
      try {
        return readFileSync(versionPath(path, rev));
      } catch {
        return null;
      }
    },
    versionStream(path, rev) {
      const file = versionPath(path, rev);
      if (!existsSync(file)) return null;
      return { stream: Readable.toWeb(createReadStream(file)), size: statSync(file).size };
    },

    // Keeps files/ in step with the index. Images are hard links (no extra
    // space); place files are copies, since they may be edited there, and an
    // editor that saves in place would otherwise change the saved version
    // too. What a place file looks like is noted, to notice edits.
    setCurrent(path, rev) {
      const target = currentPath(path);
      mkdirSync(dirname(target), { recursive: true });
      const tmp = `${target}.tmp`;
      rmSync(tmp, { force: true });
      const editable = path.endsWith('.md');
      try {
        if (editable) throw new Error('copy');
        linkSync(versionPath(path, rev), tmp);
      } catch {
        copyFileSync(versionPath(path, rev), tmp);
      }
      renameSync(tmp, target);
      if (editable) {
        const st = statSync(target);
        db.prepare(`INSERT INTO disk_files (path, rev, mtime_ms, size, ino) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET rev = excluded.rev, mtime_ms = excluded.mtime_ms, size = excluded.size, ino = excluded.ino`)
          .run(path, rev, st.mtimeMs, st.size, String(st.ino));
      }
    },
    clearCurrent(path) {
      rmSync(currentPath(path), { force: true });
      db.prepare('DELETE FROM disk_files WHERE path = ?').run(path);
    },
    // The files directly in files/<dir> (e.g. 'places/'), with their size,
    // modification time and inode; [] if there is no such folder.
    listCurrent(dir) {
      let names;
      try { names = readdirSync(currentPath(dir), { withFileTypes: true }); } catch { return []; }
      return names.filter((d) => d.isFile()).map((d) => {
        const path = `${dir}${d.name}`;
        try {
          const st = statSync(currentPath(path));
          return { path, mtimeMs: st.mtimeMs, size: st.size, ino: String(st.ino) };
        } catch {
          return null;
        }
      }).filter(Boolean);
    },
    readCurrent(path) {
      try {
        return readFileSync(currentPath(path));
      } catch {
        return null;
      }
    },

    close: () => db.close(),
  };
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
