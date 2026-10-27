import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
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
test('phase 5: preview uses the authored content, with no mandatory review or pending warnings',()=>{
 const fin=readFileSync('public/referral-finalization.js','utf8');
 assert.match(fin,/dataset\.rfPreview/);
 assert.match(fin,/buildPayload\(\)/);
 assert.doesNotMatch(fin,/reviewReferralContent|Revise os campos|window\\.confirm|preview\\.click\\(\\)/);
 const preview=readFileSync('public/referral-preview.js','utf8');
 assert.match(preview,/createObjectURL/);
 assert.match(preview,/revokeObjectURL/);
 assert.doesNotMatch(preview,/rfPreviewReview|review\\?\\.blockers|review\\?\\.warnings/);
 assert.match(fin,/draft\?\.status==='finalized'/);
});
test('phase 6: D1 and legacy runtime mutations enforce finalized immutable referral',()=>{
 for(const file of ['worker/cloudflare-data-runtime.js','worker/cloudflare-clinical-legacy-runtime.js']){
  const src=readFileSync(file,'utf8');
  assert.match(src,/validateReferralMutation/);
  assert.match(src,/if\(!guard\.allowed\)/);
 }
});

test('mobile: iPhone cannot be navigated automatically to a Blob PDF after saving',()=>{
 const source=readFileSync('public/referral-finalization.js','utf8');
 assert.match(source,/isIOSWebKit/);
 assert.match(source,/reopenFinalized/);
 assert.match(source,/sharePdf/);
});

