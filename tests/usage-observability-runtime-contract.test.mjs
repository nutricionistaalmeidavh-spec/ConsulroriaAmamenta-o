import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const domain = readFileSync('worker/domain-entry.js','utf8');
const runtime = readFileSync('worker/usage-observability-runtime.js','utf8');

test('domain wires usage runtime before auth terminal', () => {
  assert.match(domain,/handleUsageObservabilityRuntime/);
  assert.ok(domain.indexOf('handleUsageObservabilityRuntime') < domain.lastIndexOf('handleCloudflareAuthRuntime'));
});

test('runtime protects heartbeat and internal admin routes', () => {
  assert.match(runtime,/\/api\/presence\/heartbeat/);
  assert.match(runtime,/authenticateClinicalRequest/);
  assert.match(runtime,/x-debora-observability-secret/);
  assert.match(runtime,/\/api\/internal\/observability\/summary/);
  assert.match(runtime,/listObservedSales/);
  assert.match(runtime,/listUserSessions/);
  assert.match(runtime,/cache-control.*no-store/s);
});
