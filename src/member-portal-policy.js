export const MEMBER_PORTAL_FRONTEND_ENABLED = false;

const MEMBER_PORTAL_HASH = '#mae';

export function isMemberPortalHash(hash = '') {
  return String(hash || '').toLowerCase().startsWith(MEMBER_PORTAL_HASH);
}

export function shouldOpenMemberPortal(hash = '') {
  return MEMBER_PORTAL_FRONTEND_ENABLED && isMemberPortalHash(hash);
}

export function normalizeDisabledMemberPortalLocation(locationLike = globalThis.location, historyLike = globalThis.history) {
  if (MEMBER_PORTAL_FRONTEND_ENABLED || !isMemberPortalHash(locationLike?.hash)) return false;

  const pathname = String(locationLike?.pathname || '/');
  const search = String(locationLike?.search || '');
  historyLike?.replaceState?.(historyLike?.state ?? null, '', `${pathname}${search}`);
  return true;
}
