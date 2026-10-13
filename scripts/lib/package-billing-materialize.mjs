// Source-controlled post-materialization overlay. Keep payment safety guards
// after the archive and weight patches so npm run build cannot revert them.
const APP_SHELL='core/app-shell.js';
function once(input,search,replacement,label){
  const matches=input.split(search).length-1;
  if(matches!==1)throw new Error(`package billing materialization: ${label} expected once, got ${matches}`);
  return input.replace(search,replacement);
}

export function transformPackageBillingSafety(source){
  let text=String(source);
  if(text.includes('let wizardActionBusy = false;'))return text;
  text=once(text,
    'let encounterAutosaveBusy = false;',
    'let encounterAutosaveBusy = false;\nlet encounterStartPromise = null;\nlet wizardActionBusy = false;',
    'concurrency state');
  text=once(text,
    'async function ensureEncounterStarted() {',
    'async function createOrResumeEncounter() {',
    'single-flight rename');
  text=once(text,
    'function scheduleEncounterAutosave() {',
    `async function ensureEncounterStarted() {
  if (currentDraftEncounterId && currentAppointmentId) return { encounter_id: currentDraftEncounterId, appointment_id: currentAppointmentId };
  if (encounterStartPromise) return encounterStartPromise;
  const pending = createOrResumeEncounter();
  encounterStartPromise = pending;
  try { return await pending; }
  finally { if (encounterStartPromise === pending) encounterStartPromise = null; }
}
function scheduleEncounterAutosave() {`,
    'single-flight wrapper');
  text=once(text,
    `    if (event.target.closest('[data-wizard-next]')) {
      try {
        if (wizardStep < 7) {
          if (wizardStep === 1) await ensureEncounterStarted();
          else if (currentDraftEncounterId) await saveDraft({ silent: true });
          wizardStep += 1; renderWizard();
        } else await finalizeEncounter();
      } catch (error) { reportError(error); }
    }`,
    `    if (event.target.closest('[data-wizard-next]')) {
      if (wizardActionBusy) return;
      const nextButton = event.target.closest('[data-wizard-next]');
      wizardActionBusy = true;
      nextButton.disabled = true;
      try {
        if (wizardStep < 7) {
          if (wizardStep === 1) await ensureEncounterStarted();
          else if (currentDraftEncounterId) await saveDraft({ silent: true });
          wizardStep += 1; renderWizard();
        } else await finalizeEncounter();
      } catch (error) { reportError(error); }
      finally {
        wizardActionBusy = false;
        if (nextButton.isConnected) nextButton.disabled = false;
      }
    }`,
    'button lock');
  return text;
}

export function applyPackageBillingSafety(resolved,sourceByPath){
  const previous=resolved.get(APP_SHELL);
  if(!previous)throw new Error('package billing materialization: app shell unavailable');
  const source=Buffer.from(previous).toString('utf8');
  const next=transformPackageBillingSafety(source);
  resolved.set(APP_SHELL,new Uint8Array(Buffer.from(next,'utf8')));
  sourceByPath.set(APP_SHELL,`${sourceByPath.get(APP_SHELL)}+package-billing-safety`);
}
