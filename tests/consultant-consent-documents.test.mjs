import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getConsultantConsentDocument, AVAILABLE_CONSENT_TYPES} from '../public/consultant-consent-content.js';
import {createConsentPdf} from '../public/document-pdf-service.js';

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
  assert.match(text('clinical_media'),/uso público/);
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
