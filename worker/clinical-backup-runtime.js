import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { runtimeJson } from './cloudflare-data-runtime.js';

export const CLINICAL_BACKUP_FORMAT = 'debora-lactacao-clinical-account-backup';
export const CLINICAL_BACKUP_VERSION = 2;
export const CLINICAL_BACKUP_TABLES = [
  'mothers','babies','appointments','appointment_babies','clinical_encounters','clinical_encounter_babies',
  'weights','growth_measurements','followups','financial_entries','consents','library_items','media','clinical_media',
  'clinical_document_templates','clinical_documents','clinical_encounter_addenda','clinical_note_revisions',
  'care_packages','care_package_items','care_package_sessions','care_package_item_usages','professional_profiles',
];

const EXPORT_PATH = '/api/clinical/backup/export';
const RESTORE_PATH = '/api/clinical/backup/restore';
const enc = new TextEncoder();

function bytesToBase64(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(String(value ?? '')); } catch { return fallback; }
}

function rowIdentity(entry) {
  return String(entry?.record?.id ?? entry?.recordKey ?? '');
}

function ownershipReferences(record = {}) {
  return [
    ['mother_id','mothers'], ['baby_id','babies'], ['appointment_id','appointments'],
    ['encounter_id','clinical_encounters'], ['package_id','care_packages'], ['care_package_id','care_packages'],
    ['package_item_id','care_package_items'], ['template_id','clinical_document_templates'],
    ['source_consent_id','consents'],
  ].filter(([field]) => record[field]);
}

function isDirectlyOwned(entry, userId) {
  const record = entry.record || {};
  return String(entry.ownerId || '') === userId
    || String(record.owner_id || '') === userId
    || String(record.user_id || '') === userId
    || String(record.uploaded_by || '') === userId
    || (entry.table === 'professional_profiles' && String(record.id || entry.recordKey || '') === userId);
}

function selectOwnedRows(entries, userId) {
  const accepted = new Set();
  const byIdentity = new Map();
  for (const entry of entries) {
    const id = rowIdentity(entry);
    if (id) byIdentity.set(`${entry.table}:${id}`, entry);
    if (isDirectlyOwned(entry, userId)) accepted.add(entry);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of entries) {
      if (accepted.has(entry)) continue;
      for (const [field, table] of ownershipReferences(entry.record)) {
        const parent = byIdentity.get(`${table}:${entry.record[field]}`);
        if (parent && accepted.has(parent)) {
          accepted.add(entry);
          changed = true;
          break;
        }
      }
    }
  }
  return entries.filter((entry) => accepted.has(entry));
}

async function readBackupRows(db, userId) {
  const placeholders = CLINICAL_BACKUP_TABLES.map(() => '?').join(',');
  const result = await db.prepare(`SELECT table_name,record_key,owner_id,record_json,source_created_at,source_updated_at
    FROM supabase_records WHERE table_name IN (${placeholders}) ORDER BY table_name,record_key`)
    .bind(...CLINICAL_BACKUP_TABLES).all();
  const parsed = (result.results || []).map((row) => ({
    table: String(row.table_name),
    recordKey: String(row.record_key),
    ownerId: row.owner_id || null,
    record: parseJson(row.record_json, null),
    sourceCreatedAt: row.source_created_at || null,
    sourceUpdatedAt: row.source_updated_at || null,
  })).filter((entry) => entry.record && typeof entry.record === 'object' && !Array.isArray(entry.record));
  return selectOwnedRows(parsed, userId);
}

function referencedStoragePaths(rows) {
  const paths = new Set();
  for (const { record } of rows) {
    for (const field of ['storage_path','pdf_storage_path']) {
      if (record?.[field]) paths.add(String(record[field]));
    }
  }
  return paths;
}

