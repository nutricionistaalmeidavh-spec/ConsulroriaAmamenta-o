// Apply additive wizard-only protection to the materialized runtime, without forking the canonical API.
// All changes fail closed if the expected app-shell contracts move.
const PATCHES = [
  [
    "let agendaSelectedDay = null;",
    "let agendaSelectedDay = null;\nconst wizardEncryptedStore = createEncryptedWizardDraftStore();\nlet wizardDraftTag = null;\nlet wizardLocalRevision = 0;\nlet wizardConfirmedRevision = 0;\nlet wizardRecoveryOpen = false;\nlet wizardRetryTimer = null;\nlet wizardRetryDelay = 1500;\nlet wizardRecoveryDialog = null;\nfunction wizardNewTag() {\n  return globalThis.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random().toString(36).slice(2);\n}\nfunction wizardBackupStatus(message, danger = false) {\n  if (!appointmentScreen) return;\n  let status = appointmentScreen.querySelector('[data-wizard-backup-status]');\n  if (!status) {\n    status = document.createElement('p');\n    status.dataset.wizardBackupStatus = '';\n    status.setAttribute('role', 'status');\n    status.style.cssText = 'padding:6px 12px;margin:6px 0;font-size:12px;line-height:1.5;border-radius:8px';\n    (appointmentScreen.querySelector('.wizard-header') || appointmentScreen).appendChild(status);\n  }\n  status.textContent = message;\n  status.style.color = danger ? '#992f35' : '#365c4f';\n  status.style.background = danger ? '#fff0ee' : '#eff9f4';\n}\nfunction wizardStorageWarning(error) {\n  console.warn('Cópia criptografada do atendimento indisponível', error);\n  wizardBackupStatus('Cópia local indisponível. Não feche a tela até confirmar que o atendimento foi salvo no banco.', true);\n}\nfunction wizardAuthenticatedOwner() {\n  return authService?.getSession?.()?.user?.id || null;\n}\nfunction wizardSnapshot(stateOverride = null) {\n  if (wizardRecoveryOpen || !appointmentScreen) return null;\n  const ownerId = wizardAuthenticatedOwner();\n  const motherId = selectedWizardPatient()?.mother?.id;\n  if (!ownerId || !motherId) return null;\n  if (!wizardDraftTag) wizardDraftTag = wizardNewTag();\n  const encounterId = currentDraftEncounterId || null;\n  const appointmentId = currentAppointmentId || null;\n  const key = wizardEncryptedStore.scope(ownerId, motherId, { encounterId, appointmentId });\n  const value = {\n    schema: 1, tag: wizardDraftTag, revision: wizardLocalRevision, motherId, encounterId, appointmentId,\n    babyTarget: document.querySelector('[data-appointment-baby]')?.value || null,\n    wizardStep: wizardStep,\n    state: stateOverride || collectEncounterDraft(appointmentScreen),\n  };\n  return { key, value, ownerId, motherId };\n}\nfunction wizardPersistLocalSnapshot(stateOverride = null) {\n  const snapshot = wizardSnapshot(stateOverride);\n  if (!snapshot) return Promise.resolve(null);\n  return wizardEncryptedStore.write(snapshot.key, snapshot.value).then(async () => {\n    // The encounter now has an authoritative ID. Migrate the initial unsaved copy\n    // only AFTER the new encrypted copy was committed locally.\n    if (snapshot.value.encounterId) {\n      const oldScopes = [\n        wizardEncryptedStore.scope(snapshot.ownerId, snapshot.motherId, { appointmentId: snapshot.value.appointmentId }),\n        wizardEncryptedStore.scope(snapshot.ownerId, snapshot.motherId),\n      ];\n      for (const oldScope of new Set(oldScopes)) {\n        if (oldScope === snapshot.key) continue;\n        try {\n          const previous = await wizardEncryptedStore.read(oldScope);\n          if (previous?.tag === snapshot.value.tag && Number(previous.revision) <= Number(snapshot.value.revision)) {\n            await wizardEncryptedStore.clear(oldScope, previous);\n          }\n        } catch (error) {\n          console.warn('Não foi possível limpar o rascunho anterior ao início do atendimento', error);\n        }\n      }\n    }\n    wizardBackupStatus('Cópia criptografada neste dispositivo · aguardando confirmação do banco');\n    return snapshot;\n  });\n}\nfunction wizardCaptureLocal() {\n  if (wizardRecoveryOpen) return;\n  wizardLocalRevision += 1;\n  wizardPersistLocalSnapshot().catch(wizardStorageWarning);\n}\nfunction wizardClearRetry() {\n  clearTimeout(wizardRetryTimer);\n  wizardRetryTimer = null;\n  wizardRetryDelay = 1500;\n}\nfunction wizardIsVersionConflict(error) {\n  return /stale_record_version|record_version_required|conflito de versão|prontuário foi alterado|recarregue o prontuário/i.test(String(error?.message || ''));\n}\nfunction wizardScheduleRetry(error) {\n  if (wizardIsVersionConflict(error)) {\n    wizardBackupStatus('Conflito de versão: dados locais preservados. Reabra o prontuário e revise antes de salvar.', true);\n    return;\n  }\n  if (/sessão expirada|não autorizado|forbidden|invalid|não encontrado|permissão/i.test(String(error?.message || ''))) return;\n  if (!navigator.onLine) return;\n  clearTimeout(wizardRetryTimer);\n  const delay = wizardRetryDelay;\n  wizardRetryDelay = Math.min(delay * 2, 30000);\n  wizardRetryTimer = setTimeout(() => {\n    if (!wizardRecoveryOpen && currentDraftEncounterId && wizardLocalRevision > wizardConfirmedRevision && !encounterAutosaveBusy) {\n      scheduleEncounterAutosave();\n    }\n  }, delay);\n}\nasync function wizardConfirmSaved(snapshot) {\n  if (!snapshot) return;\n  wizardConfirmedRevision = Math.max(wizardConfirmedRevision, snapshot.value.revision);\n  const candidates = [\n    snapshot.key,\n    wizardEncryptedStore.scope(snapshot.ownerId, snapshot.motherId, { appointmentId: snapshot.value.appointmentId }),\n    wizardEncryptedStore.scope(snapshot.ownerId, snapshot.motherId),\n  ];\n  for (const key of new Set(candidates)) {\n    try {\n      const row = await wizardEncryptedStore.read(key);\n      if (row?.tag !== snapshot.value.tag) continue;\n      // Never clear edits made while this server request was pending.\n      if (Number(row.revision) > Number(snapshot.value.revision)) continue;\n      await wizardEncryptedStore.clear(key, row);\n    } catch (error) {\n      console.warn('Não foi possível limpar a cópia sincronizada', error);\n    }\n  }\n  wizardClearRetry();\n  if (wizardLocalRevision === snapshot.value.revision) {\n    wizardBackupStatus('Salvo no banco de dados');\n  }\n}\nfunction wizardDismissRecovery() {\n  wizardRecoveryDialog?.remove();\n  wizardRecoveryDialog = null;\n  wizardRecoveryOpen = false;\n  if (appointmentScreen) appointmentScreen.inert = false;\n}\nfunction wizardBeginNewSession() {\n  wizardDismissRecovery();\n  wizardClearRetry();\n  wizardDraftTag = wizardNewTag();\n  wizardLocalRevision = 0;\n  wizardConfirmedRevision = 0;\n  const status = appointmentScreen?.querySelector('[data-wizard-backup-status]');\n  if (status) status.textContent = '';\n}\nasync function wizardOfferRecovery(serverEncounter = null) {\n  wizardDismissRecovery();\n  const ownerId = wizardAuthenticatedOwner();\n  const motherId = selectedWizardPatient()?.mother?.id;\n  if (!ownerId || !motherId) return;\n  const encounterId = currentDraftEncounterId || null;\n  const appointmentId = currentAppointmentId || null;\n  const scopes = [\n    encounterId && wizardEncryptedStore.scope(ownerId, motherId, { encounterId }),\n    appointmentId && wizardEncryptedStore.scope(ownerId, motherId, { appointmentId }),\n    // Never import an unrelated new consultation into a known encounter.\n    (!encounterId && !appointmentId) && wizardEncryptedStore.scope(ownerId, motherId),\n  ].filter(Boolean);\n  let recovered = null;\n  for (const key of new Set(scopes)) {\n    let value;\n    try { value = await wizardEncryptedStore.read(key); }\n    catch (error) { wizardStorageWarning(error); return; }\n    if (!value || value.schema !== 1 || value.motherId !== motherId || !value.state) continue;\n    // A local encounter/appointment is never allowed to be restored into a different record.\n    if (value.encounterId && value.encounterId !== encounterId) continue;\n    if (value.appointmentId && value.appointmentId !== appointmentId) continue;\n    recovered = { key, value };\n    break;\n  }\n  if (!recovered || !appointmentScreen) return;\n  if (ownerId !== wizardAuthenticatedOwner() || motherId !== selectedWizardPatient()?.mother?.id || encounterId !== currentDraftEncounterId || appointmentId !== currentAppointmentId) return;\n  const { key, value } = recovered;\n  wizardRecoveryOpen = true;\n  clearTimeout(encounterAutosaveTimer);\n  appointmentScreen.inert = true;\n  const cover = document.createElement('div');\n  cover.dataset.wizardRecoveryDialog = '';\n  cover.setAttribute('role', 'dialog');\n  cover.setAttribute('aria-modal', 'true');\n  cover.setAttribute('aria-label', 'Recuperar atendimento não sincronizado');\n  cover.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(16,20,25,.72);display:flex;align-items:center;justify-content:center;padding:18px';\n  cover.innerHTML = '<div style=\"background:white;color:#26332f;max-width:460px;width:100%;border-radius:16px;padding:24px;box-shadow:0 20px 64px #1115\"><h2 style=\"font-size:21px;margin:0 0 12px\">Atendimento não sincronizado</h2><p>Existe uma cópia criptografada das etapas do atendimento neste dispositivo. O banco ainda pode conter outra versão. Escolha qual conteúdo deseja usar.</p><p style=\"font-size:13px\">Se houve atualização em outro dispositivo, confira os dados antes de salvar. Anexos devem ser selecionados novamente.</p><div style=\"display:flex;gap:8px;flex-wrap:wrap\"><button type=\"button\" data-wizard-restore style=\"padding:10px 14px;border-radius:9px\">Recuperar rascunho local</button><button type=\"button\" data-wizard-discard style=\"padding:10px 14px;border-radius:9px\">Descartar cópia local</button></div><p data-wizard-recovery-error role=\"alert\" style=\"color:#9c2424\"></p></div>';\n  wizardRecoveryDialog = cover;\n  document.body.appendChild(cover);\n  const errorNode = cover.querySelector('[data-wizard-recovery-error]');\n  const restore = cover.querySelector('[data-wizard-restore]');\n  const discard = cover.querySelector('[data-wizard-discard]');\n  restore.focus();\n  cover.addEventListener('keydown', event => {\n    if (event.key !== 'Tab') return;\n    const buttons = [restore, discard];\n    const index = buttons.indexOf(document.activeElement);\n    if (event.shiftKey && index <= 0) { event.preventDefault(); discard.focus(); }\n    else if (!event.shiftKey && index === 1) { event.preventDefault(); restore.focus(); }\n  });\n  restore.onclick = () => {\n    if (ownerId !== wizardAuthenticatedOwner() || motherId !== selectedWizardPatient()?.mother?.id || encounterId !== currentDraftEncounterId || appointmentId !== currentAppointmentId) { wizardDismissRecovery(); return; }\n    try {\n      wizardDraftTag = value.tag;\n      wizardLocalRevision = Math.max(wizardLocalRevision, Number(value.revision) || 0);\n      const patient = selectedWizardPatient();\n      renderBabyTargetSelect(patient.mother.id, value.babyTarget || null);\n      renderBabyClinicalSections();\n      applyEncounterDraft(appointmentScreen, value.state);\n      wizardStep = Math.max(1, Math.min(7, Number(value.wizardStep) || 1));\n      wizardDismissRecovery();\n      renderWizard();\n      wizardBackupStatus('Rascunho recuperado. Revise os dados e toque em Continuar ou Salvar para sincronizar.');\n      wizardPersistLocalSnapshot().catch(wizardStorageWarning);\n    } catch (error) {\n      errorNode.textContent = 'Não foi possível recuperar o rascunho: ' + String(error?.message || error);\n    }\n  };\n  discard.onclick = async () => {\n    if (ownerId !== wizardAuthenticatedOwner() || motherId !== selectedWizardPatient()?.mother?.id || encounterId !== currentDraftEncounterId || appointmentId !== currentAppointmentId) { wizardDismissRecovery(); return; }\n    restore.disabled = true;\n    discard.disabled = true;\n    try {\n      await wizardEncryptedStore.clear(key, value);\n      wizardDismissRecovery();\n      wizardBackupStatus('Dados do banco mantidos. Cópia local descartada.');\n    } catch (error) {\n      restore.disabled = false;\n      discard.disabled = false;\n      errorNode.textContent = 'Não foi possível descartar o rascunho: ' + String(error?.message || error);\n    }\n  };\n}\nfunction wizardAttemptPendingSave() {\n  if (!wizardRecoveryOpen && currentDraftEncounterId && wizardLocalRevision > wizardConfirmedRevision) {\n    scheduleEncounterAutosave(false);\n  }\n}"
  ],
  [
    "function scheduleEncounterAutosave() {\n  if (!currentDraftEncounterId || encounterAutosaveBusy) return;",
    "function scheduleEncounterAutosave(capture = true) {\n  if (capture?.target?.matches?.('[data-appointment-patient]')) return;\n  if (capture !== false) wizardCaptureLocal();\n  if (!currentDraftEncounterId || wizardRecoveryOpen) return;"
  ],
  [
    "    if (!currentDraftEncounterId || encounterAutosaveBusy) return;\n    encounterAutosaveBusy = true;",
    "    if (!currentDraftEncounterId || wizardRecoveryOpen) return;\n    if (encounterAutosaveBusy) { clearTimeout(encounterAutosaveTimer); encounterAutosaveTimer = setTimeout(wizardAttemptPendingSave, 700); return; }\n    encounterAutosaveBusy = true;"
  ],
  [
    "    try { await saveDraft({ silent: true }); } catch (error) { console.warn('Autosave clínico falhou', error); }\n    finally { encounterAutosaveBusy = false; }",
    "    try { await saveDraft({ silent: true }); } catch (error) { console.warn('Autosave clínico falhou', error); wizardBackupStatus('Banco indisponível; alterações preservadas neste dispositivo.', true); wizardScheduleRetry(error); }\n    finally { encounterAutosaveBusy = false; if (wizardLocalRevision > wizardConfirmedRevision && !wizardRecoveryOpen && !wizardRetryTimer && navigator.onLine) { clearTimeout(encounterAutosaveTimer); encounterAutosaveTimer = setTimeout(wizardAttemptPendingSave, 700); } }"
  ],
  [
    "function resetWizard(selectedMotherId = currentPatientId) {\n  clearTimeout(encounterAutosaveTimer);",
    "function resetWizard(selectedMotherId = currentPatientId) {\n  wizardBeginNewSession();\n  clearTimeout(encounterAutosaveTimer);"
  ],
  [
    "  navigate('appointment');\n  toast('Rascunho aberto. Continue de onde parou.', 'success');",
    "  navigate('appointment');\n  await wizardOfferRecovery(encounter);\n  if (!wizardRecoveryOpen) toast('Rascunho aberto. Continue de onde parou.', 'success');"
  ],
  [
    "  navigate('appointment');\n  toast('Agendamento carregado. Ao continuar, ele passa para “Em atendimento”.', 'success');",
    "  navigate('appointment');\n  await wizardOfferRecovery(null);\n  if (!wizardRecoveryOpen) toast('Agendamento carregado. Ao continuar, ele passa para “Em atendimento”.', 'success');"
  ],
  [
    "  await ensureEncounterStarted();\n  const clinicalState = collectEncounterDraft(appointmentScreen);",
    "  await wizardPersistLocalSnapshot().catch(wizardStorageWarning);\n  await ensureEncounterStarted();\n  const clinicalState = collectEncounterDraft(appointmentScreen);"
  ],
  [
    "  clinicalState.identification.babyIds = selectedWizardBabies().map((baby) => baby.id);\n  const payload = buildEncounterPayload",
    "  clinicalState.identification.babyIds = selectedWizardBabies().map((baby) => baby.id);\n  const wizardSavedSnapshot = await wizardPersistLocalSnapshot(clinicalState).catch(error => { wizardStorageWarning(error); return null; });\n  const payload = buildEncounterPayload"
  ],
  [
    "  if (!saved?.id) throw new Error('Não foi possível confirmar o rascunho no SQL.');\n  if (!silent)",
    "  if (!saved?.id) throw new Error('Não foi possível confirmar o rascunho no SQL.');\n  await wizardConfirmSaved(wizardSavedSnapshot);\n  if (!silent)"
  ],
  [
    "  await ensureEncounterStarted();\n  const singleBabyId = selectedBabies.length === 1 ? selectedBabies[0].id : null;",
    "  await wizardPersistLocalSnapshot().catch(wizardStorageWarning);\n  await ensureEncounterStarted();\n  const wizardFinalSnapshot = await wizardPersistLocalSnapshot().catch(error => { wizardStorageWarning(error); return null; });\n  const singleBabyId = selectedBabies.length === 1 ? selectedBabies[0].id : null;"
  ],
  [
    "  clearTimeout(encounterAutosaveTimer);\n  setActiveEncounterIds(null, null);\n  pendingMediaFile = null;",
    "  clearTimeout(encounterAutosaveTimer);\n  await wizardConfirmSaved(wizardFinalSnapshot);\n  setActiveEncounterIds(null, null);\n  pendingMediaFile = null;"
  ],
  [
    "    await renderRoute();\n    showLoggedIn();",
    "    await renderRoute();\n    showLoggedIn();\n    if (activeScreen === 'appointment') await wizardOfferRecovery(null);"
  ],
  [
    "        if (wizardStep < 7) {\n          if (wizardStep === 1) await ensureEncounterStarted();",
    "        if (wizardStep < 7) {\n          if (wizardStep === 1) { await wizardPersistLocalSnapshot().catch(wizardStorageWarning); await ensureEncounterStarted(); }"
  ],
  [
    "          wizardStep += 1; renderWizard();",
    "          wizardStep += 1; renderWizard(); wizardCaptureLocal();"
  ],
  [
    "    if (event.target.closest('[data-wizard-prev]')) { if (wizardStep > 1) { wizardStep -= 1; renderWizard(); } }",
    "    if (event.target.closest('[data-wizard-prev]')) { if (wizardStep > 1) { wizardStep -= 1; renderWizard(); wizardCaptureLocal(); } }"
  ],
  [
    "    else if (action === 'new-appointment') { previousScreen = activeScreen; resetWizard(activeScreen === 'patient' ? currentPatientId : null); navigate('appointment'); }",
    "    else if (action === 'new-appointment') { previousScreen = activeScreen; resetWizard(activeScreen === 'patient' ? currentPatientId : null); navigate('appointment'); await wizardOfferRecovery(null); }"
  ],
  [
    "window.addEventListener('hashchange', () => renderRoute().catch(reportError));",
    "window.addEventListener('online', () => { wizardClearRetry(); wizardAttemptPendingSave(); });\nwindow.addEventListener('hashchange', () => renderRoute().catch(reportError));"
  ],
  [
    "function showLoggedOut() {\n  appStarted = false;",
    "function showLoggedOut() {\n  wizardBeginNewSession();\n  appStarted = false;"
  ],
  [
    "  syncEncounterAddressFromPatient({ force: true });\n});\ndocument.querySelector('[data-appointment-baby]')?.addEventListener('change', () => {",
    "  syncEncounterAddressFromPatient({ force: true });\n  void wizardOfferRecovery(null).catch(wizardStorageWarning);\n});\ndocument.querySelector('[data-appointment-baby]')?.addEventListener('change', () => {"
  ],
  [
    "  if (currentDraftEncounterId) { setEncounterIdentityLock(true); return; }\n  renderBabyClinicalSections();\n});\nappointmentScreen?.addEventListener",
    "  if (currentDraftEncounterId) { setEncounterIdentityLock(true); return; }\n  renderBabyClinicalSections();\n  wizardCaptureLocal();\n});\nappointmentScreen?.addEventListener"
  ],
  [
    "      if (selected && choice.dataset.field === 'format') syncEncounterAddressFromPatient({ force: true, format: choice.dataset.value });",
    "      if (selected && choice.dataset.field === 'format') syncEncounterAddressFromPatient({ force: true, format: choice.dataset.value });\n      wizardCaptureLocal();"
  ]
];

export function enhanceClinicalWizardWithRecovery(source, storageModuleUrl) {
  if (typeof source !== 'string') throw new TypeError('O shell clínico deve ser código JavaScript.');
  if (!storageModuleUrl || !['blob:', 'https://', 'http://'].some(prefix => storageModuleUrl.startsWith(prefix))) throw new Error('Módulo criptográfico do atendimento ausente.');
  if (source.includes('const wizardEncryptedStore =')) return source;
  let output = source;
  for (const [before, after] of PATCHES) {
    const index = output.indexOf(before);
    if (index < 0 || output.indexOf(before, index + before.length) >= 0) {
      throw new Error('Âncora canônica do atendimento ausente ou duplicada: ' + before.slice(0, 96));
    }
    output = output.slice(0, index) + after + output.slice(index + before.length);
  }
  return "import { createEncryptedWizardDraftStore } from '" + storageModuleUrl + "';\n" + output;
}
