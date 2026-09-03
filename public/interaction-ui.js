const DUI_ID='dui-confirm-layer';
const DUI_TOAST='dui-toast-region';
let activeDialog=null;
function duiEscape(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function duiToast(message,{tone='info',duration=2800}={}){
  let region=document.getElementById(DUI_TOAST);
  if(!region){region=document.createElement('div');region.id=DUI_TOAST;region.setAttribute('aria-live','polite');region.setAttribute('aria-atomic','false');document.body.appendChild(region)}
  const toast=document.createElement('div');toast.className='dui-toast';toast.dataset.tone=tone;toast.setAttribute('role',tone==='danger'?'alert':'status');toast.textContent=String(message||'');region.appendChild(toast);
  requestAnimationFrame(()=>toast.classList.add('show'));
  const close=()=>{toast.classList.remove('show');setTimeout(()=>toast.remove(),180)};
  setTimeout(close,duration);
  return close;
}
function duiConfirmTyped({title='Confirmar ação',message='',expected='',confirmLabel='Confirmar',cancelLabel='Cancelar',danger=false}={}){
  if(activeDialog)return activeDialog;
  const previous=document.activeElement;
  activeDialog=new Promise(resolve=>{
    const layer=document.createElement('div');layer.id=DUI_ID;layer.className='dui-layer';
    const expectedText=String(expected||'');
    layer.innerHTML=`<div class="dui-backdrop" data-dui-cancel></div><section class="dui-dialog" role="alertdialog" aria-modal="true" aria-labelledby="dui-title" aria-describedby="dui-desc"><div class="dui-dialog-mark" aria-hidden="true">!</div><div class="dui-dialog-copy"><small>${danger?'AÇÃO IRREVERSÍVEL':'CONFIRMAÇÃO'}</small><h2 id="dui-title">${duiEscape(title)}</h2><p id="dui-desc">${duiEscape(message)}</p></div>${expectedText?`<label class="dui-typed"><span>Digite <strong>${duiEscape(expectedText)}</strong> para confirmar</span><input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" data-dui-input aria-describedby="dui-help"><small id="dui-help">A ação só será liberada quando o texto estiver exatamente igual.</small></label>`:''}<div class="dui-actions"><button type="button" class="dui-button neutral" data-dui-cancel>${duiEscape(cancelLabel)}</button><button type="button" class="dui-button ${danger?'danger':'primary'}" data-dui-confirm>${duiEscape(confirmLabel)}</button></div></section>`;
    document.body.appendChild(layer);
    const inerted=[];
    for(const el of [...document.body.children]){if(el===layer)continue;try{if(!el.inert){el.inert=true;inerted.push(el)}}catch{}}
    const input=layer.querySelector('[data-dui-input]'),confirm=layer.querySelector('[data-dui-confirm]'),cancel=layer.querySelector('.dui-actions [data-dui-cancel]');
    const sync=()=>{confirm.disabled=Boolean(expectedText)&&input.value!==expectedText;confirm.setAttribute('aria-disabled',String(confirm.disabled))};
    const done=value=>{layer.removeEventListener('keydown',onKey);layer.remove();for(const el of inerted)try{el.inert=false}catch{};activeDialog=null;requestAnimationFrame(()=>previous?.focus?.());resolve(value)};
    const onKey=e=>{if(e.key==='Escape'){e.preventDefault();done(false);return}if(e.key!=='Tab')return;const focusables=[...layer.querySelectorAll('button:not(:disabled),input:not(:disabled)')];if(!focusables.length)return;const first=focusables[0],last=focusables.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}};
    layer.addEventListener('keydown',onKey);
    layer.querySelectorAll('[data-dui-cancel]').forEach(el=>el.addEventListener('click',()=>done(false)));
    confirm.addEventListener('click',()=>{if(!confirm.disabled)done(true)});
    input?.addEventListener('input',sync);
    sync();
    requestAnimationFrame(()=>cancel.focus());
  });
  return activeDialog;
}
window.DeboraUI={...(window.DeboraUI||{}),toast:duiToast,confirmTyped:duiConfirmTyped};

// Pesquisa global. A Agenda é controlada exclusivamente pelo app-shell/state.appointments.
document.addEventListener('click',(event)=>{
  const searchButton=event.target.closest('.lactation-topbar [aria-label="Pesquisar"]');
  if(!searchButton)return;
  event.preventDefault();
  const patientNav=document.querySelector('[data-nav-target="patients"]');
  patientNav?.click();
  setTimeout(()=>{
    const input=document.querySelector('[data-patient-search]');
    input?.focus({preventScroll:true});
    input?.select?.();
  },80);
});
