import { handleSeoGoogleOverview, handleSeoGoogleSites, handleSeoPasswordLogin } from './seo-search-console.js';
import { ensureExplicitCommercialMarker } from './commercial-license-bootstrap.js';
import { handleCloudflareBillingRuntime } from './cloudflare-billing-runtime.js';
import { handleCloudflareClinicalRuntime } from './cloudflare-clinical-runtime.js';
import { authenticateClinicalRequest, handleCloudflareAuthRuntime } from './cloudflare-auth-runtime.js';
import { handleCloudflareGrowthRuntime } from './cloudflare-growth-runtime.js';
import { handleCloudflareUpsertRuntime } from './cloudflare-upsert-runtime.js';
import { handlePackageLifecycleRuntime } from './package-lifecycle-runtime.js';
import { handleCloudflarePatientWrite } from './patient-write-runtime.js';
import { isCommercialLandingPath, withCommercialSeo } from './commercial-seo.js';
import { resolvePublicHostRoute } from '../src/public-host-routing.js';

const PRIVATE_ROBOTS_PREFIXES = ['/api', '/app', '/admin', '/clinical-source', '/auth', '/rest', '/storage'];
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

function requiresCloudflareIdentity(request, url) {
  const path = url.pathname;
  if (path.startsWith('/rest/v1/')) return true;
  if (path.startsWith('/api/clinical/')) return true;
  if (path.startsWith('/api/license/')) return true;
  if (path.startsWith('/api/admin/')) return true;
  if (D1_AUTH_REQUIRED_EXACT.has(path)) return true;
  if (path.startsWith('/storage/v1/')) {
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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

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
      return withNoIndex(new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }));
    }

    const cloudflareAuthResponse = await handleCloudflareAuthRuntime(request, env, url);
    if (cloudflareAuthResponse) return withNoIndex(cloudflareAuthResponse);

    // Once the D1 migration is complete, protected requests fail closed here. A missing
    // or invalid Cloudflare identity must never fall through to a legacy backend.
    if (requiresCloudflareIdentity(request, url)) {
      if (!env.CLINICAL_DB) return cloudflareIdentityRequired(503, 'cloudflare_d1_required');
      const user = await authenticateClinicalRequest(request, env);
      if (!user?.id) return cloudflareIdentityRequired(401, 'cloudflare_auth_required');
    }

    // Billing and partner attribution are Cloudflare D1-only. These routes are never
    // allowed to fall through to the legacy commercial worker.
    const cloudflareBillingResponse = await handleCloudflareBillingRuntime(request, env, url);
    if (cloudflareBillingResponse) return withNoIndex(cloudflareBillingResponse);
    if (D1_BILLING_PATHS.has(url.pathname)) return d1BillingRequired();

    if (env.CLINICAL_DB && url.pathname === '/api/license/me' && request.method === 'GET') {
      await ensureExplicitCommercialMarker(request, env);
    }

    const patientWriteResponse = await handleCloudflarePatientWrite(request, env, url);
    if (patientWriteResponse) return withNoIndex(patientWriteResponse);

    const packageLifecycleResponse = await handlePackageLifecycleRuntime(request, env, url);
    if (packageLifecycleResponse) return withNoIndex(packageLifecycleResponse);

    // High-value clinical writes are intercepted by explicit D1 runtimes before the
    // compatibility REST layer. This keeps them atomic and removes legacy fallbacks.
    const growthResponse = await handleCloudflareGrowthRuntime(request, env, url);
    if (growthResponse) return withNoIndex(growthResponse);

    const upsertResponse = await handleCloudflareUpsertRuntime(request, env, url);
    if (upsertResponse) return withNoIndex(upsertResponse);

    const cloudflareRuntimeResponse = await handleCloudflareClinicalRuntime(request, env);
    if (cloudflareRuntimeResponse) return withNoIndex(cloudflareRuntimeResponse);

    if (url.pathname.startsWith('/api/')) {
      return withNoIndex(new Response(JSON.stringify({ error: 'api_not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      }));
    }

    const route = resolvePublicHostRoute(url);
    if (route.type === 'redirect') {
      return new Response(null, {
        status: route.status,
        headers: {
          location: route.location,
          'cache-control': 'public, max-age=300',
        },
      });
    }

    if (route.type === 'rewrite') {
      const response = await env.ASSETS.fetch(rewriteAssetRequest(request, route.pathname));
      return isCommercialLandingPath(url.pathname) ? withCommercialSeo(response) : response;
    }

    const response = await env.ASSETS.fetch(request);
    if (isPrivateRobotsPath(url.pathname)) return withNoIndex(response);
    return isCommercialLandingPath(url.pathname) ? withCommercialSeo(response) : response;
  },
};
