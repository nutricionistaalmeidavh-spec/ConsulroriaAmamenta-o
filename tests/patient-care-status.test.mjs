import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARE_ACTIVE,
  CARE_FINALIZED,
  activePatientCount,
  isPatientCareActive,
  patientCareLabel,
  patientCarePatch,
  persistPatientCareStatus,
} from '../public/patient-care-status-core.js';
import {
  hardenPatientCareApp,
  hardenPatientCareHtml,
  hardenPatientCareStyles,
} from '../scripts/lib/patient-care-status-hardening.mjs';

test('legacy patients without care_status remain active', () => {
  const patient = { mother: { id: 'm1', name: 'Maria' } };
  assert.equal(isPatientCareActive(patient), true);
  assert.equal(patientCareLabel(patient), 'Em acompanhamento');
});

test('finalized patients are excluded from active count', () => {
  const patients = [
    { mother: { id: 'm1' } },
    { mother: { id: 'm2', care_status: CARE_ACTIVE } },
    { mother: { id: 'm3', care_status: CARE_FINALIZED } },
  ];
  assert.equal(activePatientCount(patients), 2);
});

test('finalize and reactivate patches keep explicit timestamps', () => {
  assert.deepEqual(patientCarePatch(CARE_FINALIZED, '2026-09-30T17:00:00.000Z'), {
    care_status: CARE_FINALIZED,
    care_finalized_at: '2026-09-30T17:00:00.000Z',
  });
  assert.deepEqual(patientCarePatch(CARE_ACTIVE, 'ignored'), {
    care_status: CARE_ACTIVE,
    care_finalized_at: null,
  });
});

test('persistPatientCareStatus writes only the patient care fields', async () => {
  const calls = [];
  const repositories = {
    mothers: {
      async update(id, patch) {
        calls.push({ id, patch });
        return { id, ...patch, name: 'Maria' };
      },
    },
  };
  const saved = await persistPatientCareStatus(repositories, 'm1', CARE_FINALIZED, {
    now: '2026-09-30T17:00:00.000Z',
  });
  assert.deepEqual(calls, [{
    id: 'm1',
    patch: { care_status: CARE_FINALIZED, care_finalized_at: '2026-09-30T17:00:00.000Z' },
  }]);
  assert.equal(saved.care_status, CARE_FINALIZED);
});

test('HTML hardening replaces follow-up KPI and adds finalization control once', () => {
  const source = `<article class="lactation-kpi attention"><span>Follow-ups pendentes</span><strong data-kpi-followups>0</strong><small>contatos programados</small></article>\n<p data-patient-subtitle>Mãe + bebê</p><div class="patient-header-actions"><button class="ui-button ui-button-ghost" data-action="edit-patient">Editar</button><button class="ui-button ui-button-primary" data-action="new-appointment">Novo atendimento</button></div>`;
  const hardened = hardenPatientCareHtml(source);
  assert.match(hardened, /Pacientes em acompanhamento/);
  assert.match(hardened, /data-kpi-active-patients/);
  assert.match(hardened, /data-action="toggle-patient-care"/);
  assert.match(hardened, /data-patient-care-status/);
  assert.equal(hardenPatientCareHtml(hardened), hardened);
});

test('mobile hardening moves patient actions below the identity without horizontal overflow', () => {
  const source = '@media(max-width:760px){.patient-header-actions{margin-left:auto}.patient-header-actions .ui-button-ghost{display:none}}';
  const hardened = hardenPatientCareStyles(source);
  assert.match(hardened, /\.patient-title-row\{align-items:flex-start;flex-wrap:wrap\}/);
  assert.match(hardened, /patient-title-row>\.patient-header-actions\{margin-left:0;width:100%;display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(hardened, /ui-button-ghost:not\(\[data-patient-care-toggle\]\)\{display:none\}/);
  assert.match(hardened, /\[data-patient-care-toggle\]\{display:inline-flex\}/);
  assert.match(hardened, /\.patient-header-actions \.ui-button\{width:100%;min-width:0;white-space:normal/);
  assert.doesNotMatch(hardened, /42vw|flex-direction:column/);
  assert.equal(hardenPatientCareStyles(hardened), hardened);
});

test('app hardening makes badges dynamic, wires finalization and reactivation', () => {
  const source = `const config = {};
function patientInitials(patient){return 'MB';}
function renderPatientList(){root.innerHTML = patients.map((p) => \`<span class="pill confirmed">Em acompanhamento</span></button>\`).join('');}
setText('[data-patient-subtitle]', 'x');
function renderHomeHeader(now = new Date()) { setText('[data-home-date]', 'x'); }
const result = await appData.startClinicalEncounterFromAppointment(currentAppointmentId);
if (!result?.encounter_id || !result?.appointment_id) throw new Error('bad');
const result = await appData.startClinicalEncounter({
  p_mother_id: patient.mother.id
});
if (!result?.encounter_id || !result?.appointment_id) throw new Error('bad');
await appData.scheduleAppointment({
  p_mother_id: patient.mother.id
});
else if (action === 'edit-patient') await openPatientForm(currentPatientId);`;
  const hardened = hardenPatientCareApp(source);
  assert.match(hardened, /patient-care-status-core\.js/);
  assert.match(hardened, /patientCareLabel\(p\)/);
  assert.match(hardened, /finalizeCurrentPatientCare/);
  assert.match(hardened, /ensurePatientCareActive/);
  assert.match(hardened, /activePatientCount\(state\.patients\)/);
  assert.match(hardened, /action === 'toggle-patient-care'/);
  assert.match(hardened, /DeboraUI/);
  assert.match(hardened, /confirmTyped/);
  assert.doesNotMatch(hardened, /globalThis\.confirm/);
  assert.equal(hardenPatientCareApp(hardened), hardened);
});
