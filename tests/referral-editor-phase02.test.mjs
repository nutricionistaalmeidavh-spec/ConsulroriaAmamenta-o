import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getInsertableReferralFields, REFERRAL_EDITOR_BLOCKS} from '../public/referral-editor-structure.js';

const actual = (args={}) => getInsertableReferralFields(args);
const value = (fields,id) => fields.find(f=>f.id===id)?.value;

test('template headings are semantic and the extra section-creation editor is gone',()=>{
  const editor=readFileSync('public/referrals-feature.js','utf8');
  for(const removed of ['data-rf-format','data-rf-end-section','data-rf-add-section','data-rf-select-section','data-rf-new-section-title','data-rf-delete-section'])
    assert.ok(!editor.includes(removed),removed);
  assert.match(editor,/data-rf-editor/);
  assert.match(editor,/sanitizeEditorHtml/);
  assert.match(editor,/normalizeReferralHeadings/);
  assert.match(editor,/keepTemplateHeadingsReadOnly/);
  assert.match(editor,/data-rf-insert-data/);
});

test('phase 2: insertion options reflect only actual patient data and not invented fields',()=>{
  const fields=actual({context:{
    mother:{id:'m-1',name:'Ana Maria',phone:'(16) 90000-0000',cpf:'123.456.789-00',email:'ana@example.test'},
    babies:[{id:'b-1',name:'No bebê'}]
  },baby:{id:'b-1',name:'João',birth_date:'2026-09-12',current_weight_g:3780}});
  assert.equal(value(fields,'mother.name'),'Ana Maria');
  assert.equal(value(fields,'baby.name'),'João');
  assert.equal(value(fields,'baby.weight'),'3.780 g');
  assert.equal(value(fields,'baby.birth_date'),'12/09/2026');
  assert.equal(value(fields,'mother.phone'),'(16) 90000-0000');
  assert.equal(value(fields,'mother.email'),'ana@example.test');
  assert.ok(fields.every(f=>f.value&&f.label&&f.group&&f.id));
  assert.ok(!fields.some(f=>f.value.includes('undefined')||f.value.includes('null')));
  assert.equal(value(fields,'mother.address'),undefined);
});

test('phase 2: never show data for a different baby, empty data, or unrecorded values',()=>{
  const fields=actual({context:{mother:{name:'Ana'},babies:[{id:'b-1',name:'João'}]},baby:null,encounter:null});
  assert.deepEqual(fields.map(f=>f.id),['mother.name']);
  const empty=actual({context:{mother:{name:' '}}});
  assert.deepEqual(empty,[]);
  const wrong=actual({context:{mother:{name:'Ana'},babies:[{id:'b-1',name:'João'}]},baby:{id:'b-other',name:'Dado de outra criança'}});
  assert.equal(value(wrong,'baby.name'),undefined);
});

test('phase 2: clinical data is scoped to the selected mother and encounter',()=>{
  const fields=actual({
    context:{mother:{id:'m-1',name:'Ana'},babies:[{id:'b-1',name:'João'}]},
    baby:{id:'b-1',name:'João'},
    encounter:{id:'e-1',mother_id:'m-other',baby_id:'b-1',chief_complaint:'Queixa de outra família'}
  });
  assert.equal(value(fields,'encounter.complaint'),undefined);
  const valid=actual({
    context:{mother:{id:'m-1',name:'Ana'},babies:[{id:'b-1',name:'João'}]},
    baby:{id:'b-1',name:'João'},
    encounter:{id:'e-1',mother_id:'m-1',baby_id:'b-1',chief_complaint:{notes:'Dificuldade de pega'},care_plan:{instructions:'Avaliar posicionamento'}}
  });
  assert.equal(value(valid,'encounter.complaint'),'Dificuldade de pega');
  assert.equal(value(valid,'encounter.care'),'Avaliar posicionamento');
});

test('phase 0: legacy HTML and saved document keys remain compatible',()=>{
  const editor=readFileSync('public/referrals-feature.js','utf8');
  for (const token of ['schema_version:1','content:{','html','encounter_id','appointment_id','document_type:\'referral\'','data-rf-save']) assert.ok(editor.includes(token),token);
  assert.doesNotMatch(editor,/localStorage\.(setItem|getItem)/);
  assert.doesNotMatch(editor,/fetch\([^\n]*https?:\/\//);
});
