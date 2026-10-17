export const CANONICAL_SERVICE_WORKER_URL = '/sw.js';

export async function ensureCanonicalServiceWorker(
  serviceWorker = globalThis.navigator?.serviceWorker,
  logger = globalThis.console,
) {
  if (!serviceWorker?.register) return null;

  try {
    const registration = await serviceWorker.register(CANONICAL_SERVICE_WORKER_URL, {
      scope: '/',
      updateViaCache: 'none',
    });
    await registration.update?.();
    return registration;
  } catch (error) {
    logger?.warn?.('PWA service worker registration failed', error);
    return null;
  }
}
