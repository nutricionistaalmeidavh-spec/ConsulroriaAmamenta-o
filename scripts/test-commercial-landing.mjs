import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const htmlPath = path.join(root, 'public/comercial/index.html');
const cssPath = path.join(root, 'public/comercial/styles.css');
const motionPath = path.join(root, 'public/comercial/landing.js');
const phase2CssPath = path.join(root, 'public/comercial/phase2.css');
const realPreviewCssPath = path.join(root, 'public/comercial/real-preview.css');
const productPreviewPath = path.join(root, 'public/comercial/product-preview.html');
const officialLogoPath = path.join(root, 'public/icon.svg');
const logoMotionCssPath = path.join(root, 'public/comercial/logo-motion.css');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

for (const file of [htmlPath, cssPath, motionPath]) {
  if (!fs.existsSync(file)) fail(`missing ${path.relative(root, file)}`);
}
if (process.exitCode) process.exit();

const html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const motion = fs.readFileSync(motionPath, 'utf8');
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
if (!css.includes('--brand: #6b3f50;')) fail('existing commercial palette must be preserved');
if (!css.includes('@media (prefers-reduced-motion: reduce)')) fail('reduced-motion fallback is missing');

// Official logo contract. Header animates with page scroll; footer must render a full real logo.
if ((html.match(/src="\.\.\/icon\.svg"/g) || []).length < 2) fail('header and footer must retain static official logo fallbacks');
if (!fs.existsSync(officialLogoPath)) {
  fail('official vector logo public/icon.svg is missing');
} else {
  const officialLogo = fs.readFileSync(officialLogoPath, 'utf8');
  if (!officialLogo.includes('viewBox="0 0 290 290"')) fail('official logo geometry changed');
  if (!officialLogo.includes('linearGradient id="bg"')) fail('official logo gradient is missing');
}
if (!fs.existsSync(logoMotionCssPath)) {
  fail('scroll-reactive logo stylesheet is missing');
} else {
  const logoMotionCss = fs.readFileSync(logoMotionCssPath, 'utf8');
  if (!logoMotionCss.includes('.brand-mark[data-logo-motion]')) fail('scroll-reactive logo styles are missing');
  if (!logoMotionCss.includes('.footer-brand .brand-logo-motion')) fail('footer official logo rendering is missing');
  if (!logoMotionCss.includes('@media (prefers-reduced-motion: reduce)')) fail('logo motion reduced-motion fallback is missing');
}
for (const token of ['mountLogoMotion', 'data-logo-part="mother"', 'data-logo-part="baby"', 'data-logo-part="heart"', 'updateLogoMotion', 'logoMotionProgress', 'logo-motion.css', 'document.documentElement.scrollHeight']) {
  if (!motion.includes(token)) fail(`scroll-reactive logo controller missing ${token}`);
}

// Phase 2 visual contract: visual refinement must stay isolated from auth/checkout.
if (!fs.existsSync(phase2CssPath)) fail('Phase 2 visual stylesheet is missing');
if (!motion.includes("phase2.css")) fail('landing.js must load the isolated Phase 2 stylesheet');
if (!motion.includes("phase2-visual")) fail('landing.js must opt the commercial page into Phase 2 visual mode');
if (!motion.includes("billing-switch")) fail('Pro monthly/annual billing switch is missing');
if (!motion.includes("data-stage")) fail('interactive product story stage state is missing');
if (!motion.includes("story-step")) fail('product story step controller is missing');
if (!motion.includes("prefers-reduced-motion")) fail('Phase 2 interactions must preserve reduced-motion behavior');

if (fs.existsSync(phase2CssPath)) {
  const phase2Css = fs.readFileSync(phase2CssPath, 'utf8');
  for (const token of [
    '.phase2-visual .hero',
    '.phase2-visual .feature-grid',
    '.billing-switch',
    '.phase2-visual .auth-modal',
    '@media (prefers-reduced-motion: reduce)',
  ]) {
    if (!phase2Css.includes(token)) fail(`Phase 2 stylesheet missing ${token}`);
  }
  if (!phase2Css.includes('.comparison-mobile')) fail('mobile plan comparison replacement is missing');
  if (!phase2Css.includes('@media (max-width: 760px)')) fail('mobile layout contract is missing');
}

// Product preview contract: real clinical screens, distinct cards, safe crops and no fake placeholders.
if (!fs.existsSync(productPreviewPath)) {
  fail('real clinical product preview is missing');
} else {
  const productPreview = fs.readFileSync(productPreviewPath, 'utf8');
  if (!productPreview.includes('../clinical-source/styles.css')) fail('product preview must reuse clinical-source styles');
  if (!productPreview.includes('../album-feature.css')) fail('media preview must reuse the real album feature styles');
  for (const token of ['lactation-shell', 'lactation-kpis', 'agenda-card', 'patient-grid', 'patient-detail-grid', 'library-grid', 'af-grid']) {
    if (!productPreview.includes(token)) fail(`product preview must reuse real clinical UI class ${token}`);
  }
  for (const screen of ['home', 'agenda', 'patients', 'appointment', 'patient', 'library', 'media']) {
    if (!productPreview.includes(`data-preview-screen="${screen}"`)) fail(`missing distinct real product preview screen ${screen}`);
  }
  if (!productPreview.includes('dados demonstrativos')) fail('product preview must identify demo-safe data');
}
if (!motion.includes('product-preview.html')) fail('landing.js must embed the real product preview');
if (!motion.includes('previewScreenByStage')) fail('product story must map stages to real product screens');
if (!motion.includes('setPreviewScreen')) fail('product story must update the real product preview screen');

// Hero must alternate multiple real screens and allow manual/swipe navigation.
for (const token of ['heroPreviewScreens', 'hero-preview-controls', 'setHeroPreview', 'startHeroPreviewRotation', 'pointerdown', 'pointerup']) {
  if (!motion.includes(token)) fail(`hero real-screen carousel missing ${token}`);
}

// Every feature card needs a distinct real preview; fixed pixel iframe widths caused the mobile crops in production.
if (!motion.includes("screen: 'agenda'")) fail('agenda feature preview missing');
if (!motion.includes("screen: 'patients'")) fail('patients feature preview missing');
if (!motion.includes("screen: 'appointment'")) fail('appointment feature preview missing');
if (!motion.includes("screen: 'patient'")) fail('patient feature preview missing');
if (!motion.includes("screen: 'library'")) fail('library feature preview missing');
if (!motion.includes("screen: 'media'")) fail('media feature preview missing');
if (!fs.existsSync(realPreviewCssPath)) {
  fail('real preview stylesheet is missing');
} else {
  const realPreviewCss = fs.readFileSync(realPreviewCssPath, 'utf8');
  if (realPreviewCss.includes('width: 390px')) fail('mobile preview must not use fixed 390px iframe width');
  if (realPreviewCss.includes('width: 760px')) fail('feature preview must not use fixed 760px iframe width');
  if (!realPreviewCss.includes('calc(100% / var(--preview-scale))')) fail('feature preview must size from its crop container');
  if (!realPreviewCss.includes('.feature-card:nth-child(6).has-real-preview')) fail('Pro media card crop styling is missing');
}

if (!process.exitCode) console.log('PASS: commercial landing mobile visual contract');
