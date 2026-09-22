const LEGACY_SUPABASE_URL = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const LEGACY_SUPABASE_KEY = 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 210000;
const GLOBAL_READ_TABLES = new Set([
  'billing_plan_catalog', 'clinical_document_templates', 'document_templates',
  'portal_content', 'member_perks'
]);
const OWNER_TABLES = new Set([
  'mothers','babies','appointments','clinical_encounters','weights','growth_measurements',
  'followups','financial_entries','consents','library_items','media','clinical_media',
  'clinical_documents','clinical_encounter_addenda','clinical_note_revisions',
  'care_packages','care_package_items','care_package_sessions','care_package_item_usages',
  'professional_profiles','saas_accounts','subscriptions','entitlements',
  'billing_checkout_requests','billing_webhook_events','member_content_unlocks',
  'member_engagement_events','member_portal_access','member_shared_items'
]);
const NO_ID_TABLES = new Set(['appointment_babies','clinical_encounter_babies']);

const enc = new TextEncoder();
const dec = new TextDecoder();

export function runtimeJson(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}

function bearer(request) {
  const value = request.headers.get('authorization') || '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function b64urlBytes(bytes) {
  let binary = '';
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of data) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesFromB64url(value) {
  let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function b64urlText(value) { return b64urlBytes(enc.encode(String(value))); }
function decodeB64urlText(value) { return dec.decode(bytesFromB64url(value)); }

async function sha256(value) {
  const bytes = typeof value === 'string' ? enc.encode(value) : value;
  return b64urlBytes(await crypto.subtle.digest('SHA-256', bytes));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(String(secret || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign','verify']);
}

async function signToken(payload, env) {
  const secret = String(env.CLINICAL_AUTH_SECRET || '');
  if (!secret) throw new Error('clinical_auth_secret_missing');
  const header = b64urlText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64urlText(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return `${data}.${b64urlBytes(signature)}`;
}

async function verifyToken(token, env, expectedType = 'access') {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !env.CLINICAL_AUTH_SECRET) return null;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC', await hmacKey(env.CLINICAL_AUTH_SECRET), bytesFromB64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(decodeB64urlText(parts[1]));
    if (payload.typ !== expectedType || Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return b64urlBytes(data);
}

async function passwordHash(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytesFromB64url(salt), iterations }, key, 256);
  return b64urlBytes(bits);
}

function safeEqual(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function requireDb(env) {
  if (!env.CLINICAL_DB) throw new Error('clinical_db_not_configured');
  return env.CLINICAL_DB;
}

function publicUser(row) {
  if (!row) return null;
  let userMetadata = {}, appMetadata = {};
  try { userMetadata = JSON.parse(row.user_metadata_json || '{}'); } catch {}
  try { appMetadata = JSON.parse(row.app_metadata_json || '{}'); } catch {}
  return {
    id: row.user_id,
    email: row.email || null,
    phone: row.phone || null,
    email_confirmed_at: row.email_confirmed_at || null,
    phone_confirmed_at: row.phone_confirmed_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    last_sign_in_at: row.last_sign_in_at || null,
    user_metadata: userMetadata,
    app_metadata: appMetadata,
  };
}

export async function runtimeUserById(env, userId) {
  if (!env.CLINICAL_DB || !userId) return null;
  return publicUser(await env.CLINICAL_DB.prepare('SELECT * FROM auth_users WHERE user_id = ? LIMIT 1').bind(userId).first());
}

async function userRowByEmail(env, email) {
  if (!env.CLINICAL_DB || !email) return null;
  return env.CLINICAL_DB.prepare('SELECT * FROM auth_users WHERE lower(email) = lower(?) LIMIT 1').bind(String(email).trim()).first();
}

async function upsertAuthUser(env, user) {
  if (!user?.id) return null;
  const db = requireDb(env);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO auth_users(
    user_id,email,phone,email_confirmed_at,phone_confirmed_at,created_at,updated_at,last_sign_in_at,
    user_metadata_json,app_metadata_json,password_reset_required,migrated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)
  ON CONFLICT(user_id) DO UPDATE SET
    email=excluded.email,phone=excluded.phone,email_confirmed_at=excluded.email_confirmed_at,
    phone_confirmed_at=excluded.phone_confirmed_at,updated_at=excluded.updated_at,
    last_sign_in_at=excluded.last_sign_in_at,user_metadata_json=excluded.user_metadata_json,
    app_metadata_json=excluded.app_metadata_json,migrated_at=excluded.migrated_at`).bind(
      user.id, user.email || null, user.phone || null, user.email_confirmed_at || null,
      user.phone_confirmed_at || null, user.created_at || now, user.updated_at || now,
      user.last_sign_in_at || now, JSON.stringify(user.user_metadata || {}), JSON.stringify(user.app_metadata || {}), now
    ).run();
  return runtimeUserById(env, user.id);
}

async function setCredential(env, userId, password) {
  const db = requireDb(env);
  const salt = randomToken(18);
  const hash = await passwordHash(password, salt, PASSWORD_ITERATIONS);
  await db.prepare(`INSERT INTO auth_credentials(user_id,password_salt,password_hash,password_iterations,password_algorithm,created_at,updated_at)
    VALUES(?,?,?,?, 'PBKDF2-SHA256',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET password_salt=excluded.password_salt,password_hash=excluded.password_hash,
      password_iterations=excluded.password_iterations,password_algorithm=excluded.password_algorithm,updated_at=CURRENT_TIMESTAMP`)
    .bind(userId, salt, hash, PASSWORD_ITERATIONS).run();
  await db.prepare('UPDATE auth_users SET password_reset_required = 0, updated_at = ? WHERE user_id = ?')
    .bind(new Date().toISOString(), userId).run();
}

async function verifyLocalPassword(env, userId, password) {
  const row = await requireDb(env).prepare('SELECT * FROM auth_credentials WHERE user_id = ? LIMIT 1').bind(userId).first();
  if (!row) return false;
  const actual = await passwordHash(password, row.password_salt, Number(row.password_iterations || PASSWORD_ITERATIONS));
  return safeEqual(actual, row.password_hash);
}

async function legacyAuth(path, body) {
  const response = await fetch(`${LEGACY_SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: LEGACY_SUPABASE_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function legacyUserForToken(token) {
  if (!token) return null;
  const response = await fetch(`${LEGACY_SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: LEGACY_SUPABASE_KEY, authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? user : null;
}

async function issueSession(env, user) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await signToken({ typ: 'access', sub: user.id, email: user.email || '', iat: now, exp: now + ACCESS_TTL_SECONDS }, env);
  const refreshToken = randomToken(40);
  const refreshHash = await sha256(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString();
  await requireDb(env).prepare(`INSERT INTO auth_refresh_sessions(token_hash,user_id,expires_at,created_at,last_used_at,revoked_at)
    VALUES(?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,NULL)`).bind(refreshHash, user.id, expiresAt).run();
  return { access_token: accessToken, refresh_token: refreshToken, token_type: 'bearer', expires_in: ACCESS_TTL_SECONDS, user };
}

export async function authenticateRuntimeToken(token, env, { allowLegacy = true } = {}) {
  if (!token) return null;
  const local = await verifyToken(token, env, 'access');
  if (local?.sub) {
    const user = await runtimeUserById(env, local.sub);
    if (user) return user;
  }
  if (!allowLegacy) return null;
  const legacy = await legacyUserForToken(token);
  if (!legacy?.id) return null;
  if (env.CLINICAL_DB) await upsertAuthUser(env, legacy).catch(() => null);
  return { ...legacy, id: legacy.id, email: legacy.email || null };
}

export async function authenticateClinicalRequest(request, env, options = {}) {
  return authenticateRuntimeToken(bearer(request), env, options);
}

async function handlePasswordLogin(request, env) {
  const input = await request.json().catch(() => null);
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');
  if (!email || !password) return runtimeJson(400, { message: 'Informe e-mail e senha.' });
  let row = await userRowByEmail(env, email);
  if (row && await verifyLocalPassword(env, row.user_id, password)) {
    const user = publicUser(row);
    await requireDb(env).prepare('UPDATE auth_users SET last_sign_in_at = ?, updated_at = ? WHERE user_id = ?')
      .bind(new Date().toISOString(), new Date().toISOString(), user.id).run();
    return runtimeJson(200, await issueSession(env, { ...user, last_sign_in_at: new Date().toISOString() }));
  }

  // Existing Supabase accounts migrate their password hash on the first successful login.
  const legacy = await legacyAuth('token?grant_type=password', { email, password });
  if (!legacy.response.ok || !legacy.payload?.user?.id) {
    return runtimeJson(400, { message: legacy.payload?.msg || legacy.payload?.error_description || 'E-mail ou senha inválidos.' });
  }
  const user = await upsertAuthUser(env, legacy.payload.user);
  await setCredential(env, user.id, password);
  return runtimeJson(200, await issueSession(env, await runtimeUserById(env, user.id)));
}

async function handleSignup(request, env) {
  const input = await request.json().catch(() => null);
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');
  if (!email || password.length < 8) return runtimeJson(400, { message: 'Informe um e-mail válido e senha com pelo menos 8 caracteres.' });
  const existing = await userRowByEmail(env, email);
  if (existing) {
    const hasCredential = await requireDb(env).prepare('SELECT user_id FROM auth_credentials WHERE user_id = ? LIMIT 1').bind(existing.user_id).first();
    return runtimeJson(400, { message: hasCredential ? 'Este e-mail já possui cadastro. Use Entrar.' : 'Conta existente migrada. Use Entrar com sua senha atual para concluir a migração.' });
  }

  // Email ownership remains protected by the existing confirmation flow during the transition.
  const legacy = await legacyAuth('signup', { email, password, data: input?.data || { display_name: 'Débora' } });
  if (!legacy.response.ok) return runtimeJson(legacy.response.status, legacy.payload || { message: 'Não foi possível criar a conta.' });
  if (legacy.payload?.user?.id) await upsertAuthUser(env, legacy.payload.user);
  if (legacy.payload?.access_token && legacy.payload?.user?.id) {
    await setCredential(env, legacy.payload.user.id, password);
    return runtimeJson(200, await issueSession(env, await runtimeUserById(env, legacy.payload.user.id)));
  }
  return runtimeJson(200, legacy.payload || {});
}

async function handleRefresh(request, env) {
  const input = await request.json().catch(() => null);
  const refreshToken = String(input?.refresh_token || '');
  if (!refreshToken) return runtimeJson(400, { message: 'Refresh token ausente.' });
  const tokenHash = await sha256(refreshToken);
  const row = await requireDb(env).prepare(`SELECT * FROM auth_refresh_sessions
    WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1`).bind(tokenHash, new Date().toISOString()).first();
  if (row?.user_id) {
    await requireDb(env).prepare('UPDATE auth_refresh_sessions SET revoked_at = ?, last_used_at = ? WHERE token_hash = ?')
      .bind(new Date().toISOString(), new Date().toISOString(), tokenHash).run();
    const user = await runtimeUserById(env, row.user_id);
    if (!user) return runtimeJson(401, { message: 'Sessão inválida.' });
    return runtimeJson(200, await issueSession(env, user));
  }

  // Existing browser sessions can cross the cutover without forcing a logout.
  const legacy = await legacyAuth('token?grant_type=refresh_token', { refresh_token: refreshToken });
  if (!legacy.response.ok || !legacy.payload?.user?.id) return runtimeJson(401, { message: 'Sessão expirada. Entre novamente.' });
  const user = await upsertAuthUser(env, legacy.payload.user);
  return runtimeJson(200, await issueSession(env, user));
}

async function handleAuth(request, env, url) {
  if (url.pathname === '/auth/v1/token' && request.method === 'POST') {
    const grant = url.searchParams.get('grant_type') || '';
    if (grant === 'password') return handlePasswordLogin(request, env);
    if (grant === 'refresh_token') return handleRefresh(request, env);
    return runtimeJson(400, { message: 'Grant type não suportado.' });
  }
  if (url.pathname === '/auth/v1/signup' && request.method === 'POST') return handleSignup(request, env);
  if (url.pathname === '/auth/v1/user' && request.method === 'GET') {
    const user = await authenticateClinicalRequest(request, env);
    return user ? runtimeJson(200, user) : runtimeJson(401, { message: 'Sessão inválida.' });
  }
  if (url.pathname === '/auth/v1/logout' && request.method === 'POST') {
    const user = await authenticateClinicalRequest(request, env, { allowLegacy: false });
    if (user?.id) await requireDb(env).prepare('UPDATE auth_refresh_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(new Date().toISOString(), user.id).run();
    return new Response(null, { status: 204 });
  }
  return runtimeJson(404, { message: 'Auth endpoint não encontrado.' });
}

async function tableRows(env, table) {
  const result = await requireDb(env).prepare('SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = ?').bind(table).all();
  return (result.results || []).map((row) => {
    try { return { key: row.record_key, ownerId: row.owner_id || null, record: JSON.parse(row.record_json) }; }
    catch { return null; }
  }).filter(Boolean);
}

async function recordById(env, table, id) {
  if (!id) return null;
  const rows = await tableRows(env, table);
  return rows.find((entry) => String(entry.record?.id || entry.key) === String(id)) || null;
}

async function recordOwnedByUser(env, table, entry, userId, depth = 0) {
  if (!entry || depth > 5) return false;
  const row = entry.record || {};
  if (entry.ownerId) return String(entry.ownerId) === String(userId);
  if (row.owner_id) return String(row.owner_id) === String(userId);
  if (row.user_id) return String(row.user_id) === String(userId);
  if (table === 'professional_profiles' && String(row.id || '') === String(userId)) return true;
  const refs = [
    ['mother_id','mothers'], ['baby_id','babies'], ['appointment_id','appointments'],
    ['encounter_id','clinical_encounters'], ['care_package_id','care_packages']
  ];
  for (const [field, refTable] of refs) {
    if (!row[field]) continue;
    const parent = await recordById(env, refTable, row[field]);
    if (parent && await recordOwnedByUser(env, refTable, parent, userId, depth + 1)) return true;
  }
  return GLOBAL_READ_TABLES.has(table);
}

export async function hasOwnedRecord(env, table, userId) {
  for (const entry of await tableRows(env, table)) if (await recordOwnedByUser(env, table, entry, userId)) return true;
  return false;
}

function compareValue(actual, operator, expected) {
  if (operator === 'eq') return String(actual ?? '') === expected;
  if (operator === 'neq') return String(actual ?? '') !== expected;
  if (operator === 'is') return expected === 'null' ? actual == null : String(actual) === expected;
  if (operator === 'not') {
    if (expected === 'is.null') return actual != null;
    return String(actual ?? '') !== expected;
  }
  if (operator === 'in') {
    const values = expected.replace(/^\(|\)$/g, '').split(',').map((item) => decodeURIComponent(item.trim().replace(/^"|"$/g, '')));
    return values.includes(String(actual ?? ''));
  }
  if (operator === 'like' || operator === 'ilike') {
    const pattern = expected.replace(/%/g, '.*');
    return new RegExp(`^${pattern}$`, operator === 'ilike' ? 'i' : '').test(String(actual ?? ''));
  }
  const aNum = Number(actual), eNum = Number(expected);
  const numeric = Number.isFinite(aNum) && Number.isFinite(eNum);
  const a = numeric ? aNum : String(actual ?? ''), e = numeric ? eNum : expected;
  if (operator === 'gt') return a > e;
  if (operator === 'gte') return a >= e;
  if (operator === 'lt') return a < e;
  if (operator === 'lte') return a <= e;
  return true;
}

function queryMatches(row, url) {
  for (const [field, raw] of url.searchParams.entries()) {
    if (['select','order','limit','offset','on_conflict'].includes(field) || field === 'or') continue;
    const value = String(raw || '');
    let operator = 'eq', expected = value;
    const firstDot = value.indexOf('.');
    if (firstDot > 0) {
      operator = value.slice(0, firstDot);
      expected = value.slice(firstDot + 1);
      if (operator === 'not' && expected.startsWith('is.')) expected = expected;
    }
    if (!compareValue(row?.[field], operator, expected)) return false;
  }
  return true;
}

function sortRows(rows, orderSpec) {
  if (!orderSpec) return rows;
  const clauses = String(orderSpec).split(',').map((part) => {
    const [field, direction = 'asc'] = part.split('.');
    return { field, direction };
  });
  return rows.sort((a, b) => {
    for (const { field, direction } of clauses) {
      const av = a?.[field], bv = b?.[field];
      if (av == null && bv == null) continue;
      if (av == null) return direction === 'desc' ? 1 : -1;
      if (bv == null) return direction === 'desc' ? -1 : 1;
      const result = String(av).localeCompare(String(bv), undefined, { numeric: true });
      if (result) return direction === 'desc' ? -result : result;
    }
    return 0;
  });
}

function projectRow(row, select) {
  const value = String(select || '*');
  if (!value || value === '*' || value.includes('(')) return row;
  const fields = value.split(',').map((item) => item.trim()).filter(Boolean);
  const out = {};
  for (const field of fields) if (field in row) out[field] = row[field];
  return out;
}

async function recordKey(table, row) {
  if (row.id) return String(row.id);
  if (table === 'appointment_babies') return `${row.appointment_id || ''}|${row.baby_id || ''}`;
  if (table === 'clinical_encounter_babies') return `${row.encounter_id || ''}|${row.baby_id || ''}`;
  if (table === 'consents') return `${row.owner_id || ''}|${row.mother_id || ''}|${row.consent_type || ''}`;
  return sha256(`${table}|${JSON.stringify(row)}`);
}

async function saveEntry(env, table, key, row) {
  const now = new Date().toISOString();
  await requireDb(env).prepare(`INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(table_name,record_key) DO UPDATE SET
    owner_id=excluded.owner_id,record_json=excluded.record_json,source_created_at=excluded.source_created_at,
    source_updated_at=excluded.source_updated_at,migrated_at=excluded.migrated_at`).bind(
      table, key, row.owner_id || null, JSON.stringify(row), row.created_at || now, row.updated_at || now, now
    ).run();
}

async function ensureWriteOwnership(env, table, row, user) {
  if (!user?.id) return false;
  if (row.owner_id && String(row.owner_id) !== String(user.id)) return false;
  if (OWNER_TABLES.has(table) && !row.owner_id && !['babies','weights','growth_measurements','clinical_encounter_addenda','clinical_note_revisions','care_package_items','care_package_sessions','care_package_item_usages'].includes(table)) {
    row.owner_id = user.id;
  }
  if (row.owner_id) return String(row.owner_id) === String(user.id);
  if (row.user_id) return String(row.user_id) === String(user.id);
  const synthetic = { key: await recordKey(table, row), ownerId: row.owner_id || null, record: row };
  return recordOwnedByUser(env, table, synthetic, user.id);
}

async function licenseCall(env, body) {
  if (!env.ARTISYS_LICENSING || !env.LICENSE_SERVICE_SECRET) return null;
  const response = await env.ARTISYS_LICENSING.fetch(new Request('https://artisys-licensing.internal/api/internal/product-license', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-artisys-license-secret': env.LICENSE_SERVICE_SECRET }, body: JSON.stringify(body)
  }));
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function enforcePatientLimit(env, user) {
  const access = await licenseCall(env, { action: 'resolve', productCode: 'debora-lactacao', email: user.email });
  if (!access?.commercial || !Number.isInteger(access.patientLimit)) return null;
  let count = 0;
  for (const entry of await tableRows(env, 'mothers')) if (await recordOwnedByUser(env, 'mothers', entry, user.id)) count++;
  return count >= Number(access.patientLimit) ? runtimeJson(403, { error: 'SAAS_PATIENT_LIMIT_REACHED', limit: access.patientLimit }) : null;
}

async function enforceMediaAccess(env, user) {
  const access = await licenseCall(env, { action: 'resolve', productCode: 'debora-lactacao', email: user.email });
  return access?.commercial && !access.mediaUpload ? runtimeJson(403, { error: 'SAAS_MEDIA_UPLOAD_NOT_ALLOWED' }) : null;
}

async function handleRest(request, env, url) {
  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return runtimeJson(401, { message: 'Sessão expirada. Entre novamente.' });
  const relative = url.pathname.slice('/rest/v1/'.length);
  if (relative.startsWith('rpc/')) return handleRpc(request, env, url, relative.slice(4), user);
  const table = decodeURIComponent(relative.split('/')[0] || '');
  if (!/^[A-Za-z0-9_]+$/.test(table)) return runtimeJson(400, { message: 'Tabela inválida.' });

  if (request.method === 'GET' || request.method === 'HEAD') {
    const visible = [];
    for (const entry of await tableRows(env, table)) {
      if (!await recordOwnedByUser(env, table, entry, user.id)) continue;
      if (queryMatches(entry.record, url)) visible.push(entry.record);
    }
    const total = visible.length;
    sortRows(visible, url.searchParams.get('order'));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
    const limitParam = url.searchParams.get('limit');
    const limitRaw = limitParam === null ? Number.NaN : Number(limitParam);
    const limit = Number.isFinite(limitRaw) && limitRaw >= 0 ? limitRaw : visible.length;
    const sliced = visible.slice(offset, offset + limit).map((row) => projectRow(row, url.searchParams.get('select')));
    const end = sliced.length ? offset + sliced.length - 1 : offset;
    const headers = { 'content-range': `${offset}-${end}/${total}`, 'range-unit': 'items' };
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return runtimeJson(200, sliced, headers);
  }

  if (request.method === 'POST') {
    if (table === 'mothers') {
      const limited = await enforcePatientLimit(env, user);
      if (limited) return limited;
    }
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== 'object') return runtimeJson(400, { message: 'Payload inválido.' });
    const list = Array.isArray(input) ? input : [input];
    const saved = [];
    const conflictFields = String(url.searchParams.get('on_conflict') || '').split(',').map((v) => v.trim()).filter(Boolean);
    for (const source of list) {
      const row = { ...source };
      const now = new Date().toISOString();
      if (!NO_ID_TABLES.has(table) && !row.id) row.id = crypto.randomUUID();
      if (!row.created_at) row.created_at = now;
      row.updated_at = row.updated_at || now;
      if (!await ensureWriteOwnership(env, table, row, user)) return runtimeJson(403, { message: 'Registro fora do escopo da conta.' });
      let key = await recordKey(table, row);
      if (conflictFields.length) {
        const existing = (await tableRows(env, table)).find((entry) => conflictFields.every((field) => String(entry.record?.[field] ?? '') === String(row[field] ?? '')));
        if (existing && await recordOwnedByUser(env, table, existing, user.id)) {
          key = existing.key;
          Object.assign(row, existing.record, row, { updated_at: now });
        }
      }
      await saveEntry(env, table, key, row);
      saved.push(row);
    }
    return runtimeJson(201, saved);
  }

  if (request.method === 'PATCH') {
    const patch = await request.json().catch(() => null);
    if (!patch || typeof patch !== 'object') return runtimeJson(400, { message: 'Payload inválido.' });
    const changed = [];
    for (const entry of await tableRows(env, table)) {
      if (!await recordOwnedByUser(env, table, entry, user.id) || !queryMatches(entry.record, url)) continue;
      const row = { ...entry.record, ...patch, updated_at: new Date().toISOString() };
      if (!await ensureWriteOwnership(env, table, row, user)) return runtimeJson(403, { message: 'Registro fora do escopo da conta.' });
      await saveEntry(env, table, entry.key, row);
      changed.push(row);
    }
    return runtimeJson(200, changed);
  }

  if (request.method === 'DELETE') {
    for (const entry of await tableRows(env, table)) {
      if (!await recordOwnedByUser(env, table, entry, user.id) || !queryMatches(entry.record, url)) continue;
      await requireDb(env).prepare('DELETE FROM supabase_records WHERE table_name = ? AND record_key = ?').bind(table, entry.key).run();
    }
    return new Response(null, { status: 204 });
  }

  return runtimeJson(405, { message: 'Método não permitido.' });
}

async function createOwnedRecord(env, table, source, user) {
  const row = { ...source };
  const now = new Date().toISOString();
  if (!NO_ID_TABLES.has(table) && !row.id) row.id = crypto.randomUUID();
  if (!row.created_at) row.created_at = now;
  row.updated_at = row.updated_at || now;
  if (!await ensureWriteOwnership(env, table, row, user)) throw new Error('record_ownership_failed');
  await saveEntry(env, table, await recordKey(table, row), row);
  return row;
}

async function updateOwnedById(env, table, id, patch, user) {
  const entry = await recordById(env, table, id);
  if (!entry || !await recordOwnedByUser(env, table, entry, user.id)) return null;
  const row = { ...entry.record, ...patch, updated_at: new Date().toISOString() };
  await saveEntry(env, table, entry.key, row);
  return row;
}

async function handleRpc(request, env, url, name, user) {
  const p = await request.json().catch(() => ({}));
  if (name === 'schedule_clinical_appointment') {
    const appointment = await createOwnedRecord(env, 'appointments', {
      mother_id: p.p_mother_id, baby_id: Array.isArray(p.p_baby_ids) && p.p_baby_ids.length === 1 ? p.p_baby_ids[0] : null,
      starts_at: p.p_starts_at, duration_min: p.p_duration_min || 60, appointment_type: p.p_appointment_type || 'Atendimento',
      format: p.p_format || 'Domiciliar', value_cents: Number(p.p_value_cents || 0), payment_status: p.p_payment_status || 'Pendente',
      address: p.p_address || '', notes: p.p_notes || '', status: 'Agendado', owner_id: user.id
    }, user);
    for (const [index, babyId] of (Array.isArray(p.p_baby_ids) ? p.p_baby_ids : []).entries()) {
      await createOwnedRecord(env, 'appointment_babies', { appointment_id: appointment.id, baby_id: babyId, is_primary: index === 0 }, user);
    }
    return runtimeJson(200, appointment);
  }

  if (name === 'start_clinical_encounter') {
    const scheduled = await handleRpc(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(p) }), env, url, 'schedule_clinical_appointment', user);
    const appointment = await scheduled.json();
    await updateOwnedById(env, 'appointments', appointment.id, { status: 'Em atendimento' }, user);
    const encounter = await createOwnedRecord(env, 'clinical_encounters', {
      mother_id: p.p_mother_id, baby_id: Array.isArray(p.p_baby_ids) && p.p_baby_ids.length === 1 ? p.p_baby_ids[0] : null,
      appointment_id: appointment.id, status: 'draft', occurred_at: p.p_starts_at || new Date().toISOString(), owner_id: user.id
    }, user);
    for (const [index, babyId] of (Array.isArray(p.p_baby_ids) ? p.p_baby_ids : []).entries()) {
      await createOwnedRecord(env, 'clinical_encounter_babies', { encounter_id: encounter.id, baby_id: babyId, is_primary: index === 0 }, user);
    }
    return runtimeJson(200, { appointment_id: appointment.id, encounter_id: encounter.id });
  }

  if (name === 'start_clinical_encounter_from_appointment') {
    const appointment = await recordById(env, 'appointments', p.p_appointment_id);
    if (!appointment || !await recordOwnedByUser(env, 'appointments', appointment, user.id)) return runtimeJson(404, { message: 'Agendamento não encontrado.' });
    const existing = (await tableRows(env, 'clinical_encounters')).find((entry) => entry.record?.appointment_id === p.p_appointment_id && entry.record?.status !== 'cancelled');
    if (existing && await recordOwnedByUser(env, 'clinical_encounters', existing, user.id)) return runtimeJson(200, { appointment_id: p.p_appointment_id, encounter_id: existing.record.id });
    const babyLinks = (await tableRows(env, 'appointment_babies')).filter((entry) => entry.record?.appointment_id === p.p_appointment_id);
    const babyIds = babyLinks.map((entry) => entry.record.baby_id).filter(Boolean);
    const encounter = await createOwnedRecord(env, 'clinical_encounters', {
      mother_id: appointment.record.mother_id, baby_id: babyIds.length === 1 ? babyIds[0] : appointment.record.baby_id || null,
      appointment_id: p.p_appointment_id, status: 'draft', occurred_at: appointment.record.starts_at || new Date().toISOString(), owner_id: user.id
    }, user);
    for (const [index, babyId] of babyIds.entries()) await createOwnedRecord(env, 'clinical_encounter_babies', { encounter_id: encounter.id, baby_id: babyId, is_primary: index === 0 }, user);
    await updateOwnedById(env, 'appointments', p.p_appointment_id, { status: 'Em atendimento' }, user);
    return runtimeJson(200, { appointment_id: p.p_appointment_id, encounter_id: encounter.id });
  }

  if (name === 'delete_scheduled_appointment') {
    if (String(p.p_confirmation || '') !== 'EXCLUIR') return runtimeJson(400, { message: 'Confirmação inválida.' });
    const appointment = await recordById(env, 'appointments', p.p_appointment_id);
    if (!appointment || !await recordOwnedByUser(env, 'appointments', appointment, user.id)) return runtimeJson(404, { message: 'Agendamento não encontrado.' });
    const encounter = (await tableRows(env, 'clinical_encounters')).find((entry) => entry.record?.appointment_id === p.p_appointment_id);
    if (encounter) return runtimeJson(409, { message: 'Agendamento já possui atendimento e não pode ser excluído.' });
    for (const entry of await tableRows(env, 'appointment_babies')) if (entry.record?.appointment_id === p.p_appointment_id) await requireDb(env).prepare('DELETE FROM supabase_records WHERE table_name=? AND record_key=?').bind('appointment_babies', entry.key).run();
    await requireDb(env).prepare('DELETE FROM supabase_records WHERE table_name=? AND record_key=?').bind('appointments', appointment.key).run();
    return runtimeJson(200, { deleted: true });
  }

  if (name === 'create_or_supersede_followup') {
    const existing = (await tableRows(env, 'followups')).find((entry) => entry.record?.encounter_id === p.p_encounter_id && !/conclu/i.test(String(entry.record?.status || '')));
    if (existing && await recordOwnedByUser(env, 'followups', existing, user.id)) {
      const updated = await updateOwnedById(env, 'followups', existing.record.id, { due_at: p.p_due_at, notes: p.p_notes || '', mother_id: p.p_mother_id, baby_id: p.p_baby_id || null, status: 'Pendente' }, user);
      return runtimeJson(200, updated);
    }
    return runtimeJson(200, await createOwnedRecord(env, 'followups', { owner_id: user.id, mother_id: p.p_mother_id, baby_id: p.p_baby_id || null, encounter_id: p.p_encounter_id, due_at: p.p_due_at, notes: p.p_notes || '', status: 'Pendente' }, user));
  }

  if (name === 'ensure_financial_entry_for_encounter') {
    const existing = (await tableRows(env, 'financial_entries')).find((entry) => entry.record?.encounter_id === p.p_encounter_id && entry.record?.kind !== 'package');
    if (existing && await recordOwnedByUser(env, 'financial_entries', existing, user.id)) return runtimeJson(200, existing.record);
    return runtimeJson(200, await createOwnedRecord(env, 'financial_entries', { owner_id: user.id, mother_id: p.p_mother_id, appointment_id: p.p_appointment_id || null, encounter_id: p.p_encounter_id, description: p.p_description || 'Atendimento', amount_cents: Number(p.p_amount_cents || 0), due_at: p.p_due_at || null, status: 'Pendente', paid: false }, user));
  }

  if (name === 'set_financial_payment_state') {
    const row = await updateOwnedById(env, 'financial_entries', p.p_entry_id, { paid: Boolean(p.p_paid), status: p.p_paid ? 'Pago' : 'Pendente', payment_method: p.p_paid ? (p.p_payment_method || 'Pix') : '', paid_at: p.p_paid ? new Date().toISOString() : null }, user);
    return row ? runtimeJson(200, row) : runtimeJson(404, { message: 'Lançamento não encontrado.' });
  }

  if (name === 'set_appointment_billing') {
    const appointment = await recordById(env, 'appointments', p.p_appointment_id);
    if (!appointment || !await recordOwnedByUser(env, 'appointments', appointment, user.id)) return runtimeJson(404, { message: 'Agendamento não encontrado.' });
    let packageId = p.p_package_id || null;
    if (p.p_billing_mode === 'package_new') {
      const created = await createOwnedRecord(env, 'care_packages', { owner_id: user.id, mother_id: appointment.record.mother_id, service_label: p.p_service_label || 'Plano', total_cents: Number(p.p_package_total_cents || 0), sessions_total: Number(p.p_package_sessions_total || 0), sessions_used: 0, status: 'active', payment_method: p.p_payment_method || '' }, user);
      packageId = created.id;
    }
    const updated = await updateOwnedById(env, 'appointments', p.p_appointment_id, { billing_mode: p.p_billing_mode || 'individual', service_label: p.p_service_label || '', value_cents: Number(p.p_value_cents || 0), payment_method: p.p_payment_method || '', package_id: packageId, package_total_cents: p.p_package_total_cents == null ? null : Number(p.p_package_total_cents), package_sessions_total: p.p_package_sessions_total == null ? null : Number(p.p_package_sessions_total) }, user);
    return runtimeJson(200, updated);
  }

  if (name === 'finalize_encounter_billing') {
    const appointment = await recordById(env, 'appointments', p.p_appointment_id);
    if (!appointment || !await recordOwnedByUser(env, 'appointments', appointment, user.id)) return runtimeJson(404, { message: 'Agendamento não encontrado.' });
    const mode = appointment.record.billing_mode || 'individual';
    if (mode === 'package_active' || mode === 'package_new') {
      const packageEntry = await recordById(env, 'care_packages', appointment.record.package_id);
      if (!packageEntry || !await recordOwnedByUser(env, 'care_packages', packageEntry, user.id)) return runtimeJson(409, { message: 'Plano ativo não encontrado.' });
      const used = Math.min(Number(packageEntry.record.sessions_total || 0), Number(packageEntry.record.sessions_used || 0) + 1);
      const remaining = Math.max(0, Number(packageEntry.record.sessions_total || 0) - used);
      await updateOwnedById(env, 'care_packages', packageEntry.record.id, { sessions_used: used, status: remaining > 0 ? 'active' : 'completed' }, user);
      await createOwnedRecord(env, 'care_package_sessions', { owner_id: user.id, care_package_id: packageEntry.record.id, appointment_id: p.p_appointment_id, encounter_id: p.p_encounter_id, used_at: new Date().toISOString() }, user);
      return runtimeJson(200, { handled: true, billing_mode: mode, package_id: packageEntry.record.id, sessions_used: used, sessions_remaining: remaining });
    }
    return runtimeJson(200, { handled: false, billing_mode: 'individual', package_id: null, sessions_used: 0, sessions_remaining: 0 });
  }

  return runtimeJson(404, { message: `RPC não suportada: ${name}` });
}

function storageKey(bucket, path) { return `supabase/${bucket}/${path}`; }

async function handleStorage(request, env, url) {
  const rest = url.pathname.slice('/storage/v1/'.length);
  if (rest.startsWith('object/sign/')) {
    const user = await authenticateClinicalRequest(request, env);
    if (!user?.id) return runtimeJson(401, { message: 'Sessão expirada.' });
    const [bucket, ...parts] = rest.slice('object/sign/'.length).split('/');
    const path = parts.map(decodeURIComponent).join('/');
    if (!path.startsWith(`${user.id}/`)) return runtimeJson(403, { message: 'Arquivo fora do escopo da conta.' });
    const input = await request.json().catch(() => ({}));
    const ttl = Math.max(60, Math.min(3600, Number(input?.expiresIn || 300)));
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken({ typ: 'file', sub: user.id, bucket, path, iat: now, exp: now + ttl }, env);
    return runtimeJson(200, { signedURL: `/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token)}` });
  }

  if (!rest.startsWith('object/')) return runtimeJson(404, { message: 'Storage endpoint não encontrado.' });
  const [bucketEncoded, ...pathParts] = rest.slice('object/'.length).split('/');
  const bucket = decodeURIComponent(bucketEncoded || '');
  const path = pathParts.map(decodeURIComponent).join('/');
  if (!bucket || !path || path.includes('..')) return runtimeJson(400, { message: 'Caminho inválido.' });

  if (request.method === 'GET' && url.searchParams.get('token')) {
    const grant = await verifyToken(url.searchParams.get('token'), env, 'file');
    if (!grant || grant.bucket !== bucket || grant.path !== path) return runtimeJson(403, { message: 'Link expirado ou inválido.' });
    const object = await env.CLINICAL_FILES?.get(storageKey(bucket, path));
    if (!object) return runtimeJson(404, { message: 'Arquivo não encontrado.' });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag || '');
    headers.set('cache-control', 'private, max-age=300');
    return new Response(object.body, { status: 200, headers });
  }

  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return runtimeJson(401, { message: 'Sessão expirada.' });
  if (!path.startsWith(`${user.id}/`)) return runtimeJson(403, { message: 'Arquivo fora do escopo da conta.' });
  if (!env.CLINICAL_FILES) return runtimeJson(503, { message: 'R2 não configurado.' });

  if (request.method === 'POST' || request.method === 'PUT') {
    const contentType = request.headers.get('content-type') || 'application/octet-stream';
    if (contentType.startsWith('image/') || contentType.startsWith('video/')) {
      const denied = await enforceMediaAccess(env, user);
      if (denied) return denied;
    }
    const key = storageKey(bucket, path);
    const object = await env.CLINICAL_FILES.put(key, request.body, { httpMetadata: { contentType } });
    await requireDb(env).prepare(`INSERT INTO storage_objects(source_bucket,source_path,r2_key,size_bytes,mime_type,source_created_at,source_updated_at,metadata_json,migrated_at)
      VALUES(?,?,?,?,?,?,?,'{}',CURRENT_TIMESTAMP) ON CONFLICT(source_bucket,source_path) DO UPDATE SET r2_key=excluded.r2_key,size_bytes=excluded.size_bytes,mime_type=excluded.mime_type,source_updated_at=excluded.source_updated_at,migrated_at=CURRENT_TIMESTAMP`)
      .bind(bucket, path, key, object?.size || null, contentType, new Date().toISOString(), new Date().toISOString()).run();
    return runtimeJson(200, { Key: key, path });
  }

  if (request.method === 'DELETE') {
    await env.CLINICAL_FILES.delete(storageKey(bucket, path));
    await requireDb(env).prepare('DELETE FROM storage_objects WHERE source_bucket = ? AND source_path = ?').bind(bucket, path).run();
    return new Response(null, { status: 204 });
  }

  return runtimeJson(405, { message: 'Método não permitido.' });
}

async function handleSpecialApi(request, env, url) {
  if (url.pathname === '/api/clinical/mothers' && request.method === 'POST') {
    const target = new URL(request.url);
    target.pathname = '/rest/v1/mothers';
    const cloned = new Request(target.toString(), request);
    return handleRest(cloned, env, target);
  }
  if (url.pathname === '/api/clinical/media/upload' && request.method === 'POST') {
    const user = await authenticateClinicalRequest(request, env);
    if (!user?.id) return runtimeJson(401, { error: 'unauthorized' });
    const path = String(url.searchParams.get('path') || '').replace(/^\/+/, '');
    if (!path.startsWith(`${user.id}/`) || path.includes('..')) return runtimeJson(400, { error: 'invalid_storage_path' });
    const target = new URL(request.url);
    target.pathname = `/storage/v1/object/clinical-media/${path.split('/').map(encodeURIComponent).join('/')}`;
    target.search = '';
    return handleStorage(new Request(target.toString(), { method: 'POST', headers: request.headers, body: request.body }), env, target);
  }
  if (url.pathname === '/api/license/me' && request.method === 'GET') {
    const user = await authenticateClinicalRequest(request, env);
    if (!user?.email) return runtimeJson(401, { error: 'unauthorized' });
    const access = await licenseCall(env, { action: 'resolve', productCode: 'debora-lactacao', email: user.email });
    return access ? runtimeJson(200, access) : runtimeJson(503, { error: 'licensing_unavailable' });
  }
  if (url.pathname === '/api/license/register-commercial' && request.method === 'POST') {
    const user = await authenticateClinicalRequest(request, env);
    if (!user?.email) return runtimeJson(401, { error: 'unauthorized' });
    const result = await licenseCall(env, { action: 'register', productCode: 'debora-lactacao', email: user.email, source: 'saas_onboarding' });
    return result ? runtimeJson(200, result) : runtimeJson(503, { error: 'licensing_registration_failed' });
  }
  if (url.pathname === '/api/cloudflare/health' && request.method === 'GET') {
    const db = env.CLINICAL_DB;
    const validated = db ? await db.prepare("SELECT COUNT(*) AS n FROM migration_runs WHERE status='validated'").first() : null;
    const users = db ? await db.prepare('SELECT COUNT(*) AS n FROM auth_users').first() : null;
    const rows = db ? await db.prepare('SELECT COUNT(*) AS n FROM supabase_records').first() : null;
    return runtimeJson(200, {
      ok: Boolean(env.CLINICAL_DB && env.CLINICAL_FILES && env.CLINICAL_AUTH_SECRET),
      backend: 'cloudflare-d1-r2', d1: Boolean(env.CLINICAL_DB), r2: Boolean(env.CLINICAL_FILES), authSecret: Boolean(env.CLINICAL_AUTH_SECRET),
      validatedMigrations: Number(validated?.n || 0), authUsers: Number(users?.n || 0), records: Number(rows?.n || 0), supabaseClinicalWrites: false,
    });
  }
  return null;
}

export async function handleCloudflareClinicalRuntime(request, env) {
  if (!env.CLINICAL_DB) return null;
  const url = new URL(request.url);
  try {
    if (url.pathname.startsWith('/auth/v1/')) return handleAuth(request, env, url);
    if (url.pathname.startsWith('/rest/v1/')) return handleRest(request, env, url);
    if (url.pathname.startsWith('/storage/v1/')) return handleStorage(request, env, url);
    if (url.pathname.startsWith('/api/clinical/') || url.pathname.startsWith('/api/license/') || url.pathname === '/api/cloudflare/health') return handleSpecialApi(request, env, url);
    return null;
  } catch (error) {
    console.error('cloudflare clinical runtime error', error);
    return runtimeJson(500, { error: error?.message || 'cloudflare_runtime_error' });
  }
}
