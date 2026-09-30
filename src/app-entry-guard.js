import {
  MEMBER_PORTAL_FRONTEND_ENABLED,
  normalizeDisabledMemberPortalLocation,
} from './member-portal-policy.js';
import { ensureCanonicalServiceWorker } from './pwa-service-worker.js';

const HIDDEN_MEMBER_SELECTORS = [
  '[data-member-admin]',
  '[data-mother-link]',
  '#mf-admin-overlay',
  '#member-portal-root',
  '.mp-login',
];

function ensureHiddenMemberStyle() {
  if (MEMBER_PORTAL_FRONTEND_ENABLED || document.querySelector('[data-member-portal-disabled-style]')) return;
  const style = document.createElement('style');
  style.dataset.memberPortalDisabledStyle = '1';
  style.textContent = `${HIDDEN_MEMBER_SELECTORS.join(',')}{display:none!important}`;
  (document.head || document.documentElement)?.appendChild(style);
}

function removeDisabledMemberUi() {
  if (MEMBER_PORTAL_FRONTEND_ENABLED) return;
  normalizeDisabledMemberPortalLocation(window.location, window.history);
  for (const selector of HIDDEN_MEMBER_SELECTORS) {
    for (const node of document.querySelectorAll(selector)) node.remove();
  }
  document.body?.classList.remove('mf-portal-page');
  ensureHiddenMemberStyle();
}

if (!MEMBER_PORTAL_FRONTEND_ENABLED) {
  normalizeDisabledMemberPortalLocation(window.location, window.history);
  ensureHiddenMemberStyle();

  const observer = new MutationObserver(removeDisabledMemberUi);
  observer.observe(document, { childList: true, subtree: true });
  window.addEventListener('hashchange', removeDisabledMemberUi);
  queueMicrotask(removeDisabledMemberUi);
}

void ensureCanonicalServiceWorker();
