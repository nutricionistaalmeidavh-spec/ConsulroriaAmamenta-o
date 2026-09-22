import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';

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
  'babies','weights','growth_measurements','clinical_encounter_addenda','clinical_note_revisions',
  'care_package_items','care_package_sessions','care_package_item_usages',
]);
const NO_ID_TABLES = new Set(['appointment_babies','clinical_encounter_babies']);
const UPSERT_RECORD_SQL = `INSERT INTO supabase_records(
  table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
) VALUES(?,?,?,?,?,?,?) ON CONFLICT(table_name,record_key) DO UPDATE SET
  owner_id=excluded.owner_id,record_json=excluded.record_json,source_created_at=excluded.source_created_at,
  source_updated_at=excluded.source_updated_at,migrated_at=excluded.migrated_at`;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function parseRecord(row) {
  if (!row) return null;
  try { return { key: row.record_key, ownerId: row.owner_id || null, record: JSON.parse(row.record_json) }; }
  catch { return null; }
}

async function tableRows(db, table) {
  const result = await db.prepare(
    'SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = ?',
  ).bind(table).all();
  return (result.results || []).map(parseRecord).filter(Boolean);
}

async function recordById(db, table, id) {
  if (!id) return null;
  return (await tableRows(db, table)).find(
    (entry) => String(entry.record?.id || entry.key) === String(id),
  ) || null;
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
    ['encounter_id','clinical_encounters'], ['care_package_id','care_packages'],
  ];
  for (const [field, refTable] of refs) {
    if (!row[field]) continue;
    const parent = await recordById(db, refTable, row[field]);
    if (parent && await recordOwnedByUser(db, refTable, parent, userId, depth + 1)) return true;
  }
  return GLOBAL_READ_TABLES.has(table);
}

async function ensureWriteOwnership(db, table, row, user) {
  if (!user?.id) return false;
  if (row.owner_id && String(row.owner_id) !== String(user.id)) return false;
  if (OWNER_TABLES.has(table) && !row.owner_id && !RELATIONAL_OWNER_TABLES.has(table)) row.owner_id = user.id;
  if (row.owner_id) return String(row.owner_id) === String(user.id);
  if (row.user_id) return String(row.user_id) === String(user.id);
  return recordOwnedByUser(db, table, { key: row.id || '', ownerId: null, record: row }, user.id);
}

function recordKey(table, row) {
  if (row.id) return String(row.id);
  if (table === 'appointment_babies') return `${row.appointment_id || ''}|${row.baby_id || ''}`;
  if (table === 'clinical_encounter_babies') return `${row.encounter_id || ''}|${row.baby_id || ''}`;
  if (table === 'consents') return `${row.owner_id || ''}|${row.mother_id || ''}|${row.consent_type || ''}`;
  return crypto.randomUUID();
}

function recordStatement(db, table, key, row, now) {
  return db.prepare(UPSERT_RECORD_SQL).bind(
    table,
    key,
    row.owner_id || null,
    JSON.stringify(row),
    row.created_at || now,
    row.updated_at || now,
    now,
  );
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

async function patientLimitReached(env, db, user) {
  const access = await licenseCall(env, { action: 'resolve', productCode: 'debora-lactacao', email: user.email });
  if (!access?.commercial || !Number.isInteger(access.patientLimit)) return null;
  let count = 0;
  for (const entry of await tableRows(db, 'mothers')) {
    if (await recordOwnedByUser(db, 'mothers', entry, user.id)) count++;
  }
  return count >= Number(access.patientLimit) ? access.patientLimit : null;
}

export async function handleCloudflareUpsertRuntime(request, env, url = new URL(request.url), deps = {}) {
  if (request.method !== 'POST' || !url.pathname.startsWith('/rest/v1/')) return null;
  if (!url.searchParams.get('on_conflict')) return null;
  if (url.pathname.includes('/rpc/')) return null;
  if (!env.CLINICAL_DB) return json(503, { error: 'cloudflare_d1_required' });

  const table = decodeURIComponent(url.pathname.slice('/rest/v1/'.length).split('/')[0] || '');
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
  const existingRows = await tableRows(db, table);
  const now = deps.now || new Date().toISOString();
  const uuid = deps.uuid || (() => crypto.randomUUID());
  const ignoreDuplicates = /resolution=ignore-duplicates/i.test(request.headers.get('prefer') || '');
  const saved = [];
  const statements = [];

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
      const row = {
        ...existing.record,
        ...incoming,
        id: incoming.id || existing.record?.id || existing.key,
        created_at: incoming.created_at || existing.record?.created_at || now,
        updated_at: now,
      };
      if (!await ensureWriteOwnership(db, table, row, user)) return json(403, { error: 'record_outside_account' });
      statements.push(recordStatement(db, table, existing.key, row, now));
      saved.push(row);
      continue;
    }

    if (table === 'mothers') {
      const limit = await patientLimitReached(env, db, user);
      if (limit !== null) return json(403, { error: 'SAAS_PATIENT_LIMIT_REACHED', limit });
    }

    const row = {
      ...incoming,
      ...(!NO_ID_TABLES.has(table) && !incoming.id ? { id: uuid() } : {}),
      created_at: incoming.created_at || now,
      updated_at: now,
    };
    if (!await ensureWriteOwnership(db, table, row, user)) return json(403, { error: 'record_outside_account' });
    const key = recordKey(table, row);
    statements.push(recordStatement(db, table, key, row, now));
    saved.push(row);
  }

  if (statements.length) await db.batch(statements);
  return json(201, saved);
}
