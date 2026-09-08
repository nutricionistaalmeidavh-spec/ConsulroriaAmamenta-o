import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const root = read('index.html');
const bootstrap = read('src/bootstrap.js');
const shell = read('public/clinical-source/core/app-shell.js');
const config = read('public/clinical-source/config.js');

assert.ok(existsSync('app/index.html'), 'canonical /app entry must exist');
assert.ok(existsSync('public/debora/index.html'), 'dedicated /debora landing must exist');
assert.match(root, /src\/bootstrap\.js/, 'root compatibility entry must keep the canonical bootstrap');
assert.match(bootstrap, /CANONICAL_PRODUCT_NAME/, 'bootstrap must consume canonical product identity');
assert.doesNotMatch(config, /APP_NAME:\s*['\"]Débora Lactação/, 'generic config must not use Débora as product name');
assert.doesNotMatch(shell, /title:\s*['\"]Débora Lactação|<h1>Débora Lactação|Olá, Débora/, 'canonical shell must not hard-code Débora as product identity');
assert.match(shell, /professional_profiles/, 'canonical shell must resolve the authenticated professional profile');
assert.match(shell, /owner_id=eq\./, 'professional profile lookup must be owner-scoped');

for (const file of ['supabase/phase-saas-foundation.sql', 'supabase/phase-saas-enforcement.sql']) {
  const sql = read(file);
  assert.doesNotMatch(sql, /update\s+(mothers|babies|appointments|clinical_encounters)\s+set\s+owner_id/i, `${file} must not re-key clinical ownership`);
  assert.doesNotMatch(sql, /delete\s+from\s+(mothers|babies|appointments|clinical_encounters)/i, `${file} must not delete clinical rows`);
}

console.log('canonical multi-client routing contract: ok');
