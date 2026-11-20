import {PRENATAL_QUESTIONS, parsePrenatalAnswers, isPrenatal} from './prenatal-questionnaire-feature.js';
import {createSingleFlight} from './runtime-guards.js';

const DOC=window.DeboraDocuments;
let layer=null,lastTrigger=null,current=null,summaryTimer=null,expectedSummaryKey='',referralView=null;
const summaryFlight=createSingleFlight();

const esc=value=>DOC.escapeHTML(value??'');
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const fmtDate=value=>{if(!value)return 'Sem data';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(d)};
const fmtDay=value=>{if(!value)return 'Sem data';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'long',year:'numeric'}).format(d)};
const consentLabels={data_processing:'Dados pessoais e de saúde',whatsapp:'Contato por WhatsApp',clinical_media:'Fotos e documentos clínicos',public_media:'Uso público de imagem',teleconsultation:'Teleatendimento'};

function close(){if(!layer)return;layer.remove();layer=null;current=null;referralView=null;requestAnimationFrame(()=>lastTrigger?.focus?.())}
function trap(event){if(event.key==='Escape'){event.preventDefault();close();return}if(event.key!=='Tab'||!layer)return;const f=[...layer.querySelectorAll('button:not(:disabled),a[href],select:not(:disabled),input:not(:disabled)')];if(!f.length)return;const first=f[0],last=f.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
function shell(kicker,title,subtitle=''){
  close();layer=document.createElement('div');layer.className='pw-layer';layer.innerHTML=`<section class="pw-page" role="dialog" aria-modal="true" aria-labelledby="pw-title"><header class="pw-top"><button type="button" class="pw-back" data-pw-close aria-label="Voltar">‹</button><div><small>${esc(kicker)}</small><h1 id="pw-title">${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div></header><main class="pw-content" data-pw-content><div class="pw-loading">Carregando…</div></main></section>`;document.body.appendChild(layer);layer.addEventListener('keydown',trap);layer.querySelector('[data-pw-close]').onclick=close;requestAnimationFrame(()=>layer.querySelector('[data-pw-close]')?.focus());return layer.querySelector('[data-pw-content]')
}
function watchDialog(selector,callback){let seen=false,ticks=0;const timer=setInterval(()=>{ticks++;const exists=Boolean(document.querySelector(selector));if(exists)seen=true;if(seen&&!exists){clearInterval(timer);callback?.()}else if(ticks>600)clearInterval(timer)},100)}
async function context(motherId){const value=await DOC.patientContext(motherId);if(!value)throw new Error('Paciente não encontrada.');return value}
function babyName(ctx,id){return ctx.babies.find(b=>b.id===id)?.name||'Sem bebê específico'}
function statusConsent(row){if(row?.granted&&!row?.revoked_at)return['Autorizado','ok'];if(row?.revoked_at)return['Revogado','warn'];return['Não autorizado','neutral']}

async function renderAlbum(motherId,content){
  const [ctx,rows]=await Promise.all([context(motherId),DOC.rest(`clinical_media?mother_id=eq.${encodeURIComponent(motherId)}&select=*&order=taken_at.desc,created_at.desc&limit=100`).catch(()=>[])]);
  const categories=[...new Set((rows||[]).map(row=>row.category||'Outro'))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  content.innerHTML=`<div class="pw-toolbar"><div><strong>Álbum clínico</strong><span>${rows.length} ${rows.length===1?'imagem':'imagens'}</span></div><button type="button" class="pw-primary" data-pw-add-photo>+ Adicionar foto</button></div><div class="pw-filters"><label>Bebê<select data-pw-baby><option value="">Todos</option>${ctx.babies.map(b=>`<option value="${b.id}" ${b.id===ctx.activeBabyId?'selected':''}>${esc(b.name)}</option>`).join('')}</select></label><label>Categoria<select data-pw-category><option value="">Todas</option>${categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label></div><div data-pw-album-grid></div>`;
  const babySelect=content.querySelector('[data-pw-baby]'),categorySelect=content.querySelector('[data-pw-category]'),grid=content.querySelector('[data-pw-album-grid]');
  async function draw(){const babyId=babySelect.value,category=categorySelect.value;const filtered=(rows||[]).filter(row=>(!babyId||row.baby_id===babyId)&&(!category||(row.category||'Outro')===category));if(!filtered.length){grid.innerHTML='<div class="pw-empty"><strong>Nenhuma imagem neste recorte</strong><span>Use Adicionar foto para registrar uma imagem clínica.</span></div>';return}const groups=new Map();for(const row of filtered){const key=fmtDay(row.taken_at||row.created_at);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}grid.innerHTML='';for(const [day,items] of groups){const section=document.createElement('section');section.className='pw-photo-group';section.innerHTML=`<h2>${esc(day)}</h2><div class="pw-photo-grid"></div>`;grid.appendChild(section);const target=section.querySelector('.pw-photo-grid');const signed=await Promise.all(items.map(async row=>({row,url:await DOC.signedClinicalMediaUrl(row.storage_path,900).catch(()=>'' )})));target.innerHTML=signed.map(({row,url})=>`<button type="button" class="pw-photo" data-pw-photo="${row.id}">${url?`<img src="${esc(url)}" alt="">`:'<span class="pw-photo-missing">Imagem</span>'}<b>${esc(row.category||'Outro')}</b><small>${esc(babyName(ctx,row.baby_id))}</small></button>`).join('');target.querySelectorAll('[data-pw-photo]').forEach(btn=>btn.onclick=()=>{const row=items.find(x=>x.id===btn.dataset.pwPhoto),item=signed.find(x=>x.row.id===row?.id);if(!row)return;const viewer=document.createElement('div');viewer.className='pw-photo-view';viewer.innerHTML=`<div class="pw-photo-backdrop"></div><section><button type="button" aria-label="Fechar">×</button>${item?.url?`<img src="${esc(item.url)}" alt="Imagem clínica">`:''}<h2>${esc(row.category||'Imagem clínica')}</h2><p>${esc(row.caption||'Sem observação clínica.')}</p><small>${esc(babyName(ctx,row.baby_id))} · ${esc(fmtDate(row.taken_at||row.created_at))}</small></section>`;layer.appendChild(viewer);viewer.querySelector('button').onclick=()=>viewer.remove();viewer.querySelector('.pw-photo-backdrop').onclick=()=>viewer.remove()})}}
  babySelect.onchange=draw;categorySelect.onchange=draw;content.querySelector('[data-pw-add-photo]').onclick=event=>{window.DeboraAlbum?.openUploader(motherId,event.currentTarget).catch(e=>DOC.toast(e.message||'Não foi possível adicionar a foto.','error'));watchDialog('.af-layer',()=>open('album',motherId,lastTrigger))};await draw();
}

async function renderReferrals(motherId,content){
  let rows=await DOC.listDocuments(motherId,'referral').catch(()=>[]);
  content.innerHTML=`<div class="pw-toolbar"><div><strong>Encaminhamentos</strong><span data-pw-referral-count>${rows.length} ${rows.length===1?'documento':'documentos'}</span></div><button type="button" class="pw-primary" data-pw-new-referral>+ Novo encaminhamento</button></div><div class="pw-filters"><label>Status<select data-pw-status><option value="">Todos</option><option value="draft">Rascunhos</option><option value="finalized">Finalizados</option></select></label></div><div class="pw-document-list" data-pw-referral-list></div>`;
  const select=content.querySelector('[data-pw-status]'),list=content.querySelector('[data-pw-referral-list]'),count=content.querySelector('[data-pw-referral-count]');
  function draw(){count.textContent=`${rows.length} ${rows.length===1?'documento':'documentos'}`;const filtered=rows.filter(row=>!select.value||row.status===select.value);list.innerHTML=filtered.length?filtered.map(row=>`<button type="button" data-pw-referral="${row.id}"><div><strong>${esc(row.title||'Encaminhamento')}</strong><small>${esc(fmtDate(row.updated_at||row.created_at))}${row.content?.professional_destination?` · ${esc(row.content.professional_destination)}`:''}</small></div><span class="pw-status ${row.status==='finalized'?'ok':'draft'}">${row.status==='finalized'?'Finalizado':'Rascunho'}</span><b>›</b></button>`).join(''):'<div class="pw-empty"><strong>Nenhum encaminhamento</strong><span>Crie o primeiro documento para esta paciente.</span></div>';list.querySelectorAll('[data-pw-referral]').forEach(btn=>btn.onclick=()=>window.DeboraReferrals?.openExisting(motherId,btn.dataset.pwReferral,btn).catch(e=>DOC.toast(e.message||'Não foi possível abrir o encaminhamento.','error')))}
  function upsert(savedDocument){if(!savedDocument?.id)return;const index=rows.findIndex(row=>row.id===savedDocument.id);if(index>=0)rows[index]=savedDocument;else rows=[savedDocument,...rows];draw()}
  referralView={motherId,upsert};
  select.onchange=draw;content.querySelector('[data-pw-new-referral]').onclick=event=>window.DeboraReferrals?.openNew(motherId,event.currentTarget).catch(e=>DOC.toast(e.message||'Não foi possível criar o encaminhamento.','error'));draw();
}

async function renderTerms(motherId,content){
  const rows=await DOC.consents(motherId).catch(()=>[]),map=new Map(rows.map(row=>[row.consent_type,row])),types=['data_processing','whatsapp','clinical_media','public_media','teleconsultation'];
  content.innerHTML=`<div class="pw-toolbar"><div><strong>Termos e autorizações</strong><span>Registros de consentimento da paciente</span></div></div><div class="pw-document-list">${types.map(type=>{const row=map.get(type)||{consent_type:type,granted:false},[label,tone]=statusConsent(row);return `<button type="button" data-pw-term="${type}"><div><strong>${esc(consentLabels[type]||type)}</strong><small>${esc(row.accepted_at?`Aceite ${fmtDate(row.accepted_at)}`:'Sem aceite registrado')}</small></div><span class="pw-status ${tone}">${label}</span><b>›</b></button>`}).join('')}</div>`;content.querySelectorAll('[data-pw-term]').forEach(btn=>btn.onclick=()=>window.DeboraTerms?.open(motherId,btn.dataset.pwTerm,btn).catch(e=>DOC.toast(e.message||'Não foi possível abrir o termo.','error')));
}

async function encounterData(motherId){
  const ctx=await context(motherId),rows=await DOC.rest(`clinical_encounters?mother_id=eq.${encodeURIComponent(motherId)}&select=id,status,mother_id,baby_id,appointment_id,occurred_at,updated_at&order=occurred_at.desc&limit=100`).catch(()=>[]),links=ctx.babies.length?await DOC.rest(`clinical_encounter_babies?baby_id=in.(${ctx.babies.map(b=>encodeURIComponent(b.id)).join(',')})&select=encounter_id,baby_id`).catch(()=>[]):[];return{ctx,rows,links};
}
function encounterBabyNames(data,row){const ids=new Set([row.baby_id,...data.links.filter(link=>link.encounter_id===row.id).map(link=>link.baby_id)].filter(Boolean));return [...ids].map(id=>babyName(data.ctx,id)).join(', ')||'Somente a mãe'}

const encounterSections = [
  ['Identificação', 'identification'],
  ['Queixa principal', 'chief_complaint'],
  ['Avaliação materna', 'maternal_assessment'],
  ['Avaliação do bebê', 'baby_assessment'],
  ['Avaliação da mamada', 'feeding_assessment'],
  ['Plano de cuidados', 'care_plan'],
  ['Prontuário', 'clinical_note']
];

const encounterFieldLabels = {
  assistedReproduction: 'Esta gestação foi por reprodução assistida / FIV?',
  assistedReproductionNotes: 'Observações',
  chronicConditionsHistory: 'Doença crônica preexistente?',
  chronicConditionsDetails: 'Qual(is)?',
  medicationUse: 'Faz uso atual de medicamentos?',
  supplementsUse: 'Faz uso de suplementos?',
  supplements: 'Quais?',
  allergiesKnown: 'Alergias conhecidas?',
  allergies: 'Quais?',
  pregnancyComplications: 'Houve intercorrências durante a gestação?',
  pregnancyComplicationsDetails: 'Quais?',
  breastSurgeryHistory: 'Cirurgias mamárias anteriores?',
  breastSurgeryDetails: 'Detalhes',
  previousBreastfeedingHistory: 'Histórico de amamentação anterior?',
  previousBreastfeedingDetails: 'Como foi?',
  medications: 'Medicamentos',
  appointmentType: 'Tipo de atendimento', format: 'Modalidade', startsAt: 'Início',
  durationMin: 'Duração', value: 'Valor', address: 'Endereço', tags: 'Itens registrados',
  notes: 'Observações', painScore: 'Intensidade da dor', affectedSide: 'Lado afetado',
  weightG: 'Peso (g)', weightGainG: 'Ganho de peso (g)', wetDiapers: 'Fraldas molhadas',
  stools: 'Evacuações', observations: 'Observações', position: 'Posição', latch: 'Pega',
  suckSwallow: 'Sucção e deglutição', objectives: 'Objetivos', instructions: 'Orientações',
  followup: 'Acompanhamento', priorityGuidance: 'Orientações prioritárias',
  feedingPositioning: 'Posicionamento', expressionSupplement: 'Ordenha e complemento',
  routine: 'Rotina', warningSigns: 'Sinais de alerta', byBaby: 'Por bebê', symptoms: 'Sintomas', beforeFeed: 'Antes da mamada', afterFeed: 'Após a mamada',
  weekly_plan: 'Plano por semana', weeks: 'Semanas', week: 'Semana', orientation_mode: 'Orientações',
  libraryItems: 'Orientações selecionadas', prenatalAnswers: 'Anamnese pré-natal', declaration: 'Declaração'
};

const historyUuid = /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi;
const historyCurrency = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});

