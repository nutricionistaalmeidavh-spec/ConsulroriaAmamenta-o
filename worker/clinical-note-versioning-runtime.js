import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { guardedRecordStatement, recordByIdForOwner } from './d1-record-store.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function recordsTable(url) {
  if (!url.pathname.startsWith('/api/clinical/records/')) return '';
  return decodeURIComponent(url.pathname.slice('/api/clinical/records/'.length).split('/')[0] || '');
}

function exactId(url) {
  const raw = String(url.searchParams.get('id') || '');
  return raw.startsWith('eq.') ? decodeURIComponent(raw.slice(3)) : '';
}

function currentVersion(record) {
  const value = Number(record?.record_version ?? 0);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function cleanPatch(input) {
  const patch = { ...(input || {}) };
  delete patch._expected_version;
  delete patch._date_correction_reason;
  return patch;
}

function validEncounterDate(raw, now) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)) return '';
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || new Date(parsed).getUTCFullYear() < 2000 || parsed > Date.parse(now) + 5 * 60000) return '';
  return new Date(parsed).toISOString();
}

function dateCorrectionAudit({ before, nextDate, encounterId, user, now, reason }) {
  return {
    id: crypto.randomUUID(),
    owner_id: user.id,
    encounter_id: encounterId,
    appointment_id: before.appointment_id || null,
    previous_occurred_at: before.occurred_at || null,
    corrected_occurred_at: nextDate,
    changed_at: now,
    professional_id: user.id,
    author_email: user.email || '',
    reason: String(reason || '').trim().slice(0, 500) || 'Correção de data informada pela profissional',
    created_at: now,
    updated_at: now,
  };
}

function noteChanged(before, patch) {
  return Object.prototype.hasOwnProperty.call(patch, 'clinical_note')
    && String(patch.clinical_note ?? '') !== String(before?.clinical_note ?? '');
}

function revisionRecord({ encounter, encounterId, user, beforeVersion, afterVersion, patch, now }) {
  return {
    id: crypto.randomUUID(),
    owner_id: user.id,
    encounter_id: encounterId,
    previous_clinical_note: String(encounter?.clinical_note ?? ''),
    previous_version: beforeVersion,
    resulting_version: afterVersion,
    changed_at: now,
    professional_id: patch.clinical_note_author_id || encounter?.professional_id || user.id,
    author_email: patch.clinical_note_author_email || encounter?.clinical_note_author_email || user.email || '',
    created_at: now,
    updated_at: now,
  };
}

