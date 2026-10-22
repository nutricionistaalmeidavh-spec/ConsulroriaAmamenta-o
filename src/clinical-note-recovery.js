// Runtime-only enhancement: the materialized clinical source and its D1 contract stay canonical.
// Encrypted drafts use a nonextractable per-account browser key and 14-day TTL.
// This mitigates disk exposure but does not protect against XSS or shared-device access.
const RECOVERY_PATCHES=[
  [
    "function cnDraftRead(){return null}\nfunction cnDraftWrite(id,body){return{id,body:String(body??'')}}\nfunction cnDraftRemove(){return null}",
    "const cnDraftDatabaseName='gestao-amamentacao-drafts-v1';\nlet cnDraftDatabase=null,cnDraftChain=Promise.resolve(),cnRetryTimer=null,cnRetryDelay=1500;\nfunction cnDraftScope(id){const owner=String(cnJwt().sub||'');if(!owner||!id)throw new Error('Identidade profissional necessária para recuperar o rascunho.');return owner+':'+id}\nfunction cnDraftOpen(){if(!cnDraftDatabase)cnDraftDatabase=new Promise((resolve,reject)=>{if(!window.indexedDB||!window.crypto?.subtle){reject(new Error('Armazenamento criptografado indisponível.'));return}const request=indexedDB.open(cnDraftDatabaseName,1);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('keys'))db.createObjectStore('keys',{keyPath:'owner'});if(!db.objectStoreNames.contains('drafts'))db.createObjectStore('drafts',{keyPath:'scope'})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('Falha no armazenamento local'));request.onblocked=()=>reject(new Error('Armazenamento local bloqueado'))}).catch(error=>{cnDraftDatabase=null;throw error});return cnDraftDatabase}\nfunction cnDraftTransaction(db,store,method,arg){return new Promise((resolve,reject)=>{const tx=db.transaction(store,method==='get'?'readonly':'readwrite'),request=tx.objectStore(store)[method](arg);let result;request.onsuccess=()=>{result=request.result};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||new Error('Erro ao gravar rascunho'));tx.onabort=()=>reject(tx.error||new Error('Armazenamento interrompido'))})}\nasync function cnDraftKey(db,owner,create=false){let entry=await cnDraftTransaction(db,'keys','get',owner);if(!entry&&create){const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);entry={owner,key};await cnDraftTransaction(db,'keys','put',entry)}return entry?.key||null}\nasync function cnDraftDecrypt(db,owner,scope,row){const key=await cnDraftKey(db,owner);if(!key)throw new Error('Chave de recuperação local indisponível.');const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(row.iv),additionalData:new TextEncoder().encode(scope)},key,new Uint8Array(row.data));return new TextDecoder().decode(plain)}\nasync function cnDraftRead(id){await cnDraftChain.catch(()=>null);const scope=cnDraftScope(id),owner=scope.split(':')[0],db=await cnDraftOpen(),row=await cnDraftTransaction(db,'drafts','get',scope);if(!row)return null;if(Date.now()-Number(row.savedAt||0)>14*86400000){await cnDraftTransaction(db,'drafts','delete',scope);return null}return{id,body:await cnDraftDecrypt(db,owner,scope,row),savedAt:row.savedAt}}\nasync function cnDraftWrite(id,body){const scope=cnDraftScope(id),owner=scope.split(':')[0],text=String(body??'');cnDraftChain=cnDraftChain.catch(()=>null).then(async()=>{const db=await cnDraftOpen(),key=await cnDraftKey(db,owner,true),iv=crypto.getRandomValues(new Uint8Array(12)),aad=new TextEncoder().encode(scope),encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,new TextEncoder().encode(text));await cnDraftTransaction(db,'drafts','put',{scope,iv:Array.from(iv),data:Array.from(new Uint8Array(encrypted)),savedAt:Date.now()})});return cnDraftChain}\nasync function cnDraftRemove(id,expectedBody){const scope=cnDraftScope(id),owner=scope.split(':')[0];cnDraftChain=cnDraftChain.catch(()=>null).then(async()=>{const db=await cnDraftOpen(),row=await cnDraftTransaction(db,'drafts','get',scope);if(!row)return;if(expectedBody!==undefined){const body=await cnDraftDecrypt(db,owner,scope,row);if(expectedBody!==undefined&&body!==String(expectedBody))return}await cnDraftTransaction(db,'drafts','delete',scope)});return cnDraftChain}\nfunction cnScheduleRetry(error){clearTimeout(cnRetryTimer);if(error?.status===409||/prontuário foi alterado em outra sessão|recarregue o prontuário antes de salvar|stale_record_version|record_version_required/i.test(String(error?.message||''))){cnStatus('Conflito de versão: revise o registro antes de tentar novamente.','error');return}if(error?.status&&error.status<500&&error.status!==429)return;const delay=cnRetryDelay;cnRetryDelay=Math.min(cnRetryDelay*2,30000);cnRetryTimer=setTimeout(()=>{if(cnState.pendingBody)cnDrainSaves().catch(()=>{})},delay)}\nfunction cnWireDraftRecovery(draft,serverBody){const banner=document.querySelector('#cn-recovery-banner');if(!banner){if(draft?.body===serverBody)cnDraftRemove(cnState.encounter?.id,serverBody).catch(()=>{});return}const ta=document.querySelector('#cn-note');banner.querySelector('[data-cn-restore]').onclick=()=>{ta.readOnly=false;ta.value=draft.body;banner.remove();cnScheduleSave(ta.value);cnStatus('Rascunho recuperado; aguardando sincronização','muted')};banner.querySelector('[data-cn-discard]').onclick=async()=>{try{await cnDraftRemove(cnState.encounter.id);ta.readOnly=false;banner.remove();cnStatus('Texto do banco mantido','saved')}catch{cnStatus('Não foi possível descartar a cópia local','error')}}}"
  ],
  [
    "cnState.persistedRevision=Math.max(cnState.persistedRevision,Number(item?.revision||0));",
    "cnState.persistedRevision=Math.max(cnState.persistedRevision,Number(item?.revision||0));cnRetryDelay=1500;clearTimeout(cnRetryTimer);await cnDraftRemove(enc.id,text).catch(()=>{});",
    true
  ],
  [
    "cnDraftWrite(enc.id,text);const pendingText=",
    "cnDraftWrite(enc.id,text).catch(()=>cnStatus('Cópia local indisponível; não feche esta tela','error'));const pendingText="
  ],
  [
    "cnDraftWrite(cnState.encounter?.id,text);cnState.editRevision",
    "cnDraftWrite(cnState.encounter?.id,text).catch(()=>cnStatus('Cópia local indisponível; não feche esta tela','error'));cnState.editRevision"
  ],
  [
    "if(!cnState.pendingBody||cnState.pendingBody.revision<=item.revision)cnState.pendingBody=item;throw error",
    "if(!cnState.pendingBody||cnState.pendingBody.revision<=item.revision)cnState.pendingBody=item;cnScheduleRetry(error);throw error"
  ],
  [
    "const enc=await cnResolveEncounter(id),editable=cnCanEdit(enc),body=cnInitialBody(enc),jwt=cnJwt()",
    "const enc=await cnResolveEncounter(id),editable=cnCanEdit(enc),body=cnInitialBody(enc),draft=await cnDraftRead(enc.id).catch(()=>null),jwt=cnJwt()"
  ],
  [
    "<textarea id=\"cn-note\" ${editable?'':'readonly'}",
    "<textarea id=\"cn-note\" ${editable&&!(draft&&draft.body!==body)?'':'readonly'}"
  ],
  [
    "${cnE(body)}</textarea><div class=\"cn-author\">",
    "${cnE(body)}</textarea>${draft&&draft.body!==body?'<div id=\"cn-recovery-banner\" role=\"status\" style=\"padding:12px;border:1px solid #b49a65;border-radius:10px;margin:10px 0;background:#fff9e8\"><strong>Há um rascunho não sincronizado neste dispositivo.</strong><p>Confira antes de continuar. O texto do banco não foi substituído.</p><button type=\"button\" data-cn-restore>Recuperar rascunho</button> <button type=\"button\" data-cn-discard>Descartar cópia local</button></div>':''}<div class=\"cn-author\">"
  ],
  [
    "cnWireOverlay();requestAnimationFrame(",
    "cnWireOverlay();cnWireDraftRecovery(draft,body);requestAnimationFrame("
  ],
  [
    "window.addEventListener('hashchange',cnMount);",
    "window.addEventListener('hashchange',cnMount);window.addEventListener('online',()=>{cnRetryDelay=1500;if(cnState.pendingBody)cnDrainSaves().catch(()=>{})});"
  ]
];
export function enhanceClinicalNoteWithRecovery(source) {
  if (typeof source !== 'string') throw new TypeError('Clinical note source must be text');
  if (source.includes('const cnDraftDatabaseName=')) return source;
  let output = source;
  for (const [before, after, replaceAll] of RECOVERY_PATCHES) {
    const index = output.indexOf(before);
    if (index < 0) throw new Error('Clinical recovery anchor missing: '+before.slice(0,90));
    if (replaceAll) { output = output.split(before).join(after); continue; }
    if (output.indexOf(before, index + before.length) !== -1) throw new Error('Clinical recovery anchor ambiguous: '+before.slice(0,90));
    output = output.slice(0,index)+after+output.slice(index+before.length);
  }
  return output;
}
