import {
  CLOUDFLARE_PBKDF2_ITERATIONS,
  cloudflarePasswordHash,
} from './cloudflare-auth-compat.js';

const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const enc = new TextEncoder();
const dec = new TextDecoder();

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function requireDb(env) {
  if (!env.CLINICAL_DB) throw new Error('clinical_db_not_configured');
  return env.CLINICAL_DB;
}

function bearer(request) {
  const value = request.headers.get('authorization') || '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function b64urlBytes(bytes) {
  let binary = '';
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const value of data) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesFromB64url(value) {
  let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

function b64urlText(value) {
  return b64urlBytes(enc.encode(String(value)));
}

function decodeB64urlText(value) {
  return dec.decode(bytesFromB64url(value));
}

async function sha256(value) {
  return b64urlBytes(await crypto.subtle.digest('SHA-256', enc.encode(String(value || ''))));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
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
      'HMAC',
      await hmacKey(env.CLINICAL_AUTH_SECRET),
      bytesFromB64url(parts[2]),
      enc.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const payload = JSON.parse(decodeB64urlText(parts[1]));
    if (payload.typ !== expectedType || Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return b64urlBytes(data);
}

function safeEqual(left, right) {
  const x = String(left || '');
  const y = String(right || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let index = 0; index < x.length; index += 1) diff |= x.charCodeAt(index) ^ y.charCodeAt(index);
  return diff === 0;
}

function publicUser(row) {
  if (!row) return null;
  let userMetadata = {};
  let appMetadata = {};
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
  const row = await env.CLINICAL_DB
    .prepare('SELECT * FROM auth_users WHERE user_id = ? LIMIT 1')
    .bind(userId)
    .first();
  return publicUser(row);
}

async function userRowByEmail(env, email) {
  if (!env.CLINICAL_DB || !email) return null;
  return env.CLINICAL_DB
    .prepare('SELECT * FROM auth_users WHERE lower(email) = lower(?) LIMIT 1')
    .bind(String(email).trim())
    .first();
}

async function verifyLocalPassword(env, userId, password) {
  const credential = await requireDb(env)
    .prepare('SELECT * FROM auth_credentials WHERE user_id = ? LIMIT 1')
    .bind(userId)
    .first();
  if (!credential) return false;
  const iterations = Number(credential.password_iterations || CLOUDFLARE_PBKDF2_ITERATIONS);
  const actual = await cloudflarePasswordHash(password, credential.password_salt, iterations);
  return safeEqual(actual, credential.password_hash);
}

async function issueSession(env, user) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await signToken({
    typ: 'access',
    sub: user.id,
    email: user.email || '',
    iat: now,
    exp: now + ACCESS_TTL_SECONDS,
  }, env);
  const refreshToken = randomToken(40);
  const refreshHash = await sha256(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString();
  await requireDb(env)
    .prepare(`INSERT INTO auth_refresh_sessions(token_hash,user_id,expires_at,created_at,last_used_at,revoked_at)
      VALUES(?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,NULL)`)
    .bind(refreshHash, user.id, expiresAt)
    .run();
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: ACCESS_TTL_SECONDS,
    user,
  };
}

export async function authenticateRuntimeToken(token, env) {
  if (!token || !env.CLINICAL_DB) return null;
  const payload = await verifyToken(token, env, 'access');
  return payload?.sub ? runtimeUserById(env, payload.sub) : null;
}

export async function authenticateClinicalRequest(request, env) {
  return authenticateRuntimeToken(bearer(request), env);
}

async function handlePasswordLogin(request, env) {
  const input = await request.json().catch(() => null);
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');
  if (!email || !password) return json(400, { message: 'Informe e-mail e senha.' });

  const row = await userRowByEmail(env, email);
  if (!row || !(await verifyLocalPassword(env, row.user_id, password))) {
    return json(400, { message: 'E-mail ou senha inválidos.' });
  }

  const now = new Date().toISOString();
  await requireDb(env)
    .prepare('UPDATE auth_users SET last_sign_in_at = ?, updated_at = ? WHERE user_id = ?')
    .bind(now, now, row.user_id)
    .run();
  const user = publicUser({ ...row, last_sign_in_at: now, updated_at: now });
  return json(200, await issueSession(env, user));
}

async function handleRefresh(request, env) {
  const input = await request.json().catch(() => null);
  const refreshToken = String(input?.refresh_token || '');
  if (!refreshToken) return json(400, { message: 'Refresh token ausente.' });

  const tokenHash = await sha256(refreshToken);
  const row = await requireDb(env)
    .prepare(`SELECT * FROM auth_refresh_sessions
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1`)
    .bind(tokenHash, new Date().toISOString())
    .first();
  if (!row?.user_id) return json(401, { message: 'Sessão expirada. Entre novamente.' });

  const now = new Date().toISOString();
  await requireDb(env)
    .prepare('UPDATE auth_refresh_sessions SET revoked_at = ?, last_used_at = ? WHERE token_hash = ?')
    .bind(now, now, tokenHash)
    .run();
  const user = await runtimeUserById(env, row.user_id);
  if (!user) return json(401, { message: 'Sessão inválida.' });
  return json(200, await issueSession(env, user));
}

async function handleSignup(request, env) {
  const input = await request.json().catch(() => null);
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 256) {
    return json(400, { message: 'Informe um e-mail válido e senha com pelo menos 8 caracteres.' });
  }
  if (await userRowByEmail(env, email)) {
    return json(400, { message: 'Este e-mail já possui cadastro. Use Entrar.' });
  }

  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const salt = randomToken(18);
  const hash = await cloudflarePasswordHash(password, salt, CLOUDFLARE_PBKDF2_ITERATIONS);
  const userMetadata = JSON.stringify(input?.data && typeof input.data === 'object' ? input.data : {});
  const appMetadata = JSON.stringify({ auth_backend: 'cloudflare-d1' });
  const database = requireDb(env);

  const statements = [
    database.prepare(`INSERT INTO auth_users(
      user_id,email,phone,email_confirmed_at,phone_confirmed_at,created_at,updated_at,last_sign_in_at,
      user_metadata_json,app_metadata_json,password_reset_required,migrated_at
    ) VALUES(?,?,NULL,?,NULL,?,?,NULL,?,?,0,?)`)
      .bind(userId, email, now, now, now, userMetadata, appMetadata, now),
    database.prepare(`INSERT INTO auth_credentials(
      user_id,password_salt,password_hash,password_iterations,password_algorithm,created_at,updated_at
    ) VALUES(?,?,?,?, 'PBKDF2-SHA256',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
      .bind(userId, salt, hash, CLOUDFLARE_PBKDF2_ITERATIONS),
  ];

  if (typeof database.batch === 'function') {
    await database.batch(statements);
  } else {
    for (const statement of statements) await statement.run();
  }

  const user = await runtimeUserById(env, userId);
  return json(200, await issueSession(env, user));
}

async function handleLogout(request, env) {
  const user = await authenticateClinicalRequest(request, env);
  if (user?.id) {
    await requireDb(env)
      .prepare('UPDATE auth_refresh_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(new Date().toISOString(), user.id)
      .run();
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export async function handleCloudflareAuthRuntime(request, env, url = new URL(request.url)) {
  if (!url.pathname.startsWith('/auth/v1/')) return null;
  if (!env.CLINICAL_DB) return json(503, { error: 'cloudflare_auth_required' });

  try {
    if (url.pathname === '/auth/v1/token' && request.method === 'POST') {
      const grant = url.searchParams.get('grant_type') || '';
      if (grant === 'password') return handlePasswordLogin(request, env);
      if (grant === 'refresh_token') return handleRefresh(request, env);
      return json(400, { message: 'Grant type não suportado.' });
    }
    if (url.pathname === '/auth/v1/signup' && request.method === 'POST') return handleSignup(request, env);
    if (url.pathname === '/auth/v1/user' && request.method === 'GET') {
      const user = await authenticateClinicalRequest(request, env);
      return user ? json(200, user) : json(401, { message: 'Sessão inválida.' });
    }
    if (url.pathname === '/auth/v1/logout' && request.method === 'POST') return handleLogout(request, env);
    return json(404, { message: 'Auth endpoint não encontrado.' });
  } catch (error) {
    console.error('cloudflare auth runtime error', error);
    return json(500, { error: error?.message || 'cloudflare_auth_runtime_error' });
  }
}
