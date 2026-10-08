// Um único editor canônico; não cria outra timeline ou fonte de verdade.
const localToday = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const safe = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toDay = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? localToday() : d.toISOString().slice(0,10); };
let pending = false;

async function refreshBaby(babyId) {
  try { await window.DeboraGrowth?.refreshWeightHistory?.(); }
  catch(error) { console.warn('Falha ao atualizar curva de peso',error); }
  window.dispatchEvent(new CustomEvent('debora:weight-updated',{detail:{babyId}}));
}

function openWeightEditor({babyId,weight=null,measuredAt=null,records=[]}={}) {
  if(!babyId || document.getElementById('wc-dialog')) return;
  const editing=records.length>0;
  const dialog=document.createElement('div');
  dialog.id='wc-dialog';
  dialog.innerHTML=[
    '<div class="wc-backdrop" data-wc-close></div>',
    '<section class="wc-panel" role="dialog" aria-modal="true" aria-labelledby="wc-title">',
      '<header class="wc-head"><div><small>EVOLUÇÃO DO BEBÊ</small><h2 id="wc-title">',
      editing?'Corrigir pesagem':'Registrar pesagem',
      '</h2></div><button type="button" data-wc-close aria-label="Fechar" class="wc-icon">×</button></header>',
      '<form data-wc-form><p class="wc-help">',
      editing?'A correção será registrada com rastreabilidade e recalculará a evolução.':'Informe o peso e a data real em que a medição ocorreu.',
      '</p><label class="wc-label">Peso em gramas<input data-wc-weight type="number" min="300" max="50000" step="1" inputmode="numeric" required value="',
      safe(weight??''),'" placeholder="Ex.: 3850"></label>',
      '<label class="wc-label">Data real da pesagem<input data-wc-date type="date" required max="',localToday(),'" value="',
      safe(measuredAt?toDay(measuredAt):localToday()),'"></label>',
      '<p class="wc-state" data-wc-status role="status" aria-live="polite"></p>',
      '<div class="wc-actions"><button type="button" class="wc-secondary" data-wc-close>Cancelar</button>',
      '<button type="submit" class="wc-primary">Salvar pesagem</button></div></form>',
      editing?'<div class="wc-void"><button type="button" class="wc-void-toggle" data-wc-void-toggle>Invalidar pesagem incorreta</button><div data-wc-void-section hidden><label class="wc-label">Motivo da invalidação<textarea data-wc-reason rows="2" placeholder="Explique por que esta medição é inválida"></textarea></label><button type="button" class="wc-danger" data-wc-void>Confirmar invalidação</button></div></div>':'',
    '</section>'
  ].join('');
  const style=document.createElement('style');
  style.id='wc-dialog-style';
  style.textContent=[
    '#wc-dialog{position:fixed;inset:0;z-index:999999;display:grid;place-items:center;padding:16px;font:14px/1.45 system-ui,-apple-system,sans-serif}',
    '.wc-backdrop{position:absolute;inset:0;background:rgba(31,26,32,.58)}',
    '.wc-panel{position:relative;max-width:440px;width:100%;max-height:calc(100dvh - 32px);overflow:auto;background:#fff;border-radius:20px;padding:22px;box-shadow:0 22px 70px rgba(0,0,0,.2);color:#342d37}',
    '.wc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}',
    '.wc-head small{font-size:10px;color:#826486;font-weight:700;letter-spacing:.08em}.wc-head h2{margin:5px 0 0;font:700 24px/1.2 Georgia,serif;color:#342d37}',
    '.wc-icon{border:0;background:none;font-size:28px;line-height:1;cursor:pointer;color:#665867}',
    '.wc-help{color:#655c67;margin:14px 0}',
    '.wc-label{display:grid;gap:6px;margin:14px 0;font-weight:650}',
    '.wc-label input,.wc-label textarea{display:block;width:100%;border:1px solid #dcd0dd;border-radius:10px;padding:12px;font:400 16px/1.3 system-ui;background:#fff;color:#2e2932}',
    '.wc-label input:focus-visible,.wc-label textarea:focus-visible{outline:2px solid #89669a;outline-offset:1px}',
    '.wc-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
    '.wc-actions button,.wc-danger{border:1px solid #d8c6dc;border-radius:10px;min-height:44px;padding:10px 16px;font-weight:700;cursor:pointer}',
    '.wc-primary{background:#78548b;color:#fff;border-color:#78548b!important}.wc-secondary{background:white;color:#58465f}',
    '.wc-void{border-top:1px solid #ede6ed;margin-top:16px;padding-top:12px}',
    '.wc-void-toggle{background:transparent;border:0;color:#8a5145;text-decoration:underline;padding:6px 0;cursor:pointer}',
    '.wc-danger{background:#8a5145;color:#fff;border-color:#8a5145}',
    '.wc-state{min-height:20px;color:#a13c38;margin:8px 0}',
    '#wc-dialog [hidden]{display:none!important}',
    '@media(max-width:480px){.wc-panel{padding:18px;border-radius:16px}}'
  ].join('\n');
  document.head.appendChild(style);
  document.body.appendChild(dialog);
  const initialFocus=document.activeElement;
  const status=dialog.querySelector('[data-wc-status]');
  function close(){if(pending)return;dialog.remove();style.remove();initialFocus?.focus?.();}
  async function submit(action){
    if(pending)return;
    const weightG=Number(dialog.querySelector('[data-wc-weight]').value);
    const date=dialog.querySelector('[data-wc-date]').value;
    const reason=dialog.querySelector('[data-wc-reason]')?.value?.trim()||'';
    if(action!=='void'&&(!Number.isInteger(weightG)||weightG<300||weightG>50000||!date||date>localToday())){
      status.textContent='Informe um peso válido e uma data de pesagem não futura.';return;
    }
    if(action==='void'&&reason.length<3){status.textContent='Informe o motivo da invalidação.';return;}
    pending=true;
    for(const el of dialog.querySelectorAll('button,input,textarea'))el.disabled=true;
    status.textContent='Salvando no prontuário…';
    try{
      const client=window.DeboraRuntimeClient;
      if(!client?.rpc)throw new Error('Sessão clínica indisponível.');
      if(!editing){
        await client.rpc('record_growth_measurement',{
          p_baby_id:babyId,p_weight_g:weightG,p_measured_at:date+'T12:00:00.000Z'
        });
      }else{
        await client.rpc('revise_weight_measurement',{
          p_baby_id:babyId,p_action:action,
          p_weight_ids:records.filter(r=>r.table==='weights').map(r=>r.id),
          p_measurement_ids:records.filter(r=>r.table==='growth_measurements').map(r=>r.id),
          p_expected_day:toDay(measuredAt),p_expected_weight_g:Number(weight),
          p_weight_g:action==='correct'?weightG:null,
          p_measured_at:action==='correct'?date:null,p_reason:reason
        });
      }
      pending=false;dialog.remove();style.remove();
      await refreshBaby(babyId);
    }catch(error){
      status.textContent=error?.message||'Não foi possível salvar. Os campos foram preservados.';
      pending=false;
      for(const el of dialog.querySelectorAll('button,input,textarea'))el.disabled=false;
    }
  }
  dialog.querySelectorAll('[data-wc-close]').forEach(el=>el.addEventListener('click',close));
  dialog.querySelector('[data-wc-form]').addEventListener('submit',event=>{event.preventDefault();void submit(editing?'correct':'add');});
  dialog.querySelector('[data-wc-void-toggle]')?.addEventListener('click',()=>{
    const panel=dialog.querySelector('[data-wc-void-section]');
    panel.hidden=!panel.hidden;
    if(!panel.hidden)panel.querySelector('textarea')?.focus();
  });
  dialog.querySelector('[data-wc-void]')?.addEventListener('click',()=>void submit('void'));
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
  dialog.querySelector('[data-wc-weight]')?.focus();
}
window.addEventListener('debora:weight-correction',event=>openWeightEditor(event.detail));
window.DeboraWeightCorrection={openNew:openWeightEditor};
