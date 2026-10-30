import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const feature = await import('../public/prenatal-questionnaire-feature.js');
const app = readFileSync(resolve(root, 'public/clinical-source/core/app-shell.js'), 'utf8');
const bootstrap = readFileSync(resolve(root, 'src/bootstrap.js'), 'utf8');
const entry = readFileSync(resolve(root, 'index.html'), 'utf8');

test('pre-natal contains precisely the 17 approved questions in original order', () => {
  const items = feature.PRENATAL_QUESTIONS;
  assert.equal(items.length, 17);
  assert.deepEqual(items.map(item => item.number), Array.from({length:17}, (_, i) => i+1));
  assert.deepEqual(items.map(item => item.title), [
    'Retorno ao trabalho', 'Endereço', 'Nome do bebê', 'Equipe obstétrica',
    'Doenças preexistentes ou durante a gestação', 'Histórico de depressão',
    'Uso de medicamentos', 'Cirurgias nas mamas', 'Mudanças nas mamas durante a gestação',
    'Previsão de nascimento', 'Histórico gestacional', 'Experiência prévia com amamentação',
    'Expectativas com o pré-natal de amamentação', 'Como conheceu a consultoria?',
    'Escolha da consultora de amamentação', 'Declaração de veracidade das informações',
    'Autorização para realização da consulta e compartilhamento de informações'
  ]);
  assert.match(items[13].prompt, /Como você conheceu minha consultoria de amamentação\?/);
  assert.equal(items[5].type, 'yesno');
  assert.equal(items[8].type, 'yesno');
  assert.equal(items[15].type, 'checkbox');
  assert.equal(items[16].type, 'checkbox');
});

test('prenatal is distinct from the other 3 appointment types', () => {
  assert.equal(feature.isPrenatal('Pré-natal'), true);
  for (const type of ['Consulta inicial','Retorno','Acompanhamento']) assert.equal(feature.isPrenatal(type), false);
});

test('draft serialization preserves free text and explicit consent without assuming consent', () => {
  const raw = feature.serializePrenatalAnswers({
    babyName: 'A definir',
    maternalConditions: 'Diabetes gestacional, em acompanhamento',
    depressionHistory: 'Não',
    breastChanges: 'Sim',
    declaration: true,
    consultationAuthorization: false
  });
  const parsed = feature.parsePrenatalAnswers(raw);
  assert.equal(parsed.babyName, 'A definir');
  assert.equal(parsed.maternalConditions, 'Diabetes gestacional, em acompanhamento');
  assert.equal(parsed.depressionHistory, 'Não');
  assert.equal(parsed.consultationAuthorization, false);
  assert.equal(parsed.declaration, true);
  assert.deepEqual(feature.parsePrenatalAnswers('{invalid'), {});
  assert.equal(feature.parsePrenatalAnswers('').consultationAuthorization, undefined);
});

test('prenatal module is loaded in the real frontend and question set is isolated', () => {
  assert.match(bootstrap, /await importPublicModule\('\/prenatal-questionnaire-feature\.js\?canonical-runtime=1'\)/);
  assert.ok(bootstrap.indexOf('document.close()') < bootstrap.indexOf("await importPublicModule('/prenatal-questionnaire-feature.js?canonical-runtime=1')"));
  assert.doesNotMatch(entry, /<script[^>]+src="\/prenatal-questionnaire-feature\.js"/);
  assert.match(app, /if \(!selectedBabies\.length && !isPrenatalAppointment\(\)\)/);
  assert.match(app, /p_baby_ids: selectedBabies\.map/);
  assert.match(app, /if \(isPrenatalAppointment\(\) && !prenatalDeclarationConfirmed/);
  assert.match(app, /ident\.appointmentType === 'Pré-natal' \? null : followupDue/);
});
