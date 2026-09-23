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
  if (BILLING_COMPAT.has(pathname)) return BILLING_COMPAT.get(pathname);
  return pathname;
}

/**
 * Billing keeps a same-process compatibility map while its Asaas-specific
 * implementation names are internal. Auth, clinical data and files are native.
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
