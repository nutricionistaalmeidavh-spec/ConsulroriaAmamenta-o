import { unzipSync } from 'fflate';
import { CANONICAL_PRODUCT_NAME, CANONICAL_PRODUCT_SHORT_NAME, resolveAppIdentity } from './app-identity.js';

window.__deboraUnzipSync = unzipSync;

const APP_CONTEXT = resolveAppIdentity(window.location);
window.CANONICAL_APP_CONTEXT = APP_CONTEXT;
const APP_URL = `${window.location.origin}${APP_CONTEXT.basePath}`;
const CLINICAL_SOURCE_ROOT = '/clinical-source';
const LEGACY_CLINICAL_SESSION_KEY = 'debora-lactacao-session';
const CANONICAL_SESSION_KEY = 'amamentacao-session';
const COMMERCIAL_SESSION_KEY = 'commercial.saas.session.v1';

const MODULE_PATHS = [
  'lib/supabase-client.js',
  'lib/auth-service.js',
  'lib/repositories.js',
  'lib/app-data.js',
  'lib/encounter-form.js',
  'lib/media-service.js',
  'lib/backup-service.js',
  'lib/pdf-service.js',
];

const CLINICAL_RUNTIME_PATHS = [
  'index.html',
  'styles.css',
  'config.js',
  'core/app-shell.js',
  'core/lib/supabase-client.js',
  'core/lib/auth-service.js',
  'core/lib/repositories.js',
  'core/lib/app-data.js',
  'core/lib/encounter-form.js',
  'core/lib/media-service.js',
  'core/lib/backup-service.js',
  'core/lib/pdf-service.js',
  'features/clinical-note-feature.js',
  'features/clinical-note-feature.css',
  'features/patient-fixes.css',
];

function validStoredSession(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.access_token ? parsed : null;
  } catch {
    return null;
  }
}

function bridgeCompatibleSession() {
  try {
    const legacyRaw = sessionStorage.getItem(LEGACY_CLINICAL_SESSION_KEY);
    const canonicalRaw = sessionStorage.getItem(CANONICAL_SESSION_KEY);
    const commercialRaw = sessionStorage.getItem(COMMERCIAL_SESSION_KEY);
    const legacy = validStoredSession(legacyRaw);
    const canonical = validStoredSession(canonicalRaw);
    const commercial = validStoredSession(commercialRaw);

    // The persistent session is authoritative after rotation. Explicit commercial
    // handoff writes it before navigation; a reload must never restore old tokens.
    const storedRaw = localStorage.getItem(LEGACY_CLINICAL_SESSION_KEY);
    const selected = validStoredSession(storedRaw) ? storedRaw
      : APP_CONTEXT.entryMode === 'app' && commercial ? commercialRaw
        : legacy ? legacyRaw : canonical ? canonicalRaw : null;
    if (!selected) return;
    localStorage.setItem(LEGACY_CLINICAL_SESSION_KEY, selected);
    for (const key of [LEGACY_CLINICAL_SESSION_KEY, CANONICAL_SESSION_KEY, COMMERCIAL_SESSION_KEY]) {
      sessionStorage.setItem(key, selected);
    }
  } catch {
    // Restricted browser contexts may block sessionStorage. Login remains available.
  }
}

bridgeCompatibleSession();

