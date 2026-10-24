-- Optional Google Calendar integration. Never stores clinical details or plaintext OAuth tokens.
CREATE TABLE IF NOT EXISTS calendar_google_oauth_states (
  state_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS calendar_google_oauth_states_expiry_idx
  ON calendar_google_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS calendar_google_connections (
  owner_id TEXT PRIMARY KEY,
  tokens_cipher TEXT NOT NULL,
  calendar_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_google_events (
  owner_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, appointment_id)
);
CREATE INDEX IF NOT EXISTS calendar_google_events_owner_idx
  ON calendar_google_events(owner_id, calendar_id);
