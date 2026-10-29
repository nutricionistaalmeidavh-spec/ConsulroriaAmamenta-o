import {createConsentPdf} from './document-pdf-service.js';
import {getConsultantConsentDocument} from './consultant-consent-content.js';
import {createSignatureControl} from './signature-canvas.js';
const DOC=window.DeboraDocuments;
const text=v=>String(v??'').trim();
let current=null;
function auth(){const token=DOC.accessToken();if(!token)throw Error('Sua sessão expirou. Entre novamente.');return {'Authorization':'Bearer '+token}}
async function api(path,{method='GET',json=null,file=null}={}){
  const response=await fetch('/api/clinical/signatures/requests'+path,{method,headers:{
    ...auth(),...(json?{'content-type':'application/json'}:{}),...(file?{'content-type':'application/pdf','x-document-reviewed':'true'}:{})
  },...(json?{body:JSON.stringify(json)}:file?{body:file}:{}),cache:'no-store'});
  if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.message||({
    signature_signing_not_ready:'O envio ainda não está liberado. É necessário concluir a validação jurídica e habilitar o fluxo.',
    signature_document_already_frozen:'O documento já foi preparado e não pode ser substituído.',
    signature_frozen_document_required:'Anexe o PDF integral e conferido antes de enviar.',
    signature_mother_must_sign_first:'A assinatura da mãe ainda não foi concluída.',
    signature_name_mismatch:'O nome informado não corresponde ao cadastro.',
  }[error.error]||error.error||'Não foi possível concluir a operação.'))}
  return response.json();
}
const stateLabels={draft:'Em preparação',sent:'Aguardando a mãe',mother_signed:'Aguardando consultora',
  completed:'Concluído',delivery_failed:'Falha no envio',signing_mother:'Assinatura em processamento',signing_consultant:'Finalizando',cancelled:'Cancelado',expired:'Expirado'};
