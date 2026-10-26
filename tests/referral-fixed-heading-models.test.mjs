import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildReferralDraft,buildReferralSkeleton,REFERRAL_FIXED_TITLES} from '../public/referral-templates.js';
import {normalizeReferralHeadings} from '../public/referral-fixed-headings.js';
import {parseReferralHtml,createPremiumReferralPdf} from '../public/referral-premium-pdf.js';

test('template retains its three fixed headings regardless of patient pre-fill',()=>{
 const html=buildReferralSkeleton({specialty:'pediatria'}).html;
 for(const title of ['Queixa(s) em acompanhamento','Motivo do encaminhamento','Resumo do caso e condutas já realizadas'])
   assert.ok(html.includes('<h2>'+title+'</h2>'),title);
 assert.equal((html.match(/<h2>/g)||[]).length,3);
 assert.ok(!html.includes('Nome completo:'));
 assert.ok(!html.includes('Paciente fictícia'));
 assert.ok(!html.includes('Descreva a queixa'));
 assert.deepEqual(REFERRAL_FIXED_TITLES.slice(0,3),['Queixa(s) em acompanhamento','Motivo do encaminhamento','Resumo do caso e condutas já realizadas']);
});

test('suggested text uses the same established headings; never creates its own titles',()=>{
 const doc=buildReferralDraft({specialty:'pediatria',motherName:'Ana Alves',babyName:'Bia',chiefComplaint:'Dificuldade de pega',careSummary:'Orientado posicionamento'});
 assert.match(doc.html,/<h2>Queixa\(s\) em acompanhamento<\/h2>/);
 assert.match(doc.html,/<h2>Motivo do encaminhamento<\/h2>/);
 assert.match(doc.html,/<h2>Resumo do caso e condutas já realizadas<\/h2>/);
 assert.match(doc.html,/Dificuldade de pega/);
 assert.match(doc.html,/Orientado posicionamento/);
});

test('old bold inline headings become cards without dropping authored paragraphs',()=>{
 const legacy='<p>Prezado(a) colega,</p><p><strong>Queixa(s) em acompanhamento:</strong><br>Dificuldade de pega.</p><p><strong>Motivo do encaminhamento:</strong><br>Solicito avaliação.</p><p><strong>Resumo do caso e condutas já realizadas:</strong><br>Ajuste de posição.</p><p>Atenciosamente,</p>';
 const upgraded=normalizeReferralHeadings(legacy);
 assert.match(upgraded,/<h2>Queixa\(s\) em acompanhamento<\/h2><p>Dificuldade de pega\.<\/p>/);
 assert.match(upgraded,/<h2>Motivo do encaminhamento<\/h2><p>Solicito avaliação\.<\/p>/);
 assert.match(upgraded,/<h2>Resumo do caso e condutas já realizadas<\/h2><p>Ajuste de posição\.<\/p>/);
 assert.match(upgraded,/<p>Atenciosamente,<\/p>/);
 const blocks=parseReferralHtml(upgraded);
 assert.equal(blocks.filter(block=>block.type==='section').length,3);
});

test('never infer arbitrary section headings just because the text is bold',()=>{
 const plain='<p><strong>Importante:</strong> a paciente pediu contato.</p><p><strong>Outros achados:</strong><br>Detalhes não padronizados.</p>';
 assert.equal(normalizeReferralHeadings(plain),plain);
 const after=normalizeReferralHeadings('<h2>Título já salvo em um documento antigo</h2><p>Texto real</p>');
 assert.match(after,/<h2>Título já salvo/);
});

test('fixed cards appear in the PDF of a historical referral without changing the saved HTML',async()=>{
 const old='<p><strong>Motivo do encaminhamento:</strong><br>Pedido de avaliação.</p>';
 const before=old;
 const blob=createPremiumReferralPdf({html:old,specialtyLabel:'Pediatria'});
 const src=new TextDecoder('windows-1252').decode(await blob.arrayBuffer());
 assert.equal(old,before);
 assert.ok(src.includes('Motivo do encaminhamento'));
 assert.ok(src.includes('Pedido de avaliação.'));
});

test('new editor removes section builder and format picker; keeps text and optional field insertion',()=>{
 const editor=readFileSync('public/referrals-feature.js','utf8');
 for(const obsolete of ['data-rf-format','data-rf-end-section','data-rf-new-section-title','data-rf-add-section','data-rf-select-section','data-rf-move-up','data-rf-move-down','data-rf-delete-section'])
   assert.ok(!editor.includes(obsolete),'obsolete control '+obsolete);
 assert.match(editor,/data-rf-cmd/);
 assert.match(editor,/data-rf-insert-data/);
 assert.match(editor,/normalizeReferralHeadings/);
 assert.match(editor,/contenteditable.*false|setAttribute\('contenteditable','false'\)/);
});
