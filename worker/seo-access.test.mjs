import test from 'node:test';
import assert from 'node:assert/strict';
import { isSeoUserAllowed } from './seo-search-console.js';

test('SEO access accepts an explicitly allowed Supabase user id', () => {
  assert.equal(isSeoUserAllowed(
    { id: 'owner-123', email: 'other@example.com' },
    { ARTISYS_SEO_ALLOWED_USER_IDS: 'owner-123' },
  ), true);
});

test('SEO access accepts an explicitly allowed authenticated email case-insensitively', () => {
  assert.equal(isSeoUserAllowed(
    { id: 'unlisted-id', email: 'NutricionistaAlmeidaVH@gmail.com' },
    { ARTISYS_SEO_ALLOWED_EMAILS: 'nutricionistaalmeidavh@gmail.com' },
  ), true);
});

test('SEO access denies when both allowlists are empty', () => {
  assert.equal(isSeoUserAllowed(
    { id: 'owner-123', email: 'owner@example.com' },
    {},
  ), false);
});
