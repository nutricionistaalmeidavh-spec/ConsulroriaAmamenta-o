import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import {
  guardedRecordStatement,
  idempotencyInsertStatement,
  idempotencyResponse,
  isIdempotencyConflict,
  recordById,
  recordByIdForOwner,
} from './d1-record-store.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function babyOwnedByUser(db, babyEntry, userId) {
  if (!babyEntry || !userId) return false;
  if (babyEntry.ownerId) return String(babyEntry.ownerId) === String(userId);
  if (babyEntry.record?.owner_id) return String(babyEntry.record.owner_id) === String(userId);
  const motherId = babyEntry.record?.mother_id;
  if (!motherId) return false;
  const mother = await recordById(db, 'mothers', motherId);
  if (!mother) return false;
  return String(mother.ownerId || mother.record?.owner_id || '') === String(userId);
}

function recordStatement(db, table, key, row, ownerId, now) {
  return guardedRecordStatement(db, table, key, row, ownerId, now);
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requestIdempotencyKey(request) {
  const value = String(request.headers.get('idempotency-key') || '').trim();
  return value && value.length <= 200 ? value : '';
}

export async function handleCloudflareGrowthRuntime(request, env, url = new URL(request.url), deps = {}) {
  if (url.pathname !== '/api/clinical/rpc/record_growth_measurement') return null;
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!env.CLINICAL_DB) return json(503, { error: 'cloudflare_d1_required' });

  const authenticate = deps.authenticate || authenticateClinicalRequest;
  const user = await authenticate(request, env);
  if (!user?.id) return json(401, { error: 'cloudflare_auth_required' });

  const input = await request.json().catch(() => null);
  const babyId = String(input?.p_baby_id || '').trim();
  if (!babyId) return json(400, { error: 'baby_id_required' });

  const db = env.CLINICAL_DB;
  const now = deps.now || new Date().toISOString();
  const idempotencyKey = requestIdempotencyKey(request);
  if (idempotencyKey) {
    const replay = await idempotencyResponse(db, user.id, 'record_growth_measurement', idempotencyKey, now);
    if (replay) return json(200, replay);
  }

  let babyEntry = await recordByIdForOwner(db, 'babies', babyId, user.id);
  if (!babyEntry) {
    const legacyBaby = await recordById(db, 'babies', babyId);
    if (legacyBaby && await babyOwnedByUser(db, legacyBaby, user.id)) babyEntry = legacyBaby;
  }
  if (!babyEntry || !await babyOwnedByUser(db, babyEntry, user.id)) {
    return json(404, { error: 'baby_not_found' });
  }

  const weight = finiteOrNull(input?.p_weight_g);
  const length = finiteOrNull(input?.p_length_cm);
  const head = finiteOrNull(input?.p_head_circumference_cm);
  if (weight === null && length === null && head === null) {
    return json(400, { error: 'measurement_required' });
  }

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

  const responseBody = { ...measurement, baby, weight: weightRecord };
  if (idempotencyKey) {
    statements.push(idempotencyInsertStatement(
      db, user.id, 'record_growth_measurement', idempotencyKey, responseBody, now,
    ));
  }

  try {
    await db.batch(statements);
  } catch (error) {
    if (idempotencyKey && isIdempotencyConflict(error)) {
      const replay = await idempotencyResponse(db, user.id, 'record_growth_measurement', idempotencyKey, now);
      if (replay) return json(200, replay);
    }
    throw error;
  }
  return json(200, responseBody);
}
