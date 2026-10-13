import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, credentials, userId } from './helpers/cloudflare-local.mjs';
import { transformFinancialEntryCancellation } from '../scripts/lib/financial-entry-cancel-materialize.mjs';

async function seed(db, id, record, owner = userId) {
  const now = new Date().toISOString();
  const source = { id, owner_id: owner, amount_cents: 60000, description: 'Consulta inicial',
    status: 'Pendente', paid: false, created_at: now, ...record };
  await db.prepare(`INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at)
    VALUES(?,?,?,?,?,?,?)`).bind('financial_entries',id,owner,JSON.stringify(source),now,now,now).run();
}
async function get(db, id) {
  const row = await db.prepare("SELECT record_json FROM supabase_records WHERE table_name='financial_entries' AND record_key=?").bind(id).first();
  return row ? JSON.parse(row.record_json) : null;
}
async function headers(runtime, email = credentials.email) {
  const session = await runtime.login(email);
  return { authorization: `Bearer ${session.access_token}`, 'content-type':'application/json' };
}
async function cancel(runtime, token, id, confirmation='EXCLUIR') {
  return runtime.mf.dispatchFetch('http://localhost/api/clinical/rpc/cancel_financial_entry', {
    method:'POST',headers:token,body:JSON.stringify({p_entry_id:id,p_confirmation:confirmation})
  });
}

test('pending payment is cancelled (never deleted), linked package preserved, retries idempotent', async (t) => {
  const rt=await createLocalRuntime();t.after(()=>rt.close());
  await seed(rt.db,'fin-package',{package_id:'care-package-1', mother_id:'mother-1'});
  const auth=await headers(rt);
  const result=await cancel(rt,auth,'fin-package');
  assert.equal(result.status,200);
  assert.deepEqual((({status,id,idempotent})=>({status,id,idempotent}))(await result.json()),
    {status:'Cancelado',id:'fin-package',idempotent:false});
  const entry=await get(rt.db,'fin-package');
  assert.equal(entry.status,'Cancelado');
  assert.equal(entry.package_id,'care-package-1');
  assert.equal(entry.amount_cents,60000);
  assert.ok(entry.cancelled_at);
  assert.equal(entry.cancelled_by,userId);
  assert.equal(entry.cancelled_reason,'manual_financial_card');
  const retry=await cancel(rt,auth,'fin-package');
  assert.equal(retry.status,200);
  assert.equal((await retry.json()).idempotent,true);
  const list=await rt.db.prepare("SELECT count(*) AS n FROM supabase_records WHERE table_name='financial_entries' AND record_key='fin-package'").first();
  assert.equal(list.n,1);
  const restorePaid=await rt.mf.dispatchFetch('http://localhost/api/clinical/rpc/set_financial_payment_state',{
    method:'POST',headers:auth,body:JSON.stringify({p_entry_id:'fin-package',p_paid:true,p_payment_method:'Pix'})
  });
  assert.equal(restorePaid.status,409);
});

test('paid entries cannot be cancelled or physically deleted via generic API', async (t) => {
  const rt=await createLocalRuntime();t.after(()=>rt.close());
  await seed(rt.db,'paid-1',{status:'Pago',paid:true,paid_at:new Date().toISOString()});
  const auth=await headers(rt);
  const rejected=await cancel(rt,auth,'paid-1');
  assert.equal(rejected.status,409);
  assert.equal((await get(rt.db,'paid-1')).status,'Pago');
  const hardDelete=await rt.mf.dispatchFetch('http://localhost/api/clinical/records/financial_entries?id=eq.paid-1',{
    method:'DELETE',headers:auth
  });
  assert.equal(hardDelete.status,405);
  assert.equal((await get(rt.db,'paid-1')).status,'Pago');
});

test('requires authenticated owner, explicit confirmation and pending status', async (t) => {
  const rt=await createLocalRuntime();t.after(()=>rt.close());
  await seed(rt.db,'other-1',{},'audit-other');
  await seed(rt.db,'mine-1',{});
  const auth=await headers(rt);
  assert.equal((await cancel(rt,auth,'other-1')).status,404);
  assert.equal((await cancel(rt,auth,'mine-1','')).status,400);
  const foreignAuth=await headers(rt,'other@example.test');
  assert.equal((await cancel(rt,foreignAuth,'mine-1')).status,404);
  assert.equal((await get(rt.db,'mine-1')).status,'Pendente');
});

test('generated finance shell preserves per-card removal and feedback through build',()=>{
  const rendered=readFileSync('public/clinical-source/core/app-shell.js','utf8');
  const materializer=readFileSync('scripts/materialize-clinical-source.mjs','utf8');
  const css=readFileSync('public/improvements-v2.css','utf8');
  const overlay=transformFinancialEntryCancellation(rendered);
  assert.equal(overlay,rendered);
  assert.match(rendered,/data-action="cancel-finance"/);
  assert.match(rendered,/financialCancellationPending/);
  assert.match(rendered,/appData\.cancelFinancialEntry\(id\)/);
  assert.match(rendered,/finance\.status === 'Pago'/);
  assert.match(rendered,/status !== 'Cancelado'/);
  assert.match(materializer,/applyFinancialEntryCancellation\(resolved, sourceByPath\)/);
  assert.match(css,/\.finance-card \.finance-remove-action/);
});
