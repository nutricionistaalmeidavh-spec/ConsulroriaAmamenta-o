import { handleSeoGoogleOverview, handleSeoGoogleSites, handleSeoPasswordLogin } from './seo-search-console.js';
import { ensureExplicitCommercialMarker } from './commercial-license-bootstrap.js';
import { handleCloudflareBillingRuntime } from './cloudflare-billing-runtime.js';
import { handleCloudflareClinicalRuntime } from './cloudflare-clinical-runtime.js';
import { authenticateClinicalRequest, handleCloudflareAuthRuntime } from './cloudflare-auth-runtime.js';
import { handleAtomicAuthRefresh } from './auth-refresh-atomic-runtime.js';
import { handleClinicalBackupRuntime } from './clinical-backup-runtime.js';
import { handleCloudflareGrowthRuntime } from './cloudflare-growth-runtime.js';
import { handleCloudflareUpsertRuntime } from './cloudflare-upsert-runtime.js';
import { handleGenericCrudPolicy } from './generic-crud-policy-runtime.js';
import { handleAtomicPackageSessionRuntime } from './package-session-atomic-runtime.js';
import { handleBlock6RpcRuntime } from './block6-rpc-runtime.js';
import { handleCloudflarePatientWrite } from './patient-write-runtime.js';
import { handleRelationalIntegrityGuard } from './relational-integrity-runtime.js';
import { handleUsageObservabilityRuntime } from './usage-observability-runtime.js';
import { normalizeOwnedApiRequest } from './owned-api-paths.js';
import { isCommercialLandingPath, withCommercialSeo } from './commercial-seo.js';
import { resolvePublicHostRoute } from '../src/public-host-routing.js';

