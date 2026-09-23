import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { runtimeJson } from './cloudflare-clinical-runtime.js';

const RPC_PATH = '/api/clinical/rpc/finalize_encounter_billing';
const CLAIM_PATH = '$.__encounter_finalize_claim';

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

async function ownedRecord(database, table, id, ownerId) {
  if (!id) return null;
  const row = await database.prepare(`SELECT record_key,owner_id,record_json
    FROM supabase_records
    WHERE table_name = ?
      AND owner_id = ?
      AND (record_key = ? OR json_extract(record_json,'$.id') = ?)
    LIMIT 1`).bind(table, ownerId, id, id).first();
  return parseEntry(row);
}

async function encounterSession(database, ownerId, packageId, encounterId) {
  const row = await database.prepare(`SELECT record_key,owner_id,record_json
    FROM supabase_records
    WHERE table_name = 'care_package_sessions'
      AND owner_id = ?
      AND COALESCE(json_extract(record_json,'$.package_id'),json_extract(record_json,'$.care_package_id')) = ?
      AND json_extract(record_json,'$.encounter_id') = ?
    LIMIT 1`).bind(ownerId, packageId, encounterId).first();
  return parseEntry(row);
}

function remaining(pkg) {
  return Math.max(0, Number(pkg?.sessions_total || 0) - Number(pkg?.sessions_used || 0));
}

function responsePayload(mode, pkg, { idempotent = false } = {}) {
  return {
    handled: true,
    billing_mode: mode,
    package_id: pkg.id,
    sessions_used: Number(pkg.sessions_used || 0),
    sessions_remaining: remaining(pkg),
    idempotent,
  };
}

function packageClaimStatement(database, { packageKey, ownerId, expectedUsed, claimKey, now }) {
  return database.prepare(`UPDATE supabase_records
    SET record_json = json_set(
          record_json,
          '$.sessions_used', CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER) + 1,
          '$.status', CASE
            WHEN CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER) + 1
              >= CAST(COALESCE(json_extract(record_json,'$.sessions_total'),0) AS INTEGER)
            THEN 'completed' ELSE 'active' END,
          '$.updated_at', ?,
          '${CLAIM_PATH}', ?
        ),
        source_updated_at = ?,
        migrated_at = ?
    WHERE table_name = 'care_packages'
      AND record_key = ?
      AND owner_id = ?
      AND COALESCE(json_extract(record_json,'$.status'),'active') = 'active'
      AND CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER) = ?
      AND CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER)
        < CAST(COALESCE(json_extract(record_json,'$.sessions_total'),0) AS INTEGER)`).bind(
    now, claimKey, now, now, packageKey, ownerId, expectedUsed,
  );
}

function sessionInsertStatement(database, { sessionKey, ownerId, packageKey, claimKey, recordJson, now }) {
  return database.prepare(`INSERT INTO supabase_records(
      table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
    )
    SELECT 'care_package_sessions',?,?,?,?,?,?
    WHERE EXISTS (
      SELECT 1 FROM supabase_records
      WHERE table_name = 'care_packages'
        AND record_key = ?
        AND owner_id = ?
        AND json_extract(record_json,'${CLAIM_PATH}') = ?
    )
    ON CONFLICT(table_name,record_key) DO NOTHING`).bind(
    sessionKey, ownerId, recordJson, now, now, now, packageKey, ownerId, claimKey,
  );
}

function packageClaimCleanupStatement(database, { packageKey, ownerId, claimKey, now }) {
  return database.prepare(`UPDATE supabase_records
    SET record_json = json_remove(record_json,'${CLAIM_PATH}'),
        source_updated_at = ?,
        migrated_at = ?
    WHERE table_name = 'care_packages'
      AND record_key = ?
      AND owner_id = ?
      AND json_extract(record_json,'${CLAIM_PATH}') = ?`).bind(
    now, now, packageKey, ownerId, claimKey,
  );
}

