import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { guardedRecordStatement, ownerRows, recordByIdForOwner } from './d1-record-store.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function targetRequest(request, url) {
  return request.method === 'POST'
    && url.pathname === '/api/clinical/rpc/start_clinical_encounter_from_appointment';
}

export async function handleAtomicAppointmentEncounterStart(request, env, url = new URL(request.url)) {
  if (!targetRequest(request, url)) return null;
  if (!env.CLINICAL_DB) return json(503, { error: 'cloudflare_d1_required' });

  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return json(401, { error: 'cloudflare_auth_required' });

  const input = await request.clone().json().catch(() => null);
  const appointmentId = String(input?.p_appointment_id || '');
  if (!appointmentId) return json(400, { message: 'Agendamento é obrigatório.' });

  const db = env.CLINICAL_DB;
  const appointment = await recordByIdForOwner(db, 'appointments', appointmentId, user.id);
  if (!appointment) return json(404, { message: 'Agendamento não encontrado.' });

  const existing = (await ownerRows(db, 'clinical_encounters', user.id))
    .find((entry) => entry.record?.appointment_id === appointmentId && entry.record?.status !== 'cancelled');
  if (existing) {
    if (appointment.record?.status !== 'Em atendimento') {
      const now = new Date().toISOString();
      const healed = { ...appointment.record, owner_id: user.id, status: 'Em atendimento', updated_at: now };
      await db.batch([guardedRecordStatement(db, 'appointments', appointment.key, healed, user.id, now)]);
    }
    return json(200, { appointment_id: appointmentId, encounter_id: existing.record.id });
  }

  const babyIds = (await ownerRows(db, 'appointment_babies', user.id))
    .filter((entry) => entry.record?.appointment_id === appointmentId)
    .map((entry) => entry.record?.baby_id)
    .filter(Boolean);

  const now = new Date().toISOString();
  const encounterId = crypto.randomUUID();
  const encounter = {
    id: encounterId,
    mother_id: appointment.record.mother_id,
    baby_id: babyIds.length === 1 ? babyIds[0] : appointment.record.baby_id || null,
    appointment_id: appointmentId,
    status: 'draft',
    occurred_at: appointment.record.starts_at || now,
    owner_id: user.id,
    created_at: now,
    updated_at: now,
  };
  const updatedAppointment = {
    ...appointment.record,
    owner_id: user.id,
    status: 'Em atendimento',
    updated_at: now,
  };

  const statements = [
    guardedRecordStatement(db, 'clinical_encounters', encounterId, encounter, user.id, now),
    ...babyIds.map((babyId, index) => {
      const link = {
        encounter_id: encounterId,
        baby_id: babyId,
        is_primary: index === 0,
        owner_id: user.id,
        created_at: now,
        updated_at: now,
      };
      return guardedRecordStatement(db, 'clinical_encounter_babies', `${encounterId}|${babyId}`, link, user.id, now);
    }),
    guardedRecordStatement(db, 'appointments', appointment.key, updatedAppointment, user.id, now),
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    console.error('atomic appointment start failed', error);
    return json(500, { error: 'appointment_start_failed', message: 'Não foi possível iniciar o atendimento.' });
  }

  return json(200, { appointment_id: appointmentId, encounter_id: encounterId });
}
