import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';

const UPSERT_RECORD_SQL = `INSERT INTO supabase_records(
  table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
) VALUES(?,?,?,?,?,?,?) ON CONFLICT(table_name,record_key) DO UPDATE SET
  owner_id=excluded.owner_id,record_json=excluded.record_json,source_created_at=excluded.source_created_at,
  source_updated_at=excluded.source_updated_at,migrated_at=excluded.migrated_at`;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function parseRecord(row) {
  if (!row) return null;
  try {
    return { key: row.record_key, ownerId: row.owner_id || null, record: JSON.parse(row.record_json) };
  } catch {
    return null;
  }
}

async function tableRows(db, table) {
  const result = await db.prepare(
    'SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = ?',
  ).bind(table).all();
  return (result.results || []).map(parseRecord).filter(Boolean);
}

async function recordById(db, table, id) {
  if (!id) return null;
  const rows = await tableRows(db, table);
  return rows.find((entry) => String(entry.record?.id || entry.key) === String(id)) || null;
}

async function babyOwnedByUser(db, babyEntry, userId) {
  if (!babyEntry || !userId) return false;
  if (babyEntry.ownerId && String(babyEntry.ownerId) === String(userId)) return true;
  if (babyEntry.record?.owner_id && String(babyEntry.record.owner_id) === String(userId)) return true;
  const motherId = babyEntry.record?.mother_id;
  if (!motherId) return false;
  const mother = await recordById(db, 'mothers', motherId);
  if (!mother) return false;
  return String(mother.ownerId || mother.record?.owner_id || '') === String(userId);
}

function recordStatement(db, table, key, row, ownerId, now) {
  return db.prepare(UPSERT_RECORD_SQL).bind(
    table,
    key,
    ownerId || null,
    JSON.stringify(row),
    row.created_at || now,
    row.updated_at || now,
    now,
  );
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function handleCloudflareGrowthRuntime(request, env, url = new URL(request.url), deps = {}) {
  if (url.pathname !== '/rest/v1/rpc/record_growth_measurement') return null;
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!env.CLINICAL_DB) return json(503, { error: 'cloudflare_d1_required' });

  const authenticate = deps.authenticate || authenticateClinicalRequest;
  const user = await authenticate(request, env);
  if (!user?.id) return json(401, { error: 'cloudflare_auth_required' });

  const input = await request.json().catch(() => null);
  const babyId = String(input?.p_baby_id || '').trim();
  if (!babyId) return json(400, { error: 'baby_id_required' });

  const db = env.CLINICAL_DB;
  const babyEntry = await recordById(db, 'babies', babyId);
  if (!babyEntry || !await babyOwnedByUser(db, babyEntry, user.id)) {
    return json(404, { error: 'baby_not_found' });
  }

  const weight = finiteOrNull(input?.p_weight_g);
  const length = finiteOrNull(input?.p_length_cm);
  const head = finiteOrNull(input?.p_head_circumference_cm);
  if (weight === null && length === null && head === null) {
    return json(400, { error: 'measurement_required' });
  }

  const now = deps.now || new Date().toISOString();
  const uuid = deps.uuid || (() => crypto.randomUUID());
  const measuredAt = input?.p_measured_at || now;
  const measurementId = uuid();
  const measurement = {
    id: measurementId,
    owner_id: user.id,
    baby_id: babyId,
    measured_at: measuredAt,
    weight_g: weight === null ? null : Math.round(weight),
    length_cm: length,
    head_circumference_cm: head,
    created_at: now,
    updated_at: now,
  };

  const baby = {
    ...babyEntry.record,
    owner_id: user.id,
    ...(input?.p_sex ? { sex: input.p_sex } : {}),
    ...(input?.p_growth_reference ? { growth_reference: input.p_growth_reference } : {}),
    ...(input?.p_growth_condition ? { growth_condition: input.p_growth_condition } : {}),
    ...(weight === null ? {} : { current_weight_g: Math.round(weight) }),
    updated_at: now,
  };

  const statements = [
    recordStatement(db, 'growth_measurements', measurementId, measurement, user.id, now),
    recordStatement(db, 'babies', babyEntry.key, baby, user.id, now),
  ];

  let weightRecord = null;
  if (weight !== null) {
    const weightId = uuid();
    weightRecord = {
      id: weightId,
      owner_id: user.id,
      baby_id: babyId,
      measured_at: measuredAt,
      weight_g: Math.round(weight),
      source: 'growth_measurement',
      created_at: now,
      updated_at: now,
    };
    statements.splice(1, 0, recordStatement(db, 'weights', weightId, weightRecord, user.id, now));
  }

  // D1 batch is transactional: measurement, optional weight history and baby's current state move together.
  await db.batch(statements);
  return json(200, { ...measurement, baby, weight: weightRecord });
}
