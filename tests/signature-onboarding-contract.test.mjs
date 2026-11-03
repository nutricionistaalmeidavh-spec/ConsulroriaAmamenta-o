import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSignatureSelections, patientConsentSnapshot } from '../public/signature-onboarding-core.js';

test('request selection is independent from prior consent grants',()=>{
  const values={data_processing:false,whatsapp:true,clinical_media:false,public_media:true};
  const before=JSON.stringify(values);
  const selected=getSignatureSelections(['data_processing','whatsapp','data_processing','invalid','public_media']);
  assert.deepEqual(selected,['data_processing','whatsapp','public_media']);
  assert.equal(JSON.stringify(values),before);
  assert.deepEqual(patientConsentSnapshot(values),values);
});
test('unrecognized term selection cannot create requests',()=>{
  assert.deepEqual(getSignatureSelections(['fake','teleconsultation','__proto__']),['teleconsultation']);
});
test('clinical materializer owns the email field, save hook and selection UI across rebuild',()=>{
  const materializer=readFileSync(new URL('../scripts/materialize-clinical-source.mjs',import.meta.url),'utf8');
  const helper=readFileSync(new URL('../scripts/lib/signature-onboarding-materialize.mjs',import.meta.url),'utf8');
  const addressHardener=readFileSync(new URL('../scripts/lib/patient-address-hardening.mjs',import.meta.url),'utf8');
  assert.match(materializer,/applySignatureOnboardingMaterialization/);
  assert.match(helper,/signature-onboarding-email-field/);
  assert.match(helper,/signature-onboarding-saved-event/);
  assert.match(addressHardener,/signature-onboarding-persist-email/);
  assert.match(helper,/signature-onboarding-selection-ui/);
  if(process.env.SIGNATURE_ONBOARDING_BUILT!=='1')return;
  const runtime=readFileSync(new URL('../public/clinical-source/core/app-shell.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../public/clinical-source/index.html',import.meta.url),'utf8');
  assert.match(materializer,/signature-onboarding-email-field/);
  assert.match(materializer,/signature-onboarding-saved-event/);
  assert.match(materializer,/signature-onboarding-persist-email/);
  assert.match(materializer,/signature-onboarding-selection-ui/);
  assert.match(runtime,/debora:patient-saved/);
  assert.match(runtime,/email: get\('motherEmail'\)/);
  assert.match(html,/name="motherEmail"/);
  assert.match(html,/data-signature-select="whatsapp"/);
  assert.match(html,/data-legacy-consents/);
});
test('local integration fixture includes additive signature migration without disabling earlier schema',()=>{
  const helper=readFileSync(new URL('helpers/cloudflare-local.mjs',import.meta.url),'utf8');
  assert.match(helper,/migrations\/0019-signature-foundation\.sql/);
  assert.match(helper,/full-migration-schema\.sql/);
});
