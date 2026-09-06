import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const scriptPath = resolve(root, 'scripts/materialize-clinical-source.mjs');

const expectedCanonicalFiles = [
  'public/clinical-source/index.html',
  'public/clinical-source/styles.css',
  'public/clinical-source/config.js',
  'public/clinical-source/core/app-shell.js',
  'public/clinical-source/core/lib/supabase-client.js',
  'public/clinical-source/core/lib/auth-service.js',
  'public/clinical-source/core/lib/repositories.js',
  'public/clinical-source/core/lib/app-data.js',
  'public/clinical-source/core/lib/encounter-form.js',
  'public/clinical-source/core/lib/media-service.js',
  'public/clinical-source/core/lib/backup-service.js',
  'public/clinical-source/core/lib/pdf-service.js',
  'public/clinical-source/features/clinical-note-feature.js',
  'public/clinical-source/features/clinical-note-feature.css'
];

test('materializer verifies complete canonical clinical runtime without rewriting it', () => {
  assert.equal(existsSync(scriptPath), true, 'clinical source materializer must exist');
  const result = spawnSync(process.execPath, [scriptPath, '--verify'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'materializer verification failed');
  for (const relativePath of expectedCanonicalFiles) {
    assert.equal(existsSync(resolve(root, relativePath)), true, `${relativePath} must exist`);
  }
});
