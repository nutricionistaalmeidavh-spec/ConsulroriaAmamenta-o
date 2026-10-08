import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { handleWeightCorrectionRuntime } from '../worker/weight-correction-runtime.js';

class Statement {
  constructor(db, sql, args=[]) { this.db=db; this.sql=sql; this.args=args; }
  bind(...args){return new Statement(this.db,this.sql,args);}
  first(){return this.db.first(this.sql,this.args);}
  all(){return this.db.all(this.sql,this.args);}
  run(){return this.db.run(this.sql,this.args);}
}
class D1 {
  constructor(){this.records=new Map();}
  prepare(sql){return new Statement(this,sql);}
  put(table,id,ownerId,record){this.records.set(table+':'+id,{table,id,ownerId,record:{...record}});}
  get(table,id){return this.records.get(table+':'+id)?.record;}
  row(entry){return entry?{record_key:entry.id,owner_id:entry.ownerId,record_json:JSON.stringify(entry.record)}:null;}
  async first(sql,args){
    if(!/FROM supabase_records/.test(sql))throw new Error('Unexpected query '+sql);
    const [table,a,b,c]=args;
    const scoped=sql.includes('owner_id = ?');
    return this.row([...this.records.values()].find(v=>v.table===table && (!scoped||v.ownerId===a) &&
      (v.id===(scoped?b:a)||v.record?.id===(scoped?c:b))));
  }
  async all(sql,args){
    if(!/FROM supabase_records WHERE table_name = \?/.test(sql))throw new Error('Unexpected read '+sql);
    const [table,owner]=args;
    const legacy=sql.includes('owner_id IS NULL');
    return {results:[...this.records.values()].filter(v=>v.table===table && (legacy?v.ownerId===null:v.ownerId===owner)).map(v=>this.row(v))};
  }
  async run(sql,args){
    if(!/INSERT INTO supabase_records/.test(sql))throw new Error('Unexpected write '+sql);
    const [table,id,owner,serialized]=args;
    this.put(table,id,owner,JSON.parse(serialized));
    return {success:true};
  }
  async batch(stmts){
    const before=new Map(this.records);
    try{for(const stmt of stmts)await stmt.run();}
    catch(error){this.records=before;throw error;}
  }
}
function fixture(){
  const db=new D1();
  db.put('babies','baby','owner',{id:'baby',mother_id:'mother',birth_weight_g:3200,current_weight_g:4000,current_weight_measured_at:'2026-09-10T12:00:00.000Z'});
  db.put('weights','old','owner',{id:'old',baby_id:'baby',weight_g:3300,measured_at:'2026-09-01T12:00:00.000Z'});
  db.put('growth_measurements','growth-old','owner',{id:'growth-old',baby_id:'baby',weight_g:3300,length_cm:49,measured_at:'2026-09-01T12:00:00.000Z'});
  db.put('weights','new','owner',{id:'new',baby_id:'baby',weight_g:4000,measured_at:'2026-09-10T12:00:00.000Z'});
  return db;
}
async function post(db,input,user='owner'){
  const req=new Request('https://example.test/api/clinical/rpc/revise_weight_measurement',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({p_baby_id:'baby',p_weight_ids:[],p_measurement_ids:[],...input})});
  return handleWeightCorrectionRuntime(req,{CLINICAL_DB:db},undefined,{authenticate:async()=>({id:user}),now:'2026-10-08T17:00:00.000Z'});
}
test('correction synchronizes linked records without affecting later valid weights',async()=>{
  const db=fixture();
  const res=await post(db,{p_action:'correct',p_weight_ids:['old'],p_measurement_ids:['growth-old'],p_expected_day:'2026-09-01',p_expected_weight_g:3300,p_weight_g:3500,p_measured_at:'2026-09-02'});
  assert.equal(res.status,200,await res.text());
  assert.equal(db.get('weights','old').weight_g,3500);
  assert.equal(db.get('growth_measurements','growth-old').weight_g,3500);
  assert.equal(db.get('weights','old').correction_history.length,1);
  assert.equal(db.get('growth_measurements','growth-old').length_cm,49);
  assert.equal(db.get('babies','baby').current_weight_g,4000);
});
test('voiding latest weight preserves records and recomputes current weight',async()=>{
  const db=fixture();
  const res=await post(db,{p_action:'void',p_weight_ids:['new'],p_measurement_ids:[],p_expected_day:'2026-09-10',p_expected_weight_g:4000,p_reason:'Registro incorreto'});
  assert.equal(res.status,200);
  assert.ok(db.get('weights','new').voided_at);
  assert.equal(db.get('babies','baby').current_weight_g,3300);
  assert.equal(db.get('babies','baby').current_weight_measured_at,'2026-09-01T12:00:00.000Z');
});
test('corrected fields cannot be updated through stale or cross-account selection',async()=>{
  const db=fixture();
  let r=await post(db,{p_action:'correct',p_weight_ids:['old'],p_expected_day:'2026-09-01',p_expected_weight_g:9999,p_weight_g:3000,p_measured_at:'2026-09-02'});
  assert.equal(r.status,409);
  r=await post(db,{p_action:'void',p_weight_ids:['old'],p_expected_day:'2026-09-01',p_expected_weight_g:3300,p_reason:'Inválido'},'other');
  assert.equal(r.status,404);
  assert.equal(db.get('weights','old').voided_at,undefined);
});
test('ambiguous same-day duplicates cannot be changed as a bulk selection',async()=>{
  const db=fixture();
  db.put('weights','other-old','owner',{id:'other-old',baby_id:'baby',weight_g:3300,measured_at:'2026-09-01T15:00:00.000Z'});
  const response=await post(db,{p_action:'correct',p_weight_ids:['old','other-old'],p_expected_day:'2026-09-01',p_expected_weight_g:3300,p_weight_g:3550,p_measured_at:'2026-09-02'});
  assert.equal(response.status,400);
  assert.equal(db.get('weights','old').weight_g,3300);
});

