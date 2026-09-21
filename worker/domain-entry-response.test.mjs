import test from 'node:test';
import assert from 'node:assert/strict';

import { withNoIndex } from './domain-entry.js';

test('withNoIndex preserves a Worker-created response and leaves its body readable exactly once', async () => {
  const response = new Response(JSON.stringify({ access_token: 'token', user: { id: 'user-1' } }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

  const protectedResponse = withNoIndex(response);

  assert.equal(protectedResponse, response, 'Worker responses must not be rebound to a second Response');
  assert.equal(protectedResponse.bodyUsed, false);
  assert.equal(protectedResponse.body?.locked, false);
  assert.equal(protectedResponse.headers.get('x-robots-tag'), 'noindex, nofollow');

  const payload = await protectedResponse.json();
  assert.equal(payload.access_token, 'token');
  assert.equal(payload.user.id, 'user-1');
  assert.equal(protectedResponse.bodyUsed, true);
});
