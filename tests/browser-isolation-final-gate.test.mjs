import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the Playwright browser projects isolate SPA E2E from two service worker transitions',()=>{
  const config=readFileSync('playwright.config.mjs','utf8');
  assert.match(config,/name:\s*'chromium-upgrade'/);
  assert.match(config,/testMatch:\s*'\*\*\/deploy-version-upgrade\.spec\.mjs'/);
  assert.match(config,/testIgnore:\s*\[[^\]]*deploy-version-upgrade\.spec\.mjs/s);
  assert.match(config,/testIgnore:\s*\[[^\]]*pwa-cache-p1\.spec\.mjs/s);
  assert.match(config,/name:\s*'chromium-service-worker'/);
  assert.match(config,/serviceWorkers:\s*'allow'/);
});

test('the final materialized gate validates each browser lifecycle independently',()=>{
  const yaml=readFileSync('.github/workflows/validate-final-materialized-gate.yml','utf8');
  assert.match(yaml,/npx playwright test --project=chromium(?:\s|$)/m);
  assert.match(yaml,/npx playwright test --project=chromium-upgrade(?:\s|$)/m);
  assert.match(yaml,/npx playwright test --project=chromium-service-worker(?:\s|$)/m);
  assert.doesNotMatch(yaml,/run:\s*npx playwright test\s*\n/);
  assert.match(yaml,/Run mobile E2E on the same final artifact/);
});
