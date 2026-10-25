import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewReferralContent} from '../public/referral-review.js';
import {isFrozenReferral,validateReferralMutation} from '../worker/referral-document-guard.js';

test('phase 5: identify clinical template placeholders with a line-specific warning',()=>{
 const result=reviewReferralContent('<p>Prezada equipe,</p><h2>Motivo do encaminhamento</h2><p>[Descreva o motivo clínico...]</p>');
 assert.ok(result.blockers.some(item=>item.includes('Descreva o motivo clínico')));
 assert.equal(result.canFinalize,false);
});
test('phase 5: warn about empty titled cards, without inventing content',()=>{
 const result=reviewReferralContent('<p>Bom dia</p><h2>Avaliação individualizada</h2><hr><p>Documento final.</p>');
 assert.ok(result.warnings.some(item=>item.includes('Avaliação individualizada')));
 assert.equal(result.canFinalize,true);
});
test('phase 5: normal authored clinical content passes unchanged',()=>{
 const html='<p>Prezados,</p><h2>Queixa atual</h2><p>Queixa de pega relatada pela família.</p><hr><p>À disposição.</p>';
 const result=reviewReferralContent(html);
 assert.equal(result.canFinalize,true);
 assert.equal(result.blockers.length,0);
 assert.equal(result.warnings.length,0);
 assert.equal(result.html,html);
});
test('phase 6: locked clinical referrals cannot be patched, deleted or upserted',()=>{
 const finalized={id:'ref-1',document_type:'referral',status:'finalized',content:{html:'<p>Registro assinado no sistema</p>'}};
 assert.equal(isFrozenReferral(finalized),true);
 for(const operation of ['PATCH','DELETE','UPSERT'])assert.equal(validateReferralMutation({record:finalized,method:operation}).allowed,false,operation);
 assert.equal(validateReferralMutation({record:{document_type:'referral',status:'draft'},method:'PATCH'}).allowed,true);
 assert.equal(validateReferralMutation({record:{document_type:'other',status:'finalized'},method:'PATCH'}).allowed,true);
});
test('phase 6: finalized referral cannot revert status even via client PATCH',()=>{
 const finalized={document_type:'referral',status:'finalized'};
 for(const patch of [{status:'draft'},{content:{html:'changed'}},{title:'renamed'}]){
  const r=validateReferralMutation({record:finalized,method:'PATCH',patch});assert.equal(r.allowed,false);
 }
});
test('phase 5: preview is based on buildPayload, not unsaved old draft; finalization review is shared',()=>{
 const fin=readFileSync('public/referral-finalization.js','utf8');
 assert.match(fin,/data-rf-preview/);
 assert.match(fin,/buildPayload\(\)/);
 assert.match(fin,/reviewReferralContent/);
 assert.match(fin,/createObjectURL/);
 assert.match(fin,/revokeObjectURL/);
 assert.match(fin,/draft\?\.status==='finalized'/);
});
test('phase 6: D1 and legacy runtime mutations enforce finalized immutable referral',()=>{
 for(const file of ['worker/cloudflare-data-runtime.js','worker/cloudflare-clinical-legacy-runtime.js']){
  const src=readFileSync(file,'utf8');
  assert.match(src,/validateReferralMutation/);
  assert.match(src,/referral_document_finalized_immutable/);
 }
});
