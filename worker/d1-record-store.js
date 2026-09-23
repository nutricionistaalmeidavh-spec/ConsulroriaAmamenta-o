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

function safeField(value) {
  const field = String(value || '');
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(field) ? field : '';
}

function jsonField(field) {
  return `json_extract(record_json,'$.${field}')`;
}

function parseFilter(raw) {
  const value = String(raw || '');
  const dot = value.indexOf('.');
  if (dot <= 0) return { operator: 'eq', expected: value };
  return { operator: value.slice(0, dot), expected: value.slice(dot + 1) };
}

function parseInValues(expected) {
  return String(expected || '')
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map((item) => decodeURIComponent(item.trim().replace(/^"|"$/g, '')))
    .filter((item) => item !== '');
}

export function buildOwnedRecordPageQuery(table, ownerId, url) {
  if (!safeField(table) || !ownerId || !url) return null;
  const where = ['table_name = ?', 'owner_id = ?'];
  const bindings = [String(table), String(ownerId)];

  for (const [rawField, rawValue] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(rawField) || rawField === 'or') continue;
    const field = safeField(rawField);
    if (!field) return null;
    const expression = jsonField(field);
    const { operator, expected } = parseFilter(rawValue);

    if (operator === 'eq') {
      where.push(`${expression} = ?`);
      bindings.push(expected);
    } else if (operator === 'neq') {
      where.push(`${expression} != ?`);
      bindings.push(expected);
    } else if (operator === 'is' && expected === 'null') {
      where.push(`${expression} IS NULL`);
    } else if (operator === 'is') {
      where.push(`${expression} = ?`);
      bindings.push(expected);
    } else if (operator === 'not' && expected === 'is.null') {
      where.push(`${expression} IS NOT NULL`);
    } else if (operator === 'not') {
      where.push(`${expression} != ?`);
      bindings.push(expected);
    } else if (operator === 'in') {
      const values = parseInValues(expected);
      if (!values.length) return null;
      where.push(`${expression} IN (${values.map(() => '?').join(',')})`);
      bindings.push(...values);
    } else if (operator === 'like') {
      where.push(`CAST(${expression} AS TEXT) LIKE ?`);
      bindings.push(expected);
    } else if (operator === 'ilike') {
      where.push(`lower(CAST(${expression} AS TEXT)) LIKE lower(?)`);
      bindings.push(expected);
    } else if (['gt', 'gte', 'lt', 'lte'].includes(operator)) {
      const symbols = { gt: '>', gte: '>=', lt: '<', lte: '<=' };
      where.push(`${expression} ${symbols[operator]} ?`);
      bindings.push(expected);
    } else {
      return null;
    }
  }

  const orderClauses = [];
  const order = String(url.searchParams.get('order') || '').trim();
  if (order) {
    for (const part of order.split(',')) {
      const [rawField, rawDirection = 'asc'] = part.split('.');
      const field = safeField(rawField);
      const direction = String(rawDirection || 'asc').toLowerCase();
      if (!field || !['asc', 'desc'].includes(direction)) return null;
      orderClauses.push(`${jsonField(field)} ${direction.toUpperCase()}`);
    }
  }

  const rawOffset = Number(url.searchParams.get('offset') || 0);
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.trunc(rawOffset) : 0;
  const limitParam = url.searchParams.get('limit');
  const rawLimit = limitParam === null ? Number.NaN : Number(limitParam);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 0 ? Math.trunc(rawLimit) : null;
  const whereSql = where.join(' AND ');
  let sql = `SELECT record_key,owner_id,record_json,COUNT(*) OVER() AS __total FROM supabase_records WHERE ${whereSql}`;
  if (orderClauses.length) sql += ` ORDER BY ${orderClauses.join(', ')}`;
  if (limit !== null) {
    sql += ' LIMIT ? OFFSET ?';
    bindings.push(limit, offset);
  } else if (offset > 0) {
    sql += ' LIMIT -1 OFFSET ?';
    bindings.push(offset);
  }

  return {
    sql,
    bindings,
    countSql: `SELECT COUNT(*) AS n FROM supabase_records WHERE ${whereSql}`,
    countBindings: bindings.slice(0, where.length === 2 ? 2 : bindings.length - (limit !== null ? 2 : offset > 0 ? 1 : 0)),
    offset,
    limit,
  };
}

export async function queryOwnedRecordPage(db, table, ownerId, url) {
  if (!db) return null;
  const built = buildOwnedRecordPageQuery(table, ownerId, url);
  if (!built) return null;
  const result = await db.prepare(built.sql).bind(...built.bindings).all();
  const rawRows = result.results || [];
  const entries = rawRows.map(parseRecord).filter(Boolean);
  let total = Number(rawRows[0]?.__total || 0);
  if (!rawRows.length && built.offset > 0) {
    const row = await db.prepare(built.countSql).bind(...built.countBindings).first();
    total = Number(row?.n || 0);
  }
  return { entries, total, offset: built.offset, limit: built.limit };
}

export async function hasUnownedRows(db, table) {
  if (!db || !table) return false;
  const row = await db.prepare(
    'SELECT 1 AS found FROM supabase_records WHERE table_name = ? AND owner_id IS NULL LIMIT 1',
  ).bind(table).first();
  return Boolean(row?.found);
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
