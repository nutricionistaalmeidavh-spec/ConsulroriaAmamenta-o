import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeWeeklyPlan, validStartDate, weeklyPlanError,
  weeklyPlanPdfSections, weeklyPlanText, weekPeriodLabel, orientationMode
} from '../patch-source/weekly-care-plan/core/lib/weekly-care-plan.js';
import { buildEncounterPayload } from '../public/clinical-source/core/lib/encounter-form.js';

test('semanas futuras ficam no care_plan do mesmo atendimento, sem sobrescrever orientações gerais', () => {
  const weekly_plan = normalizeWeeklyPlan({
    start_date: '2026-10-08',
    weeks: Array.from({length: 4}, (_, i) => ({week:i+1, instructions:'Conduta específica ' + (i+1)}))
  });
  const record = buildEncounterPayload({
    motherId: 'mae-1', babyId: 'bebe-1', appointmentId: 'consulta-1',
    state: {care_plan:{objectives:'Objetivos originais',instructions:'Orientações gerais',weekly_plan}}
  });
  assert.equal(record.appointment_id, 'consulta-1');
  assert.equal(record.care_plan.instructions, 'Orientações gerais');
  assert.equal(record.care_plan.weekly_plan.weeks.length, 4);
  assert.equal(record.care_plan.weekly_plan.weeks[3].instructions, 'Conduta específica 4');
  assert.equal(record.care_plan.weekly_plan.start_date, '2026-10-08');
});

test('períodos de sete dias são determinísticos e independentes do horário de execução', () => {
  assert.equal(validStartDate('2026-02-29'), '');
  assert.equal(validStartDate('2024-02-29'), '2024-02-29');
  assert.equal(weekPeriodLabel('2026-10-08',1), '08/10/2026 a 14/10/2026');
  assert.equal(weekPeriodLabel('2026-10-08',4), '29/10/2026 a 04/11/2026');
});

test('semana incompleta pode ser rascunho, mas não pode ser finalizada inadvertidamente', () => {
  const incomplete={start_date:'2026-10-08',weeks:[{week:1,instructions:'Primeira'},{week:2,instructions:'   '}]};
  assert.match(weeklyPlanError(incomplete),/Preencha ou remova/);
  assert.match(weeklyPlanError({start_date:'',weeks:[{instructions:'Primeira'}]}),/data inicial/);
  assert.equal(weeklyPlanError({start_date:'2026-10-08',weeks:[{instructions:'Primeira'}]}),null);
  assert.equal(weeklyPlanError(null),null);
  assert.equal(normalizeWeeklyPlan({weeks:[]}),null);
});

test('PDF e WhatsApp reutilizam o mesmo objeto semanal e mantêm cada texto na ordem correta', () => {
  const plan = {start_date:'2026-10-08',weeks:[
    {instructions:'Orientar pega e posicionamento.'},
    {instructions:'Avaliar rotina.\nRegistrar dúvidas.'},
    {instructions:'Reforçar orientações da semana 3.'},
    {instructions:'Preparar o retorno.'}
  ]};
  const sections=weeklyPlanPdfSections(plan);
  assert.equal(sections.length,4);
  assert.equal(sections[0].title,'Orientações - Semana 1');
  assert.match(sections[0].lines.join(' '),/08\/10\/2026 a 14\/10\/2026/);
  assert.deepEqual(sections[1].lines.slice(1),['Avaliar rotina.','Registrar dúvidas.']);
  const message=weeklyPlanText(plan);
  assert.ok(message.indexOf('Semana 1')<message.indexOf('Semana 4'));
  assert.match(message,/Preparar o retorno/);
  assert.deepEqual(weeklyPlanPdfSections(null),[]);
});

test('materialização canônica é a única entrada do editor semanal, sem mexer no V5', () => {
  const source=readFileSync('scripts/materialize-clinical-source.mjs','utf8');
  const overlay=readFileSync('scripts/lib/weekly-care-plan-materialize.mjs','utf8');
  const v5=readFileSync('public/weight-evolution-v5.js','utf8');
  assert.match(source,/applyWeeklyCarePlan\(resolved, sourceByPath, ROOT\)/);
  assert.match(overlay,/core\/lib\/encounter-form\.js/);
  assert.match(overlay,/core\/lib\/pdf-service\.js/);
  assert.match(overlay,/weekly_plan/);
  assert.doesNotMatch(overlay,/weight-evolution-v5|weight-changes-v5/);
  assert.match(v5,/gf-v5-timeline/);
});

test('modo único é padrão, mas planos semanais antigos continuam reconhecidos',()=>{
  assert.equal(orientationMode(undefined,null),'single');
  assert.equal(orientationMode(undefined,{start_date:'2026-10-08',weeks:[{instructions:'Semana um'}]}),'weekly');
  assert.equal(orientationMode('single',{start_date:'2026-10-08',weeks:[{instructions:'texto preservado'}]}),'single');
  assert.equal(orientationMode('weekly',null),'weekly');
});

test('apenas a orientação selecionada entra no PDF ou WhatsApp sem apagar o outro rascunho',()=>{
  const weekly={start_date:'2026-10-08',weeks:[{instructions:'Texto semanal que será preservado'}]};
  assert.deepEqual(weeklyPlanPdfSections(weekly,'single'),[]);
  assert.equal(weeklyPlanText(weekly,'single'),'');
  assert.equal(weeklyPlanError(weekly,'single'),null);
  assert.equal(weeklyPlanPdfSections(weekly,'weekly').length,1);
  assert.match(weeklyPlanText(weekly,'weekly'),/Texto semanal/);
  assert.match(weeklyPlanError(null,'weekly'),/Adicione ao menos uma semana/);
  const encounter=buildEncounterPayload({
    motherId:'mae-1',state:{care_plan:{orientation_mode:'single',instructions:'Texto único',weekly_plan:weekly}}
  });
  assert.equal(encounter.care_plan.instructions,'Texto único');
  assert.equal(encounter.care_plan.weekly_plan.weeks[0].instructions,'Texto semanal que será preservado');
});
