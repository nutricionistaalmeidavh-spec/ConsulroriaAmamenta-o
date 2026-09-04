const DOC=window.DeboraDocuments;
const CATEGORIES=['Mama','Pega','Posição','Bebê','Língua/oral','Lesão','Evolução','Documento','Outro'];
let currentMother='',layer=null,lastTrigger=null;

const fmtDate=value=>{
  if(!value)return 'Sem data';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(d);
};
const safeFileName=value=>String(value||'foto').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(0,90)||'foto';
const byId=(items,id)=>items.find(item=>item.id===id)||null;

function close(){if(!layer)return;layer.remove();layer=null;requestAnimationFrame(()=>lastTrigger?.focus?.())}
function trap(event){
  if(event.key==='Escape'){event.preventDefault();close();return}
  if(event.key!=='Tab'||!layer)return;
  const focusables=[...layer.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];
  if(!focusables.length)return;
  const first=focusables[0],last=focusables.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
function sheet(title,body){
  close();
  layer=document.createElement('div');layer.className='af-layer';
  layer.innerHTML=`<div class="af-backdrop" data-af-close></div><section class="af-sheet" role="dialog" aria-modal="true" aria-labelledby="af-title"><header><div><small>ÁLBUM CLÍNICO</small><h2 id="af-title">${DOC.escapeHTML(title)}</h2></div><button type="button" class="af-close" data-af-close aria-label="Fechar">×</button></header>${body}</section>`;
  document.body.appendChild(layer);layer.addEventListener('keydown',trap);layer.querySelectorAll('[data-af-close]').forEach(x=>x.addEventListener('click',close));requestAnimationFrame(()=>layer.querySelector('.af-close')?.focus());return layer.querySelector('.af-sheet');
}
async function mediaRows(motherId){
  return await DOC.rest(`clinical_media?mother_id=eq.${encodeURIComponent(motherId)}&select=*&order=taken_at.desc,created_at.desc&limit=100`)||[];
}
async function signed(storagePath){
  try{return await DOC.signedClinicalMediaUrl(storagePath,900)}catch{return ''}
}
async function cardMarkup(motherId,rows,context){
  const recent=rows.slice(0,6);
  const thumbs=await Promise.all(recent.map(async row=>({row,url:await signed(row.storage_path)})));
  return `<section class="af-card" data-af-card data-af-mother="${motherId}">
    <div class="af-head"><div><small>REGISTROS</small><h2>Álbum clínico</h2><p>Fotos privadas vinculadas à paciente, bebê e atendimento quando houver contexto clínico.</p></div><button type="button" class="af-primary" data-af-add>Adicionar foto</button></div>
    ${thumbs.length?`<div class="af-grid">${thumbs.map(({row,url})=>`<button type="button" class="af-thumb" data-af-open="${row.id}" aria-label="Abrir ${DOC.escapeHTML(row.category||'foto clínica')}">${url?`<img src="${DOC.escapeHTML(url)}" alt="">`:'<span>Imagem clínica</span>'}<b>${DOC.escapeHTML(row.category||'Outro')}</b><small>${DOC.escapeHTML(fmtDate(row.taken_at||row.created_at))}</small></button>`).join('')}</div>`:`<div class="af-empty"><strong>Nenhuma foto clínica registrada</strong><span>O álbum será organizado por data e contexto do atendimento.</span></div>`}
    ${rows.length>6?`<div class="af-more">${rows.length} registros no total</div>`:''}
  </section>`;
}
async function openDetail(motherId,id,trigger){
  lastTrigger=trigger||document.activeElement;
  const [rows,context]=await Promise.all([mediaRows(motherId),DOC.patientContext(motherId)]);
  const row=rows.find(item=>item.id===id);if(!row||!context)throw new Error('Registro de imagem não encontrado.');
  const url=await signed(row.storage_path),baby=byId(context.babies,row.baby_id);
  sheet(row.category||'Imagem clínica',`<div class="af-detail">${url?`<img src="${DOC.escapeHTML(url)}" alt="Imagem clínica da paciente">`:'<div class="af-unavailable">Prévia indisponível.</div>'}<dl><div><dt>Paciente</dt><dd>${DOC.escapeHTML(context.mother.name)}</dd></div><div><dt>Bebê</dt><dd>${DOC.escapeHTML(baby?.name||'Não vinculado')}</dd></div><div><dt>Data</dt><dd>${DOC.escapeHTML(fmtDate(row.taken_at||row.created_at))}</dd></div><div><dt>Atendimento</dt><dd>${DOC.escapeHTML(row.encounter_id?`${row.encounter_id.slice(0,8)}…`:'Não vinculado')}</dd></div></dl>${row.caption?`<p>${DOC.escapeHTML(row.caption)}</p>`:''}</div>`);
}
async function requireClinicalMediaConsent(motherId){
  const rows=await DOC.consents(motherId);
  const consent=rows.find(row=>row.consent_type==='clinical_media');
  if(!consent?.granted||consent?.revoked_at)throw new Error('A autorização para fotos e documentos clínicos não está ativa. Atualize o consentimento em Editar cadastro antes de adicionar imagens.');
  return consent;
}
async function openUploader(motherId,trigger){
  lastTrigger=trigger||document.activeElement;
  const context=await DOC.patientContext(motherId);if(!context)throw new Error('Paciente não encontrada.');
  await requireClinicalMediaConsent(motherId);
  const active=context.activeBabyId||context.babies[0]?.id||'';
  const latest=await DOC.latestEncounter(motherId,active).catch(()=>null);
  const form=sheet('Adicionar foto',`<form class="af-form" data-af-form>
    <label><span>Imagem clínica</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" required data-af-file></label>
    <label><span>Categoria</span><select data-af-category>${CATEGORIES.map(item=>`<option>${DOC.escapeHTML(item)}</option>`).join('')}</select></label>
    <label><span>Bebê relacionado</span><select data-af-baby><option value="">Sem vínculo específico</option>${context.babies.map(b=>`<option value="${b.id}" ${b.id===active?'selected':''}>${DOC.escapeHTML(b.name)}</option>`).join('')}</select></label>
    <label><span>Observação clínica</span><textarea rows="3" maxlength="800" data-af-caption placeholder="Contexto da imagem, achado observado ou evolução."></textarea></label>
    <label class="af-check"><input type="checkbox" ${latest?'checked':''} ${latest?'':'disabled'} data-af-link-encounter><span>${latest?'Vincular ao atendimento mais recente deste bebê':'Nenhum atendimento recente disponível para vínculo'}</span></label>
    <div class="af-actions"><button type="button" class="af-secondary" data-af-close>Cancelar</button><button type="submit" class="af-primary">Salvar no álbum</button></div>
  </form>`);
  form.querySelectorAll('[data-af-close]').forEach(x=>x.addEventListener('click',close));
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=form.querySelector('button[type="submit"]'),file=form.querySelector('[data-af-file]').files?.[0];
    if(!file)return DOC.toast('Selecione uma imagem.','error');
    if(file.size>12*1024*1024)return DOC.toast('A imagem deve ter no máximo 12 MB.','error');
    button.disabled=true;button.textContent='Salvando…';
    const owner=DOC.userId(),babyId=form.querySelector('[data-af-baby]').value||null;
    let encounter=latest;
    if(babyId&&babyId!==active)encounter=await DOC.latestEncounter(motherId,babyId).catch(()=>null);
    if(!form.querySelector('[data-af-link-encounter]').checked)encounter=null;
    const storagePath=`${owner}/patient-album/${motherId}/${Date.now()}-${safeFileName(file.name)}`;
    try{
      await DOC.uploadClinicalMedia(storagePath,file);
      try{
        await DOC.rest('clinical_media',{method:'POST',headers:{Prefer:'return=representation'},body:{
          mother_id:motherId,baby_id:babyId,appointment_id:encounter?.appointment_id||null,encounter_id:encounter?.id||null,
          storage_path:storagePath,mime_type:file.type||'application/octet-stream',file_name:file.name||'imagem',file_size:file.size,
          category:form.querySelector('[data-af-category]').value||'Outro',caption:form.querySelector('[data-af-caption]').value.trim(),taken_at:new Date().toISOString()
        }});
      }catch(error){await DOC.deleteClinicalMedia(storagePath).catch(()=>{});throw error}
      close();DOC.toast('Foto adicionada ao álbum.');currentMother='';await mount(motherId);
    }catch(error){DOC.toast(error.message||'Não foi possível salvar a imagem.','error');button.disabled=false;button.textContent='Salvar no álbum'}
  });
}
async function mount(motherId){
  if(!motherId||motherId===currentMother&&document.querySelector('[data-af-card]'))return;
  currentMother=motherId;document.querySelectorAll('[data-af-card]').forEach(x=>x.remove());
  const screen=document.querySelector('[data-screen="patient"]');if(!screen)return;
  try{
    const [rows,context]=await Promise.all([mediaRows(motherId),DOC.patientContext(motherId)]);if(!context)return;
    const wrap=document.createElement('div');wrap.innerHTML=await cardMarkup(motherId,rows,context);const card=wrap.firstElementChild;
    const terms=screen.querySelector('[data-df-terms-card]'),target=terms||screen.querySelector('[data-pf-prontuario]')||screen.querySelector('.patient-detail-grid')||screen.lastElementChild;
    target?.after?target.after(card):screen.appendChild(card);
    card.querySelector('[data-af-add]')?.addEventListener('click',event=>openUploader(motherId,event.currentTarget).catch(e=>DOC.toast(e.message||'Não foi possível abrir o álbum.','error')));
    card.querySelectorAll('[data-af-open]').forEach(btn=>btn.addEventListener('click',()=>openDetail(motherId,btn.dataset.afOpen,btn).catch(e=>DOC.toast(e.message||'Não foi possível abrir a imagem.','error'))));
  }catch(error){
    if(/clinical_media|schema cache|relation .* does not exist/i.test(error.message||''))return;
    if(!/Sessão não encontrada/.test(error.message||''))DOC.toast(error.message||'Não foi possível carregar o álbum.','error');
  }
}
window.addEventListener('debora:patient-context',event=>{const motherId=event.detail?.motherId;if(motherId)mount(motherId);else{currentMother='';document.querySelectorAll('[data-af-card]').forEach(x=>x.remove())}});
window.DeboraAlbum={refresh:()=>{currentMother='';const id=DOC.currentMotherId();if(id)mount(id)},openUploader};
