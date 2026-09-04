import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const required=[
  'public/phase68-loader.js',
  'public/referral-finalization.js',
  'public/record-export-feature.js',
  'public/record-export-feature.css',
  'public/patient-records-hub.js',
  'public/patient-records-hub.css'
];

test('phase 6-8 files exist',()=>{
  for(const file of required)assert.equal(existsSync(file),true,`${file} must exist`);
});

test('phase 6 finalizes referral without changing its clinical links',()=>{
  const src=readFileSync('public/referral-finalization.js','utf8');
  assert.match(src,/status:'finalized'/);
  assert.match(src,/finalized_at/);
  assert.match(src,/createReferralPdf/);
  assert.match(src,/sharePdf/);
  assert.match(src,/encounter_id/);
  assert.match(src,/appointment_id/);
  assert.match(src,/baby_id/);
  assert.doesNotMatch(src,/delete.*clinical_documents|method:'DELETE'.*clinical_documents/s);
});

test('phase 7 export is structured from persisted patient data and not DOM scraping',()=>{
  const src=readFileSync('public/record-export-feature.js','utf8');
  for(const table of ['mothers','babies','clinical_encounters','consents','clinical_documents','clinical_media'])assert.ok(src.includes(table),`${table} source missing`);
  assert.match(src,/Resumo clínico/);
  assert.match(src,/Prontuário completo/);
  assert.match(src,/Todos os bebês/);
  assert.match(src,/periodStart|period_start/);
  assert.match(src,/periodEnd|period_end/);
  assert.doesNotMatch(src,/document\.body\.innerText|outerHTML|cloneNode\(true\)/);
});

test('export excludes photos by default and makes inclusion explicit',()=>{
  const src=readFileSync('public/record-export-feature.js','utf8');
  assert.match(src,/includeMedia:false/);
  assert.match(src,/Fotos e mídia clínica/);
});

test('phase 8 groups records without removing existing functional cards',()=>{
  const src=readFileSync('public/patient-records-hub.js','utf8');
  assert.match(src,/Registros e documentos/);
  assert.match(src,/Termos/);
  assert.match(src,/Encaminhamentos/);
  assert.match(src,/Álbum clínico/);
  assert.match(src,/Exportar prontuário/);
  assert.doesNotMatch(src,/\.remove\(\).*data-(?:df-terms-card|rf-card|af-card)/s);
});

test('phase 6-8 loader is additive',()=>{
  const index=readFileSync('index.html','utf8');
  const loader=readFileSync('public/phase68-loader.js','utf8');
  assert.match(index,/\/phase68-loader\.js/);
  assert.match(loader,/referral-finalization\.js/);
  assert.match(loader,/record-export-feature\.js/);
  assert.match(loader,/patient-records-hub\.js/);
});
