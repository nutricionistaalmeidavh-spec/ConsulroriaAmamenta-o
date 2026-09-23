let phase35Started=false;
function css(href,key){if(document.querySelector(`link[data-${key}]`))return;const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.setAttribute(`data-${key}`,'1');document.head.appendChild(link)}
export async function startPhase35(){
  if(phase35Started)return;
  if(!window.DeboraDocuments||!document.querySelector('[data-app-root]')){setTimeout(startPhase35,90);return}
  phase35Started=true;
  try{
    css('/album-feature.css','phase35-album');
    css('/referrals-feature.css','phase35-referrals');
    await import('./album-feature.js');
    await import('./referrals-feature.js');
  }catch(error){phase35Started=false;console.error('Falha ao carregar fases clínicas 3-5',error);setTimeout(startPhase35,900)}
}
startPhase35();
