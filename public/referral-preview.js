import {downloadPdf,sharePdf} from './document-pdf-service.js';
import {isIosPdfViewer} from './referral-ios-pdf.js';
/**
 * The preview uses the official PDF Blob without saving or modifying clinical data.
 * On iOS it uses native file sharing, not a PDF blob iframe.
 */
export function openReferralPreview({panel,pdf,fileName='encaminhamento-previa'}={}){
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
  const title=document.createElement('div');title.className='rf-preview-title';
  const h=document.createElement('h2');h.textContent='Pré-visualização do PDF';
  const p=document.createElement('p');p.textContent='Esta é a versão que será exportada; a prévia não salva nem finaliza o documento.';
  title.append(h,p);
  const controls=document.createElement('div');controls.className='rf-preview-actions';
  const closeButton=document.createElement('button');
  closeButton.type='button';closeButton.dataset.rfPreviewClose='1';closeButton.textContent='Voltar ao editor';
  const download=document.createElement('button');
  download.type='button';download.dataset.rfPreviewDownload='1';
  download.textContent=nativeFilePreview?'Visualizar ou salvar PDF':'Baixar prévia';
  controls.append(download,closeButton);header.append(title,controls);
  const fallback=document.createElement('p');fallback.className='rf-preview-fallback';
  if(!nativeFilePreview){
    const frame=document.createElement('iframe');
    frame.dataset.rfPreviewFrame='1';frame.className='rf-preview-frame';frame.title='PDF do encaminhamento';
    frame.src=url;container.append(header,frame);
    fallback.textContent='Caso o PDF não apareça no navegador, use “Baixar prévia”.';
  }else{
    container.append(header);
    fallback.textContent='No iPhone, toque em “Visualizar ou salvar PDF” para compartilhar o documento sem sair do prontuário.';
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
    sharePdf(pdf,fileName,'Prévia do encaminhamento',{preserveAppTab:true}).catch(error=>{
      if(error?.name!=='AbortError')fallback.textContent='Não foi possível abrir o PDF. Tente novamente.';
    });
  });
  container.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close()}});
  closeButton.focus();
  return {close,container,url};
}
