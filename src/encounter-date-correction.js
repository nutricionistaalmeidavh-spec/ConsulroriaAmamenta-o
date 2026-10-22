export const encounterDateCorrectionCss = ".cn-date-editor{margin:0 0 15px;border:1px solid #e5d7e4;border-radius:13px;background:#fbf7fa}.cn-date-editor summary{cursor:pointer;padding:12px 14px;color:#674a66;font:700 12px system-ui}.cn-date-editor-inner{display:grid;gap:9px;padding:0 14px 14px}.cn-date-editor-inner label{font:700 12px system-ui;color:#3d3b41}.cn-date-editor-inner input{box-sizing:border-box;width:100%;min-height:44px;padding:10px 12px;border:1px solid #d9c7d8;border-radius:9px;background:#fff;color:#242424;font:500 16px system-ui}.cn-date-editor-inner small{font:500 11px/1.45 system-ui;color:#737175}.cn-date-editor-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.cn-date-editor-actions button{min-height:42px;padding:0 16px;border:0;border-radius:10px;background:#6b3f50;color:#fff;font:700 12px system-ui}.cn-date-editor-actions button:disabled{opacity:.5}.cn-date-editor-actions span{font:600 11px system-ui;color:#536657}";

const HELPER = "function cnDateForInput(value){\n  if(!value)return'';\n  const raw=String(value).trim();\n  const parsed=new Date(/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$/.test(raw)?raw+':00-03:00':raw);\n  if(!Number.isFinite(parsed.getTime()))return'';\n  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{\n    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',\n    hour:'2-digit',minute:'2-digit',hourCycle:'h23'\n  }).formatToParts(parsed).map(p=>[p.type,p.value]));\n  return parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute;\n}\nfunction cnDateToIso(value){\n  const raw=String(value||'').trim();\n  if(!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$/.test(raw))throw new Error('Informe data e horário válidos.');\n  const date=new Date(raw+':00-03:00');\n  if(!Number.isFinite(date.getTime())||cnDateForInput(date.toISOString())!==raw)throw new Error('Data ou horário inválido.');\n  if(date.getTime()>Date.now()+5*60*1000)throw new Error('A consulta não pode ter data futura.');\n  return date.toISOString();\n}\nfunction cnEncounterDateEditor(enc){\n  const starts=enc.identification?.startsAt||enc.occurred_at||'';\n  const corrections=enc.identification?.dateCorrections||[];\n  return '<details class=\"cn-date-editor\"><summary>Corrigir data da consulta</summary>'+\n    '<div class=\"cn-date-editor-inner\"><label for=\"cn-date-input\">Data e hora reais do atendimento</label>'+\n    '<input id=\"cn-date-input\" type=\"datetime-local\" value=\"'+cnE(cnDateForInput(starts))+'\">'+\n    '<small>Use a data em que a consulta aconteceu, mesmo quando o prontuário for registrado depois. '+\n    'A criação do registro e as correções permanecem rastreáveis.</small>'+\n    (enc.created_at?'<small>Registro criado em '+cnE(cnDate(enc.created_at,true))+'</small>':'')+\n    '<div class=\"cn-date-editor-actions\"><button type=\"button\" id=\"cn-date-save\">Salvar data</button>'+\n    '<span id=\"cn-date-status\" role=\"status\"></span></div>'+\n    '<small id=\"cn-date-history\">'+(Array.isArray(corrections)?corrections.length:0)+' correção(ões) registrada(s)</small></div></details>';\n}\nasync function cnSaveEncounterDate(){\n  const btn=document.querySelector('#cn-date-save'),input=document.querySelector('#cn-date-input'),\n    status=document.querySelector('#cn-date-status'),enc=cnState.encounter;\n  if(!btn||!input||!status||!enc?.id)return;\n  btn.disabled=true;\n  try{\n    const iso=cnDateToIso(input.value);\n    await cnFlush();\n    const current=cnState.encounter;\n    if(Date.parse(current.occurred_at)===Date.parse(iso)&&\n       cnDateForInput(current.identification?.startsAt||current.occurred_at)===input.value){\n      status.textContent='Data já está atualizada.';\n      return;\n    }\n    status.textContent='Salvando data…';\n    const rows=await cnRest('clinical_encounters?id=eq.'+encodeURIComponent(current.id)+\n      '&select=id,occurred_at,identification,record_version,appointment_id',{\n      method:'PATCH',headers:{Prefer:'return=representation'},\n      body:JSON.stringify({_expected_version:Number(current.record_version||0),occurred_at:iso})\n    });\n    if(!rows?.[0]?.id)throw new Error('O banco não confirmou a alteração da data.');\n    cnState.encounter={...cnState.encounter,...rows[0]};\n    input.value=cnDateForInput(cnState.encounter.identification?.startsAt||cnState.encounter.occurred_at);\n    const header=document.querySelector('#cn-overlay .cn-meta>div:nth-child(2)>strong');\n    if(header)header.textContent=cnDate(cnState.encounter.occurred_at,true);\n    const history=document.querySelector('#cn-date-history');\n    if(history)history.textContent=(cnState.encounter.identification?.dateCorrections?.length||0)+' correção(ões) registrada(s)';\n    status.textContent='Data salva e registrada no histórico.';\n    cnStatus('Data da consulta atualizada ✓','saved');\n    window.dispatchEvent(new CustomEvent('debora:encounter-date-updated',{detail:{encounterId:current.id}}));\n  }catch(error){\n    status.textContent=error.message||'Não foi possível corrigir a data.';\n  }finally{btn.disabled=false}\n}\n";

