import test from 'node:test';
import assert from 'node:assert/strict';
import { canPublishToMother, buildSafeMotherShare, isPublishedForMother } from '../public/mother-portal-contract.js';

test('only reviewed and explicitly permitted mother-facing kinds can be published', () => {
  assert.equal(canPublishToMother({kind:'orientation',title:'Cuidados da semana',body:'Orientar pega'}),true);
  assert.equal(canPublishToMother({kind:'care_plan',title:'Meu cuidado',body:'Orientações'}),true);
  assert.equal(canPublishToMother({kind:'document',title:'Guia de ordenha',attachment_path:'owner/guide.pdf'}),true);
  assert.equal(canPublishToMother({kind:'evaluation',title:'Avaliação completa',body:'Anamnese'}),false);
  assert.equal(canPublishToMother({kind:'document',title:'Prontuário completo',body:'Notas'}),false);
  assert.equal(canPublishToMother({kind:'orientation',title:'',body:'Texto'}),false);
});
test('weekly projections reuse only selected canonical care plan, never private assessment', () => {
  const encounter={id:'enc-1',mother_id:'mom-1',occurred_at:'2026-10-20',chief_complaint:'SEGREDO',
    maternal_assessment:{notes:'PRIVADO'}, care_plan:{orientation_mode:'weekly',instructions:'não publicar',
      weekly_plan:{start_date:'2026-10-20',weeks:[{instructions:'Orientação semana um'},{instructions:'Orientação semana dois'}]}}};
  const result=buildSafeMotherShare(encounter);
  assert.equal(result.kind,'care_plan');
  assert.match(result.body,/Semana 1/);
  assert.match(result.body,/Orientação semana dois/);
  assert.doesNotMatch(result.body,/PRIVADO|SEGREDO|não publicar/);
  assert.equal(result.source_id,'enc-1');
  assert.equal(result.mother_id,'mom-1');
});
test('single plan never leaks archived weekly notes', () => {
  const result=buildSafeMotherShare({care_plan:{orientation_mode:'single',instructions:'Orientação única',
    weekly_plan:{weeks:[{instructions:'Semana antiga'}],start_date:'2026-10-20'}}});
  assert.match(result.body,/Orientação única/);
  assert.doesNotMatch(result.body,/Semana antiga/);
});
test('a published safe item can be read only while active', () => {
  const good={kind:'orientation',title:'Cuidados',body:'Texto',published:true};
  assert.equal(isPublishedForMother(good),true);
  assert.equal(isPublishedForMother({...good,published:false}),false);
  assert.equal(isPublishedForMother({...good,kind:'evaluation'}),false);
});
