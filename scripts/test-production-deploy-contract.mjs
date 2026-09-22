import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [pkgRaw, pipeline, cutover, billingDeploy] = await Promise.all([
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
  readFile(new URL('../.woodpecker/debora-lactacao.yaml', import.meta.url), 'utf8'),
  readFile(new URL('./cutover-cloudflare-runtime.ps1', import.meta.url), 'utf8'),
  readFile(new URL('./deploy-cloudflare-billing.ps1', import.meta.url), 'utf8'),
]);

const pkg = JSON.parse(pkgRaw);
const deployScript = String(pkg.scripts?.['deploy:production'] || '');

assert.match(deployScript, /deploy-cloudflare-billing\.ps1/i,
  'deploy:production must apply the D1 billing schema before the Cloudflare cutover');
assert.match(billingDeploy, /billing-schema\.sql/i);
assert.match(billingDeploy, /billing-auth-schema\.sql/i);
assert.match(billingDeploy, /wrangler@4 d1 execute/i);
assert.match(billingDeploy, /cutover-cloudflare-runtime\.ps1/i);
assert.match(billingDeploy, /billing_backend/i);

assert.doesNotMatch(
  pipeline,
  /wrangler@4\s+deploy\s+--config\s+wrangler\.jsonc/i,
  'Woodpecker must not deploy the base wrangler.jsonc directly because it has no clinical D1/R2 bindings',
);
assert.match(pipeline, /npm\s+run\s+deploy:production/i,
  'Woodpecker must use the guarded production deploy entrypoint');

for (const marker of ['CLINICAL_DB', 'CLINICAL_FILES', 'wrangler.cutover.generated.json']) {
  assert.ok(cutover.includes(marker), `cutover script must preserve ${marker}`);
}

console.log('Production deploy contract OK: D1 billing migration precedes guarded Cloudflare deploy.');
