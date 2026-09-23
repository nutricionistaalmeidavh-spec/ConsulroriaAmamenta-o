const GUARDED_UPSERT_SQL = `INSERT INTO supabase_records(
  table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
) VALUES(?,?,?,?,?,?,?) ON CONFLICT(table_name,record_key) DO UPDATE SET
  owner_id=COALESCE(supabase_records.owner_id,excluded.owner_id),
  record_json=excluded.record_json,
  source_created_at=excluded.source_created_at,
  source_updated_at=excluded.source_updated_at,
  migrated_at=excluded.migrated_at
WHERE supabase_records.owner_id IS NULL OR supabase_records.owner_id = excluded.owner_id`;

function parseRecord(row) {
  if (!row) return null;
  try {
    return {
      key: row.record_key,
      ownerId: row.owner_id || null,
      record: JSON.parse(row.record_json),
    };
  } catch {
    return null;
  }
}

export async function ownerRows(db, table, ownerId) {
  if (!db || !table || !ownerId) return [];
  const result = await db.prepare(
    'SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = ? AND owner_id = ?',
  ).bind(table, ownerId).all();
  return (result.results || []).map(parseRecord).filter(Boolean);
}

export async function unownedRows(db, table) {
  if (!db || !table) return [];
  const result = await db.prepare(
    'SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = ? AND owner_id IS NULL',
  ).bind(table).all();
  return (result.results || []).map(parseRecord).filter(Boolean);
}

export async function recordById(db, table, id) {
  if (!db || !table || !id) return null;
  const row = await db.prepare(`SELECT record_key,owner_id,record_json FROM supabase_records
    WHERE table_name = ? AND (record_key = ? OR json_extract(record_json,'$.id') = ?) LIMIT 1`)
    .bind(table, String(id), String(id))
    .first();
  return parseRecord(row);
}

export async function recordByIdForOwner(db, table, id, ownerId) {
  if (!db || !table || !id || !ownerId) return null;
  const row = await db.prepare(`SELECT record_key,owner_id,record_json FROM supabase_records
    WHERE table_name = ? AND owner_id = ? AND (record_key = ? OR json_extract(record_json,'$.id') = ?) LIMIT 1`)
    .bind(table, ownerId, String(id), String(id))
    .first();
  return parseRecord(row);
}

export async function recordByKey(db, table, key) {
  if (!db || !table || !key) return null;
  const row = await db.prepare(
    'SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = ? AND record_key = ? LIMIT 1',
  ).bind(table, String(key)).first();
  return parseRecord(row);
}

export function guardedRecordStatement(db, table, key, row, ownerId, now = new Date().toISOString()) {
  if (!db) throw new Error('clinical_db_not_configured');
  if (!ownerId) throw new Error('owner_id_required');
  const next = { ...(row || {}), owner_id: ownerId, updated_at: row?.updated_at || now };
  return db.prepare(GUARDED_UPSERT_SQL).bind(
    table,
    String(key),
    ownerId,
    JSON.stringify(next),
    next.created_at || now,
    next.updated_at || now,
    now,
  );
}

export async function idempotencyResponse(db, ownerId, operation, idempotencyKey, now = new Date().toISOString()) {
  if (!db || !ownerId || !operation || !idempotencyKey) return null;
  const row = await db.prepare(`SELECT response_json FROM clinical_idempotency_keys
    WHERE owner_id = ? AND operation = ? AND idempotency_key = ?
      AND (expires_at IS NULL OR expires_at > ?)
    LIMIT 1`).bind(ownerId, operation, idempotencyKey, now).first();
  if (!row?.response_json) return null;
  try { return JSON.parse(row.response_json); } catch { return null; }
}

export function idempotencyInsertStatement(
  db,
  ownerId,
  operation,
  idempotencyKey,
  response,
  now = new Date().toISOString(),
  expiresAt = null,
) {
  if (!db) throw new Error('clinical_db_not_configured');
  return db.prepare(`INSERT INTO clinical_idempotency_keys(
    id,owner_id,operation,idempotency_key,response_json,created_at,expires_at
  ) VALUES(?,?,?,?,?,?,?)`).bind(
    crypto.randomUUID(),
    ownerId,
    operation,
    idempotencyKey,
    JSON.stringify(response),
    now,
    expiresAt,
  );
}

export function isIdempotencyConflict(error) {
  const message = String(error?.message || error || '');
  return /clinical_idempotency_keys|UNIQUE constraint failed/i.test(message);
}
