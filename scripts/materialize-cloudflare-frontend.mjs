import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = resolve(ROOT, 'public');
const OLD_ORIGIN = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const OLD_KEY = 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';
const MODE = process.argv.includes('--write') ? 'write' : 'check';

const CONFIG_SEMANTIC_PATHS = new Set([
  'public/billing-v2.js',
  'public/package-audit-feature.js',
  'public/documents-feature.js',
  'public/canonical-identity-runtime.js',
  'public/clinical-source/config.js',
  'public/clinical-source/core/app-shell.js',
  'public/clinical-source/core/lib/supabase-client.js',
]);

const RETIRED_PATTERNS = [
  /zxowxdfhtksevhnjmeyu/i,
  /\.supabase\.co/i,
  /sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt/i,
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (/\.(?:js|mjs|html|json|webmanifest)$/i.test(name)) out.push(path);
  }
  return out;
}

function replaceQuotedLiteral(source, literal, replacementExpression) {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source
    .replace(new RegExp(`'${escaped}'`, 'g'), replacementExpression)
    .replace(new RegExp(`"${escaped}"`, 'g'), replacementExpression)
    .replace(new RegExp('`' + escaped + '`', 'g'), replacementExpression);
}

export function normalizeCloudflareFrontendSource(source, relativePath = '') {
  let next = String(source);

  if (/\.(?:js|mjs)$/i.test(relativePath)) {
    next = replaceQuotedLiteral(next, OLD_ORIGIN, 'window.location.origin');
    next = replaceQuotedLiteral(next, OLD_KEY, "'cloudflare-runtime'");
  }

  if (CONFIG_SEMANTIC_PATHS.has(relativePath)) {
    next = next
      .replace(/\bSUPABASE_URL\b/g, 'API_BASE_URL')
      .replace(/\bSUPABASE_PUBLISHABLE_KEY\b/g, 'CLIENT_RUNTIME_KEY');
    if (relativePath === 'public/documents-feature.js') {
      next = next.replace(/\bSUPABASE_KEY\b/g, 'CLIENT_RUNTIME_KEY');
    }
  }

  if (relativePath === 'public/documents-feature.js') {
    next = next
      .replace("String(CONFIG.API_BASE_URL||'')", 'String(CONFIG.API_BASE_URL||window.location.origin)')
      .replace("String(CONFIG.CLIENT_RUNTIME_KEY||'')", "String(CONFIG.CLIENT_RUNTIME_KEY||'cloudflare-runtime')");
  }

  return next;
}

function scanForRetiredMaterial() {
  const offenders = [];
  for (const path of walk(PUBLIC)) {
    const rel = relative(ROOT, path).replaceAll('\\', '/');
    const source = readFileSync(path, 'utf8');
    for (const pattern of RETIRED_PATTERNS) {
      if (pattern.test(source)) offenders.push(`${rel} -> ${pattern}`);
    }
  }
  return offenders;
}

function materializePublicRuntime() {
  let changed = 0;
  for (const path of walk(PUBLIC)) {
    const rel = relative(ROOT, path).replaceAll('\\', '/');
    const source = readFileSync(path, 'utf8');
    const normalized = normalizeCloudflareFrontendSource(source, rel);
    if (normalized !== source) {
      if (MODE === 'write') writeFileSync(path, normalized, 'utf8');
      changed += 1;
    }
  }
  return changed;
}

