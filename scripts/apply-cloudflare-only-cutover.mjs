import { readFile, writeFile, rm } from 'node:fs/promises';

const OLD_ORIGIN = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const OLD_KEY = 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';

async function edit(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) return false;
  await writeFile(path, after, 'utf8');
  return true;
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`cutover anchor missing: ${label}`);
  return source.replace(from, to);
}

function replaceRegexRequired(source, pattern, replacement, label) {
  if (typeof replacement === 'string' && replacement.length > 0 && source.includes(replacement)) return source;
  if (!pattern.test(source)) throw new Error(`cutover regex anchor missing: ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

await edit('public/billing-v2.js', (source) => {
  source = replaceRequired(source,
    `const BV_URL=BV_CONFIG.SUPABASE_URL||'${OLD_ORIGIN}';`,
    'const BV_URL=window.location.origin;',
    'billing origin');
  source = replaceRequired(source,
    "const BV_KEY=BV_CONFIG.SUPABASE_PUBLISHABLE_KEY||'';",
    "const BV_KEY='cloudflare-runtime';",
    'billing runtime key');
  return source;
});

await edit('public/package-audit-feature.js', (source) => {
  source = replaceRequired(source,
    `const PA_URL=PA_CONFIG.SUPABASE_URL||'${OLD_ORIGIN}';`,
    'const PA_URL=window.location.origin;',
    'package audit origin');
  source = replaceRequired(source,
    "const PA_KEY=PA_CONFIG.SUPABASE_PUBLISHABLE_KEY||'';",
    "const PA_KEY='cloudflare-runtime';",
    'package audit runtime key');
  return source;
});

await edit('public/clinical-care-flow-feature.js', (source) => {
  source = replaceRegexRequired(source,
    new RegExp(`const CCF_SB_URL=['\"]${OLD_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"];?`),
    'const CCF_SB_URL=window.location.origin;',
    'clinical care origin');
  source = source.replace(new RegExp(`const CCF_SB_KEY=['\"]${OLD_KEY}['\"];?`), "const CCF_SB_KEY='cloudflare-runtime';");
  return source;
});

await edit('public/feeding-assessment-history-feature.js', (source) => {
  source = source.replace(new RegExp(`const FAH_SB_URL\\s*=\\s*['\"]${OLD_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"];?`), 'const FAH_SB_URL = window.location.origin;');
  source = source.replace(new RegExp(`const FAH_SB_KEY\\s*=\\s*['\"]${OLD_KEY}['\"];?`), "const FAH_SB_KEY = 'cloudflare-runtime';");
  if (source.includes(OLD_ORIGIN)) throw new Error('feeding assessment legacy origin remains');
  return source;
});

await edit('public/growth-feature.js', (source) => {
  source = source.replace(
    `const SB_URL='${OLD_ORIGIN}';const SB_KEY='${OLD_KEY}';`,
    "const SB_URL=window.location.origin;const SB_KEY='cloudflare-runtime';",
  );
  source = source.replace("const WHO_BASE='./who/v2026-08-30/';", "const WHO_BASE='/who/v2026-08-30/';");
  if (source.includes(OLD_ORIGIN)) throw new Error('growth legacy origin remains');
  return source;
});

for (const path of ['public/clinical-source/config.js', 'patch-source/base/config.js']) {
  await edit(path, (source) => {
    source = source.replace(`SUPABASE_URL: '${OLD_ORIGIN}'`, 'SUPABASE_URL: window.location.origin');
    source = source.replace(`SUPABASE_PUBLISHABLE_KEY: '${OLD_KEY}'`, "SUPABASE_PUBLISHABLE_KEY: 'cloudflare-runtime'");
    if (!source.includes("BACKEND_MODE: 'cloudflare'")) {
      source = source.replace("SUPABASE_PUBLISHABLE_KEY: 'cloudflare-runtime',", "SUPABASE_PUBLISHABLE_KEY: 'cloudflare-runtime',\n  BACKEND_MODE: 'cloudflare',");
    }
    if (source.includes(OLD_ORIGIN)) throw new Error(`${path} legacy origin remains`);
    return source;
  });
}

await edit('src/bootstrap.js', (source) => {
  source = source.replace(`const AUTH_ORIGIN = '${OLD_ORIGIN}';`, 'const AUTH_ORIGIN = window.location.origin;');
  if (source.includes(OLD_ORIGIN)) throw new Error('bootstrap legacy origin remains');
  return source;
});

