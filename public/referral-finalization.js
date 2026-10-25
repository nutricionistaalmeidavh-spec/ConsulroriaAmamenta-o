import {createReferralPdf,downloadPdf,sharePdf} from './document-pdf-service.js';
import {reviewReferralContent} from './referral-review.js';
import {openReferralPreview} from './referral-preview.js';

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
  if(draft?.status==='finalized')return draft;
  const payload=buildPayload();
  if(!payload?.content?.html)throw new Error('O encaminhamento está vazio.');
  const review=reviewReferralContent(payload.content.html);
  if(!review.canFinalize)throw new Error('Revise os campos de modelo incompletos antes de finalizar.');
  const finalizedAt=new Date().toISOString();
  const persistedFields={
    title:`Encaminhamento · ${specialtyLabel}`,
    finalized_at:finalizedAt,
    baby_id:babyId||null,
    appointment_id:encounter?.appointment_id||draft?.appointment_id||null,
    encounter_id:encounter?.id||draft?.encounter_id||null,
    content:{...payload.content,issued_snapshot:{html:payload.content.html,specialty:payload.content.specialty,professional_destination:payload.content.professional_destination||'',finalized_at:finalizedAt},finalized_at:finalizedAt,updated_at:finalizedAt}
  };
  let finalizedDocument;
  if(draft?.id){
    const updated=await DOC.updateDocument(draft.id,{...persistedFields,status:'finalized'});
    if(!updated?.id||updated.status!=='finalized')throw new Error('Não foi possível confirmar a finalização do documento.');
    finalizedDocument=updated;
  }else{
    finalizedDocument=await DOC.saveDocument({document_type:'referral',mother_id:motherId,status:'finalized',...persistedFields});
    if(!finalizedDocument?.id||finalizedDocument.status!=='finalized')throw new Error('Não foi possível registrar o encaminhamento finalizado.');
  }
  // The exported PDF comes from the confirmed persisted record, not a stale local draft.
  const persisted=finalizedDocument.content?.issued_snapshot||finalizedDocument.content;
  const pdf=pdfFrom({context,baby,specialtyLabel,destination:persisted?.professional_destination,html:persisted?.html,finalizedAt:finalizedDocument.finalized_at||finalizedAt});
  downloadPdf(pdf,fileBase({context,baby,specialtyLabel}));
  DOC.toast('Encaminhamento finalizado e PDF gerado.');
  onFinalized?.(finalizedDocument);
  window.dispatchEvent(new CustomEvent('debora:clinical-document-finalized',{detail:{motherId,documentId:finalizedDocument.id,documentType:'referral',babyId:babyId||null,encounterId:finalizedDocument.encounter_id||encounter?.id||draft?.encounter_id||null}}));
  return finalizedDocument;
}

async function exportFinalized({draft,context,baby,specialtyLabel,mode='download'}){
  if(!draft?.id||draft.status!=='finalized')throw new Error('Finalize o encaminhamento antes de gerar a versão oficial.');
  const finalizedAt=draft.finalized_at||draft.content?.finalized_at||'';
  const frozen=draft.content?.issued_snapshot||draft.content;
  const pdf=pdfFrom({context,baby,specialtyLabel,destination:frozen?.professional_destination||'',html:frozen?.html||'',finalizedAt});
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
  if(!panel)return;
  const actions=panel.querySelector('.rf-actions');
  if(!actions||actions.querySelector('[data-rf-finalize], [data-rf-official-pdf]'))return;
  const preview=document.createElement('button');
  preview.type='button';preview.className='rf-secondary';preview.dataset.rfPreview='1';
  preview.textContent='Pré-visualizar PDF';
  actions.prepend(preview);
  preview.addEventListener('click',()=>{
    try{
      const draftContent=draft?.status==='finalized'?draft.content:buildPayload().content;
      const snapshot=draft?.status==='finalized'?(draftContent?.issued_snapshot||draftContent):draftContent;
      const review=reviewReferralContent(snapshot?.html||'');
      const pdf=pdfFrom({context,baby,specialtyLabel,
        destination:snapshot?.professional_destination||'',
        html:snapshot?.html||'',
        finalizedAt:draft?.status==='finalized'?(draft.finalized_at||snapshot?.finalized_at||''):''});
      openReferralPreview({panel,pdf,review,fileName:'encaminhamento-previa'});
    }catch(error){DOC.toast(error.message||'Não foi possível visualizar o PDF.','error')}
  });
  if(draft?.status==='finalized'){
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
    const review=reviewReferralContent(buildPayload()?.content?.html||'');
    if(!review.canFinalize){
      DOC.toast('Revise os campos incompletos antes de finalizar.','error');
      preview.click();return;
    }
    if(review.warnings.length&&!window.confirm('Há seções vazias ou sem título. Deseja finalizar o documento assim mesmo?'))return;
    button.disabled=true;button.textContent='Finalizando…';
    try{
      await finalizeDraft({draft,motherId,babyId,encounter,context,baby,specialtyLabel,buildPayload,onFinalized});
    }catch(error){DOC.toast(error.message||'Não foi possível finalizar o encaminhamento.','error');button.disabled=false;button.textContent='Finalizar e gerar PDF'}
  });
}

window.DeboraReferralFinalization={attachEditor,finalizeDraft,exportFinalized};