async function readBackupFiles(env, userId, rows) {
  const result = await env.CLINICAL_DB.prepare(`SELECT source_bucket,source_path,r2_key,size_bytes,mime_type,
      source_created_at,source_updated_at,metadata_json
    FROM storage_objects ORDER BY source_bucket,source_path`).all();
  const referenced = referencedStoragePaths(rows);
  const files = [];
  for (const row of result.results || []) {
    const metadata = parseJson(row.metadata_json, {});
    const path = String(row.source_path || '');
    const owned = String(metadata.owner_id || '') === userId || path.startsWith(`${userId}/`) || referenced.has(path);
    if (!owned) continue;
    const object = await env.CLINICAL_FILES.get(String(row.r2_key || ''));
    if (!object) throw new Error(`backup_r2_object_missing:${row.source_bucket}:${path}`);
    const bytes = new Uint8Array(await object.arrayBuffer());
    files.push({
      bucket: String(row.source_bucket || ''),
      path,
      r2Key: String(row.r2_key || ''),
      size: bytes.byteLength,
      mimeType: String(row.mime_type || object.httpMetadata?.contentType || 'application/octet-stream'),
      sourceCreatedAt: row.source_created_at || null,
      sourceUpdatedAt: row.source_updated_at || null,
      metadata,
      bytesBase64: bytesToBase64(bytes),
    });
  }
  return files;
}

function tablesFromRows(rows) {
  const tables = Object.fromEntries(CLINICAL_BACKUP_TABLES.map((table) => [table, []]));
  for (const entry of rows) tables[entry.table].push({
    recordKey: entry.recordKey,
    record: entry.record,
    sourceCreatedAt: entry.sourceCreatedAt,
    sourceUpdatedAt: entry.sourceUpdatedAt,
  });
  return tables;
}

async function exportBackup(env, user) {
  if (!env.CLINICAL_FILES) return runtimeJson(503, { error: 'cloudflare_r2_required' });
  try {
    const rows = await readBackupRows(env.CLINICAL_DB, user.id);
    const files = await readBackupFiles(env, user.id, rows);
    return runtimeJson(200, {
      format: CLINICAL_BACKUP_FORMAT,
      version: CLINICAL_BACKUP_VERSION,
      ownerId: user.id,
      exportedAt: new Date().toISOString(),
      scope: {
        kind: 'clinical-account',
        tables: [...CLINICAL_BACKUP_TABLES],
        files: true,
        excluded: [
          'auth credentials and refresh sessions',
          'idempotency/runtime migration state',
          'payment-provider webhooks and provider credentials',
          'commercial licensing and SaaS entitlement state',
        ],
      },
      tables: tablesFromRows(rows),
      files,
    });
  } catch (error) {
    console.error('clinical backup export failed', error);
    return runtimeJson(500, { error: 'clinical_backup_export_failed' });
  }
}

function backupError(message) {
  const error = new Error(message);
  error.code = 'invalid_clinical_backup';
  return error;
}

function assertOwnerField(record, field, ownerId) {
  if (record?.[field] != null && String(record[field]) !== ownerId) throw backupError(`owner mismatch in ${field}`);
}

