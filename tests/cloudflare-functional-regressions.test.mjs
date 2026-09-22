import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { normalizeGrowthRuntimeSource } from '../scripts/normalize-growth-runtime.mjs';
import { mergeUpsertRecord } from '../worker/cloudflare-upsert-runtime.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('REST conflict upsert keeps incoming values instead of restoring stale data', () => {
  const merged = mergeUpsertRecord(
    { id: 'row-1', owner_id: 'user-1', name: 'Valor antigo', created_at: '2026-09-01T00:00:00.000Z' },
    { owner_id: 'user-1', name: 'Valor novo' },
    'row-1',
    '2026-09-22T22:00:00.000Z',
  );
  assert.equal(merged.id, 'row-1');
  assert.equal(merged.name, 'Valor novo');
  assert.equal(merged.created_at, '2026-09-01T00:00:00.000Z');
  assert.equal(merged.updated_at, '2026-09-22T22:00:00.000Z');

  const upsertRuntime = read('worker/cloudflare-upsert-runtime.js');
  const facade = read('worker/cloudflare-clinical-runtime.js');
  const domain = read('worker/domain-entry.js');
  assert.doesNotMatch(upsertRuntime, /Object\.assign\(row,\s*existing\.record/);
  assert.doesNotMatch(facade, /Object\.assign\(row,\s*existing\.record/);
  assert.match(facade, /handleCloudflareUpsertRuntime/);
  const upsertPos = domain.indexOf('handleCloudflareUpsertRuntime(request, env, url)');
  const compatibilityPos = domain.indexOf('handleCloudflareClinicalRuntime(request, env)');
  assert.ok(upsertPos >= 0 && compatibilityPos >= 0 && upsertPos < compatibilityPos,
    'conflict upserts must be intercepted before the compatibility REST runtime');
});

test('growth measurement RPC is handled by a dedicated Cloudflare runtime before the compatibility REST runtime', () => {
  const growthRuntimeUrl = new URL('../worker/cloudflare-growth-runtime.js', import.meta.url);
  assert.equal(existsSync(growthRuntimeUrl), true, 'dedicated Cloudflare growth runtime is missing');
  const growthRuntime = read('worker/cloudflare-growth-runtime.js');
  const facade = read('worker/cloudflare-clinical-runtime.js');
  const domain = read('worker/domain-entry.js');
  assert.match(growthRuntime, /record_growth_measurement/);
  assert.match(growthRuntime, /CLINICAL_DB/);
  assert.match(growthRuntime, /authenticateClinicalRequest/);
  assert.match(growthRuntime, /\.batch\(/, 'growth write must be atomic');
  assert.match(facade, /handleCloudflareGrowthRuntime/);
  const growthPos = domain.indexOf('handleCloudflareGrowthRuntime(request, env, url)');
  const compatibilityPos = domain.indexOf('handleCloudflareClinicalRuntime(request, env)');
  assert.ok(growthPos >= 0 && compatibilityPos >= 0 && growthPos < compatibilityPos,
    'growth RPC must be intercepted before the compatibility REST runtime');
});

test('committed growth entry is fail-closed and dev/build materialize a Cloudflare-only implementation', () => {
  const committedEntry = read('public/growth-feature.js');
  const legacyTemplate = read('patch-source/legacy/growth-feature.supabase-template.js');
  const normalized = normalizeGrowthRuntimeSource(legacyTemplate);

  assert.doesNotMatch(committedEntry, /zxowxdfhtksevhnjmeyu|supabase\.co|sb_publishable_/i);
  assert.match(committedEntry, /served before Cloudflare runtime materialization/);
  assert.doesNotMatch(normalized, /zxowxdfhtksevhnjmeyu|supabase\.co/i);
  assert.match(normalized, /const SB_URL=window\.location\.origin/);
  assert.match(normalized, /const WHO_BASE='\/who\/v2026-08-30\/'/);

  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.dev, /normalize-growth-runtime\.mjs/);
  assert.match(pkg.scripts.dev, /materialize-clinical-source\.mjs --write/);
  assert.match(pkg.scripts.build, /normalize-growth-runtime\.mjs/);
  assert.match(pkg.scripts.build, /materialize-clinical-source\.mjs --write/);
});
