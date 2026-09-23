import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { hasUnownedRows, queryOwnedRecordPage } from './d1-record-store.js';

const OWNER_PAGED_TABLES = new Set([
  'mothers','babies','appointments','clinical_encounters','weights','growth_measurements',
  'followups','financial_entries','consents','library_items','media','clinical_media',
  'clinical_documents','clinical_encounter_addenda','clinical_note_revisions',
  'care_packages','care_package_items','care_package_sessions','care_package_item_usages',
  'professional_profiles','saas_accounts','subscriptions','entitlements',
  'billing_checkout_requests','billing_webhook_events','member_content_unlocks',
  'member_engagement_events','member_portal_access','member_shared_items',
  'appointment_babies','clinical_encounter_babies',
]);

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function tableFrom(url) {
  if (!url.pathname.startsWith('/api/clinical/records/')) return '';
  return decodeURIComponent(url.pathname.slice('/api/clinical/records/'.length).split('/')[0] || '');
}

function projectRow(row, select) {
  const value = String(select || '*');
  if (!value || value === '*' || value.includes('(')) return row;
  const fields = value.split(',').map((item) => item.trim()).filter(Boolean);
  const out = {};
  for (const field of fields) if (field in row) out[field] = row[field];
  return out;
}

export async function handleClinicalPagedRead(request, env, url = new URL(request.url)) {
  if (!env.CLINICAL_DB || !['GET', 'HEAD'].includes(request.method)) return null;
  const table = tableFrom(url);
  if (!OWNER_PAGED_TABLES.has(table)) return null;

  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return json(401, { error: 'cloudflare_auth_required', message: 'Sessão expirada. Entre novamente.' });

  // Legacy imports may still have physical owner_id=NULL and rely on relationship
  // traversal for ownership. Keep their compatibility path in the generic runtime;
  // current owner-backed rows use the bounded/indexed SQL path below.
  if (await hasUnownedRows(env.CLINICAL_DB, table)) return null;

  const page = await queryOwnedRecordPage(env.CLINICAL_DB, table, user.id, url);
  if (!page) return null;
  const rows = page.entries.map((entry) => projectRow(entry.record, url.searchParams.get('select')));
  const end = rows.length ? page.offset + rows.length - 1 : page.offset;
  const headers = { 'content-range': `${page.offset}-${end}/${page.total}`, 'range-unit': 'items' };
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return json(200, rows, headers);
}