await edit('public/sw.js', (source) => source.replace("url.hostname.endsWith('supabase.co') || ", ''));

await edit('worker/cloudflare-billing-runtime.js', (source) => source.replace(
  "import { authenticateClinicalRequest, runtimeUserById } from './cloudflare-clinical-runtime.js';",
  "import { authenticateClinicalRequest, runtimeUserById } from './cloudflare-auth-runtime.js';",
));

await edit('worker/cloudflare-clinical-runtime.js', (source) => {
  if (!source.startsWith("import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';")) {
    source = "import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';\n\n" + source;
  }
  source = source.replace(`const LEGACY_SUPABASE_URL = '${OLD_ORIGIN}';\n`, '');
  source = source.replace(`const LEGACY_SUPABASE_KEY = '${OLD_KEY}';\n`, '');
  source = replaceRegexRequired(
    source,
    /async function userRowByEmail[\s\S]*?(?=async function tableRows)/,
    '',
    'legacy auth block',
  );
  source = source.replace("    if (url.pathname.startsWith('/auth/v1/')) return handleAuth(request, env, url);\n", '');
  if (/zxowxdfhtksevhnjmeyu|supabase\.co|LEGACY_SUPABASE/i.test(source)) {
    throw new Error('clinical runtime still contains legacy Supabase auth');
  }
  return source;
});

for (const path of ['index.html', 'app/index.html']) {
  await edit(path, (source) => source.replace(/\s*<script type="module" src="\/src\/cloudflare-fetch-bridge\.js"><\/script>\s*/g, '\n    '));
}

await edit('worker/domain-entry.js', (source) => {
  source = source.replace("import coreWorker from './index.js';\n", '');
  source = source.replace("const COMMERCIAL_GATED_PATHS = new Set(['/api/license/me', '/api/clinical/mothers', '/api/clinical/media/upload']);\n", '');
  source = source.replace(
    /    if \(url\.pathname\.startsWith\('\/api\/'\)\) \{[\s\S]*?    \}\n\n    const route = resolvePublicHostRoute\(url\);/,
    `    if (url.pathname.startsWith('/api/')) {\n      return withNoIndex(new Response(JSON.stringify({ error: 'api_not_found' }), {\n        status: 404,\n        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },\n      }));\n    }\n\n    const route = resolvePublicHostRoute(url);`,
  );
  source = source.replace(
    '    const response = await coreWorker.fetch(request, env, ctx);',
    '    const response = await env.ASSETS.fetch(request);',
  );
  if (/coreWorker|\.\/index\.js/.test(source)) throw new Error('domain entry still references legacy core worker');
  if (!source.includes("error: 'api_not_found'")) throw new Error('domain entry missing fail-closed API 404');
  return source;
});

await edit('.github/workflows/validate-saas-foundation.yml', (source) => source
  .replace('          node --check worker/index.js\n', '')
  .replace('          node --check worker/cloudflare-billing-runtime.js\n', '          node --check worker/cloudflare-billing-runtime.js\n          node --check worker/cloudflare-clinical-runtime.js\n          node --check worker/cloudflare-growth-runtime.js\n          node --check worker/cloudflare-upsert-runtime.js\n'));

await edit('.github/workflows/validate-clinical-source-consolidation.yml', (source) => source
  .replace('          node scripts/test-deferred-email-flow.mjs\n', '')
  .replace('        run: node --check worker/index.js', '        run: node --check worker/domain-entry.js'));

for (const path of ['src/cloudflare-fetch-bridge.js', 'worker/index.js', 'worker/partner-admin.js']) {
  await rm(path, { force: true });
}

const activeFiles = [
  'public/billing-v2.js',
  'public/package-audit-feature.js',
  'public/clinical-care-flow-feature.js',
  'public/feeding-assessment-history-feature.js',
  'public/growth-feature.js',
  'public/clinical-source/config.js',
  'patch-source/base/config.js',
  'src/bootstrap.js',
  'worker/cloudflare-clinical-runtime.js',
  'worker/domain-entry.js',
];
for (const path of activeFiles) {
  const source = await readFile(path, 'utf8');
  if (/zxowxdfhtksevhnjmeyu|https:\/\/[^'"\s]*supabase\.co|SUPABASE_SERVICE_ROLE_KEY|\/functions\/v1\/saas-(?:checkout|billing-webhook)/i.test(source)) {
    throw new Error(`forbidden Supabase runtime dependency remains in ${path}`);
  }
}

console.log('Cloudflare-only runtime cutover applied');
