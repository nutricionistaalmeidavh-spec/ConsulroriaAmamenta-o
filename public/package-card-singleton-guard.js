const pcgState=globalThis.__deboraPackageCardGuardState||(globalThis.__deboraPackageCardGuardState={scheduled:false,observer:null,listenersBound:false});

function currentMotherId(){
  const match=String(location.hash||'').match(/^#\/patient\/(?!form(?:\/|$))([^/?#]+)(?:[/?#]|$)/i);
  return match?decodeURIComponent(match[1]):'';
}

function patientScreen(){
  const screens=[...document.querySelectorAll('[data-screen="patient"]')];
  return screens.find(screen=>!screen.hidden)||screens[0]||null;
}

function collapsePackageCards(){
  const hosts=[...document.querySelectorAll('[data-bv-patient-plan]')].filter(node=>node?.isConnected!==false);
  if(hosts.length<=1)return hosts[0]||null;
  const motherId=currentMotherId();
  const screen=patientScreen();
  const inside=screen?hosts.filter(node=>screen.contains(node)):[];
  const keeper=inside.find(node=>node.dataset.motherId===motherId)
    ||hosts.find(node=>node.dataset.motherId===motherId)
    ||inside[0]
    ||hosts[0];
  hosts.forEach(node=>{if(node!==keeper)node.remove()});
  return keeper;
}

function scheduleCollapse(){
  if(pcgState.scheduled)return;
  pcgState.scheduled=true;
  const run=()=>{
    pcgState.scheduled=false;
    collapsePackageCards();
  };
  if(typeof queueMicrotask==='function')queueMicrotask(run);else Promise.resolve().then(run);
}

if(!pcgState.observer){
  pcgState.observer=new MutationObserver(scheduleCollapse);
  pcgState.observer.observe(document,{subtree:true,childList:true});
}
if(!pcgState.listenersBound){
  pcgState.listenersBound=true;
  window.addEventListener('hashchange',scheduleCollapse);
  window.addEventListener('focus',scheduleCollapse);
  window.addEventListener('debora:patient-context',scheduleCollapse);
}
scheduleCollapse();

window.DeboraPackageCardGuard={collapse:collapsePackageCards,schedule:scheduleCollapse};