function clinicalFieldValue(value, babies, key = '') {
  if (value == null || value === '') return '';
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try { value = JSON.parse(value); } catch { /* Clinical prose can start with a bracket. */ }
  }
  if (Array.isArray(value)) return value.map(item => clinicalFieldValue(item, babies, key)).filter(Boolean).join('<br>');
  if (typeof value !== 'object') {
    let text = typeof value === 'boolean' ? (value ? 'Sim' : 'Não') : String(value);
    if (key === 'value' && /^\d+(?:[.,]\d+)?$/.test(text)) text = historyCurrency.format(Number(text.replace(',', '.')));
    if (key === 'startsAt' && Number.isFinite(Date.parse(text))) text = fmtDate(text);
    if (key === 'durationMin' && /^\d+$/.test(text)) text += ' min';
    if (key === 'orientation_mode') text = ({weekly:'Por semana',single:'Única'})[text] || text;
    return esc(text.replace(historyUuid, '').trim());
  }
  return Object.entries(value).map(([field, entry]) => {
    if (/(?:^id$|Ids?$|_ids?$|^uuid$|^babyTarget$|^version$)/.test(field)) return '';
    const body = clinicalFieldValue(entry, babies, field);
    if (!body) return '';
    const label = key === 'byBaby'
      ? babies.find(baby => baby.id === field)?.name || 'Bebê'
      : encounterFieldLabels[field] || (field.includes(' ') ? field.replace(historyUuid, '') : 'Registro complementar');
    return `<div class="pw-history-field"><strong>${esc(label)}</strong><div>${body}</div></div>`;
  }).join('');
}

