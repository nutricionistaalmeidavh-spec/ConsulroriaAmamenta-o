import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const exists = (path) => existsSync(new URL(path, root));

const ACTIVE_RUNTIME_FILES = [
  'public/billing-v2.js',
  'public/package-audit-feature.js',
  'public/clinical-care-flow-feature.js',
  'public/feeding-assessment-history-feature.js',
  'public/growth-feature.js',
  'public/clinical-source/config.js',
  'patch-source/base/config.js',
  'src/bootstrap.js',
  'public/sw.js',
  'worker/cloudflare-clinical-runtime.js',
  'worker/domain-entry.js',
];

const FORBIDDEN = [
  /zxowxdfhtksevhnjmeyu/i,
  /https:\/\/[^'"\s]*supabase\.co/i,
  /SUPABASE_SERVICE_ROLE_KEY/,
  /\/functions\/v1\/saas-(?:checkout|billing-webhook)/,
];

test('active browser and worker runtime contains no retired Supabase backend route or service-role dependency', () => {
  for (const path of ACTIVE_RUNTIME_FILES) {
    const source = read(path);
    for (const pattern of FORBIDDEN) {
      assert.doesNotMatch(source, pattern, `${path} still contains forbidden backend pattern ${pattern}`);
    }
  }
});

test('browser feature modules resolve same-origin without requiring window during Node imports', () => {
  for (const path of [
    'public/billing-v2.js',
    'public/package-audit-feature.js',
    'public/clinical-care-flow-feature.js',
    'public/feeding-assessment-history-feature.js',
    'public/growth-feature.js',
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /=window\.location\.origin/);
    assert.match(source, /globalThis\.location\?\.origin/);
  }
});

test('browser entrypoints no longer install the legacy fetch bridge', () => {
  assert.doesNotMatch(read('index.html'), /cloudflare-fetch-bridge/);
  assert.doesNotMatch(read('app/index.html'), /cloudflare-fetch-bridge/);
  assert.equal(exists('src/cloudflare-fetch-bridge.js'), false, 'legacy fetch bridge must be deleted after cutover');
});

test('domain entry fails closed without the legacy core worker', () => {
  const domain = read('worker/domain-entry.js');
  assert.doesNotMatch(domain, /import\s+coreWorker\s+from\s+['"]\.\/index\.js['"]/);
  assert.doesNotMatch(domain, /coreWorker\.fetch/);
  assert.match(domain, /env\.ASSETS\.fetch/);
  assert.match(domain, /api_not_found/);
  assert.equal(exists('worker/index.js'), false, 'legacy Supabase worker must be deleted');
  assert.equal(exists('worker/partner-admin.js'), false, 'legacy Supabase partner admin must be deleted');
});

test('clinical compatibility runtime cannot perform legacy auth network fallback', () => {
  const runtime = read('worker/cloudflare-clinical-runtime.js');
  assert.doesNotMatch(runtime, /fetch\(\s*`\$\{LEGACY_SUPABASE_URL\}/);
  assert.doesNotMatch(runtime, /Existing Supabase accounts|Existing browser sessions can cross the cutover/i);
});
