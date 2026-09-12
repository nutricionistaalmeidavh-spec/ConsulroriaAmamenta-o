import { createDomainEvent } from './vendor/artisys-eventbus-web/domain-event.mjs';
import { WebEventBus } from './vendor/artisys-eventbus-web/event-bus.mjs';
import { BroadcastChannelBridge } from './vendor/artisys-eventbus-web/adapters/broadcast-channel.mjs';

const CHANNEL_NAME='debora-domain-events-v1';
const SOURCE='debora-web';

function eventId(){
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function install(){
  if(window.DeboraEvents)return window.DeboraEvents;
  const bus=new WebEventBus();
  const removers=[];
  let broadcast=null;

  async function publish(spec={}){
    const event=createDomainEvent({
      eventId:spec.eventId||eventId(),
      type:spec.type,
      aggregate:spec.aggregate,
      aggregateId:spec.aggregateId,
      mutationId:spec.mutationId,
      source:spec.source||SOURCE,
      actor:spec.actor||{},
      payload:spec.payload||{}
    });
    const report=await bus.publishAsync(event);
    if(report.failures.length)console.warn('Debora domain event subscriber failure',event.type,report.failures);
    return {event,report};
  }

  function bridgeLegacy(name,map){
    const handler=event=>{
      try{
        const spec=map(event.detail||{});
        if(!spec?.aggregateId)return;
        publish(spec).catch(error=>console.warn(`Falha ao publicar ${spec.type}`,error));
      }catch(error){console.warn(`Falha no bridge ${name}`,error)}
    };
    window.addEventListener(name,handler);
    removers.push(()=>window.removeEventListener(name,handler));
  }

  if(typeof globalThis.BroadcastChannel==='function'){
    try{broadcast=new BroadcastChannelBridge({bus,channelName:CHANNEL_NAME}).start()}
    catch(error){console.warn('BroadcastChannel indisponível para eventos clínicos',error)}
  }

  const api={
    version:'0.2.0',
    sourceCommit:'1c8d00810dcaa9010330ce7adc2877c90484d17d',
    bus,
    publish,
    subscribe:(type,handler)=>bus.subscribe(type,handler),
    once:(type,handler)=>bus.once(type,handler),
    broadcast,
    dispose(){for(const remove of removers.splice(0))remove();broadcast?.stop();bus.clear()}
  };
  window.DeboraEvents=api;

  bridgeLegacy('debora:clinical-document-finalized',detail=>({
    type:'clinical.document.finalized',
    aggregate:'clinical_document',
    aggregateId:detail.documentId,
    payload:{motherId:detail.motherId||null,babyId:detail.babyId||null,documentId:detail.documentId,documentType:detail.documentType||null,encounterId:detail.encounterId||null}
  }));
  bridgeLegacy('debora:record-exported',detail=>({
    type:'clinical.record.exported',
    aggregate:'mother',
    aggregateId:detail.motherId,
    payload:{motherId:detail.motherId,mode:detail.mode||null}
  }));

  return api;
}

install();
