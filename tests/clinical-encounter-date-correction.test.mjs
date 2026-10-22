import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, credentials, userId } from './helpers/cloudflare-local.mjs';

const ENCOUNTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const APPOINTMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MOTHER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OLD = '2026-10-20T13:00:00.000Z';
const ACTUAL = '2026-10-19T13:00:00.000Z';
const CREATED = '2026-10-22T12:00:00.000Z';

async function seed(db, table, id, ownerId, data) {
  const record = { id, owner_id: ownerId, ...data };
  await db.prepare(`INSERT INTO supabase_records (
    table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
  ) VALUES(?,?,?,?,?,?,?)`).bind(table,id,ownerId,JSON.stringify(record),CREATED,CREATED,CREATED).run();
}
async function record(db, table, id) {
  const row = await db.prepare('SELECT record_json FROM supabase_records WHERE table_name=? AND record_key=? LIMIT 1')
    .bind(table,id).first();
  return row ? JSON.parse(row.record_json) : null;
}
async function auditRows(db) {
  const rows = await db.prepare("SELECT record_json FROM supabase_records WHERE table_name='clinical_encounter_date_revisions'").all();
  return (rows.results || []).map(item => JSON.parse(item.record_json));
}
async function setup(runtime, owner = userId) {
  await seed(runtime.db,'mothers',MOTHER_ID,owner,{name:'Paciente de teste'});
  await seed(runtime.db,'appointments',APPOINTMENT_ID,owner,{
    mother_id:MOTHER_ID,starts_at:OLD,status:'Realizado',created_at:CREATED,
  });
  await seed(runtime.db,'clinical_encounters',ENCOUNTER_ID,owner,{
    mother_id:MOTHER_ID,appointment_id:APPOINTMENT_ID,status:'finalized',
    occurred_at:OLD,identification:{startsAt:'2026-10-20T10:00',appointmentType:'Retorno'},
    record_version:1,clinical_note:'Registro clínico original',
    finalized_at:CREATED,created_at:CREATED,
  });
}
async function patch(runtime, body) {
  const session = await runtime.login(credentials.email);
  return runtime.mf.dispatchFetch(`http://localhost/api/clinical/records/clinical_encounters?id=eq.${ENCOUNTER_ID}`,{
    method:'PATCH',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},
    body:JSON.stringify(body),
  });
}

test('corrige data retrospectiva com persistência única no atendimento, consulta e histórico auditável',async(t)=>{
  const runtime=await createLocalRuntime();
  t.after(()=>runtime.close());
  await setup(runtime);
  const response=await patch(runtime,{_expected_version:1,occurred_at:ACTUAL,
    _date_correction_reason:'Atendimento registrado posteriormente'});
  assert.equal(response.status,200,await response.text());
  const encounter=await record(runtime.db,'clinical_encounters',ENCOUNTER_ID);
  const appointment=await record(runtime.db,'appointments',APPOINTMENT_ID);
  assert.equal(encounter.occurred_at,ACTUAL);
  assert.equal(encounter.identification.startsAt,ACTUAL);
  assert.equal(encounter.identification.appointmentType,'Retorno');
  assert.equal(appointment.starts_at,ACTUAL);
  assert.equal(encounter.created_at,CREATED);
  assert.equal(encounter.finalized_at,CREATED);
  assert.equal(appointment.created_at,CREATED);
  assert.equal(encounter.record_version,2);
  assert.equal(encounter.clinical_note,'Registro clínico original');
  const history=await auditRows(runtime.db);
  assert.equal(history.length,1);
  assert.equal(history[0].previous_occurred_at,OLD);
  assert.equal(history[0].corrected_occurred_at,ACTUAL);
  assert.equal(history[0].professional_id,userId);
});

test('rejeita revisão desatualizada, mantendo data e histórico originais',async(t)=>{
  const runtime=await createLocalRuntime();t.after(()=>runtime.close());
  await setup(runtime);
  const response=await patch(runtime,{_expected_version:0,occurred_at:ACTUAL});
  assert.equal(response.status,409);
  assert.equal((await record(runtime.db,'clinical_encounters',ENCOUNTER_ID)).occurred_at,OLD);
  assert.equal((await record(runtime.db,'appointments',APPOINTMENT_ID)).starts_at,OLD);
  assert.equal((await auditRows(runtime.db)).length,0);
});

test('não permite edição de prontuário pertencente a outra profissional',async(t)=>{
  const runtime=await createLocalRuntime();t.after(()=>runtime.close());
  await setup(runtime,'different-tenant');
  const response=await patch(runtime,{_expected_version:1,occurred_at:ACTUAL});
  assert.equal(response.status,404);
  assert.equal((await record(runtime.db,'clinical_encounters',ENCOUNTER_ID)).occurred_at,OLD);
});

test('impede data futura e valor inválido sem alterar registros',async(t)=>{
  const runtime=await createLocalRuntime();t.after(()=>runtime.close());
  await setup(runtime);
  for(const occurred_at of ['2029-10-19T13:00:00.000Z','19/10/2026','2026-02-31T13:00:00.000Z']){
    const response=await patch(runtime,{_expected_version:1,occurred_at});
    assert.equal(response.status,400,`data inválida ${occurred_at}`);
  }
  assert.equal((await record(runtime.db,'appointments',APPOINTMENT_ID)).starts_at,OLD);
  assert.equal((await auditRows(runtime.db)).length,0);
});

test('falha de auditoria reverte atomicamente ambas as datas',async(t)=>{
  const runtime=await createLocalRuntime();t.after(()=>runtime.close());
  await setup(runtime);
  await runtime.db.prepare(`CREATE TRIGGER reject_date_audit BEFORE INSERT ON supabase_records
    WHEN NEW.table_name='clinical_encounter_date_revisions'
    BEGIN SELECT RAISE(ABORT,'forced_audit_failure'); END`).run();
  const response=await patch(runtime,{_expected_version:1,occurred_at:ACTUAL});
  assert.ok(response.status>=400);
  assert.equal((await record(runtime.db,'appointments',APPOINTMENT_ID)).starts_at,OLD);
  assert.equal((await record(runtime.db,'clinical_encounters',ENCOUNTER_ID)).occurred_at,OLD);
  assert.equal((await auditRows(runtime.db)).length,0);
});

test('UI mantém edição de data vinculada ao encounter_id e não altera os registros clínicos por DOM',()=>{
  const bootstrap=readFileSync('src/bootstrap.js','utf8');
  const ui=readFileSync('public/encounter-date-correction.js','utf8');
  assert.match(bootstrap,/encounter-date-correction\.js/);
  assert.match(bootstrap,/encounter-date-correction\.css/);
  assert.match(ui,/clinical_encounters/);
  assert.match(ui,/_expected_version/);
  assert.match(ui,/window\.location\.reload\(\)/);
  assert.match(ui,/Data real do atendimento/);
  assert.doesNotMatch(ui,/createAppointment|startClinicalEncounter/);
});
