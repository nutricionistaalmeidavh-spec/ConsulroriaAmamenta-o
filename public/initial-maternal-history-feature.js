const clean=value=>String(value??'').trim();
const norm=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

export function isInitialMaternalHistoryVisible(appointmentType=''){
  return norm(appointmentType)==='consulta inicial';
}

export function serializeMedicationRows(rows=[]){
  return (Array.isArray(rows)?rows:[])
    .map(row=>({name:clean(row?.name),dose:clean(row?.dose),frequency:clean(row?.frequency)}))
    .filter(row=>row.name)
    .map(row=>`${row.name} | ${row.dose} | ${row.frequency}`)
    .join('\n');
}

export function medicationRowsFromText(value=''){
  return clean(value).split(/\r?\n/).map(line=>{
    const [name='',dose='',frequency='']=String(line).split('|').map(clean);
    return{name,dose,frequency};
  }).filter(row=>row.name);
}

export function initialMaternalHistorySummary(history={}){
  const statusFields=['assistedReproduction','chronicConditionsHistory','medicationUse','supplementsUse','allergiesKnown','pregnancyComplications','breastSurgeryHistory','previousBreastfeedingHistory'];
  const answered=statusFields.filter(field=>clean(history?.[field])).length;
  const medications=medicationRowsFromText(history?.medications).length;
  const parts=[];
  if(answered)parts.push(`${answered} ${answered===1?'resposta':'respostas'}`);
  if(medications)parts.push(`${medications} ${medications===1?'medicamento':'medicamentos'}`);
  return{answered,medications,label:parts.join(' · ')||'Preencher histórico'};
}

