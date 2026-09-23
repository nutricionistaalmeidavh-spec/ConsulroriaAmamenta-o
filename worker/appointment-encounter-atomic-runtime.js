import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import {
  guardedRecordStatement,
  idempotencyInsertStatement,
  idempotencyResponse,
  isIdempotencyConflict,
  ownerRows,
  recordByIdForOwner,
} from './d1-record-store.js';

const START_NEW_PATH = '/api/clinical/rpc/start_clinical_encounter';
const START_SCHEDULED_PATH = '/api/clinical/rpc/start_clinical_encounter_from_appointment';
const START_OPERATION = 'start_clinical_encounter';
const TERMINAL_APPOINTMENT_STATUSES = new Set(['Realizado', 'Finalizado', 'Cancelado']);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function targetRequest(request, url) {
  return request.method === 'POST'
    && (url.pathname === START_NEW_PATH || url.pathname === START_SCHEDULED_PATH);
}

function uniqueBabyIds(input) {
  return [...new Set((Array.isArray(input?.p_baby_ids) ? input.p_baby_ids : []).map(String).filter(Boolean))];
}

async function deterministicEncounterId(userId, appointmentId) {
  const payload = new TextEncoder().encode(`clinical-encounter|${userId}|${appointmentId}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
  const bytes = digest.slice(0, 16);
  // Keep the stable appointment-derived identity inside the UUID contract consumed by the UI.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function appointmentRow(input, appointmentId, userId, now) {
  const babyIds = uniqueBabyIds(input);
  return {
    id: appointmentId,
    mother_id: input.p_mother_id,
    baby_id: babyIds.length === 1 ? babyIds[0] : null,
    starts_at: input.p_starts_at || now,
    duration_min: Number(input.p_duration_min || 60),
    appointment_type: input.p_appointment_type || 'Atendimento',
    format: input.p_format || 'Domiciliar',
    value_cents: Number(input.p_value_cents || 0),
    payment_status: input.p_payment_status || (Number(input.p_value_cents || 0) > 0 ? 'Pendente' : 'Sem cobrança'),
    address: input.p_address || '',
    notes: input.p_notes || '',
    status: 'Em atendimento',
    owner_id: userId,
    created_at: now,
    updated_at: now,
  };
}

function encounterRow({ encounterId, appointmentId, appointment, babyIds, userId, now }) {
  return {
    id: encounterId,
    mother_id: appointment.mother_id,
    baby_id: babyIds.length === 1 ? babyIds[0] : appointment.baby_id || null,
    appointment_id: appointmentId,
    status: 'draft',
    occurred_at: appointment.starts_at || now,
    owner_id: userId,
    created_at: now,
    updated_at: now,
  };
}

function linkStatements(db, table, parentField, parentId, babyIds, userId, now) {
  return babyIds.map((babyId, index) => {
    const row = {
      [parentField]: parentId,
      baby_id: babyId,
      is_primary: index === 0,
      owner_id: userId,
      created_at: now,
      updated_at: now,
    };
    return guardedRecordStatement(db, table, `${parentId}|${babyId}`, row, userId, now);
  });
}

async function startNewEncounter(input, user, env) {
  const db = env.CLINICAL_DB;
  const requestKey = String(input?.p_request_key || '').trim();
  if (requestKey) {
    const replay = await idempotencyResponse(db, user.id, START_OPERATION, requestKey);
    if (replay) return json(200, { ...replay, idempotent: true });
  }

  const now = new Date().toISOString();
  const appointmentId = crypto.randomUUID();
  const encounterId = crypto.randomUUID();
  const babyIds = uniqueBabyIds(input);
  const appointment = appointmentRow(input, appointmentId, user.id, now);
  const encounter = encounterRow({ encounterId, appointmentId, appointment, babyIds, userId: user.id, now });
  const result = { appointment_id: appointmentId, encounter_id: encounterId };
  const statements = [
    guardedRecordStatement(db, 'appointments', appointmentId, appointment, user.id, now),
    ...linkStatements(db, 'appointment_babies', 'appointment_id', appointmentId, babyIds, user.id, now),
    guardedRecordStatement(db, 'clinical_encounters', encounterId, encounter, user.id, now),
    ...linkStatements(db, 'clinical_encounter_babies', 'encounter_id', encounterId, babyIds, user.id, now),
  ];
  if (requestKey) statements.push(idempotencyInsertStatement(db, user.id, START_OPERATION, requestKey, result, now));

  try {
    await db.batch(statements);
  } catch (error) {
    if (requestKey && isIdempotencyConflict(error)) {
      const replay = await idempotencyResponse(db, user.id, START_OPERATION, requestKey);
      if (replay) return json(200, { ...replay, idempotent: true });
    }
    console.error('atomic new encounter start failed', error);
    return json(500, { error: 'appointment_start_failed', message: 'Não foi possível iniciar o atendimento.' });
  }
  return json(200, result);
}

async function startScheduledEncounter(input, user, env) {
  const appointmentId = String(input?.p_appointment_id || '').trim();
  if (!appointmentId) return json(400, { message: 'Agendamento é obrigatório.' });
  const db = env.CLINICAL_DB;
  const appointmentEntry = await recordByIdForOwner(db, 'appointments', appointmentId, user.id);
  if (!appointmentEntry) return json(404, { message: 'Agendamento não encontrado.' });

  const existing = (await ownerRows(db, 'clinical_encounters', user.id))
    .find((entry) => entry.record?.appointment_id === appointmentId && entry.record?.status !== 'cancelled');
  if (existing) {
    const terminal = String(existing.record?.status || '').toLowerCase() === 'finalized'
      || TERMINAL_APPOINTMENT_STATUSES.has(String(appointmentEntry.record?.status || ''));
    if (!terminal && appointmentEntry.record?.status !== 'Em atendimento') {
      const now = new Date().toISOString();
      const healed = { ...appointmentEntry.record, owner_id: user.id, status: 'Em atendimento', updated_at: now };
      await db.batch([guardedRecordStatement(db, 'appointments', appointmentEntry.key, healed, user.id, now)]);
    }
    return json(200, { appointment_id: appointmentId, encounter_id: existing.record.id, idempotent: true });
  }

  if (TERMINAL_APPOINTMENT_STATUSES.has(String(appointmentEntry.record?.status || ''))) {
    return json(409, { error: 'appointment_terminal', message: 'Este agendamento já está encerrado.' });
  }

  const babyIds = (await ownerRows(db, 'appointment_babies', user.id))
    .filter((entry) => entry.record?.appointment_id === appointmentId)
    .map((entry) => entry.record?.baby_id)
    .filter(Boolean);
  if (!babyIds.length && appointmentEntry.record?.baby_id) babyIds.push(appointmentEntry.record.baby_id);

  const now = new Date().toISOString();
  // One stable UUID per owner+appointment makes the storage constraint the concurrency guard
  // without breaking consumers that require persisted clinical identifiers in UUID format.
  const encounterId = await deterministicEncounterId(user.id, appointmentId);
  const encounter = encounterRow({
    encounterId,
    appointmentId,
    appointment: appointmentEntry.record,
    babyIds,
    userId: user.id,
    now,
  });
  const updatedAppointment = {
    ...appointmentEntry.record,
    owner_id: user.id,
    status: 'Em atendimento',
    updated_at: now,
  };
  const statements = [
    guardedRecordStatement(db, 'clinical_encounters', encounterId, encounter, user.id, now),
    ...linkStatements(db, 'clinical_encounter_babies', 'encounter_id', encounterId, babyIds, user.id, now),
    guardedRecordStatement(db, 'appointments', appointmentEntry.key, updatedAppointment, user.id, now),
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    console.error('atomic scheduled encounter start failed', error);
    return json(500, { error: 'appointment_start_failed', message: 'Não foi possível iniciar o atendimento.' });
  }
  return json(200, { appointment_id: appointmentId, encounter_id: encounterId });
}

export async function handleAtomicAppointmentEncounterStart(request, env, url = new URL(request.url)) {
  if (!targetRequest(request, url)) return null;
  if (!env.CLINICAL_DB) return json(503, { error: 'cloudflare_d1_required' });
  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return json(401, { error: 'cloudflare_auth_required' });
  const input = await request.clone().json().catch(() => null);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json(400, { error: 'invalid_payload' });
  if (url.pathname === START_NEW_PATH) return startNewEncounter(input, user, env);
  return startScheduledEncounter(input, user, env);
}