function flattenAndValidateBackup(backup, userId) {
  if (backup?.format !== CLINICAL_BACKUP_FORMAT || backup?.version !== CLINICAL_BACKUP_VERSION) {
    throw backupError('unsupported backup format');
  }
  if (String(backup.ownerId || '') !== userId) throw backupError('backup belongs to another account');
  if (!backup.tables || typeof backup.tables !== 'object' || !Array.isArray(backup.files)) throw backupError('invalid backup payload');
  for (const table of Object.keys(backup.tables)) if (!CLINICAL_BACKUP_TABLES.includes(table)) throw backupError(`unknown table ${table}`);

  const entries = [];
  const ids = new Map(CLINICAL_BACKUP_TABLES.map((table) => [table, new Set()]));
  for (const table of CLINICAL_BACKUP_TABLES) {
    const rows = backup.tables[table];
    if (!Array.isArray(rows)) throw backupError(`missing table ${table}`);
    for (const item of rows) {
      if (!item || !String(item.recordKey || '') || !item.record || typeof item.record !== 'object' || Array.isArray(item.record)) {
        throw backupError(`invalid row in ${table}`);
      }
      assertOwnerField(item.record, 'owner_id', userId);
      assertOwnerField(item.record, 'user_id', userId);
      assertOwnerField(item.record, 'uploaded_by', userId);
      const entry = { table, recordKey: String(item.recordKey), record: item.record, sourceCreatedAt: item.sourceCreatedAt || null, sourceUpdatedAt: item.sourceUpdatedAt || null };
      entries.push(entry);
      const id = rowIdentity(entry);
      if (id) ids.get(table).add(id);
    }
  }

  const relationRules = {
    babies: [['mother_id','mothers']],
    appointments: [['mother_id','mothers']],
    appointment_babies: [['appointment_id','appointments'],['baby_id','babies']],
    clinical_encounters: [['mother_id','mothers'],['appointment_id','appointments'],['baby_id','babies']],
    clinical_encounter_babies: [['encounter_id','clinical_encounters'],['baby_id','babies']],
    weights: [['baby_id','babies']], growth_measurements: [['baby_id','babies']],
    followups: [['mother_id','mothers'],['encounter_id','clinical_encounters']],
    financial_entries: [['mother_id','mothers'],['package_id','care_packages'],['package_item_id','care_package_items']],
    consents: [['mother_id','mothers']], media: [['mother_id','mothers'],['baby_id','babies']],
    clinical_media: [['mother_id','mothers'],['baby_id','babies'],['appointment_id','appointments'],['encounter_id','clinical_encounters']],
    clinical_documents: [['mother_id','mothers'],['baby_id','babies'],['appointment_id','appointments'],['encounter_id','clinical_encounters'],['template_id','clinical_document_templates'],['source_consent_id','consents']],
    clinical_encounter_addenda: [['encounter_id','clinical_encounters']], clinical_note_revisions: [['encounter_id','clinical_encounters']],
    care_packages: [['mother_id','mothers']], care_package_items: [['package_id','care_packages'],['mother_id','mothers']],
    care_package_sessions: [['package_id','care_packages'],['care_package_id','care_packages'],['mother_id','mothers'],['appointment_id','appointments'],['encounter_id','clinical_encounters']],
    care_package_item_usages: [['package_id','care_packages'],['package_item_id','care_package_items'],['mother_id','mothers'],['appointment_id','appointments'],['encounter_id','clinical_encounters']],
  };
  for (const entry of entries) {
    for (const [field, target] of relationRules[entry.table] || []) {
      const value = entry.record[field];
      if (value != null && value !== '' && !ids.get(target)?.has(String(value))) throw backupError(`broken relation ${entry.table}.${field}`);
    }
  }

  const seenFiles = new Set();
  const files = backup.files.map((file) => {
    if (!file || !file.bucket || !file.path || typeof file.bytesBase64 !== 'string') throw backupError('invalid file');
    if (!String(file.path).startsWith(`${userId}/`)) throw backupError('file outside account scope');
    const identity = `${file.bucket}:${file.path}`;
    if (seenFiles.has(identity)) throw backupError('duplicate file');
    seenFiles.add(identity);
    let bytes;
    try { bytes = base64ToBytes(file.bytesBase64); } catch { throw backupError('invalid file encoding'); }
    if (file.size != null && Number(file.size) !== bytes.byteLength) throw backupError('file size mismatch');
    const metadata = file.metadata && typeof file.metadata === 'object' && !Array.isArray(file.metadata) ? { ...file.metadata } : {};
    if (metadata.owner_id != null && String(metadata.owner_id) !== userId) throw backupError('file owner mismatch');
    metadata.owner_id = userId;
    return { ...file, bucket:String(file.bucket), path:String(file.path), bytes, metadata };
  });
  return { entries, files };
}

function recordStatement(db, userId, entry) {
  return db.prepare(`INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at)
    VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(table_name,record_key) DO UPDATE SET
      owner_id=excluded.owner_id,record_json=excluded.record_json,
      source_created_at=excluded.source_created_at,source_updated_at=excluded.source_updated_at,migrated_at=CURRENT_TIMESTAMP`)
    .bind(entry.table, entry.recordKey, userId, JSON.stringify(entry.record), entry.sourceCreatedAt, entry.sourceUpdatedAt);
}

function storageStatement(db, file, key) {
  return db.prepare(`INSERT INTO storage_objects(source_bucket,source_path,r2_key,size_bytes,mime_type,source_created_at,source_updated_at,metadata_json,migrated_at)
    VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(source_bucket,source_path) DO UPDATE SET
      r2_key=excluded.r2_key,size_bytes=excluded.size_bytes,mime_type=excluded.mime_type,
      source_created_at=excluded.source_created_at,source_updated_at=excluded.source_updated_at,
      metadata_json=excluded.metadata_json,migrated_at=CURRENT_TIMESTAMP`)
    .bind(file.bucket, file.path, key, file.bytes.byteLength, file.mimeType || 'application/octet-stream', file.sourceCreatedAt || null, file.sourceUpdatedAt || null, JSON.stringify(file.metadata));
}

