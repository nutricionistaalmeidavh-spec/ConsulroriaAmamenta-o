import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument,StandardFonts } from 'pdf-lib';
import { createSqliteD1 } from './helpers/sqlite-d1.mjs';
import { handleSignatureRequestRuntime } from '../worker/signature-requests-runtime.js';
import { handleSignatureFlowRuntime } from '../worker/signature-flow-runtime.js';
import { digestHex } from '../worker/signature-pdf.js';

const consultant={id:'consultora-a',email:'consultora@example.com',user_metadata:{full_name:'Consultora Teste'}};
const recipient='/api/signatures/recipient';
async function fixture(){
  const db=createSqliteD1();
  db.exec(readFileSync(new URL('../cloudflare/migrations/0019-signature-foundation.sql',import.meta.url),'utf8'));
  await db.prepare("INSERT INTO supabase_records (table_name,record_key,owner_id,record_json) VALUES ('mothers',?,?,?)")
    .bind('mae-1',consultant.id,JSON.stringify({id:'mae-1',owner_id:consultant.id,name:'Maria Teste',email:'maria@example.com'})).run();
  const objects=new Map();
  const r2={
    async put(key,data){objects.set(key,new Uint8Array(data));return {key}},
    async get(key){const bytes=objects.get(key);return bytes?{arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}:null},
    async head(key){const bytes=objects.get(key);return bytes?{size:bytes.length}:null},
  };
  const env={CLINICAL_DB:db,CLINICAL_FILES:r2,CLINICAL_AUTH_SECRET:'fixed-local-test-secret',
    SIGNATURE_DELIVERY_ENABLED:'true',SIGNATURE_PUBLIC_FLOW_READY:'true'};
  let link='';
  async function call(method,path,body,{token='',as=consultant,raw=false,reviewed=false}={}){
    const req=new Request('https://app.deboralactacao.com'+path,{
      method,headers:{...(token?{'x-signature-token':token}:{}),...(reviewed?{'x-document-reviewed':'true'}:{}),...(raw?{'content-type':'application/pdf'}:body?{'content-type':'application/json'}:{})},
      ...(body!=null?{body:raw?body:JSON.stringify(body)}:{})});
    const deps={authenticate:async()=>as,sendEmail:async(_env,message)=>{link=message.data.signingUrl;return {provider:'fake'}}};
    return path.startsWith('/api/clinical/signatures/requests') && !path.endsWith('/document') && !path.endsWith('/sign')
      ? handleSignatureRequestRuntime(req,env,undefined,deps)
      : handleSignatureFlowRuntime(req,env,undefined,deps);
  }
  const signed=async(doc,fullName,token=null,as=consultant)=>{
    const path=token?recipient+'/sign':'/api/clinical/signatures/requests/'+doc+'/sign';
    return call('POST',path,{full_name:fullName,signature_mode:'typed',signature_value:fullName,read_document:true,accepted:true},{token:token||'',as});
  };
  const pdf=await PDFDocument.create(),page=pdf.addPage([595,842]);
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Texto integral previamente aprovado pela consultora.',{x:60,y:760,font,size:12});
  const pdfBytes=new Uint8Array(await pdf.save());
  return {db,env,objects,call,signed,pdfBytes,get link(){return link},close(){db.close()}};
}

