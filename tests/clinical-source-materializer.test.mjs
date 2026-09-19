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

test('materializer regenerates and then verifies the canonical clinical runtime deterministically', () => {
  assert.equal(existsSync(scriptPath), true, 'clinical source materializer must exist');

  const writeResult = spawnSync(process.execPath, [scriptPath, '--write'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(writeResult.status, 0, writeResult.stderr || writeResult.stdout || 'clinical source materialization failed');

  const verifyResult = spawnSync(process.execPath, [scriptPath, '--verify'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(verifyResult.status, 0, verifyResult.stderr || verifyResult.stdout || 'materializer verification failed');

  for (const relativePath of expectedCanonicalFiles) {
    assert.equal(existsSync(resolve(root, relativePath)), true, `${relativePath} must exist`);
  }
});