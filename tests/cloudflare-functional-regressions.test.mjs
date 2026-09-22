import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('REST upsert cannot restore stale values over the incoming payload', () => {
  const runtime = read('worker/cloudflare-clinical-runtime.js');
  assert.doesNotMatch(
    runtime,
    /Object\.assign\(row,\s*existing\.record,\s*row,\s*\{\s*updated_at:\s*now\s*\}\)/,
    'upsert currently mutates row before merge, so existing.record can overwrite incoming values',
  );
});

test('growth measurement RPC is handled by a dedicated Cloudflare runtime before the compatibility REST runtime', () => {
  const growthRuntimeUrl = new URL('../worker/cloudflare-growth-runtime.js', import.meta.url);
  assert.equal(existsSync(growthRuntimeUrl), true, 'dedicated Cloudflare growth runtime is missing');
  const growthRuntime = read('worker/cloudflare-growth-runtime.js');
  const domain = read('worker/domain-entry.js');
  assert.match(growthRuntime, /record_growth_measurement/);
  assert.match(growthRuntime, /CLINICAL_DB/);
  assert.match(growthRuntime, /authenticateClinicalRequest/);
  assert.match(growthRuntime, /\.batch\(/, 'growth write must be atomic');
  const growthPos = domain.indexOf('handleCloudflareGrowthRuntime');
  const compatibilityPos = domain.indexOf('handleCloudflareClinicalRuntime(request, env)');
  assert.ok(growthPos >= 0 && compatibilityPos >= 0 && growthPos < compatibilityPos,
    'growth RPC must be intercepted before the compatibility REST runtime');
});

test('growth frontend never targets the retired Supabase host and resolves WHO data from the site root', () => {
  const growth = read('public/growth-feature.js');
  assert.doesNotMatch(growth, /zxowxdfhtksevhnjmeyu|supabase\.co/i);
  assert.match(growth, /const SB_URL=window\.location\.origin/);
  assert.match(growth, /const WHO_BASE='\/who\/v2026-08-30\/'/);
});
