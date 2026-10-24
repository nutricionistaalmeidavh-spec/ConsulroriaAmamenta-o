import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteD1} from './helpers/sqlite-d1.mjs';
import {selectMotherApprovedOrientations} from '../worker/mother-ai-context.js';
import {handleMotherAiChat} from '../worker/mother-ai-chat-runtime.js';
import {handleMotherAiHistory} from '../worker/mother-ai-history-runtime.js';
const actor={id:'mother-auth-a',email:'same@example.test'};
const instant='2026-10-23T12:00:00.000Z';
async function seed(db,table,id,owner,r){
  await db.prepare('INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at) VALUES(?,?,?,?,?,?,?)')
    .bind(table,id,owner,JSON.stringify(r),instant,instant,instant).run();
}
async function fixture(){
 const db=createSqliteD1();let modelCalls=0,lastPrompt='';
 await seed(db,'member_portal_access','access-a','consultant-1',{
   id:'access-a',owner_id:'consultant-1',mother_id:'mother-a',member_user_id:actor.id,
   member_verified_at:instant,email:actor.email,active:true
 });
 await seed(db,'mothers','mother-a','consultant-1',{id:'mother-a',owner_id:'consultant-1',name:'Maria Silva'});
 await seed(db,'mothers','mother-b','consultant-1',{id:'mother-b',owner_id:'consultant-1',name:'Maria Silva'});
 await seed(db,'member_shared_items','good','consultant-1',{
   id:'good',owner_id:'consultant-1',mother_id:'mother-a',kind:'care_plan',title:'Meu plano - semanas',
   body:'Semana 1\nAjustar posição.\nSemana 2\nObservar pega.',published:true,occurred_at:instant
 });
 await seed(db,'member_shared_items','wrong','consultant-1',{
   id:'wrong',owner_id:'consultant-1',mother_id:'mother-b',kind:'orientation',title:'Orientação privada',
   body:'SEGREDO OUTRA MAE',published:true,occurred_at:instant
 });
 await seed(db,'member_shared_items','hidden','consultant-1',{
   id:'hidden',owner_id:'consultant-1',mother_id:'mother-a',kind:'care_plan',title:'Não publicado',
   body:'SEGREDO NAO PUBLICADO',published:false,occurred_at:instant
 });
 const AI={async run(_m,args){modelCalls++;lastPrompt=args.prompt;assert.doesNotMatch(args.prompt,/SEGREDO/);return {response:'Observe a pega conforme as orientações disponibilizadas.'}}};
 const env={CLINICAL_DB:db,AI,MOTHER_PORTAL_ENABLED:'true',MOTHER_AI_ENABLED:'true',
   MOTHER_AI_ALLOW_INFERENCE:'false'};
 return {db,env,get modelCalls(){return modelCalls},get lastPrompt(){return lastPrompt}};
}
function make(path,method='GET',body=null){
 return new Request('https://app.test'+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
}
const auth={authenticate:async()=>actor};
test('canonical care plans include only published, same tenant, same mother, allowed kinds',async()=>{
 const f=await fixture();try{
  const rows=await selectMotherApprovedOrientations(f.db,'consultant-1','mother-a');
  assert.equal(rows.length,1);assert.match(rows[0].body,/Semana 2/);
  assert.doesNotMatch(JSON.stringify(rows),/SEGREDO/);
 }finally{f.db.close()}
});
test('context is opt-in and remains reference-only with no AI spending',async()=>{
 const f=await fixture();try{
  const r=await handleMotherAiChat(make('/api/member/ai/chat','POST',{message:'Como melhorar a pega?',include_my_orientations:true}),f.env,undefined,auth);
  assert.equal(r.status,200);const j=await r.json();
  assert.equal(j.model_used,false);assert.match(JSON.stringify(j.orientations),/Semana 2/);
  assert.doesNotMatch(JSON.stringify(j),/SEGREDO/);
  assert.equal(f.modelCalls,0);
 }finally{f.db.close()}
});
test('saved history requires opt-in; consultant never sees drafts until mother shares',async()=>{
 const f=await fixture();try{
  const response=await handleMotherAiChat(make('/api/member/ai/chat','POST',{message:'Como melhorar a pega?',save_to_history:true}),f.env,undefined,auth);
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.history_saved,true);assert.ok(result.message_id);
  const list=await handleMotherAiHistory(make('/api/member/ai/history'),f.env,undefined,auth);
  assert.equal((await list.json()).items.length,1);
  const consultant=await handleMotherAiHistory(make('/api/member/ai/consultant/shares?mother_id=mother-a'),f.env,undefined,{authenticate:async()=>({id:'consultant-1'})});
  assert.equal((await consultant.json()).items.length,0);
  const share=await handleMotherAiHistory(make('/api/member/ai/shares','POST',{message_id:result.message_id,confirm_share:true}),f.env,undefined,auth);
  assert.equal(share.status,200);
  const visible=await handleMotherAiHistory(make('/api/member/ai/consultant/shares?mother_id=mother-a'),f.env,undefined,{authenticate:async()=>({id:'consultant-1'})});
  assert.equal((await visible.json()).items.length,1);
  const stranger=await handleMotherAiHistory(make('/api/member/ai/consultant/shares?mother_id=mother-a'),f.env,undefined,{authenticate:async()=>({id:'not-consultant'})});
  assert.equal(stranger.status,403);
 }finally{f.db.close()}
});
test('feedback persists only for the owner; revocation removes consultant visibility',async()=>{
 const f=await fixture();try{
  const resp=await handleMotherAiChat(make('/api/member/ai/chat','POST',{message:'Como melhorar a pega?',save_to_history:true}),f.env,undefined,auth);
  const item=await resp.json();
  const id=item.message_id;
  const denied=await handleMotherAiHistory(make('/api/member/ai/history/'+id+'/feedback','PATCH',{feedback:'good'}),f.env,undefined,{authenticate:async()=>({id:'other'})});
  assert.equal(denied.status,403);
  const review=await handleMotherAiHistory(make('/api/member/ai/history/'+id+'/feedback','PATCH',{feedback:'helpful'}),f.env,undefined,auth);
  assert.equal(review.status,200);
  const share=await handleMotherAiHistory(make('/api/member/ai/shares','POST',{message_id:id,confirm_share:true}),f.env,undefined,auth);
  assert.equal(share.status,200);
  const revoke=await handleMotherAiHistory(make('/api/member/ai/shares/'+id,'DELETE'),f.env,undefined,auth);
  assert.equal(revoke.status,200);
  const list=await handleMotherAiHistory(make('/api/member/ai/consultant/shares?mother_id=mother-a'),f.env,undefined,{authenticate:async()=>({id:'consultant-1'})});
  assert.equal((await list.json()).items.length,0);
 }finally{f.db.close()}
});
test('clearing private history also withdraws any shared copies; no automatic saves',async()=>{
 const f=await fixture();try{
  await handleMotherAiChat(make('/api/member/ai/chat','POST',{message:'Como melhorar a pega?'}),f.env,undefined,auth);
  let list=await handleMotherAiHistory(make('/api/member/ai/history'),f.env,undefined,auth);
  assert.equal((await list.json()).items.length,0);
  await handleMotherAiChat(make('/api/member/ai/chat','POST',{message:'Como melhorar a pega?',save_to_history:true}),f.env,undefined,auth);
  const clear=await handleMotherAiHistory(make('/api/member/ai/history','DELETE'),f.env,undefined,auth);
  assert.equal(clear.status,200);
  list=await handleMotherAiHistory(make('/api/member/ai/history'),f.env,undefined,auth);
  assert.equal((await list.json()).items.length,0);
 }finally{f.db.close()}
});

