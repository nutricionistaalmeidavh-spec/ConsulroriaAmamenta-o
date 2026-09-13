export const CANONICAL_PRODUCT_NAME = 'Gestão de Amamentação';
export const CANONICAL_PRODUCT_SHORT_NAME = 'Amamentação';
export const CANONICAL_APP_HOST = 'app.deboralactacao.com';

export function resolveAppIdentity(locationLike = globalThis.location || { pathname: '/' }) {
  const path = String(locationLike?.pathname || '/');
  const hostname = String(locationLike?.hostname || '').toLowerCase();
  const appHost = hostname === CANONICAL_APP_HOST;
  const appEntry = appHost || path === '/app' || path.startsWith('/app/');
  return Object.freeze({
    productName: CANONICAL_PRODUCT_NAME,
    productShortName: CANONICAL_PRODUCT_SHORT_NAME,
    entryMode: appEntry ? 'app' : 'compat',
    basePath: appHost ? '/' : (appEntry ? '/app/' : '/'),
  });
}
