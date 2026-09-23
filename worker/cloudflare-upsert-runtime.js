import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import {
  guardedRecordStatement,
  ownerRows,
  recordById,
  recordByKey,
  unownedRows,
} from './d1-record-store.js';

const GLOBAL_READ_TABLES = new Set([
  'billing_plan_catalog', 'clinical_document_templates', 'document_templates', 'portal_content', 'member_perks',
]);
const OWNER_TABLES = new Set([
  'mothers','babies','appointments','clinical_encounters','weights','growth_measurements',
  'followups','financial_entries','consents','library_items','media','clinical_media',
  'clinical_documents','clinical_encounter_addenda','clinical_note_revisions',
  'care_packages','care_package_items','care_package_sessions','care_package_item_usages',
  'professional_profiles','saas_accounts','subscriptions','entitlements',
  'billing_checkout_requests','billing_webhook_events','member_content_unlocks',
  'member_engagement_events','member_portal_access','member_shared_items',
]);
const RELATIONAL_OWNER_TABLES = new Set([
  'babies','appointments','clinical_encounters','appointment_babies','clinical_encounter_babies',
  'weights','growth_measurements','clinical_encounter_addenda','clinical_note_revisions',
  'care_package_items','care_package_sessions','care_package_item_usages',
]);
const NO_ID_TABLES = new Set(['appointment_babies','clinical_encounter_babies']);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function recordOwnedByUser(db, table, entry, userId, depth = 0) {
  if (!entry || !userId || depth > 5) return false;
  const row = entry.record || {};
  if (entry.ownerId) return String(entry.ownerId) === String(userId);
  if (row.owner_id) return String(row.owner_id) === String(userId);
  if (row.user_id) return String(row.user_id) === String(userId);
  if (table === 'professional_profiles' && String(row.id || '') === String(userId)) return true;
  const refs = [
    ['mother_id','mothers'], ['baby_id','babies'], ['appointment_id','appointments'],
    ['encounter_id','clinical_encounters'], ['care_package_id','care_packages'], ['package_id','care_packages'],
  ];
  for (const [field, refTable] of refs) {
    if (!row[field]) continue;
    const parent = await recordById(db, refTable, row[field]);
    if (parent && await recordOwnedByUser(db, refTable, parent, userId, depth + 1)) return true;
  }
  return GLOBAL_READ_TABLES.has(table);
}

async function relationalOwnerValid(db, table, row, userId) {
  if (!RELATIONAL_OWNER_TABLES.has(table)) return true;
  const refs = [
    ['mother_id','mothers'], ['baby_id','babies'], ['appointment_id','appointments'],
    ['encounter_id','clinical_encounters'], ['care_package_id','care_packages'], ['package_id','care_packages'],
  ];
  let sawReference = false;
  for (const [field, refTable] of refs) {
    if (!row[field]) continue;
    sawReference = true;
    const parent = await recordById(db, refTable, row[field]);
    if (!parent || !await recordOwnedByUser(db, refTable, parent, userId)) return false;
  }
  return sawReference || Boolean(row.owner_id && String(row.owner_id) === String(userId));
}

async function ensureWriteOwnership(db, table, row, user) {
  if (!user?.id) return false;
  if (row.owner_id && String(row.owner_id) !== String(user.id)) return false;
  if (RELATIONAL_OWNER_TABLES.has(table) && !await relationalOwnerValid(db, table, row, user.id)) return false;
  if (OWNER_TABLES.has(table)) {
    row.owner_id = user.id;
    return true;
  }
  if (row.owner_id) return String(row.owner_id) === String(user.id);
  if (row.user_id) return String(row.user_id) === String(user.id);
  return recordOwnedByUser(db, table, { key: row.id || '', ownerId: null, record: row }, user.id);
}

async function scopedRows(db, table, userId) {
  if (!OWNER_TABLES.has(table)) return unownedRows(db, table);
  const ownedRows = await ownerRows(db, table, userId);
  const legacyRows = await unownedRows(db, table);
  const accepted = [];
  for (const entry of legacyRows) {
    if (await recordOwnedByUser(db, table, entry, userId)) accepted.push(entry);
  }
  return [...ownedRows, ...accepted];
}

function recordKey(table, row) {
  if (row.id) return String(row.id);
  if (table === 'appointment_babies') return `${row.appointment_id || ''}|${row.baby_id || ''}`;
  if (table === 'clinical_encounter_babies') return `${row.encounter_id || ''}|${row.baby_id || ''}`;
  if (table === 'consents') return `${row.owner_id || ''}|${row.mother_id || ''}|${row.consent_type || ''}`;
  return crypto.randomUUID();
}

function recordStatement(db, table, key, row, now) {
  return guardedRecordStatement(db, table, key, row, row.owner_id, now);
}

