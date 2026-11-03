// Everything the server keeps, under one data folder:
//   eats.sqlite        file index, change counter, login codes, sessions
//   versions/<path>/<rev>  every version of every file (the backup history)
//   files/<path>       the current version of each file, as a plain folder
//                      you can back up or browse (read-only: edits there
//                      are not synced)

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, linkSync, copyFileSync, rmSync, existsSync, createReadStream, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

export function openStorage(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'eats.sqlite'));
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
    versionStream(path, rev) {
      const file = versionPath(path, rev);
      if (!existsSync(file)) return null;
      return { stream: Readable.toWeb(createReadStream(file)), size: statSync(file).size };
    },

    // Keeps files/ in step with the index (a hard link, so no extra space).
    setCurrent(path, rev) {
      const target = currentPath(path);
      mkdirSync(dirname(target), { recursive: true });
      const tmp = `${target}.tmp`;
      rmSync(tmp, { force: true });
      try {
        linkSync(versionPath(path, rev), tmp);
      } catch {
        copyFileSync(versionPath(path, rev), tmp);
      }
      renameSync(tmp, target);
    },
    clearCurrent(path) {
      rmSync(currentPath(path), { force: true });
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
