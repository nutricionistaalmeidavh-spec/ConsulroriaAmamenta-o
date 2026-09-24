import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const deploy = readFileSync('scripts/deploy-cloudflare-billing.ps1', 'utf8');
const clinicalRuntime = readFileSync('worker/cloudflare-clinical-runtime.js', 'utf8');
const deployVersion = readFileSync('worker/deploy-version.js', 'utf8');
const bootstrap = readFileSync('src/bootstrap.js', 'utf8');
const domainEntry = readFileSync('worker/domain-entry.js', 'utf8');
const upgradeE2e = readFileSync('tests/e2e/deploy-version-upgrade.spec.mjs', 'utf8');
const cacheWorkflowPath = '.github/workflows/validate-cache-release-hardening.yml';

test('production deploy is allowed only from the exact current origin/main commit', () => {
  assert.match(deploy, /fetch[^\n]*origin[^\n]*main/i);
  assert.match(deploy, /(?:CI_COMMIT_BRANCH|rev-parse[^\n]*--abbrev-ref[^\n]*HEAD)/i);
  assert.match(deploy, /rev-parse[^\n]*['\"]?HEAD/i);
  assert.match(deploy, /rev-parse[^\n]*origin\/main/i);
  assert.match(deploy, /LocalSha[^\n]*-ne[^\n]*RemoteMainSha/i);
});

test('production deploy revalidates origin/main immediately before publishing', () => {
  const cutoverIndex = deploy.indexOf('cutover-cloudflare-runtime.ps1');
  const publishIndex = deploy.indexOf('Executando deploy protegido');
  assert.ok(cutoverIndex >= 0 && publishIndex >= 0, 'guarded cutover must remain the production publisher');
  const beforePublish = deploy.slice(0, publishIndex);
  const fetches = beforePublish.match(/fetch[^\n]*origin[^\n]*main/gi) || [];
  assert.ok(fetches.length >= 2 || /Assert-CurrentMain[\s\S]*Assert-CurrentMain/.test(beforePublish),
    'origin/main must be checked at startup and again immediately before publication');
});

test('production deploy acquires and releases a global D1 lease', () => {
  assert.match(deploy, /production_deploy_lock/i);
  assert.match(deploy, /runtime_state/i);
  assert.match(deploy, /deploy lock|lock de deploy|deploy_lock/i);
  assert.match(deploy, /finally/i);
  assert.match(deploy, /DELETE\s+FROM\s+runtime_state/i);
});

test('deployment SHA is embedded in the Worker build and verified after deploy', () => {
  assert.match(deployVersion, /__DEPLOY_GIT_SHA__/);
  assert.match(deploy, /DeployVersionFile/i);
  assert.match(deploy, /__DEPLOY_GIT_SHA__/);
  assert.match(deploy, /LocalSha/i);
  assert.match(clinicalRuntime, /GIT_SHA/);
  assert.match(clinicalRuntime, /gitSha\s*:\s*String\(GIT_SHA/i);
  assert.match(deploy, /health\.gitSha/i);
});

test('post-deploy verification checks anti-stale headers for all public entrypoints', () => {
  for (const path of ['/', '/app/', '/comercial/', '/sw.js']) {
    assert.ok(deploy.includes(`'${path}'`) || deploy.includes(`\"${path}\"`), `missing header verification for ${path}`);
  }
  assert.match(deploy, /cache-control/i);
  assert.match(deploy, /no-store/i);
});

test('public redirects cannot preserve stale routing decisions', () => {
  assert.doesNotMatch(domainEntry, /cache-control['\"]?\s*:\s*['\"]public,\s*max-age=300/i);
  assert.match(domainEntry, /route\.type\s*===\s*['\"]redirect['\"][\s\S]{0,500}no-store/i);
});

test('bootstrap explicitly removes legacy service worker registrations', () => {
  assert.match(bootstrap, /getRegistrations\(\)/);
  assert.match(bootstrap, /unregister\(\)/);
  assert.match(bootstrap, /\/sw\.js/);
});

test('Worker retires legacy service-worker.js registrations even before new bootstrap executes', () => {
  assert.match(domainEntry, /service-worker\.js/);
  assert.match(domainEntry, /unregister\(\)/);
  assert.match(domainEntry, /debora-lactacao-v/);
  assert.match(domainEntry, /service-worker-allowed/i);
  assert.match(domainEntry, /no-store/i);
});

test('Playwright performs a real version N to N+1 service worker replacement', () => {
  assert.match(upgradeE2e, /e2e-N/);
  assert.match(upgradeE2e, /e2e-N\+1/);
  assert.match(upgradeE2e, /readFileSync\([^\n]*public\/sw\.js/);
  assert.match(upgradeE2e, /registration\.update\(\)/);
  assert.match(upgradeE2e, /controllerchange/);
  assert.match(upgradeE2e, /context\.newPage\(\)/);
  assert.match(upgradeE2e, /\.reload\s*\(/);
  assert.match(upgradeE2e, /caches\.keys\(\)/);
});

test('cache release E2E is wired into CI', () => {
  assert.ok(existsSync(cacheWorkflowPath), 'dedicated cache release hardening workflow is missing');
  const workflow = readFileSync(cacheWorkflowPath, 'utf8');
  assert.match(workflow, /deploy-version-upgrade\.spec\.mjs/);
  assert.match(workflow, /cache-staleness\.spec\.mjs/);
  assert.match(workflow, /playwright test/i);
});
