import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUDFLARE_PBKDF2_ITERATIONS,
  cloudflarePasswordHash,
} from './cloudflare-auth-compat.js';

test('Cloudflare password hashing stays at the supported PBKDF2 ceiling', async () => {
  assert.equal(CLOUDFLARE_PBKDF2_ITERATIONS, 100000);
  const salt = Buffer.from('debora-auth-test-salt').toString('base64url');
  const hash = await cloudflarePasswordHash('senha-de-teste', salt);
  assert.equal(typeof hash, 'string');
  assert.ok(hash.length > 20);
});

test('Cloudflare password hashing refuses unsupported iteration counts', async () => {
  const salt = Buffer.from('debora-auth-test-salt').toString('base64url');
  await assert.rejects(
    () => cloudflarePasswordHash('senha-de-teste', salt, 100001),
    /unsupported_pbkdf2_iterations/,
  );
});
