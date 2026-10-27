import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRecordPdf,createConsentPdf,createReferralPdf} from '../public/document-pdf-service.js';
import {createCarePlanPdf} from '../public/clinical-source/core/lib/pdf-service.js';
import {showSavedIosReferralPdf} from '../public/referral-ios-pdf.js';

const pdfText=async blob=>Buffer.from(await blob.arrayBuffer()).toString('latin1');
const rejectOldIdentity=text=>{
 assert.doesNotMatch(text,/Débora Lactação|Debora Lactacao|deboralactacao\.com/i);
 assert.match(text,/Gestão de Amamentação/);
 assert.match(text,/GESTÃO DE AMAMENTAÇÃO/);
 assert.match(text,/Documento clínico/);
 assert.match(text,/Página 1 de/);
};

test('prontuário completo e resumo usam identidade visual canônica, com seção legível e paginada',async()=>{
 for(const modeLabel of ['Prontuário completo','Resumo clínico']){
  const sections=Array.from({length:16},(_,i)=>({title:'Atendimento '+(i+1),body:['Consulta clínica de teste '+i+' com observações reais preservadas e sem preenchimento automático.','Conduta e seguimento da paciente.']}));
  const pdf=createRecordPdf({motherName:'Paciente fictícia',modeLabel,sections,subheading:'Paciente fictícia · Bebê exemplo'});
  assert.equal(pdf.type,'application/pdf');
  const bytes=await pdfText(pdf);
  rejectOldIdentity(bytes);
  assert.match(bytes,/Paciente fictícia/);
  assert.match(bytes,/Atendimento 16/);
  assert.match(bytes,/\/Count [2-9]/);
  assert.match(bytes,/\/Creator \(Gestão de Amamentação\)/);
 }
});

test('fotos clínicas continuam incorporadas como JPEG em página com cabeçalho canônico',async()=>{
 const pdf=createRecordPdf({sections:[{title:'Crescimento',body:'Peso registrado: 3900 g'}],
  images:[{bytes:Uint8Array.from([255,216,255,217]),width:1,height:1,caption:'Fotografia autorizada QA'}]});
 const bytes=await pdfText(pdf);
 rejectOldIdentity(bytes);
 assert.match(bytes,/\/Subtype \/Image/);
 assert.match(bytes,/Fotografia autorizada QA/);
 assert.match(bytes,/\/Count 2/);
});

test('PDF dos termos e consentimentos compartilha identidade e não altera o texto jurídico',async()=>{
 const pdf=createConsentPdf({motherName:'Paciente fictícia',consentLabel:'Termo de consentimento',
  statusLabel:'Autorizado',evidence:'Aceite registrado na plataforma'});
 const bytes=await pdfText(pdf);
 rejectOldIdentity(bytes);
 assert.match(bytes,/Aceite registrado na plataforma/);
 assert.match(bytes,/Termo de consentimento/);
});

test('PDF do plano de cuidado mantém informações completas e os layouts anteriormente salvos',async()=>{
 for(const layout of ['acolhedor','clinico','minimalista']){
  const pdf=createCarePlanPdf({title:'Plano de cuidados',layout,
   patient:{mother:{name:'Paciente fictícia'},babies:[{name:'Bebê teste'}]},
   encounter:{complaint:'Queixa observada',objectives:'Apoiar a pega',instructions:'Orientações clínicas registradas'}});
  const bytes=await pdfText(pdf);
  rejectOldIdentity(bytes);
  assert.match(bytes,/Apoiar a pega/);
  assert.match(bytes,/Orienta.*cl.nic/);
  assert.match(bytes,/Documento 1\//);
  assert.match(bytes,new RegExp('%LAYOUT:'+layout));
 }
});

test('encaminhamento mantém o mesmo cabeçalho premium e as seções existentes',async()=>{
 const pdf=createReferralPdf({specialtyLabel:'Fonoaudiologia',html:'<h2>Motivo do encaminhamento</h2><p>Avaliação de fala.</p>'});
 const bytes=await pdfText(pdf);
 rejectOldIdentity(bytes);
 assert.match(bytes,/Motivo do encaminhamento/);
});

test('compartilhamento no iPhone entrega o arquivo sob gesto explícito sem navegar a sessão',async()=>{
 const calls=[],elements=[];
 const make=(tag)=>{const el={tag,dataset:{},children:[],attrs:{},handlers:{},
   append(...nodes){this.children.push(...nodes)},
   setAttribute(key,value){this.attrs[key]=value},
   addEventListener(name,fn){this.handlers[name]=fn},
   focus(){},remove(){this.removed=true}};
  elements.push(el);return el};
 const doc={body:{appendChild(node){this.child=node}},createElement:make};
 const pdf=new Blob(['%PDF-1.4'],{type:'application/pdf'});
 const result=showSavedIosReferralPdf({pdf,fileName:'prontuario-completo',documentRef:doc,
  documentTitle:'Prontuário completo preparado',shareTitle:'Prontuário completo',
  share:async(...args)=>{calls.push(args);return 'shared'}});
 assert.equal(result.container.attrs['aria-label'],'Prontuário completo preparado — PDF pronto');
 assert.equal(calls.length,0,'document share requires a separate user gesture');
 const open=elements.find(el=>el.dataset.rfIosPdfOpen==='1');
 await open.handlers.click();
 assert.equal(calls.length,1);
 assert.equal(calls[0][0],pdf);
 assert.equal(calls[0][2],'Prontuário completo');
 assert.equal(calls[0][3].preserveAppTab,true);
 assert.equal(result.container.removed,true);
});

test('materialização restaura PDFs canônicos sem trocar secrets, D1, ou rotas',()=>{
 const mat=readFileSync('scripts/materialize-clinical-source.mjs','utf8');
 const src=readFileSync('scripts/lib/clinical-pdf-branding-materialize.mjs','utf8');
 const exporter=readFileSync('public/record-export-feature.js','utf8');
 assert.match(mat,/applyClinicalPdfBranding\(resolved, sourceByPath\)/);
 assert.match(src,/transformClinicalPdfBranding/);
 assert.match(src,/transformClinicalShellBranding/);
 assert.match(exporter,/isIosPdfViewer\(\)/);
 assert.match(exporter,/showSavedIosReferralPdf/);
 assert.ok(exporter.indexOf('await registerExport(')<exporter.indexOf('showSavedIosReferralPdf('));
 const bootstrap=readFileSync('src/bootstrap.js','utf8');
 const shell=readFileSync('public/clinical-source/core/app-shell.js','utf8');
 assert.match(bootstrap,/brandModuleUrl/,'blob clinical PDF module must resolve the branding import to an absolute URL');
 assert.equal(bootstrap.includes('referral-premium-pdf.js'),true,'brand module URL must be in the loader');
 assert.equal(shell.includes("from '../../referral-ios-pdf.js'"),false,'blob clinical shell must not statically import relative modules');
 assert.equal(shell.includes("await import(new URL('/referral-ios-pdf.js'"),true,'clinical shell must resolve an absolute file URL');
 assert.match(shell,/showSavedIosReferralPdf/);
});
