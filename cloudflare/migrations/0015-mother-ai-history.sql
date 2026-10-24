-- Phase 6: private, explicitly saved chat history, automatically expires after 30 days.
-- A shared answer is exposed to the professional only while shared_at is non-null.
-- No health records, auth identities, or shared clinical canonical tables are modified.
CREATE TABLE IF NOT EXISTS mother_ai_history (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  mother_id TEXT NOT NULL,
  member_user_id TEXT NOT NULL,
  question TEXT NOT NULL CHECK(length(question) BETWEEN 4 AND 500),
  answer TEXT NOT NULL CHECK(length(answer) <= 1800),
  classification TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  feedback TEXT CHECK(feedback IS NULL OR feedback IN ('helpful','not_helpful')),
  shared_at TEXT
);
CREATE INDEX IF NOT EXISTS mother_ai_history_mother_idx ON mother_ai_history(owner_id,mother_id,member_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS mother_ai_history_consultant_idx ON mother_ai_history(owner_id,mother_id,shared_at);
CREATE INDEX IF NOT EXISTS mother_ai_history_expiry_idx ON mother_ai_history(expires_at);