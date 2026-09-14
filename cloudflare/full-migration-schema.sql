PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS migration_runs (
  run_id TEXT PRIMARY KEY,
  source_project_ref TEXT NOT NULL,
  source_snapshot_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared','importing','validated','failed')),
  source_table_count INTEGER NOT NULL DEFAULT 0,
  source_row_count INTEGER NOT NULL DEFAULT 0,
  source_user_count INTEGER NOT NULL DEFAULT 0,
  source_object_count INTEGER NOT NULL DEFAULT 0,
  notes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_tables (
  table_name TEXT PRIMARY KEY,
  row_count INTEGER NOT NULL DEFAULT 0,
  snapshot_sha256 TEXT,
  migrated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Lossless copy of every table exposed through the Supabase public REST schema.
-- Rows stay JSON-shaped so no clinical field is discarded while the Cloudflare
-- domain model is evolved independently.
CREATE TABLE IF NOT EXISTS supabase_records (
  table_name TEXT NOT NULL,
  record_key TEXT NOT NULL,
  owner_id TEXT,
  record_json TEXT NOT NULL,
  source_created_at TEXT,
  source_updated_at TEXT,
  migrated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (table_name, record_key)
);
CREATE INDEX IF NOT EXISTS supabase_records_table_owner_idx
  ON supabase_records(table_name, owner_id);
CREATE INDEX IF NOT EXISTS supabase_records_owner_idx
  ON supabase_records(owner_id);

-- Auth users can be copied as identity metadata, but existing passwords are not
-- exportable. password_reset_required intentionally remains true after import.
CREATE TABLE IF NOT EXISTS auth_users (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  phone TEXT,
  email_confirmed_at TEXT,
  phone_confirmed_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  last_sign_in_at TEXT,
  user_metadata_json TEXT NOT NULL DEFAULT '{}',
  app_metadata_json TEXT NOT NULL DEFAULT '{}',
  password_reset_required INTEGER NOT NULL DEFAULT 1 CHECK (password_reset_required IN (0,1)),
  migrated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_idx
  ON auth_users(email) WHERE email IS NOT NULL;

-- Metadata index for objects copied from Supabase Storage to R2. The actual
-- bytes live in the private R2 bucket; nothing is made public by this schema.
CREATE TABLE IF NOT EXISTS storage_objects (
  source_bucket TEXT NOT NULL,
  source_path TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER,
  mime_type TEXT,
  source_created_at TEXT,
  source_updated_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  migrated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_bucket, source_path)
);
CREATE UNIQUE INDEX IF NOT EXISTS storage_objects_r2_key_idx
  ON storage_objects(r2_key);

CREATE TABLE IF NOT EXISTS migration_validation (
  run_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  source_count INTEGER NOT NULL,
  target_count INTEGER NOT NULL,
  matches INTEGER NOT NULL CHECK (matches IN (0,1)),
  details_json TEXT NOT NULL DEFAULT '{}',
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, scope),
  FOREIGN KEY (run_id) REFERENCES migration_runs(run_id) ON DELETE CASCADE
);
