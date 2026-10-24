-- Incremental additive migration for Apple Calendar subscribed feeds.
-- This is mirrored in runtime-schema.sql for the canonical D1 deployment.
CREATE TABLE IF NOT EXISTS calendar_apple_feeds (
  owner_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
