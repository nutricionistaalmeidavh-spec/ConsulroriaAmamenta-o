import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import {
  guardedRecordStatement,
  ownerRows,
  recordById as storeRecordById,
  recordByIdForOwner,
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
const NO_ID_TABLES = new Set(['appointment_babies','clinical_encounter_babies']);
const RELATIONAL_TABLES = new Set([
  'babies','weights','growth_measurements','clinical_encounter_addenda','clinical_note_revisions',
  'care_package_items','care_package_sessions','care_package_item_usages','appointment_babies','clinical_encounter_babies',
]);
const enc = new TextEncoder();
const dec = new TextDecoder();

export function runtimeJson(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}

function requireDb(env) {
  if (!env.CLINICAL_DB) throw new Error('clinical_db_not_configured');
  return env.CLINICAL_DB;
}

function b64urlBytes(bytes) {
  let binary = '';
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const value of data) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesFromB64url(value) {
  let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

function b64urlText(value) { return b64urlBytes(enc.encode(String(value))); }
function decodeB64urlText(value) { return dec.decode(bytesFromB64url(value)); }

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(String(secret || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign','verify']);
}

async function signFileToken(payload, env) {
  const secret = String(env.CLINICAL_AUTH_SECRET || '');
  if (!secret) throw new Error('clinical_auth_secret_missing');
  const header = b64urlText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64urlText(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return `${data}.${b64urlBytes(signature)}`;
}

async function verifyFileToken(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !env.CLINICAL_AUTH_SECRET) return null;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC', await hmacKey(env.CLINICAL_AUTH_SECRET), bytesFromB64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const payload = JSON.parse(decodeB64urlText(parts[1]));
    if (payload.typ !== 'file' || Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function sha256(value) {
  return b64urlBytes(await crypto.subtle.digest('SHA-256', enc.encode(String(value))));
}

async function allRows(db, table) {
  const result = await db.prepare(
    'SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = ?',
  ).bind(table).all();
  return (result.results || []).map((row) => {
    try { return { key: row.record_key, ownerId: row.owner_id || null, record: JSON.parse(row.record_json) }; }
    catch { return null; }
  }).filter(Boolean);
}

async function recordById(env, table, id, userId = '') {
  if (!id) return null;
  const db = requireDb(env);
  if (userId) {
    const owned = await recordByIdForOwner(db, table, id, userId);
    if (owned) return owned;
  }
  return storeRecordById(db, table, id);
}

async function recordOwnedByUser(env, table, entry, userId, depth = 0) {
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
    const parent = await recordById(env, refTable, row[field], userId);
    if (parent && await recordOwnedByUser(env, refTable, parent, userId, depth + 1)) return true;
  }
  return GLOBAL_READ_TABLES.has(table);
}

async function scopedRows(env, table, userId) {
  const db = requireDb(env);
  if (GLOBAL_READ_TABLES.has(table)) {
    const rows = await allRows(db, table);
    return rows.filter((entry) => !entry.ownerId || String(entry.ownerId) === String(userId));
  }
  if (OWNER_TABLES.has(table)) {
    const direct = await ownerRows(db, table, userId);
    const legacy = await unownedRows(db, table);
    const accepted = [];
    for (const entry of legacy) if (await recordOwnedByUser(env, table, entry, userId)) accepted.push(entry);
    return [...direct, ...accepted];
  }
  const legacy = await unownedRows(db, table);
  const accepted = [];
  for (const entry of legacy) if (await recordOwnedByUser(env, table, entry, userId)) accepted.push(entry);
  return accepted;
}

export async function hasOwnedRecord(env, table, userId) {
  if (!env.CLINICAL_DB || !userId) return false;
  const direct = await ownerRows(env.CLINICAL_DB, table, userId);
  if (direct.length) return true;
  for (const entry of await unownedRows(env.CLINICAL_DB, table)) {
    if (await recordOwnedByUser(env, table, entry, userId)) return true;
  }
  return false;
}

function compareValue(actual, operator, expected) {
  if (operator === 'eq') return String(actual ?? '') === expected;
  if (operator === 'neq') return String(actual ?? '') !== expected;
  if (operator === 'is') return expected === 'null' ? actual == null : String(actual) === expected;
  if (operator === 'not') {
    if (expected === 'is.null') return actual != null;
    return String(actual ?? '') !== expected;
  }
  if (operator === 'in') {
    const values = expected.replace(/^\(|\)$/g, '').split(',').map((item) => decodeURIComponent(item.trim().replace(/^"|"$/g, '')));
    return values.includes(String(actual ?? ''));
  }
  if (operator === 'like' || operator === 'ilike') {
    const pattern = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
    return new RegExp(`^${pattern}$`, operator === 'ilike' ? 'i' : '').test(String(actual ?? ''));
  }
  const aNum = Number(actual), eNum = Number(expected);
  const numeric = Number.isFinite(aNum) && Number.isFinite(eNum);
  const a = numeric ? aNum : String(actual ?? ''), e = numeric ? eNum : expected;
  if (operator === 'gt') return a > e;
  if (operator === 'gte') return a >= e;
  if (operator === 'lt') return a < e;
  if (operator === 'lte') return a <= e;
  return true;
}

function queryMatches(row, url) {
  for (const [field, raw] of url.searchParams.entries()) {
    if (['select','order','limit','offset','on_conflict'].includes(field) || field === 'or') continue;
    const value = String(raw || '');
    let operator = 'eq', expected = value;
    const firstDot = value.indexOf('.');
    if (firstDot > 0) {
      operator = value.slice(0, firstDot);
      expected = value.slice(firstDot + 1);
    }
    if (!compareValue(row?.[field], operator, expected)) return false;
  }
  return true;
}

function sortRows(rows, orderSpec) {
  if (!orderSpec) return rows;
  const clauses = String(orderSpec).split(',').map((part) => {
    const [field, direction = 'asc'] = part.split('.');
    return { field, direction };
  });
  return rows.sort((a, b) => {
    for (const { field, direction } of clauses) {
      const av = a?.[field], bv = b?.[field];
      if (av == null && bv == null) continue;
      if (av == null) return direction === 'desc' ? 1 : -1;
      if (bv == null) return direction === 'desc' ? -1 : 1;
      const result = String(av).localeCompare(String(bv), undefined, { numeric: true });
      if (result) return direction === 'desc' ? -result : result;
    }
    return 0;
  });
}

function projectRow(row, select) {
  const value = String(select || '*');
  if (!value || value === '*' || value.includes('(')) return row;
  const fields = value.split(',').map((item) => item.trim()).filter(Boolean);
  const out = {};
  for (const field of fields) if (field in row) out[field] = row[field];
  return out;
}

async function recordKey(table, row) {
  if (row.id) return String(row.id);
  if (table === 'appointment_babies') return `${row.appointment_id || ''}|${row.baby_id || ''}`;
  if (table === 'clinical_encounter_babies') return `${row.encounter_id || ''}|${row.baby_id || ''}`;
  if (table === 'consents') return `${row.owner_id || ''}|${row.mother_id || ''}|${row.consent_type || ''}`;
  return sha256(`${table}|${JSON.stringify(row)}`);
}

async function parentOwned(env, row, userId) {
  const refs = [
    ['mother_id','mothers'], ['baby_id','babies'], ['appointment_id','appointments'],
    ['encounter_id','clinical_encounters'], ['care_package_id','care_packages'], ['package_id','care_packages'],
  ];
  let referenced = false;
  for (const [field, table] of refs) {
    if (!row[field]) continue;
    referenced = true;
    const parent = await recordById(env, table, row[field], userId);
    if (parent && await recordOwnedByUser(env, table, parent, userId)) return true;
  }
  return !referenced;
}

async function ensureWriteOwnership(env, table, row, user) {
  if (!user?.id) return false;
  if (row.owner_id && String(row.owner_id) !== String(user.id)) return false;
  if (RELATIONAL_TABLES.has(table) && !await parentOwned(env, row, user.id)) return false;
  if (!GLOBAL_READ_TABLES.has(table)) row.owner_id = user.id;
  if (row.owner_id) return String(row.owner_id) === String(user.id);
  if (row.user_id) return String(row.user_id) === String(user.id);
  return GLOBAL_READ_TABLES.has(table);
}

async function saveEntry(env, table, key, row, userId) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  const ownerId = row.owner_id || userId;
  if (!ownerId) throw new Error('owner_id_required');
  const statement = guardedRecordStatement(db, table, key, row, ownerId, now);
  const result = await statement.run();
  if (result?.meta && Number(result.meta.changes) === 0) throw new Error('record_owner_conflict');
  return row;
}

async function licenseCall(env, body) {
  if (!env.ARTISYS_LICENSING || !env.LICENSE_SERVICE_SECRET) return null;
  const response = await env.ARTISYS_LICENSING.fetch(new Request('https://artisys-licensing.internal/api/internal/product-license', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-artisys-license-secret': env.LICENSE_SERVICE_SECRET },
    body: JSON.stringify(body),
  }));
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function enforcePatientLimit(env, user) {
  const access = await licenseCall(env, { action: 'resolve', productCode: 'debora-lactacao', email: user.email });
  if (!access?.commercial || !Number.isInteger(access.patientLimit)) return null;
  const count = (await scopedRows(env, 'mothers', user.id)).length;
  return count >= Number(access.patientLimit)
    ? runtimeJson(403, { error: 'SAAS_PATIENT_LIMIT_REACHED', limit: access.patientLimit })
    : null;
}

async function enforceMediaAccess(env, user) {
  const access = await licenseCall(env, { action: 'resolve', productCode: 'debora-lactacao', email: user.email });
  return access?.commercial && !access.mediaUpload
    ? runtimeJson(403, { error: 'SAAS_MEDIA_UPLOAD_NOT_ALLOWED' })
    : null;
}

async function handleRecords(request, env, url) {
  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return runtimeJson(401, { error: 'cloudflare_auth_required', message: 'Sessão expirada. Entre novamente.' });
  const relative = url.pathname.slice('/api/clinical/records/'.length);
  const table = decodeURIComponent(relative.split('/')[0] || '');
  if (!/^[A-Za-z0-9_]+$/.test(table)) return runtimeJson(400, { message: 'Tabela inválida.' });

  if (request.method === 'GET' || request.method === 'HEAD') {
    const visible = (await scopedRows(env, table, user.id))
      .filter((entry) => queryMatches(entry.record, url))
      .map((entry) => entry.record);
    const total = visible.length;
    sortRows(visible, url.searchParams.get('order'));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
    const limitParam = url.searchParams.get('limit');
    const limitRaw = limitParam === null ? Number.NaN : Number(limitParam);
    const limit = Number.isFinite(limitRaw) && limitRaw >= 0 ? limitRaw : visible.length;
    const sliced = visible.slice(offset, offset + limit).map((row) => projectRow(row, url.searchParams.get('select')));
    const end = sliced.length ? offset + sliced.length - 1 : offset;
    const headers = { 'content-range': `${offset}-${end}/${total}`, 'range-unit': 'items' };
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return runtimeJson(200, sliced, headers);
  }

  if (request.method === 'POST') {
    if (table === 'mothers') {
      const limited = await enforcePatientLimit(env, user);
      if (limited) return limited;
    }
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== 'object') return runtimeJson(400, { message: 'Payload inválido.' });
    const list = Array.isArray(input) ? input : [input];
    const saved = [];
    const statements = [];
    const currentRows = await scopedRows(env, table, user.id);
    const conflictFields = String(url.searchParams.get('on_conflict') || '').split(',').map((value) => value.trim()).filter(Boolean);
    const now = new Date().toISOString();

    for (const source of list) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) return runtimeJson(400, { message: 'Payload inválido.' });
      let row = { ...source };
      if (!NO_ID_TABLES.has(table) && !row.id) row.id = crypto.randomUUID();
      if (!row.created_at) row.created_at = now;
      row.updated_at = now;
      if (!await ensureWriteOwnership(env, table, row, user)) return runtimeJson(403, { error: 'record_outside_account' });
      let key = await recordKey(table, row);
      if (conflictFields.length) {
        const existing = currentRows.find((entry) => conflictFields.every(
          (field) => String(entry.record?.[field] ?? '') === String(row[field] ?? ''),
        ));
        if (existing) {
          if (!await recordOwnedByUser(env, table, existing, user.id)) return runtimeJson(403, { error: 'record_outside_account' });
          key = existing.key;
          row = { ...existing.record, ...row, id: row.id || existing.record?.id || existing.key, updated_at: now };
        }
      }
      const collision = await recordByKey(requireDb(env), table, key);
      if (collision && String(collision.ownerId || collision.record?.owner_id || '') !== String(user.id)) {
        return runtimeJson(409, { error: 'record_key_conflict' });
      }
      statements.push(guardedRecordStatement(requireDb(env), table, key, row, user.id, now));
      saved.push(row);
    }
    if (statements.length) await requireDb(env).batch(statements);
    return runtimeJson(201, saved);
  }

  if (request.method === 'PATCH') {
    const patch = await request.json().catch(() => null);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return runtimeJson(400, { message: 'Payload inválido.' });
    const changed = [];
    const statements = [];
    const now = new Date().toISOString();
    for (const entry of await scopedRows(env, table, user.id)) {
      if (!queryMatches(entry.record, url)) continue;
      const row = { ...entry.record, ...patch, updated_at: now };
      if (!await ensureWriteOwnership(env, table, row, user)) return runtimeJson(403, { error: 'record_outside_account' });
      statements.push(guardedRecordStatement(requireDb(env), table, entry.key, row, user.id, now));
      changed.push(row);
    }
    if (statements.length) await requireDb(env).batch(statements);
    return runtimeJson(200, changed);
  }

  if (request.method === 'DELETE') {
    const statements = [];
    for (const entry of await scopedRows(env, table, user.id)) {
      if (!queryMatches(entry.record, url)) continue;
      statements.push(requireDb(env).prepare(
        'DELETE FROM supabase_records WHERE table_name = ? AND record_key = ? AND owner_id = ?',
      ).bind(table, entry.key, user.id));
    }
    if (statements.length) await requireDb(env).batch(statements);
    return new Response(null, { status: 204 });
  }

  return runtimeJson(405, { message: 'Método não permitido.' });
}

