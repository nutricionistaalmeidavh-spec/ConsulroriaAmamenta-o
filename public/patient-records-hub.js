const DOC=window.DeboraDocuments;
let currentMother='';

async function safeCount(path){
  try{return (await DOC.rest(path)||[]).length}catch(error){if(/schema cache|relation .* does not exist|clinical_documents|clinical_media/i.test(error.message||''))return 0;throw error}
}

async function counts(motherId){
  const [consents,referrals,media]=await Promise.all([
    DOC.consents(motherId).catch(()=>[]),
    DOC.listDocuments(motherId,'referral').catch(()=>[]),
    safeCount(`clinical_media?mother_id=eq.${encodeURIComponent(motherId)}&select=id`)
  ]);
  return {terms:consents.length,referrals:referrals.length,media,finalized:referrals.filter(row=>row.status==='finalized').length};
}
function clearHub(){document.querySelectorAll('[data-prh-card]').forEach(node=>node.parentNode?.removeChild(node))}
function cardMarkup(motherId,data){
  return `<section class="prh-card" data-prh-card data-prh-mother="${motherId}">
    <div class="prh-head"><div><small>PRONTUÁRIO</small><h2>Registros e documentos</h2><p>Acesso rápido aos registros da paciente sem alongar a ficha.</p></div><button type="button" class="prh-more" data-prh-more>Mais ações</button></div>
    <div class="prh-grid">
      <button type="button" data-prh-target="terms"><span class="prh-icon" aria-hidden="true">T</span><div><strong>Termos</strong><small>${data.terms} ${data.terms===1?'registro':'registros'}</small></div><b>›</b></button>
      <button type="button" data-prh-target="referrals"><span class="prh-icon" aria-hidden="true">E</span><div><strong>Encaminhamentos</strong><small>${data.referrals}${data.finalized?` · ${data.finalized} finalizado${data.finalized===1?'':'s'}`:''}</small></div><b>›</b></button>
      <button type="button" data-prh-target="album"><span class="prh-icon" aria-hidden="true">A</span><div><strong>Álbum clínico</strong><small>${data.media} ${data.media===1?'imagem':'imagens'}</small></div><b>›</b></button>
      <button type="button" data-prh-target="export"><span class="prh-icon" aria-hidden="true">PDF</span><div><strong>Exportar prontuário</strong><small>Resumo ou prontuário completo</small></div><b>›</b></button>
    </div>
  </section>`;
}
function openMoreActions(){
  const hiddenQuick=document.querySelector('[data-pw-quick="more"]');
  if(hiddenQuick){hiddenQuick.click();return true}
  window.DeboraPatientWorkspace?.refresh?.();
  setTimeout(()=>document.querySelector('[data-pw-quick="more"]')?.click(),120);
  return false;
}
async function mount(motherId){
  if(!motherId)return;const screen=document.querySelector('[data-screen="patient"]');if(!screen)return;if(motherId===currentMother&&document.querySelector('[data-prh-card]'))return;currentMother=motherId;clearHub();
  try{
    const data=await counts(motherId),wrap=document.createElement('div');wrap.innerHTML=cardMarkup(motherId,data);const card=wrap.firstElementChild;
    const firstRecords=screen.querySelector('[data-df-terms-card], [data-af-card], [data-rf-card], [data-rx-card]');
    if(firstRecords)firstRecords.before(card);else{const target=screen.querySelector('[data-pf-prontuario]')||screen.querySelector('.patient-detail-grid')||screen.lastElementChild;target?.after?target.after(card):screen.appendChild(card)}
    for(const kind of ['terms','referrals','album'])card.querySelector(`[data-prh-target="${kind}"]`).addEventListener('click',event=>window.DeboraPatientWorkspace?.open(kind,motherId,event.currentTarget));
    card.querySelector('[data-prh-target="export"]').addEventListener('click',event=>window.DeboraRecordExport?.open(motherId,event.currentTarget).catch(error=>DOC.toast(error.message||'Não foi possível abrir a exportação.','error')));
    card.querySelector('[data-prh-more]').addEventListener('click',()=>openMoreActions());
    window.DeboraPatientWorkspace?.refresh?.();
  }catch(error){if(!/Sessão não encontrada/.test(error.message||''))DOC.toast(error.message||'Não foi possível organizar os registros.','error')}
}
function refresh(){currentMother='';const motherId=DOC.currentMotherId();if(motherId)mount(motherId)}
window.addEventListener('debora:patient-context',event=>{const motherId=event.detail?.motherId;if(motherId)mount(motherId);else{currentMother='';clearHub()}});
window.addEventListener('debora:clinical-document-finalized',refresh);window.addEventListener('debora:record-exported',refresh);window.DeboraPatientRecordsHub={refresh};
