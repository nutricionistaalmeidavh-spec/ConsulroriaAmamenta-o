import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const workflowPath = '.github/workflows/validate-final-materialized-gate.yml';
const e2ePath = 'tests/e2e/final-materialized-clinical-flow.spec.mjs';

test('Stage 12 has a dedicated final gate over one materialized build', () => {
  assert.equal(existsSync(workflowPath), true, 'Stage 12 final workflow must exist');
  const workflow = read(workflowPath);
  const build = workflow.indexOf('npm run build');
  const regressions = workflow.indexOf('node --test tests/clinical-source-*.test.mjs');
  const desktop = workflow.indexOf('npx playwright test');
  const mobile = workflow.indexOf('playwright.mobile.config.mjs');
  assert.ok(build >= 0, 'final gate must materialize/build first');
  assert.ok(regressions > build, 'full clinical regressions must run after the final build');
  assert.ok(desktop > regressions, 'desktop E2E must run after regressions on that build');
  assert.ok(mobile > desktop, 'mobile smoke must run after desktop E2E on the same checkout/build');
  assert.doesNotMatch(workflow, /npm run test:e2e\b/, 'final gate must not rebuild between regression and browser evidence');
  assert.doesNotMatch(workflow, /npm run test:e2e:mobile\b/, 'final mobile gate must consume the same already-built dist');
});

test('Stage 12 browser gate serves the materialized dist artifact', () => {
  const server = read('tests/e2e/server.mjs');
  const runtime = read('tests/helpers/cloudflare-local.mjs');
  assert.match(server, /createLocalRuntime\(\{\s*port:\s*4173,\s*assets:\s*true\s*\}\)/);
  assert.match(runtime, /const root = resolve\('dist'\)/);
});

test('Stage 12 critical browser flow is UI-driven for package, start and finalize', () => {
  assert.equal(existsSync(e2ePath), true, 'critical final browser flow must exist');
  const source = read(e2ePath);
  assert.match(source, /data-action=[\\"']new-patient/);
  assert.match(source, /data-action=[\\"']new-appointment/);
  assert.match(source, /data-bv-mode/);
  assert.match(source, /package_new/);
  assert.match(source, /data-wizard-next/);
  assert.match(source, /data-clinical-media-input/);
  assert.match(source, /data-action=[\\"']open-clinical-note/);
  assert.match(source, /data-prh-target=[\\"']album/);
  assert.doesNotMatch(source, /page\.request\.post\(['\"]\/api\/clinical\/rpc\/(?:start_clinical_encounter|set_appointment_billing|finalize_encounter_billing)/,
    'critical package/start/finalize actions must be driven by UI clicks, not API shortcuts');
});
