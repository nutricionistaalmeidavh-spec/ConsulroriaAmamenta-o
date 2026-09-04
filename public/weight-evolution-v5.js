const V5_STYLE_ID='debora-weight-evolution-v5-style';
if(!document.getElementById(V5_STYLE_ID)){
  const link=document.createElement('link');
  link.id=V5_STYLE_ID;
  link.rel='stylesheet';
  link.href='./weight-evolution-v5.css';
  document.head.appendChild(link);
}

const parseWeight=text=>{
  const raw=String(text||'').replace(/\s/g,'').replace(/g$/i,'').replace(/\./g,'').replace(',','.');
  const value=Number(raw.replace(/[^0-9.-]/g,''));
  return Number.isFinite(value)?value:null;
};
const fmtInt=value=>Number.isFinite(value)?Math.round(value).toLocaleString('pt-BR'):'—';
const fmtPct=value=>Number.isFinite(value)?Math.abs(value).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}):'—';
const sign=value=>value>0?'+':value<0?'−':'';
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function readRows(host){
  return [...host.querySelectorAll('.gf-weight-change-row')].map((row,index)=>{
    const header=row.querySelector(':scope > div');
    const date=header?.querySelector('span')?.textContent?.trim()||'';
    const weight=parseWeight(header?.querySelector('strong')?.textContent||'');
    const primary=row.querySelector('p')?.textContent?.trim()||'';
    return {index,date,weight,birth:/peso ao nascer/i.test(primary)};
  }).filter(row=>row.date&&Number.isFinite(row.weight));
}

function tone(delta){return delta>0?'gain':delta<0?'loss':'neutral'}
function deltaChip(delta,pct){
  if(!Number.isFinite(delta)||!Number.isFinite(pct))return '<span class="gf-v5-chip neutral">Sem comparação</span>';
  const cls=tone(delta),arrow=delta>0?'↑':delta<0?'↓':'→';
  return `<span class="gf-v5-chip ${cls}">${arrow} ${fmtInt(Math.abs(delta))} g · ${sign(pct)}${fmtPct(pct)}%</span>`;
}
function birthSecondary(weight,birth){
  if(!Number.isFinite(weight)||!Number.isFinite(birth)||!birth)return '';
  const delta=weight-birth,pct=delta/birth*100;
  if(Math.abs(delta)<0.5)return 'Mesmo peso do nascimento';
  return `${sign(delta)}${fmtInt(Math.abs(delta))} g · ${sign(pct)}${fmtPct(pct)}% desde o nascimento`;
}

function render(host){
  const rows=readRows(host);
  if(!rows.length)return;
  const birthRow=rows.find(row=>row.birth)||null;
  const birth=birthRow?.weight??null;
  const current=rows.at(-1)?.weight??null;
  const saldo=Number.isFinite(birth)&&Number.isFinite(current)?current-birth:null;
  const saldoPct=Number.isFinite(saldo)&&birth?saldo/birth*100:null;
  const signature=rows.map(row=>`${row.date}:${row.weight}:${row.birth}`).join('|');
  if(host.dataset.v5Signature===signature&&host.dataset.v5Enhanced==='1')return;

  const timeline=rows.map((row,index)=>{
    const prev=index>0?rows[index-1]:null;
    const delta=prev?row.weight-prev.weight:null;
    const pct=prev&&prev.weight?delta/prev.weight*100:null;
    const isLatest=index===rows.length-1;
    let detail='';
    if(row.birth){
      detail='<span class="gf-v5-chip birth">Peso ao nascer</span>';
    }else if(prev){
      detail=deltaChip(delta,pct);
    }else{
      detail='<span class="gf-v5-chip neutral">Primeira pesagem</span>';
    }
    let secondary='';
    if(!row.birth&&Number.isFinite(birth)){
      secondary=prev?.birth?'em relação ao nascimento':birthSecondary(row.weight,birth);
    }
    return `<div class="gf-v5-timeline-row ${row.birth?'is-birth':''} ${isLatest?'is-latest':''}">
      <div class="gf-v5-marker" aria-hidden="true"><span></span></div>
      <div class="gf-v5-entry">
        <div class="gf-v5-entry-top"><span class="gf-v5-date">${escapeHtml(row.date)}</span><strong>${fmtInt(row.weight)} g</strong></div>
        <div class="gf-v5-entry-detail">${detail}</div>
        ${secondary?`<small>${escapeHtml(secondary)}</small>`:''}
      </div>
    </div>`;
  }).join('');

  const saldoClass=Number.isFinite(saldo)?tone(saldo):'neutral';
  const saldoText=Number.isFinite(saldo)?`${sign(saldo)}${fmtInt(Math.abs(saldo))} g${Number.isFinite(saldoPct)?` (${sign(saldoPct)}${fmtPct(saldoPct)}%)`:''}`:'—';
  host.innerHTML=`
    <div class="gf-v5-head">
      <div><strong>Evolução do peso</strong><small>Trajetória desde o nascimento</small></div>
      <span>${rows.length} ${rows.length===1?'medição':'medições'}</span>
    </div>
    <div class="gf-v5-summary" role="group" aria-label="Resumo da evolução do peso">
      <div><small>Atual</small><strong>${fmtInt(current)} g</strong></div>
      <div><small>Nascimento</small><strong>${Number.isFinite(birth)?`${fmtInt(birth)} g`:'—'}</strong></div>
      <div class="${saldoClass}"><small>Saldo</small><strong>${saldoText}</strong></div>
    </div>
    <div class="gf-v5-timeline">${timeline}</div>`;
  host.dataset.v5Signature=signature;
  host.dataset.v5Enhanced='1';
  host.classList.add('gf-weight-changes-v5');
}

function enhanceAll(){
  document.querySelectorAll('[data-weight-changes-v4]').forEach(host=>{
    if(host.querySelector('.gf-weight-change-row'))render(host);
  });
}
let timer;
function schedule(){clearTimeout(timer);timer=setTimeout(enhanceAll,60)}
new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('hashchange',()=>setTimeout(enhanceAll,160));
enhanceAll();
