import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, credentials, userId } from './helpers/cloudflare-local.mjs';
import { enhanceClinicalNoteWithDateCorrection } from '../src/encounter-date-correction.js';

const OLD = '2025-10-19T13:00:00.000Z';
const UPDATED = '2025-10-20T17:30:00.000Z';
const SECOND = '2025-10-21T17:30:00.000Z';

async function seed(db, table, id, ownerId, data) {
  const now = new Date().toISOString();
  const row = { id, owner_id: ownerId, ...data };
  await db.prepare(`INSERT INTO supabase_records(
    table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
  ) VALUES(?,?,?,?,?,?,?)`).bind(table, id, ownerId, JSON.stringify(row), now, now, now).run();
}
async function getRecord(db, table, id) {
  const row = await db.prepare('SELECT record_json FROM supabase_records WHERE table_name=? AND record_key=? LIMIT 1')
    .bind(table, id).first();
  return row && JSON.parse(row.record_json);
}
async function fixture() {
  const runtime = await createLocalRuntime();
  const login = await runtime.login(credentials.email);
  const headers = { authorization: `Bearer ${login.access_token}`, 'content-type': 'application/json' };
  const created = '2025-10-22T14:00:00.000Z';
  await seed(runtime.db, 'mothers', 'm1', userId, { name: 'Paciente' });
  await seed(runtime.db, 'appointments', 'a1', userId, {
    mother_id: 'm1', starts_at: OLD, status: 'Realizado', value_cents: 15000, created_at: created,
  });
  await seed(runtime.db, 'clinical_encounters', 'e1', userId, {
    mother_id: 'm1', appointment_id: 'a1', status: 'finalized', occurred_at: OLD,
    record_version: 1, created_at: created, clinical_note: 'Anotação mantida',
    identification: { startsAt: '2025-10-19T10:00', appointmentType: 'Consulta inicial' },
  });
  const patch = (body) => runtime.mf.dispatchFetch(
    'http://localhost/api/clinical/records/clinical_encounters?id=eq.e1',
    { method: 'PATCH', headers, body: JSON.stringify(body) },
  );
  return { runtime, patch, created };
}

test('editor clínico inclui campo de correção no prontuário e mantém integração com autosave', () => {
  const source = readFileSync('public/clinical-source/features/clinical-note-feature.js', 'utf8');
  const next = enhanceClinicalNoteWithDateCorrection(source);
  assert.match(next, /Corrigir data da consulta/);
  assert.match(next, /id="cn-date-input" type="datetime-local"/);
  assert.match(next, /async function cnSaveEncounterDate/);
  assert.match(next, /await cnFlush\(\)/);
  assert.match(next, /_expected_version/);
  assert.match(next, /cnState\.encounter=\{\.\.\.cnState\.encounter,\.\.\.rows\[0\]\}/);
  assert.match(next, /occurred_at,created_at/);
  assert.equal((next.match(/function cnSaveEncounterDate/g) || []).length, 1);
  assert.throws(() => enhanceClinicalNoteWithDateCorrection(''), /anchor missing or ambiguous/);
});

test('correção retroativa preserva identidade, criação e nota; sincroniza agendamento com auditoria', async (t) => {
  const { runtime, patch, created } = await fixture();
  t.after(() => runtime.close());
  const response = await patch({ _expected_version: 1, occurred_at: UPDATED });
  assert.equal(response.status, 200, await response.text());
  const after = await getRecord(runtime.db, 'clinical_encounters', 'e1');
  const appointment = await getRecord(runtime.db, 'appointments', 'a1');
  assert.equal(after.occurred_at, UPDATED);
  assert.equal(after.identification.startsAt, '2025-10-20T14:30');
  assert.equal(after.identification.appointmentType, 'Consulta inicial');
  assert.equal(appointment.starts_at, UPDATED);
  assert.equal(appointment.status, 'Realizado');
  assert.equal(appointment.value_cents, 15000);
  assert.equal(after.created_at, created);
  assert.equal(appointment.created_at, created);
  assert.equal(after.clinical_note, 'Anotação mantida');
  assert.equal(after.status, 'finalized');
  assert.equal(after.record_version, 2);
  assert.equal(after.identification.dateCorrections.length, 1);
  assert.equal(after.identification.dateCorrections[0].previous, OLD);
  assert.equal(after.identification.dateCorrections[0].corrected, UPDATED);
  assert.equal(after.identification.dateCorrections[0].professionalId, userId);
});

test('histórico de correções é cumulativo e protegido de sobrescrita via PATCH comum', async (t) => {
  const { runtime, patch } = await fixture();
  t.after(() => runtime.close());
  assert.equal((await patch({ _expected_version: 1, occurred_at: UPDATED })).status, 200);
  assert.equal((await patch({ _expected_version: 2, occurred_at: SECOND })).status, 200);
  const after = await getRecord(runtime.db, 'clinical_encounters', 'e1');
  assert.equal(after.identification.dateCorrections.length, 2);
  assert.equal(after.identification.dateCorrections[1].previous, UPDATED);
  const tamper = await patch({ _expected_version: 3, identification: {
    startsAt: '2025-10-21T14:30', dateCorrections: [],
  }});
  assert.equal(tamper.status, 200);
  const persisted = await getRecord(runtime.db, 'clinical_encounters', 'e1');
  assert.equal(persisted.identification.dateCorrections.length, 2);
});

test('rejeita versão obsoleta, data futura e horário inexistente sem alterar o prontuário', async (t) => {
  const { runtime, patch } = await fixture();
  t.after(() => runtime.close());
  let response = await patch({ _expected_version: 0, occurred_at: UPDATED });
  assert.equal(response.status, 409);
  response = await patch({ _expected_version: 1, occurred_at: '2099-01-01T10:00:00.000Z' });
  assert.equal(response.status, 400);
  response = await patch({ _expected_version: 1, occurred_at: '2025-02-30T10:00:00.000Z' });
  assert.equal(response.status, 400);
  const after = await getRecord(runtime.db, 'clinical_encounters', 'e1');
  assert.equal(after.occurred_at, OLD);
  assert.equal(after.record_version, 1);
});

test('falha na gravação do agendamento desfaz também a alteração do prontuário', async (t) => {
  const { runtime, patch } = await fixture();
  t.after(() => runtime.close());
  await runtime.db.prepare(`CREATE TRIGGER fail_date_appointment
    BEFORE UPDATE ON supabase_records WHEN NEW.table_name='appointments'
    BEGIN SELECT RAISE(ABORT,'forced_appointment_failure'); END`).run();
  const response = await patch({ _expected_version: 1, occurred_at: UPDATED });
  assert.ok(response.status >= 400);
  assert.equal((await getRecord(runtime.db, 'appointments', 'a1')).starts_at, OLD);
  assert.equal((await getRecord(runtime.db, 'clinical_encounters', 'e1')).occurred_at, OLD);
});

test('a edição falha quando a relação do agendamento não pertence ao mesmo proprietário', async (t) => {
  const { runtime, patch } = await fixture();
  t.after(() => runtime.close());
  await runtime.db.prepare(`UPDATE supabase_records SET owner_id='outro-tenant'
    WHERE table_name='appointments' AND record_key='a1'`).run();
  const response = await patch({ _expected_version: 1, occurred_at: UPDATED });
  assert.ok([403, 409].includes(response.status), `esperado bloqueio por titularidade, recebido ${response.status}`);
  assert.equal((await getRecord(runtime.db, 'clinical_encounters', 'e1')).occurred_at, OLD);
});