const browser=typeof window!=='undefined'&&typeof document!=='undefined';
if(browser){
  const state={timer:null};
  const statusOptions='<option value="">Selecione</option><option value="Não informado">Não informado</option><option value="Não">Não</option><option value="Sim">Sim</option>';

  function ensureCss(){
    if(document.querySelector('link[data-imh-style]'))return;
    const link=document.createElement('link');link.rel='stylesheet';link.href='/initial-maternal-history-feature.css';link.dataset.imhStyle='1';document.head.appendChild(link);
  }
  function selectedAppointmentType(){return document.querySelector('[data-encounter-choice][data-section="identification"][data-field="appointmentType"][aria-pressed="true"]')?.dataset.value||''}
  function historyField(name){return document.querySelector(`[data-ccf-maternal-history] [data-encounter-field="${name}"]`)}
  function selectField(name,label){return `<label class="field ccf-history-status"><span>${label}</span><select data-encounter-field="${name}" data-section="maternal_assessment">${statusOptions}</select></label>`}
  function detailTextarea(name,label,placeholder,rows=2){return `<label class="field"><span>${label}</span><textarea rows="${rows}" data-encounter-field="${name}" data-section="maternal_assessment" placeholder="${placeholder}"></textarea></label>`}
  function detailWrap(key,body){return `<div class="ccf-history-detail" data-ccf-history-detail="${key}" hidden>${body}</div>`}
  function medicationRowMarkup(row={}){return `<div class="ccf-medication-row" data-ccf-medication-row><label><span>Medicamento</span><input data-ccf-med-name value="${esc(row.name||'')}" placeholder="Nome"></label><label><span>Dose</span><input data-ccf-med-dose value="${esc(row.dose||'')}" placeholder="Opcional"></label><label><span>Frequência</span><input data-ccf-med-frequency value="${esc(row.frequency||'')}" placeholder="Opcional"></label><button type="button" class="ccf-med-remove" data-ccf-remove-med aria-label="Remover medicamento">×</button></div>`}

  function mountMaternalHistory(){
    const step=document.querySelector('[data-wizard-step="3"]');if(!step)return null;
    let panel=step.querySelector('[data-ccf-maternal-history]');
    if(panel)return panel;
    panel=document.createElement('details');panel.className='ccf-history-card';panel.dataset.ccfMaternalHistory='1';
    panel.innerHTML=`<summary><div><small>HISTÓRICO CLÍNICO E GESTACIONAL</small><strong>Dados relevantes da avaliação inicial</strong><span>Registro factual, sem interpretação automática.</span></div><b data-ccf-history-summary>Preencher histórico</b></summary><div class="ccf-history-body"><p class="ccf-history-note">Este bloco registra o contexto deste primeiro atendimento e não altera o cadastro permanente da mãe.</p><div class="ccf-history-grid">
      <section>${selectField('assistedReproduction','Esta gestação foi por reprodução assistida / FIV?')}${detailWrap('assistedReproduction',detailTextarea('assistedReproductionNotes','Observações','Tratamento, contexto da gestação ou informação relevante.'))}</section>
      <section>${selectField('chronicConditionsHistory','Doença crônica preexistente?')}${detailWrap('chronicConditionsHistory',detailTextarea('chronicConditionsDetails','Qual(is)?','Ex.: hipotireoidismo, hipertensão, diabetes...'))}</section>
      <section class="ccf-history-wide">${selectField('medicationUse','Faz uso atual de medicamentos?')}<input type="hidden" data-encounter-field="medications" data-section="maternal_assessment">${detailWrap('medicationUse','<div class="ccf-medication-list" data-ccf-medication-list></div><button type="button" class="ui-button ui-button-ghost ccf-add-med" data-ccf-add-med>+ Adicionar medicamento</button><small class="ccf-field-help">Registre nome e, quando souber, dose e frequência. O sistema não avalia compatibilidade ou risco.</small>')}</section>
      <section>${selectField('supplementsUse','Faz uso de suplementos?')}${detailWrap('supplementsUse',detailTextarea('supplements','Quais?','Nome e uso atual.'))}</section>
      <section>${selectField('allergiesKnown','Alergias conhecidas?')}${detailWrap('allergiesKnown',detailTextarea('allergies','Quais?','Alergias medicamentosas, alimentares ou outras relatadas.'))}</section>
      <section>${selectField('pregnancyComplications','Houve intercorrências durante a gestação?')}${detailWrap('pregnancyComplications',detailTextarea('pregnancyComplicationsDetails','Quais?','Descreva apenas o que foi relatado ou documentado.'))}</section>
      <section>${selectField('breastSurgeryHistory','Cirurgias mamárias anteriores?')}${detailWrap('breastSurgeryHistory',detailTextarea('breastSurgeryDetails','Detalhes','Tipo, ano e lado, se relevante.'))}</section>
      <section class="ccf-history-wide">${selectField('previousBreastfeedingHistory','Histórico de amamentação anterior?')}${detailWrap('previousBreastfeedingHistory',detailTextarea('previousBreastfeedingDetails','Como foi?','Experiência anterior, duração e dificuldades relatadas.',3))}</section>
    </div></div>`;
    const firstGrid=step.querySelector('.form-grid');if(firstGrid)firstGrid.before(panel);else step.appendChild(panel);
    if(!window.DeboraEncounter?.getEncounterId?.())panel.open=true;
    renderMedicationRows(panel,[]);
    return panel;
  }

  function medicationRows(panel){
    return [...panel.querySelectorAll('[data-ccf-medication-row]')].map(row=>({
      name:row.querySelector('[data-ccf-med-name]')?.value||'',
      dose:row.querySelector('[data-ccf-med-dose]')?.value||'',
      frequency:row.querySelector('[data-ccf-med-frequency]')?.value||''
    }));
  }
  function renderMedicationRows(panel,rows=[]){
    const list=panel.querySelector('[data-ccf-medication-list]');if(!list)return;
    const values=rows.length?rows:[{}];list.innerHTML=values.map(medicationRowMarkup).join('');
  }
  function syncMedicationHidden(panel,{dispatch=false}={}){
    const hidden=panel.querySelector('[data-encounter-field="medications"]');if(!hidden)return;
    const value=serializeMedicationRows(medicationRows(panel));hidden.value=value;panel.dataset.ccfMedicationSnapshot=value;
    if(dispatch)hidden.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function syncMedicationRowsFromHidden(panel,{force=false}={}){
    const hidden=panel.querySelector('[data-encounter-field="medications"]');if(!hidden)return;
    const value=hidden.value||'';
    if(!force&&panel.dataset.ccfMedicationSnapshot===value)return;
    renderMedicationRows(panel,medicationRowsFromText(value));panel.dataset.ccfMedicationSnapshot=value;
  }
  function historyFromDom(panel){
    const out={};for(const field of panel.querySelectorAll('[data-encounter-field]'))out[field.dataset.encounterField]=field.value||'';return out;
  }
  function updateSummary(panel){
    const target=panel.querySelector('[data-ccf-history-summary]');if(!target)return;
    target.textContent=initialMaternalHistorySummary(historyFromDom(panel)).label;
  }
  function updateDetails(panel){
    for(const detail of panel.querySelectorAll('[data-ccf-history-detail]')){
      const status=historyField(detail.dataset.ccfHistoryDetail)?.value||'';detail.hidden=status!=='Sim';
    }
  }
  function updateVisibility(panel){
    panel.hidden=!isInitialMaternalHistoryVisible(selectedAppointmentType());
  }
  function refresh({forceMedication=false}={}){
    ensureCss();const panel=mountMaternalHistory();if(!panel)return;
    updateVisibility(panel);syncMedicationRowsFromHidden(panel,{force:forceMedication});updateDetails(panel);updateSummary(panel);
  }

  document.addEventListener('change',event=>{
    const panel=event.target.closest?.('[data-ccf-maternal-history]');if(panel){updateDetails(panel);updateSummary(panel)}
  },true);
  document.addEventListener('input',event=>{
    const panel=event.target.closest?.('[data-ccf-maternal-history]');if(!panel)return;
    if(event.target.matches?.('[data-ccf-med-name],[data-ccf-med-dose],[data-ccf-med-frequency]'))syncMedicationHidden(panel);
    updateSummary(panel);
  },true);
  document.addEventListener('click',event=>{
    if(event.target.closest?.('[data-encounter-choice][data-section="identification"][data-field="appointmentType"]'))setTimeout(()=>refresh(),0);
    const add=event.target.closest?.('[data-ccf-add-med]');if(add){const panel=add.closest('[data-ccf-maternal-history]'),list=panel?.querySelector('[data-ccf-medication-list]');if(list){list.insertAdjacentHTML('beforeend',medicationRowMarkup({}));list.querySelector('[data-ccf-medication-row]:last-child [data-ccf-med-name]')?.focus()}return}
    const remove=event.target.closest?.('[data-ccf-remove-med]');if(remove){const panel=remove.closest('[data-ccf-maternal-history]');remove.closest('[data-ccf-medication-row]')?.remove();if(panel&&!panel.querySelector('[data-ccf-medication-row]'))renderMedicationRows(panel,[]);if(panel){syncMedicationHidden(panel,{dispatch:true});updateSummary(panel)}}
  },true);
  window.addEventListener('hashchange',()=>setTimeout(()=>refresh({forceMedication:true}),35));
  new MutationObserver(()=>{clearTimeout(state.timer);state.timer=setTimeout(()=>refresh(),45)}).observe(document.documentElement,{subtree:true,childList:true});
  refresh();
}
