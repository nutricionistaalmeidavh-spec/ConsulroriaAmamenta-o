const LEGACY_SUPABASE_URL = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const LEGACY_SUPABASE_KEY = 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';

export const CLOUDFLARE_PBKDF2_ITERATIONS = 100000;
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const LEGACY_CLINICAL_TABLES = [
  'mothers',
  'babies',
  'appointments',
  'appointment_babies',
  'clinical_encounters',
  'clinical_encounter_babies',
  'weights',
  'growth_measurements',
  'followups',
  'financial_entries',
  'consents',
  'library_items',
  'media',
  'clinical_media',
  'clinical_documents',
  'clinical_encounter_addenda',
  'clinical_note_revisions',
  'care_packages',
  'care_package_items',
  'care_package_sessions',
  'care_package_item_usages',
  'referrals',
];

const enc = new TextEncoder();

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
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

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return b64urlBytes(data);
}

async function sha256(value) {
  return b64urlBytes(await crypto.subtle.digest('SHA-256', enc.encode(String(value))));
}

export async function cloudflarePasswordHash(password, salt, iterations = CLOUDFLARE_PBKDF2_ITERATIONS) {
  const count = Number(iterations || 0);
  if (!Number.isInteger(count) || count < 1 || count > CLOUDFLARE_PBKDF2_ITERATIONS) {
    throw new Error('unsupported_pbkdf2_iterations');
  }
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: bytesFromB64url(salt),
    iterations: count,
  }, key, 256);
  return b64urlBytes(bits);
}

function safeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function publicUser(row) {
  let userMetadata = {};
  let appMetadata = {};
  try { userMetadata = JSON.parse(row?.user_metadata_json || '{}'); } catch {}
  try { appMetadata = JSON.parse(row?.app_metadata_json || '{}'); } catch {}
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

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(String(secret || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

function b64urlText(value) {
  return b64urlBytes(enc.encode(String(value)));
}

async function signAccessToken(user, env) {
  const secret = String(env.CLINICAL_AUTH_SECRET || '');
  if (!secret) throw new Error('clinical_auth_secret_missing');
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64urlText(JSON.stringify({
    typ: 'access',
    sub: user.id,
    email: user.email || '',
    iat: now,
    exp: now + ACCESS_TTL_SECONDS,
  }));
  const data = `${header}.${payload}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return `${data}.${b64urlBytes(signature)}`;
}

async function issueSession(env, user) {
  const accessToken = await signAccessToken(user, env);
  const refreshToken = randomToken(40);
  const refreshHash = await sha256(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString();
  await env.CLINICAL_DB.prepare(`INSERT INTO auth_refresh_sessions(token_hash,user_id,expires_at,created_at,last_used_at,revoked_at)
    VALUES(?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,NULL)`).bind(refreshHash, user.id, expiresAt).run();
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: ACCESS_TTL_SECONDS,
    user,
  };
}

async function legacyPasswordLogin(email, password) {
  const response = await fetch(`${LEGACY_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: LEGACY_SUPABASE_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  return { response, payload };
}

async function legacyRecordKey(table, row) {
  if (row?.id) return String(row.id);
  if (table === 'appointment_babies') return `${row?.appointment_id || ''}|${row?.baby_id || ''}`;
  if (table === 'clinical_encounter_babies') return `${row?.encounter_id || ''}|${row?.baby_id || ''}`;
  if (table === 'consents') return `${row?.owner_id || ''}|${row?.mother_id || ''}|${row?.consent_type || ''}`;
  return sha256(`${table}|${JSON.stringify(row || {})}`);
}

async function legacyClinicalTableRows(table, accessToken) {
  const response = await fetch(`${LEGACY_SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?select=*`, {
    headers: {
      apikey: LEGACY_SUPABASE_KEY,
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`legacy_table_sync_failed:${table}:${response.status}`);
  const payload = await response.json().catch(() => []);
  return Array.isArray(payload) ? payload : [];
}

async function needsLegacyClinicalRepair(env, userId) {
  if (!env.CLINICAL_DB || !userId) return false;
  const row = await env.CLINICAL_DB.prepare(
    "SELECT COUNT(*) AS n FROM supabase_records WHERE table_name = 'mothers' AND owner_id = ?",
  ).bind(userId).first();
  return Number(row?.n || 0) === 0;
}

export async function syncLegacyClinicalRows(env, accessToken, userId) {
  if (!env.CLINICAL_DB || !accessToken || !userId) return { synced: 0, failures: [] };
  let synced = 0;
  const failures = [];

  for (const table of LEGACY_CLINICAL_TABLES) {
    let rows = [];
    try {
      rows = await legacyClinicalTableRows(table, accessToken);
    } catch (error) {
      failures.push({ table, error: error?.message || String(error) });
      continue;
    }

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (row.owner_id && String(row.owner_id) !== String(userId)) continue;
      const now = new Date().toISOString();
      const key = await legacyRecordKey(table, row);
      await env.CLINICAL_DB.prepare(`INSERT INTO supabase_records(
        table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
      ) VALUES(?,?,?,?,?,?,?) ON CONFLICT(table_name,record_key) DO NOTHING`).bind(
        table,
        key,
        row.owner_id || null,
        JSON.stringify(row),
        row.created_at || now,
        row.updated_at || now,
        now,
      ).run();
      synced++;
    }
  }

  return { synced, failures };
}

async function repairLegacyClinicalRowsIfNeeded(env, email, password, userId, existingLegacy = null) {
  if (!await needsLegacyClinicalRepair(env, userId)) return;
  const legacy = existingLegacy || await legacyPasswordLogin(email, password);
  if (!legacy?.response?.ok || !legacy?.payload?.access_token || String(legacy?.payload?.user?.id || '') !== String(userId)) return;
  const result = await syncLegacyClinicalRows(env, legacy.payload.access_token, userId);
  if (result.failures.length) console.warn('legacy clinical repair completed with partial failures', result.failures);
}

async function upsertLegacyUser(env, legacyUser) {
  const now = new Date().toISOString();
  await env.CLINICAL_DB.prepare(`INSERT INTO auth_users(
    user_id,email,phone,email_confirmed_at,phone_confirmed_at,created_at,updated_at,last_sign_in_at,
    user_metadata_json,app_metadata_json,password_reset_required,migrated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)
  ON CONFLICT(user_id) DO UPDATE SET
    email=excluded.email,phone=excluded.phone,email_confirmed_at=excluded.email_confirmed_at,
    phone_confirmed_at=excluded.phone_confirmed_at,updated_at=excluded.updated_at,
    last_sign_in_at=excluded.last_sign_in_at,user_metadata_json=excluded.user_metadata_json,
    app_metadata_json=excluded.app_metadata_json,migrated_at=excluded.migrated_at`).bind(
      legacyUser.id,
      legacyUser.email || null,
      legacyUser.phone || null,
      legacyUser.email_confirmed_at || null,
      legacyUser.phone_confirmed_at || null,
      legacyUser.created_at || now,
      legacyUser.updated_at || now,
      legacyUser.last_sign_in_at || now,
      JSON.stringify(legacyUser.user_metadata || {}),
      JSON.stringify(legacyUser.app_metadata || {}),
      now,
    ).run();
  return env.CLINICAL_DB.prepare('SELECT * FROM auth_users WHERE user_id = ? LIMIT 1').bind(legacyUser.id).first();
}

async function storeCredential(env, userId, password) {
  const salt = randomToken(18);
  const hash = await cloudflarePasswordHash(password, salt, CLOUDFLARE_PBKDF2_ITERATIONS);
  await env.CLINICAL_DB.prepare(`INSERT INTO auth_credentials(user_id,password_salt,password_hash,password_iterations,password_algorithm,created_at,updated_at)
    VALUES(?,?,?,?, 'PBKDF2-SHA256',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      password_salt=excluded.password_salt,password_hash=excluded.password_hash,
      password_iterations=excluded.password_iterations,password_algorithm=excluded.password_algorithm,
      updated_at=CURRENT_TIMESTAMP`).bind(
        userId,
        salt,
        hash,
        CLOUDFLARE_PBKDF2_ITERATIONS,
      ).run();
  await env.CLINICAL_DB.prepare('UPDATE auth_users SET password_reset_required = 0, updated_at = ? WHERE user_id = ?')
    .bind(new Date().toISOString(), userId).run();
}

async function verifyStoredCredential(env, userId, password) {
  const row = await env.CLINICAL_DB.prepare('SELECT * FROM auth_credentials WHERE user_id = ? LIMIT 1').bind(userId).first();
  if (!row) return false;
  const iterations = Number(row.password_iterations || 0);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > CLOUDFLARE_PBKDF2_ITERATIONS) {
    return false;
  }
  const actual = await cloudflarePasswordHash(password, row.password_salt, iterations);
  return safeEqual(actual, row.password_hash);
}

export async function handleCloudflarePasswordCompat(request, env, url = new URL(request.url)) {
  if (!env.CLINICAL_DB) return null;
  if (url.pathname !== '/auth/v1/token' || request.method !== 'POST' || url.searchParams.get('grant_type') !== 'password') {
    return null;
  }

  try {
    const input = await request.json().catch(() => null);
    const email = String(input?.email || '').trim().toLowerCase();
    const password = String(input?.password || '');
    if (!email || !password) return json(400, { message: 'Informe e-mail e senha.' });

    let row = await env.CLINICAL_DB.prepare('SELECT * FROM auth_users WHERE lower(email) = lower(?) LIMIT 1').bind(email).first();
    if (row && await verifyStoredCredential(env, row.user_id, password)) {
      await repairLegacyClinicalRowsIfNeeded(env, email, password, row.user_id).catch((error) => {
        console.warn('legacy clinical repair failed without blocking local login', error);
      });
      const now = new Date().toISOString();
      await env.CLINICAL_DB.prepare('UPDATE auth_users SET last_sign_in_at = ?, updated_at = ? WHERE user_id = ?').bind(now, now, row.user_id).run();
      row = { ...row, last_sign_in_at: now, updated_at: now };
      return json(200, await issueSession(env, publicUser(row)));
    }

    const legacy = await legacyPasswordLogin(email, password);
    if (!legacy.response.ok || !legacy.payload?.user?.id) {
      return json(400, {
        message: legacy.payload?.msg || legacy.payload?.error_description || 'E-mail ou senha inválidos.',
      });
    }

    row = await upsertLegacyUser(env, legacy.payload.user);
    await storeCredential(env, row.user_id, password);
    await repairLegacyClinicalRowsIfNeeded(env, email, password, row.user_id, legacy).catch((error) => {
      console.warn('legacy clinical repair failed without blocking migrated login', error);
    });
    const migrated = publicUser(await env.CLINICAL_DB.prepare('SELECT * FROM auth_users WHERE user_id = ? LIMIT 1').bind(row.user_id).first());
    return json(200, await issueSession(env, migrated));
  } catch (error) {
    console.error('cloudflare password compat error', error);
    return json(500, { error: error?.message || 'cloudflare_password_compat_error' });
  }
}
