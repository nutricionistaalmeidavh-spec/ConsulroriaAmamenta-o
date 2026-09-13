import coreWorker from './index.js';
import { handleSeoGoogleOverview } from './seo-search-console.js';
import { resolvePublicHostRoute } from '../src/public-host-routing.js';

function rewriteAssetRequest(request, pathname) {
  const target = new URL(request.url);
  target.pathname = pathname;
  return new Request(target.toString(), request);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // SEO uses a dedicated ArtiSys administrative token and is independent from
    // product/member authentication. Keep it isolated from checkout/webhook APIs.
    if (url.pathname === '/api/seo/google/overview' && request.method === 'GET') {
      return handleSeoGoogleOverview(request, env);
    }

    // API behavior is identical on every bound hostname. Keep it on the core worker
    // so custom-domain routing never changes checkout, webhook or health semantics.
    if (url.pathname.startsWith('/api/')) {
      return coreWorker.fetch(request, env, ctx);
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

    return coreWorker.fetch(request, env, ctx);
  },
};
