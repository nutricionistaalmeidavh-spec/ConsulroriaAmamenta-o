const E=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const state={theme:'Todos',query:'',purpose:'',style:'',sort:'featured',installed:new Set(),active:null};
const cache=new Map();
let runtimePromise;
async function ensureRuntime(){
  if(window.__DDS_DATA__&&window.DDSPdfEngine)return;
  if(!runtimePromise)runtimePromise=fetch('./template-runtime.js.gz',{cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error('Não foi possível carregar a galeria de templates.');const stream=response.body.pipeThrough(new DecompressionStream('gzip')),source=await new Response(stream).text();Function(source)();if(!window.__DDS_DATA__||!window.DDSPdfEngine)throw new Error('Motor de templates indisponível.');});
  return runtimePromise;
}
const data=()=>window.__DDS_DATA__||{templates:[],themes:[],sampleData:{},brandKits:[]};
const templates=()=>data().templates||[];
const themeOrder=()=>Object.fromEntries((data().themes||[]).map((item,index)=>[item.label,index]));
const defaultTarget=template=>['Clínico','Wellness','Educacional'].includes(template.theme)?'orientation':['Corporativo','Formal','Premium'].includes(template.theme)?'report':'general';
const brand=()=>data().brandKits?.find(item=>item.id==='neutral')||data().brandKits?.[0]||{};

function filtered(){
  const order=themeOrder();
  return templates().filter(template=>{
    if(state.theme!=='Todos'&&template.theme!==state.theme)return false;
    if(state.purpose&&template.category!==state.purpose)return false;
    if(state.style&&template.style!==state.style)return false;
    if(state.query&&!`${template.name} ${template.theme} ${template.category} ${template.style}`.toLocaleLowerCase('pt-BR').includes(state.query))return false;
    return true;
  }).sort((a,b)=>state.sort==='theme'?(order[a.theme]??99)-(order[b.theme]??99)||a.name.localeCompare(b.name,'pt-BR'):state.sort==='pages'?(b.pages?.length||1)-(a.pages?.length||1)||a.name.localeCompare(b.name,'pt-BR'):a.name.localeCompare(b.name,'pt-BR'));
}

function options(values,label){return `<option value="">${label}</option>${values.map(value=>`<option value="${E(value)}">${E(value)}</option>`).join('')}`}
function card(template){
  const installed=state.installed.has(template.name.toLocaleLowerCase('pt-BR'));
  return `<article class="dtg-card" data-id="${E(template.id)}"><button class="dtg-preview" type="button" data-preview aria-label="Visualizar ${E(template.name)}"><span class="dtg-theme">${E(template.theme)}</span><span class="dtg-pages">${template.pages?.length||1} pág.</span><div class="dtg-paper" style="--accent:${E(template.accent||'#395e4a')}"><i></i><b>${E(template.name)}</b><small>${E(template.category)}</small></div></button><div class="dtg-card-body"><div><strong>${E(template.name)}</strong><small>${E(template.category)} · ${E(template.style)}</small></div><div class="dtg-card-actions"><button type="button" data-preview>Visualizar</button><button type="button" class="primary" data-install ${installed?'disabled':''}>${installed?'Adicionado':'Adicionar ao app'}</button></div></div></article>`;
}

function syncFilterToggle(){const shell=document.querySelector('.dtg-shell'),label=document.querySelector('#dtg-filter-state');if(!shell||!label)return;const active=[state.query,state.purpose,state.style,state.sort!=='featured'].filter(Boolean).length;label.textContent=shell.classList.contains('dtg-filters-collapsed')?(active?`${active} ativo${active===1?'':'s'}`:'Mostrar'):'Ocultar'}
function renderGrid(){
  const list=filtered(),grid=document.querySelector('#dtg-grid'),count=document.querySelector('#dtg-count');
  if(!grid)return;
  count.textContent=`${list.length} template${list.length===1?'':'s'}`;syncFilterToggle();
  grid.innerHTML=list.length?list.map(card).join(''):'<div class="dtg-empty"><strong>Nenhum template encontrado</strong><p>Remova um filtro ou tente outro termo.</p><button type="button" data-reset>Limpar filtros</button></div>';
  grid.querySelector('[data-reset]')?.addEventListener('click',reset);
  grid.querySelectorAll('.dtg-card').forEach(node=>{
    const template=templates().find(item=>item.id===node.dataset.id);
    node.querySelectorAll('[data-preview]').forEach(button=>button.addEventListener('click',()=>openPreview(template)));
    node.querySelector('[data-install]')?.addEventListener('click',event=>install(template,event.currentTarget));
    observeThumbnail(node,template);
  });
}

