import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
function readArtifact(relativePath) {
  const built = path.join(root, 'dist', relativePath);
  const source = path.join(root, 'public', relativePath);
  return fs.readFileSync(fs.existsSync(built) ? built : source, 'utf8');
}

const app = readArtifact(path.join('comercial', 'app.js'));
const sandboxHtml = readArtifact(path.join('comercial', 'sandbox-teste.html'));
const sandboxJs = readArtifact(path.join('comercial', 'sandbox-teste.js'));

function requireText(source, text, label) {
  if (!source.includes(text)) {
    console.error(`FAIL: ${label} missing ${text}`);
    process.exitCode = 1;
  }
}

requireText(sandboxHtml, 'index.html?return=sandbox&auto=1', 'sandbox access link');
requireText(app, "commercial.saas.return.v1", 'commercial return context');
requireText(app, "'/api/asaas/checkout'", 'production Pro checkout');
requireText(app, "'/api/sandbox/asaas/checkout'", 'sandbox Pro checkout');
requireText(app, 'redirect_to=', 'email confirmation redirect');
requireText(app, 'sandbox-teste.html?auto=1', 'post-onboarding sandbox return');
requireText(sandboxJs, "searchParams.get('auto') === '1'", 'sandbox auto checkout');

if (!process.exitCode) console.log('PASS: commercial Pro checkout and sandbox return contract');
