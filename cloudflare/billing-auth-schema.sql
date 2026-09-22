PRAGMA foreign_keys = ON;

-- Pro signups are staged entirely in D1 until Asaas confirms payment.
-- Password material uses the same PBKDF2-SHA256 representation as the Cloudflare auth runtime;
-- plaintext passwords and signup nonces are never persisted.
CREATE TABLE IF NOT EXISTS billing_pending_signups (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 210000,
  plan_code TEXT NOT NULL CHECK (plan_code IN ('pro_monthly','pro_annual')),
  signup_nonce_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','activated','cancelled','expired')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TEXT
);
CREATE INDEX IF NOT EXISTS billing_pending_signups_status_idx
  ON billing_pending_signups(status,created_at DESC);
