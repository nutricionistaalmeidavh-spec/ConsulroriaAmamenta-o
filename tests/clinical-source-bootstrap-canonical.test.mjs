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

test('normal clinical startup loads a complete canonical runtime without legacy archives', () => {
  assert.match(bootstrap, /CLINICAL_RUNTIME_PATHS/);
  assert.match(bootstrap, /async function loadCanonicalRuntime/);
  assert.doesNotMatch(bootstrap, /async function loadLegacyRuntime/);
  assert.match(bootstrap, /await loadCanonicalRuntime\(\)/);
  assert.doesNotMatch(bootstrap, /await loadLegacyRuntime\(\)/);
  assert.doesNotMatch(
    bootstrap,
    /Promise\.all\(\s*\[\s*loadBaseArchive\(\),\s*loadReleasePatch\(\),\s*loadAgendaPatch\(\),\s*loadCanonical/i,
    'legacy archives must not be downloaded alongside the canonical source path'
  );

  for (const path of requiredCanonicalPaths) {
    assert.match(bootstrap, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('canonical load failure stops startup', () => {
  assert.match(bootstrap, /if \(!canonicalRuntime\) throw new Error/);
  assert.doesNotMatch(bootstrap, /function loadBaseArchive|function loadReleasePatch|function loadAgendaPatch/);
});
