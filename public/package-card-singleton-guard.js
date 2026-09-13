let pcgScheduled=false;

function currentMotherId(){
  const match=String(location.hash||'').match(/^#\/patient\/([^/]+)/);
  return match?decodeURIComponent(match[1]):'';
}

function collapsePackageCards(){
  const screen=document.querySelector('[data-screen="patient"]');
  if(!screen)return;
  const hosts=[...screen.querySelectorAll('[data-bv-patient-plan]')];
  if(hosts.length<=1)return;
  const motherId=currentMotherId();
  const keeper=hosts.find(node=>node.dataset.motherId===motherId)||hosts[0];
  hosts.forEach(node=>{if(node!==keeper)node.remove()});
}

function scheduleCollapse(){
  if(pcgScheduled)return;
  pcgScheduled=true;
  queueMicrotask(()=>{
    pcgScheduled=false;
    collapsePackageCards();
  });
}

const root=document.querySelector('[data-app-root]')||document.documentElement;
new MutationObserver(scheduleCollapse).observe(root,{subtree:true,childList:true});
window.addEventListener('hashchange',scheduleCollapse);
window.addEventListener('focus',scheduleCollapse);
scheduleCollapse();

window.DeboraPackageCardGuard={collapse:collapsePackageCards};
