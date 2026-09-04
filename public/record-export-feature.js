import {createRecordPdf,downloadPdf,sharePdf} from './document-pdf-service.js';

const DOC=window.DeboraDocuments;
const PERSISTED_SOURCES=['mothers','babies','clinical_encounters','consents','clinical_documents','clinical_media','weights'];
const DEFAULTS={includeAnamnesis:true,includeEncounters:true,includeCarePlans:true,includeGrowth:true,includeReferrals:true,includeTerms:true,includeMedia:false};
let layer=null,lastTrigger=null,currentMother='';

const fmtDate=value=>{
  if(!value)return '—';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(d);
};
const fmtDay=value=>{
  if(!value)return '—';
  const d=new Date(String(value).length===10?`${value}T12:00:00`:value);
  return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('pt-BR',{dateStyle:'short'}).format(d);
};
const fmtWeight=value=>Number(value)>0?`${Math.round(Number(value)).toLocaleString('pt-BR')} g`:'—';
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const humanize=key=>String(key||'').replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase());

function close(){if(!layer)return;layer.remove();layer=null;requestAnimationFrame(()=>lastTrigger?.focus?.())}
function trap(event){
  if(event.key==='Escape'){event.preventDefault();close();return}
  if(event.key!=='Tab'||!layer)return;
  const f=[...layer.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];if(!f.length)return;
  const first=f[0],last=f.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
function sheet(title,html){
  close();layer=document.createElement('div');layer.className='rx-layer';
  layer.innerHTML=`<div class="rx-backdrop" data-rx-close></div><section class="rx-sheet" role="dialog" aria-modal="true" aria-labelledby="rx-title"><header><div><small>PRONTUÁRIO</small><h2 id="rx-title">${DOC.escapeHTML(title)}</h2></div><button type="button" class="rx-close" data-rx-close aria-label="Fechar">×</button></header>${html}</section>`;
  document.body.appendChild(layer);layer.addEventListener('keydown',trap);layer.querySelectorAll('[data-rx-close]').forEach(x=>x.addEventListener('click',close));requestAnimationFrame(()=>layer.querySelector('.rx-close')?.focus());return layer.querySelector('.rx-sheet');
}

async function maybeRows(path){
  try{return await DOC.rest(path)||[]}catch(error){
    if(/schema cache|relation .* does not exist|clinical_documents|clinical_media/i.test(error.message||''))return [];
    throw error;
  }
}

async function loadPersistedRecord(motherId){
  const context=await DOC.patientContext(motherId);if(!context)throw new Error('Paciente não encontrada.');
  const babyIds=context.babies.map(b=>b.id);
  const [encounters,consents,documents,media,links,weights]=await Promise.all([
    DOC.rest(`clinical_encounters?mother_id=eq.${encodeURIComponent(motherId)}&select=*&order=occurred_at.asc`),
    DOC.consents(motherId),
    maybeRows(`clinical_documents?mother_id=eq.${encodeURIComponent(motherId)}&select=*&order=created_at.asc`),
    maybeRows(`clinical_media?mother_id=eq.${encodeURIComponent(motherId)}&select=*&order=taken_at.asc,created_at.asc`),
    babyIds.length?DOC.rest(`clinical_encounter_babies?baby_id=in.(${babyIds.map(encodeURIComponent).join(',')})&select=encounter_id,baby_id`):Promise.resolve([]),
    babyIds.length?DOC.rest(`weights?baby_id=in.(${babyIds.map(encodeURIComponent).join(',')})&select=*&order=measured_at.asc`):Promise.resolve([])
  ]);
  return {context,encounters:encounters||[],consents:consents||[],documents:documents||[],media:media||[],links:links||[],weights:weights||[],sources:PERSISTED_SOURCES};
}

function bounds(periodStart,periodEnd){
  const start=periodStart?new Date(`${periodStart}T00:00:00`):null,end=periodEnd?new Date(`${periodEnd}T23:59:59.999`):null;
  return {start:start&&!Number.isNaN(start.getTime())?start:null,end:end&&!Number.isNaN(end.getTime())?end:null};
}
function inPeriod(value,range){
  if(!value)return !range.start&&!range.end;
  const d=new Date(value);if(Number.isNaN(d.getTime()))return true;
  if(range.start&&d<range.start)return false;if(range.end&&d>range.end)return false;return true;
}
function selectedBabyIds(record,babyId){return babyId?[babyId]:record.context.babies.map(b=>b.id)}
function encounterMatchesBaby(encounter,babyId,links){
  if(!babyId)return true;
  if(encounter.baby_id===babyId)return true;
  return links.some(link=>link.encounter_id===encounter.id&&link.baby_id===babyId);
}

function flattenObject(value,prefix='',out=[]){
  if(value==null||value==='')return out;
  if(Array.isArray(value)){value.forEach((item,index)=>flattenObject(item,`${prefix}${prefix?' › ':''}${index+1}`,out));return out}
  if(typeof value==='object'){
    Object.entries(value).forEach(([key,item])=>flattenObject(item,`${prefix}${prefix?' › ':''}${humanize(key)}`,out));return out;
  }
  const text=clean(value);if(text)out.push(`${prefix||'Registro'}: ${text}`);return out;
}
function summaryText(value,preferred=[]){
  if(value==null)return '';
  if(typeof value!=='object')return clean(value);
  const entries=Object.entries(value),picked=entries.filter(([key])=>preferred.some(rx=>rx.test(key)));
  const source=picked.length?picked:entries;
  return clean(source.flatMap(([,item])=>flattenObject(item)).join('; ')).slice(0,1800);
}

function buildSections(record,options){
  const {context}=record,range=bounds(options.periodStart,options.periodEnd),babyIds=selectedBabyIds(record,options.babyId);
  const babies=context.babies.filter(b=>babyIds.includes(b.id));
  const encounters=record.encounters.filter(row=>encounterMatchesBaby(row,options.babyId,record.links)&&inPeriod(row.occurred_at||row.created_at,range));
  const documents=record.documents.filter(row=>(!options.babyId||!row.baby_id||row.baby_id===options.babyId)&&inPeriod(row.finalized_at||row.created_at,range));
  const weights=record.weights.filter(row=>babyIds.includes(row.baby_id)&&inPeriod(row.measured_at||row.created_at,range));
  const media=record.media.filter(row=>(!options.babyId||!row.baby_id||row.baby_id===options.babyId)&&inPeriod(row.taken_at||row.created_at,range));
  const sections=[];

  sections.push({title:'Identificação da paciente',body:[
    `Nome: ${context.mother.name}`,
    context.mother.birth_date?`Nascimento: ${fmtDay(context.mother.birth_date)}`:'',
    context.mother.phone?`Telefone: ${context.mother.phone}`:'',
    context.mother.email?`E-mail: ${context.mother.email}`:'',
    context.mother.profession?`Profissão: ${context.mother.profession}`:''
  ].filter(Boolean)});

  if(options.includeAnamnesis){
    const motherLines=[
      context.mother.delivery&&`Parto/gestação: ${context.mother.delivery}`,
      context.mother.obstetric_history&&`Histórico obstétrico: ${context.mother.obstetric_history}`,
      context.mother.conditions&&`Condições: ${context.mother.conditions}`,
      context.mother.medications&&`Medicamentos: ${context.mother.medications}`,
      context.mother.allergies&&`Alergias: ${context.mother.allergies}`,
      context.mother.breastfeeding_history&&`Histórico de amamentação: ${context.mother.breastfeeding_history}`,
      context.mother.notes&&`Observações: ${context.mother.notes}`
    ].filter(Boolean);
    sections.push({title:'Anamnese materna',body:motherLines.length?motherLines:['Sem informações adicionais registradas.']});
    babies.forEach(baby=>sections.push({title:`Bebê · ${baby.name}`,body:[
      baby.birth_date&&`Nascimento: ${fmtDay(baby.birth_date)}`,
      baby.gestational_age&&`Idade gestacional: ${baby.gestational_age}`,
      `Peso ao nascer: ${fmtWeight(baby.birth_weight_g)}`,
      `Peso atual cadastrado: ${fmtWeight(baby.current_weight_g)}`,
      baby.delivery_type&&`Tipo de parto: ${baby.delivery_type}`,
      baby.apgar&&`Apgar: ${baby.apgar}`,
      baby.feeding&&`Alimentação: ${baby.feeding}`,
      baby.hospital_history&&`Histórico hospitalar: ${baby.hospital_history}`,
      baby.notes&&`Observações: ${baby.notes}`
    ].filter(Boolean)}));
  }

  if(options.includeEncounters){
    encounters.forEach((encounter,index)=>{
      if(options.mode==='summary'){
        sections.push({title:`Atendimento ${index+1} · ${fmtDate(encounter.occurred_at)}`,body:[
          `Status: ${encounter.status||'—'}`,
          summaryText(encounter.chief_complaint,[/complaint/i,/queixa/i,/motivo/i,/reason/i])&&`Queixa: ${summaryText(encounter.chief_complaint,[/complaint/i,/queixa/i,/motivo/i,/reason/i])}`,
          encounter.clinical_note&&`Evolução/nota clínica: ${encounter.clinical_note}`
        ].filter(Boolean)});
      }else{
        const lines=[`Status: ${encounter.status||'—'}`,`Data: ${fmtDate(encounter.occurred_at)}`];
        for(const [label,value] of [['Identificação',encounter.identification],['Queixa principal',encounter.chief_complaint],['Avaliação materna',encounter.maternal_assessment],['Avaliação do bebê',encounter.baby_assessment],['Avaliação da mamada',encounter.feeding_assessment]]){
          const flat=flattenObject(value);if(flat.length)lines.push(`${label}:`,...flat);
        }
        if(encounter.clinical_note)lines.push(`Evolução/nota clínica: ${encounter.clinical_note}`);
        sections.push({title:`Atendimento ${index+1} · ${fmtDate(encounter.occurred_at)}`,body:lines});
      }
    });
    if(!encounters.length)sections.push({title:'Atendimentos',body:'Nenhum atendimento encontrado para os filtros escolhidos.'});
  }

  if(options.includeCarePlans){
    const plans=encounters.filter(row=>row.care_plan&&Object.keys(row.care_plan||{}).length);
    plans.forEach((encounter,index)=>sections.push({title:`Plano de cuidados ${index+1} · ${fmtDate(encounter.occurred_at)}`,body:options.mode==='summary'?summaryText(encounter.care_plan,[/goal/i,/objet/i,/orient/i,/condut/i,/plan/i,/summary/i,/resum/i]):flattenObject(encounter.care_plan)}));
    if(!plans.length)sections.push({title:'Planos de cuidados',body:'Nenhum plano de cuidados encontrado para os filtros escolhidos.'});
  }

  if(options.includeGrowth){
    babies.forEach(baby=>{
      const rows=weights.filter(row=>row.baby_id===baby.id);
      sections.push({title:`Crescimento · ${baby.name}`,body:[`Peso ao nascer: ${fmtWeight(baby.birth_weight_g)}`,...rows.map(row=>`${fmtDate(row.measured_at)} — ${fmtWeight(row.weight_g)}${row.notes?` — ${row.notes}`:''}`)]});
    });
  }

  if(options.includeReferrals){
    const referrals=documents.filter(row=>row.document_type==='referral');
    sections.push({title:'Encaminhamentos',body:referrals.length?referrals.map(row=>`${fmtDate(row.finalized_at||row.created_at)} — ${row.title||'Encaminhamento'} — ${row.status==='finalized'?'Finalizado':'Rascunho'}${row.content?.professional_destination?` — ${row.content.professional_destination}`:''}`):['Nenhum encaminhamento encontrado para os filtros escolhidos.']});
  }

  if(options.includeTerms){
    sections.push({title:'Termos e autorizações',body:record.consents.length?record.consents.map(row=>`${humanize(row.consent_type)} — ${row.granted&&!row.revoked_at?'Autorizado':row.revoked_at?'Revogado':'Não autorizado'}${row.accepted_at?` — aceite ${fmtDate(row.accepted_at)}`:''}${row.revoked_at?` — revogação ${fmtDate(row.revoked_at)}`:''}`):['Nenhum consentimento registrado.']});
  }

  if(options.includeMedia){
    sections.push({title:'Fotos e mídia clínica',body:media.length?media.map(row=>`${fmtDate(row.taken_at||row.created_at)} — ${row.category||'Imagem clínica'}${row.caption?` — ${row.caption}`:''}`):['Nenhuma mídia clínica encontrada para os filtros escolhidos.']});
  }

  return {sections,media,counts:{babies:babies.length,encounters:encounters.length,documents:documents.length,weights:weights.length,media:media.length}};
}

async function imageToJpeg(row){
  const url=await DOC.signedClinicalMediaUrl(row.storage_path,900);if(!url)throw new Error('URL de mídia indisponível.');
  const response=await fetch(url);if(!response.ok)throw new Error(`Falha ao carregar mídia (${response.status}).`);
  const source=await response.blob(),objectUrl=URL.createObjectURL(source);
  try{
    const img=new Image();img.src=objectUrl;
    if(img.decode)await img.decode();else await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject});
    const max=1400,scale=Math.min(1,max/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height)),width=Math.max(1,Math.round((img.naturalWidth||img.width)*scale)),height=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,width,height);
    const jpeg=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Falha ao converter imagem.')),'image/jpeg',0.84));
    return {bytes:new Uint8Array(await jpeg.arrayBuffer()),width,height,caption:`${fmtDate(row.taken_at||row.created_at)} · ${row.category||'Imagem clínica'}${row.caption?` · ${row.caption}`:''}`};
  }finally{URL.revokeObjectURL(objectUrl)}
}

