import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import {
  guardedRecordStatement,
  idempotencyInsertStatement,
  idempotencyResponse,
  isIdempotencyConflict,
  ownerRows,
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

function positiveMeasurement(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { provided: false, value: null };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return { provided: true, value: null, invalid: true };
  return { provided: true, value: parsed, invalid: false };
}

function normalizedMeasuredAt(value, now) {
  const raw = value === null || value === undefined || String(value).trim() === '' ? now : value;
  const timestamp = Date.parse(raw);
  const nowTimestamp = Date.parse(now);
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowTimestamp) || timestamp > nowTimestamp) return null;
  return new Date(timestamp).toISOString();
}

function latestWeightForBaby(entries, babyId) {
  let latest = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  for (const entry of entries || []) {
    const row = entry?.record || {};
    if (String(row.baby_id || '') !== String(babyId)) continue;
    const weight = Number(row.weight_g);
    const timestamp = Date.parse(row.measured_at);
    if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(timestamp)) continue;
    if (timestamp >= latestTimestamp) {
      latestTimestamp = timestamp;
      latest = row;
    }
  }
  return latest;
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

  const weightInput = positiveMeasurement(input?.p_weight_g);
  const lengthInput = positiveMeasurement(input?.p_length_cm);
  const headInput = positiveMeasurement(input?.p_head_circumference_cm);
  if (weightInput.invalid || lengthInput.invalid || headInput.invalid) {
    return json(400, { error: 'measurement_invalid' });
  }
  if (!weightInput.provided && !lengthInput.provided && !headInput.provided) {
    return json(400, { error: 'measurement_required' });
  }

  const measuredAt = normalizedMeasuredAt(input?.p_measured_at, now);
  if (!measuredAt) return json(400, { error: 'measured_at_invalid' });

  const weight = weightInput.value;
  const length = lengthInput.value;
  const head = headInput.value;
  const uuid = deps.uuid || (() => crypto.randomUUID());
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

  let shouldUpdateCurrentWeight = false;
  if (weight !== null) {
    const existingWeights = await ownerRows(db, 'weights', user.id);
    const latestWeight = latestWeightForBaby(existingWeights, babyId);
    const latestTimestamp = latestWeight ? Date.parse(latestWeight.measured_at) : Number.NEGATIVE_INFINITY;
    shouldUpdateCurrentWeight = Date.parse(measuredAt) >= latestTimestamp;
  }

  const baby = {
    ...babyEntry.record,
    owner_id: user.id,
    ...(input?.p_sex ? { sex: input.p_sex } : {}),
    ...(input?.p_growth_reference ? { growth_reference: input.p_growth_reference } : {}),
    ...(input?.p_growth_condition ? { growth_condition: input.p_growth_condition } : {}),
    ...(weight !== null && shouldUpdateCurrentWeight
      ? { current_weight_g: Math.round(weight), current_weight_measured_at: measuredAt }
      : {}),
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