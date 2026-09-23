import {
  authenticateClinicalRequest,
  runtimeUserById,
} from './cloudflare-auth-runtime.js';
import { handleAtomicAppointmentEncounterStart } from './appointment-encounter-atomic-runtime.js';
import { handleAtomicClinicalEncounterFinalization } from './encounter-finalization-atomic-runtime.js';
import { handleClinicalNoteVersioning } from './clinical-note-versioning-runtime.js';
import { handleCloudflareGrowthRuntime } from './cloudflare-growth-runtime.js';
import { handleCloudflareRelationGuard } from './cloudflare-relation-guard.js';
import { handleCloudflareUpsertRuntime } from './cloudflare-upsert-runtime.js';
import { handleGenericCrudPolicy } from './generic-crud-policy-runtime.js';
import { handleClinicalPagedRead } from './clinical-read-page-runtime.js';
import { handleClaimedStorageDelete } from './storage-delete-claim-runtime.js';
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

  const claimedDeleteResponse = await handleClaimedStorageDelete(request, env, url);
  if (claimedDeleteResponse) return claimedDeleteResponse;

  const storageResponse = await handleConsistentStorageMutation(request, env, url);
  if (storageResponse) return storageResponse;

  const growthResponse = await handleCloudflareGrowthRuntime(request, env, url);
  if (growthResponse) return growthResponse;

  const relationGuardResponse = await handleCloudflareRelationGuard(request, env, url);
  if (relationGuardResponse) return relationGuardResponse;

  // POST upserts run before the versioned encounter adapter. Apply the table policy
  // here so a generic on_conflict request cannot bypass a domain-managed write path.
  if (request.method === 'POST') {
    const genericPostPolicyResponse = handleGenericCrudPolicy(request, url);
    if (genericPostPolicyResponse) return genericPostPolicyResponse;
  }

  const upsertResponse = await handleCloudflareUpsertRuntime(request, env, url);
  if (upsertResponse) return upsertResponse;

  if (requiresCloudflareIdentity(request, url)) {
    if (!env.CLINICAL_DB) return runtimeJson(503, { error: 'cloudflare_d1_required' });
    const user = await authenticateClinicalRequest(request, env);
    if (!user?.id) return runtimeJson(401, { error: 'cloudflare_auth_required' });
  }

  // Current owner-backed records are filtered, ordered and paginated by D1. Imported
  // legacy rows without a physical owner_id deliberately fall through to the existing
  // relationship-aware adapter so performance hardening never changes ownership rules.
  const pagedReadResponse = await handleClinicalPagedRead(request, env, url);
  if (pagedReadResponse) return pagedReadResponse;

  const versioningResponse = await handleClinicalNoteVersioning(request, env, url);
  if (versioningResponse) return versioningResponse;

  const finalizationResponse = await handleAtomicClinicalEncounterFinalization(request, env, url);
  if (finalizationResponse) return finalizationResponse;

  const atomicStartResponse = await handleAtomicAppointmentEncounterStart(request, env, url);
  if (atomicStartResponse) return atomicStartResponse;

  // Specialized handlers above get first refusal. Anything still reaching the generic
  // records adapter must obey the explicit table/method allowlist.
  const genericPolicyResponse = handleGenericCrudPolicy(request, url);
  if (genericPolicyResponse) return genericPolicyResponse;

  return handleCloudflareDataRuntime(request, env, url);
}

export {
  authenticateClinicalRequest,
  hasOwnedRecord,
  runtimeJson,
  runtimeUserById,
};
