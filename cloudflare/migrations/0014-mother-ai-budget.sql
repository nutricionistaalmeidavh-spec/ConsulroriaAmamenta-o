-- Mother AI usage budget, additive and not tied to clinical identity records.
-- One atomic UPSERT per scope; no patient notes or chat messages are stored.
CREATE TABLE IF NOT EXISTS mother_ai_daily_usage (
  day TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('global','owner','mother')),
  scope_id TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0 CHECK(calls >= 0),
  PRIMARY KEY (day,scope,scope_id)
);
CREATE INDEX IF NOT EXISTS mother_ai_daily_usage_day_idx ON mother_ai_daily_usage(day);
