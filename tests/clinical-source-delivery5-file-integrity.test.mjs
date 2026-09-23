import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, userId } from './helpers/cloudflare-local.mjs';

const clinicalSource=readFileSync(new URL('../worker/cloudflare-clinical-runtime.js', import.meta.url),'utf8');
const storageSource=readFileSync(new URL('../worker/storage-consistency-runtime.js', import.meta.url),'utf8');
const storageDeleteSource=readFileSync(new URL('../worker/storage-delete-claim-runtime.js', import.meta.url),'utf8');
const documentsSource=readFileSync(new URL('../public/documents-feature.js', import.meta.url),'utf8');
const patientSource=readFileSync(new URL('../public/clinical-source/features/patient-fixes.js', import.meta.url),'utf8');
const albumSource=readFileSync(new URL('../public/clinical-source/features/album-feature.js', import.meta.url),'utf8');

async function putRecord(db,table,key,record,owner=userId){
  const now='2026-09-01T10:00:00.000Z';
  await db.prepare(`INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at) VALUES(?,?,?,?,?,?)`)
    .bind(table,key,owner,JSON.stringify(record),now,now).run();
}
async function login(runtime){return runtime.login()}
function auth(session){return {authorization:`Bearer ${session.access_token}`,'content-type':'application/json'}}

async function createPatient(runtime,session){
  const response=await runtime.mf.dispatchFetch('http://localhost/api/clinical/patients',{
    method:'POST',headers:auth(session),body:JSON.stringify({mother:{name:'Paciente mídia',consent_data:true,consent_clinical_media:true},babies:[{name:'Bebê mídia'}]})
  });
  assert.equal(response.status,201);
  return response.json();
}

