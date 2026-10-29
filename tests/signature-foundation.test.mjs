import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.mjs';
import { handleSignatureRequestRuntime } from '../worker/signature-requests-runtime.js';

function setup() {
  const db = createSqliteD1();
  db.exec(readFileSync(new URL('../cloudflare/migrations/0019-signature-foundation.sql', import.meta.url), 'utf8'));
  async function mother(owner, id, email) {
    await db.prepare("INSERT INTO supabase_records (table_name,record_key,owner_id,record_json) VALUES ('mothers',?,?,?)")
      .bind(id,owner,JSON.stringify({id,owner_id:owner,name:'Maria',email})).run();
  }
  const env={CLINICAL_DB:db};
  const run=(method,path,body,user={id:'consultora-a',email:'consultora@example.com'},extra={})=>
    handleSignatureRequestRuntime(new Request('https://app.deboralactacao.com'+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,undefined,{authenticate:async()=>user,...extra});
  return {db,env,mother,run};
}

test('creates an owned draft using the persisted maternal email and without requiring a baby',async()=>{
  const s=setup();try{
    await s.mother('consultora-a','mae-1','maria@example.com');
    const resp=await s.run('POST','/api/clinical/signatures/requests',{mother_id:'mae-1',consent_type:'whatsapp',email:'intruso@example.com'});
    assert.equal(resp.status,201);
    const draft=await resp.json();
    assert.equal(draft.status,'draft');
    assert.equal(draft.recipient_email,'maria@example.com');
    assert.equal(draft.mother_id,'mae-1');
    const stored=await s.db.prepare('SELECT recipient_email,status FROM signature_requests WHERE id=?').bind(draft.id).first();
    assert.deepEqual(stored,{recipient_email:'maria@example.com',status:'draft'});
    const recipients=await s.db.prepare('SELECT role FROM signature_participants WHERE request_id=? ORDER BY sign_order').bind(draft.id).all();
    assert.deepEqual(recipients.results.map(x=>x.role),['mother','consultant']);
  }finally{s.db.close()}
});
test('fails closed on missing, invalid or cross-tenant mothers',async()=>{
  const s=setup();try{
    await s.mother('consultora-b','mae-2','maria@example.com');
    assert.equal((await s.run('POST','/api/clinical/signatures/requests',{mother_id:'mae-2',consent_type:'whatsapp'})).status,404);
    await s.mother('consultora-a','mae-3','');
    assert.equal((await s.run('POST','/api/clinical/signatures/requests',{mother_id:'mae-3',consent_type:'whatsapp'})).status,422);
    assert.equal((await s.run('POST','/api/clinical/signatures/requests',{mother_id:'mae-3',consent_type:'other'})).status,400);
  }finally{s.db.close()}
});
test('one open draft per mother and consent type, listing cannot disclose another tenant',async()=>{
  const s=setup();try{
    await s.mother('consultora-a','mae-1','maria@example.com');
    const body={mother_id:'mae-1',consent_type:'data_processing'};
    const first=await s.run('POST','/api/clinical/signatures/requests',body);
    const second=await s.run('POST','/api/clinical/signatures/requests',body);
    assert.equal(first.status,201); assert.equal(second.status,200);
    assert.equal((await first.json()).id,(await second.json()).id);
    const other=await s.run('GET','/api/clinical/signatures/requests?mother_id=mae-1',undefined,{id:'consultora-b'});
    assert.equal(other.status,200);assert.deepEqual((await other.json()).requests,[]);
  }finally{s.db.close()}
});
test('dispatch is disabled until full recipient signing flow exists; no premature email',async()=>{
  const s=setup();try{
    await s.mother('consultora-a','mae-1','maria@example.com');
    const draft=await (await s.run('POST','/api/clinical/signatures/requests',{mother_id:'mae-1',consent_type:'clinical_media'})).json();
    let emails=0;
    const attempt=await s.run('POST',`/api/clinical/signatures/requests/${draft.id}/send`,{},undefined,{sendEmail:async()=>{emails++}});
    assert.equal(attempt.status,409);
    assert.equal((await attempt.json()).error,'signature_signing_not_ready');
    assert.equal(emails,0);
    const state=await s.db.prepare('SELECT status FROM signature_requests WHERE id=?').bind(draft.id).first();
    assert.equal(state.status,'draft');
  }finally{s.db.close()}
});

test('delivery uses frozen R2 document and token hash, never persists raw link token',async()=>{
  const s=setup();try{
    await s.mother('consultora-a','mae-1','maria@example.com');
    const created=await (await s.run('POST','/api/clinical/signatures/requests',{mother_id:'mae-1',consent_type:'whatsapp'})).json();
    await s.db.prepare(`INSERT INTO signature_documents
      (id,request_id,owner_id,version,r2_key,sha256,frozen_at,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind('doc-1',created.id,'consultora-a',1,'private/doc-1.pdf','a'.repeat(64),new Date().toISOString(),new Date().toISOString()).run();
    s.env.SIGNATURE_DELIVERY_ENABLED='true';s.env.SIGNATURE_PUBLIC_FLOW_READY='true';
    s.env.CLINICAL_FILES={head:async key=>key==='private/doc-1.pdf'?{size:1024}:null};
    let message=null;
    const sent=await s.run('POST',`/api/clinical/signatures/requests/${created.id}/send`,{},undefined,{
      sendEmail:async (_env,m)=>{message=m;return {provider:'test'}},
    });
    assert.equal(sent.status,200);
    assert.equal((await sent.json()).status,'sent');
    assert.equal(message.to,'maria@example.com');
    const link=new URL(message.data.signingUrl);
    assert.equal(link.origin,'https://app.deboralactacao.com');
    const raw=link.searchParams.get('token');
    assert.match(raw,/^[a-f0-9]{64}$/);
    const token=await s.db.prepare('SELECT token_sha256 FROM signature_tokens WHERE request_id=?').bind(created.id).first();
    assert.match(token.token_sha256,/^[a-f0-9]{64}$/);
    assert.notEqual(token.token_sha256,raw);
    const retry=await s.run('POST',`/api/clinical/signatures/requests/${created.id}/send`,{},undefined,{sendEmail:async()=>assert.fail('duplicate delivery')});
    assert.equal(retry.status,409);
  }finally{s.db.close()}
});
test('failed delivery is fail-closed and revokes its token',async()=>{
  const s=setup();try{
    await s.mother('consultora-a','mae-1','maria@example.com');
    const draft=await (await s.run('POST','/api/clinical/signatures/requests',{mother_id:'mae-1',consent_type:'whatsapp'})).json();
    await s.db.prepare(`INSERT INTO signature_documents
      (id,request_id,owner_id,version,r2_key,sha256,frozen_at,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind('doc-1',draft.id,'consultora-a',1,'private/doc-1.pdf','a'.repeat(64),new Date().toISOString(),new Date().toISOString()).run();
    s.env.SIGNATURE_DELIVERY_ENABLED='true';s.env.SIGNATURE_PUBLIC_FLOW_READY='true';
    s.env.CLINICAL_FILES={head:async()=>({size:1024})};
    const resp=await s.run('POST',`/api/clinical/signatures/requests/${draft.id}/send`,{},undefined,{sendEmail:async()=>{throw Error('transient_failure')}});
    assert.equal(resp.status,503);
    assert.equal((await s.db.prepare('SELECT status FROM signature_requests WHERE id=?').bind(draft.id).first()).status,'delivery_failed');
    assert.ok((await s.db.prepare('SELECT revoked_at FROM signature_tokens WHERE request_id=?').bind(draft.id).first()).revoked_at);
  }finally{s.db.close()}
});
