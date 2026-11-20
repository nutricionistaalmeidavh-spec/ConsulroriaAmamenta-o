import { PRENATAL_QUESTIONS, parsePrenatalAnswers, isPrenatal } from './prenatal-questionnaire-feature.js';

const sections = Object.freeze([
  ['Queixa principal', 'chief_complaint'],
  ['Avaliação materna', 'maternal_assessment'],
  ['Avaliação do bebê', 'baby_assessment'],
  ['Avaliação da mamada', 'feeding_assessment'],
  ['Plano de cuidados', 'care_plan']
]);

const fieldLabels = Object.freeze({
  appointmentType:'Tipo de atendimento', format:'Modalidade', startsAt:'Início',
  durationMin:'Duração', value:'Valor', address:'Endereço', tags:'Itens registrados',
  notes:'Observações', observations:'Observações', symptoms:'Sintomas',
  painScore:'Intensidade da dor', affectedSide:'Lado afetado', birthDate:'Data de nascimento',
  gestationalAge:'Idade gestacional', expectedBirth:'Previsão de nascimento',
  weightG:'Peso (g)', weightGainG:'Ganho de peso (g)', wetDiapers:'Fraldas molhadas',
  stools:'Evacuações', position:'Posição', latch:'Pega', suckSwallow:'Sucção e deglutição',
  objectives:'Objetivos', instructions:'Orientações', followup:'Acompanhamento',
  priorityGuidance:'Orientações prioritárias', feedingPositioning:'Posicionamento',
  expressionSupplement:'Ordenha e complemento', routine:'Rotina', warningSigns:'Sinais de alerta',
  beforeFeed:'Antes da mamada', afterFeed:'Após a mamada',
  weekly_plan:'Plano por semana', weeks:'Semanas', week:'Semana',
  orientation_mode:'Formato das orientações', libraryItems:'Orientações selecionadas',
  declaration:'Declaração', prenatalAnswers:'Anamnese pré-natal',
  assistedReproduction:'Gestação por reprodução assistida / FIV',
  assistedReproductionNotes:'Observações sobre reprodução assistida',
  chronicConditionsHistory:'Doenças crônicas preexistentes',
  chronicConditionsDetails:'Detalhes das doenças crônicas',
  medicationUse:'Uso de medicamentos', supplementsUse:'Uso de suplementos',
  supplements:'Suplementos utilizados', allergiesKnown:'Alergias conhecidas',
  allergies:'Descrição das alergias', pregnancyComplications:'Intercorrências durante a gestação',
  pregnancyComplicationsDetails:'Detalhes das intercorrências',
  breastSurgeryHistory:'Cirurgias mamárias anteriores',
  breastSurgeryDetails:'Detalhes das cirurgias mamárias',
  previousBreastfeedingHistory:'Histórico de amamentação anterior',
  previousBreastfeedingDetails:'Detalhes da amamentação anterior',
  medications:'Medicamentos'
});

const currency = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
const technicalIdValue = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const summaryKeys = ['appointmentType','format','durationMin','startsAt','value','address'];
const defaultEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

function decode(value) {
  if (typeof value !== 'string' || !/^[\[{]/.test(value.trim())) return value;
  try { return JSON.parse(value); } catch { return value; }
}

function isTechnicalKey(key) {
  return /^(?:id|uuid|version|schemaVersion|babyTarget)$/i.test(key)
    || /(?:_id|_ids|Id|Ids)$/.test(key);
}

function labelFor(key) {
  if (fieldLabels[key]) return fieldLabels[key];
  const readable = String(key).replace(/([a-z\d])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
  return readable ? readable[0].toLocaleUpperCase('pt-BR') + readable.slice(1) : 'Informação clínica';
}

function formatClinicalField(value, babies = [], options = {}, key = '') {
  const escape = options.escapeHTML || defaultEscape;
  const parsed = decode(value);
  if (parsed == null || parsed === '') return '';
  if (Array.isArray(parsed)) return parsed.map(item => formatClinicalField(item,babies,options,key)).filter(Boolean).join('<br>');
  if (typeof parsed !== 'object') {
    let text = typeof parsed === 'boolean' ? (parsed ? 'Sim' : 'Não') : String(parsed);
    if (technicalIdValue.test(text.trim())) return '';
    if (key === 'value' && /^-?\d+(?:[.,]\d+)?$/.test(text)) text = currency.format(Number(text.replace(',', '.')));
    if (key === 'startsAt' && Number.isFinite(Date.parse(text))) text = options.formatDate ? options.formatDate(text) : text;
    if (key === 'durationMin' && /^\d+$/.test(text)) text += ' min';
    if (key === 'orientation_mode') text = ({weekly:'Por semana',single:'Única'})[text] || text;
    return escape(text);
  }
  return Object.entries(parsed).map(([field,entry]) => {
    if (isTechnicalKey(field)) return '';
    const body = formatClinicalField(entry,babies,options,field);
    if (!body) return '';
    const label = key === 'byBaby'
      ? (babies.find(baby => baby.id === field)?.name || 'Bebê')
      : labelFor(field);
    return '<div class="pw-history-field"><strong>'+escape(label)+'</strong><div>'+body+'</div></div>';
  }).filter(Boolean).join('');
}

function renderClinicalHistory(row = {}, babies = [], options = {}) {
  const escape = options.escapeHTML || defaultEscape;
  const info = decode(row.identification) || {};
  const identification = summaryKeys
    .map(key => [labelFor(key),formatClinicalField(info[key],babies,options,key)])
    .filter(([,html]) => Boolean(html));
  const otherInfo = formatClinicalField(
    Object.fromEntries(Object.entries(info).filter(([key]) => !summaryKeys.includes(key))),
    babies,options
  );
  const output = [];
  if (otherInfo) output.push(['Outros dados da identificação',otherInfo]);
  const prenatal = isPrenatal(info.appointmentType);
  const maternal = decode(row.maternal_assessment) || {};
  if (prenatal) {
    const answers = parsePrenatalAnswers(maternal.prenatalAnswers);
    const groups = ['Informações iniciais','Histórico e saúde','Gestação e expectativas','Origem do atendimento','Declarações e autorização'];
    groups.forEach((title,index) => {
      const html = PRENATAL_QUESTIONS.filter(question=>question.step===index+2)
        .map(question=>{
          const value = formatClinicalField(answers[question.key],babies,options,question.key);
          return value ? '<div class="pw-history-field"><strong>'+escape(question.title)+'</strong><div>'+value+'</div></div>' : '';
        }).filter(Boolean).join('');
      output.push([title,html]);
    });
  }
  for(const [title,key] of sections) {
    const value = prenatal && key === 'maternal_assessment' && maternal && typeof maternal === 'object'
      ? Object.fromEntries(Object.entries(maternal).filter(([field])=>field!=='prenatalAnswers'))
      : row[key];
    output.push([title,formatClinicalField(value,babies,options,key)]);
  }
  const note = ['Prontuário',formatClinicalField(row.clinical_note,babies,options)];
  const status = row.status === 'finalized' ? 'Finalizado' : 'Em andamento';
  const finished = row.finalized_at && options.formatDate ? ' · ' + escape(options.formatDate(row.finalized_at)) : '';
  const finalFields = formatClinicalField(row.finalization,babies,options);
  const end = ['Finalização',escape(status)+finished+finalFields];
  output.push(...(prenatal ? [end,note] : [note,end]));
  return {identification,sections:output};
}

export { fieldLabels, labelFor, formatClinicalField, renderClinicalHistory };
