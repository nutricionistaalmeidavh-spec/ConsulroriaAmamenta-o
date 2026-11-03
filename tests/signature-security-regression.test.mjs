import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {createSqliteD1} from './helpers/sqlite-d1.mjs';
import {persistPatientEdit} from '../worker/patient-write-runtime.js';
import {handleSignatureRequestRuntime} from '../worker/signature-requests-runtime.js';
import {handleSignatureFlowRuntime} from '../worker/signature-flow-runtime.js';

const owner={id:'consultora-a',email:'consultora@example.com',email_confirmed_at:'2026-10-01T12:00:00Z',user_metadata:{full_name:'Consultora Teste'}};
async function setup(){
 const db=createSqliteD1();
 db.exec(readFileSync(new URL('../cloudflare/migrations/0019-signature-foundation.sql',import.meta.url),'utf8'));
 const time=new Date('2026-10-01T00:00:00Z').toISOString();
 const mother={id:'mae-1',owner_id:owner.id,name:'Maria Teste',email:'maria@example.com',created_at:time,updated_at:time};
 await db.prepare("INSERT INTO supabase_records (table_name,record_key,owner_id,record_json,created_at,updated_at,source_updated_at) VALUES('mothers',?,?,?,?,?,?)")
  .bind(mother.id,owner.id,JSON.stringify(mother),time,time,time).run();
 const objects=new Map(),message=[];
 const env={CLINICAL_DB:db,CLINICAL_AUTH_SECRET:'dummy-nonproduction-key',SIGNATURE_DELIVERY_ENABLED:'true',SIGNATURE_PUBLIC_FLOW_READY:'true',SIGNATURE_PUBLIC_ORIGIN:'https://assinaturas.example.test',
  CLINICAL_FILES:{async put(key,data){objects.set(key,new Uint8Array(data));},async head(key){return objects.has(key)?{size:objects.get(key).length}:null;},async get(key){const data=objects.get(key);return data?{arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)}:null;}}};
 async function call(method,path,body=null,actor=owner,headers={}){
  const request=new Request('https://assinaturas.example.test'+path,{method,headers:{...(body!==null?{'content-type':body instanceof Uint8Array?'application/pdf':'application/json'}:{}),...headers},...(body!==null?{body:body instanceof Uint8Array?body:JSON.stringify(body)}:{})});
  const dep={authenticate:async()=>actor,sendEmail:async(_e,m)=>{message.push(m);return {provider:'fake'}}};
  const f=path.includes('/api/clinical/signatures/requests')&&!(/\/(document|sign)$/.test(path))?handleSignatureRequestRuntime:handleSignatureFlowRuntime;
  return f(request,env,undefined,dep);
 }
 const base='/api/clinical/signatures/requests';
 const create=async(type='whatsapp')=>(await (await call('POST',base,{mother_id:'mae-1',consent_type:type})).json());
 const freeze=async(id)=>call('POST',base+'/'+id+'/document',{reviewed:true});
 const send=async(id)=>call('POST',base+'/'+id+'/send',{});
 const token=()=>new URL(message.at(-1).data.signingUrl).searchParams.get('token');
 const signMother=async(full_name='Maria Teste')=>call('POST','/api/signatures/recipient/sign',{full_name,signature_mode:'typed',signature_value:full_name,read_document:true,accepted:true},owner,{'x-signature-token':token()});
 const signConsultant=async(id,actor=owner,full_name='Consultora Teste')=>call('POST',base+'/'+id+'/sign',{full_name,signature_mode:'typed',signature_value:full_name,read_document:true,accepted:true},actor);
 return {db,env,objects,message,call,create,freeze,send,token,signMother,signConsultant,close:()=>db.close()};
}
test('institutional sender cannot send an old recipient after maternal address changes',async()=>{
 const x=await setup();try{
  const d=await x.create();
  assert.equal((await x.freeze(d.id)).status,201);
  const edited=await persistPatientEdit(x.env,owner,{mother:{id:'mae-1',email:'updated@example.com'},consents:{}});
  assert.equal(edited.mother.email,'updated@example.com');
  const prior=await x.db.prepare('SELECT status FROM signature_requests WHERE id=?').bind(d.id).first();
  assert.equal(prior.status,'cancelled');
  assert.equal((await x.send(d.id)).status,409);
  const again=await x.create();
  assert.notEqual(again.id,d.id);
  assert.equal(again.recipient_email,'updated@example.com');
 }finally{x.close()}
});
test('editing maternal email revokes already dispatched bearer links immediately',async()=>{
 const x=await setup();try{
  const d=await x.create();await x.freeze(d.id);assert.equal((await x.send(d.id)).status,200);
  const t=x.token();
  await persistPatientEdit(x.env,owner,{mother:{id:'mae-1',email:'updated@example.com'},consents:{}});
  const expired=await x.call('GET','/api/signatures/recipient',null,owner,{'x-signature-token':t});
  assert.equal(expired.status,410);
  assert.equal(x.message.length,1);
 }finally{x.close()}
});
test('public signing cannot use a bare account name entered by an unidentifiable consultant',async()=>{
 const x=await setup();try{
  const d=await x.create();await x.freeze(d.id);await x.send(d.id);assert.equal((await x.signMother()).status,200);
  const fake={id:owner.id,email:owner.email,user_metadata:{}};
  const rejected=await x.signConsultant(d.id,fake,'Nome Inventado');
  assert.equal(rejected.status,422);
  assert.equal((await x.db.prepare('SELECT status FROM signature_requests WHERE id=?').bind(d.id).first()).status,'mother_signed');
 }finally{x.close()}
});
test('missing verified public origin does not send a link or persist live token',async()=>{
 const x=await setup();try{
  const d=await x.create();await x.freeze(d.id);delete x.env.SIGNATURE_PUBLIC_ORIGIN;
  const response=await x.send(d.id);
  assert.equal(response.status,409);
  assert.equal((await response.json()).error,'signature_origin_not_configured');
  assert.equal(x.message.length,0);
  assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM signature_tokens').first()).n,0);
 }finally{x.close()}
});
test('browser PDF upload cannot replace the system-approved canonical term',async()=>{
 const x=await setup();try{
  const d=await x.create();
  const pdf=await PDFDocument.create();pdf.addPage();
  const raw=new Uint8Array(await pdf.save());
  const upload=await x.call('POST','/api/clinical/signatures/requests/'+d.id+'/document',raw,owner,{'x-document-reviewed':'true'});
  assert.equal(upload.status,415);
  const frozen=await x.freeze(d.id);assert.equal(frozen.status,201);
  const source=await x.db.prepare('SELECT sha256,r2_key FROM signature_documents WHERE request_id=? AND version=1').bind(d.id).first();
  assert.ok(x.objects.has(source.r2_key));
 }finally{x.close()}
});
test('mother signature synchronizes optional consent but not privacy notice, with audit reference',async()=>{
 const x=await setup();try{
  const d=await x.create('clinical_media');await x.freeze(d.id);await x.send(d.id);
  assert.equal((await x.signMother()).status,200);
  const rows=await x.db.prepare("SELECT record_json FROM supabase_records WHERE table_name='consents' AND owner_id=?").bind(owner.id).all();
  const c=rows.results.map(v=>JSON.parse(v.record_json)).find(v=>v.consent_type==='clinical_media');
  assert.equal(c.granted,true);
  assert.equal(c.version,'1.1');
  assert.equal(c.signature_request_id,d.id);
  assert.ok(c.accepted_at);
  const notice=await x.create('data_processing');await x.freeze(notice.id);await x.send(notice.id);await x.signMother();
  const rows2=await x.db.prepare("SELECT record_json FROM supabase_records WHERE table_name='consents'").all();
  const n=rows2.results.map(v=>JSON.parse(v.record_json)).find(v=>v.consent_type==='data_processing');
  assert.equal(n.granted,false);
  assert.equal(n.signature_notice_request_id,notice.id);
 }finally{x.close()}
});
test('new explicit revocation supersedes an old pending request and cannot be silently overwritten',async()=>{
 const x=await setup();try{
  const d=await x.create('whatsapp');await x.freeze(d.id);await x.send(d.id);
  const newer={id:'consent-new',mother_id:'mae-1',owner_id:owner.id,consent_type:'whatsapp',granted:false,
    revoked_at:new Date(Date.now()+10000).toISOString(),created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  await x.db.prepare("INSERT INTO supabase_records (table_name,record_key,owner_id,record_json) VALUES('consents',?,?,?)")
    .bind(newer.id,owner.id,JSON.stringify(newer)).run();
  const signed=await x.signMother();
  assert.equal(signed.status,409);
  const saved=await x.db.prepare("SELECT record_json FROM supabase_records WHERE record_key=?").bind(newer.id).first();
  assert.equal(JSON.parse(saved.record_json).granted,false);
  assert.equal((await x.db.prepare('SELECT status FROM signature_requests WHERE id=?').bind(d.id).first()).status,'sent');
 }finally{x.close()}
});