async function prepareImages(media,onProgress=()=>{}){
  const images=[],failures=[];
  for(let i=0;i<media.length;i++){
    onProgress(i+1,media.length);
    try{images.push(await imageToJpeg(media[i]))}catch(error){failures.push(`${fmtDate(media[i].taken_at||media[i].created_at)} — ${media[i].category||'Imagem clínica'}: ${error.message||'não incorporada'}`)}
  }
  return {images,failures};
}

async function registerExport(motherId,options,counts){
  const generatedAt=new Date().toISOString();
  try{
    await DOC.saveDocument({document_type:'export',title:`${options.mode==='summary'?'Resumo clínico':'Prontuário completo'} · ${fmtDate(generatedAt)}`,status:'finalized',baby_id:options.babyId||null,finalized_at:generatedAt,content:{schema_version:1,generated_at:generatedAt,mode:options.mode,period_start:options.periodStart||null,period_end:options.periodEnd||null,include_media:Boolean(options.includeMedia),included:{anamnesis:options.includeAnamnesis,encounters:options.includeEncounters,care_plans:options.includeCarePlans,growth:options.includeGrowth,referrals:options.includeReferrals,terms:options.includeTerms},counts}});
  }catch(error){if(!/clinical_documents|schema cache|relation .* does not exist/i.test(error.message||''))throw error}
}

