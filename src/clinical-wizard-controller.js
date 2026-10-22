import { createEncryptedWizardDraftStore } from './encrypted-wizard-drafts.js';

// Runtime coordinator for the canonical seven-step clinical encounter wizard.
// Do not store plaintext clinical data in localStorage, HTML attributes or logs.
export function createWizardRecoveryController({
  root,
  owner,
  mother,
  identity,
  collect,
  apply,
  step,
  setStep,
  store = createEncryptedWizardDraftStore(),
  notify = () => {},
} = {}) {
  let revision = 0;
  let currentKey = null;
  let lastSnapshot = null;
  let locked = false;
  let banner = null;
  let disabledControls = [];
  let closed = false;

  function key() {
    const userId = owner();
    const motherId = mother();
    if (!userId || !motherId) return null;
    return store.scope(userId, motherId, identity());
  }

  function draft() {
    const ids = identity();
    return {
      schema: 1,
      motherId: String(mother()),
      encounterId: ids.encounterId || null,
      appointmentId: ids.appointmentId || null,
      babyTarget: root.querySelector('[data-appointment-baby]')?.value || null,
      wizardStep: Math.max(1, Math.min(7, Number(step()) || 1)),
      state: collect(),
      revision: ++revision,
    };
  }

  async function capture() {
    if (locked || closed) return null;
    const nextKey = key();
    if (!nextKey) return null;
    const previousKey = currentKey;
    const previous = lastSnapshot;
    const snapshot = draft();
    currentKey = nextKey;
    lastSnapshot = snapshot;
    try {
      await store.write(nextKey, snapshot);
      if (previousKey && previousKey !== nextKey && previous) {
        await store.clear(previousKey, previous);
      }
      return { key: nextKey, payload: snapshot };
    } catch (error) {
      notify('A cópia local criptografada não pôde ser salva. Não feche esta tela.', 'error');
      return null;
    }
  }

  function unlock() {
    locked = false;
    for (const [control, disabled] of disabledControls) {
      if (control.isConnected) control.disabled = disabled;
    }
    disabledControls = [];
    banner?.remove();
    banner = null;
  }

  function reset() {
    unlock();
    currentKey = null;
    lastSnapshot = null;
    revision = 0;
    closed = false;
  }

  function block() {
    locked = true;
    disabledControls = [...root.querySelectorAll(
      '[data-encounter-field], [data-encounter-choice], [data-wizard-next], [data-wizard-prev], [data-action="save-draft"]',
    )].map((el) => [el, el.disabled]);
    for (const [control] of disabledControls) control.disabled = true;
  }

  async function inspect() {
    unlock();
    if (closed) return false;
    const nextKey = key();
    if (!nextKey) return false;
    let saved;
    try {
      saved = await store.read(nextKey);
    } catch (error) {
      notify('Não foi possível verificar a recuperação local deste atendimento.', 'error');
      return false;
    }
    if (!saved) return false;
    if (saved.schema !== 1 || saved.motherId !== String(mother())) {
      notify('Rascunho local incompatível; o atendimento do banco foi preservado.', 'error');
      return false;
    }
    if (nextKey !== key()) return false; // Patient or encounter changed during the async read.

    block();
    banner = document.createElement('div');
    banner.dataset.wizardRecovery = 'pending';
    banner.setAttribute('role', 'alert');
    banner.style.cssText = 'margin:12px 0;padding:14px;border:1px solid #baa2b8;border-radius:12px;background:#fff8f6;color:#3a2540';
    const heading = document.createElement('strong');
    heading.textContent = 'Encontramos um atendimento não sincronizado neste dispositivo.';
    const explanation = document.createElement('p');
    explanation.textContent = 'Escolha recuperar as informações das sete etapas ou manter os dados já registrados no banco. Nada será substituído automaticamente.';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.dataset.wizardRestore = '';
    restore.textContent = 'Recuperar atendimento';
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.dataset.wizardDiscard = '';
    discard.textContent = 'Manter dados do banco';
    discard.style.marginLeft = '10px';
    restore.onclick = () => {
      if (!locked || nextKey !== key()) return;
      try {
        apply(saved);
        setStep(saved.wizardStep);
        unlock();
        currentKey = nextKey;
        lastSnapshot = null; // Don't conditionally erase a restored, not-yet-synced snapshot.
        void capture(); // Persist the explicitly restored revision.
        notify('Atendimento restaurado neste dispositivo. Confira e salve no banco.', 'success');
      } catch (error) {
        notify('Não foi possível aplicar o rascunho local.', 'error');
      }
    };
    discard.onclick = async () => {
      if (!locked || nextKey !== key()) return;
      try {
        await store.clear(nextKey, saved);
        unlock();
        currentKey = null;
        lastSnapshot = null;
        notify('Dados atuais do banco mantidos.', 'success');
      } catch (error) {
        notify('Falha ao descartar o rascunho local. Tente novamente.', 'error');
      }
    };
    banner.append(heading, explanation, restore, discard);
    root.prepend(banner);
    return true;
  }

  async function identityChanged() {
    if (closed || locked || !lastSnapshot) return null;
    return capture(); // Rekey the initial unsaved/appointment draft after encounter creation.
  }

  async function confirmSaved(snapshot) {
    if (!snapshot) return false;
    try {
      return await store.clear(snapshot.key, snapshot.payload);
    } catch (error) {
      notify('Atendimento salvo no banco, mas não foi possível limpar a cópia local.', 'error');
      return false;
    }
  }

  return { capture, inspect, identityChanged, confirmSaved, reset };
}
