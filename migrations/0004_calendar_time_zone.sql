-- The time zone visit times are in (IANA name, e.g. America/New_York), from
-- the device that made the link; '' = the server's own time zone.
ALTER TABLE calendar_feeds ADD COLUMN time_zone TEXT NOT NULL DEFAULT '';
