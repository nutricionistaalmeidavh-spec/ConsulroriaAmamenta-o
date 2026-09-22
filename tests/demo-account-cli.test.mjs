import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_EMAIL, DEMO_USER_ID } from '../scripts/demo-account-fixture.mjs';
import { buildNpxInvocation, buildWranglerQueryArgs, extractD1Rows } from '../scripts/demo-account-d1.mjs';
import { seedDemoAccount } from '../scripts/seed-demo-account.mjs';
import { resetDemoAccount } from '../scripts/reset-demo-account.mjs';

const TEST_PASSWORD = 'fixture-only-not-user-credential-2026!';
const validRow = { user_id: DEMO_USER_ID, email: DEMO_EMAIL, user_metadata_json: '{"demo":true,"purpose":"commercial-presentation"}' };

test('extractD1Rows understands wrangler remote JSON output', () => {
  const output = JSON.stringify([{ results: [validRow], success: true, meta: { served_by: 'miniflare' } }]);
  assert.deepEqual(extractD1Rows(output), [validRow]);
});

test('wrangler query args are pinned to the remote clinical D1', () => {
  const args = buildWranglerQueryArgs('SELECT 1;');
  assert.deepEqual(args.slice(0, 5), ['--yes', 'wrangler@4', 'd1', 'execute', 'debora-lactacao-clinical']);
  assert.ok(args.includes('--remote'));
  const commandIndex = args.indexOf('--command');
  assert.ok(commandIndex >= 0);
  assert.equal(args[commandIndex + 1], 'SELECT 1;');
  assert.ok(args.includes('--json'));
});

test('Windows invokes npx through cmd.exe instead of executing npx.cmd directly', () => {
  const invocation = buildNpxInvocation(['--yes', 'wrangler@4', '--version'], {
    platform: 'win32',
    comspec: 'C:\\Windows\\System32\\cmd.exe',
  });
  assert.equal(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(invocation.args.slice(0, 4), ['/d', '/s', '/c', 'npx']);
  assert.deepEqual(invocation.args.slice(4), ['--yes', 'wrangler@4', '--version']);
});

test('non-Windows keeps direct npx invocation', () => {
  const invocation = buildNpxInvocation(['--yes', 'wrangler@4', '--version'], { platform: 'linux' });
  assert.equal(invocation.command, 'npx');
  assert.deepEqual(invocation.args, ['--yes', 'wrangler@4', '--version']);
});

test('seed validates password before any remote operation', async () => {
  const calls = [];
  await assert.rejects(() => seedDemoAccount({
    password: 'curta123', licenseSecret: 'secret',
    probeIdentity: async () => { calls.push('probe'); return []; },
    syncLicense: async () => { calls.push('license'); },
    writeSql: async () => { calls.push('write'); },
  }), /demo_password_too_short/);
  assert.deepEqual(calls, []);
});

test('seed validates license secret before any D1 operation', async () => {
  const calls = [];
  await assert.rejects(() => seedDemoAccount({
    password: TEST_PASSWORD, licenseSecret: '',
    probeIdentity: async () => { calls.push('probe'); return []; },
    syncLicense: async () => { calls.push('license'); },
    writeSql: async () => { calls.push('write'); },
  }), /demo_license_secret_missing/);
  assert.deepEqual(calls, []);
});

test('seed preflights identity, syncs Pro, then writes only hashed credential and fixture SQL', async () => {
  const calls = [];
  let writtenSql = '';
  const result = await seedDemoAccount({
    password: TEST_PASSWORD, licenseSecret: 'license-secret', now: new Date('2026-09-22T13:00:00.000Z'),
    probeIdentity: async () => { calls.push('probe'); return []; },
    syncLicense: async ({ secret }) => { calls.push('license'); assert.equal(secret, 'license-secret'); return { status: 'active' }; },
    writeSql: async (sql) => { calls.push('write'); writtenSql = sql; },
  });
  assert.deepEqual(calls, ['probe','license','write']);
  assert.equal(result.email, DEMO_EMAIL);
  assert.equal(result.plan, 'pro_6m');
  assert.match(writtenSql, /INSERT INTO auth_credentials/);
  assert.doesNotMatch(writtenSql, /fixture-only-not-user-credential-2026!/);
});

test('reset refuses missing or unsafe identity before license/write side effects', async () => {
  for (const rows of [[], [{ user_id: DEMO_USER_ID, email: DEMO_EMAIL, user_metadata_json: '{}' }]]) {
    const calls = [];
    await assert.rejects(() => resetDemoAccount({
      password: TEST_PASSWORD, licenseSecret: 'license-secret',
      probeIdentity: async () => { calls.push('probe'); return rows; },
      syncLicense: async () => { calls.push('license'); },
      writeSql: async () => { calls.push('write'); },
    }), rows.length ? /demo_identity_not_marked/ : /demo_identity_missing/);
    assert.deepEqual(calls, ['probe']);
  }
});

test('reset validates identity, refreshes Pro and performs scoped reset+seed in one atomic D1 import file', async () => {
  const calls = [];
  let writtenSql = '';
  const result = await resetDemoAccount({
    password: TEST_PASSWORD, licenseSecret: 'license-secret', now: new Date('2026-09-22T13:00:00.000Z'),
    probeIdentity: async () => { calls.push('probe'); return [validRow]; },
    syncLicense: async () => { calls.push('license'); return { status: 'active' }; },
    writeSql: async (sql) => { calls.push('write'); writtenSql = sql; },
  });
  assert.deepEqual(calls, ['probe','license','write']);
  assert.equal(result.reset, true);
  assert.doesNotMatch(writtenSql, /BEGIN(?:\s+IMMEDIATE|\s+TRANSACTION)?/i);
  assert.doesNotMatch(writtenSql, /COMMIT/i);
  assert.match(writtenSql, new RegExp(`DELETE FROM supabase_records WHERE owner_id = '${DEMO_USER_ID}'`));
  assert.match(writtenSql, /INSERT INTO auth_users/);
  assert.doesNotMatch(writtenSql, /DELETE FROM auth_users/);
});
