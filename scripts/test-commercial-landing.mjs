import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const htmlPath = path.join(root, 'public/comercial/index.html');
const cssPath = path.join(root, 'public/comercial/styles.css');
const motionPath = path.join(root, 'public/comercial/landing.js');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

for (const file of [htmlPath, cssPath]) {
  if (!fs.existsSync(file)) fail(`missing ${path.relative(root, file)}`);
}
if (process.exitCode) process.exit();

const html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const lower = html.toLowerCase();

const requiredSections = [
  'id="problema"',
  'id="produto"',
  'id="recursos"',
  'id="para-quem"',
  'id="planos"',
  'id="faq"',
];
for (const section of requiredSections) {
  if (!lower.includes(section)) fail(`missing sales-story section ${section}`);
}

for (const phrase of [
  'começar grátis',
  'até 3 mães/pacientes',
  'r$ 49,90/mês',
  'r$ 499/ano',
  'upload de fotos e vídeos',
]) {
  if (!lower.includes(phrase)) fail(`missing commercial promise: ${phrase}`);
}

if ((html.match(/<details\b/g) || []).length < 6) fail('FAQ must contain at least 6 native details items');
if (!html.includes('class="comparison-table"')) fail('plan comparison table is missing');
if (!html.includes('data-plan="freemium" data-open="signup"')) fail('Freemium CTA contract changed');
if (!html.includes('data-plan="pro_monthly" data-open="signup"')) fail('monthly Pro CTA contract changed');
if (!html.includes('data-plan="pro_annual" data-open="signup"')) fail('annual Pro CTA contract changed');

for (const contract of ['id="auth-modal"', 'id="signup-form"', 'id="login-form"', 'id="onboarding-form"', 'id="plan-intent"', 'id="form-message"']) {
  if (!html.includes(contract)) fail(`auth contract removed: ${contract}`);
}

if (!html.includes('src="./landing.js')) fail('isolated landing motion script is missing');
if (!fs.existsSync(motionPath)) fail('public/comercial/landing.js is missing');
if (!css.includes('--brand: #6b3f50;')) fail('existing commercial palette must be preserved');
if (!css.includes('@media (prefers-reduced-motion: reduce)')) fail('reduced-motion fallback is missing');

if (!process.exitCode) console.log('PASS: commercial landing sales-story contract');