function historySections(row, babies) {
  const prenatal = isPrenatal(row.identification?.appointmentType);
  const sections = [];
  const maternal = row.maternal_assessment && typeof row.maternal_assessment === 'object'
    ? {...row.maternal_assessment} : row.maternal_assessment;
  if (prenatal) {
    const answers = parsePrenatalAnswers(maternal?.prenatalAnswers);
    const titles = ['Informações iniciais', 'Histórico e saúde', 'Gestação e expectativas', 'Origem do atendimento', 'Declarações e autorização'];
    titles.forEach((title, index) => {
      const fields = PRENATAL_QUESTIONS.filter(question => question.step === index + 2).map(question => {
        const html = clinicalFieldValue(answers[question.key], babies, question.key);
        return html ? `<div class="pw-history-field"><strong>${esc(question.title)}</strong><div>${html}</div></div>` : '';
      });
      sections.push([title, fields.join('')]);
    });
    if (maternal && typeof maternal === 'object') delete maternal.prenatalAnswers;
  }
  for (const [title, key] of encounterSections.slice(1)) {
    if (key === 'clinical_note') continue;
    const value = prenatal && key === 'maternal_assessment' ? maternal : row[key];
    const html = clinicalFieldValue(value, babies, key);
    if (!prenatal || html) sections.push([title, html]);
  }
  const status = row.status === 'finalized' ? 'Finalizado' : 'Em andamento';
  const finished = row.finalized_at ? ' · ' + esc(fmtDate(row.finalized_at)) : '';
  const finalFields = clinicalFieldValue(row.finalization, babies);
  const end = ['Finalização', status + finished + finalFields];
  const note = ['Prontuário', clinicalFieldValue(row.clinical_note, babies)];
  return prenatal ? [...sections, end, note] : [...sections, note, end];
}

