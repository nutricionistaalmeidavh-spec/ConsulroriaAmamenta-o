// The clinical-note editor is the canonical persisted note; only its position
// changes in prenatal care. Keep the postpartum transitions unchanged.
export function enhanceClinicalNoteWithPrenatalFinalStep(source) {
  if (typeof source !== 'string') throw new TypeError('Clinical note source must be text');
  if (source.includes('function cnIsPrenatalLastStep(')) return source;

  function replaceExactlyOnce(before, after, label) {
    const pieces = source.split(before);
    if (pieces.length !== 2) throw new Error(`Prenatal note anchor ${label}: expected 1, got ${pieces.length - 1}`);
    source = pieces.join(after);
  }

  replaceExactlyOnce(
    'async function cnCapture(e){',
    `function cnIsPrenatalWizardMode(){return document.querySelector('[data-screen="appointment"]')?.dataset.prenatalMode==='true'}
function cnIsPrenatalLastStep(step,btn){return cnIsPrenatalWizardMode()&&step?.dataset.wizardStep==='7'&&Boolean(btn?.matches?.('[data-wizard-next]'))}
async function cnCapture(e){`,
    'wizard-final-hook'
  );
  replaceExactlyOnce(
    'if(cnIsChief(step)&&cnForwardButton(btn)){',
    'if(cnIsPrenatalLastStep(step,btn)||(!cnIsPrenatalWizardMode()&&cnIsChief(step)&&cnForwardButton(btn))){',
    'prenatal-final-enter-and-postpartum-forward'
  );
  replaceExactlyOnce(
    'if(cnIsMaternal(step)&&cnBackButton(btn)){',
    'if(!cnIsPrenatalWizardMode()&&cnIsMaternal(step)&&cnBackButton(btn)){',
    'postpartum-backward-only'
  );
  replaceExactlyOnce(
    "${direction==='forward'?'Continuar':direction==='backward'?'Voltar à queixa':'Fechar'}",
    "${direction==='forward'?(cnIsPrenatalWizardMode()?'Salvar prontuário e concluir':'Continuar'):direction==='backward'?'Voltar à queixa':'Fechar'}",
    'prenatal-final-action-label'
  );
  return source;
}
