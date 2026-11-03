-- One row per file path. `rev` names the current version; its bytes are in
-- R2 at `files/<path>/<rev>`. Deleted files keep their row (deleted = 1) so
-- other devices learn about the deletion, and their old versions stay in R2.
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  rev TEXT NOT NULL,
  seq INTEGER NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX files_seq ON files (seq);

-- Every change gets the next number; devices ask for changes after the last one they saw.
CREATE TABLE counter (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL);
INSERT INTO counter (id, seq) VALUES (1, 0);

CREATE TABLE login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  device TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
