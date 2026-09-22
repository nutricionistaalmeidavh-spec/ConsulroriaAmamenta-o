import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoFixture, deriveDemoCredential, DEMO_EMAIL, DEMO_USER_ID } from '../scripts/demo-account-fixture.mjs';
import { buildResetSql, buildSeedSql, validateDemoIdentityRows } from '../scripts/demo-account-sql.mjs';

const TEST_PASSWORD = 'fixture-only-not-user-credential-2026!';

test('validateDemoIdentityRows allows first seed when no conflicting identity exists', () => {
  assert.deepEqual(validateDemoIdentityRows([]), { exists: false, row: null });
});

test('validateDemoIdentityRows accepts only the reserved id, email and demo marker', () => {
  const row = { user_id: DEMO_USER_ID, email: DEMO_EMAIL, user_metadata_json: JSON.stringify({ demo: true, purpose: 'commercial-presentation' }) };
  const result = validateDemoIdentityRows([row]);
  assert.equal(result.exists, true);
  assert.equal(result.row, row);
});

test('validateDemoIdentityRows rejects id/email collisions and missing demo marker', () => {
  assert.throws(() => validateDemoIdentityRows([{ user_id: DEMO_USER_ID, email: 'outra@example.com', user_metadata_json: '{"demo":true}' }]), /demo_identity_collision/);
  assert.throws(() => validateDemoIdentityRows([{ user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: DEMO_EMAIL, user_metadata_json: '{"demo":true}' }]), /demo_identity_collision/);
  assert.throws(() => validateDemoIdentityRows([{ user_id: DEMO_USER_ID, email: DEMO_EMAIL, user_metadata_json: '{}' }]), /demo_identity_not_marked/);
  assert.throws(() => validateDemoIdentityRows([
    { user_id: DEMO_USER_ID, email: DEMO_EMAIL, user_metadata_json: '{"demo":true}' },
    { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: DEMO_EMAIL, user_metadata_json: '{"demo":true}' },
  ]), /demo_identity_collision/);
});

test('seed SQL upserts auth, credential and every fixture record under the demo owner', () => {
  const fixture = buildDemoFixture(new Date('2026-09-22T13:00:00.000Z'));
  const credential = deriveDemoCredential(TEST_PASSWORD, { salt: Buffer.alloc(18, 9) });
  const sql = buildSeedSql({ fixture, credential });
  assert.match(sql, /INSERT INTO auth_users/);
  assert.match(sql, /INSERT INTO auth_credentials/);
  assert.match(sql, /ON CONFLICT\(table_name,record_key\) DO UPDATE SET/);
  const insertCount = (sql.match(/INSERT INTO supabase_records/g) || []).length;
  assert.equal(insertCount, fixture.records.length);
  assert.equal((sql.match(new RegExp(DEMO_USER_ID, 'g')) || []).length >= fixture.records.length, true);
  assert.doesNotMatch(sql, /fixture-only-not-user-credential-2026!/);
  assert.doesNotMatch(sql, /BEGIN(?:\s+IMMEDIATE|\s+TRANSACTION)?/i);
  assert.doesNotMatch(sql, /COMMIT/i);
});

test('seed SQL escapes apostrophes inside JSON/text safely', () => {
  const fixture = buildDemoFixture(new Date('2026-09-22T13:00:00.000Z'));
  fixture.records[0].row.business_note = "Clínica D'Ávila";
  const credential = deriveDemoCredential(TEST_PASSWORD, { salt: Buffer.alloc(18, 9) });
  const sql = buildSeedSql({ fixture, credential });
  assert.match(sql, /D''Ávila/);
});

test('reset SQL can delete only sessions and records owned by the reserved demo user', () => {
  const sql = buildResetSql();
  assert.match(sql, new RegExp(`DELETE FROM auth_refresh_sessions WHERE user_id = '${DEMO_USER_ID}'`));
  assert.match(sql, new RegExp(`DELETE FROM supabase_records WHERE owner_id = '${DEMO_USER_ID}'`));
  assert.doesNotMatch(sql, /DELETE FROM auth_users/i);
  assert.doesNotMatch(sql, /DELETE FROM auth_credentials/i);
  assert.doesNotMatch(sql, /BEGIN(?:\s+IMMEDIATE|\s+TRANSACTION)?/i);
  assert.doesNotMatch(sql, /COMMIT/i);
  const unsafeRecordDelete = /DELETE\s+FROM\s+supabase_records\s*;(?![\s\S]*owner_id)/i;
  assert.doesNotMatch(sql, unsafeRecordDelete);
});
