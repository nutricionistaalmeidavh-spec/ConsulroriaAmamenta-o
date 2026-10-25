import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReferralPdf} from '../public/document-pdf-service.js';

const encoded=async options=>new TextDecoder('windows-1252').decode(await createReferralPdf(options).arrayBuffer());

test('phase 4 creates branded dynamic cards only from authored H2 headings and no signature',async()=>{
  const pdf=await encoded({
    motherName:'Ana',babyName:'João',specialtyLabel:'Pediatria',destination:'Dra. Maria',
    finalizedAt:'2026-10-24T10:30:00-03:00',
    html:'<p>Prezado(a) colega,</p><h2>Histórico materno</h2><p>Relato clínico individualizado.</p><h3>Observação</h3><ul><li>Item A</li><li>Item B</li></ul><hr><p>Texto fora do card.</p><h2>Pedido de avaliação</h2><p>Solicito parecer.</p>'
  });
  assert.match(pdf,/%PDF-1\.[4-9]/);
  for(const text of ['Histórico materno','Relato clínico individualizado','Observação','Item A','Item B','Texto fora do card','Pedido de avaliação','Solicito parecer'])assert.ok(pdf.includes(text),text);
  assert.match(pdf,/G[ESTÃO]*[A-Z ]*AMAMENTAÇ|D.bora Lactaç/i);
  assert.doesNotMatch(pdf,/Assinatura do profissional|____________________|Assinatura:/i);
  assert.doesNotMatch(pdf,/\[Descreva a queixa principal\]/);
  assert.match(pdf,/\/Count 1\b/);
});

test('phase 4 supports long documents without dropping later sections',async()=>{
  const payload='<h2>Motivo livre</h2>'+Array.from({length:65},(_,i)=>'<p>Registro '+i+' '+('conteúdo clínico detalhado '.repeat(12))+'</p>').join('')+'<hr><h2>Conclusão personalizada</h2><p>Última linha preservada.</p>';
  const pdf=await encoded({html:payload,specialtyLabel:'Outro'});
  assert.match(pdf,/\/Count (?:[2-9]|[1-9][0-9]+)\b/);
  assert.ok(pdf.includes('Última linha preservada.'),'missing last authored paragraph');
  assert.ok(pdf.includes('Conclusão personalizada'),'missing final user heading');
  assert.match(pdf,/Página 1 de /);
});

test('phase 4 keeps HTML entities and new lines while leaving personal info opt-in',async()=>{
  const pdf=await encoded({motherName:'Nome confidencial',babyName:'Bebê confidencial',html:'<p>Teste &amp; avaliação &lt;critério&gt;<br>Nova linha</p>',specialtyLabel:'Outro'});
  assert.ok(pdf.includes('Teste & avaliação'));
  assert.ok(pdf.includes('Nova linha'));
  assert.ok(!pdf.includes('Nome confidencial'),'patient identity must not appear unless added to editable content');
  assert.ok(!pdf.includes('Bebê confidencial'),'baby identity must not appear unless added to editable content');
});

test('phase 3 UI provides create, edit, delete and reorder section controls',()=>{
 const editor=readFileSync('public/referrals-feature.js','utf8');
 for(const name of ['data-rf-add-section','data-rf-select-section','data-rf-move-up','data-rf-move-down','data-rf-delete-section'])assert.ok(editor.includes(name),name);
 assert.match(editor,/window\.confirm|confirm\(/);
 assert.match(editor,/data-rf-editor/);
});
