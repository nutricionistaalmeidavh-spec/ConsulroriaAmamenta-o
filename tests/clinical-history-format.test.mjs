import test from 'node:test';
import assert from 'node:assert/strict';
import { encounterSections } from '../public/clinical-source/core/lib/encounter-form.js';
import { PRENATAL_QUESTIONS } from '../public/prenatal-questionnaire-feature.js';
import { renderClinicalHistory, formatClinicalField } from '../public/clinical-history-format.js';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const options = {escapeHTML, formatDate: value => String(value)};
const babyOne = {id: '11111111-1111-4111-8111-111111111111', name: 'Lia'};
const babyTwo = {id: '22222222-2222-4222-8222-222222222222', name: 'Caio'};
const postnatal = {
  identification: {appointmentType:'Consulta inicial', format:'Domiciliar', value:149.9, durationMin:90},
  chief_complaint: {symptoms:'Dor ao amamentar'},
  maternal_assessment: {painScore:6, customMaternalQuestion:'Resposta materna'},
  baby_assessment: {byBaby:{[babyOne.id]:{weightG:3650},[babyTwo.id]:{weightG:3700}}},
  feeding_assessment: {byBaby:{[babyOne.id]:{latch:'Pega profunda'},[babyTwo.id]:{latch:'Pega superficial'}}},
  care_plan: {instructions:'Posicionar bebê e acompanhar', followup:'Retorno em 7 dias'},
  clinical_note: {notes:'Evolução registrada'},
  finalization: {notes:'Encerramento registrado'},
  status:'finalized', finalized_at:'2026-11-20T12:00:00Z'
};

test('pós-parto expõe todos os blocos canônicos e os registros salvos, inclusive finalização e prontuário', () => {
  const result = renderClinicalHistory(postnatal, [babyOne,babyTwo], options);
  const labels = result.sections.map(([label])=>label);
  for(const section of encounterSections.slice(1)) {
    const known = {chief_complaint:'Queixa principal',maternal_assessment:'Avaliação materna',baby_assessment:'Avaliação do bebê',feeding_assessment:'Avaliação da mamada',care_plan:'Plano de cuidados',finalization:'Finalização'};
    assert.ok(labels.includes(known[section]), 'Não apareceu a etapa '+section);
  }
  for(const entry of ['Dor ao amamentar','Resposta materna','Pega profunda','Pega superficial','Evolução registrada','Encerramento registrado','Lia','Caio','R$']) {
    assert.ok(JSON.stringify(result).includes(entry), 'Faltou '+entry);
  }
  assert.ok(labels.indexOf('Prontuário') < labels.indexOf('Finalização'));
});

test('pré-natal apresenta as 17 respostas nos grupos corretos e deixa o prontuário no final', () => {
  const answers = Object.fromEntries(PRENATAL_QUESTIONS.map(q=>[q.key, q.type==='checkbox'?true:'Resposta '+q.number]));
  const record = {...postnatal,identification:{appointmentType:'Pré-natal'},maternal_assessment:{prenatalAnswers:JSON.stringify(answers),notes:'Observação materna'}};
  const snapshot=JSON.stringify(record);
  const result=renderClinicalHistory(record,[babyOne],options);
  assert.equal(result.sections.at(-1)[0],'Prontuário');
  assert.ok(result.sections.some(([name])=>name==='Declarações e autorização'));
  for(const q of PRENATAL_QUESTIONS) {
    assert.ok(JSON.stringify(result).includes(q.title), 'Pergunta omitida '+q.number);
    if(q.type!=='checkbox') assert.ok(JSON.stringify(result).includes('Resposta '+q.number));
  }
  assert.ok(JSON.stringify(result).includes('Observação materna'));
  assert.equal(JSON.stringify(record),snapshot,'visualização não pode alterar dados canônicos');
});

test('campos desconhecidos recebem rótulos legíveis, sem exibir identificadores técnicos', () => {
  const value = {birthDate:'2026-11-20', custom_clinical_note:'Observação', baby_id:babyOne.id, ownerId:'owner', version:5};
  const html=formatClinicalField(value,[babyOne],options);
  assert.match(html,/Data de nascimento|Data do nascimento|Data do parto|Birth date/i);
  assert.match(html,/Observação/);
  assert.doesNotMatch(html,/Registro complementar|ownerId|baby_id|version|11111111-1111/);
});

test('texto clínico não é truncado quando contém UUID incidental e HTML é escapado',()=>{
  const uuid=babyOne.id;
  const rendered=formatClinicalField({notes:'Referência '+uuid+' <marcador>'},[],options);
  assert.ok(rendered.includes(uuid),'não remover trechos do relato clínico');
  assert.ok(rendered.includes('&lt;marcador&gt;'));
  assert.ok(!rendered.includes('<marcador>'));
});

test('campos por bebê mantêm os dados de cada criança e nenhum identificador bruto',()=>{
  const result=renderClinicalHistory(postnatal,[babyOne,babyTwo],options);
  const babyHtml=result.sections.find(([label])=>label==='Avaliação do bebê')[1];
  assert.match(babyHtml,/Lia/);
  assert.match(babyHtml,/Caio/);
  assert.match(babyHtml,/3650/);
  assert.match(babyHtml,/3700/);
  assert.doesNotMatch(babyHtml,/11111111-1111|22222222-2222|Registro complementar/);
});

test('valores vazios são ignorados, zeros e negativas são preservados e dados monetários formatados',()=>{
  const rendered=formatClinicalField({painScore:0,allergiesKnown:false,notes:'',value:54.9},[],options);
  assert.match(rendered,/0/);
  assert.match(rendered,/Não/);
  assert.doesNotMatch(rendered,/>\s*Observações\s*</);
  assert.match(rendered,/R\$/);
});