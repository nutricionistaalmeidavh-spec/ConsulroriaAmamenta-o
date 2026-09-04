import {createReferralPdf,downloadPdf,sharePdf} from './document-pdf-service.js';

const DOC=window.DeboraDocuments;

const fmtDate=value=>{
  if(!value)return '';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(d);
};

function fileBase({context,baby,specialtyLabel}){
  return `encaminhamento-${specialtyLabel}-${context?.mother?.name||'paciente'}${baby?.name?`-${baby.name}`:''}`;
}

function pdfFrom({context,baby,specialtyLabel,destination,html,finalizedAt}){
  return createReferralPdf({
    motherName:context?.mother?.name||'Paciente',
    babyName:baby?.name||'',
    specialtyLabel:specialtyLabel||'Encaminhamento',
    destination:destination||'',
    html:html||'',
    finalizedAt:finalizedAt||''
  });
}

async function finalizeDraft({draft,motherId,babyId,encounter,context,baby,specialtyLabel,buildPayload,onFinalized}){
  if(!draft?.id)throw new Error('Salve o rascunho antes de finalizar.');
  if(draft.status==='finalized')return draft;
  const payload=buildPayload();
  if(!payload?.content?.html)throw new Error('O encaminhamento está vazio.');
  const finalizedAt=new Date().toISOString();
  const updated=await DOC.updateDocument(draft.id,{
    title:`Encaminhamento · ${specialtyLabel}`,
    status:'finalized',
    finalized_at:finalizedAt,
    baby_id:babyId||null,
    appointment_id:encounter?.appointment_id||draft.appointment_id||null,
    encounter_id:encounter?.id||draft.encounter_id||null,
    content:{...payload.content,finalized_at:finalizedAt,updated_at:finalizedAt}
  });
  const pdf=pdfFrom({context,baby,specialtyLabel,destination:payload.content.professional_destination,html:payload.content.html,finalizedAt});
  downloadPdf(pdf,fileBase({context,baby,specialtyLabel}));
  DOC.toast('Encaminhamento finalizado e PDF gerado.');
  onFinalized?.(updated||{...draft,status:'finalized',finalized_at:finalizedAt,content:payload.content});
  window.dispatchEvent(new CustomEvent('debora:clinical-document-finalized',{detail:{motherId,documentId:draft.id,documentType:'referral',babyId:babyId||null,encounterId:encounter?.id||draft.encounter_id||null}}));
  return updated;
}

async function exportFinalized({draft,context,baby,specialtyLabel,mode='download'}){
  if(!draft?.id||draft.status!=='finalized')throw new Error('Finalize o encaminhamento antes de gerar a versão oficial.');
  const finalizedAt=draft.finalized_at||draft.content?.finalized_at||'';
  const pdf=pdfFrom({context,baby,specialtyLabel,destination:draft.content?.professional_destination||'',html:draft.content?.html||'',finalizedAt});
  const base=fileBase({context,baby,specialtyLabel});
  if(mode==='share'){
    const result=await sharePdf(pdf,base,`Encaminhamento · ${specialtyLabel}`);
    DOC.toast(result==='shared'?'Encaminhamento compartilhado.':'PDF do encaminhamento gerado.');
    return;
  }
  downloadPdf(pdf,base);
  DOC.toast('PDF do encaminhamento gerado.');
}

function attachEditor({panel,draft,motherId,babyId,encounter,context,baby,specialtyLabel,buildPayload,onFinalized}){
  if(!panel||!draft?.id)return;
  const actions=panel.querySelector('.rf-actions');
  if(!actions||actions.querySelector('[data-rf-finalize], [data-rf-official-pdf]'))return;
  if(draft.status==='finalized'){
    const stamp=document.createElement('div');
    stamp.className='rf-finalized-stamp';
    stamp.innerHTML=`<strong>Encaminhamento finalizado</strong><span>${DOC.escapeHTML(fmtDate(draft.finalized_at||draft.content?.finalized_at)||'Documento oficial')}</span>`;
    actions.before(stamp);
    const pdf=document.createElement('button');pdf.type='button';pdf.className='rf-primary';pdf.dataset.rfOfficialPdf='1';pdf.textContent='Gerar PDF';
    const share=document.createElement('button');share.type='button';share.className='rf-secondary';share.dataset.rfOfficialShare='1';share.textContent='Compartilhar';
    actions.prepend(share);actions.prepend(pdf);
    pdf.addEventListener('click',()=>exportFinalized({draft,context,baby,specialtyLabel}).catch(error=>DOC.toast(error.message||'Não foi possível gerar o PDF.','error')));
    share.addEventListener('click',()=>exportFinalized({draft,context,baby,specialtyLabel,mode:'share'}).catch(error=>{if(error?.name!=='AbortError')DOC.toast(error.message||'Não foi possível compartilhar.','error')}));
    return;
  }
  const button=document.createElement('button');button.type='button';button.className='rf-finalize';button.dataset.rfFinalize='1';button.textContent='Finalizar e gerar PDF';
  actions.appendChild(button);
  button.addEventListener('click',async()=>{
    button.disabled=true;button.textContent='Finalizando…';
    try{
      await finalizeDraft({draft,motherId,babyId,encounter,context,baby,specialtyLabel,buildPayload,onFinalized});
    }catch(error){DOC.toast(error.message||'Não foi possível finalizar o encaminhamento.','error');button.disabled=false;button.textContent='Finalizar e gerar PDF'}
  });
}

window.DeboraReferralFinalization={attachEditor,finalizeDraft,exportFinalized};
