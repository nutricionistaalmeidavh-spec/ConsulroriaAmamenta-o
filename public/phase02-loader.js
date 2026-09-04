let phase02Started=false;
function ensureCss(){if(document.querySelector('link[data-phase02-docs]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href='./documents-feature.css';link.dataset.phase02Docs='1';document.head.appendChild(link)}
async function start(){
  if(phase02Started)return;
  if(!globalThis.DEBORA_APP_CONFIG||!document.querySelector('[data-app-root]')){setTimeout(start,80);return}
  phase02Started=true;
  try{
    ensureCss();
    await import('./documents-feature.js');
    await import('./terms-feature.js');
  }catch(error){phase02Started=false;console.error('Falha ao carregar documentos clínicos',error);setTimeout(start,800)}
}
start();
