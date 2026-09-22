import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync('public/package-card-singleton-guard.js','utf8');

function makeRuntime({withCurrentCard=true}={}){
  const allHosts=[];
  const allCards=[];
  const staleScreen={hidden:true,isConnected:true,hosts:[]};
  const currentScreen={hidden:false,isConnected:true,hosts:[]};

  function addHost(screen,motherId='mother-1',withCard=true){
    const host={
      dataset:{motherId},
      screen,
      removed:false,
      cards:[],
      remove(){
        this.removed=true;
        const hi=allHosts.indexOf(this);if(hi>=0)allHosts.splice(hi,1);
        const si=screen.hosts.indexOf(this);if(si>=0)screen.hosts.splice(si,1);
        [...this.cards].forEach(card=>card.remove());
      }
    };
    allHosts.push(host);screen.hosts.push(host);
    if(withCard){
      const card={
        host,removed:false,
        closest(selector){return selector==='[data-bv-patient-plan]'?this.host:null},
        remove(){this.removed=true;const i=allCards.indexOf(this);if(i>=0)allCards.splice(i,1);const j=host.cards.indexOf(this);if(j>=0)host.cards.splice(j,1)}
      };
      host.cards.push(card);allCards.push(card);
    }
    return host;
  }

  staleScreen.querySelectorAll=selector=>selector==='[data-bv-patient-plan]'?[...staleScreen.hosts]:[];
  currentScreen.querySelectorAll=selector=>selector==='[data-bv-patient-plan]'?[...currentScreen.hosts]:[];
  staleScreen.querySelector=selector=>selector==='[data-bv-patient-plan] .bv-plan-card'?staleScreen.hosts.flatMap(x=>x.cards)[0]||null:null;
  currentScreen.querySelector=selector=>selector==='[data-bv-patient-plan] .bv-plan-card'?currentScreen.hosts.flatMap(x=>x.cards)[0]||null:null;

  addHost(staleScreen,'mother-1',true);
  addHost(staleScreen,'mother-1',true);
  if(withCurrentCard)addHost(currentScreen,'mother-1',true);

  let remountCalls=0;
  const document={
    documentElement:{},
    querySelectorAll(selector){
      if(selector==='[data-screen="patient"]')return [staleScreen,currentScreen];
      if(selector==='[data-bv-patient-plan]')return [...allHosts];
      if(selector==='.bv-plan-card')return [...allCards];
      return [];
    }
  };
  const context={
    console,
    document,
    location:{hash:'#/patient/mother-1'},
    MutationObserver:class{observe(){}},
    queueMicrotask,
    clearTimeout(){},
    setTimeout(fn){queueMicrotask(fn);return 1},
    addEventListener(){},
    decodeURIComponent,
    DeboraBilling:{
      async remountPlan(){
        remountCalls++;
        addHost(currentScreen,'mother-1',true);
      }
    }
  };
  context.window=context;
  context.globalThis=context;
  return {context,currentScreen,staleScreen,allHosts,allCards,getRemountCalls:()=>remountCalls};
}

async function flush(){
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('package reconciler removes stale-screen and duplicate plan cards, keeping the visible patient card',async()=>{
  const runtime=makeRuntime({withCurrentCard:true});
  vm.runInNewContext(source,runtime.context,{filename:'package-card-singleton-guard.js'});
  await flush();
  assert.equal(runtime.currentScreen.hosts.length,1);
  assert.equal(runtime.staleScreen.hosts.length,0);
  assert.equal(runtime.allHosts.length,1);
  assert.equal(runtime.allCards.length,1);
  assert.equal(runtime.getRemountCalls(),0);
});

test('package reconciler restores a missing visible card after stale DOM hosts are discarded',async()=>{
  const runtime=makeRuntime({withCurrentCard:false});
  vm.runInNewContext(source,runtime.context,{filename:'package-card-singleton-guard.js'});
  await flush();
  assert.equal(runtime.getRemountCalls(),1);
  assert.equal(runtime.currentScreen.hosts.length,1);
  assert.equal(runtime.staleScreen.hosts.length,0);
  assert.equal(runtime.allCards.length,1);
});
