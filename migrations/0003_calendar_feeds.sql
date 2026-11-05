-- A private link per account to the visits as an iCalendar feed. Calendar
-- apps can't sign in, so the token in the link is the key; making a new link
-- replaces it, and the old one stops working.
CREATE TABLE calendar_feeds (
  email TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
