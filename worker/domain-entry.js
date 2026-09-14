import coreWorker from './index.js';
import { handleSeoGoogleOverview, handleSeoPasswordLogin } from './seo-search-console.js';
import { ensureExplicitCommercialMarker } from './commercial-license-bootstrap.js';
import { resolvePublicHostRoute } from '../src/public-host-routing.js';

const PRIVATE_ROBOTS_PREFIXES = ['/api', '/app', '/admin', '/clinical-source'];
const COMMERCIAL_GATED_PATHS = new Set(['/api/license/me','/api/clinical/mothers','/api/clinical/media/upload']);

function rewriteAssetRequest(request, pathname) {
  const target = new URL(request.url);
  target.pathname = pathname;
  return new Request(target.toString(), request);
}

function isPrivateRobotsPath(pathname) {
  return PRIVATE_ROBOTS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function withNoIndex(response) {
  const headers = new Headers(response.headers);
  headers.set('x-robots-tag', 'noindex, nofollow');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/seo/login' && request.method === 'POST') {
      return withNoIndex(await handleSeoPasswordLogin(request, env));
    }
    if (url.pathname === '/api/seo/google/overview' && request.method === 'GET') {
      return withNoIndex(await handleSeoGoogleOverview(request, env));
    }

    if (url.pathname.startsWith('/api/')) {
      if (COMMERCIAL_GATED_PATHS.has(url.pathname)) await ensureExplicitCommercialMarker(request, env);
      return withNoIndex(await coreWorker.fetch(request, env, ctx));
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
      return env.ASSETS.fetch(rewriteAssetRequest(request, route.pathname));
    }

    const response = await coreWorker.fetch(request, env, ctx);
    return isPrivateRobotsPath(url.pathname) ? withNoIndex(response) : response;
  },
};
