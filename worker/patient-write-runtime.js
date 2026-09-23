import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import {
  guardedRecordStatement,
  idempotencyInsertStatement,
  idempotencyResponse,
  isIdempotencyConflict,
} from './d1-record-store.js';

const PRODUCT_CODE = 'debora-lactacao';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function writeError(code, message, status = 400, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.extra = extra;
  return error;
}

function normalizedBabies(input) {
  const babies = Array.isArray(input?.babies) ? input.babies : input?.baby ? [input.baby] : [];
  return babies
    .filter((baby) => baby && String(baby.name || '').trim())
    .map((baby) => ({ ...baby, name: String(baby.name).trim() }));
}

function normalizedConsents(input) {
  const value = input?.consents;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function recordStatement(db, table, row, key, ownerIndex, now) {
  return guardedRecordStatement(db, table, key, row, ownerIndex, now);
}

async function resolveAccess(env, email) {
  if (!env.ARTISYS_LICENSING || !env.LICENSE_SERVICE_SECRET || !email) return null;
  const response = await env.ARTISYS_LICENSING.fetch(new Request('https://artisys-licensing.internal/api/internal/product-license', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-artisys-license-secret': env.LICENSE_SERVICE_SECRET,
    },
    body: JSON.stringify({ action: 'resolve', productCode: PRODUCT_CODE, email }),
  }));
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function ownedMotherCount(db, userId) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM supabase_records WHERE table_name = 'mothers' AND owner_id = ?")
    .bind(userId)
    .first();
  return Number(row?.n || 0);
}

function requestIdempotencyKey(request) {
  const value = String(request.headers.get('idempotency-key') || '').trim();
  return value && value.length <= 200 ? value : '';
}

export function buildNewPatientRecords(input, user, {
  now = new Date().toISOString(),
  uuid = () => crypto.randomUUID(),
} = {}) {
  if (!user?.id) throw writeError('unauthorized', 'Sessão expirada. Entre novamente.', 401);
  const motherInput = input?.mother && typeof input.mother === 'object' ? input.mother : {};
  const motherName = String(motherInput.name || '').trim();
  if (!motherName) throw writeError('invalid_patient_payload', 'Nome da mãe é obrigatório.');

  const babiesInput = normalizedBabies(input);
  if (!babiesInput.length) throw writeError('invalid_patient_payload', 'Cadastre pelo menos um bebê.');

  // This endpoint creates a NEW patient. Caller-provided ids are intentionally ignored
  // so stale form state, demo data or records from another account cannot collide in D1.
  const mother = {
    ...motherInput,
    id: uuid(),
    owner_id: user.id,
    name: motherName,
    created_at: now,
    updated_at: now,
  };

  const babies = babiesInput.map((baby) => ({
    ...baby,
    id: uuid(),
    mother_id: mother.id,
    owner_id: user.id,
    created_at: now,
    updated_at: now,
  }));

  const consents = Object.entries(normalizedConsents(input)).map(([consentType, granted]) => ({
    id: uuid(),
    owner_id: user.id,
    mother_id: mother.id,
    consent_type: consentType,
    granted: Boolean(granted),
    accepted_at: granted ? now : null,
    revoked_at: granted ? null : now,
    created_at: now,
    updated_at: now,
  }));

  return { mother, babies, consents };
}

export async function persistNewPatient(env, user, input, {
  resolveProductAccess = resolveAccess,
  now = new Date().toISOString(),
  uuid = () => crypto.randomUUID(),
  idempotencyKey = '',
} = {}) {
  const db = env.CLINICAL_DB;
  if (!db) throw writeError('clinical_db_not_configured', 'Banco clínico indisponível.', 503);

  if (idempotencyKey) {
    const replay = await idempotencyResponse(db, user.id, 'create_patient', idempotencyKey, now);
    if (replay) return replay;
  }

  const access = await resolveProductAccess(env, user?.email || '');
  if (access?.commercial && Number.isInteger(access.patientLimit)) {
    const count = await ownedMotherCount(db, user.id);
    if (count >= Number(access.patientLimit)) {
      throw writeError(
        'SAAS_PATIENT_LIMIT_REACHED',
        `Seu plano Freemium permite até ${access.patientLimit} mães/pacientes.`,
        403,
        { limit: access.patientLimit },
      );
    }
  }

  const records = buildNewPatientRecords(input, user, { now, uuid });
  const statements = [
    recordStatement(db, 'mothers', records.mother, records.mother.id, user.id, now),
    ...records.babies.map((baby) => recordStatement(db, 'babies', baby, baby.id, user.id, now)),
    ...records.consents.map((consent) => recordStatement(db, 'consents', consent, consent.id, user.id, now)),
  ];
  if (idempotencyKey) {
    statements.push(idempotencyInsertStatement(db, user.id, 'create_patient', idempotencyKey, records, now));
  }

  // D1 batch is transactional: patient graph and idempotency claim commit together.
  try {
    await db.batch(statements);
  } catch (error) {
    if (idempotencyKey && isIdempotencyConflict(error)) {
      const replay = await idempotencyResponse(db, user.id, 'create_patient', idempotencyKey, now);
      if (replay) return replay;
    }
    throw error;
  }
  return records;
}

export async function handleCloudflarePatientWrite(request, env, url = new URL(request.url), deps = {}) {
  if (url.pathname !== '/api/clinical/patients') return null;
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authenticate = deps.authenticate || authenticateClinicalRequest;
  const user = await authenticate(request, env);
  if (!user?.id) return json(401, { error: 'unauthorized', message: 'Sessão expirada. Entre novamente.' });

  const input = await request.json().catch(() => null);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json(400, { error: 'invalid_patient_payload', message: 'Dados da paciente inválidos.' });
  }

  try {
    const saved = await persistNewPatient(env, user, input, {
      ...deps,
      idempotencyKey: deps.idempotencyKey ?? requestIdempotencyKey(request),
    });
    return json(201, saved);
  } catch (error) {
    console.error('patient write failed', error);
    const status = Number(error?.status || 500);
    return json(status, {
      error: error?.code || 'patient_create_failed',
      message: error?.message || 'Não foi possível salvar a paciente.',
      ...(error?.extra || {}),
    });
  }
}
