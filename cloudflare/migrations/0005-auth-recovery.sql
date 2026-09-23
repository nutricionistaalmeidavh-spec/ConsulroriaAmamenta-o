-- Additive only. Apply separately after review; never re-run a data import.
CREATE TABLE IF NOT EXISTS auth_recovery_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES auth_users(user_id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
