import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRuntime } from './helpers/cloudflare-local.mjs';

let runtime, token;
before(async () => { runtime = await createLocalRuntime(); token = (await runtime.login()).access_token; });
after(async () => { await runtime?.close(); });
async function request(method, body, key, accessToken = token) {
  return runtime.mf.dispatchFetch('http://localhost/api/clinical/patients', {
    method, headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body),
  });
}
async function create(accessToken = token) {
  const response = await request('POST', { mother: { name: 'Original', phone: '123' }, babies: [{ name: 'Baby', birth_date: '2026-08-01' }], consents: { whatsapp: true } }, '', accessToken);
  assert.equal(response.status, 201); return response.json();
}
async function stored(table, id) {
  const row = await runtime.db.prepare('SELECT record_json FROM supabase_records WHERE table_name=? AND record_key=?').bind(table, id).first();
  return row && JSON.parse(row.record_json);
}

test('PATCH atomically saves patient aggregate, preserves omitted fields and retries without adding another baby', async () => {
  const patient = await create();
  // Migrated consent record keys need not equal their JSON id.
  await runtime.db.prepare("UPDATE supabase_records SET record_key=? WHERE table_name='consents' AND record_key=?").bind('legacy-consent-key', patient.consents[0].id).run();
  const input = { mother: { id: patient.mother.id, name: 'Changed' }, babies: [{ id: patient.babies[0].id, name: 'Changed baby' }, { name: 'New baby' }], consents: { whatsapp: false, data_processing: true } };
  const response = await request('PATCH', input, 'patient-edit-retry');
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.mother.phone, '123');
  assert.equal(saved.babies[0].birth_date, '2026-08-01');
  assert.equal(saved.babies.length, 2);
  assert.ok(saved.babies[1].id);
  assert.equal((await stored('mothers', patient.mother.id)).name, 'Changed');
  assert.equal((await stored('consents', 'legacy-consent-key')).granted, false);
  assert.equal(await stored('consents', patient.consents[0].id), null);
  const retry = await request('PATCH', input, 'patient-edit-retry');
  assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), saved);
  const partial = await request('PATCH', { mother: { id: patient.mother.id, name: 'Only mother' } });
  const aggregate = await partial.json();
  assert.equal(partial.status, 200);
  assert.equal(aggregate.babies.length, 2);
  assert.deepEqual(aggregate.consents, saved.consents);
});

test('concurrent PATCH retries commit one new baby and replay the same aggregate', async () => {
  const patient = await create();
  const input = { mother: { id: patient.mother.id }, babies: [{ name: 'One additional baby' }] };
  const responses = await Promise.all([request('PATCH', input, 'concurrent-edit'), request('PATCH', input, 'concurrent-edit')]);
  assert.ok(responses.every(response => response.status === 200));
  const [first, second] = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(first, second);
  const row = await runtime.db.prepare("SELECT COUNT(*) AS n FROM supabase_records WHERE table_name='babies' AND json_extract(record_json,'$.mother_id')=?").bind(patient.mother.id).first();
  assert.equal(row.n, 2);
});

test('PATCH rolls back mother, babies and consent together when the last consent write fails', async () => {
  const patient = await create();
  await runtime.db.prepare(`CREATE TRIGGER fail_patient_consent BEFORE UPDATE ON supabase_records WHEN NEW.table_name='consents' BEGIN SELECT RAISE(ABORT, 'forced_consent_failure'); END`).run();
  try {
    const response = await request('PATCH', { mother: { id: patient.mother.id, name: 'Lost' }, babies: [{ id: patient.babies[0].id, name: 'Lost baby' }], consents: { whatsapp: false } }, 'rollback-edit');
    assert.equal(response.status, 500);
    assert.deepEqual(await stored('mothers', patient.mother.id), patient.mother);
    assert.deepEqual(await stored('babies', patient.babies[0].id), patient.babies[0]);
    assert.deepEqual(await stored('consents', patient.consents[0].id), patient.consents[0]);
  } finally { await runtime.db.prepare('DROP TRIGGER fail_patient_consent').run(); }
  assert.equal((await request('PATCH', { mother: { id: patient.mother.id, name: 'Retry worked' } }, 'rollback-edit')).status, 200);
});

test('PATCH rejects foreign patients, unrelated babies and ownership or mother overrides without partial writes', async () => {
  const patient = await create(); const otherPatient = await create();
  const foreign = await create((await runtime.login('other@example.test')).access_token);
  for (const body of [
    { mother: { id: foreign.mother.id, name: 'Hijack' } },
    { mother: { id: patient.mother.id, name: 'Hijack' }, babies: [{ id: foreign.babies[0].id, name: 'Hijack' }] },
    { mother: { id: patient.mother.id, name: 'Hijack' }, babies: [{ id: otherPatient.babies[0].id, name: 'Hijack' }] },
    { mother: { id: patient.mother.id, owner_id: 'audit-other' } },
    { mother: { id: patient.mother.id }, babies: [{ id: patient.babies[0].id, owner_id: 'audit-other' }] },
    { mother: { id: patient.mother.id }, babies: [{ id: patient.babies[0].id, mother_id: otherPatient.mother.id }] },
  ]) {
    const response = await request('PATCH', body); assert.ok([403, 404].includes(response.status), `${response.status}: ${await response.text()}`);
  }
  assert.deepEqual(await stored('mothers', patient.mother.id), patient.mother);
  assert.deepEqual(await stored('babies', otherPatient.babies[0].id), otherPatient.babies[0]);
});
