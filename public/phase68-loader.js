let phase68Started=false;
function css(href,key){if(document.querySelector(`link[data-${key}]`))return;const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.setAttribute(`data-${key}`,'1');document.head.appendChild(link)}
async function start(){
  if(phase68Started)return;
  if(!window.DeboraDocuments||!window.DeboraReferrals||!window.DeboraAlbum||!document.querySelector('[data-app-root]')){setTimeout(start,100);return}
  phase68Started=true;
  try{
    css('./record-export-feature.css','phase68-export');
    css('./patient-records-hub.css','phase68-hub');
    css('./patient-workspace.css','phase68-workspace');
    await import('./referral-finalization.js');
    await import('./record-export-feature.js');
    await import('./patient-workspace.js');
    await import('./patient-records-hub.js');
  }catch(error){phase68Started=false;console.error('Falha ao carregar fases clínicas 6-8',error);setTimeout(start,1000)}
}
start();
