// Pure, read-only financial and clinical projections. The database remains canonical.
const TZ = 'America/Sao_Paulo';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function validDay(value) {
  if (!DAY.test(String(value ?? ''))) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

export function reportingDay(value) {
  if (typeof value === 'string' && DAY.test(value)) return validDay(value) ? value : '';
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return [fields.year, fields.month, fields.day].join('-');
}

function dayDisplay(iso) {
  const [year, month, day] = iso.split('-');
  return [day, month, year].join('/');
}

export function resolvePeriod({month, from, to} = {}) {
  if (month && !from && !to) {
    if (!MONTH.test(month)) throw new Error('Mês inválido.');
    const [year, number] = month.split('-').map(Number);
    const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const label = new Intl.DateTimeFormat('pt-BR', {month:'long', year:'numeric',timeZone:'UTC'})
      .format(new Date(Date.UTC(year, number - 1, 15)));
    return {from:month + '-01',to:month + '-' + String(last).padStart(2,'0'),
      label:label.charAt(0).toLocaleUpperCase('pt-BR') + label.slice(1)};
  }
  if (!validDay(from) || !validDay(to)) throw new Error('Informe uma data inválida ou incompleta.');
  if (from > to) throw new Error('A data de início deve ser anterior ou igual à data final.');
  return {from,to,label:dayDisplay(from) + ' a ' + dayDisplay(to)};
}

function inPeriod(value, period) {
  const day = reportingDay(value);
  return Boolean(day && day >= period.from && day <= period.to);
}

function patientLookup(patients) {
  return new Map((patients || []).map(p=>{
    const mother = p.mother || p;
    return [String(mother.id || ''), mother];
  }));
}

function normalizeRecord(record, mothers) {
  const mother = mothers.get(String(record.mother_id || ''));
  return {...record,patient_name:mother?.name || 'Paciente'};
}

export function createPeriodReport({financial = [], patients = [], encounters = [], appointments = []} = {}, period) {
  if (!validDay(period?.from) || !validDay(period?.to) || period.from > period.to)
    throw new Error('Período inválido.');
  const mothers = patientLookup(patients);
  const appointmentsById = new Map(appointments.map(a=>[String(a.id),a]));
  const activeFinance = financial.filter(f=>f.status !== 'Cancelado');
  const received = activeFinance.filter(f=>f.status === 'Pago' && inPeriod(f.paid_at, period));
  const pending = activeFinance.filter(f=>f.status === 'Pendente' && inPeriod(f.due_at || f.created_at, period));
  const rows = [...received,...pending]
    .map(f=>normalizeRecord(f,mothers))
    .sort((a,b)=>String(b.paid_at || b.due_at || b.created_at || '').localeCompare(String(a.paid_at || a.due_at || a.created_at || '')));
  const finalized = encounters.filter(e=>String(e.status || '').toLowerCase() === 'finalized'
    && inPeriod(e.occurred_at || e.created_at, period));
  const attended = new Set(finalized.map(e=>String(e.mother_id || '')).filter(Boolean));
  const newPatients = patients.filter(p=>inPeriod((p.mother || p).created_at, period));
  const linked = new Set(activeFinance.map(f=>String(f.encounter_id || '')).filter(Boolean));
  const financialExceptions = finalized.filter(e=>{
    const appointment = appointmentsById.get(String(e.appointment_id || ''));
    return !linked.has(String(e.id))
      && !['package_active','package_new'].includes(String(appointment?.billing_mode || ''));
  });
  const returns = finalized.filter(e=>{
    const appointment = appointmentsById.get(String(e.appointment_id || ''));
    const label = appointment?.appointment_type || e.identification?.appointmentType || '';
    return /\bretorno\b/i.test(label);
  });
  const encounterRows=finalized.map(e=>{
    const appointment = appointmentsById.get(String(e.appointment_id || ''));
    return {id:e.id,patient_name:mothers.get(String(e.mother_id || ''))?.name || 'Paciente',
      date:reportingDay(e.occurred_at || e.created_at),
      type:appointment?.appointment_type || e.identification?.appointmentType || 'Atendimento',
      financial_linked:linked.has(String(e.id)) ? 'Sim' : 'Não',
      billing_mode:appointment?.billing_mode || 'Não informado'};
  });
  const receivedCents = received.reduce((total,f)=>total+Number(f.amount_cents || 0),0);
  const pendingCents = pending.reduce((total,f)=>total+Number(f.amount_cents || 0),0);
  return {
    period, rows, encounterRows, receivedCents, pendingCents,
    paymentCount:received.length, pendingCount:pending.length,
    averagePaymentCents:received.length ? Math.round(receivedCents / received.length) : 0,
    finalizedCount:finalized.length, patientCount:attended.size,
    newPatientCount:newPatients.length, returnCount:returns.length,
    unlinkedCount:financialExceptions.length,
    missingPaymentDateCount:activeFinance.filter(f=>f.status==='Pago' && !reportingDay(f.paid_at)).length
  };
}

export function filterPeriodFinanceRows(report, status = 'Todos') {
  if (status === 'Todos') return report.rows;
  if (status !== 'Pendente' && status !== 'Pago') throw new Error('Status inválido.');
  return report.rows.filter(row=>row.status===status);
}

function csvEscape(value) {
  let text=String(value ?? '');
  if (/^\s*[=+\-@\t\r]/u.test(text)) text="'"+text;
  return '"' + text.replaceAll('"','""') + '"';
}

export function serializeFinanceCsv(rows) {
  const headers=['Paciente','Descrição','Valor (R$)','Status','Vencimento','Recebimento','Forma','Atendimento'];
  const line=row=>row.map(csvEscape).join(';');
  return '\ufeff'+[line(headers),...(rows || []).map(f=>line([
    f.patient_name || '',f.description || '',
    (Number(f.amount_cents || 0)/100).toFixed(2).replace('.',','),
    f.status || '',reportingDay(f.due_at),reportingDay(f.paid_at),
    f.payment_method || '',f.encounter_id || ''
  ]))].join('\r\n');
}
