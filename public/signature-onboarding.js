import { getConsultantConsentDocument } from './consultant-consent-content.js';
import { getSignatureSelections, SIGNATURE_REQUEST_STATUSES, validMotherEmail } from './signature-onboarding-core.js';

const DOC=window.DeboraDocuments;
const form=document.querySelector('[data-patient-form]');
const panel=form?.querySelector('[data-consent-panel]');
let pendingSelection=[];
let pendingReviewed=false;
const selected=()=>getSignatureSelections([...panel?.querySelectorAll('[data-signature-select]:checked')||[]].map(x=>x.dataset.signatureSelect));
const emailField=()=>form?.elements.namedItem('motherEmail');
const statusNode=()=>panel?.querySelector('[data-signature-onboarding-status]');
function status(message,error=false){
  const target=statusNode();
  if(target){target.textContent=message;target.dataset.error=error?'true':'false'}
}
function refreshCount(){
  const count=selected().length;
  const target=panel?.querySelector('[data-signature-selection-summary]');
  if(target)target.textContent=count?count+' documento(s) selecionado(s) para solicitar assinatura após salvar.':'Nenhum documento selecionado para envio.';
  const field=emailField();
  if(field){field.required=count>0;field.setCustomValidity('')}
  const reviewed=Boolean(panel?.querySelector('[data-signature-reviewed]')?.checked);
  for(const button of form.querySelectorAll('[type=submit]')){
    if(!button.dataset.signatureInitialText)button.dataset.signatureInitialText=button.textContent;
    button.textContent=count?(reviewed?'Salvar paciente e enviar termos':'Salvar paciente e preparar termos'):button.dataset.signatureInitialText;
  }
}
async function request(path,method='GET',body=null,raw=false){
  const token=DOC.accessToken();
  if(!token)throw Error('Sua sessão expirou. Entre novamente.');
  const response=await fetch('/api/clinical/signatures/requests'+path,{
    method,headers:{authorization:'Bearer '+token,...(raw?{'content-type':'application/pdf','x-document-reviewed':'true'}:body?{'content-type':'application/json'}:{})},
    ...(body!=null?{body:raw?body:JSON.stringify(body)}:{}),cache:'no-store'
  });
  if(!response.ok){
    const data=await response.json().catch(()=>({}));
    const error=new Error(data.message||data.error||'Erro ao preparar assinatura.');
    error.code=data.error;error.status=response.status;throw error;
  }
  return response.json();
}
function showTerms(type){
  const doc=getConsultantConsentDocument(type);
  if(!doc?.sections?.length){status('Modelo documental indisponível.',true);return}
  const layer=document.createElement('div');layer.className='signature-preview-layer';
  const sheet=document.createElement('section');sheet.className='signature-preview-sheet';
  sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');
  sheet.setAttribute('aria-label',doc.title);
  const heading=document.createElement('h2');heading.textContent=doc.title;sheet.append(heading);
  const version=document.createElement('p');version.textContent='Modelo informativo v'+doc.modelVersion+' — a assinatura será solicitada somente após salvar a paciente.';sheet.append(version);
  for(const section of doc.sections){
    const heading=document.createElement('h3');heading.textContent=section.title;sheet.append(heading);
    const body=document.createElement('p');body.textContent=section.body;sheet.append(body);
  }
  const close=document.createElement('button');close.type='button';close.textContent='Fechar';close.className='ui-button ui-button-primary';
  const dismiss=()=>{layer.remove();form?.querySelector('[data-signature-read="'+type+'"]')?.focus()};
  close.addEventListener('click',dismiss);sheet.prepend(close);
  layer.addEventListener('click',e=>{if(e.target===layer)dismiss()});
  layer.addEventListener('keydown',e=>{if(e.key==='Escape')dismiss()});
  layer.append(sheet);document.body.append(layer);close.focus();
}
async function prepareOne(mother,type,reviewed){
  const existing=await request('', 'POST',{mother_id:mother.id,consent_type:type});
  if(!reviewed)return {type,state:'draft',note:'Aguardando conferência do termo pela consultora'};
  if(!existing.document_frozen){
    const model=getConsultantConsentDocument(type);
    if(!model?.sections?.length)throw Error('O texto integral desse documento não está disponível.');
    // Server renders the approved full document from the canonical legal model.
    const response=await request('/'+existing.id+'/document','POST',{reviewed:true});
    if(response.status!=='frozen'&&response.version!==1)throw Error('Não foi possível preparar o PDF.');
  }
  try{
    const sent=await request('/'+existing.id+'/send','POST',{});
    return {type,state:sent.status};
  }catch(error){
    // A missing rollout flag must never be reported as a sent email.
    if(error.code==='signature_signing_not_ready')return {type,state:'draft',note:'Envio aguardando homologação'};
    if(error.code==='signature_sender_not_configured')return {type,state:'draft',note:'Remetente institucional não configurado'};
    if(error.code==='signature_origin_not_configured'||error.code==='signature_origin_invalid')return {type,state:'draft',note:'Domínio de assinatura aguardando homologação'};
    throw error;
  }
}
async function prepareSavedMother(motherId,types,reviewed){
  if(!types.length)return;
  let mother;
  try{
    const context=await DOC.patientContext(motherId);
    mother=context?.mother;
    if(!mother?.id||!validMotherEmail(mother.email))throw Error('O e-mail da mãe não foi salvo corretamente.');
  }catch(e){DOC.toast('Paciente salvo, mas a preparação das assinaturas falhou: '+e.message,'error');return}
  const results=[];
  for(const type of types){
    try{results.push(await prepareOne(mother,type,reviewed))}
    catch(e){results.push({type,state:'error',note:e.message})}
  }
  const delivered=results.filter(x=>x.state==='sent').length;
  const prepared=results.filter(x=>x.state==='draft').length;
  const failed=results.filter(x=>x.state==='error').length;
  let summary=delivered+' enviado(s), '+prepared+' preparado(s)'+(failed?', '+failed+' com erro':'')+'.';
  if(!delivered&&prepared)summary='Paciente salvo. Solicitações preparadas; envio ainda não liberado.';
  DOC.toast(summary,failed?'error':'info');
  status(summary,failed>0);
  await updatePatientStatuses(motherId);
}
async function updatePatientStatuses(motherId){
  if(!motherId)return;
  let requests;
  try{requests=(await request('?mother_id='+encodeURIComponent(motherId))).requests||[]}
  catch{return}
  const details=document.querySelector('[data-df-terms-card]');
  if(!details)return;
  for(const button of details.querySelectorAll('[data-df-term]')){
    const row=requests.find(item=>item.consent_type===button.dataset.dfTerm);
    let el=button.querySelector('[data-signature-live-status]');
    if(!row){el?.remove();continue}
    if(!el){el=document.createElement('small');el.dataset.signatureLiveStatus='1';button.querySelector('div')?.append(el)}
    el.textContent='Assinatura: '+(SIGNATURE_REQUEST_STATUSES[row.status]||row.status);
  }
}
if(panel&&form){
  panel.addEventListener('change',event=>{if(event.target.matches('[data-signature-select],[data-signature-reviewed]'))refreshCount()});
  panel.addEventListener('click',event=>{const button=event.target.closest('[data-signature-read]');if(button)showTerms(button.dataset.signatureRead)});
  form.addEventListener('submit',event=>{
    // Runs before the canonical form submit handler. Does not alter its consent payload.
    if(event.defaultPrevented||form.querySelector('[type="submit"]:disabled'))return;
    const chosen=selected(),mail=String(emailField()?.value||'').trim();
    if(chosen.length&&!validMotherEmail(mail)){
      event.preventDefault();event.stopImmediatePropagation();
      status('Informe um e-mail válido da mãe para enviar os documentos.',true);
      emailField()?.focus();return;
    }
    pendingSelection=chosen;
    pendingReviewed=Boolean(panel.querySelector('[data-signature-reviewed]')?.checked);
  },true);
  window.addEventListener('debora:patient-form-open',event=>{
    pendingSelection=[];pendingReviewed=false;
    panel.querySelectorAll('[data-signature-select],[data-signature-reviewed]').forEach(input=>{input.checked=false});
    const legacy=panel.querySelector('[data-legacy-consents]');
    if(legacy){legacy.hidden=false;legacy.open=false} // Prior consents stay accessible, collapsed by default.
    status('');refreshCount();
    if(event.detail?.motherId)updatePatientStatuses(event.detail.motherId);
  });
  window.addEventListener('debora:patient-saved',event=>{
    const toSend=pendingSelection,reviewed=pendingReviewed;
    pendingSelection=[];pendingReviewed=false;
    if(toSend.length&&event.detail?.motherId)void prepareSavedMother(event.detail.motherId,toSend,reviewed);
  });
  window.addEventListener('debora:terms-mounted',event=>{if(event.detail?.motherId)void updatePatientStatuses(event.detail.motherId)});
  refreshCount();
}
