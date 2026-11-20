export const SIGNATURE_TERM_TYPES=Object.freeze(['data_processing','whatsapp','clinical_media','public_media','teleconsultation']);
export const SIGNATURE_REQUEST_STATUSES=Object.freeze({
  draft:'Documento preparado',sending:'Enviando',sent:'Aguardando assinatura da mãe',
  delivery_failed:'Falha no envio',signing_mother:'Registrando assinatura',
  mother_signed:'Aguardando assinatura da consultora',signing_consultant:'Finalizando',
  completed:'Concluído',expired:'Expirado',cancelled:'Cancelado',
});
export function getSignatureSelections(values){
  const known=new Set(SIGNATURE_TERM_TYPES);
  return [...new Set(Array.isArray(values)?values:[])].filter(value=>known.has(value));
}
export function patientConsentSnapshot(values={}){
  return {data_processing:Boolean(values.data_processing),whatsapp:Boolean(values.whatsapp),
    clinical_media:Boolean(values.clinical_media),public_media:Boolean(values.public_media)};
}
export function validMotherEmail(value){
  const v=String(value||'').trim().toLowerCase();
  return v.length>0&&v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
