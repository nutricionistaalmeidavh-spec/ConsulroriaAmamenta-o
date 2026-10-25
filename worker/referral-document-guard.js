/**
 * Immutable finalized referral guard at the D1 mutation boundary.
 * Kept independent of browser code; only applies to clinical_documents referral.
 */
export function isFrozenReferral(record){
 return !!(record&&record.document_type==='referral'&&record.status==='finalized');
}
export function validateReferralMutation({record,method='PATCH'}={}){
 if(isFrozenReferral(record)&&['PATCH','DELETE','UPSERT','POST'].includes(String(method).toUpperCase())){
  return {allowed:false,status:409,error:'referral_document_finalized_immutable',
    message:'Encaminhamento finalizado. Para corrigir, crie outro documento sem alterar o original.'};
 }
 return {allowed:true};
}
