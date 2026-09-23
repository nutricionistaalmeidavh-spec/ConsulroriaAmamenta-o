import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildNewPatientRecords, persistNewPatient } from '../worker/patient-write-runtime.js';
import { handleCloudflareClinicalRuntime } from '../worker/cloudflare-clinical-runtime.js';

class FakeStatement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) { return new FakeStatement(this.db, this.sql, args); }
  async first() { return this.db.first(this.sql, this.args); }
  async all() { return this.db.all(this.sql, this.args); }
  async run() { return this.db.run(this.sql, this.args); }
}

class FakeD1 {
  constructor() {
    this.records = new Map();
    this.authUsers = new Map();
    this.batchCalls = 0;
    this.failBatchAt = 0;
  }
  prepare(sql) { return new FakeStatement(this, sql, []); }
  async first(sql, args) {
    if (/SELECT \* FROM auth_users WHERE user_id = \? LIMIT 1/i.test(sql)) {
      return this.authUsers.get(String(args[0])) || null;
    }
    if (/SELECT COUNT\(\*\) AS n FROM supabase_records WHERE table_name = 'mothers' AND owner_id = \?/i.test(sql)) {
      const userId = String(args[0]);
      let n = 0;
      for (const entry of this.records.values()) if (entry.table === 'mothers' && String(entry.ownerId || '') === userId) n++;
      return { n };
    }
    throw new Error(`unexpected first SQL: ${sql}`);
  }
  async all(sql, args) {
    if (/SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = \?/i.test(sql)) {
      const table = String(args[0]);
      const ownerEq = /AND owner_id = \?/i.test(sql);
      const ownerNull = /AND owner_id IS NULL/i.test(sql);
      const ownerId = ownerEq ? String(args[1]) : null;
      return {
        results: [...this.records.values()]
          .filter((entry) => entry.table === table)
          .filter((entry) => !ownerEq || String(entry.ownerId || '') === ownerId)
          .filter((entry) => !ownerNull || entry.ownerId == null)
          .map((entry) => ({ record_key: entry.key, owner_id: entry.ownerId, record_json: JSON.stringify(entry.record) })),
      };
    }
    throw new Error(`unexpected all SQL: ${sql}`);
  }
  async run(sql, args) {
    if (/INSERT INTO supabase_records/i.test(sql)) {
      const [table, key, ownerId, recordJson] = args;
      this.records.set(`${table}:${key}`, { table, key, ownerId: ownerId || null, record: JSON.parse(recordJson) });
      return { success: true };
    }
    throw new Error(`unexpected run SQL: ${sql}`);
  }
  async batch(statements) {
    this.batchCalls++;
    const snapshot = new Map(this.records);
    try {
      const results = [];
      for (let index = 0; index < statements.length; index++) {
        if (this.failBatchAt && index + 1 === this.failBatchAt) throw new Error('forced_batch_failure');
        results.push(await statements[index].run());
      }
      return results;
    } catch (error) {
      this.records = snapshot;
      throw error;
    }
  }
}

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function accessToken({ userId, email, secret }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64url(Buffer.from(JSON.stringify({ typ: 'access', sub: userId, email, iat: now, exp: now + 3600 })));
  const data = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(signature))}`;
}

function authRow(userId, email) {
  const now = new Date().toISOString();
  return {
    user_id: userId,
    email,
    phone: null,
    email_confirmed_at: now,
    phone_confirmed_at: null,
    created_at: now,
    updated_at: now,
    last_sign_in_at: now,
    user_metadata_json: '{}',
    app_metadata_json: '{}',
  };
}

function deterministicUuid() {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;
}

test('new patient creation always generates fresh mother and baby ids', () => {
  const records = buildNewPatientRecords(
    {
      mother: { id: 'legacy-or-colliding-mother-id', name: 'Paciente Nova' },
      babies: [{ id: 'legacy-or-colliding-baby-id', name: 'Bebê Novo' }],
      consents: {},
    },
    { id: 'user-new', email: 'new@example.test' },
    { now: '2026-09-22T15:00:00.000Z', uuid: deterministicUuid() },
  );
  assert.equal(records.mother.id, '00000000-0000-4000-8000-000000000001');
  assert.equal(records.babies[0].id, '00000000-0000-4000-8000-000000000002');
  assert.equal(records.babies[0].mother_id, records.mother.id);
});

test('new patient is written in one batch and remains visible after a runtime reload', async () => {
  const db = new FakeD1();
  const user = { id: 'user-1', email: 'debora@example.test' };
  const secret = 'patient-save-test-secret';
  db.authUsers.set(user.id, authRow(user.id, user.email));

  const saved = await persistNewPatient(
    { CLINICAL_DB: db },
    user,
    {
      mother: { name: 'Paciente Nova', phone: '16999999999' },
      babies: [
        { name: 'Bebê Um', birth_date: '2026-08-01' },
        { name: 'Bebê Dois', birth_date: '2026-08-02' },
      ],
      consents: { data_processing: true, whatsapp: false },
    },
    {
      resolveProductAccess: async () => ({ commercial: false, patientLimit: null }),
      now: '2026-09-22T15:00:00.000Z',
      uuid: deterministicUuid(),
    },
  );

  assert.equal(db.batchCalls, 1, 'mother, babies and consents must share one D1 batch');
  assert.equal(saved.mother.owner_id, user.id);
  assert.equal(saved.babies.length, 2);
  assert.equal(saved.consents.length, 2);
  assert.equal(db.records.size, 5);

  const token = await accessToken({ userId: user.id, email: user.email, secret });
  const env = { CLINICAL_DB: db, CLINICAL_AUTH_SECRET: secret };
  const headers = { authorization: `Bearer ${token}` };

  const mothersResponse = await handleCloudflareClinicalRuntime(
    new Request('https://app.test/api/clinical/records/mothers?select=*&order=created_at.desc', { headers }), env,
  );
  const babiesResponse = await handleCloudflareClinicalRuntime(
    new Request('https://app.test/api/clinical/records/babies?select=*&order=created_at.asc', { headers }), env,
  );

  assert.equal(mothersResponse.status, 200);
  assert.equal(babiesResponse.status, 200);
  const mothers = await mothersResponse.json();
  const babies = await babiesResponse.json();
  assert.equal(mothers.length, 1);
  assert.equal(mothers[0].id, saved.mother.id);
  assert.equal(mothers[0].name, 'Paciente Nova');
  assert.equal(babies.length, 2);
  assert.ok(babies.every((baby) => baby.mother_id === saved.mother.id));
});

test('patient limit blocks the batch before any clinical row is created', async () => {
  const db = new FakeD1();
  const user = { id: 'user-limit', email: 'free@example.test' };
  for (let index = 1; index <= 3; index++) {
    db.records.set(`mothers:existing-${index}`, {
      table: 'mothers', key: `existing-${index}`, ownerId: user.id,
      record: { id: `existing-${index}`, owner_id: user.id, name: `Paciente ${index}` },
    });
  }

  await assert.rejects(
    persistNewPatient(
      { CLINICAL_DB: db }, user,
      { mother: { name: 'Quarta paciente' }, babies: [{ name: 'Bebê' }], consents: {} },
      { resolveProductAccess: async () => ({ commercial: true, patientLimit: 3 }) },
    ),
    (error) => error?.code === 'SAAS_PATIENT_LIMIT_REACHED' && error?.status === 403,
  );
  assert.equal(db.batchCalls, 0);
  assert.equal(db.records.size, 3);
});

test('a failed D1 batch leaves no partial patient behind', async () => {
  const db = new FakeD1();
  db.failBatchAt = 2;
  const user = { id: 'user-rollback', email: 'rollback@example.test' };

  await assert.rejects(
    persistNewPatient(
      { CLINICAL_DB: db }, user,
      { mother: { name: 'Paciente rollback' }, babies: [{ name: 'Bebê rollback' }], consents: { data_processing: true } },
      { resolveProductAccess: async () => ({ commercial: false }), uuid: deterministicUuid() },
    ),
    /forced_batch_failure/,
  );
  assert.equal(db.batchCalls, 1);
  assert.equal(db.records.size, 0);
});

test('clinical materializer wires new-patient submit to the atomic endpoint', async () => {
  const source = await readFile(new URL('../scripts/materialize-clinical-source.mjs', import.meta.url), 'utf8');
  assert.match(source, /atomic-patient-create/);
  assert.match(source, /workerRequest\('\/api\/clinical\/patients'/);
  assert.match(source, /body:\s*\{ \.\.\.payload, consents \}/);
});
