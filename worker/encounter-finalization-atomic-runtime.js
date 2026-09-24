import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import {
  guardedRecordStatement,
  idempotencyInsertStatement,
  idempotencyResponse,
  isIdempotencyConflict,
  recordByIdForOwner,
} from './d1-record-store.js';

const PATH = '/api/clinical/rpc/finalize_clinical_encounter_atomic';
const OPERATION = 'finalize_clinical_encounter_atomic';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function target(request, url) {
  return request.method === 'POST' && url.pathname === PATH;
}

function cleanObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export async function handleAtomicClinicalEncounterFinalization(request, env, url = new URL(request.url)) {
  if (!target(request, url)) return null;
  if (!env.CLINICAL_DB) return json(503, { error: 'cloudflare_d1_required' });
  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return json(401, { error: 'cloudflare_auth_required' });

  const input = await request.clone().json().catch(() => null);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json(400, { error: 'invalid_payload' });
  const appointmentId = String(input.p_appointment_id || '').trim();
  const encounterId = String(input.p_encounter_id || '').trim();
  const requestKey = String(input.p_request_key || '').trim();
  if (!appointmentId || !encounterId) return json(400, { error: 'invalid_payload', message: 'Agendamento e prontuário são obrigatórios.' });

  const db = env.CLINICAL_DB;
  if (requestKey) {
    const replay = await idempotencyResponse(db, user.id, OPERATION, requestKey);
    if (replay) return json(200, { ...replay, idempotent: true });
  }

  const [appointmentEntry, encounterEntry] = await Promise.all([
    recordByIdForOwner(db, 'appointments', appointmentId, user.id),
    recordByIdForOwner(db, 'clinical_encounters', encounterId, user.id),
  ]);
  if (!appointmentEntry || !encounterEntry) return json(404, { error: 'clinical_record_not_found' });
  if (String(encounterEntry.record?.appointment_id || '') !== appointmentId) {
    return json(409, { error: 'record_relationship_mismatch', message: 'O prontuário não pertence ao agendamento informado.' });
  }
  const motherId = String(appointmentEntry.record?.mother_id || encounterEntry.record?.mother_id || '');
  if (!motherId || String(encounterEntry.record?.mother_id || '') !== motherId) {
    return json(409, { error: 'record_relationship_mismatch', message: 'O prontuário não pertence à paciente informada.' });
  }

  const alreadyFinalized = String(encounterEntry.record?.status || '').toLowerCase() === 'finalized';
  if (alreadyFinalized) {
    return json(200, { appointment_id: appointmentId, encounter_id: encounterId, idempotent: true });
  }

  const now = new Date().toISOString();
  const appointmentPatch = cleanObject(input.p_appointment_patch);
  const encounterPatch = cleanObject(input.p_encounter_patch);
  const appointment = {
    ...appointmentEntry.record,
    ...appointmentPatch,
    id: appointmentEntry.record.id || appointmentId,
    mother_id: motherId,
    owner_id: user.id,
    status: 'Realizado',
    updated_at: now,
  };
  const encounter = {
    ...encounterEntry.record,
    ...encounterPatch,
    id: encounterEntry.record.id || encounterId,
    mother_id: motherId,
    appointment_id: appointmentId,
    owner_id: user.id,
    status: 'finalized',
    updated_at: now,
  };

  const statements = [
    guardedRecordStatement(db, 'appointments', appointmentEntry.key, appointment, user.id, now),
    guardedRecordStatement(db, 'clinical_encounters', encounterEntry.key, encounter, user.id, now),
  ];

  const seenBabies = new Set();
  for (const raw of Array.isArray(input.p_weights) ? input.p_weights : []) {
    const babyId = String(raw?.baby_id || '').trim();
    const weightG = Number(raw?.weight_g || 0);
    if (!babyId || !(weightG > 0) || seenBabies.has(babyId)) continue;
    seenBabies.add(babyId);
    const babyEntry = await recordByIdForOwner(db, 'babies', babyId, user.id);
    if (!babyEntry || String(babyEntry.record?.mother_id || '') !== motherId) {
      return json(409, { error: 'record_relationship_mismatch', field: 'baby_id' });
    }
    const measuredAt = raw.measured_at || encounter.occurred_at || appointment.starts_at || now;
    const weightId = `encounter:${encounterId}:weight:${babyId}`;
    const weight = {
      id: weightId,
      owner_id: user.id,
      mother_id: motherId,
      baby_id: babyId,
      encounter_id: encounterId,
      measured_at: measuredAt,
      weight_g: weightG,
      created_at: now,
      updated_at: now,
    };
    const baby = { ...babyEntry.record, owner_id: user.id, current_weight_g: weightG, updated_at: now };
    statements.push(guardedRecordStatement(db, 'weights', weightId, weight, user.id, now));
    statements.push(guardedRecordStatement(db, 'babies', babyEntry.key, baby, user.id, now));
  }

  const followupPatch = cleanObject(input.p_followup);
  if (followupPatch.due_at) {
    const followupId = `encounter:${encounterId}:followup`;
    const followup = {
      id: followupId,
      owner_id: user.id,
      mother_id: motherId,
      baby_id: followupPatch.baby_id || null,
      encounter_id: encounterId,
      due_at: followupPatch.due_at,
      notes: followupPatch.notes || '',
      status: 'Pendente',
      created_at: now,
      updated_at: now,
    };
    statements.push(guardedRecordStatement(db, 'followups', followupId, followup, user.id, now));
  }

  const financialPatch = cleanObject(input.p_financial);
  const billingMode = String(appointmentEntry.record?.billing_mode || 'individual');
  const packageMode = billingMode === 'package_active' || billingMode === 'package_new';
  if (!packageMode && Number(financialPatch.amount_cents || 0) > 0) {
    const financialId = `encounter:${encounterId}:financial`;
    const financial = {
      id: financialId,
      owner_id: user.id,
      mother_id: motherId,
      appointment_id: appointmentId,
      encounter_id: encounterId,
      description: financialPatch.description || appointment.appointment_type || 'Atendimento',
      amount_cents: Number(financialPatch.amount_cents || 0),
      due_at: financialPatch.due_at || String(appointment.starts_at || now).slice(0, 10),
      status: 'Pendente',
      paid: false,
      created_at: now,
      updated_at: now,
    };
    statements.push(guardedRecordStatement(db, 'financial_entries', financialId, financial, user.id, now));
  }

  const result = { appointment_id: appointmentId, encounter_id: encounterId };
  if (requestKey) statements.push(idempotencyInsertStatement(db, user.id, OPERATION, requestKey, result, now));

  try {
    await db.batch(statements);
  } catch (error) {
    if (requestKey && isIdempotencyConflict(error)) {
      const replay = await idempotencyResponse(db, user.id, OPERATION, requestKey);
      if (replay) return json(200, { ...replay, idempotent: true });
    }
    console.error('atomic encounter finalization failed', error);
    return json(500, { error: 'encounter_finalization_failed', message: 'Não foi possível finalizar o atendimento.' });
  }

  return json(200, result);
}