test('legacy weight records inherit ownership from the mother without tenant access leakage',async()=>{
  const db=fixture();
  db.put('mothers','mother','owner',{id:'mother',name:'Mãe legada'});
  const baby=db.get('babies','baby');
  db.put('babies','baby',null,{...baby,owner_id:undefined});
  const weight=db.get('weights','old');
  db.put('weights','old',null,{...weight,owner_id:undefined});
  const request={p_action:'correct',p_weight_ids:['old'],p_expected_day:'2026-09-01',p_expected_weight_g:3300,p_weight_g:3400,p_measured_at:'2026-09-02'};
  const ok=await post(db,request,'owner');
  assert.equal(ok.status,200,await ok.text());
  assert.equal(db.get('weights','old').weight_g,3400);
  const other=await post(db,request,'other');
  assert.equal(other.status,404);
});

test('V5 groups paired sources for edit and ignores invalidated weight while preserving the layout',()=>{
  const ctx={document:{head:{appendChild(){}},getElementById(){return null},createElement(){return{}}},console};
  ctx.window=ctx;ctx.globalThis=ctx;
  const src=readFileSync('public/weight-evolution-v5.js','utf8');
  vm.runInNewContext(src,ctx);
  const rows=ctx.DeboraWeightEvolution.buildRows({baby:{id:'baby',birth_date:'2026-08-20',birth_weight_g:3200},weights:[
    {id:'a',measured_at:'2026-09-01T12:00:00Z',weight_g:3300},
    {id:'void',measured_at:'2026-09-10T12:00:00Z',weight_g:4000,voided_at:'2026-10-08T12:00:00Z'}
  ],measurements:[
    {id:'b',measured_at:'2026-09-01T14:00:00Z',weight_g:3300}
  ]});
  assert.equal(rows.length,2);
  assert.equal(rows[1].records.length,2);
  assert.ok(rows[1].records.some(r=>r.table==='weights'));
  assert.ok(rows[1].records.some(r=>r.table==='growth_measurements'));
  assert.match(src,/gf-v5-summary/);
  assert.match(src,/gf-v5-timeline/);
});
test('materializer, Cloudflare facade and bootstrap preserve the canonical single-source contract',()=>{
  const materializer=readFileSync('scripts/materialize-clinical-source.mjs','utf8');
  const bootstrap=readFileSync('src/bootstrap.js','utf8');
  const facade=readFileSync('worker/cloudflare-clinical-runtime.js','utf8');
  assert.match(materializer,/applyWeightCorrection/);
  assert.match(bootstrap,/lib\/weekly-care-plan\.js/);
  assert.match(bootstrap,/features\/weekly-care-plan\.css/);
  assert.match(facade,/handleWeightCorrectionRuntime/);
  assert.doesNotMatch(readFileSync('public/weight-evolution-v5.js','utf8'),/MutationObserver/);
});
