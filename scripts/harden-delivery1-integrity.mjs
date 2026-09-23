import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const MODE = process.argv.includes('--write') ? 'write' : 'check';
const DELIVERY2_APP_DATA = resolve(ROOT, 'patch-source', 'cloudflare-license-authority', 'core', 'lib', 'app-data.js');

function ensureReplace(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) throw new Error(`${label}: trecho esperado não encontrado`);
  return source.replace(search, replacement);
}

export function hardenDelivery1AppShell(source) {
  let next = String(source);
  const identityGuard = "openRevision !== patientOpenRevision || currentPatientId !== patient.mother.id || currentBabyId !== (selectedBaby?.id || null)";

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
  const guardedAsyncRead = `      selectedBaby?.id ? appData.listEncounterIdsForBaby(selectedBaby.id) : Promise.resolve([])\n    ]);\n    if (${identityGuard}) return;\n    const allowedEncounterIds`;
  next = ensureReplace(next, asyncReadMarker, guardedAsyncRead, 'R01 async projection identity');

  const guardedError = `  } catch (error) {\n    if (${identityGuard}) return;\n    if (weightsRoot)`;
  const guardedCompactError = `  } catch (error) {\n    if (${identityGuard}) return;\n    reportError(error);\n  }`;
  if (!next.includes(guardedError) && !next.includes(guardedCompactError)) {
    const materializedErrorMarker = `  } catch (error) {\n    if (weightsRoot)`;
    const compactErrorMarker = `  } catch (error) { reportError(error); }`;
    if (next.includes(materializedErrorMarker)) {
      next = next.replace(materializedErrorMarker, guardedError);
    } else if (next.includes(compactErrorMarker)) {
      next = next.replace(compactErrorMarker, guardedCompactError);
    } else {
      throw new Error('R01 stale error projection: trecho esperado não encontrado');
    }
  }

  const guardedPatientScreen = `  if (${identityGuard}) return;\n  showScreen('patient');\n}\nfunction renderBabySelector`;
  const guardedPatientRoute = `  if (${identityGuard}) return;\n  if (navigateRoute) navigate('patient', patient.mother.id); else showScreen('patient');\n}\nfunction renderBabySelector`;
  if (!next.includes(guardedPatientScreen) && !next.includes(guardedPatientRoute)) {
    const materializedScreenMarker = `  showScreen('patient');\n}\nfunction renderBabySelector`;
    const compactRouteMarker = `  if (navigateRoute) navigate('patient', patient.mother.id); else showScreen('patient');\n}\nfunction renderBabySelector`;
    if (next.includes(materializedScreenMarker)) {
      next = next.replace(materializedScreenMarker, guardedPatientScreen);
    } else if (next.includes(compactRouteMarker)) {
      next = next.replace(compactRouteMarker, guardedPatientRoute);
    } else {
      throw new Error('R01 stale screen activation: trecho esperado não encontrado');
    }
  }

  const showScreenMarker = `function showScreen(screen) {\n  if (screen !== 'appointment' && screen !== activeScreen)`;
  const guardedShowScreen = `function showScreen(screen) {\n  if (screen !== 'patient') patientOpenRevision += 1;\n  if (screen !== 'appointment' && screen !== activeScreen)`;
  next = ensureReplace(next, showScreenMarker, guardedShowScreen, 'R01 navigation-away invalidation');

  next = ensureReplace(
    next,
    '  flush:()=>currentDraftEncounterId?saveDraft({silent:true}):Promise.resolve(null)',
    '  flush:()=>{clearTimeout(encounterAutosaveTimer);encounterAutosaveTimer=null;return currentDraftEncounterId?saveDraft({silent:true}):Promise.resolve(null)}',
    'Stage 12 wizard-to-note autosave handoff',
  );

  next = ensureReplace(
    next,
    '  flush:()=>{clearTimeout(encounterAutosaveTimer);encounterAutosaveTimer=null;return currentDraftEncounterId?saveDraft({silent:true}):Promise.resolve(null)}\n};',
    '  flush:()=>{clearTimeout(encounterAutosaveTimer);encounterAutosaveTimer=null;return currentDraftEncounterId?saveDraft({silent:true}):Promise.resolve(null)},\n  syncVersion:(id)=>appData?.getEncounter?.(id)\n};',
    'Stage 12 SQL-note optimistic version refresh bridge',
  );

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

export function hardenDelivery2AppData() {
  return readFileSync(DELIVERY2_APP_DATA, 'utf8');
}

function writeTarget(relativePath, transform) {
  const path = resolve(ROOT, relativePath);
  const source = readFileSync(path, 'utf8');
  const next = transform(source);
  if (MODE === 'check' && next !== source) throw new Error(`${relativePath}: hardening clínico ainda não materializado`);
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
    const hardeningTag = modulePath === 'core/lib/app-data.js'
      ? '+delivery2-lifecycle-hardening'
      : '+delivery1-integrity-hardening';
    if (!String(entry.source || '').includes(hardeningTag)) {
      if (MODE === 'check') throw new Error(`clinical manifest: origem sem hardening ${modulePath}`);
      entry.source = `${entry.source || modulePath}${hardeningTag}`;
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
  if (writeTarget('public/clinical-source/core/lib/app-data.js', hardenDelivery2AppData)) changed.push('app-data-delivery2');
  if (syncClinicalManifest(['core/app-shell.js', 'features/patient-fixes.js', 'core/lib/app-data.js'])) changed.push('clinical-manifest');
  return changed;
}

const executedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  const changed = runDelivery1FrontendHardening();
  console.log(`Clinical frontend hardening ${MODE}: ${changed.length ? changed.join(', ') : 'already hardened'}`);
}
