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
 assert.match(fin,/dataset\.rfPreview/);
 assert.match(fin,/buildPayload\(\)/);
 assert.match(fin,/reviewReferralContent/);
 const preview=readFileSync('public/referral-preview.js','utf8');
 assert.match(preview,/createObjectURL/);
 assert.match(preview,/revokeObjectURL/);
 assert.match(fin,/draft\?\.status==='finalized'/);
});
test('phase 6: D1 and legacy runtime mutations enforce finalized immutable referral',()=>{
 for(const file of ['worker/cloudflare-data-runtime.js','worker/cloudflare-clinical-legacy-runtime.js']){
  const src=readFileSync(file,'utf8');
  assert.match(src,/validateReferralMutation/);
  assert.match(src,/if\(!guard\.allowed\)/);
 }
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
 const button=result.container.children.flatMap(el=>el.children||[]).find(el=>el.dataset.rfIosPdfOpen==='1');
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
