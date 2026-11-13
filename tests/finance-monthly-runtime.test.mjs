import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLocalRuntime,credentials,userId} from './helpers/cloudflare-local.mjs';
import {unzipSync,strFromU8} from 'fflate';
import {createFinanceWorkbook} from '../public/clinical-source/core/lib/backup-service.js';
import {resolvePeriod,createPeriodReport,filterPeriodFinanceRows} from '../public/finance-monthly-report.js';

async function seed(db,id,entry={},owner=userId){
  const now='2026-10-12T12:00:00.000Z';
  const record={id,owner_id:owner,mother_id:'mother-demo',description:'Atendimento',amount_cents:12000,
    status:'Pendente',paid:false,created_at:now,updated_at:now,...entry};
  await db.prepare('INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at) VALUES (?,?,?,?,?,?,?)')
    .bind('financial_entries',id,owner,JSON.stringify(record),now,now,now).run();
}
async function rpc(rt,headers,id,paid,date,correct=false){
 return rt.mf.dispatchFetch('http://localhost/api/clinical/rpc/set_financial_payment_state',{
   method:'POST',headers,body:JSON.stringify({p_entry_id:id,p_paid:paid,p_payment_method:'Pix',p_paid_date:date,p_correct_paid_date:correct})
 });
}
async function record(db,id){
 const row=await db.prepare("SELECT record_json FROM supabase_records WHERE table_name='financial_entries' AND record_key=?").bind(id).first();
 return JSON.parse(row.record_json);
}

test('record real paid date, reject duplicate confirmation, allow audited correction, undo and isolate owners',async t=>{
 const rt=await createLocalRuntime();t.after(()=>rt.close());
 const session=await rt.login(credentials.email);
 const headers={authorization:'Bearer '+session.access_token,'content-type':'application/json'};
 await seed(rt.db,'receipt-1');
 await seed(rt.db,'other-receipt',{},'foreign-owner');
 const first=await rpc(rt,headers,'receipt-1',true,'2026-10-12');
 assert.equal(first.status,200);
 let saved=await record(rt.db,'receipt-1');
 assert.equal(saved.status,'Pago');
 assert.equal(saved.paid_at,'2026-10-12T12:00:00-03:00');
 assert.equal(saved.payment_history.length,1);
 assert.equal(saved.payment_history[0].reason,'mark_paid');
 assert.equal(saved.payment_history[0].actor_id,userId);
 assert.equal((await rpc(rt,headers,'receipt-1',true,'2026-10-11')).status,409);
 const corrected=await rpc(rt,headers,'receipt-1',true,'2026-10-10',true);
 assert.equal(corrected.status,200);
 saved=await record(rt.db,'receipt-1');
 assert.equal(saved.paid_at,'2026-10-10T12:00:00-03:00');
 assert.equal(saved.payment_history.length,2);
 assert.equal(saved.payment_history[1].before_paid_at,'2026-10-12T12:00:00-03:00');
 assert.equal(saved.payment_history[1].reason,'correct_payment_date');
 assert.equal((await rpc(rt,headers,'receipt-1',true,'2026-02-30',true)).status,400);
 assert.equal((await rpc(rt,headers,'receipt-1',true,'2999-01-01',true)).status,400);
 assert.equal((await rpc(rt,headers,'other-receipt',true,'2026-10-10')).status,404);
 assert.equal((await record(rt.db,'receipt-1')).payment_history.length,2);
 const undone=await rpc(rt,headers,'receipt-1',false,'');
 assert.equal(undone.status,200);
 saved=await record(rt.db,'receipt-1');
 assert.equal(saved.status,'Pendente');
 assert.equal(saved.paid_at,null);
 assert.equal(saved.payment_history.length,3);
 assert.equal(saved.payment_history[2].reason,'undo_payment');
 assert.equal((await rpc(rt,headers,'receipt-1',false,'')).status,409);
});

test('XLSX export creates valid spreadsheet tabs with aggregate and financial rows, no clinical free text',async()=>{
 const report=createPeriodReport({
  patients:[{mother:{id:'mom',name:'Teste XLSX',created_at:'2026-10-01'}}],
  encounters:[{id:'e1',mother_id:'mom',status:'finalized',occurred_at:'2026-10-09'}],
  financial:[{id:'f1',mother_id:'mom',status:'Pago',amount_cents:5500,
    description:'Consulta',paid_at:'2026-10-10T15:00:00Z'}]
 },resolvePeriod({month:'2026-10'}));
 const file=await createFinanceWorkbook(report,filterPeriodFinanceRows(report,'Pago'));
 assert.equal(file.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 const archive=unzipSync(new Uint8Array(await file.arrayBuffer()));
 const workbook=strFromU8(archive['xl/workbook.xml']);
 assert.match(workbook,/name="Resumo"/);
 assert.match(workbook,/name="Financeiro"/);
 assert.match(workbook,/name="Atendimentos"/);
 const overview=strFromU8(archive['xl/worksheets/sheet1.xml']);
 const payments=strFromU8(archive['xl/worksheets/sheet2.xml']);
 assert.match(overview,/Atendimentos finalizados/);
 assert.match(payments,/Teste XLSX/);
 assert.match(payments,/55,00/);
});

test('materialized runtime contains report UI, canonical RPC wiring and source-of-truth overlay',()=>{
 const shell=readFileSync('public/clinical-source/core/app-shell.js','utf8');
 const html=readFileSync('public/clinical-source/index.html','utf8');
 const data=readFileSync('public/clinical-source/core/lib/app-data.js','utf8');
 const materializer=readFileSync('scripts/materialize-clinical-source.mjs','utf8');
 assert.match(shell,/createFinanceReportController/);
 assert.match(shell,/financeReport\.render\(\)/);
 assert.match(shell,/correctFinancialPaidDate/);
 assert.match(data,/p_correct_paid_date: true/);
 assert.match(html,/data-finance-from/);
 assert.match(html,/data-finance-to/);
 assert.match(html,/data-finance-export-xlsx/);
 assert.match(html,/finance-report\.css/);
 assert.match(materializer,/applyFinanceMonthlyMaterialization\(resolved, sourceByPath\)/);
});
