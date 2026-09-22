import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDemoCredential } from '../scripts/demo-account-fixture.mjs';
import { cloudflarePasswordHash } from '../worker/cloudflare-auth-compat.js';

test('the default demo credential can be verified by the deployed authenticator', async () => {
  const password = 'synthetic-test-password';
  const credential = deriveDemoCredential(password);
  assert.equal(await cloudflarePasswordHash(password, credential.password_salt, credential.password_iterations), credential.password_hash);
  assert.throws(() => deriveDemoCredential(password, { iterations: 210000 }), /iterations_unsupported/);
});