test('R17 signed URL route is not intercepted as a storage mutation bucket named sign',async()=>{
  const runtime=await createLocalRuntime();
  try{
    const session=await login(runtime),owner=userId,path=`${owner}/patient-photos/example/profile`;
    const uploaded=await runtime.mf.dispatchFetch(`http://localhost/api/files/object/clinical-media/${path}`,{
      method:'POST',headers:{...auth(session),'content-type':'image/jpeg','x-storage-operation':'op-r17'},body:new Uint8Array([1,2,3,4])
    });
    assert.equal(uploaded.status,201);
    const signed=await runtime.mf.dispatchFetch(`http://localhost/api/files/object/sign/clinical-media/${path}`,{
      method:'POST',headers:auth(session),body:JSON.stringify({expiresIn:900})
    });
    assert.equal(signed.status,200);
    const payload=await signed.json();
    assert.match(payload.signedURL,/^\/api\/files\/signed\//);
    assert.doesNotMatch(payload.signedURL,/\/api\/files\/api\/files\//);
  }finally{await runtime.close()}
});

test('C03 clinical media upload has a retry-safe pending operation and confirm is idempotent',async()=>{
  const runtime=await createLocalRuntime();
  try{
    const session=await login(runtime),patient=await createPatient(runtime,session),mid=patient.mother.id,baby=patient.babies[0].id;
    const start=await runtime.mf.dispatchFetch('http://localhost/api/clinical/rpc/start_clinical_encounter',{
      method:'POST',headers:auth(session),body:JSON.stringify({p_mother_id:mid,p_baby_ids:[baby],p_appointment_type:'Consulta inicial',p_starts_at:'2026-09-23T12:00:00.000Z',p_request_key:'media-encounter'})
    });
    assert.equal(start.status,200);const encounter=await start.json();
    const path=`${userId}/${mid}/${encounter.id}/retry-safe.jpg`,operation='media-op-stable';
    const first=await runtime.mf.dispatchFetch(`http://localhost/api/files/object/clinical-media/${path}`,{
      method:'POST',headers:{...auth(session),'content-type':'image/jpeg','x-storage-operation':operation},body:new Uint8Array([9,8,7])
    });
    assert.equal(first.status,201);const firstBody=await first.json();
    assert.equal(firstBody.status,'pending');
    const retry=await runtime.mf.dispatchFetch(`http://localhost/api/files/object/clinical-media/${path}`,{
      method:'POST',headers:{...auth(session),'content-type':'image/jpeg','x-storage-operation':operation},body:new Uint8Array([9,8,7])
    });
    assert.equal(retry.status,200);const retryBody=await retry.json();
    assert.equal(retryBody.operation_id,operation);
    assert.equal(retryBody.r2_key,firstBody.r2_key);
    const confirmBody={p_operation_key:operation,p_mother_id:mid,p_baby_id:baby,p_encounter_id:encounter.id,p_type:'photo',p_label:'Foto clínica'};
    for(let i=0;i<2;i++){
      const confirmed=await runtime.mf.dispatchFetch('http://localhost/api/clinical/rpc/confirm_clinical_media',{
        method:'POST',headers:auth(session),body:JSON.stringify(confirmBody)
      });
      assert.equal(confirmed.status,200);
      assert.equal((await confirmed.json()).operation_id,operation);
    }
    const rows=await runtime.db.prepare("SELECT record_json FROM supabase_records WHERE table_name='clinical_media' AND owner_id=?").bind(userId).all();
    assert.equal(rows.results.length,1);
    assert.equal(JSON.parse(rows.results[0].record_json).status,'confirmed');
  }finally{await runtime.close()}
});

test('C03 stale pending clinical upload can be reconciled without touching confirmed media',async()=>{
  const runtime=await createLocalRuntime();
  try{
    const session=await login(runtime),patient=await createPatient(runtime,session),mid=patient.mother.id;
    const stalePath=`${userId}/${mid}/stale/pending.jpg`,keepPath=`${userId}/${mid}/keep/confirmed.jpg`;
    for(const [path,op] of [[stalePath,'stale-op'],[keepPath,'keep-op']]){
      const upload=await runtime.mf.dispatchFetch(`http://localhost/api/files/object/clinical-media/${path}`,{
        method:'POST',headers:{...auth(session),'content-type':'image/jpeg','x-storage-operation':op},body:new Uint8Array([1,2])
      });
      assert.equal(upload.status,201);
    }
    const stale=await runtime.db.prepare("SELECT record_key,record_json FROM supabase_records WHERE table_name='storage_objects' AND record_key='stale-op'").first();
    const staleRecord=JSON.parse(stale.record_json);staleRecord.updated_at='2026-01-01T00:00:00.000Z';
    await runtime.db.prepare("UPDATE supabase_records SET record_json=?,source_updated_at=? WHERE table_name='storage_objects' AND record_key='stale-op'").bind(JSON.stringify(staleRecord),staleRecord.updated_at).run();
    const keep=await runtime.db.prepare("SELECT record_json FROM supabase_records WHERE table_name='storage_objects' AND record_key='keep-op'").first();
    const keepRecord=JSON.parse(keep.record_json);keepRecord.status='confirmed';keepRecord.updated_at='2026-01-01T00:00:00.000Z';
    await runtime.db.prepare("UPDATE supabase_records SET record_json=?,source_updated_at=? WHERE table_name='storage_objects' AND record_key='keep-op'").bind(JSON.stringify(keepRecord),keepRecord.updated_at).run();
    const reconcile=await runtime.mf.dispatchFetch('http://localhost/api/clinical/rpc/reconcile_pending_clinical_media',{
      method:'POST',headers:auth(session),body:JSON.stringify({p_older_than:'2026-06-01T00:00:00.000Z'})
    });
    assert.equal(reconcile.status,200);const body=await reconcile.json();assert.equal(body.removed,1);
    assert.equal(await runtime.env.CLINICAL_FILES.get(stalePath),null);
    assert.ok(await runtime.env.CLINICAL_FILES.get(keepPath));
  }finally{await runtime.close()}
});

test('C11 storage mutation uses immutable operation objects and conditional claimed deletion',()=>{
  assert.match(storageSource,/immutableStorageKey/);
  assert.match(storageSource,/operation_id/);
  assert.match(storageDeleteSource,/storage_delete_claims/);
  assert.match(storageDeleteSource,/CLINICAL_DB\.batch\(\[/);
  assert.match(storageDeleteSource,/DELETE FROM storage_objects[\s\S]*r2_key\s*=\s*\?/);
  assert.match(storageDeleteSource,/CLINICAL_FILES\.delete\(r2Key\)/);
  assert.doesNotMatch(`${storageSource}\n${storageDeleteSource}`,/compensateMetadata/);
});

test('C04 signed file consumers accept the canonical /api/files URL without double prefixing', () => {
  assert.match(documentsSource, /resolveSignedFileUrl/);
  assert.doesNotMatch(documentsSource, /\/storage\/v1\$\{signed/);
  assert.match(patientSource, /pfResolveSignedUrl/);
  assert.doesNotMatch(patientSource, /PF_SB\+'\/api\/files'\+\(u/);
});

test('C05 patient photo reference is server-backed, expiry-aware in memory and patient-targeted', () => {
  assert.match(patientSource, /profile_photo_path/);
  assert.match(patientSource, /pfPhotoUrlCache/);
  assert.match(patientSource, /expiresAt/);
  assert.match(patientSource, /document\.querySelector\([^\n]*data-screen[^\n]*patient[^\n]*data-patient-avatar/);
  assert.doesNotMatch(patientSource, /localStorage\.setItem\('pf-photo-path-/);
  assert.doesNotMatch(patientSource, /sessionStorage\.setItem\(key,u\)/);
});

test('C03 album uses one stable operation key and server confirm instead of manual delete compensation', () => {
  assert.match(albumSource, /operationKey/);
  assert.match(albumSource, /confirmClinicalMedia/);
  assert.doesNotMatch(albumSource, /deleteClinicalMedia\(storagePath\)\.catch/);
});