const CCF_SB_URL='https://zxowxdfhtksevhnjmeyu.supabase.co';
const CCF_SB_KEY='sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';
const CCF_MOTHER_SESSION='debora-mother-portal-session-v1';

const clean=value=>String(value??'').trim();
const asList=value=>Array.isArray(value)?value.map(clean).filter(Boolean):(clean(value)?[clean(value)]:[]);
const asObject=value=>{if(!value)return{};if(typeof value==='object'&&!Array.isArray(value))return value;if(typeof value!=='string')return{};try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{}}catch{return{}}};
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const norm=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

export function deriveCareStage(appointmentType=''){
  return norm(appointmentType)==='pre-natal'?'Pré-parto':'Pós-parto';
}

export function feedingChecklistStatus(assessment={}){
  return{
    beforeFeed:Boolean(clean(assessment.beforeFeed)),
    position:Boolean(clean(assessment.position)),
    latch:Boolean(clean(assessment.latch)),
    suckSwallow:asList(assessment.suckSwallow).length>0,
    afterFeed:Boolean(clean(assessment.afterFeed))
  };
}

export function buildCarePlanInstructions(plan={}){
  const blocks=[
    ['Orientações prioritárias',plan.priorityGuidance],
    ['Mamada e posicionamento',plan.feedingPositioning],
    ['Ordenha / complemento',plan.expressionSupplement],
    ['Rotina',plan.routine],
    ['Sinais de alerta',plan.warningSigns]
  ];
  return blocks.filter(([,value])=>clean(value)).map(([label,value])=>`${label}:\n${clean(value)}`).join('\n\n');
}

export function isMotherShareAllowed(item={}){
  const kind=norm(item.kind);
  const title=norm(item.title);
  if(['evaluation','referral','anamnesis'].includes(kind))return false;
  if(/prontuario|anamnese|encaminhamento|avaliacao completa/.test(title))return false;
  if(kind==='care_plan'||kind==='orientation')return true;
  if(kind==='document')return /termo|consentimento/.test(title);
  if(kind==='appointment')return /retorno|proximo acompanhamento|proxima consulta/.test(title);
  return false;
}

function dedupeLines(values=[]){
  const seen=new Set();
  return values.map(clean).filter(value=>{if(!value)return false;const key=norm(value);if(seen.has(key))return false;seen.add(key);return true});
}

export function buildMotherSafeEncounterShare(encounter={}){
  const plan=asObject(encounter.care_plan);
  const structured=buildCarePlanInstructions(plan);
  const sections=[];
  if(clean(plan.objectives))sections.push(`Objetivos\n${clean(plan.objectives)}`);
  for(const value of dedupeLines([structured,plan.instructions]))sections.push(value);
  if(clean(plan.followup))sections.push(`Próximo acompanhamento\n${clean(plan.followup)}`);
  let date='';
  try{date=encounter.occurred_at?new Date(encounter.occurred_at).toLocaleDateString('pt-BR'):''}catch{}
  return{kind:'care_plan',title:`Meu cuidado${date?` · ${date}`:''}`,body:sections.join('\n\n')||'Plano de cuidado ainda sem orientações publicáveis.'};
}

