import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { ownerRows, recordById, recordByIdForOwner, unownedRows } from './d1-record-store.js';
import { handleGenericCrudPolicy } from './generic-crud-policy-runtime.js';

const REFERENCES = Object.freeze([
  ['mother_id', 'mothers'],
  ['baby_id', 'babies'],
  ['appointment_id', 'appointments'],
  ['encounter_id', 'clinical_encounters'],
  ['care_package_id', 'care_packages'],
  ['package_id', 'care_packages'],
]);
const CLINICAL_RECORDS_PREFIX = '/api/clinical/records/';
const CLINICAL_RPC_PREFIX = '/api/clinical/rpc/';
const RELATIONAL_APPOINTMENT_RPCS = new Set([
  'schedule_clinical_appointment',
  'start_clinical_encounter',
]);
const RELATIONAL_RPC_NAMES = new Set([
  ...RELATIONAL_APPOINTMENT_RPCS,
  'finalize_encounter_billing',
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

export async function validateRelationalRow(env, row, userId) {
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
    if (!encounterAppointment || encounterAppointment !== String(row.appointment_id)) {
      return json(409, { error: 'record_relationship_mismatch', message: 'O atendimento não pertence ao agendamento informado.' });
    }
  }

  return null;
}

function compareValue(actual, operator, expected) {
  if (operator === 'eq') return String(actual ?? '') === expected;
  if (operator === 'neq') return String(actual ?? '') !== expected;
  if (operator === 'is') return expected === 'null' ? actual == null : String(actual) === expected;
  if (operator === 'not') {
    if (expected === 'is.null') return actual != null;
    return String(actual ?? '') !== expected;
  }
  if (operator === 'in') {
    const values = expected.replace(/^\(|\)$/g, '').split(',').map((item) => decodeURIComponent(item.trim().replace(/^"|"$/g, '')));
    return values.includes(String(actual ?? ''));
  }
  if (operator === 'like' || operator === 'ilike') {
    const pattern = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
    return new RegExp(`^${pattern}$`, operator === 'ilike' ? 'i' : '').test(String(actual ?? ''));
  }
  const aNum = Number(actual), eNum = Number(expected);
  const numeric = Number.isFinite(aNum) && Number.isFinite(eNum);
  const a = numeric ? aNum : String(actual ?? ''), e = numeric ? eNum : expected;
  if (operator === 'gt') return a > e;
  if (operator === 'gte') return a >= e;
  if (operator === 'lt') return a < e;
  if (operator === 'lte') return a <= e;
  return true;
}

function queryMatches(row, url) {
  for (const [field, raw] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(field) || field === 'or') continue;
    const value = String(raw || '');
    let operator = 'eq', expected = value;
    const firstDot = value.indexOf('.');
    if (firstDot > 0) {
      operator = value.slice(0, firstDot);
      expected = value.slice(firstDot + 1);
    }
    if (!compareValue(row?.[field], operator, expected)) return false;
  }
  return true;
}

async function scopedRows(env, table, userId) {
  const direct = await ownerRows(env.CLINICAL_DB, table, userId);
  const accepted = [...direct];
  for (const entry of await unownedRows(env.CLINICAL_DB, table)) {
    const identity = entry.record?.id || entry.key;
    if (identity && await ownedRecord(env, table, identity, userId)) accepted.push(entry);
  }
  return accepted;
}

async function validatePatchFinalState(env, url, patch, userId) {
  const table = decodeURIComponent(url.pathname.slice(CLINICAL_RECORDS_PREFIX.length)).split('/')[0];
  if (!table) return json(400, { error: 'invalid_table' });
  for (const entry of await scopedRows(env, table, userId)) {
    if (!queryMatches(entry.record, url)) continue;
    if (table === 'clinical_encounters'
      && String(entry.record?.status || '').toLowerCase() === 'finalized'
      && patch.status != null
      && String(patch.status).toLowerCase() !== 'finalized') {
      return json(409, {
        error: 'encounter_state_regression',
        message: 'Um prontuário finalizado não pode voltar para rascunho.',
      });
    }
    const rejected = await validateRelationalRow(env, { ...entry.record, ...patch }, userId);
    if (rejected) return rejected;
  }
  return null;
}

