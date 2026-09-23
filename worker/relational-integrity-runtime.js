import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { recordById, recordByIdForOwner } from './d1-record-store.js';

const REFERENCES = Object.freeze([
  ['mother_id', 'mothers'],
  ['baby_id', 'babies'],
  ['appointment_id', 'appointments'],
  ['encounter_id', 'clinical_encounters'],
  ['care_package_id', 'care_packages'],
  ['package_id', 'care_packages'],
]);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function directOwner(entry) {
  return String(entry?.ownerId || entry?.record?.owner_id || entry?.record?.user_id || '');
}

async function ownedRecord(env, table, id, userId, depth = 0) {
  if (!id || !userId || depth > 5) return null;
  const direct = await recordByIdForOwner(env.CLINICAL_DB, table, id, userId);
  if (direct) return direct;

  const entry = await recordById(env.CLINICAL_DB, table, id);
  if (!entry) return null;
  const owner = directOwner(entry);
  if (owner) return owner === String(userId) ? entry : null;
  if (table === 'professional_profiles' && String(entry.record?.id || entry.key || '') === String(userId)) return entry;

  for (const [field, parentTable] of REFERENCES) {
    const parentId = entry.record?.[field];
    if (!parentId) continue;
    const parent = await ownedRecord(env, parentTable, parentId, userId, depth + 1);
    if (parent) return entry;
  }
  return null;
}

function motherIdFor(table, entry) {
  const row = entry?.record || {};
  if (table === 'mothers') return String(row.id || entry?.key || '');
  return String(row.mother_id || '');
}

async function validateRow(env, row, userId) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return json(400, { error: 'invalid_payload' });
  if (row.owner_id && String(row.owner_id) !== String(userId)) {
    return json(403, { error: 'record_relationship_outside_account' });
  }

  const mothers = new Set();
  for (const [field, table] of REFERENCES) {
    const id = row[field];
    if (!id) continue;
    const entry = await ownedRecord(env, table, id, userId);
    if (!entry) return json(403, { error: 'record_relationship_outside_account', field });
    const motherId = motherIdFor(table, entry);
    if (motherId) mothers.add(motherId);
  }

  if (mothers.size > 1) {
    return json(409, { error: 'record_relationship_mismatch', message: 'Os vínculos informados não pertencem à mesma paciente.' });
  }

  if (row.encounter_id && row.appointment_id) {
    const encounter = await ownedRecord(env, 'clinical_encounters', row.encounter_id, userId);
    const encounterAppointment = String(encounter?.record?.appointment_id || '');
    if (encounterAppointment && encounterAppointment !== String(row.appointment_id)) {
      return json(409, { error: 'record_relationship_mismatch', message: 'O atendimento não pertence ao agendamento informado.' });
    }
  }

  return null;
}

export async function handleRelationalIntegrityGuard(request, env, url = new URL(request.url), deps = {}) {
  if (!env.CLINICAL_DB) return null;
  if (!['POST', 'PATCH'].includes(request.method)) return null;
  if (!url.pathname.startsWith('/api/clinical/records/')) return null;

  const authenticate = deps.authenticate || authenticateClinicalRequest;
  const user = await authenticate(request, env);
  if (!user?.id) return json(401, { error: 'cloudflare_auth_required' });

  const input = await request.clone().json().catch(() => null);
  if (!input || typeof input !== 'object') return json(400, { error: 'invalid_payload' });
  const rows = Array.isArray(input) ? input : [input];
  for (const row of rows) {
    const rejected = await validateRow(env, row, user.id);
    if (rejected) return rejected;
  }
  return null;
}