test('complete sequential maternal + consultant signature, preserves source PDF, stores evidence and validates hash',async()=>{
  const x=await fixture();try{
    const first=await x.call('POST','/api/clinical/signatures/requests',{mother_id:'mae-1',consent_type:'whatsapp'});
    assert.equal(first.status,201);const item=await first.json();
    const base='/api/clinical/signatures/requests/'+item.id;
    const frozen=await x.call('POST',base+'/document',x.pdfBytes,{raw:true,reviewed:true});
    assert.equal(frozen.status,201);assert.equal((await frozen.json()).version,1);
    assert.equal((await x.call('GET',base+'/document')).status,200);
    const sent=await x.call('POST',base+'/send',{});
    assert.equal(sent.status,200);
    const token=new URL(x.link).searchParams.get('token');
    assert.match(token,/^[a-f0-9]{64}$/);
    const meta=await x.call('GET',recipient,undefined,{token});
    assert.equal(meta.status,200);assert.equal((await meta.json()).full_name,'Maria Teste');
    const view=await x.call('GET',recipient+'/document',undefined,{token});
    assert.equal(view.status,200);
    assert.equal(await digestHex(new Uint8Array(await view.arrayBuffer())),await digestHex(x.pdfBytes));
    assert.equal((await x.signed(item.id,'Alguém',token)).status,422);
    const maternal=await x.signed(item.id,'Maria Teste',token);
    assert.equal(maternal.status,200);assert.equal((await maternal.json()).status,'mother_signed');
    assert.equal((await x.call('GET',recipient,undefined,{token})).status,410);
    assert.equal((await x.signed(item.id,'Maria Teste',token)).status,410);
    assert.equal((await x.signed(item.id,'Outra Pessoa')).status,422);
    const professional=await x.signed(item.id,'Consultora Teste');
    assert.equal(professional.status,200);
    const result=await professional.json();assert.equal(result.status,'completed');
    const latest=await x.call('GET',base+'/document');
    assert.equal(latest.status,200);
    const completedPdf=await PDFDocument.load(await latest.arrayBuffer());
    assert.equal(completedPdf.getPageCount(),3);
    const events=await x.db.prepare("SELECT actor_role,event_hash FROM signature_events WHERE request_id=? AND event_type='signed' ORDER BY event_at").bind(item.id).all();
    assert.equal(events.results.length,2);
    assert.ok(events.results.every(e=>/^[a-f0-9]{64}$/.test(e.event_hash)));
    const verify=await x.call('GET','/api/signatures/verify/'+item.id+'?sha256='+result.sha256);
    assert.equal((await verify.json()).valid,true);
    const forged=await x.call('GET','/api/signatures/verify/'+item.id+'?sha256='+'a'.repeat(64));
    assert.equal((await forged.json()).valid,false);
    assert.equal((await x.signed(item.id,'Consultora Teste')).status,409);
  }finally{x.close()}
});
test('no document upload without consultant review and no cross-tenant access',async()=>{
  const x=await fixture();try{
    const created=await (await x.call('POST','/api/clinical/signatures/requests',{mother_id:'mae-1',consent_type:'public_media'})).json();
    const base='/api/clinical/signatures/requests/'+created.id;
    assert.equal((await x.call('POST',base+'/document',x.pdfBytes,{raw:true})).status,400);
    assert.equal((await x.call('POST',base+'/document',x.pdfBytes,{raw:true,reviewed:true,as:{id:'consultora-b'}})).status,404);
    const result=await x.call('POST',base+'/document',x.pdfBytes,{raw:true,reviewed:true});
    assert.equal(result.status,201);
    assert.equal((await x.call('POST',base+'/document',x.pdfBytes,{raw:true,reviewed:true})).status,409);
    assert.equal((await x.call('GET',base+'/document',undefined,{as:{id:'consultora-b'}})).status,404);
  }finally{x.close()}
});
test('content-hash mismatch prevents recipient from seeing a corrupted PDF',async()=>{
  const x=await fixture();try{
    const item=await (await x.call('POST','/api/clinical/signatures/requests',{mother_id:'mae-1',consent_type:'teleconsultation'})).json();
    const base='/api/clinical/signatures/requests/'+item.id;
    await x.call('POST',base+'/document',x.pdfBytes,{raw:true,reviewed:true});
    await x.call('POST',base+'/send',{});
    const doc=await x.db.prepare('SELECT r2_key FROM signature_documents WHERE request_id=? AND version=1').bind(item.id).first();
    x.objects.get(doc.r2_key)[5]^=1;
    const token=new URL(x.link).searchParams.get('token');
    const resp=await x.call('GET',recipient+'/document',undefined,{token});
    assert.notEqual(resp.status,200);
  }finally{x.close()}
});
