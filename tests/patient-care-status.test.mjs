import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('app hardening makes badges dynamic, wires finalization and reactivation without an unresolved module import', () => {
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
  assert.doesNotMatch(hardened, /patient-care-status-core\.js/);
  assert.match(hardened, /function normalizePatientCareStatus/);
  assert.match(hardened, /patientCareLabel\(p\)/);
  assert.match(hardened, /finalizeCurrentPatientCare/);
  assert.match(hardened, /ensurePatientCareActive/);
  assert.match(hardened, /activePatientCount\(state\.patients\)/);
  assert.match(hardened, /action === 'toggle-patient-care'/);
  assert.equal(hardenPatientCareApp(hardened), hardened);
});

test('patient care hardening cannot introduce imports that the blob bootstrap cannot rewrite', () => {
  const shell = readFileSync(new URL('../public/clinical-source/core/app-shell.js', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../src/bootstrap.js', import.meta.url), 'utf8');
  const hardened = hardenPatientCareApp(shell);
  const imports = [...hardened.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.ok(imports.length > 0, 'app-shell deve continuar declarando seus módulos canônicos');
  for (const specifier of imports) {
    assert.ok(specifier.startsWith('./lib/'), `import não suportado pelo bootstrap blob: ${specifier}`);
    assert.ok(bootstrap.includes(`'${specifier.slice(2)}'`), `bootstrap não registra ${specifier}`);
  }
});
