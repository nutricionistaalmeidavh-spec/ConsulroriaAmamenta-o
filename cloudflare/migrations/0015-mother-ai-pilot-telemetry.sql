-- Pilot is OFF by default. No enrolments are created by this migration.
-- Patient and clinician account identifiers are in this access control table only.
-- Telemetry is strictly aggregate and deliberately contains no identity or raw message columns.
CREATE TABLE IF NOT EXISTS mother_ai_pilot_allowlist (
 owner_id TEXT NOT NULL,
 mother_id TEXT NOT NULL,
 member_user_id TEXT NOT NULL,
 approved_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked_at TEXT,
 PRIMARY KEY(owner_id,mother_id,member_user_id)
);
CREATE INDEX IF NOT EXISTS mother_ai_pilot_user_idx ON mother_ai_pilot_allowlist(member_user_id,expires_at);
CREATE TABLE IF NOT EXISTS mother_ai_pilot_metrics (
 day TEXT NOT NULL,
 event TEXT NOT NULL CHECK(event IN ('reference_answer','clinical_escalation','urgent_escalation','out_of_scope','budget_denied','model_answer','model_error','history_failed')),
 mode TEXT NOT NULL CHECK(mode IN ('free','inference')),
 count INTEGER NOT NULL DEFAULT 0 CHECK(count>=0),
 PRIMARY KEY(day,event,mode)
);
CREATE INDEX IF NOT EXISTS mother_ai_metrics_day_idx ON mother_ai_pilot_metrics(day);
