const AUTH_COMPAT = new Map([
  ['/api/auth/token', '/auth/v1/token'],
  ['/api/auth/signup', '/auth/v1/signup'],
  ['/api/auth/user', '/auth/v1/user'],
  ['/api/auth/logout', '/auth/v1/logout'],
]);

const BILLING_COMPAT = new Map([
  ['/api/billing/signup', '/api/asaas/signup'],
  ['/api/billing/pending-status', '/api/asaas/pending-status'],
  ['/api/billing/health', '/api/asaas/health'],
  ['/api/billing/preauth-checkout', '/api/asaas/preauth-checkout'],
  ['/api/billing/checkout', '/api/asaas/checkout'],
  ['/api/billing/webhooks/asaas', '/api/webhooks/asaas'],
  ['/api/billing/sandbox/health', '/api/sandbox/asaas/health'],
  ['/api/billing/sandbox/checkout', '/api/sandbox/asaas/checkout'],
  ['/api/billing/sandbox/webhooks/asaas', '/api/sandbox/webhooks/asaas'],
]);

function internalPath(pathname) {
  if (AUTH_COMPAT.has(pathname)) return AUTH_COMPAT.get(pathname);
  if (BILLING_COMPAT.has(pathname)) return BILLING_COMPAT.get(pathname);
  if (pathname.startsWith('/api/clinical/rpc/')) {
    return `/rest/v1/rpc/${pathname.slice('/api/clinical/rpc/'.length)}`;
  }
  if (pathname.startsWith('/api/clinical/records/')) {
    return `/rest/v1/${pathname.slice('/api/clinical/records/'.length)}`;
  }
  if (pathname.startsWith('/api/files/')) {
    return `/storage/v1/${pathname.slice('/api/files/'.length)}`;
  }
  return pathname;
}

/**
 * Translate the public Block 8 API contract to the quarantined compatibility
 * handlers that still own the D1/R2 implementation. The translation is
 * same-process only: callers never see or follow the historical route shapes.
 */
export function normalizeOwnedApiRequest(request, url = new URL(request.url)) {
  const pathname = internalPath(url.pathname);
  if (pathname === url.pathname) return { request, url, normalized: false };
  const target = new URL(url.toString());
  target.pathname = pathname;
  return {
    request: new Request(target.toString(), request),
    url: target,
    normalized: true,
  };
}

export function ownedApiInternalPath(pathname) {
  return internalPath(String(pathname || ''));
}