async function licenseCall(env, body) {
  if (!env.ARTISYS_LICENSING || !env.LICENSE_SERVICE_SECRET) return null;
  const response = await env.ARTISYS_LICENSING.fetch(new Request('https://artisys-licensing.internal/api/internal/product-license', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-artisys-license-secret': env.LICENSE_SERVICE_SECRET,
    },
    body: JSON.stringify(body),
  }));
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function patientAllowance(env, db, user) {
  const access = await licenseCall(env, { action: 'resolve', productCode: 'debora-lactacao', email: user.email });
  if (!access?.commercial || !Number.isInteger(access.patientLimit)) return null;
  const count = (await ownerRows(db, 'mothers', user.id)).length;
  return { limit: Number(access.patientLimit), count };
}

export function mergeUpsertRecord(existingRecord, incoming, existingKey, now) {
  return {
    ...(existingRecord || {}),
    ...(incoming || {}),
    id: incoming?.id || existingRecord?.id || existingKey,
    created_at: incoming?.created_at || existingRecord?.created_at || now,
    updated_at: now,
  };
}

export async function handleCloudflareUpsertRuntime(request, env, url = new URL(request.url), deps = {}) {
  if (request.method !== 'POST' || !url.pathname.startsWith('/api/clinical/records/')) return null;
  if (!url.searchParams.get('on_conflict')) return null;
  if (!env.CLINICAL_DB) return json(503, { error: 'cloudflare_d1_required' });

  const table = decodeURIComponent(url.pathname.slice('/api/clinical/records/'.length).split('/')[0] || '');
  if (!/^[A-Za-z0-9_]+$/.test(table)) return json(400, { error: 'invalid_table' });

  const authenticate = deps.authenticate || authenticateClinicalRequest;
  const user = await authenticate(request, env);
  if (!user?.id) return json(401, { error: 'cloudflare_auth_required' });

  const input = await request.json().catch(() => null);
  if (!input || typeof input !== 'object') return json(400, { error: 'invalid_payload' });
  const list = Array.isArray(input) ? input : [input];
  const conflictFields = String(url.searchParams.get('on_conflict') || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  if (!conflictFields.length) return null;

  const db = env.CLINICAL_DB;
  const existingRows = await scopedRows(db, table, user.id);
  const now = deps.now || new Date().toISOString();
  const uuid = deps.uuid || (() => crypto.randomUUID());
  const ignoreDuplicates = /resolution=ignore-duplicates/i.test(request.headers.get('prefer') || '');
  const saved = [];
  const statements = [];
  const patientAllowanceState = table === 'mothers' ? await patientAllowance(env, db, user) : null;
  let pendingNewMothers = 0;

  for (const source of list) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return json(400, { error: 'invalid_payload' });
    const incoming = { ...source };
    if (OWNER_TABLES.has(table) && !incoming.owner_id && !RELATIONAL_OWNER_TABLES.has(table)) incoming.owner_id = user.id;
    if (conflictFields.some((field) => incoming[field] === undefined)) {
      return json(400, { error: 'conflict_field_missing', fields: conflictFields });
    }

    const existing = existingRows.find((entry) => conflictFields.every(
      (field) => String(entry.record?.[field] ?? '') === String(incoming[field] ?? ''),
    ));

    if (existing) {
      if (!await recordOwnedByUser(db, table, existing, user.id)) {
        return json(403, { error: 'record_outside_account' });
      }
      if (ignoreDuplicates) {
        saved.push(existing.record);
        continue;
      }
      const row = mergeUpsertRecord(existing.record, incoming, existing.key, now);
      if (!await ensureWriteOwnership(db, table, row, user)) return json(403, { error: 'record_outside_account' });
      statements.push(recordStatement(db, table, existing.key, row, now));
      saved.push(row);
      continue;
    }

    if (patientAllowanceState && patientAllowanceState.count + pendingNewMothers >= patientAllowanceState.limit) {
      return json(403, { error: 'SAAS_PATIENT_LIMIT_REACHED', limit: patientAllowanceState.limit });
    }

    const row = {
      ...incoming,
      ...(!NO_ID_TABLES.has(table) && !incoming.id ? { id: uuid() } : {}),
      created_at: incoming.created_at || now,
      updated_at: now,
    };
    if (!await ensureWriteOwnership(db, table, row, user)) return json(403, { error: 'record_outside_account' });
    const key = recordKey(table, row);
    const collision = await recordByKey(db, table, key);
    if (collision && String(collision.ownerId || collision.record?.owner_id || '') !== String(user.id)) {
      return json(409, { error: 'record_key_conflict' });
    }
    statements.push(recordStatement(db, table, key, row, now));
    saved.push(row);
    if (table === 'mothers') pendingNewMothers++;
  }

  if (statements.length) await db.batch(statements);
  return json(201, saved);
}
