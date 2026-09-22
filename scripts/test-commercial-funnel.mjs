import fs from 'node:fs';
import path from 'node:path';

// Commercial funnel stays isolated from the clinical entrypoint while using the
// Cloudflare same-origin compatibility API for auth and owner-scoped REST calls.
const root = process.cwd();
const files = {
  html: path.join(root, 'public', 'comercial', 'index.html'),
  css: path.join(root, 'public', 'comercial', 'styles.css'),
  app: path.join(root, 'public', 'comercial', 'app.js'),
  config: path.join(root, 'public', 'comercial', 'config.js'),
  runtime: path.join(root, 'worker', 'cloudflare-clinical-runtime.js'),
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
const app = fs.readFileSync(files.app, 'utf8');
const config = fs.readFileSync(files.config, 'utf8');
const runtime = fs.readFileSync(files.runtime, 'utf8');
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

// Compatibility paths remain stable, but they resolve against the same-origin Cloudflare runtime.
for (const endpoint of [
  '/auth/v1/signup',
  '/auth/v1/token?grant_type=password',
  '/rest/v1/saas_accounts',
  '/rest/v1/professional_profiles',
]) {
  if (!app.includes(endpoint)) fail(`commercial app missing API endpoint ${endpoint}`);
}

if (!config.includes("backend: 'cloudflare-d1'")) fail('commercial browser config must select Cloudflare D1');
if (!config.includes('apiBaseUrl: window.location.origin')) fail('commercial browser API must be same-origin');
if (!config.includes("clientRuntimeKey: 'cloudflare-runtime'")) fail('commercial runtime key must be Cloudflare-local');
if (/supabase/i.test(config)) fail('commercial browser config must not carry legacy Supabase naming');
if (/service[_-]?role/i.test(config)) fail('service role must never be present in browser config');
if (/sb_publishable_/i.test(config)) fail('external publishable key must not be required by the commercial browser config');
if (/eyJhbGciOi/i.test(config)) fail('legacy JWT anon key must not be committed to the commercial browser config');

// Cloudflare performs owner scoping server-side instead of relying on external database policies.
for (const required of [
  "'professional_profiles','saas_accounts'",
  'async function recordOwnedByUser',
  'async function ensureWriteOwnership',
  "if (!await recordOwnedByUser(env, table, entry, user.id)) continue",
  "return runtimeJson(403, { message: 'Registro fora do escopo da conta.' })",
]) {
  if (!runtime.includes(required)) fail(`Cloudflare owner-scoping contract missing: ${required}`);
}

if (!process.exitCode) console.log('PASS: commercial funnel is isolated, Cloudflare-backed and owner-scoped');
