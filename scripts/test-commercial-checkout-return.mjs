import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'public', 'comercial', 'app.js'), 'utf8');
const sandboxHtml = fs.readFileSync(path.join(root, 'public', 'comercial', 'sandbox-teste.html'), 'utf8');
const sandboxJs = fs.readFileSync(path.join(root, 'public', 'comercial', 'sandbox-teste.js'), 'utf8');

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
