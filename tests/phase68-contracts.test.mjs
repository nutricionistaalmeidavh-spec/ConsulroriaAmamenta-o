import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createReferralPdf,createRecordPdf} from '../public/document-pdf-service.js';

const required=[
  'public/phase68-loader.js',
  'public/referral-finalization.js',
  'public/record-export-feature.js',
  'public/record-export-feature.css',
  'public/patient-records-hub.js',
  'public/patient-records-hub.css',
  'public/patient-workspace.js',
  'public/patient-workspace.css'
];

test('phase 6-8 files exist',()=>{for(const file of required)assert.equal(existsSync(file),true,`${file} must exist`)});

test('referral PDF is generated from finalized structured content',async()=>{
  const pdf=createReferralPdf({motherName:'Ana',babyName:'João',specialtyLabel:'Fonoaudiologia',destination:'Dra. Maria',html:'<p>Encaminho para avaliação.</p>',finalizedAt:'2026-09-04T12:00:00-03:00'});
  assert.equal(pdf.type,'application/pdf');assert.ok(pdf.size>400);const bytes=new Uint8Array(await pdf.arrayBuffer());assert.equal(String.fromCharCode(...bytes.slice(0,4)),'%PDF');
});

test('record PDF paginates long structured exports instead of truncating them',async()=>{
  const sections=Array.from({length:24},(_,i)=>({title:`Atendimento ${i+1}`,body:[`Registro clínico ${i+1} `.repeat(25)]}));const pdf=createRecordPdf({motherName:'Ana',modeLabel:'Prontuário completo',sections});assert.equal(pdf.type,'application/pdf');const text=new TextDecoder('windows-1252').decode(await pdf.arrayBuffer());assert.match(text,/\/Count [2-9][0-9]*/);
});

test('phase 6 finalizes referral without changing its clinical links',()=>{
  const src=readFileSync('public/referral-finalization.js','utf8');for(const token of ["status:'finalized'",'finalized_at','createReferralPdf','sharePdf','encounter_id','appointment_id','baby_id'])assert.ok(src.includes(token),`${token} missing`);assert.doesNotMatch(src,/delete.*clinical_documents|method:'DELETE'.*clinical_documents/s);
});

test('phase 7 export is structured from persisted patient data and not DOM scraping',()=>{
  const src=readFileSync('public/record-export-feature.js','utf8');for(const table of ['mothers','babies','clinical_encounters','consents','clinical_documents','clinical_media','weights'])assert.ok(src.includes(table),`${table} source missing`);assert.match(src,/Resumo clínico/);assert.match(src,/Prontuário completo/);assert.match(src,/Todos os bebês/);assert.match(src,/periodStart|period_start/);assert.match(src,/periodEnd|period_end/);assert.doesNotMatch(src,/document\.body\.innerText|outerHTML|cloneNode\(true\)/);
});

test('export excludes photos by default and makes inclusion explicit',()=>{const src=readFileSync('public/record-export-feature.js','utf8');assert.match(src,/includeMedia:false/);assert.match(src,/Fotos e mídia clínica/)});

test('patient overview opens dedicated workspaces instead of scrolling to large inline cards',()=>{
  const hub=readFileSync('public/patient-records-hub.js','utf8'),workspace=readFileSync('public/patient-workspace.js','utf8');assert.match(hub,/DeboraPatientWorkspace/);assert.match(hub,/\['terms','referrals','album'\]/);assert.match(hub,/\.open\(kind,motherId/);assert.doesNotMatch(hub,/scrollIntoView/);for(const label of ['Álbum clínico','Encaminhamentos','Termos e autorizações','Prontuários'])assert.ok(workspace.includes(label),`${label} workspace missing`);
});

test('patient summary suppresses heavy inline cards and replaces the long record list with recent records',()=>{
  const css=readFileSync('public/patient-workspace.css','utf8'),workspace=readFileSync('public/patient-workspace.js','utf8');for(const selector of ['data-af-card','data-rf-card','data-df-terms-card','data-rx-card','data-pf-prontuario'])assert.ok(css.includes(selector),`${selector} must be suppressed in patient summary`);assert.match(css,/display:\s*none\s*!important/);assert.match(workspace,/Prontuários recentes/);assert.match(workspace,/Ver todos/);
});

test('quick actions repurpose call, photo and route slots without exposing obsolete labels',()=>{
  const src=readFileSync('public/patient-workspace.js','utf8');for(const label of ['WhatsApp','Álbum','Registrar peso','Encaminhar','Mais ações'])assert.ok(src.includes(label),`${label} quick action missing`);assert.match(src,/setQuick\(phone,'Álbum'/);assert.match(src,/setQuick\(photo,'Encaminhar'/);assert.match(src,/setQuick\(route,'Mais ações'/);assert.doesNotMatch(src,/setQuick\([^\n]*,'Ligar'/);assert.doesNotMatch(src,/setQuick\([^\n]*,'Adicionar foto'/);
});

test('phase 6-8 loader remains additive and loads the patient workspace',()=>{
  const index=readFileSync('index.html','utf8'),loader=readFileSync('public/phase68-loader.js','utf8');assert.match(index,/\/phase68-loader\.js/);for(const file of ['referral-finalization.js','record-export-feature.js','patient-records-hub.js','patient-workspace.js'])assert.ok(loader.includes(file),`${file} missing from loader`);
});
