import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const bootstrap = readFileSync(resolve(root, 'src/bootstrap.js'), 'utf8');

const requiredCanonicalPaths = [
  'index.html',
  'styles.css',
  'config.js',
  'core/app-shell.js',
  'core/lib/supabase-client.js',
  'core/lib/auth-service.js',
  'core/lib/repositories.js',
  'core/lib/app-data.js',
  'core/lib/encounter-form.js',
  'core/lib/media-service.js',
  'core/lib/backup-service.js',
  'core/lib/pdf-service.js',
  'features/clinical-note-feature.js',
  'features/clinical-note-feature.css',
  'features/patient-fixes.css'
];

test('normal clinical startup loads a complete canonical runtime before considering legacy archives', () => {
  assert.match(bootstrap, /CLINICAL_RUNTIME_PATHS/);
  assert.match(bootstrap, /async function loadCanonicalRuntime/);
  assert.match(bootstrap, /async function loadLegacyRuntime/);
  assert.match(bootstrap, /await loadCanonicalRuntime\(\)/);
  assert.match(bootstrap, /await loadLegacyRuntime\(\)/);
  assert.doesNotMatch(
    bootstrap,
    /Promise\.all\(\s*\[\s*loadBaseArchive\(\),\s*loadReleasePatch\(\),\s*loadAgendaPatch\(\),/,
    'legacy archives must not be downloaded alongside the canonical source path'
  );

  for (const path of requiredCanonicalPaths) {
    assert.match(bootstrap, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('legacy loaders remain available only as rollback fallback', () => {
  assert.match(bootstrap, /function loadBaseArchive|async function loadBaseArchive/);
  assert.match(bootstrap, /function loadReleasePatch|async function loadReleasePatch/);
  assert.match(bootstrap, /function loadAgendaPatch|async function loadAgendaPatch/);
});
