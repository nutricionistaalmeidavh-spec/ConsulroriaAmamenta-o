const COMMERCIAL_SESSION_KEY = 'commercial.saas.session.v1';
const LEGACY_CLINICAL_SESSION_KEY = 'debora-lactacao-session';
const CANONICAL_SESSION_KEY = 'amamentacao-session';
const CANONICAL_APP_URL = '/app/';

let navigating = false;

function readCommercialSession() {
  const raw = sessionStorage.getItem(COMMERCIAL_SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    return session?.access_token ? { raw, session } : null;
  } catch {
    return null;
  }
}

function transferSession() {
  const current = readCommercialSession();
  if (!current) return false;
  sessionStorage.setItem(LEGACY_CLINICAL_SESSION_KEY, current.raw);
  sessionStorage.setItem(CANONICAL_SESSION_KEY, current.raw);
  return true;
}

function completeViewReady() {
  const complete = document.querySelector('.auth-view[data-view="complete"]');
  return Boolean(complete && !complete.hidden);
}

function enterCanonicalApp() {
  if (navigating || !completeViewReady() || !transferSession()) return;
  navigating = true;
  window.setTimeout(() => window.location.assign(CANONICAL_APP_URL), 350);
}

const modal = document.querySelector('#auth-modal');
if (modal) {
  const observer = new MutationObserver(enterCanonicalApp);
  observer.observe(modal, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
}

enterCanonicalApp();
