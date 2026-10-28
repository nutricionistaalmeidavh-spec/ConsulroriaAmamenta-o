import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime } from './helpers/cloudflare-local.mjs';
import { buildNewPatientRecords } from '../worker/patient-write-runtime.js';

let runtime, token;
before(async () => { runtime = await createLocalRuntime(); token = (await runtime.login()).access_token; });
after(async () => { await runtime?.close(); });

async function write(method, body, key, bearer = token) {
  const response = await runtime.mf.dispatchFetch('http://localhost/api/clinical/patients', {
    method, headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}
async function records(table) {
  const response = await runtime.mf.dispatchFetch(`http://localhost/api/clinical/records/${table}?select=*`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('mother can be built without a fabricated baby and with durable canonical ID', () => {
  let counter = 0;
  const output = buildNewPatientRecords(
    { mother: { name: 'Gestante sem bebê' }, babies: [], consents: { data_processing: true } },
    { id: 'owner-prenatal' },
    { uuid: () => `safe-id-${++counter}`, now: '2026-10-28T10:00:00.000Z' }
  );
  assert.equal(output.mother.id, 'safe-id-1');
  assert.deepEqual(output.babies, []);
  assert.equal(output.consents[0].mother_id, output.mother.id);
});

test('POST mother alone and PATCH baby later preserve history and avoid duplicate creation on retry', async () => {
  const create = await write('POST', {
    mother: { name: 'Mãe apenas', phone: '1600000000' }, babies: [],
    consents: { data_processing: true, whatsapp: false }
  }, 'mother-only-create-1');
  assert.equal(create.status, 201);
  assert.equal(create.body.babies.length, 0);
  assert.ok(create.body.mother.id);

  const replay = await write('POST', { mother: { name: 'Mãe apenas', phone: '1600000000' }, babies: [], consents: { data_processing: true, whatsapp: false } }, 'mother-only-create-1');
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.body.mother, create.body.mother);

  const beforeBabies = await records('babies');
  assert.equal(beforeBabies.some(x => x.mother_id === create.body.mother.id), false);

  const added = await write('PATCH', {
    mother: { id: create.body.mother.id, name: 'Mãe apenas' },
    babies: [{ name: 'Bebê após o parto', birth_date: '2026-10-28' }]
  }, 'mother-only-baby-later-1');
  assert.equal(added.status, 200);
  assert.equal(added.body.mother.id, create.body.mother.id);
  assert.equal(added.body.babies.length, 1);
  assert.equal(added.body.babies[0].mother_id, create.body.mother.id);

  const again = await write('PATCH', { mother: { id: create.body.mother.id, name: 'Mãe apenas' }, babies: [{ name: 'Bebê após o parto', birth_date: '2026-10-28' }] }, 'mother-only-baby-later-1');
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.babies, added.body.babies);
  assert.equal((await records('babies')).filter(x => x.mother_id === create.body.mother.id).length, 1);

  const twin = await write('PATCH', { mother: { id: create.body.mother.id }, babies: [{ name: 'Irmão gêmeo' }] }, 'mother-only-second-baby-1');
  assert.equal(twin.status, 200);
  assert.equal(twin.body.babies.length, 2);
  assert.ok(twin.body.babies.every(x => x.mother_id === create.body.mother.id));
  assert.equal((await records('mothers')).filter(x => x.id === create.body.mother.id).length, 1);
});

test('app materialized source supports mother-only UI and does not remove baby requirements from postpartum', () => {
  const html = readFileSync('public/clinical-source/index.html', 'utf8');
  const shell = readFileSync('public/clinical-source/core/app-shell.js', 'utf8');
  assert.match(html, /data-action="patient-add-baby"/);
  assert.match(html, /data-babies-editor/);
  assert.match(shell, /renderBabyEditors\(babies = \[\]\)/);
  assert.match(shell, /const list = babies \|\| \[\]/);
  assert.match(shell, /patient-add-baby/);
  assert.match(shell, /if \(!selectedBabies\.length && !isPrenatalAppointment\(\)\)/);
  assert.match(shell, /babies.length \? [^\n]+ : 'Nenhum bebê cadastrado'/);
});
