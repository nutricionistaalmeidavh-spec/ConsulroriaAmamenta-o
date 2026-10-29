import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { recordByIdForOwner } from './d1-record-store.js';
import { sendTransactionalEmail } from './transactional-email.js';

/**
 * Foundation only. Never send a mother a link before the signer/readonly PDF
 * flow has been completed, legally reviewed and explicitly enabled.
 */
export const SIGNABLE_CONSENTS=Object.freeze({
  data_processing:'Tratamento de dados pessoais e de saúde',
  whatsapp:'Contato por WhatsApp',
  clinical_media:'Fotos, vídeos e documentos clínicos',
  public_media:'Uso público de imagem',
  teleconsultation:'Teleatendimento',
});
const str=v=>String(v??'').trim();
const email=v=>str(v).toLowerCase();
const validEmail=v=>v.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const iso=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
function response(status,data){
  return new Response(JSON.stringify(data),{
    status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'},
  });
}
async function sha256(value){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str(value)));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function publicRequest(row){
  return {id:row.id,mother_id:row.mother_id,consent_type:row.consent_type,
    document_title:row.document_title,recipient_email:row.recipient_email,
    status:row.status,document_frozen:Boolean(row.document_frozen),created_at:row.created_at,expires_at:row.expires_at,sent_at:row.sent_at};
}
async function openRequest(db,ownerId,motherId,type){
  return db.prepare(`SELECT * FROM signature_requests WHERE owner_id=? AND mother_id=? AND consent_type=?
    AND status IN ('draft','sending','sent','delivery_failed') ORDER BY created_at DESC LIMIT 1`)
    .bind(ownerId,motherId,type).first();
}
async function createDraft(env,user,input,now,uuid){
  const db=env.CLINICAL_DB;
  const motherId=str(input?.mother_id),type=str(input?.consent_type);
  if(!motherId||!Object.hasOwn(SIGNABLE_CONSENTS,type)) return response(400,{error:'invalid_signature_request'});
  const mother=await recordByIdForOwner(db,'mothers',motherId,user.id);
  if(!mother) return response(404,{error:'mother_not_found'});
  const address=email(mother.record.email);
  if(!validEmail(address)) return response(422,{error:'mother_email_required',message:'Cadastre um e-mail válido para a mãe antes de solicitar assinatura.'});
  const existing=await openRequest(db,user.id,motherId,type);
  if(existing)return response(200,publicRequest(existing));
  // This is a consent RECORD snapshot, not yet the legal text of a signed PDF.
  // The document bytes will be frozen in signature_documents in a later phase.
  const consent=await db.prepare(`SELECT record_json FROM supabase_records WHERE table_name='consents'
    AND owner_id=? AND json_extract(record_json,'$.mother_id')=?
    AND json_extract(record_json,'$.consent_type')=?
    ORDER BY source_updated_at DESC LIMIT 1`).bind(user.id,motherId,type).first();
  let c=null;try{c=consent?.record_json?JSON.parse(consent.record_json):null}catch{}
  const snapshot={mother_id:motherId,consent_type:type,source_consent_id:c?.id||null,
    consent_granted:c?.granted===true,accepted_at:c?.accepted_at||null,
    revoked_at:c?.revoked_at||null,version:c?.version||null};
  const timestamp=now(),rid=uuid(),hash=await sha256(JSON.stringify(snapshot));
  const row={id:rid,owner_id:user.id,mother_id:motherId,consent_type:type,
    document_title:SIGNABLE_CONSENTS[type],recipient_email:address,
    source_consent_id:c?.id||null,source_sha256:hash,source_snapshot_json:JSON.stringify(snapshot),
    status:'draft',created_at:timestamp,updated_at:timestamp,expires_at:null,sent_at:null};
  try{
    await db.batch([
      db.prepare(`INSERT INTO signature_requests
        (id,owner_id,mother_id,consent_type,document_title,recipient_email,source_consent_id,
         source_sha256,source_snapshot_json,status,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?)`)
        .bind(rid,user.id,motherId,type,row.document_title,address,row.source_consent_id,hash,row.source_snapshot_json,timestamp,timestamp),
      db.prepare(`INSERT INTO signature_participants (id,request_id,owner_id,role,sign_order,email,status)
        VALUES(?,?,?,'mother',1,?,'pending')`).bind(uuid(),rid,user.id,address),
      db.prepare(`INSERT INTO signature_participants (id,request_id,owner_id,role,sign_order,email,status)
        VALUES(?,?,?,'consultant',2,?,'pending')`).bind(uuid(),rid,user.id,email(user.email)),
      db.prepare(`INSERT INTO signature_events (id,request_id,owner_id,event_type,actor_role,event_at)
        VALUES(?,?,?,'created','consultant',?)`).bind(uuid(),rid,user.id,timestamp),
    ]);
  }catch(e){
    // Under concurrent requests the partial unique index provides atomic deduplication.
    const raced=await openRequest(db,user.id,motherId,type);
    if(raced)return response(200,publicRequest(raced));
    throw e;
  }
  return response(201,publicRequest(row));
}
async function listDrafts(env,user,url){
  const motherId=str(url.searchParams.get('mother_id'));
  if(!motherId)return response(400,{error:'mother_id_required'});
  const rows=await env.CLINICAL_DB.prepare(`SELECT r.*, d.frozen_at AS document_frozen FROM signature_requests r
    LEFT JOIN signature_documents d ON d.request_id=r.id AND d.owner_id=r.owner_id AND d.version=1
    WHERE r.owner_id=? AND r.mother_id=? ORDER BY r.created_at DESC LIMIT 100`)
    .bind(user.id,motherId).all();
  return response(200,{requests:(rows.results||[]).map(publicRequest)});
}
function signingOrigin(env){
  const candidate=str(env.SIGNATURE_PUBLIC_ORIGIN)||'https://app.deboralactacao.com';
  const url=new URL(candidate);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')
    throw new Error('invalid_signature_public_origin');
  return url.origin;
}
function randomToken(){
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function sendRequest(env,user,requestId,deps){
  // Disabled by default: a live link must NEVER lead to a missing signing page.
  if(env.SIGNATURE_DELIVERY_ENABLED!=='true'||env.SIGNATURE_PUBLIC_FLOW_READY!=='true')
    return response(409,{error:'signature_signing_not_ready'});
  const db=env.CLINICAL_DB;
  const current=await db.prepare('SELECT * FROM signature_requests WHERE owner_id=? AND id=?')
    .bind(user.id,requestId).first();
  if(!current)return response(404,{error:'signature_request_not_found'});
  if(!['draft','delivery_failed'].includes(current.status))return response(409,{error:'signature_request_already_dispatched'});
  const document=await db.prepare(`SELECT * FROM signature_documents
    WHERE request_id=? AND owner_id=? ORDER BY version DESC LIMIT 1`)
    .bind(current.id,user.id).first();
  if(!document?.r2_key||!document?.sha256||!document?.frozen_at||!env.CLINICAL_FILES?.head ||
     !await env.CLINICAL_FILES.head(document.r2_key))
    return response(409,{error:'signature_frozen_document_required'});
  const timestamp=(deps.now||iso)();
  const expires=new Date(Date.parse(timestamp)+72*60*60*1000).toISOString();
  const claimed=await db.prepare(`UPDATE signature_requests SET status='sending',updated_at=?
    WHERE id=? AND owner_id=? AND status IN ('draft','delivery_failed')`)
    .bind(timestamp,requestId,user.id).run();
  if(Number(claimed.meta?.changes)!==1)return response(409,{error:'signature_request_already_dispatched'});
  const raw=randomToken(),hash=await sha256(raw);
  try{
    await db.prepare(`INSERT INTO signature_tokens
      (request_id,owner_id,token_sha256,created_at,expires_at,revoked_at)
      VALUES(?,?,?,?,?,NULL) ON CONFLICT(request_id) DO UPDATE SET
      token_sha256=excluded.token_sha256,created_at=excluded.created_at,
      expires_at=excluded.expires_at,revoked_at=NULL`)
      .bind(requestId,user.id,hash,timestamp,expires).run();
    const url=new URL('/assinar',signingOrigin(env));url.searchParams.set('token',raw);
    const transport=deps.sendEmail||sendTransactionalEmail;
    await transport(env,{kind:'signature_request',to:current.recipient_email,
      data:{documentTitle:current.document_title,signingUrl:url.toString(),expiresInHours:72}});
    await db.batch([
      db.prepare(`UPDATE signature_requests SET status='sent',updated_at=?,sent_at=?,expires_at=?
        WHERE id=? AND owner_id=? AND status='sending'`).bind(timestamp,timestamp,expires,requestId,user.id),
      db.prepare(`INSERT INTO signature_events (id,request_id,owner_id,event_type,actor_role,event_at)
        VALUES(?,?,?,'sent','system',?)`).bind((deps.uuid||id)(),requestId,user.id,timestamp),
    ]);
    return response(200,{id:requestId,status:'sent',expires_at:expires});
  }catch{
    // No live token survives a delivery or persistence error.
    await db.batch([
      db.prepare('UPDATE signature_tokens SET revoked_at=? WHERE request_id=? AND owner_id=?').bind(timestamp,requestId,user.id),
      db.prepare(`UPDATE signature_requests SET status='delivery_failed',updated_at=?
        WHERE id=? AND owner_id=? AND status='sending'`).bind(timestamp,requestId,user.id),
    ]).catch(()=>{});
    return response(503,{error:'signature_email_delivery_failed'});
  }
}
export async function handleSignatureRequestRuntime(request,env,url=new URL(request.url),deps={}){
  const base='/api/clinical/signatures/requests';
  const sendPath=/^\/api\/clinical\/signatures\/requests\/([a-f0-9-]{36})\/send$/i.exec(url.pathname);
  if(url.pathname!==base&&!sendPath)return null;
  if(!env.CLINICAL_DB)return response(503,{error:'clinical_db_required'});
  const user=await (deps.authenticate||authenticateClinicalRequest)(request,env);
  if(!user?.id)return response(401,{error:'cloudflare_auth_required'});
  if(sendPath&&request.method!=='POST')return response(405,{error:'method_not_allowed'});
  if(!sendPath&&!['GET','POST'].includes(request.method))return response(405,{error:'method_not_allowed'});
  try{
    if(sendPath)return sendRequest(env,user,sendPath[1],deps);
    if(request.method==='GET')return listDrafts(env,user,url);
    if(Number(request.headers.get('content-length')||0)>4096)return response(413,{error:'payload_too_large'});
    const input=await request.json().catch(()=>null);
    if(!input||typeof input!=='object'||Array.isArray(input))return response(400,{error:'invalid_signature_request'});
    return await createDraft(env,user,input,deps.now||iso,deps.uuid||id);
  }catch(error){
    console.error('signature_request_runtime_error',error?.name||'Error');
    return response(503,{error:'signature_requests_unavailable'});
  }
}
