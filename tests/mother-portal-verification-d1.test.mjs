import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteD1 } from './helpers/sqlite-d1.mjs';
import { requestMemberVerification, verifyMemberVerification } from '../worker/member-portal-verification-runtime.js';
import { authorizeMemberAttachment } from '../worker/block6-rpc-runtime.js';

const user={id:'mother-account-a',email:'maria@example.test'};
const now='2026-10-23T12:00:00.000Z';
function fixture(){
  const db=createSqliteD1(),messages=[];
  const env={CLINICAL_DB:db,MOTHER_PORTAL_ENABLED:'true',
    EMAIL:{send:async message=>messages.push(message)}};
  return {db,messages,env};
}
async function seed(db,table,key,owner,record){
  await db.prepare(`INSERT INTO supabase_records
    (table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at)
    VALUES(?,?,?,?,?,?,?)`).bind(table,key,owner,JSON.stringify(record),now,now,now).run();
}
function verifyRequest(code){
  return new Request('https://app.test/api/clinical/rpc/verify_member_verification',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code}),
  });
}

test('email proof is mandatory before binding a mother; the code is single-use',async()=>{
  const {db,env,messages}=fixture();
  try{
    await seed(db,'member_portal_access','invite-a','consultant-a',{
      id:'invite-a',owner_id:'consultant-a',mother_id:'mother-unique-1',
      email:user.email,member_user_id:null,tier:'free',active:true,
    });
    const request=await requestMemberVerification(env,user);
    assert.equal(request.status,200);
    assert.equal(messages.length,1);
    const code=messages[0].text.match(/\b\d{6}\b/)[0];
    const wrong=await verifyMemberVerification(env,user,verifyRequest('000000'===code?'999999':'000000'));
    assert.equal(wrong.status,403);
    const before=await db.prepare("SELECT record_json FROM supabase_records WHERE table_name='member_portal_access'").first();
    assert.equal(JSON.parse(before.record_json).member_user_id,null);
    const correct=await verifyMemberVerification(env,user,verifyRequest(code));
    assert.equal(correct.status,200);
    const bound=await correct.json();
    assert.equal(bound.member_user_id,user.id);
    assert.equal(bound.mother_id,'mother-unique-1');
    const repeated=await verifyMemberVerification(env,user,verifyRequest(code));
    assert.equal(repeated.status,403);
  }finally{db.close()}
});
test('different mothers with identical names retain separate UUID-based file grants',async()=>{
  const {db,env}=fixture();
  try{
    await seed(db,'member_portal_access','invite-a','consultant-a',{
      id:'invite-a',owner_id:'consultant-a',mother_id:'mother-unique-1',
      email:user.email,member_user_id:user.id,tier:'free',active:true,
    });
    await seed(db,'member_shared_items','share-a','consultant-a',{
      id:'share-a',owner_id:'consultant-a',mother_id:'mother-unique-1',
      title:'Orientações da Maria',kind:'document',attachment_path:'consultant-a/guides/a.pdf',published:true,
    });
    await seed(db,'member_shared_items','share-b','consultant-a',{
      id:'share-b',owner_id:'consultant-a',mother_id:'mother-unique-2',
      title:'Orientações da Maria',kind:'document',attachment_path:'consultant-a/guides/b.pdf',published:true,
    });
    assert.equal(await authorizeMemberAttachment(env,user,'clinical-media','consultant-a/guides/a.pdf'),true);
    assert.equal(await authorizeMemberAttachment(env,user,'clinical-media','consultant-a/guides/b.pdf'),false);
    await db.prepare("UPDATE supabase_records SET record_json=json_set(record_json,'$.published',json('false')) WHERE table_name='member_shared_items' AND record_key='share-a'").run();
    assert.equal(await authorizeMemberAttachment(env,user,'clinical-media','consultant-a/guides/a.pdf'),false);
  }finally{db.close()}
});
