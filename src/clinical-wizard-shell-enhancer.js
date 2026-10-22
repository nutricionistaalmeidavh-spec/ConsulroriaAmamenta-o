// Isolated runtime augmentation: the canonical clinical bundle and SHA manifest remain unchanged.
const CONTROLLER_MARKER = 'const wizardRecovery = createWizardRecoveryController(';

function replaceOnce(source, before, after) {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + before.length) !== -1) {
    throw new Error('Wizard recovery integration anchor missing or ambiguous: ' + before.slice(0, 100));
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

export function enhanceWizardShellWithRecovery(source, controllerModuleUrl) {
  if (typeof source !== 'string' || !controllerModuleUrl?.startsWith('blob:')) {
    throw new TypeError('Canonical shell and a blob controller module URL are required.');
  }
  if (source.includes(CONTROLLER_MARKER)) return source;
  let result = source;
  const controller = [
    'const wizardRecovery = createWizardRecoveryController({',
    '  root: appointmentScreen,',
    '  owner: () => authService?.getSession()?.user?.id,',
    "  mother: () => document.querySelector('[data-appointment-patient]')?.value,",
    '  identity: () => ({ encounterId: currentDraftEncounterId, appointmentId: currentAppointmentId }),',
    '  collect: () => collectEncounterDraft(appointmentScreen),',
    '  apply: (saved) => {',
    "    const target = saved.babyTarget || saved.state?.identification?.babyTarget || null;",
    "    renderBabyTargetSelect(document.querySelector('[data-appointment-patient]')?.value, target);",
    '    renderBabyClinicalSections();',
    '    applyEncounterDraft(appointmentScreen, saved.state);',
    '  },',
    '  step: () => wizardStep,',
    '  setStep: (value) => { wizardStep = Math.max(1, Math.min(7, Number(value) || 1)); renderWizard(); },',
    '  notify: (message, level) => toast(message, level),',
    '});',
  ].join('\n');
  result = replaceOnce(result, "let encounterAutosaveBusy = false;", "let encounterAutosaveBusy = false;\nlet encounterAutosaveAgain = false;");
  result = replaceOnce(result,
    "const state = { patients: [], appointments: [], encounters: [], followups: [], financial: [] };",
    "const state = { patients: [], appointments: [], encounters: [], followups: [], financial: [] };\n" + controller);
  result = replaceOnce(result,
    "function showLoggedOut() {\n  appStarted = false;",
    "function showLoggedOut() {\n  wizardRecovery.reset();\n  appStarted = false;");
  result = replaceOnce(result,
    "  setEncounterIdentityLock(Boolean(currentDraftEncounterId || currentAppointmentId));\n}\nasync function createOrResumeEncounter()",
    "  setEncounterIdentityLock(Boolean(currentDraftEncounterId || currentAppointmentId));\n  void wizardRecovery.identityChanged();\n}\nasync function createOrResumeEncounter()");
  result = replaceOnce(result,
    "function resetWizard(selectedMotherId = currentPatientId) {\n  clearTimeout(encounterAutosaveTimer);",
    "function resetWizard(selectedMotherId = currentPatientId) {\n  wizardRecovery.reset();\n  clearTimeout(encounterAutosaveTimer);");
  result = replaceOnce(result,
    "function scheduleEncounterAutosave() {\n  if (!currentDraftEncounterId || encounterAutosaveBusy) return;",
    "function scheduleEncounterAutosave() {\n  if (!currentDraftEncounterId) return;\n  if (encounterAutosaveBusy) { encounterAutosaveAgain = true; return; }");
  result = replaceOnce(result,
    "    finally { encounterAutosaveBusy = false; }",
    "    finally { encounterAutosaveBusy = false; if (encounterAutosaveAgain) { encounterAutosaveAgain = false; scheduleEncounterAutosave(); } }");
  result = replaceOnce(result,
    "  applyEncounterDraft(appointmentScreen, encounter);\n  setEncounterIdentityLock(true);",
    "  applyEncounterDraft(appointmentScreen, encounter);\n  await wizardRecovery.inspect();\n  setEncounterIdentityLock(true);");
  result = replaceOnce(result,
    "    renderWizard();\n  }\n  showScreen(screen);\n}",
    "    renderWizard();\n    if (!appointmentScreen?.querySelector('[data-wizard-recovery]')) await wizardRecovery.inspect();\n  }\n  showScreen(screen);\n}");
  result = replaceOnce(result,
    "  const payload = buildEncounterPayload({ motherId: patient.mother.id, babyId: selectedWizardBabyId(), appointmentId: currentAppointmentId, state: clinicalState, status: 'draft' });",
    "  const localWizardSnapshot = await wizardRecovery.capture();\n  const payload = buildEncounterPayload({ motherId: patient.mother.id, babyId: selectedWizardBabyId(), appointmentId: currentAppointmentId, state: clinicalState, status: 'draft' });");
  result = replaceOnce(result,
    "  if (!saved?.id) throw new Error('Não foi possível confirmar o rascunho no SQL.');",
    "  if (!saved?.id) throw new Error('Não foi possível confirmar o rascunho no SQL.');\n  await wizardRecovery.confirmSaved(localWizardSnapshot);");
  result = replaceOnce(result,
    "  const singleBabyId = selectedBabies.length === 1 ? selectedBabies[0].id : null;\n  const clinicalState = collectEncounterDraft(appointmentScreen);",
    "  const singleBabyId = selectedBabies.length === 1 ? selectedBabies[0].id : null;\n  const finalWizardSnapshot = await wizardRecovery.capture();\n  const clinicalState = collectEncounterDraft(appointmentScreen);");
  result = replaceOnce(result,
    "  clearTimeout(encounterAutosaveTimer);\n  setActiveEncounterIds(null, null);\n  pendingMediaFile = null;",
    "  clearTimeout(encounterAutosaveTimer);\n  await wizardRecovery.confirmSaved(finalWizardSnapshot);\n  wizardRecovery.reset();\n  setActiveEncounterIds(null, null);\n  pendingMediaFile = null;");
  result = replaceOnce(result,
    "appointmentScreen?.addEventListener('input', scheduleEncounterAutosave);\nappointmentScreen?.addEventListener('change', scheduleEncounterAutosave);",
    "appointmentScreen?.addEventListener('input', scheduleEncounterAutosave);\nappointmentScreen?.addEventListener('change', scheduleEncounterAutosave);\nappointmentScreen?.addEventListener('input', () => { void wizardRecovery.capture(); });\nappointmentScreen?.addEventListener('change', () => { void wizardRecovery.capture(); });");
  result = replaceOnce(result,
    "  syncEncounterAddressFromPatient({ force: true });\n});\ndocument.querySelector('[data-appointment-baby]')?.addEventListener",
    "  syncEncounterAddressFromPatient({ force: true });\n  void wizardRecovery.inspect();\n});\ndocument.querySelector('[data-appointment-baby]')?.addEventListener");
  result = replaceOnce(result,
    "      if (selected && choice.dataset.field === 'format') syncEncounterAddressFromPatient({ force: true, format: choice.dataset.value });",
    "      if (selected && choice.dataset.field === 'format') syncEncounterAddressFromPatient({ force: true, format: choice.dataset.value });\n      void wizardRecovery.capture();");
  result = replaceOnce(result,
    "          wizardStep += 1; renderWizard();",
    "          wizardStep += 1; renderWizard(); void wizardRecovery.capture();");
  result = replaceOnce(result,
    "if (wizardStep > 1) { wizardStep -= 1; renderWizard(); }",
    "if (wizardStep > 1) { wizardStep -= 1; renderWizard(); void wizardRecovery.capture(); }");
  result = replaceOnce(result,
    "window.addEventListener('hashchange', () => renderRoute().catch(reportError));",
    "window.addEventListener('online', () => { if (currentDraftEncounterId) scheduleEncounterAutosave(); });\nwindow.addEventListener('hashchange', () => renderRoute().catch(reportError));");
  return "import { createWizardRecoveryController } from " + JSON.stringify(controllerModuleUrl) + ";\n" + result;
}
