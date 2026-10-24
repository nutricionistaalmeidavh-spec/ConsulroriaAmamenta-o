-- Additive table for an opt-in disclosure of patient names to external calendar accounts.
-- Defaults to anonymous; owned by one consultant, not global.
CREATE TABLE IF NOT EXISTS calendar_event_display_preferences (
  owner_id TEXT PRIMARY KEY,
  show_patient_name INTEGER NOT NULL DEFAULT 0 CHECK (show_patient_name IN (0,1)),
  updated_at TEXT NOT NULL
);
