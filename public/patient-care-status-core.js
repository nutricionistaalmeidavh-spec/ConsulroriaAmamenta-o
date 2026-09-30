export const CARE_ACTIVE = 'active';
export const CARE_FINALIZED = 'finalized';

function motherFrom(value = {}) {
  return value?.mother && typeof value.mother === 'object' ? value.mother : value || {};
}

export function normalizePatientCareStatus(value = {}) {
  return String(motherFrom(value).care_status || '').toLowerCase() === CARE_FINALIZED
    ? CARE_FINALIZED
    : CARE_ACTIVE;
}

export function isPatientCareActive(value = {}) {
  return normalizePatientCareStatus(value) === CARE_ACTIVE;
}

export function patientCareLabel(value = {}) {
  return isPatientCareActive(value) ? 'Em acompanhamento' : 'Finalizado';
}

export function activePatientCount(patients = []) {
  return (Array.isArray(patients) ? patients : []).filter(isPatientCareActive).length;
}

export function patientCarePatch(status, now = new Date().toISOString()) {
  if (status === CARE_FINALIZED) {
    return { care_status: CARE_FINALIZED, care_finalized_at: now };
  }
  if (status === CARE_ACTIVE) {
    return { care_status: CARE_ACTIVE, care_finalized_at: null };
  }
  throw new Error('Status de acompanhamento inválido.');
}

export async function persistPatientCareStatus(repositories, motherId, status, { now } = {}) {
  if (!repositories?.mothers?.update) throw new Error('Repositório de pacientes indisponível.');
  if (!motherId) throw new Error('Paciente não identificada.');
  const patch = patientCarePatch(status, now || new Date().toISOString());
  return repositories.mothers.update(motherId, patch);
}
