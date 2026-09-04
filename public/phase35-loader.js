let phase35Started=false;
function css(href,key){if(document.querySelector(`link[data-${key}]`))return;const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.setAttribute(`data-${key}`,'1');document.head.appendChild(link)}
async function start(){
  if(phase35Started)return;
  if(!window.DeboraDocuments||!document.querySelector('[data-app-root]')){setTimeout(start,90);return}
  phase35Started=true;
  try{
    css('./album-feature.css','phase35-album');
    css('./referrals-feature.css','phase35-referrals');
    await import('./album-feature.js');
    await import('./referrals-feature.js');
  }catch(error){phase35Started=false;console.error('Falha ao carregar fases clínicas 3-5',error);setTimeout(start,900)}
}
start();
