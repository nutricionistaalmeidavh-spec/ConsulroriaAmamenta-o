import { unzipSync, strFromU8 } from 'fflate';
import { CANONICAL_PRODUCT_NAME, CANONICAL_PRODUCT_SHORT_NAME, resolveAppIdentity } from './app-identity.js';

window.__deboraUnzipSync = unzipSync;

const AUTH_ORIGIN = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
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

    // `/app/` is reached from the commercial funnel. In that context the authenticated
    // commercial session is authoritative and may safely seed the existing clinical key.
    if (APP_CONTEXT.entryMode === 'app' && commercial) {
      sessionStorage.setItem(LEGACY_CLINICAL_SESSION_KEY, commercialRaw);
      sessionStorage.setItem(CANONICAL_SESSION_KEY, commercialRaw);
      return;
    }

    // Root compatibility keeps Débora's already established clinical session untouched.
    if (legacy && !canonical) sessionStorage.setItem(CANONICAL_SESSION_KEY, legacyRaw);
    else if (!legacy && canonical) sessionStorage.setItem(LEGACY_CLINICAL_SESSION_KEY, canonicalRaw);
  } catch {
    // Restricted browser contexts may block sessionStorage. Login remains available.
  }
}

bridgeCompatibleSession();

function installAuthRedirectGuard() {
  if (window.__deboraAuthRedirectGuard) return;
  window.__deboraAuthRedirectGuard = true;

  const nativeFetch = window.fetch.bind(window);
  const remember = (token) => {
    if (!token || token.split('.').length !== 3) return;
    window.__deboraAccessToken = token;
    try {
      sessionStorage.setItem('debora-runtime-access-token', token);
    } catch {
      // Session storage can be unavailable in restricted browser contexts.
    }
  };

  window.fetch = (input, init) => {
    let nextInput = input;
    let nextInit = init;

    try {
      const raw = typeof input === 'string' || input instanceof URL
        ? String(input)
        : input instanceof Request
          ? input.url
          : null;
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      const auth = headers.get('Authorization') || '';

      if (/^Bearer\s+\S+/i.test(auth)) remember(auth.replace(/^Bearer\s+/i, '').trim());

      if (raw && raw.startsWith(`${AUTH_ORIGIN}/auth/v1/`)) {
        const url = new URL(raw);
        if (
          ['/auth/v1/signup', '/auth/v1/recover', '/auth/v1/otp'].includes(url.pathname)
          && !url.searchParams.has('redirect_to')
        ) {
          url.searchParams.set('redirect_to', APP_URL);
          nextInput = input instanceof Request ? new Request(url.toString(), input) : url.toString();
        }
      }

      if (
        raw
        && raw.startsWith(`${AUTH_ORIGIN}/rest/v1/babies`)
        && init?.body
        && ['POST', 'PATCH'].includes(String(init.method || 'POST').toUpperCase())
      ) {
        const sex = document.querySelector('select[name="growthBabySex"]')?.value;
        if (['female', 'male'].includes(sex)) {
          try {
            const body = JSON.parse(init.body);
            const addSex = (value) => value && typeof value === 'object' ? { ...value, sex } : value;
            const nextBody = Array.isArray(body) ? body.map(addSex) : addSex(body);
            nextInit = { ...init, body: JSON.stringify(nextBody) };
          } catch {
            // Preserve the original request if the body is not JSON.
          }
        }
      }
    } catch (error) {
      console.warn('Supabase request guard fallback', error);
    }

    return nativeFetch(nextInput, nextInit);
  };
}

installAuthRedirectGuard();

if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
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

const ZIP_URLS = [
  '/debora-app-1.bin',
  '/debora-app-2.bin',
  '/debora-app-3.bin',
  '/debora-app-4.bin',
];

const RELEASE_PATCH_URLS = [
  '/release-1.11.0-patch-1.txt',
  '/release-1.11.0-patch-2.txt',
  '/release-1.11.0-patch-3.txt',
  '/release-1.11.0-patch-4.txt',
  '/release-1.11.0-patch-5.txt',
  '/release-1.11.0-patch-6.txt',
  '/release-1.11.0-patch-7.txt',
  '/release-1.11.0-patch-8.txt',
];

const AGENDA_PATCH_URLS = [
  '/release-1.12.0-agenda-1.txt',
  '/release-1.12.0-agenda-2.txt',
  '/release-1.12.0-agenda-3.txt',
  '/release-1.12.0-agenda-4.txt',
];

function decodeMaybeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  if (!bytes.length || bytes.length % 4 !== 0) return bytes;

  const text = new TextDecoder('ascii').decode(bytes);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return bytes;

  try {
    const binary = atob(text);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
    return output;
  } catch {
    return bytes;
  }
}