test('only explicit separate clinical consent sends mother guidance to the model',async()=>{
 const f=await fixture();try{
  Object.assign(f.env,{MOTHER_AI_ALLOW_INFERENCE:'true',MOTHER_AI_GLOBAL_DAILY_LIMIT:'2',
    MOTHER_AI_OWNER_DAILY_LIMIT:'2',MOTHER_AI_MOTHER_DAILY_LIMIT:'2'});
  const noConsent=await handleMotherAiChat(make('/api/member/ai/chat','POST',{
    message:'Como melhorar a pega?',consent_to_ai_processing:true,
    include_my_orientations:true,consent_to_clinical_context:false
  }),f.env,undefined,auth);
  assert.equal(noConsent.status,200);
  assert.equal(f.modelCalls,1);
  assert.doesNotMatch(f.lastPrompt,/Semana 1/);
  const yesConsent=await handleMotherAiChat(make('/api/member/ai/chat','POST',{
    message:'Como melhorar a pega?',consent_to_ai_processing:true,
    include_my_orientations:true,consent_to_clinical_context:true
  }),f.env,undefined,auth);
  assert.equal(yesConsent.status,200);
  assert.equal(f.modelCalls,2);
  assert.match(f.lastPrompt,/Semana 1/);
  assert.doesNotMatch(f.lastPrompt,/SEGREDO/);
 }finally{f.db.close()}
});
test('unpublished or revoked orientations are excluded immediately',async()=>{
 const f=await fixture();try{
  await f.db.prepare("UPDATE supabase_records SET record_json=json_set(record_json,'$.published',json('false')) WHERE table_name='member_shared_items' AND record_key='good'").run();
  const resp=await handleMotherAiChat(make('/api/member/ai/chat','POST',{
    message:'Como melhorar a pega?',include_my_orientations:true
  }),f.env,undefined,auth);
  assert.equal(resp.status,200);
  const result=await resp.json();
  assert.equal(result.orientations?.length||0,0);
  assert.doesNotMatch(JSON.stringify(result),/Semana 1|SEGREDO/);
 }finally{f.db.close()}
});
test('inactive invite stored in any case is blocked from history and AI',async()=>{
 const f=await fixture();try{
  await f.db.prepare("UPDATE supabase_records SET record_json=json_set(record_json,'$.active','FALSE') WHERE table_name='member_portal_access' AND record_key='access-a'").run();
  const resp=await handleMotherAiChat(make('/api/member/ai/chat','POST',{message:'Como melhorar a pega?'}),f.env,undefined,auth);
  assert.equal(resp.status,403);
  const list=await handleMotherAiHistory(make('/api/member/ai/history'),f.env,undefined,auth);
  assert.equal(list.status,403);
 }finally{f.db.close()}
});
