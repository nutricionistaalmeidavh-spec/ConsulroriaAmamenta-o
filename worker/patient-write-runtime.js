import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import {
  guardedRecordStatement,
  idempotencyInsertStatement,
  idempotencyResponse,
  isIdempotencyConflict,
  ownerRows,
  recordByIdForOwner,
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

export async function persistPatientEdit(env, user, input, {
  now = new Date().toISOString(),
  uuid = () => crypto.randomUUID(),
  idempotencyKey = '',
} = {}) {
  const db = env.CLINICAL_DB;
  if (!db) throw writeError('clinical_db_not_configured', 'Banco clínico indisponível.', 503);
  if (idempotencyKey) {
    const replay = await idempotencyResponse(db, user.id, 'update_patient', idempotencyKey, now);
    if (replay) return replay;
  }
  const patch = input.mother;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !patch.id) {
    throw writeError('invalid_patient_payload', 'Identificação da mãe é obrigatória.');
  }
  function assertRelations(row, motherId) {
    if ((row.owner_id != null && row.owner_id !== user.id)
      || (motherId && row.mother_id != null && row.mother_id !== motherId)) {
      throw writeError('patient_ownership_mismatch', 'Dados não pertencem a esta paciente.', 403);
    }
  }
  assertRelations(patch);
  const existing = await recordByIdForOwner(db, 'mothers', patch.id, user.id);
  if (!existing) throw writeError('patient_not_found', 'Paciente não encontrada.', 404);
  const mother = { ...existing.record, ...patch, id: existing.record.id, owner_id: user.id, created_at: existing.record.created_at, updated_at: now };
  mother.name = String(mother.name || '').trim();
  if (!mother.name) throw writeError('invalid_patient_payload', 'Nome da mãe é obrigatório.');

  const babyRows = (await ownerRows(db, 'babies', user.id)).filter(({ record }) => record.mother_id === mother.id);
  const babies = babyRows.map(({ record }) => record);
  const babyWrites = [];
  const babyPatches = input.babies ?? (input.baby ? [input.baby] : []);
  if (!Array.isArray(babyPatches)) throw writeError('invalid_patient_payload', 'Dados dos bebês inválidos.');
  const seen = new Set();
  for (const babyPatch of babyPatches) {
    if (!babyPatch || typeof babyPatch !== 'object' || Array.isArray(babyPatch)) throw writeError('invalid_patient_payload', 'Dados do bebê inválidos.');
    assertRelations(babyPatch, mother.id);
    const previous = babyPatch.id ? babyRows.find(({ record, key }) => record.id === babyPatch.id || key === babyPatch.id) : null;
    if (babyPatch.id && !previous) throw writeError('patient_ownership_mismatch', 'Bebê não pertence a esta paciente.', 403);
    if (previous && seen.has(previous.key)) throw writeError('invalid_patient_payload', 'Bebê repetido na edição.');
    if (previous) seen.add(previous.key);
    const baby = { ...previous?.record, ...babyPatch, id: previous?.record.id || uuid(), mother_id: mother.id, owner_id: user.id, created_at: previous?.record.created_at || now, updated_at: now };
    baby.name = String(baby.name || '').trim();
    if (!baby.name) throw writeError('invalid_patient_payload', 'Nome do bebê é obrigatório.');
    if (previous) babies[babies.indexOf(previous.record)] = baby;
    else babies.push(baby);
    babyWrites.push(recordStatement(db, 'babies', baby, previous?.key || baby.id, user.id, now));
  }
  const consentRows = (await ownerRows(db, 'consents', user.id)).filter(({ record }) => record.mother_id === mother.id);
  const consents = consentRows.map(({ record }) => record);
  const consentWrites = [];
  if (input.consents != null && (typeof input.consents !== 'object' || Array.isArray(input.consents))) {
    throw writeError('invalid_patient_payload', 'Consentimentos inválidos.');
  }
  for (const [type, granted] of Object.entries(normalizedConsents(input))) {
    if (typeof granted !== 'boolean') throw writeError('invalid_patient_payload', 'Consentimento inválido.');
    const matches = consentRows.filter(({ record }) => record.consent_type === type);
    // Keep the physical keys of migrated records, including historical duplicates.
    for (const previous of matches.length ? matches : [null]) {
      const consent = { ...previous?.record, id: previous?.record.id || uuid(), owner_id: user.id, mother_id: mother.id, consent_type: type, granted, accepted_at: granted ? (previous?.record.granted ? previous.record.accepted_at || now : now) : null, revoked_at: granted ? null : (previous?.record.granted === false ? previous.record.revoked_at || now : now), created_at: previous?.record.created_at || now, updated_at: now };
      if (previous) consents[consents.indexOf(previous.record)] = consent;
      else consents.push(consent);
      consentWrites.push(recordStatement(db, 'consents', consent, previous?.key || consent.id, user.id, now));
    }
  }
  const records = { mother, babies, consents };
  const statements = [recordStatement(db, 'mothers', mother, existing.key, user.id, now), ...babyWrites, ...consentWrites];
  if (idempotencyKey) statements.push(idempotencyInsertStatement(db, user.id, 'update_patient', idempotencyKey, records, now));
  try {
    await db.batch(statements);
  } catch (error) {
    if (idempotencyKey && isIdempotencyConflict(error)) {
      const replay = await idempotencyResponse(db, user.id, 'update_patient', idempotencyKey, now);
      if (replay) return replay;
    }
    throw error;
  }
  return records;
}

export async function handleCloudflarePatientWrite(request, env, url = new URL(request.url), deps = {}) {
  if (url.pathname !== '/api/clinical/patients') return null;
  if (!['POST', 'PATCH'].includes(request.method)) return json(405, { error: 'method_not_allowed' });

  const authenticate = deps.authenticate || authenticateClinicalRequest;
  const user = await authenticate(request, env);
  if (!user?.id) return json(401, { error: 'unauthorized', message: 'Sessão expirada. Entre novamente.' });

  const input = await request.json().catch(() => null);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json(400, { error: 'invalid_patient_payload', message: 'Dados da paciente inválidos.' });
  }

  try {
    const persist = request.method === 'PATCH' ? persistPatientEdit : persistNewPatient;
    const saved = await persist(env, user, input, {
      ...deps,
      idempotencyKey: deps.idempotencyKey ?? requestIdempotencyKey(request),
    });
    return json(request.method === 'PATCH' ? 200 : 201, saved);
  } catch (error) {
    console.error('patient write failed', error);
    const status = Number(error?.status || 500);
    return json(status, {
      error: error?.code || (request.method === 'PATCH' ? 'patient_update_failed' : 'patient_create_failed'),
      message: error?.message || 'Não foi possível salvar a paciente.',
      ...(error?.extra || {}),
    });
  }
}
