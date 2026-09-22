import { authenticateClinicalRequest } from './cloudflare-clinical-runtime.js';

const PRODUCT_CODE = 'debora-lactacao';
const INSERT_RECORD_SQL = `INSERT INTO supabase_records(
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

function recordStatement(db, table, row, key, ownerIndex) {
  const now = new Date().toISOString();
  return db.prepare(INSERT_RECORD_SQL).bind(
    table,
    key,
    ownerIndex || null,
    JSON.stringify(row),
    row.created_at || now,
    row.updated_at || now,
    now,
  );
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

  const mother = {
    ...motherInput,
    id: motherInput.id || uuid(),
    owner_id: user.id,
    name: motherName,
    created_at: motherInput.created_at || now,
    updated_at: now,
  };

  const babies = babiesInput.map((baby) => ({
    ...baby,
    id: baby.id || uuid(),
    mother_id: mother.id,
    created_at: baby.created_at || now,
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
} = {}) {
  const db = env.CLINICAL_DB;
  if (!db) throw writeError('clinical_db_not_configured', 'Banco clínico indisponível.', 503);

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
    recordStatement(db, 'mothers', records.mother, records.mother.id, user.id),
    ...records.babies.map((baby) => recordStatement(db, 'babies', baby, baby.id, null)),
    ...records.consents.map((consent) => recordStatement(db, 'consents', consent, consent.id, user.id)),
  ];

  // D1 batch is transactional: a failed statement rolls the whole patient creation back.
  await db.batch(statements);
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
    const saved = await persistNewPatient(env, user, input, deps);
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
