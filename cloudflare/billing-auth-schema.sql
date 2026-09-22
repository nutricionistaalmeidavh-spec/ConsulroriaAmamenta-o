PRAGMA foreign_keys = ON;

-- Pro signups stay in D1 until Asaas confirms payment.
-- Passwords use the same PBKDF2-SHA256 representation as the Cloudflare auth runtime.
CREATE TABLE IF NOT EXISTS billing_pending_signups (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  plan_code TEXT NOT NULL CHECK (plan_code IN ('pro_monthly','pro_annual')),
  signup_nonce_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','activated','cancelled','expired')),
  payment_confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TEXT
);
CREATE INDEX IF NOT EXISTS billing_pending_signups_status_idx
  ON billing_pending_signups(status,created_at DESC);