function bindEncounterHistory(container, selector, motherId, data) {
  for (const button of container.querySelectorAll(selector)) {
    button.setAttribute('aria-haspopup', 'dialog');
    button.onclick = async () => {
      if (container.querySelector('dialog[open]')) return;
      const id = button.dataset.pwRecord || button.dataset.pwOpenRecord;
      const dialog = document.createElement('dialog');
      dialog.className = 'pw-history-dialog';
      dialog.setAttribute('aria-labelledby', 'pw-history-title');
      dialog.innerHTML = `<header><div><h2 id="pw-history-title">Consulta do atendimento</h2><p></p></div><button type="button" class="pw-back" aria-label="Fechar consulta" autofocus>×</button></header><div class="pw-history-body" aria-live="polite">Carregando atendimento…</div>`;
      container.append(dialog);
      dialog.querySelector('header button').onclick = () => dialog.close();
      dialog.addEventListener('keydown', event => event.stopPropagation());
      dialog.addEventListener('close', () => dialog.remove(), {once:true});
      dialog.showModal();
      const body = dialog.querySelector('.pw-history-body');
      async function loadRecord() {
        body.textContent = 'Carregando atendimento…';
        try {
          const rows = await DOC.rest(`clinical_encounters?id=eq.${encodeURIComponent(id)}&mother_id=eq.${encodeURIComponent(motherId)}&select=id,mother_id,baby_id,occurred_at,updated_at,identification,chief_complaint,maternal_assessment,baby_assessment,feeding_assessment,care_plan,clinical_note,finalization,status,finalized_at&limit=1`);
          if (!dialog.open || !dialog.isConnected || DOC.currentMotherId() !== motherId) return;
          const row = rows?.[0];
          if (!row || row.id !== id || row.mother_id !== motherId) throw new Error();
          const info = row.identification || {};
          dialog.querySelector('header p').textContent = [fmtDate(row.occurred_at || row.updated_at), encounterBabyNames(data,row)].join(' · ');
          const sections = historySections(row, data.ctx.babies);
          const summaryKeys = ['appointmentType','format','durationMin','startsAt','value','address'];
          const remainingInfo = Object.fromEntries(Object.entries(info).filter(([key]) => !summaryKeys.includes(key)));
          const otherInfo = clinicalFieldValue(remainingInfo, data.ctx.babies);
          if (otherInfo) sections.unshift(['Outros dados da identificação', otherInfo]);
          const identification = summaryKeys
            .map(key => [encounterFieldLabels[key], clinicalFieldValue(info[key], data.ctx.babies, key)])
            .filter(([, html]) => html);
          body.innerHTML = identification.length ? `<h3>Identificação</h3><dl>${identification.map(([label, html]) =>
            `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>`).join('')}</dl>` : '';
          body.insertAdjacentHTML('beforeend', sections.map(([label, html], index) =>
            `<details ${index === sections.findIndex(([, content]) => content) ? 'open' : ''}><summary>${label}</summary><div class="pw-history-values">${html || 'Sem registro neste atendimento.'}</div></details>`).join(''));
          const footer = document.createElement('footer');
          footer.innerHTML = '<button type="button" class="pw-primary">Abrir prontuário e adendos</button>';
          dialog.append(footer);
          footer.firstElementChild.onclick = async () => {
            const editor = window.DeboraClinicalNote;
            if (!editor?.openEncounter) return DOC.toast('Editor ainda indisponível. Tente novamente.', 'error');
            dialog.close();
            try { await editor.openEncounter(id, {direction:'history'}); }
            catch { DOC.toast('Não foi possível abrir o prontuário. Tente novamente.', 'error'); }
          };
        } catch {
          if (!dialog.open || !dialog.isConnected) return;
          body.innerHTML = '<p>Não foi possível carregar o atendimento.</p><button type="button" class="pw-primary">Tentar novamente</button>';
          body.querySelector('button').onclick = loadRecord;
        }
      }
      await loadRecord();
    };
  }
}

