export const PUBLIC_APEX_HOST = 'deboralactacao.com';
export const PUBLIC_WWW_HOST = `www.${PUBLIC_APEX_HOST}`;
export const PUBLIC_APP_HOST = `app.${PUBLIC_APEX_HOST}`;
export const PUBLIC_COMMERCIAL_HOST = `comercial.${PUBLIC_APEX_HOST}`;

function prefixedPath(prefix, pathname) {
  const normalized = pathname || '/';
  if (normalized === prefix || normalized.startsWith(`${prefix}/`)) return normalized;
  if (normalized === '/') return `${prefix}/`;
  return `${prefix}${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
}

function redirect(location) {
  return Object.freeze({ type: 'redirect', location, status: 308 });
}

export function resolvePublicHostRoute(urlLike) {
  const url = urlLike instanceof URL ? urlLike : new URL(String(urlLike));
  const hostname = url.hostname.toLowerCase();
  const query = url.search;

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