const browser=typeof window!=='undefined'&&typeof document!=='undefined';
if(!browser){}else{
  const state={hydratedEncounter:'',portalFiltering:false,portalVerified:new Set(),portalLoadedKey:'',timer:null};

  function tokenWalk(value){
    if(!value)return null;
    if(typeof value==='string'){try{return tokenWalk(JSON.parse(value))}catch{return value.split('.').length===3?value:null}}
    if(Array.isArray(value)){for(const item of value){const token=tokenWalk(item);if(token)return token}}
    if(typeof value==='object'){
      if(value.access_token)return value.access_token;
      if(value.session?.access_token)return value.session.access_token;
      for(const item of Object.values(value)){const token=tokenWalk(item);if(token)return token}
    }
    return null;
  }
  function professionalToken(){
    const runtime=window.__deboraAccessToken||sessionStorage.getItem('debora-runtime-access-token');
    if(runtime?.split('.').length===3)return runtime;
    for(const store of [localStorage,sessionStorage])for(let index=0;index<store.length;index++){const token=tokenWalk(store.getItem(store.key(index)));if(token?.split('.').length===3)return token}
    return null;
  }
  function motherToken(){try{return JSON.parse(localStorage.getItem(CCF_MOTHER_SESSION)||'null')?.access_token||null}catch{return null}}
  async function rest(path,token){
    if(!token)throw new Error('Sessão não encontrada.');
    const response=await fetch(`${CCF_SB_URL}/rest/v1/${path}`,{headers:{apikey:CCF_SB_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
    if(!response.ok){let message=`Erro ${response.status}`;try{const payload=await response.json();message=payload.message||payload.error||message}catch{}throw new Error(message)}
    const text=await response.text();return text?JSON.parse(text):null;
  }
  function ensureCss(){
    if(document.querySelector('link[data-ccf-style]'))return;
    const link=document.createElement('link');link.rel='stylesheet';link.href='/clinical-care-flow-feature.css';link.dataset.ccfStyle='1';document.head.appendChild(link);
  }
  function toast(message,tone='info'){
    if(window.DeboraUI?.toast)return window.DeboraUI.toast(message,{tone});
    let node=document.querySelector('[data-ccf-toast]');if(!node){node=document.createElement('div');node.dataset.ccfToast='1';node.className='ccf-toast';document.body.appendChild(node)}
    node.textContent=message;node.dataset.tone=tone;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),3000);
  }
  function selectedAppointmentType(){return document.querySelector('[data-encounter-choice][data-section="identification"][data-field="appointmentType"][aria-pressed="true"]')?.dataset.value||''}
  function selectedFormat(){return document.querySelector('[data-encounter-choice][data-section="identification"][data-field="format"][aria-pressed="true"]')?.dataset.value||''}
  function mountContext(){
    const step=document.querySelector('[data-wizard-step="1"]');if(!step||step.querySelector('[data-ccf-context]'))return;
    const host=document.createElement('section');host.className='ccf-inline-card';host.dataset.ccfContext='1';host.innerHTML='<div><small>CONTEXTO DO CUIDADO</small><strong data-ccf-stage-label>—</strong><span data-ccf-context-meta></span></div><input type="hidden" data-encounter-field="careStage" data-section="identification">';step.appendChild(host);updateContext();
  }
  function updateContext(){
    const type=selectedAppointmentType(),stage=deriveCareStage(type),format=selectedFormat();
    const input=document.querySelector('[data-ccf-context] [data-encounter-field="careStage"]');if(input)input.value=stage;
    const label=document.querySelector('[data-ccf-stage-label]');if(label)label.textContent=stage;
    const meta=document.querySelector('[data-ccf-context-meta]');if(meta)meta.textContent=[type,format].filter(Boolean).join(' · ');
    const summary=document.querySelector('[data-ccf-plan-context]');if(summary)summary.textContent=[stage,type,format].filter(Boolean).join(' · ');
  }
  function feedingAssessmentFromCard(card){
    const chosen=field=>card.querySelector(`[data-section="feeding_assessment"][data-field="${field}"][aria-pressed="true"]`)?.dataset.value||'';
    const multi=field=>[...card.querySelectorAll(`[data-section="feeding_assessment"][data-field="${field}"][aria-pressed="true"]`)].map(item=>item.dataset.value||clean(item.textContent));
    return{beforeFeed:card.querySelector('[data-encounter-field="beforeFeed"]')?.value||'',position:chosen('position'),latch:chosen('latch'),suckSwallow:multi('suckSwallow'),afterFeed:card.querySelector('[data-encounter-field="afterFeed"]')?.value||''};
  }
  function checklistMarkup(){return `<div class="ccf-checklist" data-ccf-checklist>${[['beforeFeed','Antes da mamada'],['position','Posicionamento'],['latch','Pega'],['suckSwallow','Sucção e deglutição'],['afterFeed','Após a mamada']].map(([key,label])=>`<span data-ccf-check="${key}"><i></i>${label}</span>`).join('')}</div>`}
  function mountFeedingCards(){
    for(const card of document.querySelectorAll('[data-feeding-assessment-editor] .baby-clinical-card')){
      if(card.dataset.ccfEnhanced)return;const babyId=card.querySelector('[data-baby-id]')?.dataset.babyId||'';if(!babyId)continue;card.dataset.ccfEnhanced='1';
      const title=card.querySelector('.baby-clinical-title');
      const before=document.createElement('label');before.className='field ccf-observation-field';before.innerHTML=`<span>Antes da mamada</span><textarea rows="2" data-encounter-field="beforeFeed" data-section="feeding_assessment" data-baby-id="${esc(babyId)}" placeholder="Estado do bebê, sinais de fome, conforto materno e contexto observado."></textarea>`;title?.after(before);
      const notes=card.querySelector('[data-encounter-field="notes"]')?.closest('label');
      const after=document.createElement('label');after.className='field ccf-observation-field';after.innerHTML=`<span>Após a mamada</span><textarea rows="2" data-encounter-field="afterFeed" data-section="feeding_assessment" data-baby-id="${esc(babyId)}" placeholder="Comportamento após a mamada e observações finais."></textarea>`;notes?.before(after);
      const checklist=document.createElement('div');checklist.innerHTML=checklistMarkup();card.appendChild(checklist.firstElementChild);updateFeedingChecklist(card);
    }
  }
  function updateFeedingChecklist(card){const status=feedingChecklistStatus(feedingAssessmentFromCard(card));for(const [key,complete] of Object.entries(status)){const item=card.querySelector(`[data-ccf-check="${key}"]`);if(item)item.classList.toggle('is-complete',complete)}}
  function careField(name,label,placeholder,rows=3){return `<label class="field"><span>${label}</span><textarea rows="${rows}" data-encounter-field="${name}" data-section="care_plan" placeholder="${placeholder}"></textarea></label>`}
  function mountCarePlan(){
    const step=document.querySelector('[data-wizard-step="6"]');if(!step||step.querySelector('[data-ccf-care-builder]'))return;
    const existingInstructions=step.querySelector('[data-encounter-field="instructions"]')?.closest('label');
    const panel=document.createElement('section');panel.className='ccf-care-builder';panel.dataset.ccfCareBuilder='1';panel.innerHTML=`<div class="ccf-builder-head"><div><small>CONDUTA E MANEJO</small><strong>Plano estruturado</strong><span data-ccf-plan-context></span></div><span>Complementa o plano atual</span></div><div class="ccf-care-grid">${careField('priorityGuidance','Orientações prioritárias','O que precisa ser priorizado pela família agora?')}${careField('feedingPositioning','Mamada e posicionamento','Ajustes combinados de posicionamento, pega ou condução da mamada.')}${careField('expressionSupplement','Ordenha / complemento, se aplicável','Registrar apenas quando fizer parte da conduta.')}${careField('routine','Rotina','Organização prática combinada com a família.')}${careField('warningSigns','Sinais de alerta','Sinais discutidos e quando procurar avaliação.')}</div><div class="ccf-care-actions"><button type="button" class="ui-button ui-button-ghost" data-ccf-compose>Atualizar resumo de condutas</button><button type="button" class="ui-button" data-ccf-referral>Criar encaminhamento</button></div><p class="ccf-privacy-note">Encaminhamentos permanecem documentos profissionais e não são publicados automaticamente na Área da Mãe.</p>`;
    if(existingInstructions)existingInstructions.before(panel);else step.appendChild(panel);updateContext();
    panel.querySelector('[data-ccf-compose]').addEventListener('click',composeCareInstructions);
    panel.querySelector('[data-ccf-referral]').addEventListener('click',openReferralFromWizard);
  }
  function structuredPlanFromDom(){const read=name=>document.querySelector(`[data-wizard-step="6"] [data-encounter-field="${name}"]`)?.value||'';return{priorityGuidance:read('priorityGuidance'),feedingPositioning:read('feedingPositioning'),expressionSupplement:read('expressionSupplement'),routine:read('routine'),warningSigns:read('warningSigns')}}
  function composeCareInstructions(){
    const summary=buildCarePlanInstructions(structuredPlanFromDom());if(!summary){toast('Preencha pelo menos uma conduta estruturada.','warning');return}
    const target=document.querySelector('[data-wizard-step="6"] [data-encounter-field="instructions"]');if(!target)return;
    const current=clean(target.value);if(current&&norm(current)!==norm(summary)&&!current.includes('Orientações prioritárias:'))target.value=`${current}\n\n${summary}`;else target.value=summary;
    target.dispatchEvent(new Event('input',{bubbles:true}));toast('Resumo de condutas atualizado.','success');
  }
  function openReferralFromWizard(event){
    const motherId=document.querySelector('[data-appointment-patient]')?.value||'';if(!motherId){toast('Selecione a mãe antes de criar o encaminhamento.','warning');return}
    if(!window.DeboraReferrals?.openNew){toast('Módulo de encaminhamentos ainda está carregando.','warning');return}
    window.DeboraEncounter?.flush?.().catch(()=>{}).finally(()=>window.DeboraReferrals.openNew(motherId,event.currentTarget).catch(error=>toast(error.message||'Não foi possível criar o encaminhamento.','error')));
  }
  async function hydrateAdditiveFields(){
    const encounterId=window.DeboraEncounter?.getEncounterId?.()||'';if(!encounterId||state.hydratedEncounter===encounterId)return;const token=professionalToken();if(!token)return;
    try{
      const rows=await rest(`clinical_encounters?id=eq.${encodeURIComponent(encounterId)}&select=id,feeding_assessment,care_plan&limit=1`,token),enc=rows?.[0];if(!enc)return;
      const feeding=asObject(enc.feeding_assessment),byBaby=asObject(feeding.byBaby);
      for(const card of document.querySelectorAll('[data-feeding-assessment-editor] .baby-clinical-card')){
        const babyId=card.querySelector('[data-baby-id]')?.dataset.babyId||'';const source=asObject(byBaby[babyId]||feeding);
        for(const key of ['beforeFeed','afterFeed']){const field=card.querySelector(`[data-encounter-field="${key}"]`);if(field&&!field.value&&clean(source[key]))field.value=clean(source[key])}
        updateFeedingChecklist(card);
      }
      const plan=asObject(enc.care_plan);for(const key of ['priorityGuidance','feedingPositioning','expressionSupplement','routine','warningSigns']){const field=document.querySelector(`[data-wizard-step="6"] [data-encounter-field="${key}"]`);if(field&&!field.value&&clean(plan[key]))field.value=clean(plan[key])}
      state.hydratedEncounter=encounterId;
    }catch(error){console.warn('Complementos do plano não puderam ser restaurados',error)}
  }
  function hardenProfessionalPanel(){
    const select=document.querySelector('#mf-kind');if(select&&!select.dataset.ccfHardened){select.dataset.ccfHardened='1';for(const option of [...select.options])if(!['care_plan','orientation','document','appointment'].includes(option.value))option.remove();const note=document.createElement('small');note.className='ccf-publish-note';note.textContent='A Área da Mãe recebe somente plano de cuidado, orientações, termos e próximo retorno. Prontuário, anamnese, avaliações e encaminhamentos permanecem privados.';select.closest('.mf-grid')?.after(note)}
  }
  async function prepareSafeSummary(encounterId){
    const token=professionalToken();if(!token)return toast('Sessão profissional não encontrada.','error');
    try{const rows=await rest(`clinical_encounters?id=eq.${encodeURIComponent(encounterId)}&select=id,occurred_at,care_plan&limit=1`,token),enc=rows?.[0];if(!enc)throw new Error('Atendimento não encontrado.');const share=buildMotherSafeEncounterShare(enc);const kind=document.querySelector('#mf-kind'),title=document.querySelector('#mf-title'),body=document.querySelector('#mf-body');if(kind)kind.value=share.kind;if(title)title.value=share.title;if(body)body.value=share.body;toast('Resumo seguro preparado. Revise antes de publicar.','success')}catch(error){toast(error.message||'Não foi possível preparar o resumo.','error')}
  }
  function validatePublish(){const item={kind:document.querySelector('#mf-kind')?.value||'',title:document.querySelector('#mf-title')?.value||''};if(isMotherShareAllowed(item))return true;toast('Este tipo de conteúdo deve permanecer somente na área profissional.','error');return false}
  async function filterMotherPortal(){
    if(state.portalFiltering)return;const shell=document.querySelector('.mp-shell');if(!shell)return;const token=motherToken();if(!token)return;
    const key=token.slice(-24);if(state.portalLoadedKey===key&&document.documentElement.dataset.ccfPortalFilter==='ready'){applyPortalFilter();return}
    state.portalFiltering=true;document.documentElement.dataset.ccfPortalFilter='pending';
    try{const rows=await rest('member_shared_items?select=id,kind,title,published&order=occurred_at.desc',token);state.portalVerified=new Set((rows||[]).filter(isMotherShareAllowed).map(row=>row.id));state.portalLoadedKey=key;document.documentElement.dataset.ccfPortalFilter='ready';applyPortalFilter()}catch(error){state.portalVerified=new Set();document.documentElement.dataset.ccfPortalFilter='ready';applyPortalFilter();console.warn('Filtro da Área da Mãe operou em modo fechado',error)}finally{state.portalFiltering=false}
  }
  function applyPortalFilter(){
    for(const node of document.querySelectorAll('[data-shared]'))if(!state.portalVerified.has(node.dataset.shared))node.remove();
    for(const node of document.querySelectorAll('[data-material-source="shared"]'))if(!state.portalVerified.has(node.dataset.materialId))node.remove();
    for(const heading of document.querySelectorAll('.mp-section-title h2'))if(clean(heading.textContent)==='Meu acompanhamento'){heading.textContent='Meu cuidado';const section=heading.closest('.mp-section');const count=section?.querySelectorAll('[data-shared]').length||0;const span=section?.querySelector('.mp-section-title span');if(span)span.textContent=`${count} ${count===1?'item liberado':'itens liberados'}`;if(section&&count===0&&!section.querySelector('.mp-empty')){const empty=document.createElement('div');empty.className='mp-empty';empty.textContent='Seu plano, orientações e próximo retorno aparecerão aqui quando forem liberados.';section.appendChild(empty)}}
  }
  function mountAll(){
    ensureCss();
    if(location.hash.startsWith('#mae')){filterMotherPortal();return}
    mountContext();mountFeedingCards();mountCarePlan();updateContext();hardenProfessionalPanel();hydrateAdditiveFields();
  }
  document.addEventListener('input',event=>{const card=event.target.closest?.('[data-feeding-assessment-editor] .baby-clinical-card');if(card)updateFeedingChecklist(card)},true);
  document.addEventListener('click',event=>{
    const card=event.target.closest?.('[data-feeding-assessment-editor] .baby-clinical-card');if(card)setTimeout(()=>updateFeedingChecklist(card),0);
    if(event.target.closest?.('[data-encounter-choice][data-section="identification"]'))setTimeout(updateContext,0);
    const prepare=event.target.closest?.('[data-enc]');if(prepare&&document.querySelector('#mf-admin-body')){event.preventDefault();event.stopImmediatePropagation();prepareSafeSummary(prepare.dataset.enc);return}
    if(event.target.closest?.('#mf-publish')&&!validatePublish()){event.preventDefault();event.stopImmediatePropagation()}
  },true);
  new MutationObserver(()=>{clearTimeout(state.timer);state.timer=setTimeout(mountAll,45)}).observe(document.documentElement,{subtree:true,childList:true});
  window.addEventListener('hashchange',()=>{state.portalLoadedKey='';setTimeout(mountAll,0)});
  mountAll();
}
