// Injected into the canonical clinical-note runtime by the recovery enhancer.
// A version mismatch is NOT permission to force-write: compare the D1 note first.
export const CLINICAL_CONFLICT_RUNTIME = String.raw`
let cnConflictBusy=false, cnConflictPending=null, cnRebaseAttempts=0;
function cnIsVersionConflict(error){
  return Number(error?.status)===409 ||
    /stale_record_version|record_version_required|prontuário foi alterado|recarregue o prontuário|conflito de versão/i.test(String(error?.message||''));
}
function cnScheduleRetry(error){
  clearTimeout(cnRetryTimer);
  if(cnIsVersionConflict(error)){
    cnResolveVersionConflict().catch(()=>{
      cnStatus('Não foi possível verificar a versão atual. Seu texto está preservado neste dispositivo; tente novamente quando houver conexão.','error');
    });
    return;
  }
  if(error?.status&&error.status<500&&error.status!==429)return;
  const delay=cnRetryDelay;
  cnRetryDelay=Math.min(cnRetryDelay*2,30000);
  cnRetryTimer=setTimeout(()=>{if(cnState.pendingBody&&!cnConflictPending)cnDrainSaves().catch(()=>{})},delay);
}
async function cnResolveVersionConflict(){
  if(cnConflictBusy||cnConflictPending)return;
  const enc=cnState.encounter, ta=document.querySelector('#cn-note');
  if(!enc?.id||!ta)return;
  cnConflictBusy=true;
  cnStatus('Verificando a versão atual do prontuário…','saving');
  try{
    const rows=await cnRest('clinical_encounters?id=eq.'+encodeURIComponent(enc.id)+
      '&select=id,status,clinical_note,record_version,updated_at&limit=1');
    const remote=rows?.[0];
    if(!remote?.id||remote.id!==enc.id)throw new Error('Prontuário não encontrado para reconciliação.');
    const serverText=String(remote.clinical_note||'');
    const localText=String(cnState.pendingBody?.body??ta.value??'');
    // Only an unrelated D1 field changed. Refresh expected version, never overwrite a note that changed.
    if(serverText===String(enc.clinical_note||'')&&cnRebaseAttempts<2){
      cnState.encounter={...enc,...remote};
      await window.DeboraEncounter?.syncVersion?.(enc.id);
      cnRebaseAttempts++;
      cnStatus('Versão atualizada; tentando sincronizar novamente…','muted');
      cnRetryTimer=setTimeout(()=>{if(cnState.pendingBody)cnDrainSaves().catch(()=>{})},100);
      return;
    }
    if(serverText===localText){
      cnState.encounter={...enc,...remote};
      if(String(cnState.pendingBody?.body??'')===serverText)cnState.pendingBody=null;
      cnRebaseAttempts=0;
      await cnDraftRemove(enc.id,serverText).catch(()=>{});
      cnStatus('Texto já sincronizado com o banco','saved');
      return;
    }
    // Both notes may contain clinical facts. Keep the current D1 version untouched until explicit review.
    cnConflictPending={encounterId:enc.id,server:remote};
    clearTimeout(cnState.saveTimer);
    ta.readOnly=true;
    document.querySelector('#cn-conflict-banner')?.remove();
    const banner=document.createElement('section');
    banner.id='cn-conflict-banner';
    banner.setAttribute('role','alert');
    banner.style.cssText='padding:12px;border:1px solid #b49a65;border-radius:10px;margin:10px 0;background:#fff9e8';
    banner.innerHTML='<strong>Este prontuário foi atualizado em outra sessão.</strong>'+
      '<p>Seu texto continua no campo acima e na recuperação local. Compare antes de salvar; nenhuma versão será apagada automaticamente.</p>'+
      '<details open><summary>Ver texto atual salvo no banco</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:230px;overflow:auto">'+
      cnE(serverText)+'</pre></details>'+
      '<p>Você pode copiar informações do banco para seu texto antes de decidir.</p>'+
      '<button type="button" data-cn-merge>Editar e mesclar meu texto</button> '+
      '<button type="button" data-cn-save-merged>Salvar meu texto revisado</button> '+
      '<button type="button" data-cn-use-server>Descartar meu texto e usar o banco</button>';
    ta.insertAdjacentElement('afterend',banner);
    banner.querySelector('[data-cn-merge]').onclick=()=>{
      ta.readOnly=false;ta.focus();
      cnStatus('Compare as versões e revise seu texto antes de salvar.','muted');
    };
    banner.querySelector('[data-cn-save-merged]').onclick=()=>{
      // The user explicitly authorizes saving against the version they just reviewed.
      cnState.encounter={...enc,...remote};
      cnConflictPending=null;cnRebaseAttempts=0;
      ta.readOnly=false;banner.remove();
      cnScheduleSave(ta.value);
    };
    banner.querySelector('[data-cn-use-server]').onclick=async()=>{
      const discarded=String(ta.value);
      cnState.encounter={...enc,...remote};
      cnState.pendingBody=null;cnConflictPending=null;cnRebaseAttempts=0;
      ta.value=serverText;ta.readOnly=false;banner.remove();
      await cnDraftRemove(enc.id,discarded).catch(()=>{});
      cnStatus('Versão do banco mantida','saved');
    };
    cnStatus('Conflito identificado. Revise as duas versões antes de continuar.','error');
  }finally{cnConflictBusy=false}
}
`;
