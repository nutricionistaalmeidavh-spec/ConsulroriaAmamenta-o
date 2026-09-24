import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const billingSource=readFileSync('public/billing-v2.js','utf8');

function storage(seed={}){
  const map=new Map(Object.entries(seed));
  return {
    get length(){return map.size},
    key(index){return [...map.keys()][index]??null},
    getItem(key){return map.has(key)?map.get(key):null},
    setItem(key,value){map.set(key,String(value))},
    removeItem(key){map.delete(key)},
  };
}

function select(value='',values=[]){
  const listeners=new Map();
  return {
    value,
    options:values.map(v=>({value:v})),
    addEventListener(type,fn){listeners.set(type,fn)},
    dispatch(type){listeners.get(type)?.({target:this})},
    toggleAttribute(){},
  };
}

function harness({motherId='mother-1',appointmentId=''}={}){
  let currentMother=motherId;
  let currentAppointment=appointmentId;
  let appointmentType='Retorno';
  let host=null;
  const service=select('', ['Consulta inicial','Retorno','Acompanhamento','Pré-natal']);
  const mode=select('individual',['individual']);
  const payment=select('',['','Pix','Dinheiro','Cartão','Transferência']);
  const valueInput={
    value:'150',readOnly:false,
    closest(){return{classList:{toggle(){}},querySelector(){return{textContent:''}}}},
    dispatchEvent(){},
  };
  const anchor={insertAdjacentElement(_where,node){host=node}};
  const documentListeners=new Map();
  const document={
    documentElement:{},body:{appendChild(){}},
    querySelector(selector){
      if(selector==='[data-screen="appointment"]')return{};
      if(selector==='[data-appointment-patient]')return{value:currentMother};
      if(selector==='[data-encounter-field="value"]')return valueInput;
      if(selector==='[data-encounter-choice][data-field="appointmentType"][aria-pressed="true"]')return{dataset:{value:appointmentType}};
      if(selector==='[data-billing-v2]')return host;
      if(selector==='[data-wizard-step="1"] .appointment-meta-grid'||selector==='[data-wizard-step="1"]')return anchor;
      if(selector==='[data-bv-mode]')return mode;
      if(selector==='[data-bv-service]')return service;
      if(selector==='[data-bv-payment]')return payment;
      if(selector==='[data-bv-package]'||selector==='[data-bv-total]'||selector==='[data-bv-sessions]'||selector==='[data-bv-new]'||selector==='[data-bv-active]')return null;
      return null;
    },
    querySelectorAll(){return[]},
    createElement(){return{dataset:{},className:'',innerHTML:'',querySelector(){return null},remove(){}}},
    addEventListener(type,fn){
      const items=documentListeners.get(type)||[];items.push(fn);documentListeners.set(type,items);
    },
  };
  const sessionStorage=storage({'debora-runtime-access-token':'a.b.c'});
  const context={
    console,document,sessionStorage,localStorage:storage(),
    location:{hash:'#/appointment/new',origin:'https://example.test'},
    DEBORA_APP_CONFIG:{API_BASE_URL:'https://example.test',CLIENT_RUNTIME_KEY:'test'},
    DeboraEncounter:{getAppointmentId(){return currentAppointment}},
    DeboraRuntimeClient:{getSession(){return{access_token:'a.b.c'}}},
    MutationObserver:class{constructor(fn){this.fn=fn}observe(){}},
    setTimeout(){return 1},clearTimeout(){},
    addEventListener(){},confirm(){return true},
    Event:class{constructor(type,opt={}){this.type=type;this.bubbles=!!opt.bubbles}},
    crypto:{randomUUID(){return '00000000-0000-4000-8000-000000000001'}},
    fetch:async url=>({
      ok:true,status:200,
      async text(){
        const value=String(url);
        if(value.includes('care_packages?'))return '[]';
        if(value.includes('appointments?'))return '[]';
        return '[]';
      },
    }),
  };
  context.window=context;context.globalThis=context;
  vm.runInNewContext(billingSource,context,{filename:'billing-v2.js'});
  return {
    context,service,sessionStorage,
    setAppointmentType(value){appointmentType=value},
    setAppointmentId(value){currentAppointment=value},
    setMotherId(value){currentMother=value},
    draft(){return JSON.parse(sessionStorage.getItem('debora-billing-v2-draft')||'null')},
  };
}

test('untouched billing service follows the current clinical appointment type across remounts',async()=>{
  const h=harness();
  await h.context.DeboraBilling.remount();
  assert.equal(h.service.value,'Retorno');
  assert.equal(h.draft()?.serviceOverridden,false);

  h.setAppointmentType('Acompanhamento');
  await h.context.DeboraBilling.remount();
  assert.equal(h.service.value,'Acompanhamento');
  assert.equal(h.draft()?.serviceLabel,'Acompanhamento');
  assert.equal(h.draft()?.serviceOverridden,false);
});

test('manual billing service override is preserved for the same draft but not leaked to another appointment',async()=>{
  const h=harness({appointmentId:'appt-1'});
  await h.context.DeboraBilling.remount();
  h.service.value='Consulta inicial';
  h.service.dispatch('change');
  assert.equal(h.draft()?.serviceOverridden,true);

  h.setAppointmentType('Acompanhamento');
  await h.context.DeboraBilling.remount();
  assert.equal(h.service.value,'Consulta inicial');

  h.setAppointmentId('appt-2');
  h.setAppointmentType('Retorno');
  await h.context.DeboraBilling.remount();
  assert.equal(h.service.value,'Retorno');
  assert.equal(h.draft()?.appointmentId,'appt-2');
  assert.equal(h.draft()?.serviceOverridden,false);
});