if ('serviceWorker' in navigator) {
  let reloading = false;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

async function cleanupLegacyServiceWorkers() {
  if (!('serviceWorker' in navigator)) return false;

  let registrations;
  try {
    registrations = await navigator.serviceWorker.getRegistrations();
  } catch {
    return false;
  }

  const controllerUrl = navigator.serviceWorker.controller?.scriptURL || '';
  let removedActiveController = false;

  for (const registration of registrations) {
    const workerUrls = [registration.installing, registration.waiting, registration.active]
      .map((worker) => worker?.scriptURL)
      .filter(Boolean);

    const canonicalWorker = workerUrls.some((scriptUrl) => {
      try {
        const parsed = new URL(scriptUrl, location.href);
        return parsed.origin === location.origin && parsed.pathname === '/sw.js';
      } catch {
        return false;
      }
    });
    let canonicalScope = false;
    try {
      canonicalScope = new URL(registration.scope).pathname === '/';
    } catch {
      canonicalScope = false;
    }
    if (canonicalWorker && canonicalScope) continue;

    if (controllerUrl && workerUrls.includes(controllerUrl)) removedActiveController = true;
    try {
      await registration.unregister();
    } catch {
      // A failed legacy cleanup must not prevent the current application from loading.
    }
  }

  if (removedActiveController) {
    location.reload();
    return true;
  }
  return false;
}

async function loadCanonicalText(path) {
  try {
    const response = await fetch(`${CLINICAL_SOURCE_ROOT}/${path}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function loadCanonicalRuntime() {
  const entries = await Promise.all(CLINICAL_RUNTIME_PATHS.map(async (path) => {
    const canonicalText = await loadCanonicalText(path);
    return [path, canonicalText ?? null];
  }));

  if (entries.some(([, value]) => value === null)) return null;
  return Object.fromEntries(entries);
}

function memberOnly() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/member-feature.css';
  document.head.appendChild(link);
  document.body.innerHTML = '<div id="member-portal-root"></div>';

  const script = document.createElement('script');
  script.type = 'module';
  script.src = '/member-feature.js';
  document.body.appendChild(script);
}

function moduleUrl(source) {
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
}

function genericizeClinicalConfig(source) {
  return source.replace("APP_NAME: 'Débora Lactação'", `APP_NAME: '${CANONICAL_PRODUCT_NAME}'`);
}

function genericizeRuntimeModule(path, source) {
  if (path === 'lib/auth-service.js') {
    return source.replace(
      "signUp: (email, password) => client.signUp(String(email || '').trim(), String(password || ''), { display_name: 'Débora' }),",
      "signUp: (email, password, metadata = {}) => client.signUp(String(email || '').trim(), String(password || ''), metadata),",
    );
  }
  if (path === 'lib/supabase-client.js') {
    return source.replace(
      "async function signUp(email, password, metadata = { display_name: 'Débora' }) {",
      'async function signUp(email, password, metadata = {}) {',
    );
  }
  return source;
}

function genericizeClinicalHtml(source) {
  return source
    .replaceAll('Débora Lactação', CANONICAL_PRODUCT_NAME)
    .replace('<meta name="apple-mobile-web-app-title" content="Débora">', `<meta name="apple-mobile-web-app-title" content="${CANONICAL_PRODUCT_SHORT_NAME}">`)
    .replace('<div class="auth-mark">DL</div>', '<div class="auth-mark">AM</div>')
    .replace('No primeiro uso, crie o acesso com o e-mail da Débora. Depois use sempre o mesmo login.', 'Use seu e-mail profissional para acessar seus dados com segurança.')
    .replace('<div class="template-brand lactation-brand"><span class="template-brand-mark lactation-brand-mark">D</span><span>Gestão de Amamentação</span></div>', '<div class="template-brand lactation-brand"><span class="template-brand-mark lactation-brand-mark">A</span><span data-product-name>Gestão de Amamentação</span></div>')
    .replace('<div class="lactation-profile-mini"><div class="lactation-avatar">DA</div><div><strong>Débora</strong><span>Consultora de amamentação</span></div></div>', '<div class="lactation-profile-mini"><div class="lactation-avatar">P</div><div><strong data-professional-name>Profissional</strong><span>Consultora de amamentação</span></div></div>')
    .replace('<div class="lactation-mobile-brand mobile-only"><span class="template-brand-mark lactation-brand-mark">D</span><div><strong>Gestão de Amamentação</strong><small data-page-title>Início</small></div></div>', '<div class="lactation-mobile-brand mobile-only"><span class="template-brand-mark lactation-brand-mark">A</span><div><strong data-product-name>Gestão de Amamentação</strong><small data-page-title>Início</small></div></div>')
    .replace('<h1 data-home-greeting>Olá, Débora</h1>', '<h1 data-home-greeting>Olá, Profissional</h1>');
}

function genericizeClinicalShell(source) {
  let shell = `const CANONICAL_PRODUCT_NAME = globalThis.CANONICAL_APP_CONTEXT?.productName || 'Gestão de Amamentação';\nconst currentProfessionalName = () => globalThis.CANONICAL_PROFESSIONAL_NAME || 'Profissional';\n${source}`;
  return shell
    .replaceAll("titles[screen] || 'Débora Lactação'", 'titles[screen] || CANONICAL_PRODUCT_NAME')
    .replace("setText('[data-home-date]', `${greeting}, Débora ♥`);", "setText('[data-home-date]', `${greeting}, ${currentProfessionalName()} ♥`);")
    .replace("createCarePlanPdf({ title: 'Débora Lactação',", 'createCarePlanPdf({ title: CANONICAL_PRODUCT_NAME,')
    .replace('`debora-lactacao-backup-${new Date().toISOString().slice(0,10)}.json`', '`gestao-amamentacao-backup-${new Date().toISOString().slice(0,10)}.json`');
}

function importPublicModule(path) {
  return import(/* @vite-ignore */ path);
}

async function ensureClinicalPhaseLoaders() {
  const phase02 = await importPublicModule('/phase02-loader.js');
  await phase02.startPhase02?.();
  const phase35 = await importPublicModule('/phase35-loader.js');
  await phase35.startPhase35?.();
  const phase68 = await importPublicModule('/phase68-loader.js');
  await phase68.startPhase68?.();
}

async function ensureClinicalAdditiveFeatures() {
  // The outer entry imports this feature before the canonical document is replaced.
  // Re-import under a distinct module URL after document.close() so its observer and
  // initial mount bind to the live clinical DOM instead of the discarded placeholder.
  await importPublicModule('/clinical-care-flow-feature.js?canonical-runtime=1');
}

async function boot() {
  if (await cleanupLegacyServiceWorkers()) return;

  if (location.hash.startsWith('#mae')) {
    memberOnly();
    return;
  }

  const canonicalRuntime = await loadCanonicalRuntime();
  if (!canonicalRuntime) throw new Error('Aplicativo indisponível. Verifique sua conexão e tente novamente.');
  const runtime = canonicalRuntime;
  const moduleUrls = {};

  for (const path of MODULE_PATHS) {
    moduleUrls[path] = moduleUrl(genericizeRuntimeModule(path, runtime[`core/${path}`]));
  }

  let shell = genericizeClinicalShell(runtime['core/app-shell.js']);
  for (const path of MODULE_PATHS) {
    shell = shell.replace(`'./${path}'`, `'${moduleUrls[path]}'`);
  }
  shell = shell.replace(
    "navigator.serviceWorker.register('./service-worker.js')",
    "navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => registration.update())",
  );

  const shellUrl = moduleUrl(shell);
  const clinicalUrl = moduleUrl(runtime['features/clinical-note-feature.js']);
  const patientUrl = '/patient-fixes-v2.js';
  const css = runtime['styles.css'];
  const config = genericizeClinicalConfig(runtime['config.js']);

  let html = genericizeClinicalHtml(runtime['index.html']);
  html = html
    .replace('<link rel="stylesheet" href="./styles.css">', `<style>${css}</style>`)
    .replaceAll('./icons/app-icon.svg', '/icon-512.png?v=1.12.1')
    .replace('<script src="./config.js"></script>', '')
    .replace('<script type="module" src="./app-shell.js"></script>', '')
    .replace(
      '</head>',
      `<meta name="theme-color" content="#fbf7f4"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icon-512.png?v=1.12.1"><link rel="icon" type="image/png" href="/icon-192.png?v=1.12.1"><link rel="stylesheet" href="/growth-feature.css"><link rel="stylesheet" href="/member-feature.css"><link rel="stylesheet" href="/library-disabled.css"><link rel="stylesheet" href="/template-gallery.css"><link rel="stylesheet" href="/interaction-ui.css"><link rel="stylesheet" href="/improvements-v2.css"><link rel="stylesheet" href="/billing-v2.css"><link rel="stylesheet" href="/phase8-design.css"><link rel="stylesheet" href="/mobile-layout-integrity.css"><style>${runtime['features/clinical-note-feature.css']}</style><style>${runtime['features/patient-fixes.css']}</style></head>`,
    )
    .replace(
      '</body>',
      `<script>${config}</script><script type="module" src="/canonical-identity-runtime.js"></script><script type="module" src="${shellUrl}"></script><script type="module" src="/growth-feature.js"></script><script type="module" src="/member-feature.js"></script><script type="module" src="/library-disabled.js"></script><script type="module" src="/template-gallery.js"></script><script type="module" src="/interaction-ui.js"></script><script type="module" src="${clinicalUrl}"></script><script type="module" src="${patientUrl}"></script><script type="module" src="/billing-v2.js"></script><script type="module" src="/p0-route-guard.js"></script></body>`,
    );

  document.open();
  document.write(html);
  document.close();
  await ensureClinicalPhaseLoaders();
  await ensureClinicalAdditiveFeatures();
}

boot().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main style="font-family:system-ui;padding:24px;max-width:560px;margin:auto"><h1>${CANONICAL_PRODUCT_NAME}</h1><p>Não foi possível carregar o aplicativo.</p><p>${String(error?.message || error)}</p><button onclick="location.reload()">Tentar novamente</button></main>`;
});