function decodeB64Text(text) {
  const binary = atob(text.trim());
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
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

async function loadBaseArchive() {
  const responses = await Promise.all(ZIP_URLS.map((url) => fetch(url, { cache: 'no-store' })));
  const failed = responses.find((response) => !response.ok);
  if (failed) throw new Error(`Falha ao carregar aplicativo base (${failed.status}).`);

  const fetched = await Promise.all(responses.map((response) => response.arrayBuffer()));
  const parts = fetched.map(decodeMaybeBase64);
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const merged = new Uint8Array(total);
  let cursor = 0;

  for (const part of parts) {
    merged.set(part, cursor);
    cursor += part.byteLength;
  }

  if (merged[0] !== 80 || merged[1] !== 75) throw new Error('Pacote base inválido.');
  return unzipSync(merged);
}

async function loadReleasePatch() {
  const responses = await Promise.all(RELEASE_PATCH_URLS.map((url) => fetch(url, { cache: 'no-store' })));
  const failed = responses.find((response) => !response.ok);
  if (failed) throw new Error(`Falha ao carregar release clínica (${failed.status}).`);

  const encoded = (await Promise.all(responses.map((response) => response.text()))).join('');
  return unzipSync(decodeB64Text(encoded));
}

async function loadAgendaPatch() {
  const responses = await Promise.all(AGENDA_PATCH_URLS.map((url) => fetch(url, { cache: 'no-store' })));
  const failed = responses.find((response) => !response.ok);
  if (failed) throw new Error(`Falha ao carregar fluxo da Agenda (${failed.status}).`);

  const encoded = (await Promise.all(responses.map((response) => response.text()))).join('');
  return unzipSync(decodeB64Text(encoded));
}

function archiveText(entries, path) {
  const bytes = entries[path];
  if (!bytes) throw new Error(`Arquivo ausente: ${path}`);
  return strFromU8(bytes);
}

async function loadLegacyRuntime() {
  const [base, patch, agendaPatch] = await Promise.all([
    loadBaseArchive(),
    loadReleasePatch(),
    loadAgendaPatch(),
  ]);

  const runtime = {
    'index.html': archiveText(base, 'index.html'),
    'styles.css': archiveText(base, 'styles.css'),
    'config.js': archiveText(base, 'config.js'),
    'core/app-shell.js': agendaPatch['core/app-shell.js']
      ? archiveText(agendaPatch, 'core/app-shell.js')
      : archiveText(patch, 'core/app-shell.js'),
    'features/clinical-note-feature.js': archiveText(patch, 'features/clinical-note-feature.js'),
    'features/clinical-note-feature.css': archiveText(patch, 'features/clinical-note-feature.css'),
    'features/patient-fixes.css': archiveText(patch, 'features/patient-fixes.css'),
  };

  for (const path of MODULE_PATHS) {
    const agendaPath = `core/${path}`;
    if (agendaPatch[agendaPath]) {
      runtime[agendaPath] = archiveText(agendaPatch, agendaPath);
      continue;
    }

    const patched = path === 'lib/supabase-client.js' || path === 'lib/app-data.js';
    runtime[agendaPath] = patched
      ? archiveText(patch, agendaPath)
      : archiveText(base, path);
  }

  return runtime;
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

async function boot() {
  if (location.hash.startsWith('#mae')) {
    memberOnly();
    return;
  }

  const canonicalRuntime = await loadCanonicalRuntime();
  const runtime = canonicalRuntime ?? await loadLegacyRuntime();
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
    "navigator.serviceWorker.register('/sw.js')",
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
      `<meta name="theme-color" content="#fbf7f4"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icon-512.png?v=1.12.1"><link rel="icon" type="image/png" href="/icon-192.png?v=1.12.1"><link rel="stylesheet" href="/growth-feature.css"><link rel="stylesheet" href="/member-feature.css"><link rel="stylesheet" href="/library-disabled.css"><link rel="stylesheet" href="/template-gallery.css"><link rel="stylesheet" href="/interaction-ui.css"><link rel="stylesheet" href="/improvements-v2.css"><link rel="stylesheet" href="/billing-v2.css"><link rel="stylesheet" href="/phase8-design.css"><style>${runtime['features/clinical-note-feature.css']}</style><style>${runtime['features/patient-fixes.css']}</style></head>`,
    )
    .replace(
      '</body>',
      `<script>${config}</script><script type="module" src="/canonical-identity-runtime.js"></script><script type="module" src="${shellUrl}"></script><script type="module" src="/growth-feature.js"></script><script type="module" src="/member-feature.js"></script><script type="module" src="/library-disabled.js"></script><script type="module" src="/demo-feature.js"></script><script type="module" src="/template-gallery.js"></script><script type="module" src="/interaction-ui.js"></script><script type="module" src="${clinicalUrl}"></script><script type="module" src="${patientUrl}"></script><script type="module" src="/billing-v2.js"></script><script type="module" src="/p0-route-guard.js"></script></body>`,
    );

  document.open();
  document.write(html);
  document.close();
}

boot().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main style="font-family:system-ui;padding:24px;max-width:560px;margin:auto"><h1>${CANONICAL_PRODUCT_NAME}</h1><p>Não foi possível carregar o aplicativo.</p><p>${String(error?.message || error)}</p><button onclick="location.reload()">Tentar novamente</button></main>`;
});
