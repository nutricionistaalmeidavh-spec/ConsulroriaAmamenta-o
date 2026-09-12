import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const featurePath='public/package-audit-feature.js';
const feature=()=>readFileSync(featurePath,'utf8');
const loader=()=>readFileSync('public/phase68-loader.js','utf8');
const migration=()=>readFileSync('supabase/phase-package-session-controls.sql','utf8');

test('package audit feature is loaded with the patient workspace',()=>{
  assert.equal(existsSync(featurePath),true,'package audit feature must exist');
  assert.match(loader(),/package-audit-feature\.js/);
});

test('package UI separates procedures from consultation counter',()=>{
  const src=feature();
  assert.match(src,/Procedimentos e serviços adicionais/);
  assert.match(src,/Contagem separada das consultas do pacote/);
  assert.match(src,/Registrar procedimento/);
  assert.match(src,/Adicionar procedimento\/serviço/);
});

test('package UI exposes consultation consumption audit history',()=>{
  const src=feature();
  assert.match(src,/care_package_sessions\?package_id=eq\./);
  for(const token of ['source','consumed_at','appointment_id','encounter_id','notes','Histórico de consultas','Atendimento vinculado','Baixa manual'])assert.ok(src.includes(token),`${token} missing`);
});

test('package session persistence records automatic and manual origin',()=>{
  const sql=migration();
  assert.match(sql,/source in \('appointment','manual'\)/);
  assert.match(sql,/set source='appointment'/);
  assert.match(sql,/'manual'/);
});
