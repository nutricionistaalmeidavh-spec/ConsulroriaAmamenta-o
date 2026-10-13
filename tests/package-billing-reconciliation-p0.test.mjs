import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, credentials, userId } from './helpers/cloudflare-local.mjs';

const billing = readFileSync('public/billing-v2.js','utf8');
const shell = readFileSync('public/clinical-source/core/app-shell.js','utf8');
const worker = readFileSync('worker/cloudflare-data-runtime.js','utf8');

async function seed(db, table, id, record) {
  const now = new Date().toISOString();
  const payload = { id, owner_id: userId, ...record };
  await db.prepare(`INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(table,id,userId,JSON.stringify(payload),now,now,now).run();
}
async function auth(runtime) {
  const {access_token} = await runtime.login(credentials.email);
  return { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' };
}
async function rpc(runtime, headers, name, body) {
  return runtime.mf.dispatchFetch(`http://localhost/api/clinical/rpc/${name}`, {
    method:'POST', headers, body: JSON.stringify(body)
  });
}
async function getRows(db, table) {
  const result = await db.prepare('SELECT record_json FROM supabase_records WHERE table_name=?').bind(table).all();
  return (result.results||[]).map(item=>JSON.parse(item.record_json));
}
const packageBody = {
  p_appointment_id:'appointment-1', p_billing_mode:'package_new',
  p_service_label:'Consulta inicial', p_value_cents:60000, p_payment_method:'Pix',
  p_package_total_cents:60000, p_package_sessions_total:4,
  p_package_id:null, p_request_key:'package-new:appointment-1'
};

test('P0: package_new prevents an accidental change to individual and a second financial entry', async t => {
  const runtime=await createLocalRuntime();
  t.after(()=>runtime.close());
  const headers=await auth(runtime);
  await seed(runtime.db,'mothers','mother-1',{ name:'Paciente de teste' });
  await seed(runtime.db,'appointments','appointment-1',{mother_id:'mother-1',status:'Em atendimento',starts_at:'2026-10-13T14:00:00Z'});
  await seed(runtime.db,'clinical_encounters','encounter-1',{mother_id:'mother-1',appointment_id:'appointment-1',status:'draft'});

  const created=await rpc(runtime,headers,'set_appointment_billing',packageBody);
  assert.equal(created.status,200);
  const saved=await created.json();
  assert.ok(saved.package_id);

  const accidentalIndividual=await rpc(runtime,headers,'set_appointment_billing',{
    ...packageBody, p_billing_mode:'individual',p_package_total_cents:null,
    p_package_sessions_total:null,p_package_id:null,p_request_key:null
  });
  assert.equal(accidentalIndividual.status,409,'cannot silently detach an already created package');
  const accidentalFallback=await rpc(runtime,headers,'ensure_financial_entry_for_encounter',{
    p_mother_id:'mother-1',p_appointment_id:'appointment-1',p_encounter_id:'encounter-1',
    p_description:'Consulta inicial',p_amount_cents:60000,p_due_at:'2026-10-13'
  });
  assert.equal(accidentalFallback.status,409,'cannot create an individual charge for a package appointment');

  const packages=await getRows(runtime.db,'care_packages');
  const financial=await getRows(runtime.db,'financial_entries');
  assert.equal(packages.length,1);
  assert.equal(financial.length,1);
  assert.equal(financial[0].package_id,packages[0].id);
  assert.equal(financial[0].amount_cents,60000);
  assert.equal(financial[0].status,'Pendente');
});

test('P0: repeated same-appointment package creation reuses exactly one base charge', async t => {
  const runtime=await createLocalRuntime();
  t.after(()=>runtime.close());
  const headers=await auth(runtime);
  await seed(runtime.db,'mothers','mother-1',{name:'Paciente de teste'});
  await seed(runtime.db,'appointments','appointment-1',{mother_id:'mother-1',starts_at:'2026-10-13T14:00:00Z'});
  const a=await rpc(runtime,headers,'set_appointment_billing',packageBody);
  const b=await rpc(runtime,headers,'set_appointment_billing',packageBody);
  assert.equal(a.status,200);
  assert.equal(b.status,200);
  assert.equal((await a.json()).package_id,(await b.json()).package_id);
  assert.equal((await getRows(runtime.db,'care_packages')).length,1);
  assert.equal((await getRows(runtime.db,'financial_entries')).length,1);
});

test('P0/P1: visible package mode, stable request key, single-flight start and click guard',()=>{
  assert.match(billing,/!packages.length\|\|selection.mode==='package_new'/);
  assert.match(billing,/p_request_key:s.mode==='package_new'\?'package-new:'\+appointmentId:null/);
  assert.match(billing,/bvMountPatientPlan\(true\).*Plan route refresh/);
  assert.match(billing,/Carregando plano…/);
  assert.match(shell,/let encounterStartPromise = null/);
  assert.match(shell,/if \(encounterStartPromise\) return encounterStartPromise/);
  assert.match(shell,/if \(wizardActionBusy\) return/);
  assert.match(shell,/nextButton\.disabled = true/);
  assert.match(worker,/não pode gerar cobrança individual/);
});
