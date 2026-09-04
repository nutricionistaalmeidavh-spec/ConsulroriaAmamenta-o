import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {buildReferralDraft,getReferralSpecialty} from '../public/referral-templates.js';

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
  assert.match(src,/clinical_media.*consent|consent_type==='clinical_media'/s);
  assert.doesNotMatch(src,/localStorage\.setItem\([^\n]*album|localStorage\.getItem\([^\n]*album/i);
});

test('referrals include specialty templates and safe prefill fields',()=>{
  const src=readFileSync('public/referral-templates.js','utf8');
  for(const specialty of ['Pediatria','Fonoaudiologia','Ginecologia e Obstetrícia','Mastologia','Fisioterapia','Osteopatia','Psicologia','Psiquiatria','Clínica Geral','Odontologia/Odontopediatria','Nutrição','Outro'])assert.ok(src.includes(specialty),`${specialty} template missing`);
  assert.match(src,/motherName/);
  assert.match(src,/babyName/);
  assert.match(src,/chiefComplaint/);
  assert.match(src,/careSummary/);
});

test('referral editor persists only a draft in phase 5',()=>{
  const src=readFileSync('public/referrals-feature.js','utf8');
  assert.match(src,/document_type:'referral'/);
  assert.match(src,/status:'draft'/);
  assert.match(src,/contenteditable="true"/);
  assert.match(src,/encounter_id/);
  assert.doesNotMatch(src,/createReferralPdf|finalized_at|status:'finalized'/);
});

test('phase 3-5 loader is wired additively',()=>{
  const index=readFileSync('index.html','utf8');
  const loader=readFileSync('public/phase35-loader.js','utf8');
  assert.match(index,/\/phase35-loader\.js/);
  assert.match(loader,/album-feature\.js/);
  assert.match(loader,/referrals-feature\.js/);
});

test('referral prefill uses recorded values and keeps missing clinical motive explicit',()=>{
  const draft=buildReferralDraft({
    specialty:'fonoaudiologia',
    motherName:'Ana',
    babyName:'João',
    babyAge:'18 dias',
    chiefComplaint:'Dor e dificuldade de pega',
    careSummary:'Ajuste de posição e observação de mamada',
    weightText:'Peso atual registrado: 3.420 g'
  });
  assert.equal(getReferralSpecialty('fonoaudiologia').label,'Fonoaudiologia');
  assert.match(draft.html,/Ana/);
  assert.match(draft.html,/João/);
  assert.match(draft.html,/Dor e dificuldade de pega/);
  assert.match(draft.html,/Ajuste de posição/);
  assert.match(draft.html,/\[Descreva achados de sucção/);
  assert.doesNotMatch(draft.html,/undefined|null/);
});

test('database migration is additive and owner scoped',()=>{
  const sql=readFileSync('supabase/phase-clinical-media-referrals.sql','utf8');
  assert.match(sql,/create table if not exists public\.clinical_media/i);
  assert.match(sql,/owner_id\s*=\s*auth\.uid\(\)/i);
  assert.match(sql,/validate_clinical_media_links/i);
  assert.doesNotMatch(sql,/drop table|drop column|alter table[^;]+rename/i);
});

test('clinical document templates do not collide with the existing document_templates table',()=>{
  const sql=readFileSync('supabase/phase-clinical-documents-terms.sql','utf8');
  assert.match(sql,/public\.clinical_document_templates/);
  assert.doesNotMatch(sql,/create table if not exists public\.document_templates\s*\(/i);
});
