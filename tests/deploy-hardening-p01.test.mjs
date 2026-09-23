import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const deploy = readFileSync('scripts/deploy-cloudflare-billing.ps1', 'utf8');
const cutover = readFileSync('scripts/cutover-cloudflare-runtime.ps1', 'utf8');
const dataRuntime = readFileSync('worker/cloudflare-data-runtime.js', 'utf8');
const bootstrap = readFileSync('src/bootstrap.js', 'utf8');
const upgradeE2e = readFileSync('tests/e2e/deploy-version-upgrade.spec.mjs', 'utf8');

test('production deploy is allowed only from the exact current origin/main commit', () => {
  assert.match(deploy, /git[^\n]*fetch[^\n]*origin[^\n]*main/i);
  assert.match(deploy, /rev-parse[^\n]*(?:--abbrev-ref\s+HEAD|--symbolic-full-name)/i);
  assert.match(deploy, /rev-parse[^\n]*HEAD/i);
  assert.match(deploy, /rev-parse[^\n]*origin\/main/i);
  assert.match(deploy, /main/i);
  assert.match(deploy, /HEAD[^\n]*(?:!=|-ne)[^\n]*origin\/main|LocalSha[^\n]*(?:-ne|ne)[^\n]*RemoteMainSha/i);
});

test('production deploy acquires and releases a global D1 lease', () => {
  assert.match(deploy, /production_deploy_lock/i);
  assert.match(deploy, /runtime_state/i);
  assert.match(deploy, /deploy lock|lock de deploy|deploy_lock/i);
  assert.match(deploy, /finally/i);
  assert.match(deploy, /DELETE\s+FROM\s+runtime_state|UPDATE\s+runtime_state/i);
});

test('deployment SHA is injected into Worker runtime and verified after deploy', () => {
  assert.match(deploy, /ExpectedGitSha|GitSha/i);
  assert.match(cutover, /ExpectedGitSha/i);
  assert.match(cutover, /GIT_SHA/i);
  assert.match(dataRuntime, /gitSha\s*:\s*String\(env\.GIT_SHA/i);
  assert.match(cutover, /health\.gitSha/i);
});

test('post-deploy verification checks anti-stale headers for all public entrypoints', () => {
  for (const path of ['/', '/app/', '/comercial/', '/sw.js']) {
    assert.ok(cutover.includes(`'${path}'`) || cutover.includes(`\"${path}\"`), `missing header verification for ${path}`);
  }
  assert.match(cutover, /cache-control/i);
  assert.match(cutover, /no-store/i);
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
  assert.match(upgradeE2e, /controller.*sw\.js|sw\.js.*controller/s);
});
