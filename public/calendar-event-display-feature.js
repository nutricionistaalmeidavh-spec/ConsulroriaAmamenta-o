// Calendar display preference. Identifying patients on outside calendar services
// is OFF by default and requires the professional's explicit acknowledgement.
const calendarSettings = document.querySelector('[data-screen="settings"]');
if (calendarSettings && !calendarSettings.querySelector('[data-calendar-display-card]')) {
  const card=document.createElement('article');
  card.className='detail-card';
  card.dataset.calendarDisplayCard='true';
  card.innerHTML=[
    '<div class="section-heading"><div><h2>Título dos compromissos</h2>',
    '<p>Escolha como os atendimentos aparecem no Google, Apple e Outlook.</p></div></div>',
    '<fieldset style="border:0;display:grid;gap:10px;padding:0;margin:12px 0">',
    '<label><input type="radio" name="calendar-display" value="anonymous" checked> Discreto: Atendimento - Gestão Amamentação</label>',
    '<label><input type="radio" name="calendar-display" value="named"> Identificado: Consulta — Mariana Costa / Retorno — Ana Souza</label>',
    '</fieldset>',
    '<p style="font-size:.85rem;opacity:.84">Ao usar nomes, os títulos poderão aparecer na sua conta Google ou nas assinaturas privadas Apple/Outlook. Não inclua dados clínicos. Compartilhe nomes apenas quando houver autorização e ciência da paciente.</p>',
    '<button class="ui-button ui-button-primary" type="button" data-calendar-display-save disabled>Salvar preferência</button>',
    '<p data-calendar-display-status role="status" aria-live="polite" style="font-size:.85rem"></p>',
  ].join('');
  const list=calendarSettings.querySelector('.settings-list');
  if(list) list.before(card); else calendarSettings.append(card);
  const status=card.querySelector('[data-calendar-display-status]');
  const save=card.querySelector('[data-calendar-display-save]');
  const selected=()=>card.querySelector('input[name="calendar-display"]:checked')?.value==='named';
  const token=()=>{
    for(const store of [globalThis.localStorage,globalThis.sessionStorage]){
      for(const key of ['debora-lactacao-session','amamentacao-session']){
        try { const value=JSON.parse(store?.getItem(key)||'null');if(value?.access_token)return value.access_token; } catch {}
      }
    }
    return globalThis.__deboraAccessToken || '';
  };
  const api=async(method='GET',data)=>{
    const bearer=token();
    if(!bearer)throw new Error('Entre em sua conta para configurar o calendário.');
    const result=await fetch('/api/calendar/display-preferences',{method,cache:'no-store',headers:{
      Authorization:'Bearer '+bearer,...(data?{'Content-Type':'application/json'}:{})
    },body:data?JSON.stringify(data):undefined});
    if(!result.ok)throw new Error('Não foi possível salvar a preferência.');
    return result.json();
  };
  let ready=false,busy=false;
  async function refresh(){
    if(!token()||busy)return;
    busy=true;ready=false;save.disabled=true;
    try{
      const data=await api();
      card.querySelector('input[value="'+(data.show_patient_name?'named':'anonymous')+'"]').checked=true;
      status.textContent='';ready=true;
    }catch(e){status.textContent=e.message;}
    finally{busy=false;save.disabled=!ready;}
  }
  save.addEventListener('click',async()=>{
    if(!ready||busy)return;
    const show=selected();
    if(show&&!window.confirm('Confirma que as pacientes foram informadas de que seus nomes aparecerão em serviços externos de calendário?'))return;
    busy=true;save.disabled=true;
    try{
      await api('POST',{show_patient_name:show,acknowledged_external_visibility:show});
      status.textContent=show
        ? 'Títulos identificados ativados. No Google, use Sincronizar agenda para atualizar eventos existentes.'
        : 'Modo discreto ativado. No Google, sincronize para substituir os títulos existentes.';
    }catch(e){status.textContent=e.message;}
    finally{busy=false;save.disabled=false;}
  });
  document.addEventListener('click',e=>{if(e.target.closest('[data-nav-target="settings"],[data-mobile-target="more"]'))void refresh();});
  window.addEventListener('hashchange',()=>{if(location.hash==='#/settings')void refresh();});
  if(location.hash==='#/settings')void refresh();
}
