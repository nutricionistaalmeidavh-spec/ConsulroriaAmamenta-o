const KPI_OLD = '<article class="lactation-kpi attention"><span>Follow-ups pendentes</span><strong data-kpi-followups>0</strong><small>contatos programados</small></article>';
const KPI_NEW = '<article class="lactation-kpi attention"><span>Pacientes em acompanhamento</span><strong data-kpi-active-patients>0</strong><small data-kpi-active-patients-meta>pacientes ativas</small></article>';
const ACTIONS_OLD = '<div class="patient-header-actions"><button class="ui-button ui-button-ghost" data-action="edit-patient">Editar</button><button class="ui-button ui-button-primary" data-action="new-appointment">Novo atendimento</button></div>';
const ACTIONS_NEW = '<div class="patient-header-actions"><button class="ui-button ui-button-ghost" data-action="edit-patient">Editar</button><button class="ui-button ui-button-ghost" data-action="toggle-patient-care" data-patient-care-toggle>Finalizar acompanhamento</button><button class="ui-button ui-button-primary" data-action="new-appointment">Novo atendimento</button></div>';

export function hardenPatientCareHtml(source) {
  let next = String(source);
  if (!next.includes('data-kpi-active-patients')) next = next.replace(KPI_OLD, KPI_NEW);
  if (!next.includes('data-patient-care-toggle')) next = next.replace(ACTIONS_OLD, ACTIONS_NEW);
  if (!next.includes('data-patient-care-status')) {
    next = next.replace(
      /(<p data-patient-subtitle>[^<]*<\/p>)/,
      '$1<span class="pill confirmed patient-care-status" data-patient-care-status>Em acompanhamento</span>'
    );
  }
  next = next
    .replace(/(<[^>]+data-nav-target="followups"[^>]*>\s*<span class="nav-icon">[^<]*<\/span>\s*<span>)Acompanhamentos(<\/span>)/g, '$1Follow-ups$2')
    .replace(/(<section class="lactation-screen" data-screen="followups"[\s\S]*?<h1>)Acompanhamentos(<\/h1>)/, '$1Follow-ups$2');
  return next;
}

const LEGACY_CARE_IMPORT = "import { CARE_ACTIVE, CARE_FINALIZED, activePatientCount, isPatientCareActive, patientCareLabel, persistPatientCareStatus } from '../../patient-care-status-core.js';";

// Keep this feature self-contained inside app-shell. The canonical app bootstrap executes
// app-shell from a blob URL and only rewrites its established ./lib/* imports. Introducing
// a new relative import outside that graph prevents the shell (and therefore login) from
// executing at all.
const CARE_RUNTIME_CORE = `
const CARE_ACTIVE = 'active';
const CARE_FINALIZED = 'finalized';
function patientCareMother(value = {}) {
  return value?.mother && typeof value.mother === 'object' ? value.mother : value || {};
}
function normalizePatientCareStatus(value = {}) {
  return String(patientCareMother(value).care_status || '').toLowerCase() === CARE_FINALIZED
    ? CARE_FINALIZED
    : CARE_ACTIVE;
}
function isPatientCareActive(value = {}) {
  return normalizePatientCareStatus(value) === CARE_ACTIVE;
}
function patientCareLabel(value = {}) {
  return isPatientCareActive(value) ? 'Em acompanhamento' : 'Finalizado';
}
function activePatientCount(patients = []) {
  return (Array.isArray(patients) ? patients : []).filter(isPatientCareActive).length;
}
function patientCarePatch(status, now = new Date().toISOString()) {
  if (status === CARE_FINALIZED) return { care_status: CARE_FINALIZED, care_finalized_at: now };
  if (status === CARE_ACTIVE) return { care_status: CARE_ACTIVE, care_finalized_at: null };
  throw new Error('Status de acompanhamento inválido.');
}
async function persistPatientCareStatus(repositories, motherId, status, { now } = {}) {
  if (!repositories?.mothers?.update) throw new Error('Repositório de pacientes indisponível.');
  if (!motherId) throw new Error('Paciente não identificada.');
  const patch = patientCarePatch(status, now || new Date().toISOString());
  return repositories.mothers.update(motherId, patch);
}
`;

