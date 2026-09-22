window.SAAS_RUNTIME_CONFIG = Object.freeze({
  apiBaseUrl: window.location.origin,
  // Compatibility aliases while the commercial frontend is migrated away from legacy naming.
  supabaseUrl: window.location.origin,
  supabasePublishableKey: 'cloudflare-runtime',
  appMode: 'commercial',
  backend: 'cloudflare-d1',
});
