import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const required=[
  'public/phase35-loader.js',
  'public/album-feature.js',
  'public/album-feature.css',
  'public/referral-templates.js',
  'public/referrals-feature.js',
  'public/referrals-feature.css',
  'supabase/phase-clinical-media-referrals.sql'
];

test('phase 3-5 files exist',()=>{
  for(const file of required)assert.equal(existsSync(file),true,`${file} must exist`);
});

test('album is SQL indexed and does not use localStorage as clinical source',()=>{
  const src=readFileSync('public/album-feature.js','utf8');
  assert.match(src,/clinical_media/);
  assert.match(src,/mother_id/);
  assert.match(src,/baby_id/);
  assert.match(src,/encounter_id/);
  assert.doesNotMatch(src,/localStorage\.setItem\([^\n]*album|localStorage\.getItem\([^\n]*album/i);
});

test('referrals include specialty templates and safe prefill fields',()=>{
  const src=readFileSync('public/referral-templates.js','utf8');
  for(const specialty of ['Pediatria','Fonoaudiologia','Ginecologia e Obstetrícia','Mastologia','Fisioterapia','Osteopatia','Psicologia','Psiquiatria','Clínica Geral','Odontologia/Odontopediatria','Nutrição','Outro'])assert.match(src,new RegExp(specialty.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(src,/motherName/);
  assert.match(src,/babyName/);
  assert.match(src,/chiefComplaint/);
  assert.match(src,/careSummary/);
});

test('referral editor saves through clinical_documents and can generate PDF',()=>{
  const src=readFileSync('public/referrals-feature.js','utf8');
  assert.match(src,/document_type:'referral'/);
  assert.match(src,/createReferralPdf/);
  assert.match(src,/contenteditable/);
  assert.match(src,/encounter_id/);
});

test('phase 3-5 loader is wired additively',()=>{
  const index=readFileSync('index.html','utf8');
  const loader=readFileSync('public/phase35-loader.js','utf8');
  assert.match(index,/\/phase35-loader\.js/);
  assert.match(loader,/album-feature\.js/);
  assert.match(loader,/referrals-feature\.js/);
});

test('database migration is additive and owner scoped',()=>{
  const sql=readFileSync('supabase/phase-clinical-media-referrals.sql','utf8');
  assert.match(sql,/create table if not exists public\.clinical_media/i);
  assert.match(sql,/owner_id\s*=\s*auth\.uid\(\)/i);
  assert.match(sql,/validate_clinical_media_links/i);
  assert.doesNotMatch(sql,/drop table|drop column|alter table[^;]+rename/i);
});