async function renderRecords(motherId,content){
  const data=await encounterData(motherId);content.innerHTML=`<div class="pw-toolbar"><div><strong>Prontuários</strong><span>${data.rows.length} ${data.rows.length===1?'atendimento':'atendimentos'}</span></div></div><div class="pw-filters"><label>Bebê<select data-pw-record-baby><option value="">Todos</option>${data.ctx.babies.map(b=>`<option value="${b.id}" ${b.id===data.ctx.activeBabyId?'selected':''}>${esc(b.name)}</option>`).join('')}</select></label></div><div class="pw-document-list" data-pw-record-list></div>`;const select=content.querySelector('[data-pw-record-baby]'),list=content.querySelector('[data-pw-record-list]');function matches(row,id){if(!id)return true;return row.baby_id===id||data.links.some(link=>link.encounter_id===row.id&&link.baby_id===id)}function draw(){const filtered=data.rows.filter(row=>matches(row,select.value));list.innerHTML=filtered.length?filtered.map(row=>`<button type="button" data-pw-record="${row.id}"><div><strong>${row.status==='finalized'?'Atendimento finalizado':'Atendimento em andamento'}</strong><small>${esc(fmtDate(row.occurred_at||row.updated_at))} · ${esc(encounterBabyNames(data,row))}</small></div><b>›</b></button>`).join(''):'<div class="pw-empty"><strong>Nenhum prontuário</strong><span>Não há atendimento para este recorte.</span></div>';bindEncounterHistory(list,'[data-pw-record]',motherId,data)}select.onchange=draw;draw();
}