function optionsFrom(form){
  const checked=name=>Boolean(form.querySelector(`[name="${name}"]`)?.checked);
  return {mode:form.querySelector('[name="mode"]').value,babyId:form.querySelector('[name="babyId"]').value||'',periodStart:form.querySelector('[name="periodStart"]').value||'',periodEnd:form.querySelector('[name="periodEnd"]').value||'',includeAnamnesis:checked('includeAnamnesis'),includeEncounters:checked('includeEncounters'),includeCarePlans:checked('includeCarePlans'),includeGrowth:checked('includeGrowth'),includeReferrals:checked('includeReferrals'),includeTerms:checked('includeTerms'),includeMedia:checked('includeMedia')};
}

async function generate({motherId,form,mode='download',button}){
  const options=optionsFrom(form);if(options.periodStart&&options.periodEnd&&options.periodStart>options.periodEnd)throw new Error('A data inicial não pode ser posterior à data final.');
  const original=button.textContent;button.disabled=true;button.textContent='Preparando prontuário…';
  try{
    const record=await loadPersistedRecord(motherId),built=buildSections(record,options);
    let images=[],failures=[];
    if(options.includeMedia&&built.media.length){
      const prepared=await prepareImages(built.media,(current,total)=>{button.textContent=`Preparando fotos ${current}/${total}…`});images=prepared.images;failures=prepared.failures;
      if(failures.length)built.sections.push({title:'Mídia não incorporada',body:failures});
    }
    const modeLabel=options.mode==='summary'?'Resumo clínico':'Prontuário completo',babyLabel=options.babyId?record.context.babies.find(b=>b.id===options.babyId)?.name||'Bebê selecionado':'Todos os bebês';
    const periodLabel=options.periodStart||options.periodEnd?`Período: ${options.periodStart?fmtDay(options.periodStart):'início'} a ${options.periodEnd?fmtDay(options.periodEnd):'hoje'}`:'Todo o histórico';
    const pdf=createRecordPdf({motherName:record.context.mother.name,modeLabel,subheading:`${record.context.mother.name} · ${babyLabel} · ${periodLabel}`,sections:built.sections,images});
    await registerExport(motherId,options,built.counts);
    const fileName=`${options.mode==='summary'?'resumo-clinico':'prontuario-completo'}-${record.context.mother.name}`;
    if(mode==='share'){
      const result=await sharePdf(pdf,fileName,modeLabel);DOC.toast(result==='shared'?'Prontuário compartilhado.':'PDF do prontuário gerado.');
    }else{downloadPdf(pdf,fileName);DOC.toast('PDF do prontuário gerado.')}
    window.dispatchEvent(new CustomEvent('debora:record-exported',{detail:{motherId,mode:options.mode}}));
  }finally{button.disabled=false;button.textContent=original}
}