function changes(result) {
  const value = result?.meta?.changes;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export async function handleAtomicEncounterFinalizeRuntime(request, env, url = new URL(request.url)) {
  if (!env.CLINICAL_DB || request.method !== 'POST' || url.pathname !== RPC_PATH) return null;

  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return runtimeJson(401, { message: 'Sessão expirada. Entre novamente.' });

  const input = await request.clone().json().catch(() => ({}));
  const appointmentId = String(input?.p_appointment_id || '').trim();
  const encounterId = String(input?.p_encounter_id || '').trim();
  if (!appointmentId || !encounterId) return runtimeJson(400, { message: 'Agendamento e prontuário são obrigatórios.' });

  const database = requireDb(env);
  const appointment = await ownedRecord(database, 'appointments', appointmentId, user.id);
  if (!appointment) return runtimeJson(404, { message: 'Agendamento não encontrado.' });

  const mode = String(appointment.record?.billing_mode || 'individual');
  if (mode !== 'package_active' && mode !== 'package_new') return null;

  const encounter = await ownedRecord(database, 'clinical_encounters', encounterId, user.id);
  if (!encounter || String(encounter.record?.appointment_id || '') !== appointmentId) {
    return runtimeJson(409, { message: 'Prontuário incompatível com o agendamento.' });
  }

  const packageId = String(appointment.record?.package_id || '').trim();
  const packageEntry = await ownedRecord(database, 'care_packages', packageId, user.id);
  if (!packageEntry) return runtimeJson(409, { message: 'Plano ativo não encontrado.' });

  const existing = await encounterSession(database, user.id, packageId, encounterId);
  if (existing) {
    const current = (await ownedRecord(database, 'care_packages', packageId, user.id))?.record || packageEntry.record;
    return runtimeJson(200, responsePayload(mode, current, { idempotent: true }));
  }

  if (packageEntry.record?.status !== 'active' || remaining(packageEntry.record) <= 0) {
    return runtimeJson(409, { message: 'Plano sem consultas disponíveis.' });
  }

  const now = new Date().toISOString();
  const expectedUsed = Number(packageEntry.record.sessions_used || 0);
  const sessionKey = `encounter:${packageId}:${encounterId}`;
  const claimKey = `${sessionKey}:${crypto.randomUUID()}`;
  const session = {
    id: sessionKey,
    owner_id: user.id,
    package_id: packageEntry.record.id || packageId,
    care_package_id: packageEntry.record.id || packageId,
    mother_id: packageEntry.record.mother_id || appointment.record.mother_id || null,
    appointment_id: appointmentId,
    encounter_id: encounterId,
    source: 'encounter',
    request_key: sessionKey,
    consumed_at: now,
    used_at: now,
    created_at: now,
    updated_at: now,
  };

  let results;
  try {
    results = await database.batch([
      packageClaimStatement(database, {
        packageKey: packageEntry.key,
        ownerId: user.id,
        expectedUsed,
        claimKey,
        now,
      }),
      sessionInsertStatement(database, {
        sessionKey,
        ownerId: user.id,
        packageKey: packageEntry.key,
        claimKey,
        recordJson: JSON.stringify(session),
        now,
      }),
      packageClaimCleanupStatement(database, {
        packageKey: packageEntry.key,
        ownerId: user.id,
        claimKey,
        now,
      }),
    ]);
  } catch (error) {
    console.error('atomic encounter package finalization failed', error);
    const replay = await encounterSession(database, user.id, packageId, encounterId);
    if (replay) {
      const current = (await ownedRecord(database, 'care_packages', packageId, user.id))?.record || packageEntry.record;
      return runtimeJson(200, responsePayload(mode, current, { idempotent: true }));
    }
    return runtimeJson(503, { message: 'Não foi possível finalizar a consulta do plano. Tente novamente.' });
  }

  const claimChanges = changes(results?.[0]);
  const insertChanges = changes(results?.[1]);
  const persisted = await encounterSession(database, user.id, packageId, encounterId);
  const current = (await ownedRecord(database, 'care_packages', packageId, user.id))?.record || packageEntry.record;

  if (claimChanges === 1 && persisted && (insertChanges === 1 || insertChanges === null)) {
    return runtimeJson(200, responsePayload(mode, current, { idempotent: false }));
  }

  if (persisted) return runtimeJson(200, responsePayload(mode, current, { idempotent: true }));
  return runtimeJson(409, { message: 'Plano sem consultas disponíveis.' });
}
