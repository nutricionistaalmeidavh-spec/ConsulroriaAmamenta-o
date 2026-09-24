import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = resolve(ROOT, 'public');
const OLD_ORIGIN = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const OLD_KEY = 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';
const MODE = process.argv.includes('--write') ? 'write' : 'check';
const SAME_ORIGIN_EXPRESSION = "(globalThis.location?.origin || '')";

const CONFIG_SEMANTIC_PATHS = new Set([
  'public/billing-v2.js',
  'public/package-audit-feature.js',
  'public/documents-feature.js',
  'public/canonical-identity-runtime.js',
  'public/clinical-source/config.js',
  'public/clinical-source/core/app-shell.js',
  'public/clinical-source/core/lib/supabase-client.js',
]);

const SAME_ORIGIN_TARGETS = new Set([
  'public/billing-v2.js',
  'public/canonical-identity-runtime.js',
  'public/clinical-care-flow-feature.js',
  'public/clinical-source/config.js',
  'public/clinical-source/features/clinical-note-feature.js',
  'public/clinical-source/features/patient-fixes.js',
  'public/demo-feature.js',
  'public/documents-feature.js',
  'public/feeding-assessment-history-feature.js',
  'public/library-feature.js',
  'public/library-organizer.js',
  'public/member-feature.js',
  'public/package-audit-feature.js',
  'public/patient-fixes-v2.js',
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

function migrateOwnedApiPaths(source) {
  return String(source)
    .replaceAll('/auth/v1/', '/api/auth/')
    .replaceAll('/auth/v1', '/api/auth')
    .replaceAll('/rest/v1/rpc/', '/api/clinical/rpc/')
    .replaceAll('/rest/v1/rpc', '/api/clinical/rpc')
    .replaceAll('/rest/v1/', '/api/clinical/records/')
    .replaceAll('/rest/v1', '/api/clinical/records')
    .replaceAll('/storage/v1/', '/api/files/')
    .replaceAll('/storage/v1', '/api/files')
    .replaceAll('/api/sandbox/webhooks/asaas', '/api/billing/sandbox/webhooks/asaas')
    .replaceAll('/api/sandbox/asaas/', '/api/billing/sandbox/')
    .replaceAll('/api/sandbox/asaas', '/api/billing/sandbox')
    .replaceAll('/api/webhooks/asaas', '/api/billing/webhooks/asaas')
    .replaceAll('/api/asaas/', '/api/billing/')
    .replaceAll('/api/asaas', '/api/billing');
}

function retireDestructiveClinicalDelete(source) {
  return String(source)
    .replace(/async function cnDeleteEncounter\(\)\{[\s\S]*?\}\nfunction cnWireOverlay/, 'function cnWireOverlay')
    .replace(/o\.querySelector\('\[data-cn-delete\]'\)\?\.addEventListener\('click',cnDeleteEncounter\);?/g, '')
    .replace(/<button type="button" class="danger" data-cn-delete>Excluir atendimento<\/button>/g, '');
}

function stabilizePatientDetailNavigation(source) {
  const start = `  if (!patient) { toast('Paciente não encontrada.', 'error'); return; }\n  currentPatientId = patient.mother.id;`;
  const stableStart = `  if (!patient) { toast('Paciente não encontrada.', 'error'); return; }\n  currentPatientId = patient.mother.id;\n  if (navigateRoute) {\n    const route = routeFor('patient', patient.mother.id);\n    if (location.hash !== route) history.pushState({}, '', route);\n  }`;
  const finish = `  if (navigateRoute) navigate('patient', patient.mother.id); else showScreen('patient');`;
  const stableFinish = `  showScreen('patient');`;
  let next = String(source);
  if (!next.includes(stableStart)) next = next.replace(start, stableStart);
  return next.replace(finish, stableFinish);
}

function hardenPatientClinicalProjection(source) {
  let next = String(source);
  const loadMarker = `  renderBabyDetails(selectedBaby);\n  try {`;
  const hardenedLoad = `  renderBabyDetails(selectedBaby);\n  const weightsRoot = document.querySelector('[data-patient-weights-live]');\n  const timelineRoot = document.querySelector('[data-patient-timeline-live]');\n  if (weightsRoot) weightsRoot.innerHTML = '<div class="empty-live">Carregando pesos…</div>';\n  if (timelineRoot) timelineRoot.innerHTML = '<div class="empty-live">Carregando histórico clínico…</div>';\n  try {`;
  if (!next.includes('Carregando histórico clínico…')) next = next.replace(loadMarker, hardenedLoad);

  const catchMarker = `  } catch (error) { reportError(error); }\n  showScreen('patient');`;
  const hardenedCatch = `  } catch (error) {\n    if (weightsRoot) weightsRoot.innerHTML = '<div class="empty-live">Não foi possível carregar os pesos desta paciente.</div>';\n    if (timelineRoot) timelineRoot.innerHTML = '<div class="empty-live">Não foi possível carregar o histórico clínico desta paciente.</div>';\n    reportError(error);\n  }\n  showScreen('patient');`;
  if (!next.includes('Não foi possível carregar o histórico clínico desta paciente.')) next = next.replace(catchMarker, hardenedCatch);
  return next;
}

function guardPatientConsentEdit(source) {
  let next = String(source);
  if (!next.includes('let patientConsentLoadReady = true;')) {
    next = next.replace('let patientSaveAttempt = null;\npatientForm?.addEventListener', 'let patientSaveAttempt = null;\nlet patientConsentLoadReady = true;\npatientForm?.addEventListener');
  }

  const submitStart = `patientForm?.addEventListener('submit', async (event) => {\n  event.preventDefault();\n  if (patientSaveBusy) return;`;
  const guardedSubmitStart = `patientForm?.addEventListener('submit', async (event) => {\n  event.preventDefault();\n  if (editingPatientId && !patientConsentLoadReady) {\n    const blockedStatus = document.querySelector('[data-patient-form-status]');\n    if (blockedStatus) {\n      blockedStatus.textContent = 'As autorizações não foram carregadas. Reabra o cadastro antes de salvar.';\n      blockedStatus.classList.add('error');\n    }\n    return;\n  }\n  if (patientSaveBusy) return;`;
  if (!next.includes('As autorizações não foram carregadas. Reabra o cadastro antes de salvar.')) next = next.replace(submitStart, guardedSubmitStart);

  const formStart = `  editingPatientId = motherId || null;\n  patientSaveAttempt = null;\n  patientForm.reset();`;
  const guardedFormStart = `  editingPatientId = motherId || null;\n  patientSaveAttempt = null;\n  patientConsentLoadReady = !motherId;\n  patientForm.reset();\n  const formSubmitButtons = [...patientForm.querySelectorAll('[type="submit"]')];\n  const formStatus = document.querySelector('[data-patient-form-status]');\n  formSubmitButtons.forEach((button) => { button.disabled = Boolean(motherId); });\n  if (formStatus) { formStatus.textContent = ''; formStatus.classList.remove('error'); }`;
  if (!next.includes('patientConsentLoadReady = !motherId;')) next = next.replace(formStart, guardedFormStart);

  const consentFinish = `      for (const [name, type] of Object.entries(pairs)) { const el = patientForm.elements.namedItem(name); if (el) el.checked = Boolean(map[type]); }\n    } catch (error) { reportError(error); }\n  }\n  if (navigateRoute)`;
  const guardedConsentFinish = `      for (const [name, type] of Object.entries(pairs)) { const el = patientForm.elements.namedItem(name); if (el) el.checked = Boolean(map[type]); }\n      patientConsentLoadReady = true;\n    } catch (error) {\n      patientConsentLoadReady = false;\n      if (formStatus) {\n        formStatus.textContent = 'Não foi possível carregar as autorizações. O cadastro foi bloqueado para evitar alterações acidentais.';\n        formStatus.classList.add('error');\n      }\n      reportError(error);\n    } finally {\n      formSubmitButtons.forEach((button) => { button.disabled = !patientConsentLoadReady; });\n    }\n  } else {\n    formSubmitButtons.forEach((button) => { button.disabled = false; });\n  }\n  if (navigateRoute)`;
  if (!next.includes('O cadastro foi bloqueado para evitar alterações acidentais.')) next = next.replace(consentFinish, guardedConsentFinish);
  return next;
}

function hardenClinicalNoteSaveIntegrity(source) {
  let next = String(source);
  next = next.replace(
    "async function cnFlush(){clearTimeout(cnState.saveTimer);const ta=document.querySelector('#cn-note');if(ta)await cnSave(ta.value,{force:true}).catch(()=>{})}",
    "async function cnFlush(){clearTimeout(cnState.saveTimer);const ta=document.querySelector('#cn-note');if(ta)await cnSave(ta.value,{force:true})}"
  );
  const oldWire = "function cnWireOverlay(){const o=document.querySelector('#cn-overlay'),ta=o?.querySelector('#cn-note');if(!o||!ta)return;ta.addEventListener('input',()=>cnScheduleSave(ta.value));o.querySelector('[data-cn-close]').onclick=async()=>{await cnFlush();cnClose()};o.querySelector('[data-cn-back]').onclick=async()=>{await cnFlush();if(cnState.direction==='backward')cnInvoke(cnState.pendingButton);else cnClose()};o.querySelector('[data-cn-continue]').onclick=async()=>{await cnFlush();if(cnState.direction==='forward')cnInvoke(cnState.pendingButton);else cnClose()};o.querySelector('#cn-addendum-save')?.addEventListener('click',cnAddAddendum)}";
  const newWire = "function cnWireOverlay(){const o=document.querySelector('#cn-overlay'),ta=o?.querySelector('#cn-note');if(!o||!ta)return;ta.addEventListener('input',()=>cnScheduleSave(ta.value));const guard=async(action)=>{try{await cnFlush();action()}catch(e){console.warn('Prontuário não salvo',e)}};o.querySelector('[data-cn-close]').onclick=()=>guard(cnClose);o.querySelector('[data-cn-back]').onclick=()=>guard(()=>{if(cnState.direction==='backward')cnInvoke(cnState.pendingButton);else cnClose()});o.querySelector('[data-cn-continue]').onclick=()=>guard(()=>{if(cnState.direction==='forward')cnInvoke(cnState.pendingButton);else cnClose()});o.querySelector('#cn-addendum-save')?.addEventListener('click',cnAddAddendum)}";
  if (!next.includes("console.warn('Prontuário não salvo',e)")) next = next.replace(oldWire, newWire);
  return next;
}

export function normalizeCloudflareFrontendSource(source, relativePath = '') {
  let next = String(source);

  if (/\.(?:js|mjs)$/i.test(relativePath)) {
    next = replaceQuotedLiteral(next, OLD_ORIGIN, SAME_ORIGIN_EXPRESSION);
    next = replaceQuotedLiteral(next, OLD_KEY, "'cloudflare-runtime'");
    next = migrateOwnedApiPaths(next);
  }

  if (SAME_ORIGIN_TARGETS.has(relativePath)) {
    next = next.replace(/\bwindow\.location\.origin\b/g, SAME_ORIGIN_EXPRESSION);
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
      .replace("String(CONFIG.API_BASE_URL||'')", `String(CONFIG.API_BASE_URL||${SAME_ORIGIN_EXPRESSION})`)
      .replace("String(CONFIG.CLIENT_RUNTIME_KEY||'')", "String(CONFIG.CLIENT_RUNTIME_KEY||'cloudflare-runtime')");
  }

  if (relativePath === 'public/clinical-source/features/clinical-note-feature.js') {
    next = retireDestructiveClinicalDelete(next);
    next = hardenClinicalNoteSaveIntegrity(next);
  }

  if (relativePath === 'public/clinical-source/core/app-shell.js') {
    next = stabilizePatientDetailNavigation(next);
    next = hardenPatientClinicalProjection(next);
    next = guardPatientConsentEdit(next);
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

  if (MODE === 'write' && clinicalChanged) {
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
  return { publicChanges, packageChanged, clinicalChanged };
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
