import {
  authenticateClinicalRequest,
  runtimeUserById,
} from './cloudflare-auth-runtime.js';
import { handleAtomicAppointmentEncounterStart } from './appointment-encounter-atomic-runtime.js';
import { handleCloudflareGrowthRuntime } from './cloudflare-growth-runtime.js';
import { handleCloudflareRelationGuard } from './cloudflare-relation-guard.js';
import { handleCloudflareUpsertRuntime } from './cloudflare-upsert-runtime.js';
import { handleConsistentStorageMutation } from './storage-consistency-runtime.js';
import {
  handleCloudflareDataRuntime,
  hasOwnedRecord,
  runtimeJson,
} from './cloudflare-data-runtime.js';
import { GIT_SHA } from './deploy-version.js';

function requiresCloudflareIdentity(request, url) {
  if (url.pathname.startsWith('/api/clinical/')) return true;
  if (url.pathname.startsWith('/api/files/')) {
    return !(request.method === 'GET' && url.searchParams.has('token'));
  }
  return false;
}

async function withDeploymentGitSha(response) {
  if (!response) return response;
  try {
    const payload = await response.json();
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('cache-control', 'no-store');
    return new Response(JSON.stringify({ ...payload, gitSha: String(GIT_SHA || '') }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

export async function handleCloudflareClinicalRuntime(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/license/register-commercial') {
    return runtimeJson(404, { error: 'not_found' });
  }

  // Public probes need only availability and the release identifier. Do not expose
  // user/record counts, migration state or backend configuration details.
  if (url.pathname === '/api/cloudflare/health' && request.method === 'GET') {
    return withDeploymentGitSha(runtimeJson(200, {
      ok: Boolean(env.CLINICAL_DB && env.CLINICAL_FILES && env.CLINICAL_AUTH_SECRET),
    }));
  }

  const storageResponse = await handleConsistentStorageMutation(request, env, url);
  if (storageResponse) return storageResponse;

  const growthResponse = await handleCloudflareGrowthRuntime(request, env, url);
  if (growthResponse) return growthResponse;

  const relationGuardResponse = await handleCloudflareRelationGuard(request, env, url);
  if (relationGuardResponse) return relationGuardResponse;

  const upsertResponse = await handleCloudflareUpsertRuntime(request, env, url);
  if (upsertResponse) return upsertResponse;

  if (requiresCloudflareIdentity(request, url)) {
    if (!env.CLINICAL_DB) return runtimeJson(503, { error: 'cloudflare_d1_required' });
    const user = await authenticateClinicalRequest(request, env);
    if (!user?.id) return runtimeJson(401, { error: 'cloudflare_auth_required' });
  }

  const atomicStartResponse = await handleAtomicAppointmentEncounterStart(request, env, url);
  if (atomicStartResponse) return atomicStartResponse;

  return handleCloudflareDataRuntime(request, env, url);
}

export {
  authenticateClinicalRequest,
  hasOwnedRecord,
  runtimeJson,
  runtimeUserById,
};
