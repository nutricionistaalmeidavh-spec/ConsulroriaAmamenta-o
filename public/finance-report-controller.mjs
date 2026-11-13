import { reportingDay, resolvePeriod, createPeriodReport, filterPeriodFinanceRows, serializeFinanceCsv } from './finance-monthly-report.mjs';

export function createFinanceReportController({ getState, setText, currency, escapeHTML, dateLabel, patientByMotherId, toast }) {
  const today = reportingDay(new Date());
  const filter = { mode:'month', month:today.slice(0,7), from:today.slice(0,7)+'-01', to:today, status:'Todos' };
  let snapshot = null;
  let saving = false;
  const element = selector => document.querySelector(selector);

  function selection() {
    return filter.mode === 'month' ? resolvePeriod({month:filter.month})
      : resolvePeriod({from:filter.from,to:filter.to});
  }

  function updateForm(period) {
    for(const [selector,value] of [
      ['[data-finance-period-mode]',filter.mode],['[data-finance-month]',filter.month],
      ['[data-finance-from]',filter.from],['[data-finance-to]',filter.to],
      ['[data-finance-status]',filter.status]
    ]) { const node=element(selector); if(node && node.value!==value)node.value=value; }
    const month=element('[data-finance-month-wrap]');
    const custom=element('[data-finance-custom]');
    if(month)month.hidden=filter.mode!=='month';
    if(custom)custom.hidden=filter.mode!=='custom';
    setText('[data-finance-period-label]', period?.label || 'Corrija o intervalo selecionado');
  }

  function htmlRow(f) {
    const p = patientByMotherId(f.mother_id);
    const todayKey = reportingDay(new Date());
    const dueKey = reportingDay(f.due_at);
    const overdue = f.status === 'Pendente' && dueKey && dueKey < todayKey;
    const statusLabel = overdue ? 'Vencido' : f.status;
    const patientAction = f.mother_id ? '<button data-action="open-finance-patient" data-mother-id="'+escapeHTML(f.mother_id)+'">Paciente</button>' : '';
    const actions = f.status === 'Pendente'
      ? patientAction+'<button data-action="finance-whatsapp" data-finance-id="'+escapeHTML(f.id)+'">Cobrar</button><button data-action="mark-paid" data-finance-id="'+escapeHTML(f.id)+'">Marcar pago</button>'
      : patientAction+(f.status==='Pago' ? '<button data-action="correct-paid-date" data-finance-id="'+escapeHTML(f.id)+'">Corrigir data</button><button data-action="undo-paid" data-finance-id="'+escapeHTML(f.id)+'">Desfazer pagamento</button>' : '');
    const removeAction = '<button type="button" class="finance-remove-action" data-action="cancel-finance" data-finance-id="'+escapeHTML(f.id)+'">Excluir</button>';
    const due = f.due_at ? '<small>Vencimento: '+escapeHTML(dateLabel(f.due_at))+'</small>' : '';
    const paid = f.paid_at ? '<small>Recebido: '+escapeHTML(dateLabel(f.paid_at))+'</small>'
      : f.status==='Pago' ? '<small>Data de recebimento não informada. Necessita conciliação.</small>' : '';
    return '<article class="agenda-card finance-card"><div class="agenda-main"><strong>'
      +escapeHTML(p?.mother?.name || f.patient_name || 'Paciente')+'</strong><span>'
      +escapeHTML(f.description || 'Atendimento')+'</span>'+due+paid+'</div><strong class="finance-amount">'
      +escapeHTML(currency(f.amount_cents))+'</strong><span class="pill '
      +(f.status==='Pago'?'completed':'waiting')+'">'+escapeHTML(statusLabel)
      +'</span><div class="agenda-actions">'+actions+removeAction+'</div></article>';
  }

  function render() {
    const data=getState();
    const pendingAll=data.financial.filter(f=>f.status==='Pendente')
      .reduce((total,f)=>total+Number(f.amount_cents || 0),0);
    setText('[data-kpi-receivable]',currency(pendingAll));
    let period;
    try { period=selection(); }
    catch(error) {
      snapshot=null;
      updateForm();
      const errorNode=element('[data-finance-period-feedback]');
      if(errorNode) {errorNode.textContent=error.message;errorNode.setAttribute('role','alert');}
      const root=element('[data-finance-live]');
      if(root)root.innerHTML='<div class="empty-live">Corrija as datas para visualizar o relatório.</div>';
      element('[data-finance-export-csv]')?.setAttribute('disabled','');
      element('[data-finance-export-xlsx]')?.setAttribute('disabled','');
      return;
    }
    const errorNode=element('[data-finance-period-feedback]');
    if(errorNode) {errorNode.textContent='';errorNode.removeAttribute('role');}
    updateForm(period);
    const report=createPeriodReport({
      financial:data.financial, patients:data.patients,
      encounters:data.encounters, appointments:data.appointments
    },period);
    snapshot=report;
    setText('[data-finance-received]',currency(report.receivedCents));
    setText('[data-finance-received-meta]',report.paymentCount+' pagamento(s) no período');
    setText('[data-finance-receivable]',currency(report.pendingCents));
    setText('[data-finance-receivable-meta]',report.pendingCount+' pendência(s) com vencimento no período');
    setText('[data-finance-ticket]',currency(report.averagePaymentCents));
    setText('[data-finance-ticket-meta]','Média por pagamento recebido');
    setText('[data-finance-encounters]',String(report.finalizedCount));
    setText('[data-finance-patients]',String(report.patientCount));
    setText('[data-finance-new-patients]',String(report.newPatientCount));
    setText('[data-finance-returns]',String(report.returnCount));
    setText('[data-finance-unlinked]',String(report.unlinkedCount));
    setText('[data-finance-missing-date]',String(report.missingPaymentDateCount));
    setText('[data-finance-unlinked-info]','Sem lançamento individual vinculado (podem ser gratuitos ou cobertos por outra cobrança).');
    setText('[data-finance-missing-date-info]','Pagamentos sem data não entram na receita mensal; selecione “Sem data” para conferir.');
    const list=filterPeriodFinanceRows(report,filter.status);
    const root=element('[data-finance-live]');
    if(root)root.innerHTML=list.length?list.map(htmlRow).join(''):'<div class="empty-live">Nenhum lançamento para os filtros selecionados.</div>';
    element('[data-finance-export-csv]')?.removeAttribute('disabled');
    element('[data-finance-export-xlsx]')?.removeAttribute('disabled');
  }

  function bind() {
    const assign=(selector,key,callback)=>{
      element(selector)?.addEventListener('change',event=>{
        filter[key]=event.currentTarget.value;
        callback?.();
        render();
      });
    };
    assign('[data-finance-period-mode]','mode',()=>{ if(filter.mode==='custom'){
      const month=resolvePeriod({month:filter.month});filter.from=month.from;filter.to=month.to;
    }});
    assign('[data-finance-month]','month');
    assign('[data-finance-from]','from');
    assign('[data-finance-to]','to');
    assign('[data-finance-status]','status');
  }

  function downloadBlob(blob,filename) {
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download=filename;anchor.rel='noopener';
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  async function exportFile(type) {
    if(!snapshot || saving)return;
    saving=true;
    const button=element(type==='csv'?'[data-finance-export-csv]':'[data-finance-export-xlsx]');
    const label=button?.textContent;
    if(button){button.disabled=true;button.textContent='Preparando…';}
    try{
      const rows=filterPeriodFinanceRows(snapshot,filter.status);
      const filename='gestao-amamentacao-relatorio-'+snapshot.period.from+'-a-'+snapshot.period.to;
      if(type==='csv') {
        downloadBlob(new Blob([serializeFinanceCsv(rows)],{type:'text/csv;charset=utf-8'}),filename+'.csv');
      }else{
        const {createFinanceWorkbook}=await import('./clinical-source/core/lib/backup-service.js');
        const blob=await createFinanceWorkbook(snapshot,rows);
        downloadBlob(blob,filename+'.xlsx');
      }
      toast('Arquivo preparado. Confira seus downloads e guarde os dados em local seguro.','success');
    }catch(e){
      toast(e?.message || 'Falha na exportação. Tente novamente.','error');
    }finally{
      saving=false;if(button){button.disabled=false;button.textContent=label;}
    }
  }
  return {render,bind,exportFile};
}
