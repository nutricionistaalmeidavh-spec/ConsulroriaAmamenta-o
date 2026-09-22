import './weight-evolution-v5.js';

const RG_PATIENT=/^#\/patient\/(?!form(?:\/|$))([^/?#]+)(?:[/?#]|$)/i;
let rgTimer;

function rgApply(){
  const hash=String(location.hash||'');
  const patientRoute=/^#\/patient\/(?!form(?:\/|$))/i.test(hash);
  const mid=hash.match(RG_PATIENT)?.[1]||'';

  document.querySelectorAll('[data-cn-history]').forEach(node=>{
    if(!patientRoute||mid&&node.getAttribute('data-cn-patient')!==mid)node.remove();
  });
  document.querySelectorAll('[data-pf-prontuario]').forEach(node=>{
    if(!patientRoute||mid&&node.getAttribute('data-pf-patient')!==mid)node.remove();
  });

  // Do not delete patient-owned growth cards while a patient route is resolving.
  // The previous UUID-only matcher treated valid migrated/demo IDs as "not a patient"
  // and removed the weight evolution card after it had mounted.
  if(!patientRoute){
    document.querySelectorAll('[data-growth],[data-growth-inline],[data-growth-inline-v3],[data-weight-variation],[data-weight-variation-v3],[data-weight-changes-v4],[data-baby-sex-row],[data-baby-sex-row-v3]').forEach(node=>node.remove());
  }
}

function rgSchedule(){clearTimeout(rgTimer);rgTimer=setTimeout(rgApply,40)}
new MutationObserver(rgSchedule).observe(document,{subtree:true,childList:true});
window.addEventListener('hashchange',()=>{rgApply();setTimeout(rgApply,120);setTimeout(rgApply,500)});
rgApply();
