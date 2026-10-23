import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { canPublishToMother, isPublishedForMother } from '../public/mother-portal-contract.js';
import { requestMemberVerification, verifyMemberVerification } from './member-portal-verification-runtime.js';

const RETIRED_RPCS = new Map([
  ['bootstrap_demo_data', { reason: 'demo_seed_managed_outside_runtime', replacement: 'demo:seed' }],
  ['delete_appointment', { reason: 'canonical_appointment_delete_rpc', replacement: 'delete_scheduled_appointment' }],
  ['delete_clinical_encounter', { reason: 'clinical_record_retention_required', replacement: null }],
]);

const MEMBER_PORTAL_TABLES = new Set([
  'member_shared_items',
  'portal_content',
  'member_engagement_events',
  'member_perks',
]);

const TIER_RANK = Object.freeze({ free: 0, essential: 1, premium: 2 });

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}

function database(env) {
  if (!env.CLINICAL_DB) throw new Error('clinical_db_not_configured');
  return env.CLINICAL_DB;
}

function parseRows(result) {
  return (result.results || []).map((row) => {
    try {
      return { key: row.record_key, ownerId: row.owner_id || null, record: JSON.parse(row.record_json) };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

async function tableRows(env, table, ownerId) {
  if (!ownerId) return [];
  const result = await database(env)
    .prepare(`SELECT record_key,owner_id,record_json FROM supabase_records
      WHERE table_name = ? AND (owner_id = ? OR (owner_id IS NULL AND json_extract(record_json,'$.owner_id') = ?))`)
    .bind(table, ownerId, ownerId)
    .all();
  return parseRows(result);
}

async function accessRowsByMember(env, userId) {
  if (!userId) return [];
  const result = await database(env)
    .prepare(`SELECT record_key,owner_id,record_json FROM supabase_records
      WHERE table_name = 'member_portal_access' AND json_extract(record_json,'$.member_user_id') = ?`)
    .bind(String(userId))
    .all();
  return parseRows(result);
}

async function accessRowsByEmail(env, email) {
  if (!email) return [];
  const result = await database(env)
    .prepare(`SELECT record_key,owner_id,record_json FROM supabase_records
      WHERE table_name = 'member_portal_access' AND lower(trim(json_extract(record_json,'$.email'))) = ?`)
    .bind(String(email))
    .all();
  return parseRows(result);
}

function saveStatement(env, table, entry, record) {
  const now = new Date().toISOString();
  const next = { ...record, updated_at: record.updated_at || now };
  return database(env).prepare(`INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(table_name,record_key) DO UPDATE SET
    owner_id=excluded.owner_id,record_json=excluded.record_json,source_created_at=excluded.source_created_at,
    source_updated_at=excluded.source_updated_at,migrated_at=excluded.migrated_at`).bind(
      table,
      entry.key,
      entry.ownerId || next.owner_id || null,
      JSON.stringify(next),
      next.created_at || now,
      next.updated_at || now,
      now,
    );
}

async function saveEntry(env, table, entry, record) {
  await saveStatement(env, table, entry, record).run();
  return record;
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isActive(value) {
  if (value === false || value === 0) return false;
  const normalized = String(value ?? '').trim().toLowerCase();
  return !['false', '0', 'inactive', 'disabled', 'cancelled', 'canceled'].includes(normalized);
}

function tierRank(value, fallback = -1) {
  const key = String(value || '').trim().toLowerCase();
  return Object.hasOwn(TIER_RANK, key) ? TIER_RANK[key] : fallback;
}

async function claimedAccess(env, user) {
  if (!user?.id) return null;
  const rows = await accessRowsByMember(env, user.id);
  return rows.find((entry) => isActive(entry.record?.active) && String(entry.record?.member_user_id || '') === String(user.id)) || null;
}

async function claimMemberPortal(env, user) {
  const email = normalizedEmail(user?.email);
  if (!user?.id || !email) return json(401, { error: 'member_identity_required', message: 'Entre com o e-mail convidado para acessar a Área da Mãe.' });
  const alreadyRows = await accessRowsByMember(env, user.id);
  const already = alreadyRows.find((entry) => isActive(entry.record?.active) && String(entry.record?.member_user_id || '') === String(user.id));
  if (already) return json(200, already.record);

  // E-mail não comprova titularidade: o primeiro vínculo exige código entregue à caixa postal.
  return json(409, { error:'member_verification_required', message:'Confirme o e-mail do convite antes de acessar sua área.' });
}

function requestedOwner(url) {
  const raw = String(url.searchParams.get('owner_id') || '');
  return raw.startsWith('eq.') ? decodeURIComponent(raw.slice(3)) : '';
}

function sortAndLimit(rows, url) {
  const order = String(url.searchParams.get('order') || '');
  if (order) {
    const [field, direction = 'asc'] = order.split('.');
    rows.sort((a, b) => {
      const av = a?.[field] ?? '';
      const bv = b?.[field] ?? '';
      const cmp = String(av).localeCompare(String(bv));
      return direction === 'desc' ? -cmp : cmp;
    });
  }
  const limit = Number(url.searchParams.get('limit') || 0);
  return Number.isInteger(limit) && limit > 0 ? rows.slice(0, limit) : rows;
}

function portalRowsForAccess(table, entries, access, url, unlockEntries = []) {
  const ownerId = String(access.owner_id || '');
  const motherId = String(access.mother_id || '');
  const requested = requestedOwner(url);
  if (requested && requested !== ownerId) return [];
  let rows = entries
    .filter((entry) => String(entry.ownerId || entry.record?.owner_id || '') === ownerId)
    .map((entry) => entry.record);

  if (table === 'member_shared_items') {
    rows = rows.filter((row) => String(row.mother_id || '') === motherId && isPublishedForMother(row));
  } else if (table === 'member_engagement_events') {
    rows = rows.filter((row) => String(row.mother_id || '') === motherId && String(row.member_access_id || '') === String(access.id || ''));
  } else if (table === 'member_perks') {
    rows = rows.filter((row) => (!row.mother_id || String(row.mother_id) === motherId) && isActive(row.active ?? true));
  } else if (table === 'portal_content') {
    const accessTier = tierRank(access.tier, 0);
    const unlockedIds = new Set(unlockEntries
      .filter((entry) => String(entry.ownerId || entry.record?.owner_id || '') === ownerId)
      .map((entry) => entry.record)
      .filter((unlock) => String(unlock.mother_id || '') === motherId && isActive(unlock.active ?? true))
      .map((unlock) => String(unlock.content_id || ''))
      .filter(Boolean));
    rows = rows.filter((row) => {
      if (!isActive(row.active ?? row.published ?? true)) return false;
      const minTier = row.min_tier ? tierRank(row.min_tier, Number.POSITIVE_INFINITY) : TIER_RANK.free;
      return accessTier >= minTier || unlockedIds.has(String(row.id || ''));
    });
  }
  return sortAndLimit(rows, url);
}

async function readMemberPortalTable(env, user, table, url) {
  const accessEntry = await claimedAccess(env, user);
  if (!accessEntry) return json(403, { error: 'member_access_claim_required', message: 'Vincule primeiro o convite da Área da Mãe.' });
  const ownerId = String(accessEntry.record?.owner_id || '');
  const [entries, unlockEntries] = await Promise.all([
    tableRows(env, table, ownerId),
    table === 'portal_content' ? tableRows(env, 'member_content_unlocks', ownerId) : Promise.resolve([]),
  ]);
  const rows = portalRowsForAccess(table, entries, accessEntry.record, url, unlockEntries);
  return json(200, rows);
}

async function writeMemberEngagement(env, user, request) {
  const accessEntry = await claimedAccess(env, user);
  if (!accessEntry) return json(403, { error: 'member_access_claim_required', message: 'Vincule primeiro o convite da Área da Mãe.' });
  const input = await request.json().catch(() => ({}));
  const access = accessEntry.record;
  const now = new Date().toISOString();
  const event = {
    event_type: ['portal_visit','shared_view','content_view','content_complete'].includes(String(input?.event_type || '')) ? String(input.event_type) : 'portal_visit',
    item_kind: String(input?.item_kind || '').slice(0,40),
    item_id: input?.item_id || null,
    event_key: String(input?.event_key || '').slice(0,100),
    id: crypto.randomUUID(),
    owner_id: access.owner_id,
    mother_id: access.mother_id,
    member_access_id: access.id,
    member_user_id: user.id,
    created_at: input?.created_at || now,
    updated_at: now,
  };
  const entry = { key: event.id, ownerId: access.owner_id, record: event };
  await saveEntry(env, 'member_engagement_events', entry, event);
  return json(201, event);
}

// O módulo é desligado por padrão até homologação e ativação explícita.
const portalEnabled = env => String(env.MOTHER_PORTAL_ENABLED || 'false').toLowerCase() === 'true';

export async function authorizeMemberAttachment(env, user, bucket, path) {
  if (!portalEnabled(env) || bucket !== 'clinical-media' || !path) return false;
  const entry = await claimedAccess(env, user);
  if (!entry) return false;
  const access=entry.record, ownerId=String(access.owner_id || '');
  if (!ownerId || !path.startsWith(ownerId + '/')) return false;
  const url=new URL('https://member-portal.internal/');
  const [shared,content,unlocks]=await Promise.all([
    tableRows(env,'member_shared_items',ownerId),tableRows(env,'portal_content',ownerId),
    tableRows(env,'member_content_unlocks',ownerId),
  ]);
  const ownedShared=portalRowsForAccess('member_shared_items',shared,access,url);
  const ownedContent=portalRowsForAccess('portal_content',content,access,url,unlocks);
  return [...ownedShared,...ownedContent].some(row=>String(row.attachment_path || '') === path);
}

async function validateProfessionalShare(request,env,url,user) {
  const input=await request.clone().json().catch(()=>null);
  if (!input || typeof input!=='object' || Array.isArray(input)) return json(400,{error:'invalid_member_share'});
  const owned=await tableRows(env,'member_shared_items',user.id);
  const candidates=request.method==='PATCH'
    ? owned.filter(e=>url.searchParams.get('id')==='eq.'+e.record.id).map(e=>({...e.record,...input}))
    : [input];
  if (request.method==='PATCH' && !candidates.length) return json(404,{error:'member_share_not_found'});
  const mothers=await tableRows(env,'mothers',user.id);
  for(const row of candidates) {
    if(!mothers.some(e=>String(e.record.id||e.key)===String(row.mother_id||'')))
      return json(403,{error:'mother_not_owned'});
    if(!canPublishToMother(row)) return json(422,{
      error:'unsafe_member_publication',
      message:'Publique apenas plano de cuidado, orientações, retornos e arquivos autorizados. Anamnese e avaliações internas permanecem privadas.'
    });
  }
  return null;
}

export async function handleBlock6RpcRuntime(request, env, url = new URL(request.url), deps = {}) {
  if (!env.CLINICAL_DB) return null;
  const authenticate = deps.authenticate || authenticateClinicalRequest;

  if (request.method === 'POST' && url.pathname.startsWith('/api/clinical/rpc/')) {
    const name = decodeURIComponent(url.pathname.slice('/api/clinical/rpc/'.length));
    if (RETIRED_RPCS.has(name)) {
      const retired = RETIRED_RPCS.get(name);
      return json(410, { error: 'rpc_retired', rpc: name, reason: retired.reason, replacement: retired.replacement });
    }
    if (['claim_member_portal','request_member_verification','verify_member_verification'].includes(name)) {
      if (!portalEnabled(env)) return json(403,{error:'mother_portal_disabled'});
      const user = await authenticate(request, env);
      if (!user?.id) return json(401, { error:'cloudflare_auth_required', message:'Sessão expirada. Entre novamente.' });
      if (name === 'claim_member_portal') return claimMemberPortal(env, user);
      if (name === 'request_member_verification') return requestMemberVerification(env, user);
      return verifyMemberVerification(env, user, request);
    }
    return null;
  }

  if (!url.pathname.startsWith('/api/clinical/records/')) return null;
  const table = decodeURIComponent(url.pathname.slice('/api/clinical/records/'.length).split('/')[0] || '');
  if (!MEMBER_PORTAL_TABLES.has(table)) return null;
  const user = await authenticate(request, env);
  if (!user?.id) return json(401, { error: 'cloudflare_auth_required', message: 'Sessão expirada. Entre novamente.' });
  const access = await claimedAccess(env, user);
  if (!access) {
    if (table === 'member_shared_items' && (request.method === 'POST' || request.method === 'PATCH')) {
      return validateProfessionalShare(request,env,url,user);
    }
    return null;
  }
  if (!portalEnabled(env)) return json(403,{error:'mother_portal_disabled'});

  if (request.method === 'GET') return readMemberPortalTable(env, user, table, url);
  if (table === 'member_engagement_events' && request.method === 'POST') return writeMemberEngagement(env, user, request);
  return json(405, { error: 'member_portal_method_not_allowed' });
}
