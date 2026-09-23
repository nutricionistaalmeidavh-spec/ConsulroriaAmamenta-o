import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const MODE = process.argv.includes('--write') ? 'write' : 'check';

function ensureReplace(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) throw new Error(`${label}: trecho esperado não encontrado`);
  return source.replace(search, replacement);
}

export function hardenDelivery1AppShell(source) {
  let next = String(source);

  next = ensureReplace(
    next,
    'let currentBabyId = null;',
    'let currentBabyId = null;\nlet patientOpenRevision = 0;',
    'R01 navigation revision state',
  );

  next = ensureReplace(
    next,
    'async function openPatient(motherId, { navigateRoute = true, babyId = null } = {}) {\n  const patient = patientByMotherId(motherId) || await appData.getPatient(motherId);\n  if (!patient)',
    'async function openPatient(motherId, { navigateRoute = true, babyId = null } = {}) {\n  const openRevision = ++patientOpenRevision;\n  const patient = patientByMotherId(motherId) || await appData.getPatient(motherId);\n  if (openRevision !== patientOpenRevision) return;\n  if (!patient)',
    'R01 openPatient revision claim',
  );

  const asyncReadMarker = `      selectedBaby?.id ? appData.listEncounterIdsForBaby(selectedBaby.id) : Promise.resolve([])\n    ]);\n    const allowedEncounterIds`;
  const guardedAsyncRead = `      selectedBaby?.id ? appData.listEncounterIdsForBaby(selectedBaby.id) : Promise.resolve([])\n    ]);\n    if (openRevision !== patientOpenRevision || currentPatientId !== patient.mother.id || currentBabyId !== (selectedBaby?.id || null)) return;\n    const allowedEncounterIds`;
  next = ensureReplace(next, asyncReadMarker, guardedAsyncRead, 'R01 async projection identity');

  const errorMarker = `  } catch (error) {\n    if (weightsRoot)`;
  const guardedError = `  } catch (error) {\n    if (openRevision !== patientOpenRevision || currentPatientId !== patient.mother.id || currentBabyId !== (selectedBaby?.id || null)) return;\n    if (weightsRoot)`;
  next = ensureReplace(next, errorMarker, guardedError, 'R01 stale error projection');

  const patientScreenMarker = `  showScreen('patient');\n}\nfunction renderBabySelector`;
  const guardedPatientScreen = `  if (openRevision !== patientOpenRevision || currentPatientId !== patient.mother.id || currentBabyId !== (selectedBaby?.id || null)) return;\n  showScreen('patient');\n}\nfunction renderBabySelector`;
  next = ensureReplace(next, patientScreenMarker, guardedPatientScreen, 'R01 stale screen activation');

  const showScreenMarker = `function showScreen(screen) {\n  if (screen !== 'appointment' && screen !== activeScreen)`;
  const guardedShowScreen = `function showScreen(screen) {\n  if (screen !== 'patient') patientOpenRevision += 1;\n  if (screen !== 'appointment' && screen !== activeScreen)`;
  next = ensureReplace(next, showScreenMarker, guardedShowScreen, 'R01 navigation-away invalidation');

  return next;
}

export function hardenDelivery1PatientFixes(source) {
  let next = String(source);

  next = ensureReplace(
    next,
    'address=pfAddress(m);for(const b of pfButtons())',
    'address=pfAddress(m);if(pfPatientId()!==mid)return;for(const b of pfButtons())',
    'R19 stale patient wire response',
  );

  next = ensureReplace(
    next,
    'if(!t||b.dataset.pfBound)continue;',
    'if(!t||b.dataset.pfBound===mid)continue;',
    'R19 patient-scoped binding marker',
  );

  next = next.replaceAll("b.dataset.pfBound='1'", 'b.dataset.pfBound=mid');
  next = next.replaceAll(
    'b.onclick=e=>{e.preventDefault();phone?',
    'b.onclick=e=>{e.preventDefault();if(pfPatientId()!==mid){pfSchedule();return}phone?',
  );
  next = next.replaceAll(
    'b.onclick=e=>{e.preventDefault();address?',
    'b.onclick=e=>{e.preventDefault();if(pfPatientId()!==mid){pfSchedule();return}address?',
  );
  next = next.replaceAll(
    'b.onclick=e=>{e.preventDefault();pfChoosePhoto(mid)}',
    'b.onclick=e=>{e.preventDefault();if(pfPatientId()!==mid){pfSchedule();return}pfChoosePhoto(mid)}',
  );

  if (!next.includes('b.dataset.pfBound=mid')) throw new Error('R19: nenhum binding de paciente foi atualizado');
  if (!next.includes('if(pfPatientId()!==mid){pfSchedule();return}')) throw new Error('R19: ações ainda não validam o contexto no clique');
  return next;
}

function writeTarget(relativePath, transform) {
  const path = resolve(ROOT, relativePath);
  const source = readFileSync(path, 'utf8');
  const next = transform(source);
  if (MODE === 'check' && next !== source) throw new Error(`${relativePath}: Entrega 1 ainda não materializada`);
  if (MODE === 'write' && next !== source) writeFileSync(path, next, 'utf8');
  return next !== source;
}

function sha256(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function syncClinicalManifest(modulePaths) {
  const manifestPath = resolve(ROOT, 'public/clinical-source/manifest.json');
  const source = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(source);
  let changed = false;

  for (const modulePath of modulePaths) {
    const entry = manifest?.modules?.[modulePath];
    if (!entry) throw new Error(`clinical manifest: módulo ausente ${modulePath}`);
    const content = readFileSync(resolve(ROOT, 'public/clinical-source', modulePath), 'utf8');
    const hash = sha256(content);
    if (entry.sha256 !== hash) {
      if (MODE === 'check') throw new Error(`clinical manifest: hash desatualizado ${modulePath}`);
      entry.sha256 = hash;
      changed = true;
    }
    if (!String(entry.source || '').includes('+delivery1-integrity-hardening')) {
      if (MODE === 'check') throw new Error(`clinical manifest: origem sem Entrega 1 ${modulePath}`);
      entry.source = `${entry.source || modulePath}+delivery1-integrity-hardening`;
      changed = true;
    }
  }

  if (changed && MODE === 'write') writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return changed;
}

export function runDelivery1FrontendHardening() {
  const changed = [];
  if (writeTarget('public/clinical-source/core/app-shell.js', hardenDelivery1AppShell)) changed.push('app-shell');
  if (writeTarget('public/clinical-source/features/patient-fixes.js', hardenDelivery1PatientFixes)) changed.push('patient-fixes');
  if (syncClinicalManifest(['core/app-shell.js', 'features/patient-fixes.js'])) changed.push('clinical-manifest');
  return changed;
}

const executedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  const changed = runDelivery1FrontendHardening();
  console.log(`Delivery 1 frontend ${MODE}: ${changed.length ? changed.join(', ') : 'already hardened'}`);
}
