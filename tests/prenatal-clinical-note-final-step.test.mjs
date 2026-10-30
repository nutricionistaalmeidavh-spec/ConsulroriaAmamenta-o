import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { enhanceClinicalNoteWithPrenatalFinalStep } from '../src/clinical-note-prenatal-final-step.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base=readFileSync(resolve(root,'public/clinical-source/features/clinical-note-feature.js'),'utf8');
const enhanced=enhanceClinicalNoteWithPrenatalFinalStep(base);
const prenatal=readFileSync(resolve(root,'public/prenatal-questionnaire-feature.js'),'utf8');
const bootstrap=readFileSync(resolve(root,'src/bootstrap.js'),'utf8');

test('pré-natal opens the existing persisted clinical note only at wizard step 7',()=>{
  assert.match(enhanced,/function cnIsPrenatalLastStep\(step,btn\)/);
  assert.match(enhanced,/step\?\.dataset\.wizardStep==='7'/);
  assert.match(enhanced,/\[data-wizard-next\]/);
  assert.match(enhanced,/cnIsPrenatalLastStep\(step,btn\)\|\|\(!cnIsPrenatalWizardMode\(\)&&cnIsChief/);
  assert.match(enhanced,/cnIsPrenatalWizardMode\(\)\?'Salvar prontuário e concluir':'Continuar'/);
  assert.match(bootstrap,/enhanceClinicalNoteWithPrenatalFinalStep\(enhanceClinicalNoteWithRecovery/);
});

test('postpartum note keeps early forward and backward steps unchanged',()=>{
  assert.match(enhanced,/!cnIsPrenatalWizardMode\(\)&&cnIsChief\(step\)&&cnForwardButton\(btn\)/);
  assert.match(enhanced,/!cnIsPrenatalWizardMode\(\)&&cnIsMaternal\(step\)&&cnBackButton\(btn\)/);
  assert.match(enhanced,/cnInvoke\(cnState.pendingButton\)/);
  assert.match(enhanced,/async function cnFlush\(/);
  assert.match(enhanced,/function cnResolveEncounter\(/);
  assert.equal(enhanceClinicalNoteWithPrenatalFinalStep(enhanced),enhanced,'idempotent');
});

test('step 7 is a clinical note, and the enhancement introduces no observer',()=>{
  assert.match(prenatal,/<h2>Prontuário<\/h2>/);
  assert.match(prenatal,/next\.textContent='Abrir prontuário'/);
  assert.doesNotMatch(prenatal,/Finalização do pré-natal/);
  const count=(s)=>(s.match(/new MutationObserver\s*\(/g)||[]).length;
  assert.equal(count(enhanced),count(base),'no additional MutationObserver');
  assert.doesNotMatch(enhanced,/setInterval\s*\(/);
});
