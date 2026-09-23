import fs from 'node:fs';
import path from 'node:path';
import { normalizeCloudflareFrontendSource } from './materialize-cloudflare-frontend.mjs';

// Commercial funnel stays isolated from the clinical entrypoint and publishes only
// same-origin owned Cloudflare APIs for auth and owner-scoped clinical records.
const root = process.cwd();
const files = {
  html: path.join(root, 'public', 'comercial', 'index.html'),
  css: path.join(root, 'public', 'comercial', 'styles.css'),
  app: path.join(root, 'public', 'comercial', 'app.js'),
  config: path.join(root, 'public', 'comercial', 'config.js'),
  runtime: path.join(root, 'worker', 'cloudflare-clinical-runtime.js'),
  dataRuntime: path.join(root, 'worker', 'cloudflare-data-runtime.js'),
};

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

for (const [label, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) fail(`${label} file is missing: ${path.relative(root, file)}`);
}
if (process.exitCode) process.exit();

const html = fs.readFileSync(files.html, 'utf8');
const rawApp = fs.readFileSync(files.app, 'utf8');
const app = normalizeCloudflareFrontendSource(rawApp, 'public/comercial/app.js');
const config = fs.readFileSync(files.config, 'utf8');
const runtime = fs.readFileSync(files.runtime, 'utf8');
const dataRuntime = fs.readFileSync(files.dataRuntime, 'utf8');
const commercial = `${html}\n${app}\n${config}`.toLowerCase();

for (const forbidden of ['débora', 'debora-lactacao', 'src/bootstrap.js', 'phase02-loader']) {
  if (commercial.includes(forbidden)) fail(`commercial app must stay isolated; found ${forbidden}`);
}

for (const required of [
  'criar conta',
  'entrar',
  'onboarding-form',
  'professionalname',
  'businessname',
  'accounttype',
]) {
  if (!commercial.includes(required.toLowerCase())) fail(`commercial funnel missing ${required}`);
}

for (const endpoint of [
  '/api/auth/signup',
  '/api/auth/token?grant_type=password',
  '/api/clinical/records/saas_accounts',
  '/api/clinical/records/professional_profiles',
]) {
  if (!app.includes(endpoint)) fail(`materialized commercial app missing owned API endpoint ${endpoint}`);
}
if (/\/auth\/v1(?:\/|\b)|\/rest\/v1(?:\/|\b)|\/storage\/v1(?:\/|\b)/.test(app)) {
  fail('materialized commercial app must not publish compatibility API routes');
}

if (!config.includes("backend: 'cloudflare-d1'")) fail('commercial browser config must select Cloudflare D1');
if (!config.includes('apiBaseUrl: window.location.origin')) fail('commercial browser API must be same-origin');
if (!config.includes("clientRuntimeKey: 'cloudflare-runtime'")) fail('commercial runtime key must be Cloudflare-local');
if (/supabase/i.test(config)) fail('commercial browser config must not carry legacy Supabase naming');
if (/service[_-]?role/i.test(config)) fail('service role must never be present in browser config');
if (/sb_publishable_/i.test(config)) fail('external publishable key must not be required by the commercial browser config');
if (/eyJhbGciOi/i.test(config)) fail('legacy JWT anon key must not be committed to the commercial browser config');

if (!runtime.includes('cloudflare-auth-runtime.js')) fail('active clinical facade must use Cloudflare D1 auth');
if (!runtime.includes('cloudflare-data-runtime.js')) fail('active clinical facade must use the native D1/R2 data runtime');
if (/supabase\.co|LEGACY_SUPABASE|legacyAuth\s*\(|legacyUserForToken|allowLegacy\s*=\s*true/i.test(runtime)) {
  fail('active clinical facade must not contain Supabase auth fallback');
}

for (const required of [
  "'professional_profiles','saas_accounts'",
  'async function recordOwnedByUser',
  'async function scopedRows',
  'async function ensureWriteOwnership',
  'ownerRows(',
]) {
  if (!dataRuntime.includes(required)) fail(`Cloudflare owner-scoping contract missing: ${required}`);
}
if (/\/auth\/v1(?:\/|\b)|\/rest\/v1(?:\/|\b)|\/storage\/v1(?:\/|\b)/.test(dataRuntime)) {
  fail('native D1/R2 runtime must not expose retired compatibility routes');
}

if (!process.exitCode) console.log('PASS: commercial funnel is isolated, D1-authenticated and owner-scoped');
