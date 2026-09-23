import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, userId } from './helpers/cloudflare-local.mjs';

const storageSource=readFileSync(new URL('../worker/storage-consistency-runtime.js', import.meta.url),'utf8');
const storageDeleteSource=readFileSync(new URL('../worker/storage-delete-claim-runtime.js', import.meta.url),'utf8');
const documentsSource=readFileSync(new URL('../public/documents-feature.js', import.meta.url),'utf8');
const patientSource=readFileSync(new URL('../public/clinical-source/features/patient-fixes.js', import.meta.url),'utf8');
const albumSource=readFileSync(new URL('../public/album-feature.js', import.meta.url),'utf8');

async function login(runtime){return runtime.login()}
function auth(session){return {authorization:`Bearer ${session.access_token}`,'content-type':'application/json'}}

async function createPatient(runtime,session){
  const response=await runtime.mf.dispatchFetch('http://localhost/api/clinical/patients',{
    method:'POST',headers:auth(session),body:JSON.stringify({mother:{name:'Paciente mídia',consent_data:true,consent_clinical_media:true},babies:[{name:'Bebê mídia'}]})
  });
  assert.equal(response.status,201);
  return response.json();
}

async function uploadPending(runtime,session,path,operation,bytes=new Uint8Array([1,2])){
  return runtime.mf.dispatchFetch(`http://localhost/api/clinical/media/upload?path=${encodeURIComponent(path)}`,{
    method:'POST',
    headers:{...auth(session),'content-type':'image/jpeg','x-clinical-media-operation':operation},
    body:bytes
  });
}

test('R17 signed URL route is not intercepted as a storage mutation bucket named sign',async()=>{
  const runtime=await createLocalRuntime();
  try{
    const session=await login(runtime),owner=userId,path=`${owner}/patient-photos/example/profile`;
    const uploaded=await runtime.mf.dispatchFetch(`http://localhost/api/files/object/clinical-media/${path}`,{
      method:'POST',headers:{...auth(session),'content-type':'image/jpeg','x-storage-operation':'op-r17'},body:new Uint8Array([1,2,3,4])
    });
    assert.equal(uploaded.status,200);
    const uploadedBody=await uploaded.json();
    assert.equal(uploadedBody.idempotent,false);
    const signed=await runtime.mf.dispatchFetch(`http://localhost/api/files/object/sign/clinical-media/${path}`,{
      method:'POST',headers:auth(session),body:JSON.stringify({expiresIn:900})
    });
    assert.equal(signed.status,200);
    const payload=await signed.json();
    assert.match(payload.signedURL,/^\/api\/files\/object\/clinical-media\//);
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
    const first=await uploadPending(runtime,session,path,operation,new Uint8Array([9,8,7]));
    assert.equal(first.status,200);const firstBody=await first.json();
    assert.equal(firstBody.pending,true);
    assert.equal(firstBody.idempotent,false);
    assert.equal(firstBody.operation_id,operation);
    const retry=await uploadPending(runtime,session,path,operation,new Uint8Array([9,8,7]));
    assert.equal(retry.status,200);const retryBody=await retry.json();
    assert.equal(retryBody.pending,true);
    assert.equal(retryBody.idempotent,true);
    assert.equal(retryBody.operation_id,operation);
    assert.equal(retryBody.Key,firstBody.Key);
    const confirmBody={operation_key:operation,storage_path:path,mother_id:mid,baby_id:baby,encounter_id:encounter.id,mime_type:'image/jpeg',file_name:'retry-safe.jpg',file_size:3,category:'Foto clínica',caption:'',taken_at:'2026-09-23T12:05:00.000Z'};
    for(let i=0;i<2;i++){
      const confirmed=await runtime.mf.dispatchFetch('http://localhost/api/clinical/media/confirm',{
        method:'POST',headers:auth(session),body:JSON.stringify(confirmBody)
      });
      assert.equal(confirmed.status,200);
      const confirmedBody=await confirmed.json();
      assert.equal(confirmedBody.media.id,operation);
      assert.equal(confirmedBody.idempotent,i===1);
    }
    const row=await runtime.db.prepare("SELECT record_json FROM supabase_records WHERE table_name='clinical_media' AND owner_id=? AND record_key=?").bind(userId,operation).first();
    assert.ok(row);
    assert.equal(JSON.parse(row.record_json).storage_path,path);
    const storage=await runtime.db.prepare("SELECT metadata_json FROM storage_objects WHERE source_bucket='clinical-media' AND source_path=?").bind(path).first();
    assert.equal(JSON.parse(storage.metadata_json).state,'confirmed');
  }finally{await runtime.close()}
});

test('C03 stale pending clinical upload can be reconciled without touching confirmed media',async()=>{
  const runtime=await createLocalRuntime();
  try{
    const session=await login(runtime),patient=await createPatient(runtime,session),mid=patient.mother.id;
    const stalePath=`${userId}/${mid}/stale/pending.jpg`,keepPath=`${userId}/${mid}/keep/confirmed.jpg`;
    for(const [path,op] of [[stalePath,'stale-op'],[keepPath,'keep-op']]){
      const upload=await uploadPending(runtime,session,path,op);
      assert.equal(upload.status,200);
      assert.equal((await upload.json()).pending,true);
    }
    const stale=await runtime.db.prepare("SELECT r2_key,metadata_json FROM storage_objects WHERE source_bucket='clinical-media' AND source_path=?").bind(stalePath).first();
    const keep=await runtime.db.prepare("SELECT r2_key,metadata_json FROM storage_objects WHERE source_bucket='clinical-media' AND source_path=?").bind(keepPath).first();
    assert.ok(stale?.r2_key);assert.ok(keep?.r2_key);
    const old='2026-01-01T00:00:00.000Z';
    const staleMeta={...JSON.parse(stale.metadata_json),state:'pending',pending_at:old};
    const keepMeta={...JSON.parse(keep.metadata_json),state:'confirmed',confirmed_at:old};
    await runtime.db.prepare("UPDATE storage_objects SET metadata_json=?,source_updated_at=? WHERE source_bucket='clinical-media' AND source_path=?").bind(JSON.stringify(staleMeta),old,stalePath).run();
    await runtime.db.prepare("UPDATE storage_objects SET metadata_json=?,source_updated_at=? WHERE source_bucket='clinical-media' AND source_path=?").bind(JSON.stringify(keepMeta),old,keepPath).run();
    const reconcile=await runtime.mf.dispatchFetch('http://localhost/api/clinical/media/reconcile',{
      method:'POST',headers:auth(session),body:JSON.stringify({max_age_seconds:60})
    });
    assert.equal(reconcile.status,200);
    const staleAfter=await runtime.db.prepare("SELECT r2_key FROM storage_objects WHERE source_bucket='clinical-media' AND source_path=?").bind(stalePath).first();
    const keepAfter=await runtime.db.prepare("SELECT r2_key FROM storage_objects WHERE source_bucket='clinical-media' AND source_path=?").bind(keepPath).first();
    assert.equal(staleAfter,null);
    assert.equal(await runtime.env.CLINICAL_FILES.get(stale.r2_key),null);
    assert.equal(keepAfter.r2_key,keep.r2_key);
    assert.ok(await runtime.env.CLINICAL_FILES.get(keep.r2_key));
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