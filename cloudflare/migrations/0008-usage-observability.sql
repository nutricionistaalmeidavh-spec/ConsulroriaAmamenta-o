CREATE TABLE IF NOT EXISTS user_presence (
  user_id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  current_session_id TEXT,
  last_heartbeat_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_usage_daily (
  user_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  session_count INTEGER NOT NULL DEFAULT 0 CHECK (session_count >= 0),
  active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS user_presence_last_seen_idx
  ON user_presence(last_seen_at DESC, user_id);
CREATE INDEX IF NOT EXISTS user_sessions_user_started_idx
  ON user_sessions(user_id, started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS user_sessions_started_idx
  ON user_sessions(started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS user_usage_daily_date_idx
  ON user_usage_daily(usage_date DESC, user_id);
CREATE INDEX IF NOT EXISTS auth_users_created_at_observability_idx
  ON auth_users(created_at DESC, user_id);
CREATE INDEX IF NOT EXISTS auth_users_last_sign_in_observability_idx
  ON auth_users(last_sign_in_at DESC, user_id);
CREATE INDEX IF NOT EXISTS billing_checkout_observability_idx
  ON billing_checkout_requests(provider, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS subscriptions_observability_idx
  ON subscriptions(provider, status, plan_code, updated_at DESC, owner_id);
