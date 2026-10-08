const V5_STYLE_ID='debora-weight-evolution-v5-style';
if(!document.getElementById(V5_STYLE_ID)){
  const link=document.createElement('link');
  link.id=V5_STYLE_ID;
  link.rel='stylesheet';
  link.href='/weight-evolution-v5.css';
  document.head.appendChild(link);
}

const fmtInt=value=>Number.isFinite(value)?Math.round(value).toLocaleString('pt-BR'):'—';
const fmtPct=value=>Number.isFinite(value)?Math.abs(value).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}):'—';
const sign=value=>value>0?'+':value<0?'−':'';
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const asArray=value=>Array.isArray(value)?value:[];

function dateKey(value){
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toISOString().slice(0,10):'';
}

function buildRows({baby=null,weights=[],measurements=[]}={}){
  const rows=[];
  const seen=new Map();
  const birthWeight=Number(baby?.birth_weight_g);
  const birthDate=String(baby?.birth_date||'').trim();

  if(Number.isFinite(birthWeight)&&birthWeight>0&&birthDate){
    const day=birthDate.slice(0,10);
    const measuredAt=new Date(`${day}T12:00:00Z`).toISOString();
    const key=`${day}|${birthWeight}`;
    const birthRow={measuredAt,weight:birthWeight,birth:true,records:[]};
    rows.push(birthRow);
    seen.set(key,birthRow);
  }

  const source=[
    ...asArray(weights).filter(item=>!item?.voided_at).map(item=>({...item,sourceTable:'weights'})),
    ...asArray(measurements).filter(item=>item?.weight_g!=null&&!item?.weight_voided_at).map(item=>({...item,sourceTable:'growth_measurements'})),
  ];
  for(const item of source){
    const weight=Number(item?.weight_g);
    const day=dateKey(item?.measured_at);
    if(!day||!Number.isFinite(weight)||weight<=0)continue;
    const key=`${day}|${weight}`;
    if(seen.has(key)){
      const existing=seen.get(key);
      if(!existing.birth&&item.id&&existing.records.length<8)existing.records.push({table:item.sourceTable,id:String(item.id)});
      continue;
    }
    const row={measuredAt:item.measured_at,weight,birth:false,records:item.id?[{table:item.sourceTable,id:String(item.id)}]:[]};
    seen.set(key,row);
    rows.push(row);
  }

  return rows.sort((a,b)=>new Date(a.measuredAt)-new Date(b.measuredAt));
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
function formatDate(value){
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toLocaleDateString('pt-BR',{timeZone:'UTC'}):'';
}

function clear(host){
  if(!host)return;
  host.innerHTML='';
  delete host.dataset.v5Signature;
  delete host.dataset.v5Enhanced;
}

function mount({host,baby=null,weights=[],measurements=[]}={}){
  if(!host)return false;
  const rows=buildRows({baby,weights,measurements});
  if(!rows.length){clear(host);return false}

  const birthRow=rows.find(row=>row.birth)||null;
  const birth=birthRow?.weight??null;
  const current=rows.at(-1)?.weight??null;
  const saldo=Number.isFinite(birth)&&Number.isFinite(current)?current-birth:null;
  const saldoPct=Number.isFinite(saldo)&&birth?saldo/birth*100:null;
  host.__gfV5Rows=rows;
  host.__gfV5BabyId=baby?.id||null;
  if(host.addEventListener&&!host.__gfV5EditBound){
    const activate=(event)=>{
      const entry=event.target?.closest?.('[data-gf-edit-row]');
      if(!entry||!host.contains?.(entry))return;
      const row=host.__gfV5Rows?.[Number(entry.dataset.gfEditRow)];
      if(!row?.records?.length||!host.__gfV5BabyId)return;
      window.dispatchEvent?.(new CustomEvent('debora:weight-correction',{detail:{
        babyId:host.__gfV5BabyId,weight:row.weight,measuredAt:row.measuredAt,records:row.records
      }}));
    };
    host.addEventListener('click',activate);
    host.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){if(event.target?.matches?.('[data-gf-edit-row]')){event.preventDefault();activate(event)}}
    });
    host.__gfV5EditBound=true;
  }
  const signature=rows.map(row=>`${dateKey(row.measuredAt)}:${row.weight}:${row.birth}:${row.records?.map(r=>r.table+':'+r.id).join(',')}`).join('|');
  if(host.dataset.v5Signature===signature&&host.dataset.v5Enhanced==='1')return true;

  const timeline=rows.map((row,index)=>{
    const prev=index>0?rows[index-1]:null;
    const delta=prev?row.weight-prev.weight:null;
    const pct=prev&&prev.weight?delta/prev.weight*100:null;
    const isLatest=index===rows.length-1;
    const detail=row.birth
      ?'<span class="gf-v5-chip birth">Peso ao nascer</span>'
      :prev?deltaChip(delta,pct):'<span class="gf-v5-chip neutral">Primeira pesagem</span>';
    let secondary='';
    if(!row.birth&&Number.isFinite(birth)){
      secondary=prev?.birth?'em relação ao nascimento':birthSecondary(row.weight,birth);
    }
    return `<div class="gf-v5-timeline-row ${row.birth?'is-birth':''} ${isLatest?'is-latest':''}">
      <div class="gf-v5-marker" aria-hidden="true"><span></span></div>
      <div class="gf-v5-entry" ${!row.birth&&row.records?.length?`role="button" tabindex="0" title="Toque para corrigir esta pesagem" aria-label="Corrigir pesagem de ${escapeHtml(formatDate(row.measuredAt))}, ${fmtInt(row.weight)} gramas" data-gf-edit-row="${index}"`:''}>
        <div class="gf-v5-entry-top"><span class="gf-v5-date">${escapeHtml(formatDate(row.measuredAt))}</span><strong>${fmtInt(row.weight)} g</strong></div>
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
  return true;
}

window.DeboraWeightEvolution={buildRows,mount,clear};