function observeThumbnail(node,template){
  const target=node.querySelector('.dtg-paper');
  if(cache.has(template.id)){applyThumb(target,cache.get(template.id));return}
  const io=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){io.disconnect();makeThumb(template).then(src=>applyThumb(target,src))}},{root:document.querySelector('.dtg-content'),rootMargin:'240px'});
  io.observe(node);
}
function applyThumb(target,src){if(!target||!src)return;target.classList.add('ready');target.innerHTML=`<img src="${src}" alt="">`}
async function makeThumb(template){if(cache.has(template.id))return cache.get(template.id);try{const src=await window.DDSPdfEngine.thumbnail(template,data().sampleData,brand(),{scale:.28});cache.set(template.id,src);return src}catch(error){console.warn('Prévia indisponível',template.id,error);return''}}

async function refreshInstalled(){try{const list=await window.DeboraLibrary?.listTemplates?.()||[];state.installed=new Set(list.map(item=>String(item.name||'').toLocaleLowerCase('pt-BR')))}catch{state.installed=new Set()}}
async function install(template,button){
  if(!window.DeboraLibrary?.installBuiltInTemplate)return;
  button.disabled=true;button.textContent='Adicionando…';
  try{await window.DeboraLibrary.installBuiltInTemplate(template,defaultTarget(template));state.installed.add(template.name.toLocaleLowerCase('pt-BR'));button.textContent='Adicionado';document.querySelector('#dtg-preview-install')?.setAttribute('disabled','');}
  catch(error){button.disabled=false;button.textContent='Tentar novamente';showStatus(error.message||'Não foi possível adicionar o template.');}
}
function showStatus(message){let toast=document.querySelector('#dtg-toast');if(!toast){toast=document.createElement('div');toast.id='dtg-toast';document.body.appendChild(toast)}toast.textContent=message;toast.classList.add('show');clearTimeout(toast._timer);toast._timer=setTimeout(()=>toast.classList.remove('show'),2800)}

async function openPreview(template){
  state.active=template;
  const modal=document.querySelector('#dtg-preview-modal'),image=modal.querySelector('img');
  modal.hidden=false;modal.querySelector('[data-theme]').textContent=template.theme;modal.querySelector('h3').textContent=template.name;modal.querySelector('[data-meta]').textContent=`${template.category} · ${template.style} · ${template.pages?.length||1} página${template.pages?.length===1?'':'s'}`;
  image.removeAttribute('src');image.alt=`Prévia ${template.name}`;modal.querySelector('.dtg-preview-loading').hidden=false;
  const installed=state.installed.has(template.name.toLocaleLowerCase('pt-BR')),button=modal.querySelector('#dtg-preview-install');button.disabled=installed;button.textContent=installed?'Adicionado':'Adicionar ao app';
  const src=await makeThumb(template);if(state.active===template&&src){image.src=src;modal.querySelector('.dtg-preview-loading').hidden=true}
}
function closePreview(){state.active=null;document.querySelector('#dtg-preview-modal').hidden=true}
function reset(){state.theme='Todos';state.query='';state.purpose='';state.style='';state.sort='featured';document.querySelector('#dtg-search').value='';document.querySelector('#dtg-purpose').value='';document.querySelector('#dtg-style').value='';document.querySelector('#dtg-sort').value='featured';syncThemes();renderGrid()}
function syncThemes(){document.querySelectorAll('[data-dtg-theme]').forEach(button=>button.classList.toggle('active',button.dataset.dtgTheme===state.theme))}