function close(){current?.remove();current=null}
function notice(message,error=false){const target=current?.querySelector('[data-ds-notice]');if(target){target.textContent=message;target.style.color=error?'#9b2345':'#564551'}}
async function latest(motherId,type){
  const rows=await api('?mother_id='+encodeURIComponent(motherId));
  return rows.requests.find(x=>x.consent_type===type)||null;
}
async function downloadPdf(id){
  const response=await fetch('/api/clinical/signatures/requests/'+encodeURIComponent(id)+'/document',{
    headers:auth(),cache:'no-store'});
  if(!response.ok)throw Error('Não foi possível acessar o PDF.');
  const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');
  a.href=url;a.download='documento-assinatura-'+id+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function render(motherId,type,title){
  if(!current)return;
  const body=current.querySelector('[data-ds-body]');
  body.replaceChildren();
  let item=await latest(motherId,type);
  const status=document.createElement('p');status.className='ds-consult-status';
  status.textContent=item?stateLabels[item.status]||item.status:'Nenhuma solicitação criada';body.append(status);
  const btn=(name,action)=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.className='df-secondary';b.addEventListener('click',async()=>{
    b.disabled=true;try{await action();if(current)await render(motherId,type,title)}catch(e){notice(e.message,true)}finally{b.disabled=false}});body.append(b);return b};
  if(!item){
    btn('Criar solicitação',async()=>{await api('',{method:'POST',json:{mother_id:motherId,consent_type:type}});notice('Solicitação criada.')});
    return;
  }
  if(item.status==='draft'||item.status==='delivery_failed'){
    if(!item.document_frozen){
      const wrap=document.createElement('div');wrap.className='ds-upload';
      wrap.innerHTML='<p>O termo utiliza o modelo integral e o layout PDF já usados no sistema.</p><label>PDF alternativo (opcional) <input type="file" accept="application/pdf,.pdf"></label><label><input type="checkbox" data-ds-reviewed> Conferi o texto integral e os dados deste documento antes do envio.</label>';
      body.append(wrap);
      let generated=null;
      const makePdf=async()=>{
        const context=await DOC.patientContext(motherId);
        const doc=getConsultantConsentDocument(type);
        if(!context?.mother||!doc?.sections?.length)throw Error('Não foi possível carregar o termo integral.');
        const consents=await DOC.consents(motherId);
        const consent=consents.find(x=>x.consent_type===type)||{};
        return createConsentPdf({motherName:context.mother.name,consentLabel:doc.title,
          statusLabel:consent.granted&&!consent.revoked_at?'Autorizado':'Não autorizado',
          acceptedAt:consent.accepted_at||'',revokedAt:consent.revoked_at||'',
          version:consent.version||'',evidence:consent.evidence||'',
          documentSections:doc.sections,modelVersion:doc.modelVersion});
      };
      btn('Visualizar termo integral',async()=>{
        generated=await makePdf();
        const url=URL.createObjectURL(generated);
        const w=window.open(url,'_blank','noopener,noreferrer');
        if(!w)throw Error('Permita a abertura de nova aba para revisar o PDF.');
        setTimeout(()=>URL.revokeObjectURL(url),60000);
      });
      btn('Preparar documento revisado',async()=>{
        if(!wrap.querySelector('[data-ds-reviewed]').checked)throw Error('Confirme que conferiu o PDF integral.');
        const file=wrap.querySelector('input[type=file]').files[0];
        const bytes=file||generated||await makePdf();
        if(bytes.size>4*1024*1024||bytes.size<64||(file&&!/\\.pdf$/i.test(file.name)&&file.type!=='application/pdf'))throw Error('Selecione um PDF válido até 4 MB.');
        const response=await fetch('/api/clinical/signatures/requests/'+item.id+'/document',{method:'POST',headers:{...auth(),'content-type':'application/pdf','x-document-reviewed':'true'},body:bytes,cache:'no-store'});
        if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||'Falha ao salvar PDF');}
        notice('PDF integral congelado para assinatura.');
      });
    }else{
      btn('Visualizar PDF preparado',()=>downloadPdf(item.id));
      btn('Enviar ao e-mail da mãe',async()=>{await api('/'+item.id+'/send',{method:'POST',json:{}});notice('Solicitação enviada.')});
    }
  }
  if(item.status==='sent'||item.status==='mother_signed'||item.status==='completed'){
    btn('Baixar documento '+(item.status==='completed'?'assinado':'atual'),()=>downloadPdf(item.id));
  }
  if(item.status==='mother_signed'){
    const help=document.createElement('p');help.textContent='A mãe já assinou. Leia o documento e confirme sua própria assinatura.';body.append(help);
    const component=createSignatureControl();body.append(component.element);
    btn('Assinar como consultora',async()=>{await api('/'+item.id+'/sign',{method:'POST',json:component.payload()});notice('Documento finalizado com as duas assinaturas.')});
  }
}
export async function openSignatureConsole(motherId,type,title){
  close();const root=document.createElement('div');root.className='df-layer ds-consult-overlay';
  root.innerHTML=`<div class="df-backdrop" data-close></div><section class="df-sheet ds-consult-sheet" role="dialog" aria-modal="true" aria-label="Assinatura eletrônica"><header>
    <div><small>DOCUMENTOS CLÍNICOS</small><h2>Assinatura eletrônica</h2><p>${DOC.escapeHTML(title)}</p></div>
    <button type="button" class="df-close" data-close aria-label="Fechar">×</button>
  </header><div class="ds-consult-body" data-ds-body></div><p data-ds-notice role="status" aria-live="polite"></p></section>`;
  current=root;document.body.append(root);
  root.querySelectorAll('[data-close]').forEach(x=>x.addEventListener('click',close));
  root.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
  try{await render(motherId,type,title)}catch(e){notice(e.message,true)}
  root.querySelector('.df-close')?.focus();
}
window.DeboraSignatureConsole={open:openSignatureConsole};
