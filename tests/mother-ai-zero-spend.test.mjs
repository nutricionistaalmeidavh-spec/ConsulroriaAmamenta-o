import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteD1 } from './helpers/sqlite-d1.mjs';
import { handleMotherAiChat } from '../worker/mother-ai-chat-runtime.js';
import { matchSafetyRule } from '../worker/mother-ai-safety.js';
import { searchApprovedBreastfeedingSources } from '../worker/mother-ai-knowledge.js';

const user = { id:'mother-auth-1', email:'maria@example.test' };
const now='2026-10-23T15:00:00.000Z';
async function seed(db,table,key,owner,record) {
  await db.prepare('INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at) VALUES(?,?,?,?,?,?,?)')
    .bind(table,key,owner,JSON.stringify(record),now,now,now).run();
}
async function setup(record={}) {
  const db=createSqliteD1(); let calls=0;
  await seed(db,'member_portal_access','access-1','consultant-a',{
    id:'access-1',owner_id:'consultant-a',mother_id:'mother-a',member_user_id:user.id,
    member_verified_at:now,email:user.email,active:true,...record
  });
  const AI={async run(){calls++; return {response:'A amamentação pode ser apoiada pela equipe de saúde.'}}};
  return {db,AI,get calls(){return calls}};
}
function envOf(f,options={}) {
  return {CLINICAL_DB:f.db, AI:f.AI, MOTHER_PORTAL_ENABLED:'true',
    MOTHER_AI_ENABLED:'true', MOTHER_AI_ALLOW_INFERENCE:'true',
    MOTHER_AI_GLOBAL_DAILY_LIMIT:'2', MOTHER_AI_OWNER_DAILY_LIMIT:'2',
    MOTHER_AI_MOTHER_DAILY_LIMIT:'1',...options};
}
function req(message,extra={}) {
  return new Request('https://app.test/api/member/ai/chat',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,consent_to_ai_processing:true,...extra})
  });
}
function handler(request,env,actor=user) {
  return handleMotherAiChat(request,env,new URL(request.url),{authenticate:async()=>actor});
}
test('feature is off by default and never invokes paid or free AI',async()=>{
  const f=await setup();try {
    const response=await handler(req('Como funciona a livre demanda?'),{CLINICAL_DB:f.db,AI:f.AI});
    assert.equal(response.status,403);assert.equal(f.calls,0);
  }finally{f.db.close()}
});
test('unverified, revoked and other mother identities never invoke model',async()=>{
  const f=await setup({member_verified_at:null});try{
    const denied=await handler(req('Pega adequada'),envOf(f));
    assert.equal(denied.status,403);assert.equal(f.calls,0);
    const impersonated=await handler(req('Pega adequada',{mother_id:'mother-a'}),envOf(f),{id:'someone-else',email:user.email});
    assert.equal(impersonated.status,403);assert.equal(f.calls,0);
  }finally{f.db.close()}
});
test('urgent safety responses bypass inference and cannot be exhausted by a budget',async()=>{
  const f=await setup();try{
    const response=await handler(req('Meu bebê está sem respirar!'),envOf(f,{MOTHER_AI_GLOBAL_DAILY_LIMIT:'0'}));
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.classification,'urgent');
    assert.match(result.answer,/emergência|emergencia|192/i);
    assert.equal(f.calls,0);
  }finally{f.db.close()}
});
test('zero default model budget denies model calls without billing',async()=>{
  const f=await setup();try{
    const response=await handler(req('Como é a pega adequada?'),envOf(f,{MOTHER_AI_GLOBAL_DAILY_LIMIT:'0'}));
    assert.equal(response.status,429);assert.equal(f.calls,0);
  }finally{f.db.close()}
});
test('one mother request uses quota atomically; second request cannot incur inference',async()=>{
  const f=await setup();try{
    const responses=await Promise.all([
      handler(req('Como funciona o aleitamento materno exclusivo?'),envOf(f)),
      handler(req('O que é livre demanda?'),envOf(f))
    ]);
    assert.equal(responses.filter(x=>x.status===200).length,1);
    assert.equal(responses.filter(x=>x.status===429).length,1);
    assert.equal(f.calls,1);
  }finally{f.db.close()}
});
test('deterministic search uses reviewed sources only and rejects unsupported topics',()=>{
  const approved=[{id:'approved',reviewed:true,title:'Pega',url:'https://www.gov.br/saude',keywords:['pega'],summary:'Observe posicionamento e conforto.'},
    {id:'draft',reviewed:false,title:'Falso',url:'https://example.test',keywords:['pega'],summary:'Conteúdo não aprovado.'}];
  const items=searchApprovedBreastfeedingSources('pega',approved);
  assert.equal(items.length,1);assert.equal(items[0].id,'approved');
  assert.equal(searchApprovedBreastfeedingSources('assunto não coberto',approved).length,0);
});
test('medication and emergency are escalated without diagnosis',()=>{
  assert.equal(matchSafetyRule('Meu bebê está roxo e não respira').kind,'urgent');
  assert.equal(matchSafetyRule('Posso tomar antibiótico e qual a dose?').kind,'clinical');
  assert.equal(matchSafetyRule('O que é a pega?'),null);
});
test('model inference requires explicit per-request consent; educational references remain accessible',async()=>{
  const f=await setup();try {
    const noConsent=await handler(req('Como é a pega adequada?',{consent_to_ai_processing:false}),envOf(f));
    assert.equal(noConsent.status,412);
    assert.equal((await noConsent.json()).error,'consent_required');
    assert.equal(f.calls,0);
    const reference=await handler(req('Como é a pega adequada?',{consent_to_ai_processing:false}),envOf(f,{MOTHER_AI_ALLOW_INFERENCE:'false'}));
    assert.equal(reference.status,200);
    assert.equal((await reference.json()).model_used,false);
    assert.equal(f.calls,0);
  }finally{f.db.close()}
});
