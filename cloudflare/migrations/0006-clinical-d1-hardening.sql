PRAGMA foreign_keys = ON;

-- Backfill explicit ownership from JSON when the source row already carries it.
UPDATE supabase_records
SET owner_id = json_extract(record_json,'$.owner_id')
WHERE owner_id IS NULL
  AND json_extract(record_json,'$.owner_id') IS NOT NULL;

-- Backfill relational ownership from the canonical parent rows. These updates are
-- additive and only fill owner_id when it is currently NULL.
UPDATE supabase_records AS child
SET owner_id = (
  SELECT parent.owner_id
  FROM supabase_records AS parent
  WHERE parent.table_name = 'mothers'
    AND parent.owner_id IS NOT NULL
    AND (parent.record_key = json_extract(child.record_json,'$.mother_id')
      OR json_extract(parent.record_json,'$.id') = json_extract(child.record_json,'$.mother_id'))
  LIMIT 1
)
WHERE child.owner_id IS NULL
  AND json_extract(child.record_json,'$.mother_id') IS NOT NULL;

UPDATE supabase_records AS child
SET owner_id = (
  SELECT parent.owner_id
  FROM supabase_records AS parent
  WHERE parent.table_name = 'babies'
    AND parent.owner_id IS NOT NULL
    AND (parent.record_key = json_extract(child.record_json,'$.baby_id')
      OR json_extract(parent.record_json,'$.id') = json_extract(child.record_json,'$.baby_id'))
  LIMIT 1
)
WHERE child.owner_id IS NULL
  AND json_extract(child.record_json,'$.baby_id') IS NOT NULL;

UPDATE supabase_records AS child
SET owner_id = (
  SELECT parent.owner_id
  FROM supabase_records AS parent
  WHERE parent.table_name = 'appointments'
    AND parent.owner_id IS NOT NULL
    AND (parent.record_key = json_extract(child.record_json,'$.appointment_id')
      OR json_extract(parent.record_json,'$.id') = json_extract(child.record_json,'$.appointment_id'))
  LIMIT 1
)
WHERE child.owner_id IS NULL
  AND json_extract(child.record_json,'$.appointment_id') IS NOT NULL;

UPDATE supabase_records AS child
SET owner_id = (
  SELECT parent.owner_id
  FROM supabase_records AS parent
  WHERE parent.table_name = 'clinical_encounters'
    AND parent.owner_id IS NOT NULL
    AND (parent.record_key = json_extract(child.record_json,'$.encounter_id')
      OR json_extract(parent.record_json,'$.id') = json_extract(child.record_json,'$.encounter_id'))
  LIMIT 1
)
WHERE child.owner_id IS NULL
  AND json_extract(child.record_json,'$.encounter_id') IS NOT NULL;

UPDATE supabase_records AS child
SET owner_id = (
  SELECT parent.owner_id
  FROM supabase_records AS parent
  WHERE parent.table_name = 'care_packages'
    AND parent.owner_id IS NOT NULL
    AND (parent.record_key = COALESCE(json_extract(child.record_json,'$.care_package_id'),json_extract(child.record_json,'$.package_id'))
      OR json_extract(parent.record_json,'$.id') = COALESCE(json_extract(child.record_json,'$.care_package_id'),json_extract(child.record_json,'$.package_id')))
  LIMIT 1
)
WHERE child.owner_id IS NULL
  AND COALESCE(json_extract(child.record_json,'$.care_package_id'),json_extract(child.record_json,'$.package_id')) IS NOT NULL;

CREATE INDEX IF NOT EXISTS supabase_records_owner_record_idx
  ON supabase_records(table_name, owner_id, record_key);
CREATE INDEX IF NOT EXISTS supabase_records_owner_json_id_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.id'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_mother_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.mother_id'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_baby_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.baby_id'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_appointment_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.appointment_id'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_encounter_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.encounter_id'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_package_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.package_id'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_request_key_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.request_key'));

CREATE TABLE IF NOT EXISTS clinical_idempotency_keys (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  UNIQUE(owner_id, operation, idempotency_key),
  FOREIGN KEY (owner_id) REFERENCES auth_users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS clinical_idempotency_expiry_idx
  ON clinical_idempotency_keys(expires_at)
  WHERE expires_at IS NOT NULL;
