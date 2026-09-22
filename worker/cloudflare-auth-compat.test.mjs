import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUDFLARE_PBKDF2_ITERATIONS,
  cloudflarePasswordHash,
} from './cloudflare-auth-compat.js';

test('Cloudflare password hashing keeps 100k as the default write cost', async () => {
  assert.equal(CLOUDFLARE_PBKDF2_ITERATIONS, 100000);
  const salt = Buffer.from('debora-auth-test-salt').toString('base64url');
  const hash = await cloudflarePasswordHash('senha-de-teste', salt);
  assert.equal(typeof hash, 'string');
  assert.ok(hash.length > 20);
});

test('Cloudflare password hashing accepts the 210k runtime credential cost', async () => {
  const salt = Buffer.from('debora-auth-test-salt').toString('base64url');
  const hash = await cloudflarePasswordHash('senha-de-teste', salt, 210000);
  assert.equal(typeof hash, 'string');
  assert.ok(hash.length > 20);
});

test('Cloudflare password hashing refuses iteration counts above the runtime ceiling', async () => {
  const salt = Buffer.from('debora-auth-test-salt').toString('base64url');
  await assert.rejects(
    () => cloudflarePasswordHash('senha-de-teste', salt, 210001),
    /unsupported_pbkdf2_iterations/,
  );
});
