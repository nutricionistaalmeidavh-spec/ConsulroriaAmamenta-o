import {REFERRAL_SPECIALTIES,buildReferralDraft,getReferralSpecialty} from './referral-templates.js';

const DOC=window.DeboraDocuments;
let currentMother='',layer=null,lastTrigger=null;

const fmtDate=value=>{
  if(!value)return 'Sem data';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(d);
};
const cleanText=value=>String(value??'').replace(/\s+/g,' ').trim();
function extractClinicalText(value,preferred=[]){
  if(value==null)return '';
  if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return cleanText(value);
  if(Array.isArray(value))return cleanText(value.map(item=>extractClinicalText(item,preferred)).filter(Boolean).join('; '));
  if(typeof value!=='object')return '';
  const entries=Object.entries(value);
  const selected=preferred.length?entries.filter(([key])=>preferred.some(rx=>rx.test(key))):[];
  const source=selected.length?selected:entries;
  return cleanText(source.map(([,v])=>extractClinicalText(v,preferred)).filter(Boolean).join('; ')).slice(0,1600);
}
function babyAge(baby){
  if(!baby?.birth_date)return '';
  const birth=new Date(`${baby.birth_date}T12:00:00`);if(Number.isNaN(birth.getTime()))return '';
  const days=Math.max(0,Math.floor((Date.now()-birth.getTime())/86400000));
  if(days<31)return `${days} dia${days===1?'':'s'}`;
  const months=Math.floor(days/30.4375);
  if(months<24)return `${months} ${months===1?'mês':'meses'}`;
  const years=Math.floor(months/12);return `${years} ano${years===1?'':'s'}`;
}
function weightText(baby){
  const value=Number(baby?.current_weight_g||0);
  return value>0?`Peso atual registrado: ${Math.round(value).toLocaleString('pt-BR')} g`:'';
}
function close(){if(!layer)return;layer.remove();layer=null;requestAnimationFrame(()=>lastTrigger?.focus?.())}
function trap(event){
  if(event.key==='Escape'){event.preventDefault();close();return}
  if(event.key!=='Tab'||!layer)return;
  const f=[...layer.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[contenteditable="true"]')];
  if(!f.length)return;const first=f[0],last=f.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
function sheet(title,body,wide=false){
  close();layer=document.createElement('div');layer.className='rf-layer';
  layer.innerHTML=`<div class="rf-backdrop" data-rf-close></div><section class="rf-sheet ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="rf-title"><header><div><small>ENCAMINHAMENTO PROFISSIONAL</small><h2 id="rf-title">${DOC.escapeHTML(title)}</h2></div><button type="button" class="rf-close" data-rf-close aria-label="Fechar">×</button></header>${body}</section>`;
  document.body.appendChild(layer);layer.addEventListener('keydown',trap);layer.querySelectorAll('[data-rf-close]').forEach(x=>x.addEventListener('click',close));requestAnimationFrame(()=>layer.querySelector('.rf-close')?.focus());return layer.querySelector('.rf-sheet');
}
function sanitizeEditorHtml(html=''){
  const doc=new DOMParser().parseFromString(`<div id="root">${html}</div>`,'text/html'),root=doc.querySelector('#root');
  root.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select,link,meta').forEach(node=>node.remove());
  root.querySelectorAll('*').forEach(node=>{
    [...node.attributes].forEach(attr=>{if(/^on/i.test(attr.name)||['style','id','class','contenteditable'].includes(attr.name.toLowerCase()))node.removeAttribute(attr.name)});
    if(!['P','BR','STRONG','B','EM','I','U','UL','OL','LI'].includes(node.tagName)){const fragment=doc.createDocumentFragment();while(node.firstChild)fragment.appendChild(node.firstChild);node.replaceWith(fragment)}
  });
  return root.innerHTML.trim();
}
async function referralRows(motherId){
  try{return await DOC.listDocuments(motherId,'referral')}catch(error){if(/clinical_documents|schema cache|relation .* does not exist/i.test(error.message||''))return [];throw error}
}
async function contextForDraft(motherId,babyId){
  const context=await DOC.patientContext(motherId);if(!context)throw new Error('Paciente não encontrada.');
  const baby=context.babies.find(item=>item.id===babyId)||null;
  const encounter=await DOC.latestEncounter(motherId,babyId).catch(()=>null);
  const chiefComplaint=extractClinicalText(encounter?.chief_complaint,[/complaint/i,/queixa/i,/reason/i,/motivo/i,/note/i,/observ/i,/description/i]);
  const careSummary=extractClinicalText(encounter?.care_plan,[/goal/i,/objet/i,/orient/i,/condut/i,/plan/i,/summary/i,/resum/i,/note/i]);
  return {context,baby,encounter,chiefComplaint,careSummary};
}
function editorToolbar(){
  return `<div class="rf-toolbar" role="toolbar" aria-label="Formatação do encaminhamento">
    <button type="button" data-rf-cmd="bold" aria-label="Negrito"><strong>N</strong></button>
    <button type="button" data-rf-cmd="italic" aria-label="Itálico"><em>I</em></button>
    <button type="button" data-rf-cmd="underline" aria-label="Sublinhado"><u>S</u></button>
    <button type="button" data-rf-cmd="insertUnorderedList" aria-label="Lista com marcadores">• —</button>
    <button type="button" data-rf-cmd="insertOrderedList" aria-label="Lista numerada">1.</button>
  </div>`;
}
async function openEditor({motherId,babyId,specialty,destination='',draft=null,trigger=null}){
  lastTrigger=trigger||document.activeElement;
  const {context,baby,encounter,chiefComplaint,careSummary}=await contextForDraft(motherId,babyId);
  const base=draft?.content?.html?{
    title:draft.title,
    specialty:draft.content.specialty||specialty,
    specialtyLabel:getReferralSpecialty(draft.content.specialty||specialty).label,
    professionalDestination:draft.content.professional_destination||destination,
    html:draft.content.html
  }:buildReferralDraft({
    specialty,motherName:context.mother.name,babyName:baby?.name||'',babyAge:babyAge(baby),
    chiefComplaint,careSummary,weightText:weightText(baby),professionalDestination:destination
  });
  const isFinalized=draft?.status === 'finalized';
  const panel=sheet(base.title,`<div class="rf-editor-form ${isFinalized?'is-finalized':''}">
    <div class="rf-meta-grid">
      <label><span>Especialidade</span><input value="${DOC.escapeHTML(base.specialtyLabel)}" readonly></label>
      <label><span>Profissional/serviço de destino</span><input data-rf-destination value="${DOC.escapeHTML(base.professionalDestination||'')}" placeholder="ex.: Dra. Maria — Pediatria" ${isFinalized?'readonly':''}></label>
    </div>
    <label class="rf-editor-label"><span>Conteúdo</span>${isFinalized?'':editorToolbar()}<div class="rf-editor" contenteditable="${isFinalized?'false':'true'}" role="textbox" aria-multiline="true" data-rf-editor>${base.html}</div></label>
    <div class="rf-editor-note">${isFinalized?'Documento finalizado. O conteúdo fica somente para leitura; gere ou compartilhe a versão oficial em PDF.':'O pré-preenchimento usa apenas dados já registrados da paciente, do bebê e do atendimento selecionado. Revise o texto antes de salvar.'}</div>
    <div class="rf-actions"><button type="button" class="rf-secondary" data-rf-close>${isFinalized?'Fechar':'Cancelar'}</button>${isFinalized?'':'<button type="button" class="rf-primary" data-rf-save>Salvar rascunho</button>'}</div>
  </div>`,true);
  panel.querySelectorAll('[data-rf-close]').forEach(x=>x.addEventListener('click',close));
  const editor=panel.querySelector('[data-rf-editor]'),destinationInput=panel.querySelector('[data-rf-destination]');
  panel.querySelectorAll('[data-rf-cmd]').forEach(btn=>btn.addEventListener('click',()=>{editor.focus();document.execCommand(btn.dataset.rfCmd,false,null)}));
  const buildPayload=()=>{
    const html=sanitizeEditorHtml(editor.innerHTML),professionalDestination=destinationInput.value.trim();
    return {content:{
      schema_version:1,specialty:base.specialty,professional_destination:professionalDestination,html,
      source:{mother_id:motherId,baby_id:babyId||null,encounter_id:encounter?.id||null,appointment_id:encounter?.appointment_id||null},
      prefill:{chief_complaint:Boolean(chiefComplaint),care_summary:Boolean(careSummary),baby_weight:Boolean(weightText(baby))},
      updated_at:new Date().toISOString()
    }};
  };
  if(!isFinalized){
    panel.querySelector('[data-rf-save]').addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;button.textContent='Salvando…';
      const payload=buildPayload();
      if(!cleanText(editor.textContent)){button.disabled=false;button.textContent='Salvar rascunho';return DOC.toast('O encaminhamento está vazio.','error')}
      try{
        if(draft?.id)await DOC.updateDocument(draft.id,{title:`Encaminhamento · ${base.specialtyLabel}`,baby_id:babyId||null,appointment_id:encounter?.appointment_id||null,encounter_id:encounter?.id||null,content:payload.content});
        else await DOC.saveDocument({document_type:'referral',title:`Encaminhamento · ${base.specialtyLabel}`,status:'draft',baby_id:babyId||null,appointment_id:encounter?.appointment_id||null,encounter_id:encounter?.id||null,content:payload.content});
        close();DOC.toast('Rascunho de encaminhamento salvo.');currentMother='';await mount(motherId);
      }catch(error){DOC.toast(error.message||'Não foi possível salvar o encaminhamento.','error');button.disabled=false;button.textContent='Salvar rascunho'}
    });
  }
  window.DeboraReferralFinalization?.attachEditor({
    panel,draft,motherId,babyId,encounter,context,baby,specialtyLabel:base.specialtyLabel,buildPayload,
    onFinalized:async()=>{close();currentMother='';await mount(motherId)}
  });
}
async function openNew(motherId,trigger){
  lastTrigger=trigger||document.activeElement;
  const context=await DOC.patientContext(motherId);if(!context)throw new Error('Paciente não encontrada.');
  const active=context.activeBabyId||context.babies[0]?.id||'';
  const form=sheet('Novo encaminhamento',`<form class="rf-new" data-rf-new>
    <label><span>Especialidade</span><select data-rf-specialty>${REFERRAL_SPECIALTIES.map(item=>`<option value="${item.id}">${DOC.escapeHTML(item.label)}</option>`).join('')}</select></label>
    <label><span>Paciente/bebê relacionado</span><select data-rf-baby><option value="">Somente a mãe</option>${context.babies.map(b=>`<option value="${b.id}" ${b.id===active?'selected':''}>${DOC.escapeHTML(b.name)}</option>`).join('')}</select></label>
    <label><span>Profissional/serviço de destino (opcional)</span><input data-rf-destination placeholder="ex.: Dra. Maria — Pediatria"></label>
    <div class="rf-actions"><button type="button" class="rf-secondary" data-rf-close>Cancelar</button><button type="submit" class="rf-primary">Gerar rascunho</button></div>
  </form>`);
  form.querySelectorAll('[data-rf-close]').forEach(x=>x.addEventListener('click',close));
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const specialty=form.querySelector('[data-rf-specialty]').value,babyId=form.querySelector('[data-rf-baby]').value||'',destination=form.querySelector('[data-rf-destination]').value.trim();
    close();openEditor({motherId,babyId,specialty,destination,trigger:lastTrigger}).catch(error=>DOC.toast(error.message||'Não foi possível montar o encaminhamento.','error'));
  });
}
async function openExisting(motherId,id,trigger){
  const rows=await referralRows(motherId),draft=rows.find(row=>row.id===id);if(!draft)throw new Error('Encaminhamento não encontrado.');
  const specialty=draft.content?.specialty||'outro',babyId=draft.baby_id||'',destination=draft.content?.professional_destination||'';
  return openEditor({motherId,babyId,specialty,destination,draft,trigger});
}
function cardMarkup(motherId,rows){
  const recent=rows.slice(0,6);
  return `<section class="rf-card" data-rf-card data-rf-mother="${motherId}">
    <div class="rf-head"><div><small>DOCUMENTOS</small><h2>Encaminhamentos</h2><p>Crie, revise e finalize documentos por especialidade vinculados ao prontuário da paciente.</p></div><button type="button" class="rf-primary" data-rf-new-button>Novo encaminhamento</button></div>
    ${recent.length?`<div class="rf-list">${recent.map(row=>{const done=row.status==='finalized';return `<button type="button" data-rf-open="${row.id}"><div><strong>${DOC.escapeHTML(row.title||'Encaminhamento')}</strong><small>${DOC.escapeHTML(fmtDate(row.updated_at||row.created_at))}</small></div><span class="${done?'is-finalized':''}">${done?'Finalizado':'Rascunho'}</span><b>›</b></button>`}).join('')}</div>`:`<div class="rf-empty"><strong>Nenhum encaminhamento criado</strong><span>Escolha uma especialidade para gerar o primeiro rascunho.</span></div>`}
  </section>`;
}
async function mount(motherId){
  if(!motherId||motherId===currentMother&&document.querySelector('[data-rf-card]'))return;
  currentMother=motherId;document.querySelectorAll('[data-rf-card]').forEach(x=>x.remove());
  const screen=document.querySelector('[data-screen="patient"]');if(!screen)return;
  try{
    const rows=await referralRows(motherId),wrap=document.createElement('div');wrap.innerHTML=cardMarkup(motherId,rows);const card=wrap.firstElementChild;
    const album=screen.querySelector('[data-af-card]'),terms=screen.querySelector('[data-df-terms-card]'),target=album||terms||screen.querySelector('[data-pf-prontuario]')||screen.querySelector('.patient-detail-grid')||screen.lastElementChild;
    target?.after?target.after(card):screen.appendChild(card);
    card.querySelector('[data-rf-new-button]').addEventListener('click',event=>openNew(motherId,event.currentTarget).catch(e=>DOC.toast(e.message||'Não foi possível criar o encaminhamento.','error')));
    card.querySelectorAll('[data-rf-open]').forEach(btn=>btn.addEventListener('click',()=>openExisting(motherId,btn.dataset.rfOpen,btn).catch(e=>DOC.toast(e.message||'Não foi possível abrir o encaminhamento.','error'))));
  }catch(error){
    if(/clinical_documents|schema cache|relation .* does not exist/i.test(error.message||''))return;
    if(!/Sessão não encontrada/.test(error.message||''))DOC.toast(error.message||'Não foi possível carregar encaminhamentos.','error');
  }
}
window.addEventListener('debora:patient-context',event=>{const motherId=event.detail?.motherId;if(motherId)mount(motherId);else{currentMother='';document.querySelectorAll('[data-rf-card]').forEach(x=>x.remove())}});
window.addEventListener('debora:clinical-document-finalized',event=>{const motherId=event.detail?.motherId;if(motherId===DOC.currentMotherId()){currentMother='';mount(motherId)}});
window.DeboraReferrals={openNew,openExisting,refresh:()=>{currentMother='';const id=DOC.currentMotherId();if(id)mount(id)}};
