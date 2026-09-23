import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { normalizeCloudflareFrontendSource } from '../scripts/materialize-cloudflare-frontend.mjs';

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
function runtimeText(path) { return normalizeCloudflareFrontendSource(text(path), path); }

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

test('materialized frontend modules use owned same-origin Cloudflare API families', () => {
  for (const path of TARGETS.slice(0, 7)) {
    const source = runtimeText(path);
    assert.doesNotMatch(source, /\/auth\/v1(?:\/|\b)|\/rest\/v1(?:\/|\b)|\/storage\/v1(?:\/|\b)/i, `${path} still emits a compatibility API route after materialization`);
    assert.doesNotMatch(source, /https:\/\/[^'"`]+\/api\/(?:auth|clinical|files|billing)/i, `${path} builds an external API URL`);
  }
  assert.match(runtimeText('public/canonical-identity-runtime.js'), /\/api\/auth\/user/);
  assert.match(runtimeText('public/canonical-identity-runtime.js'), /\/api\/clinical\/records\/professional_profiles/);
  assert.match(runtimeText('public/documents-feature.js'), /\/api\/clinical\/media\/upload/);
});
