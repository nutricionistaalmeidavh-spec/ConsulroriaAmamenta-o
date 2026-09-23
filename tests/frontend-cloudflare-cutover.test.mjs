import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = resolve(ROOT, 'public');
const RETIRED = [
  /zxowxdfhtksevhnjmeyu/i,
  /\.supabase\.co/i,
  /sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt/i,
];
const TARGETS = [
  'public/feeding-assessment-history-feature.js',
  'public/clinical-care-flow-feature.js',
  'public/billing-v2.js',
  'public/package-audit-feature.js',
  'public/documents-feature.js',
  'public/canonical-identity-runtime.js',
  'public/patient-fixes-v2.js',
  'public/clinical-source/config.js',
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (/\.(?:js|mjs|html|json|webmanifest)$/i.test(name)) out.push(path);
  }
  return out;
}

function text(path) { return readFileSync(resolve(ROOT, path), 'utf8'); }

test('public runtime assets contain no retired Supabase project origin or publishable key', () => {
  const offenders = [];
  for (const path of walk(PUBLIC)) {
    const source = readFileSync(path, 'utf8');
    for (const pattern of RETIRED) {
      if (pattern.test(source)) offenders.push(`${relative(ROOT, path)} -> ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], `retired backend material remains in public runtime:\n${offenders.join('\n')}`);
});

test('Block 4 frontend modules no longer depend on Supabase configuration names', () => {
  for (const path of TARGETS) {
    const source = text(path);
    assert.doesNotMatch(source, /SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY/i, `${path} still depends on Supabase config`);
  }
});

test('migrated frontend modules use same-origin Cloudflare compatibility routes', () => {
  for (const path of TARGETS.slice(0, 7)) {
    const source = text(path);
    assert.doesNotMatch(source, /https:\/\/[^'"`]+\/rest\/v1|https:\/\/[^'"`]+\/storage\/v1|https:\/\/[^'"`]+\/auth\/v1/i, `${path} still builds an external backend URL`);
  }
  assert.match(text('public/canonical-identity-runtime.js'), /\/auth\/v1\/user/);
  assert.match(text('public/documents-feature.js'), /\/api\/clinical\/media\/upload/);
});
