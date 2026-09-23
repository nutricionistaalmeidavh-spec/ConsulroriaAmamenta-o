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

function replaceRange(source, start, end, replacement, label) {
  if (source.includes(replacement.trim())) return source;
  const from = source.indexOf(start);
  const to = from >= 0 ? source.indexOf(end, from) : -1;
  if (from < 0 || to < 0) throw new Error(`${label}: trecho esperado não encontrado`);
  return `${source.slice(0, from)}${replacement}${source.slice(to)}`;
}

export function hardenDelivery2AppShell(source) {
  let next = String(source);

  next = ensureReplace(
    next,
    'let encounterAutosaveBusy = false;',
    `let encounterAutosaveBusy = false;\nlet encounterAutosaveRevision = 0;\nlet encounterAutosaveQueued = false;\nlet encounterAutosavePromise = Promise.resolve(null);\nlet encounterFinalizing = false;\nlet encounterStartRequestKey = null;\nlet encounterFinalizeRequestKey = null;`,
    'C01 autosave lifecycle state',
  );

  next = ensureReplace(
    next,
    `  const result = await appData.startClinicalEncounter({\n    p_mother_id: patient.mother.id,`,
    `  encounterStartRequestKey ||= crypto.randomUUID();\n  const result = await appData.startClinicalEncounter({\n    p_request_key: encounterStartRequestKey,\n    p_mother_id: patient.mother.id,`,
    'R05 stable direct-start idempotency key',
  );

  const autosaveBlock = `async function performEncounterAutosave({ force = false } = {}) {\n  if (!currentDraftEncounterId || (encounterFinalizing && !force)) return null;\n  if (encounterAutosaveBusy) {\n    encounterAutosaveQueued = true;\n    return encounterAutosavePromise;\n  }\n  encounterAutosaveBusy = true;\n  const startedRevision = encounterAutosaveRevision;\n  encounterAutosaveQueued = false;\n  try {\n    return await saveDraft({ silent: true });\n  } catch (error) {\n    console.warn('Autosave clínico falhou', error);\n    return null;\n  } finally {\n    encounterAutosaveBusy = false;\n    if (!encounterFinalizing && encounterAutosaveQueued && encounterAutosaveRevision > startedRevision) {\n      encounterAutosavePromise = performEncounterAutosave();\n    }\n  }\n}\nfunction scheduleEncounterAutosave() {\n  if (!currentDraftEncounterId || encounterFinalizing) return;\n  encounterAutosaveRevision += 1;\n  encounterAutosaveQueued = true;\n  clearTimeout(encounterAutosaveTimer);\n  encounterAutosaveTimer = setTimeout(() => {\n    encounterAutosavePromise = performEncounterAutosave();\n  }, 700);\n}\nasync function drainEncounterAutosave() {\n  clearTimeout(encounterAutosaveTimer);\n  if (!currentDraftEncounterId) return null;\n  let observed = null;\n  do {\n    if (encounterAutosaveQueued && !encounterAutosaveBusy) {\n      encounterAutosavePromise = performEncounterAutosave({ force: true });\n    }\n    observed = encounterAutosavePromise;\n    await observed;\n  } while (encounterAutosaveBusy || encounterAutosaveQueued || encounterAutosavePromise !== observed);\n  return null;\n}\n`;
  next = replaceRange(
    next,
    'function scheduleEncounterAutosave() {',
    'function resetWizard(',
    autosaveBlock,
    'C01 serialized autosave drain barrier',
  );

  next = ensureReplace(
    next,
    `function resetWizard(selectedMotherId = currentPatientId) {\n  clearTimeout(encounterAutosaveTimer);`,
    `function resetWizard(selectedMotherId = currentPatientId) {\n  clearTimeout(encounterAutosaveTimer);\n  encounterAutosaveRevision = 0;\n  encounterAutosaveQueued = false;\n  encounterAutosavePromise = Promise.resolve(null);\n  encounterFinalizing = false;\n  encounterStartRequestKey = null;\n  encounterFinalizeRequestKey = null;`,
    'C01 reset autosave lifecycle',
  );

  const finalizeBlock = `async function finalizeEncounter() {\n  const patient = selectedWizardPatient();\n  if (!patient) throw new Error('Selecione uma paciente.');\n  const selectedBabies = selectedWizardBabies();\n  if (!selectedBabies.length) throw new Error('Selecione pelo menos um bebê.');\n  await ensureEncounterStarted();\n  encounterFinalizing = true;\n  try {\n    await drainEncounterAutosave();\n    const singleBabyId = selectedBabies.length === 1 ? selectedBabies[0].id : null;\n    const clinicalState = collectEncounterDraft(appointmentScreen);\n    const ident = clinicalState.identification || {};\n    ident.babyIds = selectedBabies.map((baby) => baby.id);\n    clinicalState.identification = ident;\n    const startsAt = ident.startsAt ? clinicInputToIso(ident.startsAt) : new Date().toISOString();\n    const valueCents = Math.max(0, Math.round(Number(ident.value || 0) * 100));\n    const finalBillingSelection = await window.DeboraBilling?.beforeStart?.(patient.mother.id);\n    await window.DeboraBilling?.bindAppointment?.(patient.mother.id, currentAppointmentId, currentDraftEncounterId, finalBillingSelection);\n\n    const appointmentPatch = {\n      mother_id: patient.mother.id,\n      baby_id: singleBabyId,\n      starts_at: startsAt,\n      duration_min: Number(ident.durationMin || 60),\n      appointment_type: ident.appointmentType || 'Atendimento',\n      format: ident.format || 'Domiciliar',\n      status: 'Realizado',\n      value_cents: valueCents,\n      payment_status: valueCents ? 'Pendente' : 'Sem cobrança',\n      notes: selectedBabies.length > 1 ? \`Atendimento conjunto: \${selectedBabies.map((baby) => baby.name).join(', ')}\` : ''\n    };\n    const encounterPatch = buildEncounterPayload({\n      motherId: patient.mother.id, babyId: singleBabyId, appointmentId: currentAppointmentId, state: clinicalState, status: 'finalized'\n    });\n    const weights = selectedBabies.map((baby) => {\n      const assessment = clinicalState.baby_assessment?.byBaby?.[baby.id] || (selectedBabies.length === 1 ? clinicalState.baby_assessment : {});\n      const weight = Number(assessment?.weightG || 0);\n      return weight > 0 ? { baby_id: baby.id, weight_g: weight, measured_at: startsAt } : null;\n    }).filter(Boolean);\n    const dueAt = followupDue(clinicalState.care_plan?.followup, new Date(startsAt));\n    const followup = dueAt ? {\n      baby_id: singleBabyId,\n      due_at: dueAt,\n      notes: selectedBabies.length > 1 ? \`Acompanhamento de \${selectedBabies.map((baby) => baby.name).join(' e ')}\` : 'Acompanhamento após atendimento'\n    } : null;\n    encounterFinalizeRequestKey ||= crypto.randomUUID();\n    const encounter = await appData.finalizeClinicalEncounterAtomic({\n      p_request_key: encounterFinalizeRequestKey,\n      p_appointment_id: currentAppointmentId,\n      p_encounter_id: currentDraftEncounterId,\n      p_appointment_patch: appointmentPatch,\n      p_encounter_patch: encounterPatch,\n      p_weights: weights,\n      p_followup: followup,\n      p_financial: valueCents > 0 ? {\n        description: ident.appointmentType || 'Atendimento', amount_cents: valueCents, due_at: startsAt.slice(0, 10)\n      } : null\n    });\n    if (!encounter?.encounter_id) throw new Error('O banco não confirmou a finalização atômica do atendimento.');\n\n    // Package consumption remains retryable after the clinical transaction; the next delivery hardens\n    // package/session counters themselves. Individual billing is already part of the transaction above.\n    const billingResult = await window.DeboraBilling?.finalize?.(patient.mother.id, currentAppointmentId, currentDraftEncounterId);\n    if (finalBillingSelection?.mode === 'individual' && billingResult?.handled === false) {\n      throw new Error('A cobrança do atendimento não foi confirmada.');\n    }\n\n    if (pendingMediaFile) {\n      const consents = await appData.listConsents(patient.mother.id);\n      await mediaService.upload({\n        file: pendingMediaFile, ownerId: authService.getSession()?.user?.id, motherId: patient.mother.id,\n        babyId: singleBabyId, encounterId: currentDraftEncounterId, consents\n      });\n    }\n    clearTimeout(encounterAutosaveTimer);\n    encounterAutosaveQueued = false;\n    setActiveEncounterIds(null, null);\n    encounterStartRequestKey = null;\n    encounterFinalizeRequestKey = null;\n    pendingMediaFile = null;\n    toast('Atendimento salvo com segurança.', 'success');\n    await refreshData();\n    await openPatient(patient.mother.id);\n  } finally {\n    encounterFinalizing = false;\n  }\n}\n\n`;
  next = replaceRange(
    next,
    'async function finalizeEncounter() {',
    'function choosePatientPrompt()',
    finalizeBlock,
    'R08 atomic finalization frontend',
  );

  next = ensureReplace(
    next,
    'flush:()=>currentDraftEncounterId?saveDraft({silent:true}):Promise.resolve(null)',
    'flush:()=>drainEncounterAutosave()',
    'C01 external flush drain barrier',
  );

  return next;
}

function writeTarget(relativePath, transform) {
  const path = resolve(ROOT, relativePath);
  const source = readFileSync(path, 'utf8');
  const next = transform(source);
  if (MODE === 'check' && next !== source) throw new Error(`${relativePath}: Entrega 2 ainda não materializada`);
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
    if (!String(entry.source || '').includes('+delivery2-lifecycle-hardening')) {
      if (MODE === 'check') throw new Error(`clinical manifest: origem sem Entrega 2 ${modulePath}`);
      entry.source = `${entry.source || modulePath}+delivery2-lifecycle-hardening`;
      changed = true;
    }
  }
  if (changed && MODE === 'write') writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return changed;
}

export function runDelivery2FrontendHardening() {
  const changed = [];
  if (writeTarget('public/clinical-source/core/app-shell.js', hardenDelivery2AppShell)) changed.push('app-shell');
  if (syncClinicalManifest(['core/app-shell.js', 'core/lib/app-data.js'])) changed.push('clinical-manifest');
  return changed;
}

const executedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  const changed = runDelivery2FrontendHardening();
  console.log(`Delivery 2 frontend ${MODE}: ${changed.length ? changed.join(', ') : 'already hardened'}`);
}
