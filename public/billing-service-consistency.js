const BILLING_DRAFT_KEY='debora-billing-v2-draft';
const BILLING_OVERRIDE_KEY='debora-billing-service-override-v1';

export function billingScopeMatches(record,{motherId='',appointmentId=''}={}){
  if(!record||record.motherId!==motherId)return false;
  return String(record.appointmentId||'')===String(appointmentId||'');
}

export function shouldFollowBillingService({appointmentId='',previousAppointmentId='',sameMotherContext=false,overridden=false}={}){
  if(overridden)return false;
  if(!appointmentId)return true;
  return sameMotherContext&&previousAppointmentId===''&&appointmentId!=='';
}

const browser=typeof window!=='undefined'&&typeof document!=='undefined';
if(browser){
  let timer=null;
  let lastContext={motherId:'',appointmentId:''};

  function readJson(key){try{return JSON.parse(sessionStorage.getItem(key)||'null')}catch{return null}}
  function writeJson(key,value){try{sessionStorage.setItem(key,JSON.stringify(value))}catch{}}
  function remove(key){try{sessionStorage.removeItem(key)}catch{}}
  function context(){return{
    motherId:document.querySelector('[data-appointment-patient]')?.value||'',
    appointmentId:window.DeboraEncounter?.getAppointmentId?.()||''
  }}
  function appointmentType(){return document.querySelector('[data-encounter-choice][data-field="appointmentType"][aria-pressed="true"]')?.dataset.value||''}
  function serviceSelect(){return document.querySelector('[data-bv-service]')}
  function optionExists(select,value){return Boolean(select&&[...select.options].some(option=>option.value===value))}

  function migrateOverride(record,ctx){
    if(!record||record.motherId!==ctx.motherId)return null;
    if(billingScopeMatches(record,ctx))return record;
    const sameLiveTransition=lastContext.motherId===ctx.motherId&&lastContext.appointmentId===''&&ctx.appointmentId!=='';
    if(sameLiveTransition&&String(record.appointmentId||'')===''){
      const migrated={...record,appointmentId:ctx.appointmentId,at:Date.now()};
      writeJson(BILLING_OVERRIDE_KEY,migrated);
      return migrated;
    }
    return null;
  }

  function currentOverride(ctx=context()){
    const explicit=migrateOverride(readJson(BILLING_OVERRIDE_KEY),ctx);
    if(explicit)return explicit;
    const draft=readJson(BILLING_DRAFT_KEY);
    if(billingScopeMatches(draft,ctx)&&draft.serviceOverridden===true){
      const restored={motherId:ctx.motherId,appointmentId:ctx.appointmentId||null,serviceLabel:draft.serviceLabel||'',at:Date.now()};
      writeJson(BILLING_OVERRIDE_KEY,restored);
      return restored;
    }
    return null;
  }

  function mergeDraft(ctx,patch){
    const current=readJson(BILLING_DRAFT_KEY);
    const base=billingScopeMatches(current,ctx)?current:{motherId:ctx.motherId,appointmentId:ctx.appointmentId||null};
    writeJson(BILLING_DRAFT_KEY,{...base,...patch,motherId:ctx.motherId,appointmentId:ctx.appointmentId||null,at:Date.now()});
  }

  function markManualOverride(select){
    const ctx=context();
    if(!ctx.motherId||!select)return;
    const record={motherId:ctx.motherId,appointmentId:ctx.appointmentId||null,serviceLabel:select.value||'',at:Date.now()};
    writeJson(BILLING_OVERRIDE_KEY,record);
    mergeDraft(ctx,{serviceLabel:record.serviceLabel,serviceOverridden:true});
    lastContext=ctx;
  }

  function clearOverride(){remove(BILLING_OVERRIDE_KEY)}
  function clearWhenOutsideAppointment(){
    if(String(location.hash||'').startsWith('#/appointment'))return false;
    clearOverride();
    lastContext={motherId:'',appointmentId:''};
    return true;
  }

  function sync(){
    if(clearWhenOutsideAppointment())return;
    const ctx=context();
    const select=serviceSelect();
    if(!ctx.motherId||!select){lastContext=ctx;return}
    const override=currentOverride(ctx);
    const sameMotherContext=lastContext.motherId===ctx.motherId&&Boolean(ctx.motherId);
    const previousAppointmentId=sameMotherContext?lastContext.appointmentId:'';
    if(override){
      if(optionExists(select,override.serviceLabel)&&select.value!==override.serviceLabel)select.value=override.serviceLabel;
      mergeDraft(ctx,{serviceLabel:override.serviceLabel||select.value,serviceOverridden:true});
      lastContext=ctx;
      return;
    }
    if(shouldFollowBillingService({appointmentId:ctx.appointmentId,previousAppointmentId,sameMotherContext,overridden:false})){
      const wanted=appointmentType();
      if(optionExists(select,wanted)){
        select.value=wanted;
        mergeDraft(ctx,{serviceLabel:wanted,serviceOverridden:false});
      }
    }
    lastContext=ctx;
  }

  function schedule(){
    if(timer!==null)return;
    timer=setTimeout(()=>{timer=null;sync()},0);
  }

  document.addEventListener('change',event=>{
    if(event.target?.matches?.('[data-bv-service]'))markManualOverride(event.target);
    else if(event.target?.matches?.('[data-appointment-patient]'))schedule();
  });
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-wizard-close]'))clearOverride();
    if(event.target?.closest?.('[data-encounter-choice][data-field="appointmentType"]'))schedule();
  });
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
  window.addEventListener('hashchange',schedule);
  window.addEventListener('focus',schedule);
  schedule();
}
