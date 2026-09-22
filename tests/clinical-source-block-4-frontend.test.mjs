import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ACTIVE_ROOTS = ['public', 'src', 'app'];
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.html', '.json', '.webmanifest']);
const ALLOWED_TRANSITIONAL_FILES = new Set([
  'src/cloudflare-fetch-bridge.js',
]);
const RETIRED_BACKEND_PATTERNS = [
  /zxowxdfhtksevhnjmeyu/i,
  /https:\/\/[^'"`\s]+\.supabase\.co/i,
  /sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt/i,
];

function activeFrontendFiles() {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const repoPath = relative(root, full).replaceAll('\\', '/');
      if (!TEXT_EXTENSIONS.has(extname(entry.name))) continue;
      if (ALLOWED_TRANSITIONAL_FILES.has(repoPath)) continue;
      files.push(repoPath);
    }
  };
  for (const path of ACTIVE_ROOTS) walk(resolve(root, path));
  return files;
}

test('active browser runtime contains no retired Supabase project origin or publishable key', () => {
  const offenders = [];
  for (const path of activeFrontendFiles()) {
    const source = readFileSync(resolve(root, path), 'utf8');
    for (const pattern of RETIRED_BACKEND_PATTERNS) {
      if (pattern.test(source)) offenders.push(`${path}: ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], `retired backend material found in active frontend:\n${offenders.join('\n')}`);
});

test('clinical base config is same-origin Cloudflare and cannot reintroduce the retired host', () => {
  const source = readFileSync(resolve(root, 'patch-source/base/config.js'), 'utf8');
  for (const pattern of RETIRED_BACKEND_PATTERNS) assert.doesNotMatch(source, pattern);
  assert.match(source, /window\.location\.origin/);
  assert.match(source, /cloudflare-runtime/);
});

test('Block 4 frontend modules resolve compatibility APIs on the current origin', () => {
  const targets = [
    'public/feeding-assessment-history-feature.js',
    'public/clinical-care-flow-feature.js',
    'public/billing-v2.js',
    'public/package-audit-feature.js',
    'public/documents-feature.js',
    'public/canonical-identity-runtime.js',
    'public/patient-fixes-v2.js',
  ];
  for (const path of targets) {
    const source = readFileSync(resolve(root, path), 'utf8');
    for (const pattern of RETIRED_BACKEND_PATTERNS) assert.doesNotMatch(source, pattern, `${path} still targets retired backend`);
    assert.match(source, /window\.location\.origin|location\.origin|^\s*const\s+\w+_ORIGIN\s*=\s*['"]['"]/m, `${path} must use current-origin Cloudflare routing`);
  }
});
