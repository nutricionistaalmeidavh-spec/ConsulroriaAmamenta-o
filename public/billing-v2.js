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
function bvUuid(){if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16)})}
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
      (packages.length?'<option value="package_active">Usar plano ativo</option>':'<option value="package_new">Novo plano / pacote</option>')+
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
  const result=await bvRpc('finalize_encounter_billing',{p_appointment_id:appointmentId,p_encounter_id:encounterId});
  bvClearDraft();
  if(result?.billing_mode==='package_active'||result?.billing_mode==='package_new'){
    const left=Number(result.sessions_remaining??0);
    bvToast(left?'Plano atualizado: '+left+' sessão'+(left===1?'':'ões')+' restante'+(left===1?'':'s')+'.':'Plano concluído: todas as sessões foram utilizadas.','success');
  }
  return result||{handled:true};
}
function bvPatientMotherId(){const m=String(location.hash||'').match(/^#\/patient\/([^/]+)/);return m?decodeURIComponent(m[1]):''}
async function bvPatientPackage(mid){
  if(!mid)return null;
  const packages=await bvRest('care_packages?mother_id=eq.'+encodeURIComponent(mid)+'&status=neq.cancelled&select=id,service_label,total_cents,sessions_total,sessions_used,status,payment_method,financial_entry_id,created_at&order=created_at.desc&limit=1');
  const pkg=packages?.[0];if(!pkg)return null;
  const [items,financial]=await Promise.all([
    bvRest('care_package_items?package_id=eq.'+encodeURIComponent(pkg.id)+'&status=neq.cancelled&select=id,label,category,quantity_total,quantity_used,pricing_mode,amount_cents,notes,status,created_at&order=created_at.asc'),
    bvRest('financial_entries?package_id=eq.'+encodeURIComponent(pkg.id)+'&status=neq.Cancelado&select=id,amount_cents,status,paid_at,description,package_item_id,created_at&order=created_at.asc')
  ]);
  return{pkg,items:items||[],financial:financial||[]};
}
function bvPlanStatus(bundle){
  const pending=bundle.financial.filter(x=>x.status==='Pendente').reduce((n,x)=>n+Number(x.amount_cents||0),0);
  const paid=bundle.financial.filter(x=>x.status==='Pago').reduce((n,x)=>n+Number(x.amount_cents||0),0);
  return pending>0?{label:'Pendente',tone:'waiting',meta:bvMoney(pending)+' a receber'}:paid>0?{label:'Pago',tone:'completed',meta:bvMoney(paid)+' recebido'}:{label:'Sem cobrança',tone:'',meta:''};
}
function bvPlanMarkup(bundle){
  if(!bundle)return '<article class="detail-card bv-plan-card"><div class="section-heading"><div><span class="section-kicker">PLANO / PACOTE</span><h2>Nenhum plano cadastrado</h2></div></div><p class="bv-plan-empty">Crie o plano a partir de um atendimento para controlar sessões e serviços.</p></article>';
  const {pkg,items}=bundle,used=Number(pkg.sessions_used||0),total=Number(pkg.sessions_total||0),left=Math.max(0,total-used),pct=total?Math.min(100,Math.round(used/total*100)):0,pay=bvPlanStatus(bundle);
  const itemRows=items.length?items.map(item=>{
    const remain=Math.max(0,Number(item.quantity_total||0)-Number(item.quantity_used||0));
    const price=item.pricing_mode==='additional'&&Number(item.amount_cents||0)>0?'Adicional · '+bvMoney(item.amount_cents):'Incluído no plano';
    return '<div class="bv-plan-item"><div><strong>'+String(item.label||'Serviço')+'</strong><span>'+Number(item.quantity_used||0)+' de '+Number(item.quantity_total||0)+' utilizados · '+price+'</span></div>'+(remain>0?'<button type="button" class="ui-button" data-bv-use-item="'+item.id+'">Registrar uso</button>':'<span class="pill completed">Concluído</span>')+'</div>';
  }).join(''):'<div class="bv-plan-no-items">Nenhum serviço adicional incluído ainda.</div>';
  return '<article class="detail-card bv-plan-card" data-bv-plan-id="'+pkg.id+'">'+
    '<div class="section-heading"><div><span class="section-kicker">PLANO / PACOTE</span><h2>'+String(pkg.service_label||'Plano de acompanhamento')+'</h2></div><span class="pill '+pay.tone+'">'+pay.label+'</span></div>'+
    '<div class="bv-plan-metrics"><div><small>Valor do plano</small><strong>'+bvMoney(pkg.total_cents)+'</strong></div><div><small>Consultas</small><strong>'+used+' / '+total+'</strong><span>'+left+' restante'+(left===1?'':'s')+'</span></div></div>'+
    '<div class="bv-plan-progress" aria-label="'+pct+'% das consultas utilizadas"><i style="width:'+pct+'%"></i></div>'+
    '<small class="bv-plan-payment">'+pay.meta+'</small>'+
    '<div class="bv-plan-items-head"><strong>Serviços incluídos depois</strong><button type="button" class="ui-button ui-button-primary" data-bv-add-item="'+pkg.id+'">+ Adicionar serviço</button></div>'+
    '<div class="bv-plan-items">'+itemRows+'</div>'+
  '</article>';
}
async function bvMountPatientPlan(force=false){
  const mid=bvPatientMotherId(),screen=document.querySelector('[data-screen="patient"]');if(!mid||!screen)return;
  let host=document.querySelector('[data-bv-patient-plan]');
  if(!force&&host?.dataset.motherId===mid)return;
  const bundle=await bvPatientPackage(mid);
  if(!host){host=document.createElement('div');host.dataset.bvPatientPlan='';const anchor=screen.querySelector('.baby-selector-wrap');anchor?.insertAdjacentElement('afterend',host)}
  if(!host)return;
  host.dataset.motherId=mid;host.innerHTML=bvPlanMarkup(bundle);
}
function bvClosePlanDialog(){document.querySelector('[data-bv-plan-dialog]')?.remove()}
function bvOpenPlanDialog(packageId){
  bvClosePlanDialog();
  const wrap=document.createElement('div');wrap.dataset.bvPlanDialog='';wrap.className='bv-plan-dialog-backdrop';
  wrap.innerHTML='<form class="bv-plan-dialog" data-bv-plan-form><div class="bv-plan-dialog-head"><div><span class="section-kicker">PLANO / PACOTE</span><h2>Adicionar serviço</h2></div><button type="button" class="ui-button ui-button-ghost" data-bv-close-dialog aria-label="Fechar">×</button></div>'+
    '<label class="field"><span>Serviço</span><input required data-bv-item-label placeholder="Auriculoterapia, laser, taping..."></label>'+
    '<div class="bv-grid two"><label class="field"><span>Quantidade</span><input required data-bv-item-qty type="number" min="1" step="1" value="1"></label><label class="field"><span>Cobrança</span><select data-bv-item-pricing><option value="included">Incluído no valor atual</option><option value="additional">Adicionar valor ao plano</option></select></label></div>'+
    '<label class="field" data-bv-item-amount-wrap hidden><span>Valor adicional</span><div class="unit-input"><b>R$</b><input data-bv-item-amount type="number" min="0" step="0.01" inputmode="decimal"></div></label>'+
    '<label class="field"><span>Observação</span><textarea data-bv-item-notes rows="2" placeholder="Opcional"></textarea></label>'+
    '<div class="bv-plan-dialog-actions"><button type="button" class="ui-button" data-bv-close-dialog>Cancelar</button><button type="submit" class="ui-button ui-button-primary">Adicionar ao plano</button></div>';
  wrap.dataset.packageId=packageId;document.body.appendChild(wrap);
  wrap.querySelector('[data-bv-item-pricing]')?.addEventListener('change',e=>wrap.querySelector('[data-bv-item-amount-wrap]')?.toggleAttribute('hidden',e.target.value!=='additional'));
  wrap.querySelector('[data-bv-item-label]')?.focus();
}
async function bvSubmitPlanItem(form){
  const wrap=form.closest('[data-bv-plan-dialog]'),packageId=wrap?.dataset.packageId;if(!packageId)return;
  if(form.dataset.bvBusy==='1')return;
  const label=form.querySelector('[data-bv-item-label]')?.value?.trim(),qty=Math.max(1,Math.floor(Number(form.querySelector('[data-bv-item-qty]')?.value||1))),pricing=form.querySelector('[data-bv-item-pricing]')?.value||'included',amount=pricing==='additional'?bvCents(form.querySelector('[data-bv-item-amount]')?.value||0):0,notes=form.querySelector('[data-bv-item-notes]')?.value?.trim()||'';
  if(!label)throw new Error('Informe o serviço.');
  if(pricing==='additional'&&amount<=0)throw new Error('Informe o valor adicional.');
  const requestKey=form.dataset.bvRequestKey||(form.dataset.bvRequestKey=bvUuid()),submit=form.querySelector('[type="submit"]');
  form.dataset.bvBusy='1';if(submit)submit.disabled=true;
  try{
    await bvRpc('add_care_package_item_v2',{p_package_id:packageId,p_label:label,p_quantity:qty,p_category:'service',p_pricing_mode:pricing,p_amount_cents:amount,p_notes:notes,p_request_key:requestKey});
    bvClosePlanDialog();await bvMountPatientPlan(true);bvToast('Serviço adicionado ao plano.','success');
  }catch(error){form.dataset.bvBusy='';if(submit)submit.disabled=false;throw error}
}
async function bvUsePlanItem(itemId,button){
  if(button?.disabled)return;
  if(!window.confirm('Registrar uma utilização deste serviço no plano?'))return;
  const requestKey=button?.dataset.bvRequestKey||(button?button.dataset.bvRequestKey=bvUuid():bvUuid());
  if(button)button.disabled=true;
  try{
    await bvRpc('consume_care_package_item_v2',{p_item_id:itemId,p_appointment_id:null,p_encounter_id:null,p_notes:'',p_request_key:requestKey});
    await bvMountPatientPlan(true);bvToast('Uso registrado no plano.','success');
  }catch(error){if(button)button.disabled=false;throw error}
}
function bvSchedule(){clearTimeout(bvTimer);bvTimer=setTimeout(()=>{bvMount().catch(e=>console.warn('Billing v2 mount',e));bvMountPatientPlan().catch(e=>console.warn('Plan mount',e))},120)}
try{sessionStorage.removeItem('debora-billing-draft-v4')}catch{}
window.DeboraBilling={beforeStart:bvBeforeStart,bindAppointment:bvBindAppointment,finalize:bvFinalize,getSelection:bvSelection,remount:()=>bvMount(true),remountPlan:()=>bvMountPatientPlan(true)};
new MutationObserver(bvSchedule).observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('hashchange',bvSchedule);
window.addEventListener('focus',bvSchedule);
document.addEventListener('change',e=>{if(e.target.matches('[data-appointment-patient]'))setTimeout(()=>bvMount(true).catch(()=>{}),0)});
document.addEventListener('click',e=>{const add=e.target.closest('[data-bv-add-item]'),use=e.target.closest('[data-bv-use-item]'),close=e.target.closest('[data-bv-close-dialog]');if(add){e.preventDefault();bvOpenPlanDialog(add.dataset.bvAddItem)}else if(use){e.preventDefault();bvUsePlanItem(use.dataset.bvUseItem,use).catch(err=>bvToast(err.message||String(err),'error'))}else if(close){e.preventDefault();bvClosePlanDialog()}});
document.addEventListener('submit',e=>{if(e.target.matches('[data-bv-plan-form]')){e.preventDefault();bvSubmitPlanItem(e.target).catch(err=>bvToast(err.message||String(err),'error'))}});
bvSchedule();
