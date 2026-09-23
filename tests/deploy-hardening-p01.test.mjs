import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const deploy = readFileSync('scripts/deploy-cloudflare-billing.ps1', 'utf8');
const clinicalRuntime = readFileSync('worker/cloudflare-clinical-runtime.js', 'utf8');
const deployVersion = readFileSync('worker/deploy-version.js', 'utf8');
const bootstrap = readFileSync('src/bootstrap.js', 'utf8');
const upgradeE2e = readFileSync('tests/e2e/deploy-version-upgrade.spec.mjs', 'utf8');

test('production deploy is allowed only from the exact current origin/main commit', () => {
  assert.match(deploy, /git[^\n]*fetch[^\n]*origin[^\n]*main/i);
  assert.match(deploy, /rev-parse[^\n]*(?:--abbrev-ref\s+HEAD|--symbolic-full-name)/i);
  assert.match(deploy, /rev-parse[^\n]*HEAD/i);
  assert.match(deploy, /rev-parse[^\n]*origin\/main/i);
  assert.match(deploy, /main/i);
  assert.match(deploy, /LocalSha[^\n]*-ne[^\n]*RemoteMainSha/i);
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

test('bootstrap explicitly removes legacy service worker registrations', () => {
  assert.match(bootstrap, /getRegistrations\(\)/);
  assert.match(bootstrap, /unregister\(\)/);
  assert.match(bootstrap, /\/sw\.js/);
});

test('Playwright covers version N to N+1 activation and reload', () => {
  assert.match(upgradeE2e, /v1\.14\.1-stability/);
  assert.match(upgradeE2e, /STALE_VERSION_N/);
  assert.match(upgradeE2e, /registration\.update\(\)/);
  assert.match(upgradeE2e, /page\.reload/);
  assert.match(upgradeE2e, /caches\.keys\(\)/);
  assert.match(upgradeE2e, /expect\(state\.controller\)\.toMatch/);
  assert.match(upgradeE2e, /sw\\\.js/);
});