async function openExport(motherId,trigger){
  lastTrigger=trigger||document.activeElement;
  const context=await DOC.patientContext(motherId);if(!context)throw new Error('Paciente não encontrada.');
  const active=context.activeBabyId||'';
  const panel=sheet('Exportar prontuário / PDF',`<form class="rx-form" data-rx-form>
    <div class="rx-grid">
      <label><span>Formato</span><select name="mode"><option value="summary">Resumo clínico</option><option value="complete">Prontuário completo</option></select></label>
      <label><span>Bebê</span><select name="babyId"><option value="">Todos os bebês</option>${context.babies.map(b=>`<option value="${b.id}" ${b.id===active?'selected':''}>${DOC.escapeHTML(b.name)}</option>`).join('')}</select></label>
      <label><span>Data inicial</span><input type="date" name="periodStart"></label>
      <label><span>Data final</span><input type="date" name="periodEnd"></label>
    </div>
    <fieldset><legend>Conteúdo do PDF</legend>
      <label><input type="checkbox" name="includeAnamnesis" ${DEFAULTS.includeAnamnesis?'checked':''}><span>Dados cadastrais e anamnese</span></label>
      <label><input type="checkbox" name="includeEncounters" ${DEFAULTS.includeEncounters?'checked':''}><span>Consultas e evoluções</span></label>
      <label><input type="checkbox" name="includeCarePlans" ${DEFAULTS.includeCarePlans?'checked':''}><span>Planos de cuidados</span></label>
      <label><input type="checkbox" name="includeGrowth" ${DEFAULTS.includeGrowth?'checked':''}><span>Peso e crescimento</span></label>
      <label><input type="checkbox" name="includeReferrals" ${DEFAULTS.includeReferrals?'checked':''}><span>Encaminhamentos</span></label>
      <label><input type="checkbox" name="includeTerms" ${DEFAULTS.includeTerms?'checked':''}><span>Termos e autorizações</span></label>
      <label><input type="checkbox" name="includeMedia" ${DEFAULTS.includeMedia?'checked':''}><span>Fotos e mídia clínica</span></label>
    </fieldset>
    <div class="rx-note">O período filtra registros clínicos. Dados cadastrais e o estado atual dos consentimentos permanecem identificados. Fotos ficam desmarcadas por padrão e, quando selecionadas, são incorporadas ao final do PDF.</div>
    <div class="rx-actions"><button type="button" class="rx-secondary" data-rx-close>Cancelar</button><button type="button" class="rx-secondary" data-rx-share>Compartilhar</button><button type="submit" class="rx-primary">Gerar PDF</button></div>
  </form>`);
  const form=panel.querySelector('[data-rx-form]');panel.querySelectorAll('[data-rx-close]').forEach(x=>x.addEventListener('click',close));
  form.addEventListener('submit',event=>{event.preventDefault();generate({motherId,form,button:form.querySelector('button[type="submit"]')}).catch(error=>DOC.toast(error.message||'Não foi possível exportar o prontuário.','error'))});
  panel.querySelector('[data-rx-share]').addEventListener('click',event=>generate({motherId,form,mode:'share',button:event.currentTarget}).catch(error=>{if(error?.name!=='AbortError')DOC.toast(error.message||'Não foi possível compartilhar o prontuário.','error')}));
}

