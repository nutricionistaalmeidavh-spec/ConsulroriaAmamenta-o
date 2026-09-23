import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { recordById } from './d1-record-store.js';

const RELATIONAL_TABLES = new Set([
  'babies','appointments','clinical_encounters','appointment_babies','clinical_encounter_babies',
  'weights','growth_measurements','clinical_encounter_addenda','clinical_note_revisions',
  'care_package_items','care_package_sessions','care_package_item_usages',
]);

const REFERENCES = [
  ['mother_id','mothers'], ['baby_id','babies'], ['appointment_id','appointments'],
  ['encounter_id','clinical_encounters'], ['care_package_id','care_packages'], ['package_id','care_packages'],
];

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function entryOwnedByUser(db, table, entry, userId, depth = 0) {
  if (!entry || !userId || depth > 5) return false;
  const row = entry.record || {};
  const directOwner = entry.ownerId || row.owner_id || row.user_id || null;
  if (directOwner) return String(directOwner) === String(userId);
  if (table === 'professional_profiles' && String(row.id || '') === String(userId)) return true;
  for (const [field, refTable] of REFERENCES) {
    if (!row[field]) continue;
    const parent = await recordById(db, refTable, row[field]);
    if (parent && await entryOwnedByUser(db, refTable, parent, userId, depth + 1)) return true;
  }
  return false;
}

async function validateRow(db, row, userId, { allowNoReferences = false } = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  if (row.owner_id && String(row.owner_id) !== String(userId)) return false;
  if (row.user_id && String(row.user_id) !== String(userId)) return false;

  const parents = new Map();
  let sawReference = false;
  for (const [field, table] of REFERENCES) {
    if (!row[field]) continue;
    sawReference = true;
    const parent = await recordById(db, table, row[field]);
    if (!parent || !await entryOwnedByUser(db, table, parent, userId)) return false;
    parents.set(field, parent.record || {});
  }
  if (!sawReference) {
    return allowNoReferences || Boolean(row.owner_id && String(row.owner_id) === String(userId));
  }

  const motherId = row.mother_id ? String(row.mother_id) : '';
  const babyMotherId = parents.get('baby_id')?.mother_id ? String(parents.get('baby_id').mother_id) : '';
  const appointmentMotherId = parents.get('appointment_id')?.mother_id ? String(parents.get('appointment_id').mother_id) : '';
  const encounterMotherId = parents.get('encounter_id')?.mother_id ? String(parents.get('encounter_id').mother_id) : '';

  if (motherId && babyMotherId && motherId !== babyMotherId) return false;
  if (motherId && appointmentMotherId && motherId !== appointmentMotherId) return false;
  if (motherId && encounterMotherId && motherId !== encounterMotherId) return false;
  if (babyMotherId && appointmentMotherId && babyMotherId !== appointmentMotherId) return false;
  if (babyMotherId && encounterMotherId && babyMotherId !== encounterMotherId) return false;
  return true;
}

export async function handleCloudflareRelationGuard(request, env, url = new URL(request.url)) {
  if (!env.CLINICAL_DB || !url.pathname.startsWith('/api/clinical/records/')) return null;
  if (!['POST', 'PATCH'].includes(request.method)) return null;
  const table = decodeURIComponent(url.pathname.slice('/api/clinical/records/'.length).split('/')[0] || '');
  if (!RELATIONAL_TABLES.has(table)) return null;

  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return json(401, { error: 'cloudflare_auth_required' });
  const input = await request.clone().json().catch(() => null);
  if (!input || typeof input !== 'object') return json(400, { error: 'invalid_payload' });
  const rows = Array.isArray(input) ? input : [input];
  for (const row of rows) {
    if (!await validateRow(env.CLINICAL_DB, row, user.id, { allowNoReferences: request.method === 'PATCH' })) {
      return json(403, { error: 'record_outside_account' });
    }
  }
  return null;
}
