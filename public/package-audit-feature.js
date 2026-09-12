import {createSingleFlight} from './runtime-guards.js';

const PA_CONFIG=globalThis.DEBORA_APP_CONFIG||{};
const PA_URL=PA_CONFIG.SUPABASE_URL||'https://zxowxdfhtksevhnjmeyu.supabase.co';
const PA_KEY=PA_CONFIG.SUPABASE_PUBLISHABLE_KEY||'';
const paFlight=createSingleFlight();
let paTimer=null;

function paWalk(v){if(!v)return null;if(typeof v==='string'){try{return paWalk(JSON.parse(v))}catch{return v.split('.').length===3?v:null}}if(Array.isArray(v)){for(const x of v){const t=paWalk(x);if(t)return t}}if(typeof v==='object'){if(v.access_token)return v.access_token;if(v.session?.access_token)return v.session.access_token;for(const x of Object.values(v)){const t=paWalk(x);if(t)return t}}return null}
function paToken(){const runtime=window.__deboraAccessToken||sessionStorage.getItem('debora-runtime-access-token');if(runtime?.split('.').length===3)return runtime;for(const st of [localStorage,sessionStorage])for(let i=0;i<st.length;i++){const t=paWalk(st.getItem(st.key(i)));if(t?.split('.').length===3)return t}return null}
async function paRest(path){const token=paToken();if(!token)throw new Error('Sessão não encontrada.');const response=await fetch(PA_URL+'/rest/v1/'+path,{headers:{apikey:PA_KEY,Authorization:'Bearer '+token}});if(!response.ok)throw new Error('Não foi possível carregar o histórico do pacote.');const text=await response.text();return text?JSON.parse(text):[]}
function paPatientMotherId(){const match=String(location.hash||'').match(/^#\/patient\/([^/]+)/);return match?decodeURIComponent(match[1]):''}
function paEsc(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
function paDate(value){if(!value)return 'Data não informada';const date=new Date(value);return Number.isNaN(date.getTime())?'Data não informada':date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}

function paDecorateProcedures(card){
  const head=card.querySelector('.bv-plan-items-head');
  const title=head?.querySelector('strong');
  if(title)title.textContent='Procedimentos e serviços adicionais';
  if(head&&!head.querySelector('[data-pa-procedure-note]')){
    const note=document.createElement('small');note.dataset.paProcedureNote='1';note.textContent='Contagem separada das consultas do pacote.';head.insertBefore(note,head.querySelector('button')||null);
  }
  const add=card.querySelector('[data-bv-add-item]');if(add)add.textContent='+ Adicionar procedimento/serviço';
  card.querySelectorAll('[data-bv-use-item]').forEach(button=>button.textContent='Registrar procedimento');
}

function paDecorateDialog(){
  const dialog=document.querySelector('[data-bv-plan-dialog]');if(!dialog)return;
  const title=dialog.querySelector('h2');if(title)title.textContent='Adicionar procedimento/serviço';
  const label=dialog.querySelector('[data-bv-item-label]')?.closest('label')?.querySelector('span');if(label)label.textContent='Procedimento/serviço';
}

function paRenderAudit(card,rows){
  card.querySelector('[data-pa-session-audit]')?.remove();
  const section=document.createElement('section');section.dataset.paSessionAudit='1';section.className='pa-session-audit';
  const list=(rows||[]).map(row=>{
    const manual=row.source==='manual';
    const origin=manual?'Baixa manual':'Atendimento vinculado';
    const link=manual?'Registrado manualmente no Financeiro':row.appointment_id?'Vinculado ao atendimento':'Vinculado ao prontuário';
    const notes=String(row.notes||'').trim();
    return '<div class="pa-session-row"><div><strong>'+origin+'</strong><span>'+paEsc(paDate(row.consumed_at))+' · '+paEsc(link)+'</span>'+(notes?'<small>'+paEsc(notes)+'</small>':'')+'</div><span class="pill '+(manual?'waiting':'completed')+'">'+(manual?'Manual':'Automático')+'</span></div>';
  }).join('');
  section.innerHTML='<div class="pa-session-head"><div><strong>Histórico de consultas</strong><small>Auditoria das consultas consumidas neste pacote.</small></div><span>'+rows.length+' registro'+(rows.length===1?'':'s')+'</span></div>'+(list||'<div class="pa-session-empty">Nenhuma consulta consumida neste pacote.</div>');
  const procedures=card.querySelector('.bv-plan-items-head');
  if(procedures)procedures.before(section);else card.appendChild(section);
}

async function paMount(force=false){
  const motherId=paPatientMotherId(),card=document.querySelector('[data-bv-plan-id]');
  paDecorateDialog();
  if(!motherId||!card)return;
  paDecorateProcedures(card);
  const packageId=card.dataset.bvPlanId;if(!packageId)return;
  if(!force&&card.dataset.paAuditLoaded==='1')return;
  return paFlight(motherId+'|'+packageId,async()=>{
    const rows=await paRest('care_package_sessions?package_id=eq.'+encodeURIComponent(packageId)+'&select=id,source,consumed_at,appointment_id,encounter_id,notes&order=consumed_at.desc');
    const current=document.querySelector('[data-bv-plan-id]');
    if(!card.isConnected||current!==card||paPatientMotherId()!==motherId||current?.dataset.bvPlanId!==packageId)return;
    paRenderAudit(card,rows||[]);card.dataset.paAuditLoaded='1';
  }).catch(error=>{if(!/Sessão não encontrada/.test(error.message||''))console.warn('Package audit',error)});
}

function paSchedule(force=false){clearTimeout(paTimer);paTimer=setTimeout(()=>paMount(force),120)}
new MutationObserver(()=>paSchedule(false)).observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('hashchange',()=>paSchedule(false));
window.addEventListener('focus',()=>paSchedule(true));
setTimeout(()=>paSchedule(false),250);
