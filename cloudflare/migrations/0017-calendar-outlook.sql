-- Outlook ICS subscription: separate hashed token per consultant, no Microsoft OAuth.
-- Mirrors cloudflare/runtime-schema.sql and uses safe CREATE IF NOT EXISTS during authorized operations.
CREATE TABLE IF NOT EXISTS calendar_outlook_feeds (
  owner_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