function cardMarkup(motherId){return `<section class="rx-card" data-rx-card data-rx-mother="${motherId}"><div><small>DOCUMENTOS</small><h2>Exportar prontuário / PDF</h2><p>Monte um resumo clínico ou o prontuário completo por período e bebê, escolhendo exatamente quais registros serão incluídos.</p></div><button type="button" class="rx-primary" data-rx-open>Exportar prontuário</button></section>`}
function mount(motherId){
  if(!motherId||motherId===currentMother&&document.querySelector('[data-rx-card]'))return;currentMother=motherId;document.querySelectorAll('[data-rx-card]').forEach(x=>x.remove());
  const screen=document.querySelector('[data-screen="patient"]');if(!screen)return;const wrap=document.createElement('div');wrap.innerHTML=cardMarkup(motherId);const card=wrap.firstElementChild;
  const referrals=screen.querySelector('[data-rf-card]'),album=screen.querySelector('[data-af-card]'),terms=screen.querySelector('[data-df-terms-card]'),target=referrals||album||terms||screen.querySelector('[data-pf-prontuario]')||screen.querySelector('.patient-detail-grid')||screen.lastElementChild;target?.after?target.after(card):screen.appendChild(card);
  card.querySelector('[data-rx-open]').addEventListener('click',event=>openExport(motherId,event.currentTarget).catch(error=>DOC.toast(error.message||'Não foi possível abrir a exportação.','error')));
}
window.addEventListener('debora:patient-context',event=>{const motherId=event.detail?.motherId;if(motherId)mount(motherId);else{currentMother='';document.querySelectorAll('[data-rx-card]').forEach(x=>x.remove())}});
window.DeboraRecordExport={open:openExport,refresh:()=>{currentMother='';const id=DOC.currentMotherId();if(id)mount(id)}};
