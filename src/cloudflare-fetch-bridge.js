const LEGACY_SUPABASE_ORIGIN = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const CLINICAL_PATH_PREFIXES = ['/auth/v1/', '/rest/v1/', '/storage/v1/'];
const SESSION_KEY = 'debora-lactacao-session';

function migrateStoredSession() {
  try {
    if (localStorage.getItem(SESSION_KEY)) return;
    const legacy = sessionStorage.getItem(SESSION_KEY);
    if (legacy) localStorage.setItem(SESSION_KEY, legacy);
  } catch {
    // Restricted browser contexts can disable storage. Login remains available.
  }
}

function rewriteLegacyUrl(raw) {
  if (!raw) return null;
  let url;
  try { url = new URL(String(raw), window.location.origin); } catch { return null; }
  if (url.origin !== LEGACY_SUPABASE_ORIGIN) return null;
  if (!CLINICAL_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
  return `${window.location.origin}${url.pathname}${url.search}${url.hash}`;
}

function installFetchBridge() {
  if (window.__deboraCloudflareFetchBridge) return;
  window.__deboraCloudflareFetchBridge = true;
  migrateStoredSession();

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      const raw = typeof input === 'string' || input instanceof URL
        ? String(input)
        : input instanceof Request
          ? input.url
          : '';
      const rewritten = rewriteLegacyUrl(raw);
      if (!rewritten) return nativeFetch(input, init);

      if (input instanceof Request) {
        return nativeFetch(new Request(rewritten, input), init);
      }
      return nativeFetch(rewritten, init);
    } catch {
      return nativeFetch(input, init);
    }
  };
}

installFetchBridge();

export { LEGACY_SUPABASE_ORIGIN, rewriteLegacyUrl };