const RUNTIME_HELPERS = `
function updateActivePatientsKpi() {
  const count = activePatientCount(state.patients);
  setText('[data-kpi-active-patients]', String(count));
  setText('[data-kpi-active-patients-meta]', count === 1 ? '1 paciente ativa' : \`${'${count}'} pacientes ativas\`);
}
function renderPatientCareControls(patient) {
  const active = isPatientCareActive(patient);
  const status = document.querySelector('[data-patient-care-status]');
  const toggle = document.querySelector('[data-patient-care-toggle]');
  if (status) {
    status.textContent = patientCareLabel(patient);
    status.classList.toggle('confirmed', active);
    status.classList.toggle('completed', !active);
  }
  if (toggle) {
    toggle.hidden = !active;
    toggle.disabled = false;
  }
}
function mergePatientCareProjection(motherId, savedMother = {}) {
  const patient = patientByMotherId(motherId);
  if (patient?.mother) Object.assign(patient.mother, savedMother);
  updateActivePatientsKpi();
  renderPatientList();
  if (currentPatientId === motherId && patient) renderPatientCareControls(patient);
  return patient;
}
async function ensurePatientCareActive(motherId) {
  if (!motherId) return null;
  const patient = patientByMotherId(motherId) || await appData.getPatient(motherId);
  if (!patient || isPatientCareActive(patient)) return patient;
  const saved = await persistPatientCareStatus(repositories, motherId, CARE_ACTIVE);
  if (patient?.mother) Object.assign(patient.mother, saved || { care_status: CARE_ACTIVE, care_finalized_at: null });
  return mergePatientCareProjection(motherId, saved || patient.mother) || patient;
}
async function finalizeCurrentPatientCare() {
  const patient = patientByMotherId(currentPatientId) || await appData.getPatient(currentPatientId);
  if (!patient || !isPatientCareActive(patient)) return;
  const pending = state.followups.filter((followup) => followup.mother_id === patient.mother.id && followup.status === 'Pendente').length;
  const pendingMessage = pending ? \`\\n\\n${'${pending}'} follow-up${'${pending === 1 ? \'\' : \'s\'}'} pendente${'${pending === 1 ? \' será mantido\' : \'s serão mantidos\'}'}.\` : '';
  if (!globalThis.confirm(\`Finalizar o acompanhamento de ${'${patient.mother.name}'}? A paciente continuará no histórico.${'${pendingMessage}'}\`)) return;
  const saved = await persistPatientCareStatus(repositories, patient.mother.id, CARE_FINALIZED);
  Object.assign(patient.mother, saved || { care_status: CARE_FINALIZED, care_finalized_at: new Date().toISOString() });
  mergePatientCareProjection(patient.mother.id, saved || patient.mother);
  toast('Acompanhamento finalizado.');
}
`;

export function hardenPatientCareApp(source) {
  let next = String(source);

  // Repair the broken PR #79 materialization if this hardener is ever run over an
  // already-hardened artifact instead of a freshly materialized app-shell.
  next = next.replace(`${LEGACY_CARE_IMPORT}\n\n`, '').replace(`${LEGACY_CARE_IMPORT}\n`, '');

  if (!next.includes('function normalizePatientCareStatus(')) {
    next = next.replace('const config =', `${CARE_RUNTIME_CORE}\nconst config =`);
  }
  if (!next.includes('async function finalizeCurrentPatientCare()')) {
    next = next.replace('function renderPatientList', `${RUNTIME_HELPERS}\nfunction renderPatientList`);
  }
  next = next.replace(
    '<span class="pill confirmed">Em acompanhamento</span></button>',
    '<span class="pill ${isPatientCareActive(p) ? \'confirmed\' : \'completed\'}">${escapeHTML(patientCareLabel(p))}</span></button>'
  );
  next = next.replace(
    /(setText\('\[data-patient-subtitle\]'[^\n]*\);)(?!\n\s*renderPatientCareControls\(patient\);)/,
    `$1\n  renderPatientCareControls(patient);`
  );
  if (!next.includes('function renderHomeHeader(now = new Date()) {\n  updateActivePatientsKpi();')) {
    next = next.replace('function renderHomeHeader(now = new Date()) {', 'function renderHomeHeader(now = new Date()) {\n  updateActivePatientsKpi();');
  }
  if (!next.includes("action === 'toggle-patient-care'")) {
    next = next.replace(
      "else if (action === 'edit-patient') await openPatientForm(currentPatientId);",
      "else if (action === 'edit-patient') await openPatientForm(currentPatientId);\n    else if (action === 'toggle-patient-care') await finalizeCurrentPatientCare();"
    );
  }
  if (!next.includes("followups: 'Follow-ups'")) {
    next = next.replace("followups: 'Acompanhamentos'", "followups: 'Follow-ups'");
  }

  // A patient only becomes active again after a persisted care action succeeds.
  next = next.replace(
    /(await appData\.scheduleAppointment\(\{[\s\S]*?\n  \}\);)(?!\n  await ensurePatientCareActive\(patient\.mother\.id\);)/,
    '$1\n  await ensurePatientCareActive(patient.mother.id);'
  );

  next = next.replace(
    /(if \(!result\?\.encounter_id \|\| !result\?\.appointment_id\) throw new Error\([^\n]+\);)(?!\n    await ensurePatientCareActive\(patient\.mother\.id\);)/g,
    '$1\n    await ensurePatientCareActive(patient.mother.id);'
  );

  return next;
}
