let pcgScheduled=false;
let pcgEnsureTimer=null;
let pcgRemounting=false;

function currentMotherId(){
  const match=String(location.hash||'').match(/^#\/patient\/([^/]+)/);
  return match?decodeURIComponent(match[1]):'';
}

function currentPatientScreen(){
  const screens=[...document.querySelectorAll('[data-screen="patient"]')];
  return screens.find(node=>node.isConnected!==false&&!node.hidden)
    ||screens.find(node=>node.isConnected!==false)
    ||null;
}

function planHosts(){
  return [...document.querySelectorAll('[data-bv-patient-plan]')];
}

function collapsePackageCards(){
  const motherId=currentMotherId();
  const screen=currentPatientScreen();
  const hosts=planHosts();
  if(!motherId||!screen){
    hosts.forEach(node=>node.remove());
    return null;
  }

  const scoped=[...screen.querySelectorAll('[data-bv-patient-plan]')];
  const keeper=scoped.find(node=>node.dataset.motherId===motherId)||scoped[0]||null;
  hosts.forEach(node=>{if(node!==keeper)node.remove()});

  const cards=[...document.querySelectorAll('.bv-plan-card')];
  if(keeper){
    let keptCard=null;
    cards.forEach(card=>{
      const owner=card.closest?.('[data-bv-patient-plan]')||null;
      if(owner!==keeper){card.remove();return}
      if(!keptCard)keptCard=card;
      else card.remove();
    });
  }else{
    cards.forEach(card=>card.remove());
  }
  return keeper;
}

function currentPlanCard(){
  const screen=currentPatientScreen();
  if(!screen)return null;
  return screen.querySelector('[data-bv-patient-plan] .bv-plan-card');
}

function ensurePackageCard(){
  clearTimeout(pcgEnsureTimer);
  if(!currentMotherId()||!currentPatientScreen()||currentPlanCard()||pcgRemounting)return;
  pcgEnsureTimer=setTimeout(async()=>{
    if(!currentMotherId()||!currentPatientScreen()||currentPlanCard()||pcgRemounting)return;
    const remount=window.DeboraBilling?.remountPlan;
    if(typeof remount!=='function')return;
    pcgRemounting=true;
    try{
      await remount();
    }catch(error){
      console.warn('Package card remount',error);
    }finally{
      pcgRemounting=false;
      collapsePackageCards();
      if(!currentPlanCard())ensurePackageCard();
    }
  },220);
}

function reconcilePackageCard(){
  collapsePackageCards();
  ensurePackageCard();
}

function scheduleCollapse(){
  if(pcgScheduled)return;
  pcgScheduled=true;
  queueMicrotask(()=>{
    pcgScheduled=false;
    reconcilePackageCard();
  });
}

new MutationObserver(scheduleCollapse).observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('hashchange',scheduleCollapse);
window.addEventListener('focus',scheduleCollapse);
scheduleCollapse();

window.DeboraPackageCardGuard={collapse:collapsePackageCards,reconcile:reconcilePackageCard};
