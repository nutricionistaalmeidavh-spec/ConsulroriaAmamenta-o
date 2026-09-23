const CONFIG=globalThis.DEBORA_APP_CONFIG||{};
const API_BASE_URL=String(CONFIG.API_BASE_URL||(globalThis.location?.origin || '')).replace(/\/$/,'');
const CLIENT_RUNTIME_KEY=String(CONFIG.CLIENT_RUNTIME_KEY||'cloudflare-runtime');

function tokenWalk(v){
  if(!v)return null;
  if(typeof v==='string'){try{return tokenWalk(JSON.parse(v))}catch{return v.split('.').length===3?v:null}}
  if(Array.isArray(v)){for(const x of v){const t=tokenWalk(x);if(t)return t}}
  if(typeof v==='object'){if(v.access_token)return v.access_token;if(v.session?.access_token)return v.session.access_token;for(const x of Object.values(v)){const t=tokenWalk(x);if(t)return t}}
  return null;
}
function accessToken(){
  const direct=window.__deboraAccessToken||sessionStorage.getItem('debora-runtime-access-token');
  if(direct?.split('.').length===3)return direct;
  for(const store of [localStorage,sessionStorage])for(let i=0;i<store.length;i++){const t=tokenWalk(store.getItem(store.key(i)));if(t?.split('.').length===3)return t}
  return null;
}
function userId(){
  const t=accessToken(); if(!t)return '';
  try{let p=t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');while(p.length%4)p+='=';return JSON.parse(atob(p)).sub||''}catch{return ''}
}
function currentMotherId(hash=location.hash){const m=String(hash).match(/^#\/patient\/(?!form)([0-9a-f-]{36})(?:$|\/)/i);return m?m[1]:''}
function currentBabyId(){return document.querySelector('[data-baby-selector] .baby-tab.active')?.dataset.babyId||''}
function toast(message,tone='info'){if(window.DeboraUI?.toast)return window.DeboraUI.toast(message,{tone:tone==='error'?'danger':tone});console[tone==='error'?'error':'info'](message)}
function escapeHTML(v=''){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function documentsRuntimeClient(){const client=window.DeboraRuntimeClient;if(!client?.rest||!client?.workerRequest||!client?.storageRequest)throw new Error('Cliente de sessão indisponível.');return client}
async function rest(path,{method='GET',body=null,headers={}}={}){
  const [table,...queryParts]=String(path).split('?');
  return documentsRuntimeClient().rest(table,{method,query:queryParts.join('?'),body:body==null?undefined:body,headers});
}
async function storageRequest(path,{method='GET',body=null,contentType='application/json',headers={}}={}){
  return documentsRuntimeClient().storageRequest(path,{method,body:body==null?undefined:body,headers:{...(contentType?{'Content-Type':contentType}:{}),...headers}});
}
function resolveSignedFileUrl(signed){
  const raw=String(signed||'').trim();if(!raw)return'';
  if(/^https?:\/\//i.test(raw))return raw;
  return `${API_BASE_URL}${raw.startsWith('/')?raw:`/${raw}`}`;
}
async function signedClinicalMediaUrl(storagePath,expiresIn=900){
  const row=await storageRequest(`object/sign/clinical-media/${storagePath}`,{method:'POST',body:{expiresIn}});
  const signed=row?.signedURL||row?.signedUrl||row?.signed_url;
  return resolveSignedFileUrl(signed);
}
function clinicalMediaUploadUrl(storagePath){return `/api/clinical/media/upload?path=${encodeURIComponent(storagePath).replace(/%2F/g,'/')}`}
async function uploadClinicalMedia(storagePath,file,onProgress=null,contentType=file?.type||'application/octet-stream',operationKey=''){
  const safeContentType=String(contentType||file?.type||'application/octet-stream').toLowerCase();
  const headers={'Content-Type':safeContentType,...(operationKey?{'x-clinical-media-operation':operationKey}:{})};
  const client=documentsRuntimeClient();
  if(typeof onProgress!=='function'){
    return client.workerRequest(clinicalMediaUploadUrl(storagePath),{method:'POST',headers,body:file,raw:true});
  }
  const send=async(attempt=0)=>new Promise((resolve,reject)=>{
    const token=client.getSession()?.access_token;if(!token){reject(new Error('Sessão não encontrada.'));return}
    const xhr=new XMLHttpRequest();
    xhr.open('POST',clinicalMediaUploadUrl(storagePath));
    xhr.setRequestHeader('Authorization',`Bearer ${token}`);
    xhr.setRequestHeader('Content-Type',safeContentType);
    if(operationKey)xhr.setRequestHeader('x-clinical-media-operation',operationKey);
    xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.max(0,Math.min(100,Math.round(event.loaded/event.total*100))))};
    xhr.onerror=()=>reject(new Error('Falha de rede durante o upload.'));
    xhr.onabort=()=>reject(new Error('Upload cancelado.'));
    xhr.onload=async()=>{
      if(xhr.status>=200&&xhr.status<300){onProgress(100);try{resolve(xhr.responseText?JSON.parse(xhr.responseText):null)}catch{resolve(null)};return}
      if(xhr.status===401&&attempt===0){try{await client.refreshSession();resolve(await send(1));return}catch(error){reject(error);return}}
      let msg=`Erro ${xhr.status}`;try{const j=JSON.parse(xhr.responseText||'{}');msg=j.error==='SAAS_MEDIA_UPLOAD_NOT_ALLOWED'?'Upload de fotos e vídeos está disponível no plano Pro.':j.message||j.error||msg}catch{}reject(new Error(msg));
    };
    onProgress(0);xhr.send(file);
  });
  return send();
}
async function confirmClinicalMedia(operationKey,storagePath,metadata={}){
  if(!operationKey||!storagePath)throw new Error('Operação de mídia inválida.');
  return documentsRuntimeClient().workerRequest('/api/clinical/media/confirm',{method:'POST',body:{operation_key:operationKey,storage_path:storagePath,...metadata}});
}
async function reconcileClinicalMediaUploads(maxAgeSeconds=3600){
  return documentsRuntimeClient().workerRequest('/api/clinical/media/reconcile',{method:'POST',body:{max_age_seconds:maxAgeSeconds}});
}
async function deleteClinicalMedia(storagePath){
  return storageRequest(`object/clinical-media/${storagePath}`,{method:'DELETE',contentType:''});
}
async function patientContext(motherId=currentMotherId()){
  if(!motherId)return null;
  const [mothers,babies]=await Promise.all([
    rest(`mothers?id=eq.${encodeURIComponent(motherId)}&select=*&limit=1`),
    rest(`babies?mother_id=eq.${encodeURIComponent(motherId)}&select=*&order=created_at.asc`)
  ]);
  const mother=mothers?.[0]; if(!mother)return null;
  return {mother,babies:babies||[],activeBabyId:currentBabyId()||null};
}
async function consents(motherId=currentMotherId()){
  if(!motherId)return [];
  return await rest(`consents?mother_id=eq.${encodeURIComponent(motherId)}&select=*&order=consent_type.asc`)||[];
}
async function listDocuments(motherId=currentMotherId(),type=''){
  if(!motherId)return [];
  const filter=type?`&document_type=eq.${encodeURIComponent(type)}`:'';
  return await rest(`clinical_documents?mother_id=eq.${encodeURIComponent(motherId)}${filter}&select=*&order=created_at.desc`)||[];
}
async function saveDocument(payload={}){
  const motherId=payload.mother_id||currentMotherId();
  if(!motherId)throw new Error('Paciente não identificada.');
  const body={...payload,mother_id:motherId};
  const rows=await rest('clinical_documents',{method:'POST',headers:{Prefer:'return=representation'},body});
  return rows?.[0]||null;
}
async function updateDocument(id,payload={}){
  if(!id)throw new Error('Documento não identificado.');
  const rows=await rest(`clinical_documents?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:payload});
  return rows?.[0]||null;
}
async function latestEncounter(motherId=currentMotherId(),babyId=currentBabyId()){
  if(!motherId)return null;
  const rows=await rest(`clinical_encounters?mother_id=eq.${encodeURIComponent(motherId)}&select=id,mother_id,baby_id,appointment_id,status,chief_complaint,care_plan,clinical_note,occurred_at,updated_at&order=occurred_at.desc&limit=30`)||[];
  if(!babyId)return rows[0]||null;
  const direct=rows.find(row=>row.baby_id===babyId); if(direct)return direct;
  const links=await rest(`clinical_encounter_babies?baby_id=eq.${encodeURIComponent(babyId)}&select=encounter_id&order=created_at.desc`)||[];
  const allowed=new Set(links.map(row=>row.encounter_id));
  return rows.find(row=>allowed.has(row.id))||null;
}
function emitContext(){
  const detail={motherId:currentMotherId(),babyId:currentBabyId()||null};
  window.dispatchEvent(new CustomEvent('debora:patient-context',{detail}));
}
let observerTimer=null;
function scheduleContext(){clearTimeout(observerTimer);observerTimer=setTimeout(emitContext,80)}
window.addEventListener('hashchange',scheduleContext);
new MutationObserver(scheduleContext).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','aria-current']});
setTimeout(emitContext,200);

window.DeboraDocuments={
  version:'0.8.0',rest,storageRequest,accessToken,userId,currentMotherId,currentBabyId,patientContext,consents,listDocuments,saveDocument,updateDocument,latestEncounter,signedClinicalMediaUrl,resolveSignedFileUrl,uploadClinicalMedia,confirmClinicalMedia,reconcileClinicalMediaUploads,deleteClinicalMedia,toast,escapeHTML
};