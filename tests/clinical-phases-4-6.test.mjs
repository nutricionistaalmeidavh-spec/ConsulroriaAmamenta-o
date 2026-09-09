import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const featurePath = resolve(root, 'public/clinical-care-flow-feature.js');
const rootEntryPath = resolve(root, 'index.html');
const appEntryPath = resolve(root, 'app/index.html');
const referralTemplatesPath = resolve(root, 'public/referral-templates.js');
const featureExists = existsSync(featurePath);

test('phases 4-6: additive clinical care module is wired in both app entry points', () => {
  assert.equal(featureExists, true, 'clinical care flow feature must exist');
  assert.match(readFileSync(rootEntryPath, 'utf8'), /clinical-care-flow-feature\.js/);
  assert.match(readFileSync(appEntryPath, 'utf8'), /clinical-care-flow-feature\.js/);
});

test('phase 4: consultation context derives pre/postpartum without changing appointment type', { skip: !featureExists }, async () => {
  const feature = await import(`${pathToFileURL(featurePath).href}?context=${Date.now()}`);
  assert.equal(feature.deriveCareStage('Pré-natal'), 'Pré-parto');
  assert.equal(feature.deriveCareStage('Consulta inicial'), 'Pós-parto');
  assert.equal(feature.deriveCareStage('Retorno'), 'Pós-parto');
  assert.equal(feature.deriveCareStage('Acompanhamento'), 'Pós-parto');
});

test('phase 4: feeding checklist is presence-based and makes no clinical judgement', { skip: !featureExists }, async () => {
  const feature = await import(`${pathToFileURL(featurePath).href}?feeding=${Date.now()}`);
  assert.deepEqual(feature.feedingChecklistStatus({ beforeFeed: 'Bebê acordado', position: 'Tradicional', latch: '', suckSwallow: ['Sucção rítmica'], afterFeed: '' }), {
    beforeFeed: true,
    position: true,
    latch: false,
    suckSwallow: true,
    afterFeed: false
  });
});

test('phase 5: structured care plan composes a compatible instruction summary', { skip: !featureExists }, async () => {
  const feature = await import(`${pathToFileURL(featurePath).href}?plan=${Date.now()}`);
  const text = feature.buildCarePlanInstructions({
    priorityGuidance: 'Prioridade 1',
    feedingPositioning: 'Posicionamento registrado',
    expressionSupplement: '',
    routine: 'Rotina combinada',
    warningSigns: 'Sinais discutidos'
  });
  assert.match(text, /Orientações prioritárias:\nPrioridade 1/);
  assert.match(text, /Mamada e posicionamento:\nPosicionamento registrado/);
  assert.match(text, /Rotina:\nRotina combinada/);
  assert.match(text, /Sinais de alerta:\nSinais discutidos/);
  assert.doesNotMatch(text, /Ordenha \/ complemento/);
});

test('phase 5: referral specialty catalog keeps roadmap destinations', () => {
  const source = readFileSync(referralTemplatesPath, 'utf8');
  for (const label of ['Pediatria', 'Fonoaudiologia', 'Mastologia', 'Ginecologia e Obstetrícia', 'Odontologia/Odontopediatria', 'Fisioterapia', 'Osteopatia']) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('phase 6: mother portal allowlist excludes professional record, anamnesis and referrals', { skip: !featureExists }, async () => {
  const feature = await import(`${pathToFileURL(featurePath).href}?portal=${Date.now()}`);
  assert.equal(feature.isMotherShareAllowed({ kind: 'care_plan', title: 'Plano de cuidado' }), true);
  assert.equal(feature.isMotherShareAllowed({ kind: 'orientation', title: 'Orientações' }), true);
  assert.equal(feature.isMotherShareAllowed({ kind: 'document', title: 'Termo de consentimento' }), true);
  assert.equal(feature.isMotherShareAllowed({ kind: 'appointment', title: 'Próximo retorno' }), true);
  assert.equal(feature.isMotherShareAllowed({ kind: 'evaluation', title: 'Avaliação completa' }), false);
  assert.equal(feature.isMotherShareAllowed({ kind: 'document', title: 'Prontuário completo' }), false);
  assert.equal(feature.isMotherShareAllowed({ kind: 'referral', title: 'Encaminhamento pediatria' }), false);
  assert.equal(feature.isMotherShareAllowed({ kind: 'anamnesis', title: 'Anamnese' }), false);
});

test('phase 6: generated mother summary uses only care plan and next-return data', { skip: !featureExists }, async () => {
  const feature = await import(`${pathToFileURL(featurePath).href}?safe=${Date.now()}`);
  const summary = feature.buildMotherSafeEncounterShare({
    occurred_at: '2026-09-09T10:00:00Z',
    chief_complaint: { notes: 'NÃO EXPOR QUEIXA' },
    maternal_assessment: { notes: 'NÃO EXPOR ANAMNESE' },
    baby_assessment: { notes: 'NÃO EXPOR BEBÊ' },
    feeding_assessment: { notes: 'NÃO EXPOR MAMADA' },
    care_plan: { objectives: 'Objetivo compartilhável', instructions: 'Orientação compartilhável', followup: '48 horas' },
    finalization: { notes: 'NÃO EXPOR FINALIZAÇÃO INTERNA' }
  });
  assert.match(summary.body, /Objetivo compartilhável/);
  assert.match(summary.body, /Orientação compartilhável/);
  assert.match(summary.body, /48 horas/);
  assert.doesNotMatch(summary.body, /NÃO EXPOR/);
  assert.equal(summary.kind, 'care_plan');
});
