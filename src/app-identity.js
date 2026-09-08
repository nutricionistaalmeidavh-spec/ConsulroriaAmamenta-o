export const CANONICAL_PRODUCT_NAME = 'Gestão de Amamentação';
export const CANONICAL_PRODUCT_SHORT_NAME = 'Amamentação';

export function resolveAppIdentity(locationLike = globalThis.location || { pathname: '/' }) {
  const path = String(locationLike?.pathname || '/');
  const appEntry = path === '/app' || path.startsWith('/app/');
  return Object.freeze({
    productName: CANONICAL_PRODUCT_NAME,
    productShortName: CANONICAL_PRODUCT_SHORT_NAME,
    entryMode: appEntry ? 'app' : 'compat',
    basePath: appEntry ? '/app/' : '/',
  });
}