const PRIVATE_ROBOTS_PREFIXES = ['/api', '/app', '/admin', '/clinical-source'];
const DYNAMIC_DOCUMENT_CACHE_CONTROL = 'no-store, no-cache, must-revalidate';
const REVALIDATE_ASSET_CACHE_CONTROL = 'no-cache, must-revalidate';
const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const LEGACY_SERVICE_WORKER_RETIREMENT_SCRIPT = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('debora-lactacao-v'))
      .map((key) => caches.delete(key)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => undefined)));
  })());
});
`;
const D1_BILLING_PATHS = new Set([
  '/api/asaas/signup',
  '/api/asaas/pending-status',
  '/api/asaas/health',
  '/api/asaas/preauth-checkout',
  '/api/asaas/checkout',
  '/api/webhooks/asaas',
  '/api/sandbox/asaas/health',
  '/api/sandbox/asaas/checkout',
  '/api/sandbox/webhooks/asaas',
  '/api/admin/partners',
  '/api/admin/partner-sales',
  '/api/admin/partner-commission',
]);
const D1_AUTH_REQUIRED_EXACT = new Set([
  '/api/asaas/checkout',
  '/api/sandbox/asaas/checkout',
]);

function rewriteAssetRequest(request, pathname) {
  const target = new URL(request.url);
  target.pathname = pathname;
  return new Request(target.toString(), request);
}

function isPrivateRobotsPath(pathname) {
  return PRIVATE_ROBOTS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isImmutableVersionedAsset(url) {
  if (/^\/who\/v\d{4}-\d{2}-\d{2}\//.test(url.pathname)) return true;
  return (url.pathname === '/icon-192.png' || url.pathname === '/icon-512.png') && url.searchParams.has('v');
}

function legacyServiceWorkerRetirementResponse() {
  return new Response(LEGACY_SERVICE_WORKER_RETIREMENT_SCRIPT, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': DYNAMIC_DOCUMENT_CACHE_CONTROL,
      'pragma': 'no-cache',
      'expires': '0',
      'service-worker-allowed': '/',
    },
  });
}

function withAssetCachePolicy(request, url, response) {
  const headers = new Headers(response.headers);
  const contentType = headers.get('content-type') || '';
  const isDocument = request.mode === 'navigate'
    || contentType.includes('text/html')
    || url.pathname.endsWith('.html');
  const isCriticalBootstrap = url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest';

  if (isDocument || isCriticalBootstrap) {
    headers.set('cache-control', DYNAMIC_DOCUMENT_CACHE_CONTROL);
    headers.set('pragma', 'no-cache');
    headers.set('expires', '0');
  } else if (isImmutableVersionedAsset(url)) {
    headers.set('cache-control', IMMUTABLE_ASSET_CACHE_CONTROL);
  } else {
    headers.set('cache-control', REVALIDATE_ASSET_CACHE_CONTROL);
  }

  if (url.pathname === '/sw.js') headers.set('service-worker-allowed', '/');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function requiresCloudflareIdentity(request, url) {
  const path = url.pathname;
  if (path.startsWith('/api/clinical/')) return true;
  if (path.startsWith('/api/license/')) return true;
  if (path.startsWith('/api/admin/')) return true;
  if (D1_AUTH_REQUIRED_EXACT.has(path)) return true;
  if (path.startsWith('/api/files/')) {
    return !(request.method === 'GET' && url.searchParams.has('token'));
  }
  return false;
}

function d1BillingRequired() {
  return withNoIndex(new Response(JSON.stringify({ error: 'cloudflare_d1_billing_required' }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  }));
}

function cloudflareIdentityRequired(status, error) {
  return withNoIndex(new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  }));
}

function apiNotFound() {
  return withNoIndex(new Response(JSON.stringify({ error: 'api_not_found' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  }));
}

export function withNoIndex(response) {
  try {
    response.headers.set('x-robots-tag', 'noindex, nofollow');
    return response;
  } catch {
    const copy = response.clone();
    const headers = new Headers(copy.headers);
    headers.set('x-robots-tag', 'noindex, nofollow');
    return new Response(copy.body, {
      status: copy.status,
      statusText: copy.statusText,
      headers,
    });
  }
}

export default {
  async fetch(request, env) {
    const incomingUrl = new URL(request.url);
    const publicApiRequest = incomingUrl.pathname.startsWith('/api/');
    const ownedFilesRequest = incomingUrl.pathname.startsWith('/api/files/');

    if (incomingUrl.pathname === '/service-worker.js') {
      return legacyServiceWorkerRetirementResponse();
    }

    const normalized = normalizeOwnedApiRequest(request, incomingUrl);
    request = normalized.request;
    const url = normalized.url;

    if (ownedFilesRequest && !env.CLINICAL_DB) {
      return cloudflareIdentityRequired(503, 'cloudflare_d1_required');
    }

    if (url.pathname === '/api/seo/login' && request.method === 'POST') {
      return withNoIndex(await handleSeoPasswordLogin(request, env));
    }
    if (url.pathname === '/api/seo/google/sites' && request.method === 'GET') {
      return withNoIndex(await handleSeoGoogleSites(request, env));
    }
    if (url.pathname === '/api/seo/google/overview' && request.method === 'GET') {
      return withNoIndex(await handleSeoGoogleOverview(request, env));
    }
    if (url.pathname === '/api/license/register-commercial') {
      return withNoIndex(new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      }));
    }

    const atomicAuthRefreshResponse = await handleAtomicAuthRefresh(request, env, url);
    if (atomicAuthRefreshResponse) return withNoIndex(atomicAuthRefreshResponse);

    const usageObservabilityResponse = await handleUsageObservabilityRuntime(request, env, url);
    if (usageObservabilityResponse) return withNoIndex(usageObservabilityResponse);

    const cloudflareAuthResponse = await handleCloudflareAuthRuntime(request, env, url);
    if (cloudflareAuthResponse) return withNoIndex(cloudflareAuthResponse);

    if (requiresCloudflareIdentity(request, url)) {
      if (!env.CLINICAL_DB) return cloudflareIdentityRequired(503, 'cloudflare_d1_required');
      const user = await authenticateClinicalRequest(request, env);
      if (!user?.id) return cloudflareIdentityRequired(401, 'cloudflare_auth_required');
    }

    const clinicalBackupResponse = await handleClinicalBackupRuntime(request, env, url);
    if (clinicalBackupResponse) return withNoIndex(clinicalBackupResponse);

    const cloudflareBillingResponse = await handleCloudflareBillingRuntime(request, env, url);
    if (cloudflareBillingResponse) return withNoIndex(cloudflareBillingResponse);
    if (D1_BILLING_PATHS.has(url.pathname)) return d1BillingRequired();

    if (env.CLINICAL_DB && url.pathname === '/api/license/me' && request.method === 'GET') {
      await ensureExplicitCommercialMarker(request, env);
    }

    const relationalIntegrityResponse = await handleRelationalIntegrityGuard(request, env, url);
    if (relationalIntegrityResponse) return withNoIndex(relationalIntegrityResponse);

    const patientWriteResponse = await handleCloudflarePatientWrite(request, env, url);
    if (patientWriteResponse) return withNoIndex(patientWriteResponse);

    const atomicPackageSessionResponse = await handleAtomicPackageSessionRuntime(request, env, url);
    if (atomicPackageSessionResponse) return withNoIndex(atomicPackageSessionResponse);

    const block6Response = await handleBlock6RpcRuntime(request, env, url);
    if (block6Response) return withNoIndex(block6Response);

    const growthResponse = await handleCloudflareGrowthRuntime(request, env, url);
    if (growthResponse) return withNoIndex(growthResponse);

    if (request.method === 'POST') {
      const genericPostPolicyResponse = handleGenericCrudPolicy(request, url);
      if (genericPostPolicyResponse) return withNoIndex(genericPostPolicyResponse);
    }

    const upsertResponse = await handleCloudflareUpsertRuntime(request, env, url);
    if (upsertResponse) return withNoIndex(upsertResponse);

    const cloudflareRuntimeResponse = await handleCloudflareClinicalRuntime(request, env);
    if (cloudflareRuntimeResponse) return withNoIndex(cloudflareRuntimeResponse);

    if (publicApiRequest || url.pathname.startsWith('/api/')) return apiNotFound();

    const route = resolvePublicHostRoute(url);
    if (route.type === 'redirect') {
      return new Response(null, {
        status: route.status,
        headers: {
          location: route.location,
          'cache-control': 'no-store, no-cache, must-revalidate',
          'pragma': 'no-cache',
          'expires': '0',
        },
      });
    }

    if (route.type === 'rewrite') {
      const assetResponse = await env.ASSETS.fetch(rewriteAssetRequest(request, route.pathname));
      const response = withAssetCachePolicy(request, url, assetResponse);
      return isCommercialLandingPath(url.pathname) ? withCommercialSeo(response) : response;
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const response = withAssetCachePolicy(request, url, assetResponse);
    if (isPrivateRobotsPath(url.pathname)) return withNoIndex(response);
    return isCommercialLandingPath(url.pathname) ? withCommercialSeo(response) : response;
  },
};
