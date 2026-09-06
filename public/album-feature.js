const DOC=window.DeboraDocuments;
const CATEGORIES=['Mama','Pega','Posição','Bebê','Língua/oral','Lesão','Evolução','Documento','Outro'];
const IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
const VIDEO_TYPES=new Set(['video/mp4','video/quicktime','video/webm']);
const IMAGE_EXTENSIONS=new Set(['jpg','jpeg','png','webp','heic','heif']);
const VIDEO_EXTENSIONS=new Set(['mp4','mov','webm']);
const IMAGE_MAX_BYTES=12*1024*1024;
const VIDEO_MAX_BYTES=50*1024*1024;
let currentMother='',layer=null,lastTrigger=null;

const fmtDate=value=>{
  if(!value)return 'Sem data';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(d);
};
const safeFileName=value=>String(value||'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(0,90)||'arquivo';
const byId=(items,id)=>items.find(item=>item.id===id)||null;
const extOf=name=>String(name||'').toLowerCase().split('.').pop()||'';
const isVideoRow=row=>String(row?.mime_type||'').toLowerCase().startsWith('video/');
const isVideoFile=file=>String(file?.type||'').toLowerCase().startsWith('video/')||VIDEO_EXTENSIONS.has(extOf(file?.name));

function validateMediaFile(file){
  if(!file)throw new Error('Selecione uma foto ou vídeo.');
  const type=String(file.type||'').toLowerCase(),ext=extOf(file.name),video=isVideoFile(file);
  if(video){
    if(type&&!VIDEO_TYPES.has(type)&&!VIDEO_EXTENSIONS.has(ext))throw new Error('Formato de vídeo não suportado. Use MP4, MOV ou WebM.');
    if(file.size>VIDEO_MAX_BYTES)throw new Error('O vídeo deve ter no máximo 50 MB.');
    return 'video';
  }
  if(type&&!IMAGE_TYPES.has(type)&&!IMAGE_EXTENSIONS.has(ext))throw new Error('Formato de imagem não suportado. Use JPG, PNG, WebP, HEIC ou HEIF.');
  if(!type&&!IMAGE_EXTENSIONS.has(ext))throw new Error('Formato de arquivo não suportado.');
  if(file.size>IMAGE_MAX_BYTES)throw new Error('A imagem deve ter no máximo 12 MB.');
  return 'image';
}

function close(){if(!layer)return;layer.remove();layer=null;requestAnimationFrame(()=>lastTrigger?.focus?.())}
function trap(event){
  if(event.key==='Escape'){event.preventDefault();close();return}
  if(event.key!=='Tab'||!layer)return;
  const focusables=[...layer.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),video[controls]')];
  if(!focusables.length)return;
  const first=focusables[0],last=focusables.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
function sheet(title,body){
  close();
  layer=document.createElement('div');layer.className='af-layer';
  layer.innerHTML=`<div class="af-backdrop" data-af-close></div><section class="af-sheet" role="dialog" aria-modal="true" aria-labelledby="af-title"><header><div><small>BIBLIOTECA CLÍNICA</small><h2 id="af-title">${DOC.escapeHTML(title)}</h2></div><button type="button" class="af-close" data-af-close aria-label="Fechar">×</button></header>${body}</section>`;
  document.body.appendChild(layer);layer.addEventListener('keydown',trap);layer.querySelectorAll('[data-af-close]').forEach(x=>x.addEventListener('click',close));requestAnimationFrame(()=>layer.querySelector('.af-close')?.focus());return layer.querySelector('.af-sheet');
}
async function mediaRows(motherId){
  return await DOC.rest(`clinical_media?mother_id=eq.${encodeURIComponent(motherId)}&select=*&order=taken_at.desc,created_at.desc&limit=100`)||[];
}
async function signed(storagePath){
  try{return await DOC.signedClinicalMediaUrl(storagePath,900)}catch{return ''}
}
function thumbMedia(row,url){
  if(isVideoRow(row))return `<span class="af-video-frame">${url?`<video src="${DOC.escapeHTML(url)}" preload="metadata" muted playsinline aria-hidden="true"></video>`:'<span class="af-media-placeholder">Vídeo clínico</span>'}<span class="af-play" aria-hidden="true">▶</span></span>`;
  return url?`<img src="${DOC.escapeHTML(url)}" alt="">`:'<span class="af-media-placeholder">Imagem clínica</span>';
}
async function cardMarkup(motherId,rows){
  const recent=rows.slice(0,6);
  const thumbs=await Promise.all(recent.map(async row=>({row,url:await signed(row.storage_path)})));
  return `<section class="af-card" data-af-card data-af-mother="${motherId}">
    <div class="af-head"><div><small>REGISTROS</small><h2>Biblioteca clínica</h2><p>Fotos e vídeos privados vinculados à paciente, bebê e atendimento quando houver contexto clínico.</p></div><button type="button" class="af-primary" data-af-add>Adicionar foto ou vídeo</button></div>
    ${thumbs.length?`<div class="af-grid">${thumbs.map(({row,url})=>`<button type="button" class="af-thumb" data-af-open="${row.id}" aria-label="Abrir ${DOC.escapeHTML(row.category||'mídia clínica')}">${thumbMedia(row,url)}<b>${DOC.escapeHTML(row.category||'Outro')}</b><small>${isVideoRow(row)?'Vídeo · ':'Foto · '}${DOC.escapeHTML(fmtDate(row.taken_at||row.created_at))}</small></button>`).join('')}</div>`:`<div class="af-empty"><strong>Nenhuma mídia clínica registrada</strong><span>Fotos e vídeos serão organizados por data e contexto do atendimento.</span></div>`}
    ${rows.length>6?`<div class="af-more">${rows.length} registros no total</div>`:''}
  </section>`;
}
async function openDetail(motherId,id,trigger){
  lastTrigger=trigger||document.activeElement;
  const [rows,context]=await Promise.all([mediaRows(motherId),DOC.patientContext(motherId)]);
  const row=rows.find(item=>item.id===id);if(!row||!context)throw new Error('Registro de mídia não encontrado.');
  const url=await signed(row.storage_path),baby=byId(context.babies,row.baby_id),video=isVideoRow(row);
  const preview=url?(video?`<video src="${DOC.escapeHTML(url)}" controls preload="metadata" playsinline aria-label="Vídeo clínico da paciente"></video>`:`<img src="${DOC.escapeHTML(url)}" alt="Imagem clínica da paciente">`):'<div class="af-unavailable">Prévia indisponível.</div>';
  sheet(row.category||'Mídia clínica',`<div class="af-detail">${preview}<dl><div><dt>Tipo</dt><dd>${video?'Vídeo':'Foto'}</dd></div><div><dt>Paciente</dt><dd>${DOC.escapeHTML(context.mother.name)}</dd></div><div><dt>Bebê</dt><dd>${DOC.escapeHTML(baby?.name||'Não vinculado')}</dd></div><div><dt>Data</dt><dd>${DOC.escapeHTML(fmtDate(row.taken_at||row.created_at))}</dd></div><div><dt>Atendimento</dt><dd>${DOC.escapeHTML(row.encounter_id?`${row.encounter_id.slice(0,8)}…`:'Não vinculado')}</dd></div><div><dt>Arquivo</dt><dd>${DOC.escapeHTML(row.file_name||'Sem nome')}</dd></div></dl>${row.caption?`<p>${DOC.escapeHTML(row.caption)}</p>`:''}</div>`);
}
async function requireClinicalMediaConsent(motherId){
  const rows=await DOC.consents(motherId);
  const consent=rows.find(row=>row.consent_type==='clinical_media');
  if(!consent?.granted||consent?.revoked_at)throw new Error('A autorização para fotos, vídeos e documentos clínicos não está ativa. Atualize o consentimento em Editar cadastro antes de adicionar mídia.');
  return consent;
}
async function openUploader(motherId,trigger){
  lastTrigger=trigger||document.activeElement;
  const context=await DOC.patientContext(motherId);if(!context)throw new Error('Paciente não encontrada.');
  await requireClinicalMediaConsent(motherId);
  const active=context.activeBabyId||context.babies[0]?.id||'';
  const latest=await DOC.latestEncounter(motherId,active).catch(()=>null);
  const form=sheet('Adicionar foto ou vídeo',`<form class="af-form" data-af-form>
    <label><span>Foto ou vídeo clínico</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm,.mov" required data-af-file><small class="af-help">Fotos: até 12 MB. Vídeos: MP4, MOV ou WebM, até 50 MB. Arquivos maiores são bloqueados antes do envio.</small></label>
    <label><span>Categoria</span><select data-af-category>${CATEGORIES.map(item=>`<option>${DOC.escapeHTML(item)}</option>`).join('')}</select></label>
    <label><span>Bebê relacionado</span><select data-af-baby><option value="">Sem vínculo específico</option>${context.babies.map(b=>`<option value="${b.id}" ${b.id===active?'selected':''}>${DOC.escapeHTML(b.name)}</option>`).join('')}</select></label>
    <label><span>Observação clínica</span><textarea rows="3" maxlength="800" data-af-caption placeholder="Contexto da foto ou vídeo, achado observado ou evolução."></textarea></label>
    <label class="af-check"><input type="checkbox" ${latest?'checked':''} ${latest?'':'disabled'} data-af-link-encounter><span>${latest?'Vincular ao atendimento mais recente deste bebê':'Nenhum atendimento recente disponível para vínculo'}</span></label>
    <div class="af-progress" data-af-progress hidden><div><span data-af-progress-bar></span></div><small data-af-progress-text>Preparando upload…</small></div>
    <div class="af-actions"><button type="button" class="af-secondary" data-af-close>Cancelar</button><button type="submit" class="af-primary">Salvar na biblioteca</button></div>
  </form>`);
  form.querySelectorAll('[data-af-close]').forEach(x=>x.addEventListener('click',close));
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=form.querySelector('button[type="submit"]'),file=form.querySelector('[data-af-file]').files?.[0];
    let kind;
    try{kind=validateMediaFile(file)}catch(error){DOC.toast(error.message,'error');return}
    button.disabled=true;button.textContent='Preparando…';
    const owner=DOC.userId(),babyId=form.querySelector('[data-af-baby]').value||null;
    let encounter=latest;
    if(babyId&&babyId!==active)encounter=await DOC.latestEncounter(motherId,babyId).catch(()=>null);
    if(!form.querySelector('[data-af-link-encounter]').checked)encounter=null;
    const storagePath=`${owner}/patient-album/${motherId}/${Date.now()}-${safeFileName(file.name)}`;
    const progress=form.querySelector('[data-af-progress]'),bar=form.querySelector('[data-af-progress-bar]'),progressText=form.querySelector('[data-af-progress-text]');
    try{
      progress.hidden=false;
      await DOC.uploadClinicalMedia(storagePath,file,value=>{
        const pct=Math.max(0,Math.min(100,Number(value)||0));
        bar.style.width=`${pct}%`;progressText.textContent=`Enviando ${kind==='video'?'vídeo':'foto'}… ${pct}%`;button.textContent=`Enviando… ${pct}%`;
      });
      try{
        await DOC.rest('clinical_media',{method:'POST',headers:{Prefer:'return=representation'},body:{
          mother_id:motherId,baby_id:babyId,appointment_id:encounter?.appointment_id||null,encounter_id:encounter?.id||null,
          storage_path:storagePath,mime_type:file.type||(kind==='video'?'video/mp4':'application/octet-stream'),file_name:file.name||(kind==='video'?'video':'imagem'),file_size:file.size,
          category:form.querySelector('[data-af-category]').value||'Outro',caption:form.querySelector('[data-af-caption]').value.trim(),taken_at:new Date().toISOString()
        }});
      }catch(error){await DOC.deleteClinicalMedia(storagePath).catch(()=>{});throw error}
      close();DOC.toast(kind==='video'?'Vídeo adicionado à biblioteca.':'Foto adicionada à biblioteca.');currentMother='';await mount(motherId);
    }catch(error){DOC.toast(error.message||'Não foi possível salvar a mídia.','error');button.disabled=false;button.textContent='Salvar na biblioteca';progress.hidden=true}
  });
}
async function mount(motherId){
  if(!motherId||motherId===currentMother&&document.querySelector('[data-af-card]'))return;
  currentMother=motherId;document.querySelectorAll('[data-af-card]').forEach(x=>x.remove());
  const screen=document.querySelector('[data-screen="patient"]');if(!screen)return;
  try{
    const [rows,context]=await Promise.all([mediaRows(motherId),DOC.patientContext(motherId)]);if(!context)return;
    const wrap=document.createElement('div');wrap.innerHTML=await cardMarkup(motherId,rows);const card=wrap.firstElementChild;
    const terms=screen.querySelector('[data-df-terms-card]'),target=terms||screen.querySelector('[data-pf-prontuario]')||screen.querySelector('.patient-detail-grid')||screen.lastElementChild;
    target?.after?target.after(card):screen.appendChild(card);
    card.querySelector('[data-af-add]')?.addEventListener('click',event=>openUploader(motherId,event.currentTarget).catch(e=>DOC.toast(e.message||'Não foi possível abrir a biblioteca.','error')));
    card.querySelectorAll('[data-af-open]').forEach(btn=>btn.addEventListener('click',()=>openDetail(motherId,btn.dataset.afOpen,btn).catch(e=>DOC.toast(e.message||'Não foi possível abrir a mídia.','error'))));
  }catch(error){
    if(/clinical_media|schema cache|relation .* does not exist/i.test(error.message||''))return;
    if(!/Sessão não encontrada/.test(error.message||''))DOC.toast(error.message||'Não foi possível carregar a biblioteca clínica.','error');
  }
}
window.addEventListener('debora:patient-context',event=>{const motherId=event.detail?.motherId;if(motherId)mount(motherId);else{currentMother='';document.querySelectorAll('[data-af-card]').forEach(x=>x.remove())}});
window.DeboraAlbum={refresh:()=>{currentMother='';const id=DOC.currentMotherId();if(id)mount(id)},openUploader};