async function open(kind,motherId=DOC.currentMotherId(),trigger=document.activeElement){
  if(!motherId)return DOC.toast('Paciente não identificada.','error');lastTrigger=trigger||document.activeElement;current={kind,motherId};const meta={album:['REGISTROS','Álbum clínico','Fotos organizadas por paciente, bebê, categoria e data.'],referrals:['DOCUMENTOS','Encaminhamentos','Crie, revise e consulte encaminhamentos profissionais.'],terms:['DOCUMENTOS','Termos e autorizações','Consulte consentimentos e gere PDFs quando necessário.'],records:['REGISTRO CLÍNICO','Prontuários','Selecione um atendimento para consultar.']}[kind];if(!meta)return;const content=shell(...meta);try{if(kind==='album')await renderAlbum(motherId,content);if(kind==='referrals')await renderReferrals(motherId,content);if(kind==='terms')await renderTerms(motherId,content);if(kind==='records')await renderRecords(motherId,content)}catch(error){content.innerHTML=`<div class="pw-empty"><strong>Não foi possível carregar</strong><span>${esc(error.message||'Tente novamente.')}</span></div>`}
}

async function openSecondaryActions(motherId,trigger){
  lastTrigger=trigger;
  await context(motherId);
  const screen=document.querySelector('[data-screen="patient"]');
  const route=screen?.querySelector('[data-action="patient-route"]');
  const edit=screen?.querySelector('[data-action="edit-patient"]');
  const content=shell('PACIENTE','Mais ações','Ações menos frequentes ficam reunidas aqui para manter a ficha limpa.');
  content.innerHTML=`<div class="pw-action-list"><button type="button" data-pw-route><strong>Rota</strong><span>${route?'Abrir rota do próximo atendimento ou endereço cadastrado':'Rota indisponível'}</span><b>›</b></button>${edit?'<button type="button" data-pw-edit><strong>Editar cadastro</strong><span>Dados da mãe, bebê e autorizações</span><b>›</b></button>':''}</div>`;
  content.querySelector('[data-pw-route]').onclick=()=>{if(!route){DOC.toast('Rota indisponível.','error');return}close();route.click()};
  if(edit)content.querySelector('[data-pw-edit]').onclick=()=>{close();edit.click()};
}