function ensurePackageScripts() {
  const path = resolve(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  const required = 'node scripts/materialize-cloudflare-frontend.mjs --write';
  let changed = false;
  for (const name of ['dev', 'build']) {
    const current = String(pkg.scripts?.[name] || '');
    if (!current.includes(required)) {
      const marker = 'node scripts/materialize-clinical-source.mjs --write';
      if (!current.includes(marker)) throw new Error(`${name}: clinical materializer marker missing`);
      pkg.scripts[name] = current.replace(marker, `${marker} && ${required}`);
      changed = true;
    }
  }
  const testCommand = 'node scripts/materialize-clinical-source.mjs --write && node scripts/materialize-cloudflare-frontend.mjs --check && node --test tests/frontend-cloudflare-cutover.test.mjs';
  if (pkg.scripts?.['test:frontend-cutover'] !== testCommand) {
    pkg.scripts['test:frontend-cutover'] = testCommand;
    changed = true;
  }
  if (changed && MODE === 'write') writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  return changed;
}

function ensureClinicalMaterializerHook() {
  const path = resolve(ROOT, 'scripts/materialize-clinical-source.mjs');
  let source = readFileSync(path, 'utf8');
  let changed = false;

  if (!source.includes("from './materialize-cloudflare-frontend.mjs'")) {
    const marker = "import { unzipSync } from 'fflate';\n";
    if (!source.includes(marker)) throw new Error('clinical materializer import marker missing');
    source = source.replace(marker, `${marker}import { normalizeCloudflareFrontendSource } from './materialize-cloudflare-frontend.mjs';\n`);
    changed = true;
  }

  if (!source.includes('frontend-cloudflare-cutover')) {
    const marker = "replaceText('core/app-shell.js', oldPatientSubmit, newPatientSubmit, 'atomic-patient-create');\n\n";
    if (!source.includes(marker)) throw new Error('clinical materializer normalization marker missing');
    const hook = `for (const [outputPath, bytes] of resolved) {\n  const runtimePath = \`public/clinical-source/\${outputPath}\`;\n  const text = Buffer.from(bytes).toString('utf8');\n  const normalized = normalizeCloudflareFrontendSource(text, runtimePath);\n  if (normalized !== text) {\n    resolved.set(outputPath, new Uint8Array(Buffer.from(normalized, 'utf8')));\n    sourceByPath.set(outputPath, \`\${sourceByPath.get(outputPath)}+frontend-cloudflare-cutover\`);\n  }\n}\n\n`;
    source = source.replace(marker, `${marker}${hook}`);
    changed = true;
  }

  if (changed && MODE === 'write') writeFileSync(path, source, 'utf8');
  return changed;
}

function ensureWorkflowHooks() {
  const files = [
    resolve(ROOT, '.github/workflows/validate-saas-foundation.yml'),
    resolve(ROOT, '.github/workflows/validate-clinical-source-consolidation.yml'),
  ];
  let changed = false;

  for (const path of files) {
    let source = readFileSync(path, 'utf8');
    const original = source;
    if (!source.includes("scripts/materialize-cloudflare-frontend.mjs")) {
      if (source.includes("      - 'scripts/normalize-growth-runtime.mjs'")) {
        source = source.replaceAll(
          "      - 'scripts/normalize-growth-runtime.mjs'",
          "      - 'scripts/normalize-growth-runtime.mjs'\n      - 'scripts/materialize-cloudflare-frontend.mjs'",
        );
      } else if (source.includes("      - 'scripts/materialize-clinical-source.mjs'")) {
        source = source.replaceAll(
          "      - 'scripts/materialize-clinical-source.mjs'",
          "      - 'scripts/materialize-clinical-source.mjs'\n      - 'scripts/materialize-cloudflare-frontend.mjs'",
        );
      }
    }
    source = source.replace(
      'run: node --test tests/frontend-cloudflare-cutover.test.mjs',
      'run: npm run test:frontend-cutover',
    );
    if (source !== original) {
      if (MODE === 'write') writeFileSync(path, source, 'utf8');
      changed = true;
    }
  }
  return changed;
}

function assertSemanticConfigNames() {
  const offenders = [];
  for (const rel of CONFIG_SEMANTIC_PATHS) {
    const source = readFileSync(resolve(ROOT, rel), 'utf8');
    if (/SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY/i.test(source)) offenders.push(rel);
  }
  if (offenders.length) throw new Error(`Supabase config names remain in active frontend: ${offenders.join(', ')}`);
}

export function runCloudflareFrontendMaterializer() {
  const publicChanges = materializePublicRuntime();
  const packageChanged = ensurePackageScripts();
  const clinicalChanged = ensureClinicalMaterializerHook();
  const workflowChanged = ensureWorkflowHooks();

  if (MODE === 'write' && clinicalChanged) {
    // Re-run the clinical materializer after installing its normalization hook so the
    // committed canonical source matches what dev/build will publish.
    const { spawnSync } = requireNodeChildProcess();
    const result = spawnSync(process.execPath, [resolve(ROOT, 'scripts/materialize-clinical-source.mjs'), '--write'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'clinical materialization failed');
    materializePublicRuntime();
  }

  const offenders = scanForRetiredMaterial();
  if (offenders.length) throw new Error(`retired backend material remains:\n${offenders.join('\n')}`);
  assertSemanticConfigNames();
  return { publicChanges, packageChanged, clinicalChanged, workflowChanged };
}

function requireNodeChildProcess() {
  return { spawnSync: (...args) => globalThis.__cloudflareFrontendSpawnSync(...args) };
}

const executedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  const { spawnSync } = await import('node:child_process');
  globalThis.__cloudflareFrontendSpawnSync = spawnSync;
  const result = runCloudflareFrontendMaterializer();
  console.log(`Cloudflare frontend ${MODE}: ${JSON.stringify(result)}`);
}
