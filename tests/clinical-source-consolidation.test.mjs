import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const bootstrapPath = resolve(root, 'src/bootstrap.js');
const manifestPath = resolve(root, 'public/clinical-source/manifest.json');

test('canonical clinical source is declared and preferred with legacy fallback', () => {
  assert.equal(existsSync(manifestPath), true, 'canonical clinical source manifest must exist');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.version, 2);
  assert.equal(manifest.generatedFromLegacyArtifacts, true);
  assert.equal(manifest.modules['core/app-shell.js'].promoted, true);
  assert.equal(manifest.modules['core/lib/app-data.js'].promoted, true);

  const bootstrap = readFileSync(bootstrapPath, 'utf8');
  assert.match(bootstrap, /CLINICAL_SOURCE_ROOT/);
  assert.match(bootstrap, /loadCanonicalText/);
  assert.match(bootstrap, /canonicalText\s*\?\?/);
  assert.match(bootstrap, /loadBaseArchive\(\)/, 'legacy base archive fallback must remain during migration');
  assert.match(bootstrap, /loadReleasePatch\(\)/, 'legacy release patch fallback must remain during migration');
  assert.match(bootstrap, /loadAgendaPatch\(\)/, 'legacy agenda patch fallback must remain during migration');
});

test('first slice does not couple clinical migration to commercial SaaS or billing worker', () => {
  const bootstrap = readFileSync(bootstrapPath, 'utf8');
  assert.doesNotMatch(bootstrap, /public\/comercial|asaas|billing_plan_catalog|billing_webhook_events/i);
});
