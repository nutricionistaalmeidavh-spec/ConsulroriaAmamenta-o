const CONFIG=globalThis.DEBORA_APP_CONFIG||{};
const SUPABASE_URL=String(CONFIG.SUPABASE_URL||'').replace(/\/$/,'');
const SUPABASE_KEY=String(CONFIG.SUPABASE_PUBLISHABLE_KEY||'');

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

async function rest(path,{method='GET',body=null,headers={}}={}){
  if(!SUPABASE_URL||!SUPABASE_KEY)throw new Error('Configuração do banco indisponível.');
  const token=accessToken(); if(!token)throw new Error('Sessão não encontrada.');
  const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:body==null?undefined:JSON.stringify(body)});
  if(!response.ok){let msg=`Erro ${response.status}`;try{const j=await response.json();msg=j.message||j.error_description||j.error||msg}catch{}throw new Error(msg)}
  if(response.status===204)return null;
  const text=await response.text(); return text?JSON.parse(text):null;
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
  version:'0.2.0', rest, accessToken, userId, currentMotherId, currentBabyId, patientContext, consents, listDocuments, saveDocument, toast, escapeHTML
};