async function mountRecent(motherId){
  const active=DOC.currentBabyId()||'',key=`${motherId}|${active}`;
  expectedSummaryKey=key;
  return summaryFlight(key,async()=>{
    const screen=document.querySelector('[data-screen="patient"]');if(!screen)return;
    const existing=screen.querySelector('[data-pw-recent]');if(existing?.dataset.pwKey===key)return;
    const data=await encounterData(motherId);
    const currentScreen=document.querySelector('[data-screen="patient"]');
    if(expectedSummaryKey!==key||DOC.currentMotherId()!==motherId||(DOC.currentBabyId()||'')!==active||currentScreen!==screen||!screen.isConnected)return;
    const afterAwait=screen.querySelector('[data-pw-recent]');if(afterAwait?.dataset.pwKey===key)return;afterAwait?.remove();
    const rows=data.rows.filter(row=>!active||row.baby_id===active||data.links.some(link=>link.encounter_id===row.id&&link.baby_id===active)).slice(0,3),card=document.createElement('section');card.className='pw-recent';card.dataset.pwRecent='1';card.dataset.pwKey=key;card.innerHTML=`<div class="pw-recent-head"><div><small>REGISTRO CLÍNICO</small><h2>Prontuários recentes</h2></div><button type="button" data-pw-all-records>Ver todos</button></div>${rows.length?`<div class="pw-recent-list">${rows.map(row=>`<button type="button" data-pw-open-record="${row.id}"><div><strong>${row.status==='finalized'?'Atendimento finalizado':'Atendimento em andamento'}</strong><small>${esc(fmtDate(row.occurred_at||row.updated_at))} · ${esc(encounterBabyNames(data,row))}</small></div><b>›</b></button>`).join('')}</div>`:'<div class="pw-empty compact"><span>Nenhum prontuário neste recorte.</span></div>'}`;card.querySelector('[data-pw-all-records]').onclick=event=>open('records',motherId,event.currentTarget);bindEncounterHistory(card,'[data-pw-open-record]',motherId,data);const hub=screen.querySelector('[data-prh-card]'),hiddenRecords=screen.querySelector('[data-pf-prontuario]');if(hub)hub.after(card);else if(hiddenRecords)hiddenRecords.before(card);else screen.appendChild(card)
  });
}
function scheduleSummary(){clearTimeout(summaryTimer);summaryTimer=setTimeout(()=>{const motherId=DOC.currentMotherId();if(!motherId){expectedSummaryKey='';return}mountRecent(motherId).catch(()=>{})},120)}
window.addEventListener('debora:patient-context',scheduleSummary);
window.addEventListener('debora:clinical-document-saved',event=>{const detail=event.detail||{};if(detail.documentType==='referral'&&detail.motherId&&referralView?.motherId===detail.motherId)referralView?.upsert(detail.document);scheduleSummary()});
window.addEventListener('debora:clinical-document-finalized',scheduleSummary);window.addEventListener('debora:record-exported',scheduleSummary);new MutationObserver(scheduleSummary).observe(document.documentElement,{subtree:true,childList:true});setTimeout(scheduleSummary,250);
for(const type of ['clinical.document.finalized','clinical.record.exported','clinical.encounter.saved','clinical.media.uploaded','weight.recorded'])window.DeboraEvents?.subscribe?.(type,scheduleSummary);

window.DeboraPatientWorkspace={open,close,refresh:scheduleSummary,openMoreActions:openSecondaryActions};
