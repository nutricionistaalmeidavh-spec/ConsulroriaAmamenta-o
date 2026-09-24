const GLOBAL_READ_TABLES = new Set([
  'billing_plan_catalog',
  'clinical_document_templates',
  'document_templates',
  'portal_content',
  'member_perks',
]);

const OWNER_TABLES = new Set([
  'mothers','babies','appointments','clinical_encounters','weights','growth_measurements',
  'followups','financial_entries','consents','library_items','media','clinical_media',
  'clinical_documents','clinical_encounter_addenda','clinical_note_revisions',
  'care_packages','care_package_items','care_package_sessions','care_package_item_usages',
  'professional_profiles','saas_accounts','subscriptions','entitlements',
  'billing_checkout_requests','billing_webhook_events','member_content_unlocks',
  'member_engagement_events','member_portal_access','member_shared_items',
  'appointment_babies','clinical_encounter_babies',
]);

const KNOWN_RECORD_TABLES = new Set([...GLOBAL_READ_TABLES, ...OWNER_TABLES]);

// These entities already have domain-specific write paths. The generic records
// adapter remains available for reads, but it must not become a second mutation
// surface that bypasses idempotency, relationship, retention or concurrency rules.
const DOMAIN_MANAGED_WRITE_TABLES = new Set([
  'clinical_encounters',
  'clinical_note_revisions',
  'growth_measurements',
  'care_packages',
  'care_package_items',
  'care_package_sessions',
  'care_package_item_usages',
  'appointment_babies',
  'clinical_encounter_babies',
]);

// Encounter PATCH/DELETE and revision PATCH/DELETE use the records-shaped URL,
// but are intercepted by the dedicated versioning/retention runtime before the
// generic fallback. Let only those methods continue to that specialized handler.
const SPECIALIZED_RECORD_METHODS = new Map([
  ['clinical_encounters', new Set(['PATCH', 'DELETE'])],
  ['clinical_note_revisions', new Set(['PATCH', 'DELETE'])],
]);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function handleGenericCrudPolicy(request, url = new URL(request.url)) {
  if (!url.pathname.startsWith('/api/clinical/records/')) return null;

  const relative = url.pathname.slice('/api/clinical/records/'.length);
  const table = decodeURIComponent(relative.split('/')[0] || '');
  if (!/^[A-Za-z0-9_]+$/.test(table)) {
    return json(400, { error: 'clinical_table_invalid', message: 'Tabela inválida.' });
  }
  if (!KNOWN_RECORD_TABLES.has(table)) {
    return json(404, { error: 'clinical_table_not_allowed', table });
  }

  if (request.method === 'GET' || request.method === 'HEAD') return null;
  if (SPECIALIZED_RECORD_METHODS.get(table)?.has(request.method)) return null;

  if (GLOBAL_READ_TABLES.has(table) || DOMAIN_MANAGED_WRITE_TABLES.has(table)) {
    return json(405, {
      error: 'generic_mutation_not_allowed',
      table,
      message: 'Esta entidade deve ser alterada pelo fluxo clínico canônico.',
    });
  }

  return null;
}

export const genericCrudPolicy = Object.freeze({
  knownTables: [...KNOWN_RECORD_TABLES],
  domainManagedWriteTables: [...DOMAIN_MANAGED_WRITE_TABLES],
});
