-- Leases are recoverable after an interrupted Worker, without releasing an
-- in-flight payment to a concurrent handler. No credentials live here.
CREATE TABLE IF NOT EXISTS billing_processing_claims (
  claim_key TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_reconciliation_schedule (
  checkout_request_id TEXT PRIMARY KEY REFERENCES billing_checkout_requests(id) ON DELETE CASCADE,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS billing_reconciliation_due_idx ON billing_reconciliation_schedule(next_attempt_at);