async function createOwnedRecord(env, table, source, user) {
  const row = { ...source };
  const now = new Date().toISOString();
  if (!NO_ID_TABLES.has(table) && !row.id) row.id = crypto.randomUUID();
  if (!row.created_at) row.created_at = now;
  row.updated_at = now;
  if (!await ensureWriteOwnership(env, table, row, user)) throw new Error('record_ownership_failed');
  const key = await recordKey(table, row);
  const collision = await recordByKey(requireDb(env), table, key);
  if (collision && String(collision.ownerId || collision.record?.owner_id || '') !== String(user.id)) throw new Error('record_key_conflict');
  await saveEntry(env, table, key, row, user.id);
  return row;
}

async function updateOwnedById(env, table, id, patch, user) {
  const entry = await recordById(env, table, id, user.id);
  if (!entry || !await recordOwnedByUser(env, table, entry, user.id)) return null;
  const row = { ...entry.record, ...patch, owner_id: user.id, updated_at: new Date().toISOString() };
  await saveEntry(env, table, entry.key, row, user.id);
  return row;
}

async function handleRpc(request, env, url) {
  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return runtimeJson(401, { error: 'cloudflare_auth_required', message: 'Sessão expirada. Entre novamente.' });
  const name = decodeURIComponent(url.pathname.slice('/api/clinical/rpc/'.length));
  const p = await request.json().catch(() => ({}));

  if (name === 'schedule_clinical_appointment') {
    const appointment = await createOwnedRecord(env, 'appointments', {
      mother_id: p.p_mother_id,
      baby_id: Array.isArray(p.p_baby_ids) && p.p_baby_ids.length === 1 ? p.p_baby_ids[0] : null,
      starts_at: p.p_starts_at,
      duration_min: p.p_duration_min || 60,
      appointment_type: p.p_appointment_type || 'Atendimento',
      format: p.p_format || 'Domiciliar',
      value_cents: Number(p.p_value_cents || 0),
      payment_status: p.p_payment_status || 'Pendente',
      address: p.p_address || '',
      notes: p.p_notes || '',
      status: 'Agendado',
      owner_id: user.id,
    }, user);
    for (const [index, babyId] of (Array.isArray(p.p_baby_ids) ? p.p_baby_ids : []).entries()) {
      await createOwnedRecord(env, 'appointment_babies', {
        appointment_id: appointment.id, baby_id: babyId, is_primary: index === 0, owner_id: user.id,
      }, user);
    }
    return runtimeJson(200, appointment);
  }

  if (name === 'start_clinical_encounter') {
    const appointmentResponse = await handleRpc(new Request(request.url, {
      method: 'POST', headers: request.headers, body: JSON.stringify(p),
    }), env, new URL(`${url.origin}/api/clinical/rpc/schedule_clinical_appointment`));
    const appointment = await appointmentResponse.json();
    await updateOwnedById(env, 'appointments', appointment.id, { status: 'Em atendimento' }, user);
    const encounter = await createOwnedRecord(env, 'clinical_encounters', {
      mother_id: p.p_mother_id,
      baby_id: Array.isArray(p.p_baby_ids) && p.p_baby_ids.length === 1 ? p.p_baby_ids[0] : null,
      appointment_id: appointment.id,
      status: 'draft',
      occurred_at: p.p_starts_at || new Date().toISOString(),
      owner_id: user.id,
    }, user);
    for (const [index, babyId] of (Array.isArray(p.p_baby_ids) ? p.p_baby_ids : []).entries()) {
      await createOwnedRecord(env, 'clinical_encounter_babies', {
        encounter_id: encounter.id, baby_id: babyId, is_primary: index === 0, owner_id: user.id,
      }, user);
    }
    return runtimeJson(200, { appointment_id: appointment.id, encounter_id: encounter.id });
  }

  if (name === 'start_clinical_encounter_from_appointment') {
    const appointment = await recordById(env, 'appointments', p.p_appointment_id, user.id);
    if (!appointment || !await recordOwnedByUser(env, 'appointments', appointment, user.id)) {
      return runtimeJson(404, { message: 'Agendamento não encontrado.' });
    }
    const encounters = await scopedRows(env, 'clinical_encounters', user.id);
    const existing = encounters.find((entry) => entry.record?.appointment_id === p.p_appointment_id && entry.record?.status !== 'cancelled');
    if (existing) return runtimeJson(200, { appointment_id: p.p_appointment_id, encounter_id: existing.record.id });
    const babyLinks = (await scopedRows(env, 'appointment_babies', user.id))
      .filter((entry) => entry.record?.appointment_id === p.p_appointment_id);
    const babyIds = babyLinks.map((entry) => entry.record.baby_id).filter(Boolean);
    const encounter = await createOwnedRecord(env, 'clinical_encounters', {
      mother_id: appointment.record.mother_id,
      baby_id: babyIds.length === 1 ? babyIds[0] : appointment.record.baby_id || null,
      appointment_id: p.p_appointment_id,
      status: 'draft',
      occurred_at: appointment.record.starts_at || new Date().toISOString(),
      owner_id: user.id,
    }, user);
    for (const [index, babyId] of babyIds.entries()) {
      await createOwnedRecord(env, 'clinical_encounter_babies', {
        encounter_id: encounter.id, baby_id: babyId, is_primary: index === 0, owner_id: user.id,
      }, user);
    }
    await updateOwnedById(env, 'appointments', p.p_appointment_id, { status: 'Em atendimento' }, user);
    return runtimeJson(200, { appointment_id: p.p_appointment_id, encounter_id: encounter.id });
  }

  if (name === 'delete_scheduled_appointment') {
    if (String(p.p_confirmation || '') !== 'EXCLUIR') return runtimeJson(400, { message: 'Confirmação inválida.' });
    const appointment = await recordById(env, 'appointments', p.p_appointment_id, user.id);
    if (!appointment || !await recordOwnedByUser(env, 'appointments', appointment, user.id)) {
      return runtimeJson(404, { message: 'Agendamento não encontrado.' });
    }
    const encounter = (await scopedRows(env, 'clinical_encounters', user.id))
      .find((entry) => entry.record?.appointment_id === p.p_appointment_id);
    if (encounter) return runtimeJson(409, { message: 'Agendamento já possui atendimento e não pode ser excluído.' });
    const statements = [];
    for (const entry of await scopedRows(env, 'appointment_babies', user.id)) {
      if (entry.record?.appointment_id === p.p_appointment_id) {
        statements.push(requireDb(env).prepare(
          'DELETE FROM supabase_records WHERE table_name=? AND record_key=? AND owner_id=?',
        ).bind('appointment_babies', entry.key, user.id));
      }
    }
    statements.push(requireDb(env).prepare(
      'DELETE FROM supabase_records WHERE table_name=? AND record_key=? AND owner_id=?',
    ).bind('appointments', appointment.key, user.id));
    await requireDb(env).batch(statements);
    return runtimeJson(200, { deleted: true });
  }

  if (name === 'create_or_supersede_followup') {
    const existing = (await scopedRows(env, 'followups', user.id))
      .find((entry) => entry.record?.encounter_id === p.p_encounter_id && !/conclu/i.test(String(entry.record?.status || '')));
    if (existing) {
      const updated = await updateOwnedById(env, 'followups', existing.record.id, {
        due_at: p.p_due_at, notes: p.p_notes || '', mother_id: p.p_mother_id,
        baby_id: p.p_baby_id || null, status: 'Pendente',
      }, user);
      return runtimeJson(200, updated);
    }
    return runtimeJson(200, await createOwnedRecord(env, 'followups', {
      owner_id: user.id, mother_id: p.p_mother_id, baby_id: p.p_baby_id || null,
      encounter_id: p.p_encounter_id, due_at: p.p_due_at, notes: p.p_notes || '', status: 'Pendente',
    }, user));
  }

  if (name === 'ensure_financial_entry_for_encounter') {
    const existing = (await scopedRows(env, 'financial_entries', user.id))
      .find((entry) => entry.record?.encounter_id === p.p_encounter_id && entry.record?.kind !== 'package');
    if (existing) return runtimeJson(200, existing.record);
    return runtimeJson(200, await createOwnedRecord(env, 'financial_entries', {
      owner_id: user.id, mother_id: p.p_mother_id, appointment_id: p.p_appointment_id || null,
      encounter_id: p.p_encounter_id, description: p.p_description || 'Atendimento',
      amount_cents: Number(p.p_amount_cents || 0), due_at: p.p_due_at || null, status: 'Pendente', paid: false,
    }, user));
  }

  if (name === 'set_financial_payment_state') {
    const row = await updateOwnedById(env, 'financial_entries', p.p_entry_id, {
      paid: Boolean(p.p_paid), status: p.p_paid ? 'Pago' : 'Pendente',
      payment_method: p.p_paid ? (p.p_payment_method || 'Pix') : '',
      paid_at: p.p_paid ? new Date().toISOString() : null,
    }, user);
    return row ? runtimeJson(200, row) : runtimeJson(404, { message: 'Lançamento não encontrado.' });
  }

  if (name === 'set_appointment_billing') {
    const appointment = await recordById(env, 'appointments', p.p_appointment_id, user.id);
    if (!appointment || !await recordOwnedByUser(env, 'appointments', appointment, user.id)) {
      return runtimeJson(404, { message: 'Agendamento não encontrado.' });
    }
    let packageId = p.p_package_id || null;
    if (p.p_billing_mode === 'package_new') {
      const created = await createOwnedRecord(env, 'care_packages', {
        owner_id: user.id, mother_id: appointment.record.mother_id,
        service_label: p.p_service_label || 'Plano', total_cents: Number(p.p_package_total_cents || 0),
        sessions_total: Number(p.p_package_sessions_total || 0), sessions_used: 0,
        status: 'active', payment_method: p.p_payment_method || '',
      }, user);
      packageId = created.id;
    }
    const updated = await updateOwnedById(env, 'appointments', p.p_appointment_id, {
      billing_mode: p.p_billing_mode || 'individual', service_label: p.p_service_label || '',
      value_cents: Number(p.p_value_cents || 0), payment_method: p.p_payment_method || '',
      package_id: packageId,
      package_total_cents: p.p_package_total_cents == null ? null : Number(p.p_package_total_cents),
      package_sessions_total: p.p_package_sessions_total == null ? null : Number(p.p_package_sessions_total),
    }, user);
    return runtimeJson(200, updated);
  }

  if (name === 'finalize_encounter_billing') {
    const appointment = await recordById(env, 'appointments', p.p_appointment_id, user.id);
    if (!appointment || !await recordOwnedByUser(env, 'appointments', appointment, user.id)) {
      return runtimeJson(404, { message: 'Agendamento não encontrado.' });
    }
    const mode = appointment.record.billing_mode || 'individual';
    if (mode === 'package_active' || mode === 'package_new') {
      const packageEntry = await recordById(env, 'care_packages', appointment.record.package_id, user.id);
      if (!packageEntry || !await recordOwnedByUser(env, 'care_packages', packageEntry, user.id)) {
        return runtimeJson(409, { message: 'Plano ativo não encontrado.' });
      }
      const used = Math.min(Number(packageEntry.record.sessions_total || 0), Number(packageEntry.record.sessions_used || 0) + 1);
      const remaining = Math.max(0, Number(packageEntry.record.sessions_total || 0) - used);
      await updateOwnedById(env, 'care_packages', packageEntry.record.id, {
        sessions_used: used, status: remaining > 0 ? 'active' : 'completed',
      }, user);
      await createOwnedRecord(env, 'care_package_sessions', {
        owner_id: user.id, care_package_id: packageEntry.record.id,
        appointment_id: p.p_appointment_id, encounter_id: p.p_encounter_id,
        used_at: new Date().toISOString(),
      }, user);
      return runtimeJson(200, {
        handled: true, billing_mode: mode, package_id: packageEntry.record.id,
        sessions_used: used, sessions_remaining: remaining,
      });
    }
    return runtimeJson(200, {
      handled: false, billing_mode: 'individual', package_id: null, sessions_used: 0, sessions_remaining: 0,
    });
  }

  return runtimeJson(404, { message: `RPC não suportada: ${name}` });
}

