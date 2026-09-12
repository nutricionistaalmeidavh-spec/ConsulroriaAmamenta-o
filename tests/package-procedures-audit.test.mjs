import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const billing=()=>readFileSync('public/billing-v2.js','utf8');
const migration=()=>readFileSync('supabase/phase-package-session-controls.sql','utf8');

test('package UI separates procedures from consultation counter',()=>{
  const src=billing();
  assert.match(src,/Procedimentos e serviços adicionais/);
  assert.match(src,/Contagem separada das consultas do pacote/);
  assert.match(src,/Registrar procedimento/);
  assert.doesNotMatch(src,/Serviços incluídos depois/);
});

test('package UI exposes consultation consumption audit history',()=>{
  const src=billing();
  assert.match(src,/care_package_sessions\?package_id=eq\./);
  for(const token of ['source','consumed_at','appointment_id','encounter_id','notes','Histórico de consultas','Atendimento vinculado','Baixa manual'])assert.ok(src.includes(token),`${token} missing`);
});

test('package session persistence records automatic and manual origin',()=>{
  const sql=migration();
  assert.match(sql,/source in \('appointment','manual'\)/);
  assert.match(sql,/set source='appointment'/);
  assert.match(sql,/'manual'/);
});
