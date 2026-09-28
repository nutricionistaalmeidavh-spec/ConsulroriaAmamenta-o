-- Additive recovery state for purchases that have not created an auth user yet.
CREATE TABLE IF NOT EXISTS billing_signup_recovery_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES billing_pending_signups(user_id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