test('iPhone without native sharing opens PDF in another tab, never replaces clinical session',async()=>{
 const source=readFileSync('public/document-pdf-service.js','utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'');
 const opened=[],revoked=[],tab={opener:{from:'app'}},session={access_token:'qa-access',refresh_token:'qa-refresh'};
 const sandbox={
   window:{open:(url,target)=>{opened.push({url,target});return tab}},
   navigator:{canShare:()=>false},
   URL:{createObjectURL:()=> 'blob:qa-pdf',revokeObjectURL:url=>revoked.push(url)},
   setTimeout:()=>undefined,
   Blob,File:class{constructor(parts,name,options){this.name=name;this.type=options.type;this.parts=parts}},
   createPremiumReferralPdf:()=>null,
 };
 const share=vm.runInNewContext(source+';sharePdf',sandbox);
 const result=await share(new Blob(['mock pdf']),'encaminhamento-qa','Encaminhamento',{preserveAppTab:true});
 assert.equal(result,'opened');
 assert.deepEqual(opened,[{url:'blob:qa-pdf',target:'_blank'}]);
 assert.equal(tab.opener,null);
 assert.equal(session.access_token,'qa-access');
 assert.deepEqual(revoked,[]);
});

test('iPhone can finalize incomplete authored content without PDF navigation or logout',async()=>{
 const source=readFileSync('public/referral-finalization.js','utf8').replace(/^import .*$/gm,'');
 const session={access_token:'qa-current-access',refresh_token:'qa-current-refresh'};
 const saved=[],downloads=[],optionsSeen=[],pdfOverlays=[];
 const DOC={
   saveDocument:async payload=>{const doc={...payload,id:'referral-qa-1'};saved.push(doc);return doc},
   updateDocument:async()=>{throw new Error('should create finalized document directly')},
   toast:()=>{},
 };
 const sandbox={
   window:{DeboraDocuments:DOC,dispatchEvent:()=>{},location:{href:'https://qa.test/app/#/patient/example'}},
   navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'},
   createReferralPdf:()=>new Blob(['mock pdf'],{type:'application/pdf'}),
   downloadPdf:(...args)=>downloads.push(args),
   sharePdf:async()=> 'shared',
   openReferralPreview:()=>{},
   isIosPdfViewer:()=>true,
   showSavedIosReferralPdf:payload=>pdfOverlays.push(payload),
   CustomEvent:class{constructor(type,args){this.type=type;this.detail=args.detail}},
   Date,Blob,
 };
 vm.runInNewContext(source,sandbox);
 const finalized=await sandbox.window.DeboraReferralFinalization.finalizeDraft({
   draft:null,motherId:'mother-qa',babyId:'baby-qa',encounter:null,
   context:{mother:{name:'Paciente QA'}},baby:{name:'Bebê QA'},specialtyLabel:'Fisioterapia',
   buildPayload:()=>({content:{html:'<p>[Descreva o motivo da avaliação.]</p>',specialty:'fisioterapia'}}),
   onFinalized:async(doc,opts)=>optionsSeen.push(opts)
 });
 assert.equal(finalized.status,'finalized');
 assert.equal(saved.length,1);
 assert.match(saved[0].content.issued_snapshot.html,/Descreva o motivo/);
 assert.equal(downloads.length,0,'No automatic PDF navigation on iPhone');
 assert.equal(optionsSeen[0].reopenFinalized,false,'Native PDF control is shown after persisting');
 assert.equal(pdfOverlays.length,1,'Saved document opens native PDF action without navigation');
 assert.deepEqual(session,{access_token:'qa-current-access',refresh_token:'qa-current-refresh'});
 assert.equal(sandbox.window.location.href,'https://qa.test/app/#/patient/example');
 const preview=readFileSync('public/referral-preview.js','utf8');
 assert.ok(preview.includes('if(!nativeFilePreview)'));
 assert.ok(preview.includes('sharePdf(pdf,fileName'));
});

test('iPhone and iPad PDF file flow is detected without affecting Android or desktop',async()=>{
 const {isIosPdfViewer}=await import('../public/referral-ios-pdf.js');
 assert.equal(isIosPdfViewer({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15'}),true);
 assert.equal(isIosPdfViewer({userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'}),true);
 assert.equal(isIosPdfViewer({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X)',platform:'MacIntel',maxTouchPoints:5}),true);
 assert.equal(isIosPdfViewer({userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 7)'}),false);
 assert.equal(isIosPdfViewer({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X)',platform:'MacIntel',maxTouchPoints:0}),false);
});

test('iOS finished referral offers the same PDF file from a user-initiated share action, without page navigation',async()=>{
 const {showSavedIosReferralPdf}=await import('../public/referral-ios-pdf.js');
 const body={children:[],appendChild(node){this.children.push(node)},};
 const doc={body,createElement(tag){
  return {tagName:tag,children:[],dataset:{},attributes:{},removed:false,focused:false,
   append(...nodes){this.children.push(...nodes)},
   setAttribute(key,value){this.attributes[key]=value},
   addEventListener(key,fn){this.handlers??={};this.handlers[key]=fn},
   focus(){this.focused=true},
   remove(){this.removed=true},
  };
 }};
 const pdf=new Blob(['%PDF-1.4 mock'],{type:'application/pdf'});
 const received=[];
 const share=async(...args)=>{received.push(args);return 'shared'};
 const result=showSavedIosReferralPdf({pdf,fileName:'encaminhamento-paciente',documentRef:doc,share});
 const button=result.container.children[0].children[1].children.find(el=>el.dataset.rfIosPdfOpen==='1');
 assert.ok(button,'native PDF action must remain accessible after the async D1 save');
 assert.equal(body.children.length,1,'no second page, iframe or new browser window is created');
 assert.equal(result.container.attributes.role,'dialog');
 await button.handlers.click();
 assert.deepEqual(received[0].slice(0,2),[pdf,'encaminhamento-paciente']);
 assert.equal(result.container.removed,true,'successful file share closes its own UI only');
});

test('iOS referral preview and finalized PDF never open an embedded blob viewer',()=>{
 const preview=readFileSync('public/referral-preview.js','utf8');
 const finalization=readFileSync('public/referral-finalization.js','utf8');
 assert.match(preview,/isIosPdfViewer\(\)/);
 assert.match(preview,/if\s*\(!nativeFilePreview\)/);
 assert.match(preview,/sharePdf\(pdf,fileName/);
 assert.match(finalization,/showSavedIosReferralPdf\(/);
 assert.match(finalization,/if\s*\(!nativeFileFlow\)\s*downloadPdf\(/);
 assert.match(finalization,/if\s*\(mode==='share'\|\|isIosPdfViewer\(\)\)/);
 assert.doesNotMatch(finalization,/location\.href|location\.assign|window\.open\(/);
});


test('iOS PDF preview renders a file action rather than an iframe or browser navigation',async()=>{
 const {openReferralPreview}=await import('../public/referral-preview.js');
 const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const created=[];
 let shared=null;
 const doc={createElement(tag){
   created.push(tag);
   return {tagName:tag,dataset:{},children:[],attributes:{},removed:false,
     append(...nodes){this.children.push(...nodes)},
     appendChild(node){this.children.push(node)},
     classList:{add(){}},
     setAttribute(key,value){this.attributes[key]=value},
     addEventListener(key,fn){this.handlers??={};this.handlers[key]=fn},
     focus(){},
     remove(){this.removed=true},
     querySelector(){return null},
   };
 }};
 const panel={children:[],querySelectorAll(){return []},querySelector(){return null},appendChild(node){this.children.push(node)}};
 try{
   Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
   Object.defineProperty(globalThis,'navigator',{configurable:true,value:{
     userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)',
     canShare:()=>true,share:async(payload)=>{shared=payload},
   }});
   const pdf=new Blob(['%PDF-1.4 fake'],{type:'application/pdf'});
   const preview=openReferralPreview({panel,pdf,fileName:'encaminhamento-previa'});
   assert.equal(preview.url,null,'no blob: navigation should be created on iOS');
   assert.equal(created.includes('iframe'),false,'no browser PDF viewer should be embedded on iOS');
   const button=preview.container.children[0].children[1].children[0];
   assert.equal(button.dataset.rfPreviewDownload,'1');
   button.handlers.click();
   await Promise.resolve();
   assert.equal(shared?.files?.length,1,'the PDF must be passed as a native File');
   assert.equal(shared.files[0].name,'encaminhamento-previa.pdf');
   preview.close();
   assert.equal(preview.container.removed,true);
 }finally{
   if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);
   else delete globalThis.document;
   if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);
   else delete globalThis.navigator;
 }
});
