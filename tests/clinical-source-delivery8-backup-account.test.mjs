import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRuntime } from './helpers/cloudflare-local.mjs';

const TABLES = [
  'mothers','babies','appointments','appointment_babies','clinical_encounters','clinical_encounter_babies',
  'weights','growth_measurements','followups','financial_entries','consents','library_items','media','clinical_media',
  'clinical_document_templates','clinical_documents','clinical_encounter_addenda','clinical_note_revisions',
  'care_packages','care_package_items','care_package_sessions','care_package_item_usages','professional_profiles',
];

test('C02 restore refuses a backup exported by a different account before writing anything', async () => {
  const runtime = await createLocalRuntime();
  try {
    const session = await runtime.login();
    const backup = {
      format: 'debora-lactacao-clinical-account-backup',
      version: 2,
      ownerId: '22222222-2222-4222-8222-222222222222',
      scope: { kind: 'clinical-account', tables: TABLES, files: true },
      tables: Object.fromEntries(TABLES.map((table) => [table, []])),
      files: [],
    };
    const response = await runtime.mf.dispatchFetch('http://localhost/api/clinical/backup/restore', {
      method: 'POST',
      headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify(backup),
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error, 'invalid_clinical_backup');
    assert.match(payload.message, /another account/i);
    const records = await runtime.db.prepare('SELECT COUNT(*) AS n FROM supabase_records').first();
    const storage = await runtime.db.prepare('SELECT COUNT(*) AS n FROM storage_objects').first();
    assert.equal(Number(records.n), 0);
    assert.equal(Number(storage.n), 0);
  } finally {
    await runtime.close();
  }
});
