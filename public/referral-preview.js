import {downloadPdf,sharePdf} from './document-pdf-service.js';
import {isIosPdfViewer} from './referral-ios-pdf.js';
/**
 * Document preview uses the exact Blob returned by the official PDF renderer.
 * It does not persist, finalize, alter authoring HTML, or send medical data away.
 */
export function openReferralPreview({panel,pdf,review,fileName='encaminhamento-previa'}={}){
  if(!panel||!pdf)return null;
  panel.querySelectorAll('[data-rf-preview-layer]').forEach(node=>node.remove());
  const container=document.createElement('div');
  container.className='rf-preview-layer';
  container.dataset.rfPreviewLayer='1';
  container.setAttribute('role','dialog');
  container.setAttribute('aria-modal','true');
  container.setAttribute('aria-label','Pré-visualização do encaminhamento');
  const nativeFilePreview=isIosPdfViewer();
  const url=nativeFilePreview?null:URL.createObjectURL(pdf);
  const header=document.createElement('div');
  header.className='rf-preview-header';
  const title=document.createElement('div');
  title.className='rf-preview-title';
  const h=document.createElement('h2');h.textContent='Pré-visualização do PDF';
  const p=document.createElement('p');p.textContent='Esta é a versão que será exportada; a prévia não salva nem finaliza o documento.';
  title.append(h,p);
  const controls=document.createElement('div');controls.className='rf-preview-actions';
  const closeButton=document.createElement('button');
  closeButton.type='button';closeButton.dataset.rfPreviewClose='1';closeButton.textContent='Voltar ao editor';
  const download=document.createElement('button');
  download.type='button';download.dataset.rfPreviewDownload='1';download.textContent=nativeFilePreview?'Visualizar ou salvar PDF':'Baixar prévia';
  controls.append(download,closeButton);
  header.append(title,controls);
  const reviewPanel=document.createElement('div');reviewPanel.className='rf-preview-review';
  reviewPanel.dataset.rfPreviewReview='1';
  const alerts=[...(review?.blockers||[]).map(value=>({value,severity:'blocker'})),...(review?.warnings||[]).map(value=>({value,severity:'warning'}))];
  if(alerts.length){
    const lead=document.createElement('strong');lead.textContent=(review?.blockers||[]).length?'Revise antes de finalizar:':'Pontos para conferir:';
    reviewPanel.appendChild(lead);
    const ul=document.createElement('ul');
    alerts.forEach(item=>{const li=document.createElement('li');li.textContent=item.value;li.dataset.severity=item.severity;ul.appendChild(li)});
    reviewPanel.appendChild(ul);
  }else{reviewPanel.classList.add('is-clean');reviewPanel.textContent='Documento sem pendências detectadas pelo verificador de preenchimento.'}
  const fallback=document.createElement('p');fallback.className='rf-preview-fallback';
  if(!nativeFilePreview){
    const frame=document.createElement('iframe');
    frame.dataset.rfPreviewFrame='1';frame.className='rf-preview-frame';frame.title='PDF do encaminhamento';
    frame.src=url;
    container.append(header,reviewPanel,frame);
    fallback.textContent='Caso o PDF não apareça no navegador, use “Baixar prévia”.';
  }else{
    // iOS opens blob: iframes in an external PDF viewer and displays the page's
    // technical host. Share the exact file on a user tap without navigating.
    container.append(header,reviewPanel);
    fallback.textContent='No iPhone, toque em “Visualizar ou salvar PDF” para abrir o documento e escolher Salvar em Arquivos.';
  }
  container.append(fallback);
  panel.appendChild(container);
  let closed=false;
  const close=()=>{
    if(closed)return;
    closed=true;container.remove();if(url)URL.revokeObjectURL(url);
    panel.querySelector('[data-rf-preview]')?.focus();
  };
  closeButton.addEventListener('click',close);
  download.addEventListener('click',()=>{
    if(!nativeFilePreview){downloadPdf(pdf,fileName);return}
    sharePdf(pdf,fileName,'Prévia do encaminhamento').catch(error=>{
      if(error?.name!=='AbortError')fallback.textContent='Não foi possível abrir o PDF. Tente novamente.';
    });
  });
  container.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close()}});
  closeButton.focus();
  return {close,container,url};
}
