import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalRuntime,userId} from './helpers/cloudflare-local.mjs';
import {CLINICAL_BACKUP_TABLES,CLINICAL_BACKUP_FORMAT,CLINICAL_BACKUP_VERSION} from '../worker/clinical-backup-runtime.js';

const backupTableEntries=()=>Object.fromEntries(CLINICAL_BACKUP_TABLES.map(table=>[table,[]]));

test('metadata-only export lists ALL registered datasets and R2 references without copying binary media',async()=>{
  const runtime=await createLocalRuntime();
  try {
    const session=await runtime.login();
    const headers={authorization:'Bearer '+session.access_token};
    await runtime.db.prepare('INSERT INTO supabase_records (table_name,record_key,owner_id,record_json) VALUES (?,?,?,?)')
      .bind('mothers','m-1',userId,JSON.stringify({id:'m-1',owner_id:userId,name:'Paciente'})).run();
    await runtime.db.prepare('INSERT INTO storage_objects (source_bucket,source_path,r2_key,size_bytes,mime_type,metadata_json) VALUES (?,?,?,?,?,?)')
      .bind('clinical-media',userId+'/file.png','supabase/.objects/missing-r2',55,'image/png',JSON.stringify({owner_id:userId})).run();
    const response=await runtime.mf.dispatchFetch('http://localhost/api/clinical/backup/export?metadataOnly=1',{headers});
    assert.equal(response.status,200);
    const backup=await response.json();
    assert.equal(backup.format,CLINICAL_BACKUP_FORMAT);
    assert.equal(backup.version,CLINICAL_BACKUP_VERSION);
    assert.equal(backup.scope.files,false);
    assert.equal(backup.tables.mothers.length,1);
    assert.deepEqual(Object.keys(backup.tables),CLINICAL_BACKUP_TABLES);
    assert.equal(backup.files.length,1);
    assert.equal(backup.files[0].size,55);
    assert.equal(backup.files[0].bytesBase64,undefined);
    assert.equal(backup.files[0].r2Key,undefined);
    const preview=await runtime.mf.dispatchFetch('http://localhost/api/clinical/backup/preview',{
      method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(backup)
    });
    assert.equal(preview.status,400,'spreadsheet data are not restorable without encrypted attachments');
  } finally {await runtime.close();}
});

test('restore preflight validates relationship graph and duplicates before any writes',async()=>{
  const runtime=await createLocalRuntime();
  try {
    const session=await runtime.login();
    const headers={authorization:'Bearer '+session.access_token,'content-type':'application/json'};
    const valid={format:CLINICAL_BACKUP_FORMAT,version:CLINICAL_BACKUP_VERSION,ownerId:userId,
      exportedAt:'2026-10-24T12:00:00Z',
      tables:backupTableEntries(),files:[]};
    valid.tables.mothers.push({recordKey:'m-1',record:{id:'m-1',owner_id:userId,name:'Ana'}});
    const preview=await runtime.mf.dispatchFetch('http://localhost/api/clinical/backup/preview',{
      method:'POST',headers,body:JSON.stringify(valid)
    });
    assert.equal(preview.status,200);
    const result=await preview.json();
    assert.equal(result.valid,true); assert.equal(result.mode,'merge');
    assert.equal(result.records,1); assert.equal(result.files,0);
    assert.equal(result.tables.mothers,1);
    const dbBefore=await runtime.db.prepare('SELECT COUNT(*) AS n FROM supabase_records').first();
    assert.equal(Number(dbBefore.n),0);
    valid.tables.mothers.push({...valid.tables.mothers[0]});
    const duplicate=await runtime.mf.dispatchFetch('http://localhost/api/clinical/backup/preview',{
      method:'POST',headers,body:JSON.stringify(valid)
    });
    assert.equal(duplicate.status,400);
    assert.match((await duplicate.json()).message,/duplicate record/);
    const dbAfter=await runtime.db.prepare('SELECT COUNT(*) AS n FROM supabase_records').first();
    assert.equal(Number(dbAfter.n),0);
  } finally {await runtime.close();}
});

test('canonical clinical build injects spreadsheet and preview options',async()=>{
  const {readFileSync}=await import('node:fs');
  const m=readFileSync(new URL('../scripts/materialize-clinical-source.mjs',import.meta.url),'utf8');
  assert.match(m,/backup-spreadsheet/);
  assert.match(m,/createBackupWorkbook/);
  assert.match(m,/previewRestore/);
  assert.match(m,/\.amamentacao/);
});