async function cleanupStaged(r2, staged) {
  await Promise.all(staged.map(({ key }) => r2.delete(key).catch(() => undefined)));
}

async function restoreBackup(request, env, user) {
  if (!env.CLINICAL_FILES) return runtimeJson(503, { error: 'cloudflare_r2_required' });
  const backup = await request.json().catch(() => null);
  let parsed;
  try { parsed = flattenAndValidateBackup(backup, user.id); }
  catch (error) { return runtimeJson(400, { error: error.code || 'invalid_clinical_backup', message: error.message }); }

  const staged = [];
  const previousKeys = [];
  try {
    for (const file of parsed.files) {
      const previous = await env.CLINICAL_DB.prepare(`SELECT r2_key FROM storage_objects WHERE source_bucket=? AND source_path=? LIMIT 1`)
        .bind(file.bucket, file.path).first();
      if (previous?.r2_key) previousKeys.push(String(previous.r2_key));
      const key = `supabase/.backup-restore/${encodeURIComponent(user.id)}/${crypto.randomUUID()}`;
      await env.CLINICAL_FILES.put(key, file.bytes, { httpMetadata: { contentType: file.mimeType || 'application/octet-stream' } });
      staged.push({ file, key });
    }

    const statements = [
      ...parsed.entries.map((entry) => recordStatement(env.CLINICAL_DB, user.id, entry)),
      ...staged.map(({ file, key }) => storageStatement(env.CLINICAL_DB, file, key)),
    ];
    if (statements.length) await env.CLINICAL_DB.batch(statements);
  } catch (error) {
    await cleanupStaged(env.CLINICAL_FILES, staged);
    console.error('clinical backup restore failed', error);
    return runtimeJson(500, { error: 'clinical_backup_restore_failed' });
  }

  for (const key of previousKeys) {
    if (!staged.some((entry) => entry.key === key)) env.CLINICAL_FILES.delete(key).catch(() => undefined);
  }

  try {
    for (const entry of parsed.entries) {
      const row = await env.CLINICAL_DB.prepare(`SELECT owner_id,record_json FROM supabase_records WHERE table_name=? AND record_key=? LIMIT 1`)
        .bind(entry.table, entry.recordKey).first();
      if (String(row?.owner_id || '') !== user.id || JSON.stringify(parseJson(row?.record_json, null)) !== JSON.stringify(entry.record)) {
        throw new Error(`backup verification failed:${entry.table}:${entry.recordKey}`);
      }
    }
    for (const { file, key } of staged) {
      const row = await env.CLINICAL_DB.prepare(`SELECT r2_key FROM storage_objects WHERE source_bucket=? AND source_path=? LIMIT 1`)
        .bind(file.bucket, file.path).first();
      if (String(row?.r2_key || '') !== key || !(await env.CLINICAL_FILES.get(key))) throw new Error(`backup file verification failed:${file.path}`);
    }
  } catch (error) {
    console.error('clinical backup post-restore verification failed', error);
    return runtimeJson(500, { error: 'clinical_backup_verification_failed' });
  }

  const tableCounts = Object.fromEntries(CLINICAL_BACKUP_TABLES.map((table) => [table, parsed.entries.filter((entry) => entry.table === table).length]));
  return runtimeJson(200, { verified:true, version:CLINICAL_BACKUP_VERSION, records:parsed.entries.length, files:staged.length, tables:tableCounts });
}

export async function handleClinicalBackupRuntime(request, env, url = new URL(request.url)) {
  const isExport = request.method === 'GET' && url.pathname === EXPORT_PATH;
  const isRestore = request.method === 'POST' && url.pathname === RESTORE_PATH;
  if (!isExport && !isRestore) return null;
  if (!env.CLINICAL_DB) return runtimeJson(503, { error: 'cloudflare_d1_required' });
  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return runtimeJson(401, { error: 'cloudflare_auth_required' });
  return isExport ? exportBackup(env, user) : restoreBackup(request, env, user);
}
