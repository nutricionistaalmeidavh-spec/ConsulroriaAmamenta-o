import {downloadPdf,openPdfInNewTab} from './document-pdf-service.js';
/**
 * Document preview uses the exact Blob returned by the official PDF renderer.
 * It does not persist, finalize, alter authoring HTML, or send medical data away.
 */
function isIOSWebKit(){
  const agent=String(globalThis.navigator?.userAgent||'');
  return /iPhone|iPad|iPod/i.test(agent)||(globalThis.navigator?.platform==='MacIntel'&&globalThis.navigator?.maxTouchPoints>1);
}
export function openReferralPreview({panel,pdf,fileName='encaminhamento-previa'}={}){
  if(!panel||!pdf)return null;
  panel.querySelectorAll('[data-rf-preview-layer]').forEach(node=>node.remove());
  const container=document.createElement('div');
  container.className='rf-preview-layer';
  container.dataset.rfPreviewLayer='1';
  container.setAttribute('role','dialog');
  container.setAttribute('aria-modal','true');
  container.setAttribute('aria-label','Pré-visualização do encaminhamento');
  const ios=isIOSWebKit();
  const url=ios?null:URL.createObjectURL(pdf);
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
  download.type='button';download.dataset.rfPreviewDownload='1';download.textContent='Baixar prévia';
  controls.append(download,closeButton);
  header.append(title,controls);
  const frame=document.createElement('iframe');
  frame.dataset.rfPreviewFrame='1';frame.className='rf-preview-frame';frame.title='PDF do encaminhamento';
  if(!ios)frame.src=url;
  else{frame.hidden=true;download.textContent='Abrir prévia em outra aba';}
  const fallback=document.createElement('p');fallback.className='rf-preview-fallback';
  fallback.textContent=ios
    ?'No iPhone, o PDF será aberto em uma aba separada para manter o prontuário nesta sessão.'
    :'Caso o PDF não apareça no navegador, use “Baixar prévia”.';
  container.append(header,frame,fallback);
  panel.appendChild(container);
  let closed=false;
  const close=()=>{
    if(closed)return;
    closed=true;container.remove();if(url)URL.revokeObjectURL(url);
    panel.querySelector('[data-rf-preview]')?.focus();
  };
  closeButton.addEventListener('click',close);
  download.addEventListener('click',()=>{
    try{ios?openPdfInNewTab(pdf):downloadPdf(pdf,fileName)}
    catch(error){fallback.textContent=error.message||'Não foi possível abrir o PDF.'}
  });
  container.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close()}});
  closeButton.focus();
  return {close,container,url};
}
