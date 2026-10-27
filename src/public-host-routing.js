export const PUBLIC_APEX_HOST = 'deboralactacao.com';
export const PUBLIC_WWW_HOST = `www.${PUBLIC_APEX_HOST}`;
export const PUBLIC_APP_HOST = `app.${PUBLIC_APEX_HOST}`;
export const PUBLIC_COMMERCIAL_HOST = `comercial.${PUBLIC_APEX_HOST}`;
export const TECHNICAL_WORKER_HOST = 'consulroriaamamenta-o.nutricionistaalmeidavh.workers.dev';

function prefixedPath(prefix, pathname) {
  const normalized = pathname || '/';
  if (normalized === prefix || normalized.startsWith(`${prefix}/`)) return normalized;
  if (normalized === '/') return `${prefix}/`;
  return `${prefix}${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
}

function redirect(location, status = 308) {
  return Object.freeze({ type: 'redirect', location, status });
}

export function resolvePublicHostRoute(urlLike, { navigation = false } = {}) {
  const url = urlLike instanceof URL ? urlLike : new URL(String(urlLike));
  const hostname = url.hostname.toLowerCase();
  const query = url.search;

  // Keep the technical hostname available for API, webhook, service-worker and
  // other non-navigation consumers. Only canonicalize browser HTML documents:
  // opening a PDF Blob from a workers.dev page otherwise exposes that host
  // in the iOS document viewer and can unexpectedly change browsing context.
  if (hostname === TECHNICAL_WORKER_HOST && navigation) {
    const technicalOnly = /^\/(?:api(?:\/|$)|\.well-known(?:\/|$)|healthz$|readyz$|sw\.js$|service-worker\.js$)/;
    if (technicalOnly.test(url.pathname)) return Object.freeze({ type: 'passthrough' });

    let pathname = url.pathname;
    if (pathname === '/' || pathname === '/index.html'
      || pathname === '/app' || pathname === '/app/index.html') pathname = '/app/';
    if (pathname === '/debora' || pathname === '/debora/' || pathname === '/debora/index.html') pathname = '/';
    // Temporary, non-cacheable redirect so workers.dev remains a safe fallback.
    return redirect(`https://${PUBLIC_APEX_HOST}${pathname}${query}`, 307);
  }

  if (hostname === PUBLIC_WWW_HOST) {
    const pathname = url.pathname === '/debora' || url.pathname === '/debora/' ? '/' : url.pathname;
    return redirect(`https://${PUBLIC_APEX_HOST}${pathname}${query}`);
  }

  if (hostname === PUBLIC_APP_HOST) {
    return redirect(`https://${PUBLIC_APEX_HOST}${prefixedPath('/app', url.pathname)}${query}`);
  }

  if (hostname === PUBLIC_COMMERCIAL_HOST) {
    return redirect(`https://${PUBLIC_APEX_HOST}${prefixedPath('/comercial', url.pathname)}${query}`);
  }

  if (hostname !== PUBLIC_APEX_HOST) return Object.freeze({ type: 'passthrough' });

  if (url.pathname === '/') {
    // Use the directory URL expected by Workers Static Assets. Requesting the
    // explicit index file is canonicalized to /debora/, leaking a 307 to the
    // browser and creating a loop with the public /debora/ -> / redirect below.
    return Object.freeze({ type: 'rewrite', pathname: '/debora/' });
  }

  if (url.pathname === '/debora' || url.pathname === '/debora/') {
    return redirect(`https://${PUBLIC_APEX_HOST}/${query}`);
  }

  return Object.freeze({ type: 'passthrough' });
}