function storageKey(bucket, path) {
  // Preserve keys created by the one-time file migration; this is an R2 namespace only.
  return `supabase/${bucket}/${path}`;
}

async function handleFiles(request, env, url) {
  const relative = url.pathname.slice('/api/files/'.length);
  if (relative.startsWith('object/sign/')) {
    const user = await authenticateClinicalRequest(request, env);
    if (!user?.id) return runtimeJson(401, { error: 'cloudflare_auth_required', message: 'Sessão expirada.' });
    const [bucket, ...parts] = relative.slice('object/sign/'.length).split('/');
    const path = parts.map(decodeURIComponent).join('/');
    if (!path.startsWith(`${user.id}/`) || path.includes('..')) return runtimeJson(403, { message: 'Arquivo fora do escopo da conta.' });
    const input = await request.json().catch(() => ({}));
    const ttl = Math.max(60, Math.min(3600, Number(input?.expiresIn || 300)));
    const now = Math.floor(Date.now() / 1000);
    const token = await signFileToken({ typ: 'file', sub: user.id, bucket, path, iat: now, exp: now + ttl }, env);
    const signedURL = `/api/files/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token)}`;
    return runtimeJson(200, { signedURL });
  }

  if (!relative.startsWith('object/')) return runtimeJson(404, { message: 'Files endpoint não encontrado.' });
  const [bucketEncoded, ...pathParts] = relative.slice('object/'.length).split('/');
  const bucket = decodeURIComponent(bucketEncoded || '');
  const path = pathParts.map(decodeURIComponent).join('/');
  if (!bucket || !path || path.includes('..')) return runtimeJson(400, { message: 'Caminho inválido.' });

  if (request.method === 'GET' && url.searchParams.get('token')) {
    const grant = await verifyFileToken(url.searchParams.get('token'), env);
    if (!grant || grant.bucket !== bucket || grant.path !== path) return runtimeJson(403, { message: 'Link expirado ou inválido.' });
    const object = await env.CLINICAL_FILES?.get(storageKey(bucket, path));
    if (!object) return runtimeJson(404, { message: 'Arquivo não encontrado.' });
    const headers = new Headers();
    object.writeHttpMetadata?.(headers);
    if (object.httpEtag) headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'private, max-age=300');
    return new Response(object.body, { status: 200, headers });
  }

  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return runtimeJson(401, { error: 'cloudflare_auth_required', message: 'Sessão expirada.' });
  if (!path.startsWith(`${user.id}/`)) return runtimeJson(403, { message: 'Arquivo fora do escopo da conta.' });
  if (!env.CLINICAL_FILES) return runtimeJson(503, { message: 'R2 não configurado.' });

  if (request.method === 'POST' || request.method === 'PUT') {
    const contentType = request.headers.get('content-type') || 'application/octet-stream';
    if (contentType.startsWith('image/') || contentType.startsWith('video/')) {
      const denied = await enforceMediaAccess(env, user);
      if (denied) return denied;
    }
    const key = storageKey(bucket, path);
    const object = await env.CLINICAL_FILES.put(key, request.body, { httpMetadata: { contentType } });
    await requireDb(env).prepare(`INSERT INTO storage_objects(
      source_bucket,source_path,r2_key,size_bytes,mime_type,source_created_at,source_updated_at,metadata_json,migrated_at
    ) VALUES(?,?,?,?,?,?,?,'{}',CURRENT_TIMESTAMP)
      ON CONFLICT(source_bucket,source_path) DO UPDATE SET
      r2_key=excluded.r2_key,size_bytes=excluded.size_bytes,mime_type=excluded.mime_type,
      source_updated_at=excluded.source_updated_at,migrated_at=CURRENT_TIMESTAMP`)
      .bind(bucket, path, key, object?.size || null, contentType, new Date().toISOString(), new Date().toISOString()).run();
    return runtimeJson(200, { Key: key, path });
  }

  if (request.method === 'DELETE') {
    await env.CLINICAL_FILES.delete(storageKey(bucket, path));
    await requireDb(env).prepare('DELETE FROM storage_objects WHERE source_bucket = ? AND source_path = ?').bind(bucket, path).run();
    return new Response(null, { status: 204 });
  }

  return runtimeJson(405, { message: 'Método não permitido.' });
}

