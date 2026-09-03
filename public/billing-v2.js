const BV_CONFIG=globalThis.DEBORA_APP_CONFIG||{};
const BV_URL=BV_CONFIG.SUPABASE_URL||'https://zxowxdfhtksevhnjmeyu.supabase.co';
const BV_KEY=BV_CONFIG.SUPABASE_PUBLISHABLE_KEY||'';
const BV_DRAFT='debora-billing-v2-draft';
let bvBusy=false,bvTimer=null,bvLoadedAppointment=null,bvLoadedMother=null;

function bvWalk(v){if(!v)return null;if(typeof v==='string'){try{return bvWalk(JSON.parse(v))}catch{return v.split('.').length===3?v:null}}if(Array.isArray(v)){for(const x of v){const t=bvWalk(x);if(t)return t}}if(typeof v==='object'){if(v.access_token)return v.access_token;if(v.session?.access_token)return v.session.access_token;for(const x of Object.values(v)){const t=bvWalk(x);if(t)return t}}return null}
function bvToken(){const runtime=window.__deboraAccessToken||sessionStorage.getItem('debora-runtime-access-token');if(runtime?.split('.').length===3)return runtime;for(const st of [localStorage,sessionStorage])for(let i=0;i<st.length;i++){const t=bvWalk(st.getItem(st.key(i)));if(t?.split('.').length===3)return t}return null}
async function bvRest(path,opt={}){const token=bvToken();if(!token)throw new Error('Sessão não encontrada.');const r=await fetch(BV_URL+'/rest/v1/'+path,{...opt,headers:{apikey:BV_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json',...(opt.headers||{})}});if(!r.ok){let m='Erro '+r.status;try{const j=await r.json();m=j.message||j.error_description||j.error||m}catch{}throw new Error(m)}if(r.status===204)return null;const t=await r.text();return t?JSON.parse(t):null}
async function bvRpc(name,body){return bvRest('rpc/'+name,{method:'POST',body:JSON.stringify(body)})}
function bvToast(msg,tone='info'){if(window.DeboraUI?.toast)return window.DeboraUI.toast(msg,{tone});console.info(msg)}
function bvMoney(cents){return (Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
function bvAppointmentId(){return window.DeboraEncounter?.getAppointmentId?.()||''}
function bvMotherId(){return document.querySelector('[data-appointment-patient]')?.value||''}
function bvValueInput(){return document.querySelector('[data-encounter-field="value"]')}
function bvAppointmentType(){return document.querySelector('[data-encounter-choice][data-field="appointmentType"][aria-pressed="true"]')?.dataset.value||'Atendimento'}
function bvReadDraft(){try{return JSON.parse(sessionStorage.getItem(BV_DRAFT)||'null')}catch{return null}}
function bvWriteDraft(v){try{sessionStorage.setItem(BV_DRAFT,JSON.stringify(v))}catch{}}
function bvClearDraft(){try{sessionStorage.removeItem(BV_DRAFT);sessionStorage.removeItem('debora-billing-draft-v4')}catch{}}
function bvCents(v){const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?Math.max(0,Math.round(n*100)):0}
function bvAppointmentScreen(){return document.querySelector('[data-screen="appointment"]')}
function bvMode(){return document.querySelector('[data-bv-mode]')?.value||'individual'}
function bvService(){return document.querySelector('[data-bv-service]')?.value?.trim()||bvAppointmentType()}
function bvPayment(){return document.querySelector('[data-bv-payment]')?.value||''}
function bvPackageSelect(){return document.querySelector('[data-bv-package]')?.value||''}
function bvSessions(){return Math.max(0,Math.floor(Number(document.querySelector('[data-bv-sessions]')?.value||0)))}
function bvPackageTotalCents(){return bvCents(document.querySelector('[data-bv-total]')?.value||0)}
function bvSelection(){
  const mode=bvMode(),input=bvValueInput();
  return {
    mode,
    serviceLabel:bvService(),
    paymentMethod:bvPayment(),
    valueCents:bvCents(input?.value||0),
    packageId:mode==='package_active'?(bvPackageSelect()||null):null,
    packageTotalCents:mode==='package_new'?bvPackageTotalCents():null,
    packageSessionsTotal:mode==='package_new'?bvSessions():null
  };
}
function bvValidate(s){
  if(s.mode==='package_new'&&(!(s.packageTotalCents>0)||!(s.packageSessionsTotal>0)))throw new Error('Informe o valor total e a quantidade de sessões do plano.');
  if(s.mode==='package_active'&&!s.packageId)throw new Error('Selecione um plano ativo.');
  return s;
}
function bvSyncValue(){
  const mode=bvMode(),input=bvValueInput(),field=input?.closest('label');
  if(!input)return;
  if(mode==='package_active'){input.value='0';input.readOnly=true}
  else if(mode==='package_new'){input.value=String((bvPackageTotalCents()/100).toFixed(2));input.readOnly=true}
  else input.readOnly=false;
  field?.classList.toggle('bv-value-linked',mode!=='individual');
  const span=field?.querySelector(':scope > span');
  if(span)span.textContent=mode==='individual'?'Valor do atendimento':mode==='package_new'?'Valor total do plano':'Valor deste atendimento';
  input.dispatchEvent(new Event('input',{bubbles:true}));
}
function bvToggle(){
  const mode=bvMode();
  document.querySelector('[data-bv-new]')?.toggleAttribute('hidden',mode!=='package_new');
  document.querySelector('[data-bv-active]')?.toggleAttribute('hidden',mode!=='package_active');
  bvSyncValue();
  const draft={motherId:bvMotherId(),appointmentId:bvAppointmentId()||null,...bvSelection(),at:Date.now()};
  bvWriteDraft(draft);
}
async function bvAppointmentRow(id){
  if(!id)return null;
  const rows=await bvRest('appointments?id=eq.'+encodeURIComponent(id)+'&select=id,mother_id,billing_mode,service_label,payment_method,value_cents,package_id,package_total_cents,package_sessions_total&limit=1');
  return rows?.[0]||null;
}
async function bvPackages(mid){
  if(!mid)return[];
  return await bvRest('care_packages?mother_id=eq.'+encodeURIComponent(mid)+'&status=eq.active&select=id,service_label,total_cents,sessions_total,sessions_used,status,payment_method,created_at&order=created_at.desc');
}
function bvInitial(mid,row,packages){
  const draft=bvReadDraft();
  if(row)return{
    mode:row.billing_mode||'individual',
    serviceLabel:row.service_label||bvAppointmentType(),
    paymentMethod:row.payment_method||'',
    valueCents:Number(row.value_cents||0),
    packageId:row.package_id||null,
    packageTotalCents:row.package_total_cents,
    packageSessionsTotal:row.package_sessions_total
  };
  if(draft?.motherId===mid)return draft;
  return{mode:packages.length?'package_active':'individual',serviceLabel:bvAppointmentType(),paymentMethod:'',valueCents:bvCents(bvValueInput()?.value||0),packageId:packages[0]?.id||null,packageTotalCents:null,packageSessionsTotal:null};
}
function bvMarkup(selection,packages){
  const packageOptions=packages.map(p=>'<option value="'+p.id+'">'+String(p.service_label||'Plano')+' · '+(p.sessions_total-p.sessions_used)+' de '+p.sessions_total+' sessões</option>').join('');
  const active=packages.find(p=>p.id===selection.packageId)||packages[0]||null;
  const activeSummary=active?'<div class="bv-package-summary"><strong>'+String(active.service_label||'Plano ativo')+'</strong><span>'+bvMoney(active.total_cents)+' · '+active.sessions_total+' sessões</span><small>'+active.sessions_used+' utilizadas · '+Math.max(0,active.sessions_total-active.sessions_used)+' restantes</small></div>':'<div class="bv-empty">Nenhum plano ativo para esta paciente.</div>';
  return '<div class="bv-head"><div><small>COBRANÇA</small><strong>Atendimento individual ou plano</strong></div><span>Salvo no banco</span></div>'+
  '<div class="bv-grid">'+
    '<label class="field"><span>Tipo de cobrança</span><select data-bv-mode>'+
      '<option value="individual">Atendimento individual</option>'+
      (packages.length?'<option value="package_active">Usar plano ativo</option>':'')+
      '<option value="package_new">Novo plano / pacote</option>'+
    '</select></label>'+
    '<label class="field"><span>Serviço</span><select data-bv-service>'+
      ['Consulta inicial','Retorno','Acompanhamento','Pré-natal'].map(x=>'<option>'+x+'</option>').join('')+
    '</select></label>'+
    '<label class="field"><span>Forma de pagamento</span><select data-bv-payment><option value="">A definir</option><option>Pix</option><option>Dinheiro</option><option>Cartão</option><option>Transferência</option></select></label>'+
  '</div>'+
  '<div class="bv-active" data-bv-active hidden><label class="field"><span>Plano ativo</span><select data-bv-package>'+packageOptions+'</select></label>'+activeSummary+'</div>'+
  '<div class="bv-new" data-bv-new hidden><div class="bv-grid two"><label class="field"><span>Valor total do plano</span><div class="unit-input"><b>R$</b><input data-bv-total type="number" min="0" step="0.01" inputmode="decimal"></div></label><label class="field"><span>Quantidade de sessões</span><input data-bv-sessions type="number" min="1" step="1" inputmode="numeric"></label></div><small class="bv-hint">O plano gera uma única cobrança. Cada atendimento finalizado consome uma sessão sem criar nova cobrança.</small></div>';
}
function bvApply(selection,packages){
  const mode=document.querySelector('[data-bv-mode]');
  if(mode){
    if(selection.mode==='package_active'&&!packages.length)selection.mode='individual';
    mode.value=selection.mode||'individual';
  }
  const service=document.querySelector('[data-bv-service]');
  if(service){
    const wanted=selection.serviceLabel||bvAppointmentType();
    if([...service.options].some(o=>o.value===wanted))service.value=wanted;
    else service.value=bvAppointmentType();
  }
  const payment=document.querySelector('[data-bv-payment]');if(payment)payment.value=selection.paymentMethod||'';
  const psel=document.querySelector('[data-bv-package]');if(psel&&selection.packageId&&[...psel.options].some(o=>o.value===selection.packageId))psel.value=selection.packageId;
  const total=document.querySelector('[data-bv-total]');if(total&&selection.packageTotalCents!=null)total.value=String((Number(selection.packageTotalCents)/100).toFixed(2));
  const sessions=document.querySelector('[data-bv-sessions]');if(sessions&&selection.packageSessionsTotal!=null)sessions.value=String(selection.packageSessionsTotal);
  const value=bvValueInput();if(value&&selection.mode==='individual'&&selection.valueCents!=null)value.value=String((Number(selection.valueCents)/100).toFixed(2));
  bvToggle();
}
function bvWire(){
  const mode=document.querySelector('[data-bv-mode]'),service=document.querySelector('[data-bv-service]'),payment=document.querySelector('[data-bv-payment]'),psel=document.querySelector('[data-bv-package]'),total=document.querySelector('[data-bv-total]'),sessions=document.querySelector('[data-bv-sessions]');
  mode?.addEventListener('change',bvToggle);
  service?.addEventListener('change',bvToggle);
  payment?.addEventListener('change',bvToggle);
  psel?.addEventListener('change',bvToggle);
  total?.addEventListener('input',bvToggle);
  sessions?.addEventListener('input',bvToggle);
}
async function bvMount(force=false){
  if(bvBusy||!bvAppointmentScreen()||!String(location.hash).startsWith('#/appointment'))return;
  const mid=bvMotherId();if(!mid)return;
  const appointmentId=bvAppointmentId();
  const hostExisting=document.querySelector('[data-billing-v2]');
  if(!force&&hostExisting&&hostExisting.dataset.motherId===mid&&hostExisting.dataset.appointmentId===(appointmentId||''))return;
  bvBusy=true;
  try{
    const [row,packages]=await Promise.all([appointmentId?bvAppointmentRow(appointmentId):Promise.resolve(null),bvPackages(mid)]);
    let host=hostExisting;
    if(!host){host=document.createElement('section');host.dataset.billingV2='';host.className='bv-card';const anchor=document.querySelector('[data-wizard-step="1"] .appointment-meta-grid')||document.querySelector('[data-wizard-step="1"]');anchor?.insertAdjacentElement('afterend',host)}
    if(!host)return;
    host.dataset.motherId=mid;host.dataset.appointmentId=appointmentId||'';
    const initial=bvInitial(mid,row,packages);
    host.innerHTML=bvMarkup(initial,packages);
    bvWire();bvApply(initial,packages);
    bvLoadedAppointment=appointmentId||null;bvLoadedMother=mid;
  }finally{bvBusy=false}
}
async function bvBeforeStart(mid){
  await bvMount(true);
  if(mid!==bvMotherId())throw new Error('Paciente da cobrança não corresponde ao atendimento.');
  return bvValidate(bvSelection());
}
async function bvBindAppointment(mid,appointmentId,encounterId,selection=null){
  const s=bvValidate(selection||bvSelection());
  if(!appointmentId)throw new Error('Agendamento não disponível para salvar a cobrança.');
  const row=await bvRpc('set_appointment_billing',{
    p_appointment_id:appointmentId,
    p_billing_mode:s.mode,
    p_service_label:s.serviceLabel,
    p_value_cents:s.valueCents,
    p_payment_method:s.paymentMethod,
    p_package_total_cents:s.packageTotalCents,
    p_package_sessions_total:s.packageSessionsTotal,
    p_package_id:s.packageId
  });
  bvWriteDraft({motherId:mid,appointmentId,...s,at:Date.now()});
  bvLoadedAppointment=appointmentId;bvLoadedMother=mid;
  return row;
}
async function bvFinalize(mid,appointmentId,encounterId){
  const s=bvValidate(bvSelection());
  await bvBindAppointment(mid,appointmentId,encounterId,s);
  const result=await bvRpc('finalize_encounter_billing',{p_appointment_id:appointmentId,p_encounter_id:encounterId});
  bvClearDraft();
  if(result?.billing_mode==='package_active'||result?.billing_mode==='package_new'){
    const left=Number(result.sessions_remaining??0);
    bvToast(left?'Plano atualizado: '+left+' sessão'+(left===1?'':'ões')+' restante'+(left===1?'':'s')+'.':'Plano concluído: todas as sessões foram utilizadas.','success');
  }
  return result||{handled:true};
}
function bvSchedule(){clearTimeout(bvTimer);bvTimer=setTimeout(()=>bvMount().catch(e=>console.warn('Billing v2 mount',e)),120)}
try{sessionStorage.removeItem('debora-billing-draft-v4')}catch{}
window.DeboraBilling={beforeStart:bvBeforeStart,bindAppointment:bvBindAppointment,finalize:bvFinalize,getSelection:bvSelection,remount:()=>bvMount(true)};
new MutationObserver(bvSchedule).observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('hashchange',bvSchedule);
window.addEventListener('focus',bvSchedule);
document.addEventListener('change',e=>{if(e.target.matches('[data-appointment-patient]'))setTimeout(()=>bvMount(true).catch(()=>{}),0)});
bvSchedule();
