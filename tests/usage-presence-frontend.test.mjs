import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const identity = readFileSync('public/canonical-identity-runtime.js','utf8');
const runtime = readFileSync('public/usage-presence-runtime.js','utf8');

test('canonical identity loads presence runtime', () => {
  assert.match(identity,/usage-presence-runtime\.js/);
});

test('presence runtime is best effort and contains no clinical payload', () => {
  assert.match(runtime,/\/api\/presence\/heartbeat/);
  assert.match(runtime,/60000/);
  assert.match(runtime,/Authorization/);
  assert.match(runtime,/catch/);
  assert.doesNotMatch(runtime,/patient|mother|baby|prontu/i);
});

test('presence heartbeat prefers the current stored token and handles HTTP failures', () => {
  assert.match(runtime,/const current = readToken\(\) \|\| token/);
  assert.match(runtime,/if \(!response\.ok\)/);
  assert.match(runtime,/\[401, 403\]\.includes\(response\.status\)/);
  assert.match(runtime,/presence_heartbeat_http_/);
});
