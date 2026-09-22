import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('active clinical facade cannot perform Supabase auth fallback', () => {
  const runtime = read('worker/cloudflare-clinical-runtime.js');
  assert.match(runtime, /cloudflare-auth-runtime\.js/);
  assert.doesNotMatch(runtime, /supabase\.co|LEGACY_SUPABASE|legacyAuth\s*\(|legacyUserForToken|allowLegacy\s*=\s*true/i);
});

test('generic clinical facade intercepts corrected upserts before quarantined compatibility code', () => {
  const runtime = read('worker/cloudflare-clinical-runtime.js');
  const upsert = runtime.indexOf('handleCloudflareUpsertRuntime(request, env, url)');
  const legacy = runtime.indexOf('handleLegacyClinicalRuntime(request, env)');
  assert.ok(upsert >= 0 && legacy >= 0 && upsert < legacy);
});

test('versioned growth entrypoint contains no retired backend material', () => {
  const growth = read('public/growth-feature.js');
  assert.doesNotMatch(growth, /zxowxdfhtksevhnjmeyu|supabase\.co|sb_publishable_/i);
  assert.match(growth, /served before Cloudflare runtime materialization/);
});

test('development materializes canonical clinical source before Vite starts', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.dev, /materialize-clinical-source\.mjs --write/);
  assert.match(pkg.scripts.dev, /normalize-growth-runtime\.mjs/);
});

test('SaaS CI always runs the Block 1 and 2 regression gate for worker changes', () => {
  const workflow = read('.github/workflows/validate-saas-foundation.yml');
  assert.match(workflow, /Validate Block 1 and 2 Cloudflare regressions/);
  assert.match(workflow, /npm run test:cloudflare-regressions/);
  assert.match(workflow, /worker\/\*\*/);
});