async function handleSpecialApi(request, env, url) {
  if (url.pathname === '/api/clinical/mothers' && request.method === 'POST') {
    const target = new URL(request.url);
    target.pathname = '/api/clinical/records/mothers';
    return handleRecords(new Request(target.toString(), request), env, target);
  }

  if (url.pathname === '/api/clinical/media/upload' && request.method === 'POST') {
    const user = await authenticateClinicalRequest(request, env);
    if (!user?.id) return runtimeJson(401, { error: 'unauthorized' });
    const path = String(url.searchParams.get('path') || '').replace(/^\/+/, '');
    if (!path.startsWith(`${user.id}/`) || path.includes('..')) return runtimeJson(400, { error: 'invalid_storage_path' });
    const target = new URL(request.url);
    target.pathname = `/api/files/object/clinical-media/${path.split('/').map(encodeURIComponent).join('/')}`;
    target.search = '';
    return handleFiles(new Request(target.toString(), { method: 'POST', headers: request.headers, body: request.body }), env, target);
  }

  if (url.pathname === '/api/license/me' && request.method === 'GET') {
    const user = await authenticateClinicalRequest(request, env);
    if (!user?.email) return runtimeJson(401, { error: 'unauthorized' });
    const access = await licenseCall(env, { action: 'resolve', productCode: 'debora-lactacao', email: user.email });
    return access ? runtimeJson(200, access) : runtimeJson(503, { error: 'licensing_unavailable' });
  }

  if (url.pathname === '/api/license/register-commercial') {
    return runtimeJson(404, { error: 'not_found' });
  }

  if (url.pathname === '/api/cloudflare/health' && request.method === 'GET') {
    const db = env.CLINICAL_DB;
    const validated = db ? await db.prepare("SELECT COUNT(*) AS n FROM migration_runs WHERE status='validated'").first() : null;
    const users = db ? await db.prepare('SELECT COUNT(*) AS n FROM auth_users').first() : null;
    const rows = db ? await db.prepare('SELECT COUNT(*) AS n FROM supabase_records').first() : null;
    return runtimeJson(200, {
      ok: Boolean(env.CLINICAL_DB && env.CLINICAL_FILES && env.CLINICAL_AUTH_SECRET),
      backend: 'cloudflare-d1-r2',
      d1: Boolean(env.CLINICAL_DB),
      r2: Boolean(env.CLINICAL_FILES),
      authSecret: Boolean(env.CLINICAL_AUTH_SECRET),
      validatedMigrations: Number(validated?.n || 0),
      authUsers: Number(users?.n || 0),
      records: Number(rows?.n || 0),
      externalClinicalWrites: false,
    });
  }
  return null;
}

export async function handleCloudflareDataRuntime(request, env, url = new URL(request.url)) {
  if (!env.CLINICAL_DB) return null;
  try {
    if (url.pathname.startsWith('/api/clinical/records/')) return await handleRecords(request, env, url);
    if (url.pathname.startsWith('/api/clinical/rpc/') && request.method === 'POST') return await handleRpc(request, env, url);
    if (url.pathname.startsWith('/api/files/')) return await handleFiles(request, env, url);
    if (url.pathname.startsWith('/api/clinical/') || url.pathname.startsWith('/api/license/') || url.pathname === '/api/cloudflare/health') {
      return await handleSpecialApi(request, env, url);
    }
    return null;
  } catch (error) {
    console.error('cloudflare data runtime error', error);
    const status = error?.message === 'record_owner_conflict' ? 409 : 500;
    return runtimeJson(status, { error: error?.message || 'cloudflare_data_runtime_error' });
  }
}
