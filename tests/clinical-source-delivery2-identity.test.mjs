import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRuntime, credentials, userId } from './helpers/cloudflare-local.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function seed(db, table, id, record) {
  const now = new Date().toISOString();
  const row = { id, owner_id: userId, ...record };
  await db.prepare(`INSERT INTO supabase_records(
    table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
  ) VALUES(?,?,?,?,?,?,?)`).bind(table, id, userId, JSON.stringify(row), now, now, now).run();
}

test('R06 scheduled encounter keeps one deterministic identity while preserving the UUID contract', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const session = await runtime.login(credentials.email);
  const headers = { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' };

  await seed(runtime.db, 'mothers', 'm1', { name: 'Mãe 1' });
  await seed(runtime.db, 'babies', 'b1', { mother_id: 'm1', name: 'Bebê 1' });
  await seed(runtime.db, 'appointments', 'a1', { mother_id: 'm1', baby_id: 'b1', status: 'Agendado' });
  await seed(runtime.db, 'appointment_babies', 'a1|b1', { appointment_id: 'a1', baby_id: 'b1', is_primary: true });

  const start = () => runtime.mf.dispatchFetch('http://localhost/api/clinical/rpc/start_clinical_encounter_from_appointment', {
    method: 'POST', headers, body: JSON.stringify({ p_appointment_id: 'a1' }),
  });
  const first = await start();
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.match(firstBody.encounter_id, UUID);

  const replay = await start();
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(replayBody.encounter_id, firstBody.encounter_id);
});
