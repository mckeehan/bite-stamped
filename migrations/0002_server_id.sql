-- A random id for this server's data. Devices remember it; when it changes
-- (a new or restored server), they upload their copy again and re-download.
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings (key, value) VALUES ('server_id', lower(hex(randomblob(16))));