export function enhanceClinicalNoteWithDateCorrection(source) {
  if (typeof source !== 'string') throw new TypeError('Clinical note runtime must be text');
  let next = source;
  function replaceExactlyOnce(from, to) {
    const first = next.indexOf(from);
    if (first < 0 || next.indexOf(from, first + from.length) >= 0) {
      throw new Error('Clinical date correction: canonical anchor missing or ambiguous: ' + from.slice(0, 64));
    }
    next = next.slice(0, first) + to + next.slice(first + from.length);
  }
  replaceExactlyOnce('function cnHeaderHtml(enc){', HELPER + 'function cnHeaderHtml(enc){');
  // Materializers may briefly expose the original unversioned source to parallel
  // tests. Preserve its existing projection and only add the creation timestamp.
  const queryStart = 'clinical_encounters?id=eq.${encodeURIComponent(encounterId)}&select=';
  const queryPosition = next.indexOf(queryStart);
  const projectionStart = queryPosition + queryStart.length;
  const projectionEnd = next.indexOf('&limit=1', projectionStart);
  if (queryPosition < 0 || projectionEnd < projectionStart
    || next.indexOf(queryStart, queryPosition + 1) >= 0) {
    throw new Error('Clinical date correction: missing canonical encounter projection');
  }
  const projection = next.slice(projectionStart, projectionEnd).split(',');
  if (!projection.includes('occurred_at')) {
    throw new Error('Clinical date correction: encounter date must be in projection');
  }
  if (!projection.includes('created_at')) {
    projection.splice(projection.indexOf('occurred_at') + 1, 0, 'created_at');
    next = next.slice(0, projectionStart) + projection.join(',') + next.slice(projectionEnd);
  }
  replaceExactlyOnce('<div class="cn-body"><div class="cn-editor-head">',
    '<div class="cn-body">' + '${cnEncounterDateEditor(enc)}' + '<div class="cn-editor-head">');
  replaceExactlyOnce("o.querySelector('#cn-addendum-save')?.addEventListener('click',cnAddAddendum)}",
    "o.querySelector('#cn-addendum-save')?.addEventListener('click',cnAddAddendum);o.querySelector('#cn-date-save')?.addEventListener('click',cnSaveEncounterDate)}");
  return next;
}
