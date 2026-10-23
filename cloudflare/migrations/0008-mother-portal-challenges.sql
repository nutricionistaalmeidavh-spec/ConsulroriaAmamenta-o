-- Isolated proof-of-email flow for mother portal. Additive migration; no changes to clinical identities.
CREATE TABLE IF NOT EXISTS member_portal_challenges (
  user_id TEXT PRIMARY KEY,
  access_id TEXT NOT NULL,
  email TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS member_portal_challenges_expires_idx
  ON member_portal_challenges(expires_at);
CREATE INDEX IF NOT EXISTS supabase_records_member_claim_idx
  ON supabase_records(table_name, json_extract(record_json,'$.member_user_id'));