async function handleEncounterPatch(request, env, url) {
  const encounterId = exactId(url);
  if (!encounterId) {
    return json(400, {
      error: 'exact_encounter_id_required',
      message: 'Atualizações de prontuário exigem um encounter_id exato.',
    });
  }

  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return json(401, { error: 'cloudflare_auth_required' });
  const input = await request.clone().json().catch(() => null);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json(400, { error: 'invalid_payload' });

  const entry = await recordByIdForOwner(env.CLINICAL_DB, 'clinical_encounters', encounterId, user.id);
  if (!entry) return json(404, { error: 'clinical_record_not_found' });

  const before = entry.record || {};
  const beforeVersion = currentVersion(before);
  if (!Object.prototype.hasOwnProperty.call(input, '_expected_version')) {
    return json(409, {
      error: 'record_version_required',
      current_version: beforeVersion,
      message: 'Recarregue o prontuário antes de salvar novamente.',
    });
  }
  const expectedVersion = Number(input._expected_version);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== beforeVersion) {
    return json(409, {
      error: 'stale_record_version',
      current_version: beforeVersion,
      message: 'O prontuário foi alterado em outra sessão. Recarregue antes de salvar.',
    });
  }

  const patch = cleanPatch(input);
  const beforeStatus = String(before.status || '').toLowerCase();
  const afterStatus = String(patch.status ?? before.status ?? '').toLowerCase();
  if (beforeStatus === 'finalized' && afterStatus !== 'finalized') {
    return json(409, {
      error: 'finalized_encounter_is_immutable',
      message: 'Um atendimento finalizado não pode voltar ao estado de rascunho.',
    });
  }

  const now = new Date().toISOString();
  const correctingDate = Object.prototype.hasOwnProperty.call(patch, 'occurred_at');
  const nextDate = correctingDate ? validEncounterDate(patch.occurred_at, now) : '';
  if (correctingDate && !nextDate) {
    return json(400, { error: 'invalid_encounter_date', message: 'Informe uma data válida, não futura, para o atendimento.' });
  }
  const dateChanged = correctingDate && Date.parse(nextDate) !== Date.parse(before.occurred_at || '');
  let appointmentEntry = null;
  if (dateChanged && before.appointment_id) {
    appointmentEntry = await recordByIdForOwner(env.CLINICAL_DB, 'appointments', before.appointment_id, user.id);
    if (!appointmentEntry || appointmentEntry.record?.mother_id !== before.mother_id) {
      return json(409, { error: 'appointment_link_invalid', message: 'O agendamento vinculado não foi encontrado. Nenhuma data foi alterada.' });
    }
  }
  if (correctingDate) {
    patch.occurred_at = nextDate;
    patch.identification = { ...(before.identification || {}), ...(patch.identification || {}), startsAt: nextDate };
  }
  const afterVersion = beforeVersion + 1;
  const next = {
    ...before,
    ...patch,
    id: before.id || encounterId,
    owner_id: user.id,
    record_version: afterVersion,
    updated_at: now,
  };
  const statements = [];

  if (dateChanged) {
    const audit = dateCorrectionAudit({
      before, nextDate, encounterId, user, now, reason: input._date_correction_reason,
    });
    statements.push(guardedRecordStatement(
      env.CLINICAL_DB, 'clinical_encounter_date_revisions', audit.id, audit, user.id, now,
    ));
    if (appointmentEntry) {
      statements.push(guardedRecordStatement(
        env.CLINICAL_DB,
        'appointments',
        appointmentEntry.key,
        { ...appointmentEntry.record, starts_at: nextDate, owner_id: user.id, updated_at: now },
        user.id,
        now,
      ));
    }
  }

  if (beforeStatus === 'finalized' && noteChanged(before, patch)) {
    const revision = revisionRecord({
      encounter: before,
      encounterId,
      user,
      beforeVersion,
      afterVersion,
      patch,
      now,
    });
    statements.push(guardedRecordStatement(
      env.CLINICAL_DB,
      'clinical_note_revisions',
      revision.id,
      revision,
      user.id,
      now,
    ));
  }

  statements.push(guardedRecordStatement(
    env.CLINICAL_DB,
    'clinical_encounters',
    entry.key,
    next,
    user.id,
    now,
  ));

  try {
    await env.CLINICAL_DB.batch(statements);
  } catch (error) {
    console.error('versioned clinical encounter patch failed', error);
    return json(500, {
      error: 'clinical_encounter_patch_failed',
      message: 'Não foi possível salvar o prontuário com segurança.',
    });
  }

  return json(200, [next]);
}

async function handleEncounterDelete(request, env, url) {
  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return json(401, { error: 'cloudflare_auth_required' });
  const encounterId = exactId(url);
  if (encounterId) {
    const entry = await recordByIdForOwner(env.CLINICAL_DB, 'clinical_encounters', encounterId, user.id);
    if (!entry) return json(404, { error: 'clinical_record_not_found' });
    if (String(entry.record?.status || '').toLowerCase() === 'finalized') {
      return json(409, {
        error: 'finalized_encounter_retained',
        message: 'Prontuários finalizados são mantidos para rastreabilidade clínica.',
      });
    }
  }
  return json(405, {
    error: 'generic_encounter_delete_not_allowed',
    message: 'Exclusão de prontuário exige uma operação clínica canônica.',
  });
}

export async function handleClinicalNoteVersioning(request, env, url = new URL(request.url)) {
  if (!env.CLINICAL_DB) return null;
  const table = recordsTable(url);
  if (!table) return null;

  if (table === 'clinical_note_revisions' && ['PATCH', 'DELETE'].includes(request.method)) {
    return json(405, {
      error: 'clinical_note_revision_immutable',
      message: 'Revisões do prontuário são imutáveis.',
    });
  }

  if (table !== 'clinical_encounters') return null;
  if (request.method === 'PATCH') return handleEncounterPatch(request, env, url);
  if (request.method === 'DELETE') return handleEncounterDelete(request, env, url);
  return null;
}
