import {sharePdf} from './document-pdf-service.js';

// iOS promotes a blob: PDF iframe into its native document viewer, which can
// display the technical origin instead of the attachment's file name.
// Only the referral PDF presentation uses this device-specific file flow.
export function isIosPdfViewer(nav=typeof navigator === 'undefined'?null:navigator){
  const agent=String(nav?.userAgent||'');
  return /iPhone|iPad|iPod/i.test(agent)
    || (nav?.platform==='MacIntel'&&Number(nav?.maxTouchPoints)>1);
}

// Finalization persists to D1 before this UI is shown. The extra tap is
// intentional: Web Share with files needs a fresh user gesture on Safari.
export function showSavedIosReferralPdf({pdf,fileName,documentRef=globalThis.document,share=sharePdf}={}){
  if(!pdf||!documentRef?.body)return null;
  const container=documentRef.createElement('div');
  container.className='rf-preview-layer';
  container.dataset.rfIosPdfReady='1';
  container.setAttribute('role','dialog');
  container.setAttribute('aria-modal','true');
  container.setAttribute('aria-label','Encaminhamento finalizado — PDF pronto');

  const header=documentRef.createElement('div');
  header.className='rf-preview-header';
  const title=documentRef.createElement('div');
  title.className='rf-preview-title';
  const heading=documentRef.createElement('h2');
  heading.textContent='Encaminhamento finalizado';
  const note=documentRef.createElement('p');
  note.textContent='Documento salvo. No iPhone, use a opção abaixo para visualizar, salvar em Arquivos ou compartilhar o PDF.';
  title.append(heading,note);

  const actions=documentRef.createElement('div');
  actions.className='rf-preview-actions';
  const open=documentRef.createElement('button');
  open.type='button';
  open.dataset.rfIosPdfOpen='1';
  open.textContent='Visualizar ou salvar PDF';
  const closeButton=documentRef.createElement('button');
  closeButton.type='button';
  closeButton.dataset.rfPreviewClose='1';
  closeButton.textContent='Voltar ao atendimento';
  actions.append(open,closeButton);
  header.append(title,actions);
  container.append(header);
  documentRef.body.appendChild(container);

  let closed=false;
  const close=()=>{
    if(closed)return;
    closed=true;
    container.remove();
  };
  closeButton.addEventListener('click',close);
  open.addEventListener('click',async()=>{
    try{
      await share(pdf,fileName,'Encaminhamento profissional');
      close();
    }catch(error){
      if(error?.name==='AbortError')return;
      note.textContent='Não foi possível abrir o PDF. Tente novamente ou utilize o botão Compartilhar do documento finalizado.';
    }
  });
  container.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();close()}
  });
  open.focus();
  return {container,close};
}
