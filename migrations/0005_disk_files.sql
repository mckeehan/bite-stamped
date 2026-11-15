-- What each place file in files/ looked like when the server last wrote or
-- checked it, so edits made there (in an editor) are noticed and synced:
-- the rev it holds, and its modification time, size and inode.
CREATE TABLE disk_files (
  path TEXT PRIMARY KEY,
  rev TEXT NOT NULL,
  mtime_ms REAL NOT NULL,
  size INTEGER NOT NULL,
  ino TEXT NOT NULL
);
