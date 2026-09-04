import {createConsentPdf,downloadPdf,sharePdf} from './document-pdf-service.js';

const DOC=window.DeboraDocuments;
const LABELS={
  data_processing:{title:'Tratamento de dados pessoais e de saúde',description:'Registro de autorização para manter dados necessários ao prontuário e acompanhamento clínico.'},
  whatsapp:{title:'Contato por WhatsApp',description:'Registro de autorização para confirmações, orientações e acompanhamentos por WhatsApp.'},
  clinical_media:{title:'Fotos e documentos clínicos',description:'Registro de autorização para armazenamento privado de imagens e documentos vinculados ao cuidado.'},
  public_media:{title:'Uso público de imagem',description:'Registro separado e opcional para uso público de imagem.'},
  teleconsultation:{title:'Teleatendimento',description:'Registro de autorização para atendimento remoto, quando aplicável.'}
};
let layer=null,lastTrigger=null,currentMother='';
function fmtDate(v){if(!v)return 'Não registrado';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(d)}
function status(c){if(c?.granted&&!c?.revoked_at)return{label:'Autorizado',tone:'ok'};if(c?.revoked_at)return{label:'Revogado',tone:'warn'};return{label:'Não autorizado',tone:'neutral'}}
function close(){if(!layer)return;layer.remove();layer=null;requestAnimationFrame(()=>lastTrigger?.focus?.())}
function keyTrap(event){if(event.key==='Escape'){event.preventDefault();close();return}if(event.key!=='Tab'||!layer)return;const f=[...layer.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];if(!f.length)return;const first=f[0],last=f.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
function overlay(title,html){
  close();layer=document.createElement('div');layer.className='df-layer';layer.innerHTML=`<div class="df-backdrop" data-df-close></div><section class="df-sheet" role="dialog" aria-modal="true" aria-labelledby="df-title"><header><div><small>DOCUMENTOS CLÍNICOS</small><h2 id="df-title">${DOC.escapeHTML(title)}</h2></div><button type="button" class="df-close" data-df-close aria-label="Fechar">×</button></header>${html}</section>`;document.body.appendChild(layer);layer.addEventListener('keydown',keyTrap);layer.querySelectorAll('[data-df-close]').forEach(x=>x.addEventListener('click',close));requestAnimationFrame(()=>layer.querySelector('.df-close')?.focus());return layer.querySelector('.df-sheet')
}
async function ensureSnapshot(context,consent){
  const s=status(consent),meta=LABELS[consent.consent_type]||{title:consent.consent_type,description:''};
  const content={source:'consents',consent_id:consent.id,consent_type:consent.consent_type,granted:Boolean(consent.granted),status:s.label,version:consent.version||'',accepted_at:consent.accepted_at||null,revoked_at:consent.revoked_at||null,evidence:consent.evidence||'',snapshot_at:new Date().toISOString()};
  try{return await DOC.saveDocument({document_type:'term',title:meta.title,status:'finalized',source_consent_id:consent.id,content,finalized_at:new Date().toISOString()})}catch(error){
    if(/clinical_documents|schema cache|relation .* does not exist/i.test(error.message||''))return null;
    throw error;
  }
}
async function pdfFor(context,consent){
  const meta=LABELS[consent.consent_type]||{title:consent.consent_type},s=status(consent);
  return createConsentPdf({motherName:context.mother.name,consentLabel:meta.title,statusLabel:s.label,acceptedAt:fmtDate(consent.accepted_at),revokedAt:consent.revoked_at?fmtDate(consent.revoked_at):'',version:consent.version||'',evidence:consent.evidence||''});
}
async function openConsent(motherId,consentType,trigger){
  lastTrigger=trigger||document.activeElement;
  const [context,rows]=await Promise.all([DOC.patientContext(motherId),DOC.consents(motherId)]);if(!context)throw new Error('Paciente não encontrada.');
  const consent=rows.find(c=>c.consent_type===consentType)||{consent_type:consentType,granted:false};
  const meta=LABELS[consentType]||{title:consentType,description:''},s=status(consent);
  const sheet=overlay(meta.title,`<div class="df-term-view"><div class="df-status ${s.tone}"><span></span>${DOC.escapeHTML(s.label)}</div><p>${DOC.escapeHTML(meta.description)}</p><dl><div><dt>Paciente</dt><dd>${DOC.escapeHTML(context.mother.name)}</dd></div><div><dt>Aceite</dt><dd>${DOC.escapeHTML(fmtDate(consent.accepted_at))}</dd></div><div><dt>Revogação</dt><dd>${DOC.escapeHTML(consent.revoked_at?fmtDate(consent.revoked_at):'—')}</dd></div><div><dt>Versão</dt><dd>${DOC.escapeHTML(consent.version||'Não informada')}</dd></div></dl><div class="df-term-note">Este documento reflete o registro eletrônico atual. Para alterar a autorização, use <strong>Editar cadastro</strong>; gerar ou compartilhar um PDF não muda o consentimento.</div><div class="df-actions"><button type="button" class="df-primary" data-term-pdf>Gerar PDF</button><button type="button" class="df-secondary" data-term-share>Compartilhar</button></div></div>`);
  const run=async(mode)=>{try{const blob=await pdfFor(context,consent);if(consent.id)await ensureSnapshot(context,consent);const name=`termo-${consentType}-${context.mother.name}`;if(mode==='share'){const result=await sharePdf(blob,name,meta.title);DOC.toast(result==='shared'?'Termo compartilhado.':'PDF gerado para compartilhamento.')}else{downloadPdf(blob,name);DOC.toast('PDF do termo gerado.')}}catch(error){DOC.toast(error.message||'Não foi possível gerar o documento.','error')}};
  sheet.querySelector('[data-term-pdf]').addEventListener('click',()=>run('pdf'));sheet.querySelector('[data-term-share]').addEventListener('click',()=>run('share'));
}
function cardMarkup(consents){
  const map=new Map((consents||[]).map(c=>[c.consent_type,c]));
  const types=['data_processing','whatsapp','clinical_media','public_media','teleconsultation'];
  return `<section class="df-patient-card" data-df-terms-card><div class="df-card-head"><div><small>DOCUMENTOS</small><h2>Termos e autorizações</h2><p>Consulte os registros de consentimento da paciente e gere uma cópia em PDF sem alterar o prontuário.</p></div></div><div class="df-term-list">${types.map(type=>{const c=map.get(type)||{consent_type:type,granted:false},meta=LABELS[type],s=status(c);return `<button type="button" data-df-term="${type}"><div><strong>${DOC.escapeHTML(meta.title)}</strong><small>${DOC.escapeHTML(c.accepted_at?fmtDate(c.accepted_at):'Sem aceite registrado')}</small></div><span class="df-mini-status ${s.tone}">${DOC.escapeHTML(s.label)}</span><b>›</b></button>`}).join('')}</div></section>`;
}
async function mount(motherId){
  if(!motherId||motherId===currentMother&&document.querySelector('[data-df-terms-card]'))return;
  currentMother=motherId;document.querySelectorAll('[data-df-terms-card]').forEach(x=>x.remove());
  const screen=document.querySelector('[data-screen="patient"]');if(!screen)return;
  try{
    const rows=await DOC.consents(motherId);const wrap=document.createElement('div');wrap.innerHTML=cardMarkup(rows);const card=wrap.firstElementChild;
    const target=screen.querySelector('[data-pf-prontuario]')||screen.querySelector('.patient-detail-grid')||screen.lastElementChild;target?.after?target.after(card):screen.appendChild(card);
    card.querySelectorAll('[data-df-term]').forEach(btn=>btn.addEventListener('click',()=>openConsent(motherId,btn.dataset.dfTerm,btn).catch(e=>DOC.toast(e.message||'Não foi possível abrir o termo.','error'))));
  }catch(error){if(!/Sessão não encontrada/.test(error.message||''))DOC.toast(error.message||'Não foi possível carregar os termos.','error')}
}
window.addEventListener('debora:patient-context',(event)=>{const motherId=event.detail?.motherId;if(motherId)mount(motherId);else{currentMother='';document.querySelectorAll('[data-df-terms-card]').forEach(x=>x.remove())}});
window.DeboraTerms={open:openConsent,refresh:()=>{currentMother='';const id=DOC.currentMotherId();if(id)mount(id)}};
