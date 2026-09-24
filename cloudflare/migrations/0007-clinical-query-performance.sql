PRAGMA foreign_keys = ON;

-- C12: owner-scoped chronological lists must be able to filter/order in D1
-- without scanning and sorting every clinical record in the Worker.
CREATE INDEX IF NOT EXISTS supabase_records_owner_occurred_at_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.occurred_at'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_starts_at_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.starts_at'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_measured_at_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.measured_at'));
CREATE INDEX IF NOT EXISTS supabase_records_owner_created_at_idx
  ON supabase_records(table_name, owner_id, json_extract(record_json,'$.created_at'));

-- Member portal claims are looked up by the authenticated member identity/e-mail.
CREATE INDEX IF NOT EXISTS supabase_records_member_user_idx
  ON supabase_records(table_name, json_extract(record_json,'$.member_user_id'));
CREATE INDEX IF NOT EXISTS supabase_records_member_email_idx
  ON supabase_records(table_name, lower(trim(json_extract(record_json,'$.email'))));
