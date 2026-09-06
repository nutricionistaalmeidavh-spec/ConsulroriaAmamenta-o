import { unzipSync, strFromU8 } from 'fflate';

window.__deboraUnzipSync = unzipSync;

const AUTH_ORIGIN = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const APP_URL = `${window.location.origin}/`;
const CLINICAL_SOURCE_ROOT = './clinical-source';

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
  './debora-app-1.bin',
  './debora-app-2.bin',
  './debora-app-3.bin',
  './debora-app-4.bin',
];

const RELEASE_PATCH_URLS = [
  './release-1.11.0-patch-1.txt',
  './release-1.11.0-patch-2.txt',
  './release-1.11.0-patch-3.txt',
  './release-1.11.0-patch-4.txt',
  './release-1.11.0-patch-5.txt',
  './release-1.11.0-patch-6.txt',
  './release-1.11.0-patch-7.txt',
  './release-1.11.0-patch-8.txt',
];

const AGENDA_PATCH_URLS = [
  './release-1.12.0-agenda-1.txt',
  './release-1.12.0-agenda-2.txt',
  './release-1.12.0-agenda-3.txt',
  './release-1.12.0-agenda-4.txt',
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
  link.href = './member-feature.css';
  document.head.appendChild(link);
  document.body.innerHTML = '<div id="member-portal-root"></div>';

  const script = document.createElement('script');
  script.type = 'module';
  script.src = './member-feature.js';
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

async function boot() {
  if (location.hash.startsWith('#mae')) {
    memberOnly();
    return;
  }

  const canonicalRuntime = await loadCanonicalRuntime();
  const runtime = canonicalRuntime ?? await loadLegacyRuntime();
  const moduleUrls = {};

  for (const path of MODULE_PATHS) {
    moduleUrls[path] = moduleUrl(runtime[`core/${path}`]);
  }

  let shell = runtime['core/app-shell.js'];
  for (const path of MODULE_PATHS) {
    shell = shell.replace(`'./${path}'`, `'${moduleUrls[path]}'`);
  }
  shell = shell.replace(
    "navigator.serviceWorker.register('./service-worker.js')",
    "navigator.serviceWorker.register('./sw.js')",
  );

  const shellUrl = moduleUrl(shell);
  const clinicalUrl = moduleUrl(runtime['features/clinical-note-feature.js']);
  const patientUrl = './patient-fixes-v2.js';
  const css = runtime['styles.css'];
  const config = runtime['config.js'];

  let html = runtime['index.html'];
  html = html
    .replace('<link rel="stylesheet" href="./styles.css">', `<style>${css}</style>`)
    .replaceAll('./icons/app-icon.svg', './icon-512.png?v=1.12.1')
    .replace('<script src="./config.js"></script>', '')
    .replace('<script type="module" src="./app-shell.js"></script>', '')
    .replace(
      '</head>',
      `<meta name="theme-color" content="#fbf7f4"><link rel="manifest" href="./manifest.webmanifest"><link rel="apple-touch-icon" href="./icon-512.png?v=1.12.1"><link rel="icon" type="image/png" href="./icon-192.png?v=1.12.1"><link rel="stylesheet" href="./growth-feature.css"><link rel="stylesheet" href="./member-feature.css"><link rel="stylesheet" href="./library-disabled.css"><link rel="stylesheet" href="./template-gallery.css"><link rel="stylesheet" href="./interaction-ui.css"><link rel="stylesheet" href="./improvements-v2.css"><link rel="stylesheet" href="./billing-v2.css"><link rel="stylesheet" href="./phase8-design.css"><style>${runtime['features/clinical-note-feature.css']}</style><style>${runtime['features/patient-fixes.css']}</style></head>`,
    )
    .replace(
      '</body>',
      `<script>${config}</script><script type="module" src="${shellUrl}"></script><script type="module" src="./growth-feature.js"></script><script type="module" src="./member-feature.js"></script><script type="module" src="./library-disabled.js"></script><script type="module" src="./demo-feature.js"></script><script type="module" src="./template-gallery.js"></script><script type="module" src="./interaction-ui.js"></script><script type="module" src="${clinicalUrl}"></script><script type="module" src="${patientUrl}"></script><script type="module" src="./billing-v2.js"></script><script type="module" src="./p0-route-guard.js"></script></body>`,
    );

  document.open();
  document.write(html);
  document.close();
}

boot().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main style="font-family:system-ui;padding:24px;max-width:560px;margin:auto"><h1>Débora Lactação</h1><p>Não foi possível carregar o aplicativo.</p><p>${String(error?.message || error)}</p><button onclick="location.reload()">Tentar novamente</button></main>`;
});