async function open(){
  document.querySelector('#dtg-overlay')?.remove();await ensureRuntime();await refreshInstalled();
  const catalog=data(),themeCounts=Object.fromEntries((catalog.themes||[]).map(theme=>[theme.label,templates().filter(item=>item.theme===theme.label).length])),purposes=[...new Set(templates().map(item=>item.category))].sort((a,b)=>a.localeCompare(b,'pt-BR')),styles=[...new Set(templates().map(item=>item.style))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const overlay=document.createElement('div');overlay.id='dtg-overlay';overlay.innerHTML=`<div class="dtg-backdrop" data-close></div><section class="dtg-shell dtg-filters-collapsed" role="dialog" aria-modal="true" aria-labelledby="dtg-title"><header class="dtg-header"><div><span>DOCUMENTOS DA CONSULTORIA</span><h2 id="dtg-title">Templates</h2><p>Explore modelos prontos ou gerencie os templates já adicionados.</p></div><div class="dtg-summary"><strong>${templates().length}</strong><small>templates</small><strong>${catalog.themes?.length||0}</strong><small>temas</small></div><button type="button" class="dtg-library" data-open-center>Meus templates</button><button type="button" class="dtg-close" data-close aria-label="Fechar">×</button></header><nav class="dtg-themes"><button type="button" data-dtg-theme="Todos" class="active"><span>Todos</span><b>${templates().length}</b></button>${(catalog.themes||[]).map(theme=>`<button type="button" data-dtg-theme="${E(theme.label)}"><span>${E(theme.label)}</span><b>${themeCounts[theme.label]||0}</b></button>`).join('')}</nav><button type="button" class="dtg-filter-toggle" aria-expanded="false" aria-controls="dtg-toolbar-fields" data-toggle-filters><span>Busca e filtros</span><b id="dtg-filter-state">Mostrar</b></button><div class="dtg-toolbar" id="dtg-toolbar-fields"><label class="dtg-search"><span>⌕</span><input id="dtg-search" placeholder="Buscar por nome, finalidade ou estilo"></label><select id="dtg-purpose">${options(purposes,'Todas as finalidades')}</select><select id="dtg-style">${options(styles,'Todos os estilos')}</select><select id="dtg-sort"><option value="featured">Destaques primeiro</option><option value="name">Nome: A–Z</option><option value="theme">Agrupar por tema</option><option value="pages">Mais páginas</option></select><button type="button" class="dtg-clear" data-reset>Limpar</button></div><div class="dtg-result"><strong id="dtg-count"></strong><span>Os modelos são adicionados como PDF e continuam editáveis na galeria original.</span></div><div class="dtg-content"><div id="dtg-grid" class="dtg-grid"></div></div></section><section id="dtg-preview-modal" class="dtg-preview-modal" hidden><div class="dtg-preview-backdrop" data-preview-close></div><article><button type="button" class="dtg-close" data-preview-close aria-label="Fechar prévia">×</button><div class="dtg-preview-stage"><div class="dtg-preview-loading">Gerando prévia…</div><img alt=""></div><div class="dtg-preview-info"><span data-theme></span><h3></h3><p data-meta></p><ul><li>Campos dinâmicos</li><li>Brand Kit</li><li>PDF multipágina quando aplicável</li></ul><div><button type="button" id="dtg-download">Gerar PDF de exemplo</button><button type="button" class="primary" id="dtg-preview-install">Adicionar ao app</button></div></div></article></section>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>overlay.remove()));
  overlay.querySelectorAll('[data-dtg-theme]').forEach(button=>button.addEventListener('click',()=>{state.theme=button.dataset.dtgTheme;syncThemes();renderGrid()}));
  overlay.querySelector('#dtg-search').addEventListener('input',event=>{state.query=event.target.value.trim().toLocaleLowerCase('pt-BR');renderGrid()});
  overlay.querySelector('#dtg-purpose').addEventListener('change',event=>{state.purpose=event.target.value;renderGrid()});overlay.querySelector('#dtg-style').addEventListener('change',event=>{state.style=event.target.value;renderGrid()});overlay.querySelector('#dtg-sort').addEventListener('change',event=>{state.sort=event.target.value;renderGrid()});overlay.querySelector('[data-reset]').addEventListener('click',reset);
  const filterToggle=overlay.querySelector('[data-toggle-filters]');filterToggle.addEventListener('click',()=>{const shell=overlay.querySelector('.dtg-shell'),collapsed=shell.classList.toggle('dtg-filters-collapsed');filterToggle.setAttribute('aria-expanded',String(!collapsed));syncFilterToggle();if(!collapsed)overlay.querySelector('#dtg-search').focus()});
  overlay.querySelector('[data-open-center]').addEventListener('click',()=>{overlay.remove();window.DeboraLibrary?.openTemplates?.()});
  overlay.querySelectorAll('[data-preview-close]').forEach(button=>button.addEventListener('click',closePreview));
  overlay.querySelector('#dtg-download').addEventListener('click',async()=>{if(!state.active)return;const button=overlay.querySelector('#dtg-download');button.disabled=true;button.textContent='Gerando…';try{await window.DDSPdfEngine.download(state.active,data().sampleData,brand(),`${state.active.id}.pdf`,{scale:1.15})}finally{button.disabled=false;button.textContent='Gerar PDF de exemplo'}});
  overlay.querySelector('#dtg-preview-install').addEventListener('click',event=>state.active&&install(state.active,event.currentTarget));
  renderGrid();
}

function screenByHeading(label){const heading=[...document.querySelectorAll('h1,h2,h3,h4,strong')].find(node=>node.children.length===0&&node.textContent?.trim().toLocaleLowerCase('pt-BR')===label);return heading?.closest('section[data-screen],section')||null}
function settingsScreen(){return screenByHeading('configurações')}
function moreScreen(){return screenByHeading('outras áreas')}
function mountSettings(){const screen=settingsScreen();if(!screen||!window.DeboraLibrary)return;const list=screen.querySelector('.settings-list')||screen,existing=screen.querySelector('[data-template-center]');if(existing){existing.hidden=true;existing.setAttribute('aria-hidden','true')}if(screen.querySelector('[data-template-gallery]'))return;const button=document.createElement('button');button.type='button';button.dataset.templateGallery='1';button.innerHTML='<span>▦</span><div><strong>Templates</strong><small>48 modelos, uploads e documentos salvos</small></div><b>›</b>';button.addEventListener('click',open);existing?list.insertBefore(button,existing):list.appendChild(button)}
function mountMore(){const screen=moreScreen();if(!screen||screen.querySelector('[data-template-more]'))return;const libraryTitle=[...screen.querySelectorAll('strong,h2,h3')].find(node=>node.textContent?.trim().toLocaleLowerCase('pt-BR')==='biblioteca'),source=libraryTitle?.closest('button,a,[role="button"],article,li');if(!source||!source.parentElement)return;const card=source.cloneNode(true);[...card.attributes].forEach(attribute=>{if(attribute.name!=='class'&&attribute.name!=='type'&&attribute.name!=='role'&&attribute.name!=='tabindex')card.removeAttribute(attribute.name)});card.dataset.templateMore='1';if(card.tagName==='A')card.href='#';const title=card.querySelector('strong,h2,h3'),subtitle=card.querySelector('small,p'),icon=card.querySelector('span');if(title)title.textContent='Templates';if(subtitle)subtitle.textContent='Modelos de documentos e PDFs';if(icon){icon.textContent='▦';icon.setAttribute('aria-hidden','true')}card.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();open()});card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open()}});source.insertAdjacentElement('afterend',card)}
let timer;function mount(){clearTimeout(timer);timer=setTimeout(()=>{mountSettings();mountMore()},220)}
window.DeboraTemplateGallery={open};new MutationObserver(mount).observe(document.documentElement,{subtree:true,childList:true});window.addEventListener('hashchange',mount);mount();