async function validateAppointmentRpc(env, input, userId) {
  const motherId = input?.p_mother_id;
  const babyIds = Array.isArray(input?.p_baby_ids) ? [...new Set(input.p_baby_ids.filter(Boolean))] : [];
  if (!motherId) return json(400, { error: 'invalid_payload', field: 'mother_id' });
  if (!babyIds.length) return validateRelationalRow(env, { mother_id: motherId }, userId);
  for (const babyId of babyIds) {
    const rejected = await validateRelationalRow(env, { mother_id: motherId, baby_id: babyId }, userId);
    if (rejected) return rejected;
  }
  return null;
}

async function validateFinalizeBillingRpc(env, input, userId) {
  const appointmentId = String(input?.p_appointment_id || '').trim();
  const encounterId = String(input?.p_encounter_id || '').trim();
  if (!appointmentId) return null;
  const appointment = await ownedRecord(env, 'appointments', appointmentId, userId);
  if (!appointment) return json(403, { error: 'record_relationship_outside_account', field: 'appointment_id' });

  const billingMode = String(appointment.record?.billing_mode || 'individual');
  const packageMode = billingMode === 'package_active' || billingMode === 'package_new';
  if (packageMode && !encounterId) {
    return json(400, {
      error: 'invalid_payload',
      field: 'encounter_id',
      message: 'Prontuário obrigatório para finalizar uma sessão de pacote.',
    });
  }
  if (!encounterId) return null;

  return validateRelationalRow(env, {
    mother_id: appointment.record?.mother_id || null,
    appointment_id: appointmentId,
    encounter_id: encounterId,
    package_id: appointment.record?.package_id || null,
  }, userId);
}

export async function handleRelationalIntegrityGuard(request, env, url = new URL(request.url), deps = {}) {
  if (!env.CLINICAL_DB) return null;
  if (!['POST', 'PATCH'].includes(request.method)) return null;

  const recordsRequest = url.pathname.startsWith(CLINICAL_RECORDS_PREFIX);
  const rpcRequest = url.pathname.startsWith(CLINICAL_RPC_PREFIX);
  if (!recordsRequest && !rpcRequest) return null;

  // Generic CRUD policy must fail closed before relation validation. Otherwise a
  // forbidden domain-managed POST can leak a 403/409 from relationship checks and
  // never reach the explicit generic-mutation restriction.
  if (recordsRequest) {
    const policyResponse = handleGenericCrudPolicy(request, url);
    if (policyResponse) return policyResponse;
  }

  const rpcName = rpcRequest ? decodeURIComponent(url.pathname.slice(CLINICAL_RPC_PREFIX.length)) : '';
  if (rpcRequest && !RELATIONAL_RPC_NAMES.has(rpcName)) return null;

  const authenticate = deps.authenticate || authenticateClinicalRequest;
  const user = await authenticate(request, env);
  if (!user?.id) return json(401, { error: 'cloudflare_auth_required' });

  const input = await request.clone().json().catch(() => null);
  if (!input || typeof input !== 'object') return json(400, { error: 'invalid_payload' });

  if (rpcRequest) {
    if (RELATIONAL_APPOINTMENT_RPCS.has(rpcName)) return validateAppointmentRpc(env, input, user.id);
    if (rpcName === 'finalize_encounter_billing') return validateFinalizeBillingRpc(env, input, user.id);
    return null;
  }

  if (request.method === 'PATCH') {
    if (Array.isArray(input)) return json(400, { error: 'invalid_payload' });
    return validatePatchFinalState(env, url, input, user.id);
  }

  const rows = Array.isArray(input) ? input : [input];
  for (const row of rows) {
    const rejected = await validateRelationalRow(env, row, user.id);
    if (rejected) return rejected;
  }
  return null;
}
