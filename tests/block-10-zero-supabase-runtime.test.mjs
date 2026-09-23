import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';

import { normalizeCloudflareFrontendSource } from '../scripts/materialize-cloudflare-frontend.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ENTRY = resolve(ROOT, 'worker/domain-entry.js');
const FORBIDDEN_RUNTIME = /supabase\.co|LEGACY_SUPABASE|SUPABASE_URL|SUPABASE_KEY|\/functions\/v1/i;
const FORBIDDEN_COMPAT_ROUTES = /\/auth\/v1(?:\/|\b)|\/rest\/v1(?:\/|\b)|\/storage\/v1(?:\/|\b)/;

function read(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, resolve(base, 'index.js')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function activeWorkerGraph(entry = ENTRY) {
  const seen = new Set();
  const visit = (file) => {
    if (!file || seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    const patterns = [
      /\bfrom\s+['"]([^'"]+)['"]/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) visit(resolveImport(file, match[1]));
    }
  };
  visit(entry);
  return [...seen];
}

test('active Worker import graph contains no Supabase backend material', () => {
  const graph = activeWorkerGraph();
  assert.ok(graph.length > 1, 'worker graph should include imported modules');
  const offenders = [];
  for (const file of graph) {
    const source = readFileSync(file, 'utf8');
    if (FORBIDDEN_RUNTIME.test(source)) offenders.push(relative(ROOT, file));
  }
  assert.deepEqual(offenders, [], `Supabase runtime material remains in active Worker graph:\n${offenders.join('\n')}`);
});

test('active Worker uses only owned auth, clinical and files route families', () => {
  const graph = activeWorkerGraph();
  const offenders = [];
  for (const file of graph) {
    const source = readFileSync(file, 'utf8');
    if (FORBIDDEN_COMPAT_ROUTES.test(source)) offenders.push(relative(ROOT, file));
  }
  assert.deepEqual(offenders, [], `compatibility route families remain in active Worker graph:\n${offenders.join('\n')}`);

  const domain = read('worker/domain-entry.js');
  assert.match(domain, /\/api\/auth/);
  assert.match(domain, /\/api\/clinical/);
  assert.match(domain, /\/api\/files/);
  assert.doesNotMatch(domain, /cloudflare-clinical-legacy-runtime|worker\/index\.js|\.\/index\.js/);
});

test('native auth runtime is D1-only and migrated users without credentials fail closed', () => {
  const auth = read('worker/cloudflare-auth-runtime.js');
  assert.doesNotMatch(auth, FORBIDDEN_RUNTIME);
  assert.doesNotMatch(auth, FORBIDDEN_COMPAT_ROUTES);
  assert.match(auth, /password_reset_required/);
  assert.match(auth, /\/api\/auth\/token/);
  assert.match(auth, /\/api\/auth\/signup/);
  assert.match(auth, /\/api\/auth\/user/);
  assert.match(auth, /\/api\/auth\/logout/);
});

test('clinical native runtimes no longer depend on compatibility translation', () => {
  for (const path of [
    'worker/cloudflare-clinical-runtime.js',
    'worker/cloudflare-growth-runtime.js',
    'worker/cloudflare-upsert-runtime.js',
    'worker/block6-rpc-runtime.js',
    'worker/package-lifecycle-runtime.js',
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, FORBIDDEN_COMPAT_ROUTES, `${path} still uses retired route families`);
    assert.doesNotMatch(source, FORBIDDEN_RUNTIME, `${path} still carries Supabase backend material`);
  }
  assert.equal(existsSync(resolve(ROOT, 'worker/cloudflare-data-runtime.js')), true, 'native clinical data runtime must exist');
});

test('materialized browser output is zero-Supabase and uses owned APIs only', () => {
  const publicRoot = resolve(ROOT, 'public');
  const offenders = [];
  for (const file of walk(publicRoot)) {
    if (!['.js', '.mjs', '.html', '.json', '.webmanifest'].includes(extname(file).toLowerCase())) continue;
    const rel = relative(ROOT, file).replaceAll('\\', '/');
    const normalized = normalizeCloudflareFrontendSource(readFileSync(file, 'utf8'), rel);
    if (FORBIDDEN_RUNTIME.test(normalized) || FORBIDDEN_COMPAT_ROUTES.test(normalized)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `forbidden backend material remains in published frontend sources:\n${offenders.join('\n')}`);
});
