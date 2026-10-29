import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { recordByIdForOwner } from './d1-record-store.js';
import { checkPdf,parseSignature,digestHex,hmacHex,appendSignatureAnnex,MAX_SIGNATURE_PDF_BYTES } from './signature-pdf.js';

const enc=new TextEncoder(), str=v=>String(v??'').trim(), now=()=>new Date().toISOString(), uid=()=>crypto.randomUUID();
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...headers,'content-type':'application/json; charset=utf-8'}});
const pdfResponse=(bytes,name)=>new Response(bytes,{headers:{...headers,'content-type':'application/pdf','content-disposition':`inline; filename="${name}.pdf"`,'content-security-policy':"default-src 'none'; sandbox"}});
async function getOwner(db,requestId,ownerId){
  return db.prepare('SELECT * FROM signature_requests WHERE id=? AND owner_id=?').bind(requestId,ownerId).first();
}
async function getDocument(db,requestId,ownerId,version=null){
  return version==null
    ?db.prepare('SELECT * FROM signature_documents WHERE request_id=? AND owner_id=? ORDER BY version DESC LIMIT 1').bind(requestId,ownerId).first()
    :db.prepare('SELECT * FROM signature_documents WHERE request_id=? AND owner_id=? AND version=?').bind(requestId,ownerId,version).first();
}
async function readPdf(env,entry){
  if(!entry?.r2_key||!env.CLINICAL_FILES?.get)throw new Error('signature_document_unavailable');
  const object=await env.CLINICAL_FILES.get(entry.r2_key);
  if(!object)throw new Error('signature_document_unavailable');
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(await digestHex(bytes)!==entry.sha256)throw new Error('signature_document_hash_mismatch');
  await checkPdf(bytes);
  return bytes;
}
async function eventSeal(env,entry,role,when,hash){
  const proof=[entry.id,entry.owner_id,entry.mother_id,role,when,hash].join('|');
  return hmacHex(env.CLINICAL_AUTH_SECRET,proof);
}
async function filePut(env,key,bytes){
  if(!env.CLINICAL_FILES?.put)throw new Error('signature_r2_required');
  await env.CLINICAL_FILES.put(key,bytes,{httpMetadata:{contentType:'application/pdf'},
    customMetadata:{module:'clinical-signature',immutable:'true'}});
}
async function freeze(request,env,entry){
  if(entry.status!=='draft')return json(409,{error:'signature_request_not_draft'});
  if(request.headers.get('x-document-reviewed')!=='true')return json(400,{error:'signature_document_review_required'});
  const size=Number(request.headers.get('content-length')||0);
  if(size>MAX_SIGNATURE_PDF_BYTES)return json(413,{error:'signature_document_too_large'});
  const bytes=new Uint8Array(await request.arrayBuffer());
  try{await checkPdf(bytes)}catch{return json(422,{error:'signature_pdf_invalid'})}
  if(await getDocument(env.CLINICAL_DB,entry.id,entry.owner_id,1))return json(409,{error:'signature_document_already_frozen'});
  const hash=await digestHex(bytes);
  const key=`signatures/${entry.owner_id}/${entry.mother_id}/${entry.id}/source-${hash}.pdf`;
  await filePut(env,key,bytes);
  const timestamp=now();
  try{
    await env.CLINICAL_DB.batch([
      env.CLINICAL_DB.prepare(`INSERT INTO signature_documents
        (id,request_id,owner_id,version,r2_key,sha256,frozen_at,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).bind(uid(),entry.id,entry.owner_id,1,key,hash,timestamp,timestamp),
      env.CLINICAL_DB.prepare(`INSERT INTO signature_evidence (id,request_id,owner_id,evidence_type,evidence_sha256,r2_key,created_at)
        VALUES(?,?,?,'source_pdf_sha256',?,?,?)`).bind(uid(),entry.id,entry.owner_id,hash,key,timestamp),
      env.CLINICAL_DB.prepare(`INSERT INTO signature_events (id,request_id,owner_id,event_type,actor_role,event_at,metadata_json)
        VALUES(?,?,?,'document_frozen','consultant',?,?)`).bind(uid(),entry.id,entry.owner_id,timestamp,JSON.stringify({sha256:hash,bytes:bytes.length})),
    ]);
  }catch{
    // Unique(request_id,version) blocks any concurrent or repeat source replacement.
    return json(409,{error:'signature_document_already_frozen'});
  }
  return json(201,{id:entry.id,version:1,sha256:hash,status:'frozen'});
}
async function lookupToken(env,request) {
  const token=str(request.headers.get('x-signature-token'));
  if(!/^[a-f0-9]{64}$/.test(token))return null;
  const hash=await digestHex(token);
  const result=await env.CLINICAL_DB.prepare(`SELECT sr.*,st.expires_at AS token_expires
    FROM signature_tokens st JOIN signature_requests sr ON sr.id=st.request_id AND sr.owner_id=st.owner_id
    WHERE st.token_sha256=? AND st.revoked_at IS NULL AND st.expires_at>?
    AND sr.status='sent' AND sr.expires_at>? LIMIT 1`).bind(hash,now(),now()).first();
  return result||null;
}
async function viewPublic(request,env,mode){
  const entry=await lookupToken(env,request);
  if(!entry)return json(410,{error:'signature_link_invalid_or_expired'});
  const source=await getDocument(env.CLINICAL_DB,entry.id,entry.owner_id,1);
  if(!source)return json(409,{error:'signature_document_unavailable'});
  if(mode==='document')return pdfResponse(await readPdf(env,source),'termo-para-assinatura');
  const mother=await recordByIdForOwner(env.CLINICAL_DB,'mothers',entry.mother_id,entry.owner_id);
  if(!mother)return json(410,{error:'signature_mother_unavailable'});
  return json(200,{title:entry.document_title,full_name:mother.record.name,status:'awaiting_signature',
    expires_at:entry.token_expires,document_sha256:source.sha256});
}
async function confirmSignature(env,entry,role,input){
  const db=env.CLINICAL_DB;
  const mother=await recordByIdForOwner(db,'mothers',entry.mother_id,entry.owner_id);
  if(!mother) return json(410,{error:'signature_mother_unavailable'});
  const expectedName=role==='mother'?mother.record.name:input.expectedName;
  let signature;
  try{signature=parseSignature(input,expectedName)}catch(e){return json(422,{error:e.message})}
  const prior=role==='mother'?'sent':'mother_signed';
  const locked=role==='mother'?'signing_mother':'signing_consultant';
  const after=role==='mother'?'mother_signed':'completed';
  const version=role==='mother'?1:2, newVersion=version+1;
  const changed=await db.prepare('UPDATE signature_requests SET status=?,updated_at=? WHERE id=? AND owner_id=? AND status=?')
    .bind(locked,now(),entry.id,entry.owner_id,prior).run();
  if(Number(changed.meta?.changes||0)!==1)return json(409,{error:'signature_state_conflict'});
  let outputKey='';
  try{
    const source=await getDocument(db,entry.id,entry.owner_id,version);
    if(!source)throw new Error('signature_prior_document_missing');
    const sourcePdf=await readPdf(env,source);
    const when=now();
    const output=await appendSignatureAnnex(sourcePdf,{
      requestId:entry.id,documentTitle:entry.document_title,signerName:signature.legalName,
      role,isoTime:when,signature,sourceHash:source.sha256,
    });
    const resultHash=await digestHex(output);
    outputKey=`signatures/${entry.owner_id}/${entry.mother_id}/${entry.id}/v${newVersion}-${resultHash}.pdf`;
    await filePut(env,outputKey,output);
    const seal=await eventSeal(env,entry,role,when,resultHash);
    const eventData={source_sha256:source.sha256,final_sha256:resultHash,mode:signature.mode,
      email:role==='mother'?entry.recipient_email:input.actorEmail,full_name:signature.legalName};
    const steps=[
      db.prepare(`INSERT INTO signature_documents
        (id,request_id,owner_id,version,r2_key,sha256,frozen_at,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).bind(uid(),entry.id,entry.owner_id,newVersion,outputKey,resultHash,when,when),
      db.prepare(`INSERT INTO signature_events
        (id,request_id,owner_id,event_type,actor_role,event_at,event_hash,metadata_json)
        VALUES(?,?,?,?,?,?,?,?)`).bind(uid(),entry.id,entry.owner_id,'signed',role,when,seal,JSON.stringify(eventData)),
      db.prepare(`INSERT INTO signature_evidence
        (id,request_id,participant_id,owner_id,evidence_type,evidence_sha256,r2_key,created_at)
        VALUES(?, ?, (SELECT id FROM signature_participants WHERE request_id=? AND role=?), ?,'signature_hmac_sha256',?,?,?)`)
        .bind(uid(),entry.id,entry.id,role,entry.owner_id,seal,outputKey,when),
      db.prepare(`UPDATE signature_participants SET status='signed',signed_at=? WHERE request_id=? AND owner_id=? AND role=? AND status='pending'`)
        .bind(when,entry.id,entry.owner_id,role),
      db.prepare(`UPDATE signature_requests SET status=?,updated_at=?,completed_at=?
        WHERE id=? AND owner_id=? AND status=?`)
        .bind(after,when,role==='consultant'?when:null,entry.id,entry.owner_id,locked),
    ];
    if(role==='mother')steps.push(db.prepare('UPDATE signature_tokens SET revoked_at=? WHERE request_id=? AND owner_id=? AND revoked_at IS NULL').bind(when,entry.id,entry.owner_id));
    await db.batch(steps);
    return json(200,{status:after,version:newVersion,sha256:resultHash,request_id:entry.id});
  }catch(err){
    // Any error returns to previous state to permit retry. Orphaned content-addressed
    // R2 objects are harmless and never become a signed document without the D1 commit.
    await db.prepare('UPDATE signature_requests SET status=?,updated_at=? WHERE id=? AND owner_id=? AND status=?')
      .bind(prior,now(),entry.id,entry.owner_id,locked).run().catch(()=>{});
    console.error('signature_finalize_failed',String(err?.message||err));
    return json(503,{error:'signature_finalize_failed'});
  }
}
export async function handleSignatureFlowRuntime(request,env,url=new URL(request.url),deps={}){
  const publicPath=/^\/api\/signatures\/recipient(?:\/(document|sign))?$/.exec(url.pathname);
  const professionalPath=/^\/api\/clinical\/signatures\/requests\/([a-f0-9-]{36})\/(document|sign)$/i.exec(url.pathname);
  const verifyPath=/^\/api\/signatures\/verify\/([a-f0-9-]{36})$/i.exec(url.pathname);
  if(!publicPath&&!professionalPath&&!verifyPath)return null;
  if(!env.CLINICAL_DB)return json(503,{error:'clinical_db_required'});
  if(verifyPath&&request.method==='GET'){
    const requestId=verifyPath[1],expectedHash=str(url.searchParams.get('sha256'));
    if(!/^[a-f0-9]{64}$/.test(expectedHash))return json(400,{error:'sha256_required'});
    const entry=await env.CLINICAL_DB.prepare("SELECT id,owner_id,status FROM signature_requests WHERE id=? AND status='completed'").bind(requestId).first();
    if(!entry)return json(404,{valid:false});
    const pdf=await getDocument(env.CLINICAL_DB,entry.id,entry.owner_id,3);
    if(!pdf||pdf.sha256!==expectedHash)return json(200,{valid:false});
    try{
      const actual=await readPdf(env,pdf);
      return json(200,{valid:actual.length>0,request_id:entry.id,sha256:pdf.sha256,seal_type:'platform_hmac_not_icp_brasil'});
    }catch{return json(200,{valid:false})}
  }
  if(publicPath){
    if(env.SIGNATURE_PUBLIC_FLOW_READY!=='true')return json(503,{error:'signature_public_flow_disabled'});
    if(publicPath[1]==='sign'&&request.method==='POST'){
      const entry=await lookupToken(env,request);
      if(!entry)return json(410,{error:'signature_link_invalid_or_expired'});
      if(Number(request.headers.get('content-length')||0)>230000)return json(413,{error:'signature_payload_too_large'});
      const input=await request.json().catch(()=>null);
      return confirmSignature(env,entry,'mother',input);
    }
    if(request.method!=='GET' || publicPath[1]==='sign')return json(405,{error:'method_not_allowed'});
    return viewPublic(request,env,publicPath[1]||'info');
  }
  const user=await (deps.authenticate||authenticateClinicalRequest)(request,env);
  if(!user?.id)return json(401,{error:'cloudflare_auth_required'});
  const entry=await getOwner(env.CLINICAL_DB,professionalPath[1],user.id);
  if(!entry)return json(404,{error:'signature_request_not_found'});
  const operation=professionalPath[2];
  if(operation==='document'){
    if(request.method==='GET'){
      const latest=await getDocument(env.CLINICAL_DB,entry.id,user.id);
      if(!latest)return json(404,{error:'signature_document_unavailable'});
      try{return pdfResponse(await readPdf(env,latest),'documento-assinatura')}catch{return json(503,{error:'signature_document_unavailable'})}
    }
    if(request.method!=='POST')return json(405,{error:'method_not_allowed'});
    try{return await freeze(request,env,entry)}catch{return json(503,{error:'signature_storage_unavailable'})}
  }
  if(request.method!=='POST')return json(405,{error:'method_not_allowed'});
  if(entry.status!=='mother_signed')return json(409,{error:'signature_mother_must_sign_first'});
  if(Number(request.headers.get('content-length')||0)>230000)return json(413,{error:'signature_payload_too_large'});
  const body=await request.json().catch(()=>null);
  return confirmSignature(env,entry,'consultant',{...body,expectedName:user.user_metadata?.full_name||user.name||user.email,actorEmail:user.email});
}
