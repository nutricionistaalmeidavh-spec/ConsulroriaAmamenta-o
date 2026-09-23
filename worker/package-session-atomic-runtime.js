import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { runtimeJson } from './cloudflare-clinical-runtime.js';

const RPC_PATH = '/api/clinical/rpc/consume_care_package_session_manual';

function requireDb(env) {
  if (!env.CLINICAL_DB) throw new Error('clinical_db_not_configured');
  return env.CLINICAL_DB;
}

function parseEntry(row) {
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

function remaining(pkg) {
  return Math.max(0, Number(pkg?.sessions_total || 0) - Number(pkg?.sessions_used || 0));
}

function packagePayload(pkg, { idempotent = false } = {}) {
  return {
    handled: true,
    idempotent,
    package_id: pkg.id,
    sessions_total: Number(pkg.sessions_total || 0),
    sessions_used: Number(pkg.sessions_used || 0),
    sessions_remaining: remaining(pkg),
    package_status: pkg.status || 'active',
  };
}

async function ownedPackage(database, packageId, ownerId) {
  const row = await database.prepare(`SELECT record_key,owner_id,record_json
    FROM supabase_records
    WHERE table_name = 'care_packages'
      AND owner_id = ?
      AND (record_key = ? OR json_extract(record_json,'$.id') = ?)
    LIMIT 1`).bind(ownerId, packageId, packageId).first();
  return parseEntry(row);
}

async function sessionByRequestKey(database, ownerId, packageId, requestKey) {
  const row = await database.prepare(`SELECT record_key,owner_id,record_json
    FROM supabase_records
    WHERE table_name = 'care_package_sessions'
      AND owner_id = ?
      AND json_extract(record_json,'$.request_key') = ?
      AND COALESCE(json_extract(record_json,'$.package_id'),json_extract(record_json,'$.care_package_id')) = ?
    LIMIT 1`).bind(ownerId, requestKey, packageId).first();
  return parseEntry(row);
}

function sessionInsertStatement(database, { sessionKey, ownerId, packageKey, requestKey, recordJson, now }) {
  return database.prepare(`INSERT INTO supabase_records(
      table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
    )
    SELECT 'care_package_sessions',?,?,?,?,?,?
    WHERE EXISTS (
      SELECT 1 FROM supabase_records
      WHERE table_name = 'care_packages'
        AND record_key = ?
        AND owner_id = ?
        AND COALESCE(json_extract(record_json,'$.status'),'active') = 'active'
        AND CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER)
          < CAST(COALESCE(json_extract(record_json,'$.sessions_total'),0) AS INTEGER)
    )`).bind(sessionKey, ownerId, recordJson, now, now, now, packageKey, ownerId);
}

function packageIncrementStatement(database, { packageKey, ownerId, now }) {
  return database.prepare(`UPDATE supabase_records
    SET record_json = json_set(
          record_json,
          '$.sessions_used', CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER) + 1,
          '$.status', CASE
            WHEN CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER) + 1
              >= CAST(COALESCE(json_extract(record_json,'$.sessions_total'),0) AS INTEGER)
            THEN 'completed' ELSE 'active' END,
          '$.updated_at', ?
        ),
        source_updated_at = ?,
        migrated_at = ?
    WHERE table_name = 'care_packages'
      AND record_key = ?
      AND owner_id = ?
      AND COALESCE(json_extract(record_json,'$.status'),'active') = 'active'
      AND CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER)
        < CAST(COALESCE(json_extract(record_json,'$.sessions_total'),0) AS INTEGER)`).bind(
    now, now, now, packageKey, ownerId,
  );
}

function changes(result) {
  const value = result?.meta?.changes;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function isUniqueConflict(error) {
  return /UNIQUE constraint failed|constraint.*supabase_records|supabase_records.*constraint/i.test(String(error?.message || error || ''));
}

export async function handleAtomicPackageSessionRuntime(request, env, url = new URL(request.url)) {
  if (!env.CLINICAL_DB || request.method !== 'POST' || url.pathname !== RPC_PATH) return null;

  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return runtimeJson(401, { message: 'Sessão expirada. Entre novamente.' });

  const input = await request.clone().json().catch(() => ({}));
  const packageId = String(input?.p_package_id || '').trim();
  const requestKey = String(input?.p_request_key || '').trim();
  if (!packageId) return runtimeJson(400, { message: 'Plano obrigatório.' });
  if (!requestKey) return runtimeJson(400, { message: 'Identificador da operação obrigatório.' });

  const database = requireDb(env);
  const entry = await ownedPackage(database, packageId, user.id);
  if (!entry) return runtimeJson(404, { message: 'Plano não encontrado ou sem permissão.' });

  const existing = await sessionByRequestKey(database, user.id, packageId, requestKey);
  if (existing) {
    const current = (await ownedPackage(database, packageId, user.id))?.record || entry.record;
    return runtimeJson(200, packagePayload(current, { idempotent: true }));
  }

  if (entry.record?.status !== 'active' || remaining(entry.record) <= 0) {
    return runtimeJson(409, { message: 'Plano sem consultas disponíveis.' });
  }

  const now = new Date().toISOString();
  const sessionKey = `manual:${packageId}:${requestKey}`;
  const session = {
    id: sessionKey,
    owner_id: user.id,
    package_id: entry.record.id || packageId,
    care_package_id: entry.record.id || packageId,
    mother_id: entry.record.mother_id || null,
    appointment_id: null,
    encounter_id: null,
    source: 'manual',
    request_key: requestKey,
    notes: String(input?.p_notes || ''),
    consumed_at: now,
    used_at: now,
    created_at: now,
    updated_at: now,
  };

  let results;
  try {
    results = await database.batch([
      sessionInsertStatement(database, {
        sessionKey,
        ownerId: user.id,
        packageKey: entry.key,
        requestKey,
        recordJson: JSON.stringify(session),
        now,
      }),
      packageIncrementStatement(database, {
        packageKey: entry.key,
        ownerId: user.id,
        now,
      }),
    ]);
  } catch (error) {
    if (isUniqueConflict(error)) {
      const replay = await sessionByRequestKey(database, user.id, packageId, requestKey);
      if (replay) {
        const current = (await ownedPackage(database, packageId, user.id))?.record || entry.record;
        return runtimeJson(200, packagePayload(current, { idempotent: true }));
      }
    }
    console.error('atomic package session consumption failed', error);
    return runtimeJson(503, { message: 'Não foi possível registrar a consulta do plano. Tente novamente.' });
  }

  const insertChanges = changes(results?.[0]);
  const updateChanges = changes(results?.[1]);
  const persistedSession = await sessionByRequestKey(database, user.id, packageId, requestKey);
  const currentEntry = await ownedPackage(database, packageId, user.id);
  const currentPackage = currentEntry?.record || entry.record;

  if (persistedSession && (insertChanges === 1 || insertChanges === null) && (updateChanges === 1 || updateChanges === null)) {
    return runtimeJson(200, packagePayload(currentPackage, { idempotent: false }));
  }

  if (persistedSession) {
    return runtimeJson(200, packagePayload(currentPackage, { idempotent: true }));
  }

  return runtimeJson(409, { message: 'Plano sem consultas disponíveis.' });
}
