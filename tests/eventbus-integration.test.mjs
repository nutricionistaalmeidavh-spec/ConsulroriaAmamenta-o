import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSingleFlight} from '../public/runtime-guards.js';
import {createDomainEvent} from '../public/vendor/artisys-eventbus-web/domain-event.mjs';
import {WebEventBus} from '../public/vendor/artisys-eventbus-web/event-bus.mjs';

test('single-flight shares one concurrent execution per key and releases it afterwards',async()=>{
  const singleFlight=createSingleFlight();
  let calls=0,release;
  const gate=new Promise(resolve=>{release=resolve});
  const task=async()=>{calls+=1;await gate;return 'ok'};
  const first=singleFlight('patient-1|baby-1',task);
  const second=singleFlight('patient-1|baby-1',task);
  assert.strictEqual(first,second);
  await Promise.resolve();
  assert.equal(calls,1);
  release();
  assert.equal(await first,'ok');
  assert.equal(await singleFlight('patient-1|baby-1',async()=>{calls+=1;return 'again'}),'again');
  assert.equal(calls,2);
});

test('vendored ArtiSys WebEventBus delivers canonical domain events',async()=>{
  const bus=new WebEventBus();
  const seen=[];
  bus.subscribe('clinical.document.finalized',event=>seen.push(event.aggregateId));
  const event=createDomainEvent({eventId:'evt-1',type:'clinical.document.finalized',aggregate:'clinical_document',aggregateId:'doc-1',source:'test',actor:{},payload:{motherId:'mother-1'}});
  const report=await bus.publishAsync(event);
  assert.equal(report.failures.length,0);
  assert.equal(report.delivered,1);
  assert.deepEqual(seen,['doc-1']);
});

test('eventbus runtime loads before the application bootstrap and preserves legacy bridges',()=>{
  const index=readFileSync('index.html','utf8');
  const runtime=readFileSync('public/eventbus-runtime.js','utf8');
  assert.ok(index.indexOf('/eventbus-runtime.js')<index.indexOf('/src/bootstrap.js'));
  for(const token of ['debora:clinical-document-finalized','clinical.document.finalized','debora:record-exported','clinical.record.exported','BroadcastChannelBridge'])assert.ok(runtime.includes(token),`${token} missing`);
  assert.doesNotMatch(runtime,/D1OutboxStore|RemoteEventBridge/);
});

test('patient summary and records hub use keyed single-flight plus post-await context validation',()=>{
  const workspace=readFileSync('public/patient-workspace.js','utf8');
  const hub=readFileSync('public/patient-records-hub.js','utf8');
  assert.match(workspace,/summaryFlight\(key/);
  assert.match(workspace,/expectedSummaryKey!==key/);
  assert.match(workspace,/DOC\.currentMotherId\(\)!==motherId/);
  assert.match(workspace,/afterAwait=screen\.querySelector\('\[data-pw-recent\]'\)/);
  assert.match(hub,/mountFlight\(motherId/);
  assert.match(hub,/expectedMother!==motherId/);
  assert.match(hub,/DOC\.currentMotherId\(\)!==motherId/);
  assert.match(hub,/afterAwait=screen\.querySelector\('\[data-prh-card\]'\)/);
});
