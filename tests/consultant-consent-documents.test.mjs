import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getConsultantConsentDocument, AVAILABLE_CONSENT_TYPES} from '../public/consultant-consent-content.js';
import {createConsentPdf,createReferralPdf} from '../public/document-pdf-service.js';

const expected=['data_processing','whatsapp','clinical_media','public_media','teleconsultation'];
test('apenas os cinco termos disponíveis para as consultoras possuem modelo documental integral',()=>{
  assert.deepEqual(AVAILABLE_CONSENT_TYPES,expected);
  for(const type of expected){
    const doc=getConsultantConsentDocument(type);
    assert.ok(doc.title.length>10,type);
    assert.equal(doc.modelVersion,'2.0',type);
    assert.ok(doc.sections.length>=5,type);
    assert.ok(doc.sections.every(s=>s.title && s.body && s.body.length>=60),type);
    assert.ok(doc.sections.map(s=>s.body).join(' ').length>=700,type);
  }
  assert.equal(getConsultantConsentDocument('other'),null);
});

test('os documentos distinguem o modelo atual do aceite legado e não inventam assinatura',async()=>{
  for(const type of expected){
    const doc=getConsultantConsentDocument(type);
    const pdf=createConsentPdf({motherName:'Paciente Exemplo',consentLabel:doc.title,
      statusLabel:'Autorizado',acceptedAt:'12/09/2026',version:'1.1',
      documentSections:doc.sections,modelVersion:doc.modelVersion});
    const body=Buffer.from(await pdf.arrayBuffer()).toString('latin1');
    assert.match(body,/Versão do modelo documental: 2\.0/);
    assert.match(body,/Versão do registro de consentimento: 1\.1/);
    assert.match(body,/não comprova assinatura/i);
    assert.ok(doc.sections.every(section=>body.includes(section.title)),type);
  }
});

test('os modelos tratam dados sensíveis, voluntariedade e limites específicos',()=>{
  const text=type=>getConsultantConsentDocument(type).sections.map(s=>s.body).join(' ').toLowerCase();
  assert.match(text('data_processing'),/base[s]? lega(is|l)|fundamento/);
  assert.match(text('data_processing'),/dados de saúde/);
  assert.match(text('whatsapp'),/opcional/);
  assert.match(text('whatsapp'),/revog/);
  assert.match(text('clinical_media'),/uso público|postagem em redes sociais|divulgação a terceiros/);
  assert.match(text('clinical_media'),/bebê/);
  assert.match(text('public_media'),/finalidade/);
  assert.match(text('public_media'),/publicação específica/);
  assert.match(text('teleconsultation'),/atendimento presencial/);
  assert.match(text('teleconsultation'),/gravação/);
});

test('visualização e PDF usam o mesmo conteúdo sem alterar o consentimento original',()=>{
  const terms=readFileSync('public/terms-feature.js','utf8');
  assert.match(terms,/getConsultantConsentDocument/);
  assert.match(terms,/documentSections:doc\.sections/);
  assert.match(terms,/doc\.sections\.map/);
  assert.match(terms,/snapshot_kind:'informational_copy'/);
  assert.doesNotMatch(terms,/\.saveConsents\(/);
});

test('PDF dos termos reutiliza o motor premium do encaminhamento, inclusive marca, barras e continuidade',async()=>{
  const referral=Buffer.from(await createReferralPdf({
    specialtyLabel:'Fonoaudiologia',
    html:'<h2>Motivo do encaminhamento</h2><p>Solicito avaliação clínica.</p>'
  }).arrayBuffer()).toString('latin1');
  const firstStream=pdf=>pdf.match(/\nstream\n([\s\S]*?)\nendstream/)?.[1]||'';
  const sharedBrand=pdf=>firstStream(pdf).split('GESTÃO DE AMAMENTAÇÃO')[0];
  assert.ok(sharedBrand(referral).length>100,'o cabeçalho de referência contém o desenho vetorial canônico');

  for(const type of expected){
    const doc=getConsultantConsentDocument(type);
    const term=Buffer.from(await createConsentPdf({
      motherName:'Paciente exemplo',consentLabel:doc.title,
      documentSections:doc.sections,modelVersion:doc.modelVersion
    }).arrayBuffer()).toString('latin1');
    assert.equal(sharedBrand(term),sharedBrand(referral),type+' deve usar exatamente a marca vetorial de encaminhamento');
    assert.match(term,/DOCUMENTO CLÍNICO \/ TERMOS E AUTORIZAÇÕES/);
    assert.doesNotMatch(term,/DOCUMENTO CLÍNICO \/ PRONTUÁRIO/);
    assert.match(firstStream(term),/48\.00 \d+\.\d+ 2\.00 16\.00 re f/,'borda lateral das seções do renderer premium');
    assert.match(term,/Página 1 de/,'rodapé e numeração do encaminhamento');
    assert.match(term,/\/Count [2-9]/,'documentos longos paginados');
  }
});
