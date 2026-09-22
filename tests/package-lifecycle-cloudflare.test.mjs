import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleCloudflareClinicalRuntime} from '../worker/cloudflare-clinical-runtime.js';

const billingSource=readFileSync(new URL('../public/billing-v2.js',import.meta.url),'utf8');

class FakeStatement{
  constructor(db,sql,args=[]){this.db=db;this.sql=sql;this.args=args}
  bind(...args){return new FakeStatement(this.db,this.sql,args)}
  async first(){return this.db.first(this.sql,this.args)}
  async all(){return this.db.all(this.sql,this.args)}
  async run(){return this.db.run(this.sql,this.args)}
}
class FakeD1{
  constructor(){this.records=new Map();this.authUsers=new Map()}
  prepare(sql){return new FakeStatement(this,sql,[])}
  seed(table,key,ownerId,record){this.records.set(`${table}:${key}`,{table,key,ownerId,record:{...record}})}
  table(table){return [...this.records.values()].filter(x=>x.table===table).map(x=>x.record)}
  async first(sql,args){
    if(/SELECT \* FROM auth_users WHERE user_id = \? LIMIT 1/i.test(sql))return this.authUsers.get(String(args[0]))||null;
    throw new Error(`unexpected first SQL: ${sql}`);
  }
  async all(sql,args){
    if(/SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = \?/i.test(sql)){
      const table=String(args[0]);
      return{results:[...this.records.values()].filter(x=>x.table===table).map(x=>({record_key:x.key,owner_id:x.ownerId,record_json:JSON.stringify(x.record)}))};
    }
    throw new Error(`unexpected all SQL: ${sql}`);
  }
  async run(sql,args){
    if(/INSERT INTO supabase_records/i.test(sql)){
      const[table,key,ownerId,recordJson]=args;
      this.records.set(`${table}:${key}`,{table,key,ownerId:ownerId||null,record:JSON.parse(recordJson)});
      return{success:true};
    }
    throw new Error(`unexpected run SQL: ${sql}`);
  }
}
function b64url(bytes){return Buffer.from(bytes).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')}
async function accessToken({userId,email,secret}){
  const now=Math.floor(Date.now()/1000);
  const header=b64url(Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})));
  const payload=b64url(Buffer.from(JSON.stringify({typ:'access',sub:userId,email,iat:now,exp:now+3600})));
  const data=`${header}.${payload}`;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data));
  return`${data}.${b64url(new Uint8Array(signature))}`;
}
function authRow(userId,email){
  const now=new Date().toISOString();
  return{user_id:userId,email,phone:null,email_confirmed_at:now,phone_confirmed_at:null,created_at:now,updated_at:now,last_sign_in_at:now,user_metadata_json:'{}',app_metadata_json:'{}'};
}
async function setup(){
  const db=new FakeD1(),user={id:'user-package',email:'package@example.test'},secret='package-lifecycle-secret';
  db.authUsers.set(user.id,authRow(user.id,user.email));
  const token=await accessToken({userId:user.id,email:user.email,secret});
  return{db,user,env:{CLINICAL_DB:db,CLINICAL_AUTH_SECRET:secret},headers:{authorization:`Bearer ${token}`,'content-type':'application/json'}};
}

test('frontend ignores exhausted packages even when their persisted status is still active',()=>{
  const match=billingSource.match(/function bvUsablePackages\(packages\)\{[^\n]+\}/);
  assert.ok(match,'bvUsablePackages must be a pure lifecycle filter');
  const usable=Function(`${match[0]};return bvUsablePackages;`)()([
    {id:'stale',status:'active',sessions_total:4,sessions_used:4},
    {id:'open',status:'active',sessions_total:4,sessions_used:2},
    {id:'done',status:'completed',sessions_total:4,sessions_used:4},
  ]);
  assert.deepEqual(usable.map(x=>x.id),['open']);
  assert.match(billingSource,/status=neq\.cancelled/);
  assert.match(billingSource,/return bvUsablePackages\(rows\)/);
});

test('creating a new package heals stale exhausted active packages and keeps one usable active package',async()=>{
  const{db,user,env,headers}=await setup();
  db.seed('appointments','appt-1',user.id,{id:'appt-1',owner_id:user.id,mother_id:'mother-1',status:'Em atendimento'});
  db.seed('care_packages','old-package',user.id,{id:'old-package',owner_id:user.id,mother_id:'mother-1',service_label:'Plano antigo',total_cents:76000,sessions_total:4,sessions_used:4,status:'active'});
  const response=await handleCloudflareClinicalRuntime(new Request('https://app.test/rest/v1/rpc/set_appointment_billing',{method:'POST',headers,body:JSON.stringify({
    p_appointment_id:'appt-1',p_billing_mode:'package_new',p_service_label:'Novo acompanhamento',p_value_cents:90000,p_payment_method:'Pix',p_package_total_cents:90000,p_package_sessions_total:5,p_package_id:null
  })}),env);
  assert.equal(response.status,200);
  const packages=db.table('care_packages');
  const old=packages.find(x=>x.id==='old-package');
  const fresh=packages.find(x=>x.id!=='old-package');
  assert.equal(old.status,'completed');
  assert.ok(fresh,'a new package must be created');
  assert.equal(fresh.status,'active');
  assert.equal(fresh.sessions_total,5);
  assert.equal(fresh.sessions_used,0);
  assert.equal(packages.filter(x=>x.status==='active'&&Number(x.sessions_used)<Number(x.sessions_total)).length,1);
  const appointment=db.table('appointments').find(x=>x.id==='appt-1');
  assert.equal(appointment.package_id,fresh.id);
});

test('manual package consumption is supported by Cloudflare and is idempotent',async()=>{
  const{db,user,env,headers}=await setup();
  db.seed('care_packages','package-1',user.id,{id:'package-1',owner_id:user.id,mother_id:'mother-1',service_label:'Plano',total_cents:76000,sessions_total:2,sessions_used:1,status:'active'});
  const body={p_package_id:'package-1',p_notes:'Baixa manual de teste',p_request_key:'req-1'};
  const request=()=>new Request('https://app.test/rest/v1/rpc/consume_care_package_session_manual',{method:'POST',headers,body:JSON.stringify(body)});
  const first=await handleCloudflareClinicalRuntime(request(),env);
  assert.equal(first.status,200);
  const firstPayload=await first.json();
  assert.equal(firstPayload.idempotent,false);
  assert.equal(firstPayload.sessions_used,2);
  assert.equal(firstPayload.sessions_remaining,0);
  assert.equal(firstPayload.package_status,'completed');
  const pkg=db.table('care_packages').find(x=>x.id==='package-1');
  assert.equal(pkg.status,'completed');
  assert.equal(pkg.sessions_used,2);
  const sessions=db.table('care_package_sessions');
  assert.equal(sessions.length,1);
  assert.equal(sessions[0].package_id,'package-1');
  assert.equal(sessions[0].source,'manual');
  assert.equal(sessions[0].request_key,'req-1');
  assert.ok(sessions[0].consumed_at);

  const second=await handleCloudflareClinicalRuntime(request(),env);
  assert.equal(second.status,200);
  const secondPayload=await second.json();
  assert.equal(secondPayload.idempotent,true);
  assert.equal(secondPayload.sessions_used,2);
  assert.equal(db.table('care_package_sessions').length,1,'retry must not consume a second session');
});
