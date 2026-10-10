import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCloudflareBillingRuntime } from '../worker/cloudflare-billing-runtime.js';

const endpoint='https://app.deboralactacao.com/api/webhooks/asaas';
const token='test_webhook_token_2026';
const checkout={
 id:'b41a8344-d951-4e14-818c-aca8ef0a7500',
 link:'https://www.asaas.com/000/checkoutSession/show/b41a8344-d951-4e14-818c-aca8ef0a7500',
 status:'EXPIRED',
 externalReference:'26000d36-4937-4a70-9234-8b8893aa09b8',
 items:[{name:'Testes e Controle de Qualidade',quantity:1,value:38.53}],
 callback:{successUrl:'https://pagamentos-artisys-central.example/pedido?id=26000d36-4937-4a70-9234-8b8893aa09b8'}
};
const request=(event,headerToken=token)=>new Request(endpoint,{
 method:'POST',headers:{'content-type':'application/json','asaas-access-token':headerToken},
 body:JSON.stringify({id:'evt_37260be8159d4472b4458d3de13efc2d',event,checkout})
});

test('Asaas checkout de QA de outro produto recebe HTTP 200 sem consultar API nem banco clínico',async()=>{
 let count=0;
 const env={
  ASAAS_SECRET:'fake-provider-secret',
  ASAAS_WEBHOOK_TOKEN:token,
  CLINICAL_DB:{prepare(){count++;throw new Error('foreign_event_must_not_query_clinical_database');}}
 };
 for(const event of ['CHECKOUT_CREATED','CHECKOUT_EXPIRED']){
  const response=await handleCloudflareBillingRuntime(request(event),env);
  assert.equal(response.status,200,await response.clone().text());
  assert.equal((await response.json()).status,'ignored_foreign_checkout');
 }
 assert.equal(count,0,'não gravar nem consultar prontuários/billing da clínica');
});

test('Webhook de terceiros mantém autenticação e rejeita token inválido',async()=>{
 const env={ASAAS_SECRET:'fake-provider-secret',ASAAS_WEBHOOK_TOKEN:token,
  CLINICAL_DB:{prepare(){throw new Error('must_not_hit_database');}}};
 const r=await handleCloudflareBillingRuntime(request('CHECKOUT_CREATED','bad-token'),env);
 assert.equal(r.status,401);
 assert.equal((await r.json()).error,'invalid_webhook_token');
});

test('Checkout da clínica continua pelo caminho de verificação normal (sem descarte)',async()=>{
 let queried=0;
 const env={ASAAS_SECRET:'fake-provider-secret',ASAAS_WEBHOOK_TOKEN:token,
  CLINICAL_DB:{prepare(){queried++;throw new Error('db_reached_for_clinic_checkout');}}};
 const clinicRequest=new Request(endpoint,{method:'POST',
  headers:{'content-type':'application/json','asaas-access-token':token},
  body:JSON.stringify({event:'CHECKOUT_CREATED',checkout:{...checkout,
    externalReference:'saas_checkout:8c3b00ab-7780-4394-b47d-28485197e81b'}})});
 const r=await handleCloudflareBillingRuntime(clinicRequest,env);
 assert.ok(queried>0,'checkout real da clínica deve seguir para D1');
 assert.notEqual((await r.json()).error,'invalid_webhook_token');
});

test('Checkout sem referência e desconhecido no Asaas (404) é ignorado, não gera erro 502',async()=>{
 let requests=0;
 const env={ASAAS_SECRET:'fake-provider-secret',ASAAS_WEBHOOK_TOKEN:token,
  CLINICAL_DB:{prepare(){return{bind(){return{first:async()=>null}}};}}};
 const previousFetch=globalThis.fetch;
 try{
  globalThis.fetch=async()=>{requests++;return Response.json({errors:[{code:'not_found'}]},{status:404});};
  const r=await handleCloudflareBillingRuntime(new Request(endpoint,{method:'POST',
   headers:{'content-type':'application/json','asaas-access-token':token},
   body:JSON.stringify({event:'CHECKOUT_CREATED',checkout:{id:checkout.id,status:'ACTIVE'}})}),env);
  assert.equal(r.status,200);
  assert.equal((await r.json()).status,'ignored_unmapped_checkout');
  assert.equal(requests,1);
 }finally{globalThis.fetch=previousFetch;}
});
