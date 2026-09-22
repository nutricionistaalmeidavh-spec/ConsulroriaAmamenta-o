import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import {
  DEMO_EMAIL,
  DEMO_USER_ID,
  DEMO_PASSWORD_ITERATIONS,
  buildDemoFixture,
  deriveDemoCredential,
} from '../scripts/demo-account-fixture.mjs';

const TEST_PASSWORD = 'fixture-only-not-user-credential-2026!';

test('demo identity is stable and presentation-specific', () => {
  assert.equal(DEMO_EMAIL, 'demonstracao@deboralactacao.com');
  assert.match(DEMO_USER_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('demo credential uses the 100k PBKDF2-SHA256 auth contract by default', () => {
  const salt = Buffer.alloc(18, 7);
  const result = deriveDemoCredential(TEST_PASSWORD, { salt });
  const expected = pbkdf2Sync(Buffer.from(TEST_PASSWORD), salt, 100000, 32, 'sha256').toString('base64url');
  assert.equal(DEMO_PASSWORD_ITERATIONS, 100000);
  assert.equal(result.password_salt, salt.toString('base64url'));
  assert.equal(result.password_hash, expected);
  assert.equal(result.password_iterations, 100000);
  assert.equal(result.password_algorithm, 'PBKDF2-SHA256');
});

test('deriveDemoCredential rejects weak demo passwords', () => {
  assert.throws(() => deriveDemoCredential('curta123'), /demo_password_too_short/);
});

test('fixture contains six mothers and seven babies with valid relationships', () => {
  const fixture = buildDemoFixture(new Date('2026-09-22T13:00:00.000Z'));
  const mothers = fixture.records.filter((entry) => entry.table === 'mothers');
  const babies = fixture.records.filter((entry) => entry.table === 'babies');
  assert.equal(mothers.length, 6);
  assert.equal(babies.length, 7);
  const motherIds = new Set(mothers.map((entry) => entry.row.id));
  for (const baby of babies) assert.ok(motherIds.has(baby.row.mother_id), `missing mother for ${baby.row.name}`);
  assert.ok(babies.filter((entry) => entry.row.mother_id === mothers[5].row.id).length === 2, 'sixth mother must have twins');
});

test('every owner-scoped demo row uses the demo owner id', () => {
  const fixture = buildDemoFixture(new Date('2026-09-22T13:00:00.000Z'));
  for (const entry of fixture.records) {
    if ('owner_id' in entry.row) assert.equal(entry.row.owner_id, DEMO_USER_ID, `${entry.table}:${entry.key}`);
  }
});

test('fixture has current, past and future appointments relative to generation time', () => {
  const now = new Date('2026-09-22T13:00:00.000Z');
  const fixture = buildDemoFixture(now);
  const appointments = fixture.records.filter((entry) => entry.table === 'appointments').map((entry) => entry.row);
  assert.ok(appointments.some((row) => row.starts_at.slice(0, 10) === now.toISOString().slice(0, 10)), 'one appointment must be today');
  assert.ok(appointments.some((row) => Date.parse(row.starts_at) < now.getTime()), 'needs past appointment');
  assert.ok(appointments.some((row) => Date.parse(row.starts_at) > now.getTime()), 'needs future appointment');
});

test('fixture includes presentation depth for encounters, growth, followups and finance', () => {
  const fixture = buildDemoFixture(new Date('2026-09-22T13:00:00.000Z'));
  const count = (table) => fixture.records.filter((entry) => entry.table === table).length;
  assert.ok(count('clinical_encounters') >= 3);
  assert.ok(count('weights') >= 9);
  assert.ok(count('followups') >= 4);
  assert.ok(count('financial_entries') >= 5);
  assert.equal(count('saas_accounts'), 1);
  assert.equal(count('professional_profiles'), 1);
  assert.equal(count('subscriptions'), 1);
});
