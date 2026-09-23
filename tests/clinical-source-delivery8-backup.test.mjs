import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, userId } from './helpers/cloudflare-local.mjs';

const REQUIRED_TABLES = [
  'mothers','babies','appointments','appointment_babies','clinical_encounters','clinical_encounter_babies',
  'weights','growth_measurements','followups','financial_entries','consents','library_items','media','clinical_media',
  'clinical_document_templates','clinical_documents','clinical_encounter_addenda','clinical_note_revisions',
  'care_packages','care_package_items','care_package_sessions','care_package_item_usages','professional_profiles',
];

function authHeaders(session) {
  return { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' };
}

async function putRecord(db, table, key, record) {
  await db.prepare(`INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at)
    VALUES(?,?,?,?,?,?)`)
    .bind(table, key, userId, JSON.stringify(record), '2026-09-01T10:00:00.000Z', '2026-09-02T10:00:00.000Z')
    .run();
}

function syntheticRecords() {
  const owned = (id, extra = {}) => ({ id, owner_id: userId, ...extra });
  return [
    ['mothers','m1',owned('m1',{name:'Paciente backup'})],
    ['babies','b1',owned('b1',{mother_id:'m1',name:'Bebê backup'})],
    ['appointments','a1',owned('a1',{mother_id:'m1',status:'Realizado'})],
    ['appointment_babies','a1:b1',{owner_id:userId,appointment_id:'a1',baby_id:'b1'}],
    ['clinical_encounters','e1',owned('e1',{mother_id:'m1',appointment_id:'a1',status:'finalized',clinical_note:'texto final'})],
    ['clinical_encounter_babies','e1:b1',{owner_id:userId,encounter_id:'e1',baby_id:'b1'}],
    ['weights','w1',owned('w1',{baby_id:'b1',weight_g:4100})],
    ['growth_measurements','g1',owned('g1',{baby_id:'b1',weight_g:4200,length_cm:54})],
    ['followups','f1',owned('f1',{mother_id:'m1',encounter_id:'e1'})],
    ['financial_entries','fin1',owned('fin1',{mother_id:'m1',package_id:'p1',amount_cents:35000})],
    ['consents','c1',owned('c1',{mother_id:'m1',consent_type:'data_processing',granted:true})],
    ['library_items','l1',owned('l1',{title:'Material privado'})],
    ['media','med1',owned('med1',{mother_id:'m1',storage_path:`${userId}/legacy/photo.jpg`})],
    ['clinical_media','cm1',owned('cm1',{mother_id:'m1',baby_id:'b1',appointment_id:'a1',encounter_id:'e1',uploaded_by:userId,storage_path:`${userId}/album/photo.jpg`})],
    ['clinical_document_templates','tpl1',owned('tpl1',{document_type:'care_plan',name:'Plano padrão'})],
    ['clinical_documents','doc1',owned('doc1',{mother_id:'m1',baby_id:'b1',appointment_id:'a1',encounter_id:'e1',template_id:'tpl1',document_type:'care_plan',pdf_storage_path:`${userId}/docs/plan.pdf`})],
    ['clinical_encounter_addenda','add1',owned('add1',{encounter_id:'e1',content:'adendo'})],
    ['clinical_note_revisions','rev1',owned('rev1',{encounter_id:'e1',previous_note:'texto anterior'})],
    ['care_packages','p1',owned('p1',{mother_id:'m1',sessions_total:2,sessions_used:1,total_cents:35000})],
    ['care_package_items','pi1',owned('pi1',{package_id:'p1',mother_id:'m1',quantity_total:2,quantity_used:1})],
    ['care_package_sessions','ps1',owned('ps1',{package_id:'p1',mother_id:'m1',appointment_id:'a1',encounter_id:'e1'})],
    ['care_package_item_usages','pu1',owned('pu1',{package_id:'p1',package_item_id:'pi1',mother_id:'m1',appointment_id:'a1',encounter_id:'e1'})],
    ['professional_profiles',userId,owned(userId,{display_name:'Profissional'})],
  ];
}

async function seedSyntheticAccount(runtime) {
  for (const [table,key,record] of syntheticRecords()) await putRecord(runtime.db, table, key, record);
  const bucket = await runtime.mf.getR2Bucket('CLINICAL_FILES');
  const bytes = new TextEncoder().encode('arquivo-clinico-backup');
  const r2Key = `supabase/.objects/clinical-media/${encodeURIComponent(`${userId}/album/photo.jpg`)}/seed-op`;
  await bucket.put(r2Key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  await runtime.db.prepare(`INSERT INTO storage_objects(source_bucket,source_path,r2_key,size_bytes,mime_type,metadata_json)
    VALUES(?,?,?,?,?,?)`).bind('clinical-media', `${userId}/album/photo.jpg`, r2Key, bytes.byteLength, 'image/jpeg', JSON.stringify({owner_id:userId,state:'committed'})).run();
  return { bucket, bytes };
}

test('C02 backup exports a versioned complete clinical graph plus current R2 bytes and restores it faithfully', async () => {
  const runtime = await createLocalRuntime();
  try {
    const { bucket, bytes } = await seedSyntheticAccount(runtime);
    const session = await runtime.login();
    const exported = await runtime.mf.dispatchFetch('http://localhost/api/clinical/backup/export', { headers: authHeaders(session) });
    assert.equal(exported.status, 200);
    const backup = await exported.json();
    assert.equal(backup.format, 'debora-lactacao-clinical-account-backup');
    assert.equal(backup.version, 2);
    assert.equal(backup.ownerId, userId);
    assert.equal(backup.scope.files, true);
    for (const table of REQUIRED_TABLES) assert.ok(Array.isArray(backup.tables[table]), `missing ${table}`);
    assert.equal(backup.files.length, 1);
    assert.equal(Buffer.from(backup.files[0].bytesBase64, 'base64').toString(), new TextDecoder().decode(bytes));

    await runtime.db.prepare('DELETE FROM supabase_records WHERE owner_id=?').bind(userId).run();
    await runtime.db.prepare('DELETE FROM storage_objects WHERE source_path LIKE ?').bind(`${userId}/%`).run();
    await bucket.delete(backup.files[0].r2Key);

    const restored = await runtime.mf.dispatchFetch('http://localhost/api/clinical/backup/restore', {
      method:'POST', headers:authHeaders(session), body:JSON.stringify(backup),
    });
    assert.equal(restored.status, 200);
    const result = await restored.json();
    assert.equal(result.verified, true);
    assert.equal(result.files, 1);

    for (const [table,key,record] of syntheticRecords()) {
      const row = await runtime.db.prepare('SELECT owner_id,record_json FROM supabase_records WHERE table_name=? AND record_key=?').bind(table,key).first();
      assert.equal(row?.owner_id, userId, `owner mismatch ${table}/${key}`);
      assert.deepEqual(JSON.parse(row.record_json), record, `content mismatch ${table}/${key}`);
    }
    const storage = await runtime.db.prepare('SELECT r2_key,mime_type FROM storage_objects WHERE source_bucket=? AND source_path=?').bind('clinical-media',`${userId}/album/photo.jpg`).first();
    assert.ok(storage?.r2_key);
    assert.equal(storage.mime_type,'image/jpeg');
    const restoredObject = await bucket.get(storage.r2_key);
    assert.equal(new TextDecoder().decode(await restoredObject.arrayBuffer()), 'arquivo-clinico-backup');
  } finally { await runtime.close(); }
});

test('C02 restore is fail-closed: a late D1 failure leaves no partial rows or restored file metadata', async () => {
  const runtime = await createLocalRuntime();
  try {
    const { bucket } = await seedSyntheticAccount(runtime);
    const session = await runtime.login();
    const response = await runtime.mf.dispatchFetch('http://localhost/api/clinical/backup/export', { headers: authHeaders(session) });
    assert.equal(response.status, 200);
    const backup = await response.json();
    await runtime.db.prepare('DELETE FROM supabase_records WHERE owner_id=?').bind(userId).run();
    await runtime.db.prepare('DELETE FROM storage_objects WHERE source_path LIKE ?').bind(`${userId}/%`).run();
    await runtime.db.prepare(`CREATE TRIGGER fail_backup_restore BEFORE INSERT ON supabase_records
      WHEN NEW.table_name='clinical_documents' BEGIN SELECT RAISE(ABORT,'forced_backup_restore_failure'); END`).run();

    const before = (await bucket.list()).objects.map(o=>o.key).sort();
    const restored = await runtime.mf.dispatchFetch('http://localhost/api/clinical/backup/restore', {
      method:'POST', headers:authHeaders(session), body:JSON.stringify(backup),
    });
    assert.equal(restored.status, 500);
    const remaining = await runtime.db.prepare('SELECT COUNT(*) AS n FROM supabase_records WHERE owner_id=?').bind(userId).first();
    assert.equal(Number(remaining.n),0);
    const storage = await runtime.db.prepare('SELECT COUNT(*) AS n FROM storage_objects WHERE source_path LIKE ?').bind(`${userId}/%`).first();
    assert.equal(Number(storage.n),0);
    const after = (await bucket.list()).objects.map(o=>o.key).sort();
    assert.deepEqual(after,before,'failed restore must compensate newly staged R2 objects');
  } finally { await runtime.close(); }
});

test('C02 frontend uses the dedicated versioned account backup contract instead of a partial table loop', () => {
  const materializer = readFileSync(new URL('../scripts/materialize-clinical-source.mjs', import.meta.url),'utf8');
  const source = readFileSync(new URL('../public/clinical-source/core/lib/backup-service.js', import.meta.url),'utf8');
  assert.match(materializer, /overlay\('core\/lib\/backup-service\.js'\)/);
  assert.match(source, /debora-lactacao-clinical-account-backup/);
  assert.match(source, /\/api\/clinical\/backup\/export/);
  assert.match(source, /\/api\/clinical\/backup\/restore/);
  assert.doesNotMatch(source, /for \(const table of TABLES\)/);
});
