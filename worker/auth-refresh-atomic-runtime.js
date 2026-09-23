import { runtimeUserById } from './cloudflare-auth-runtime.js';

const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const enc = new TextEncoder();

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function b64urlBytes(bytes) {
  let binary = '';
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const value of data) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlText(value) {
  return b64urlBytes(enc.encode(String(value)));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function signAccessToken(user, env) {
  if (!env.CLINICAL_AUTH_SECRET) throw new Error('clinical_auth_secret_missing');
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64urlText(JSON.stringify({
    typ: 'access',
    sub: user.id,
    email: user.email || '',
    iat: now,
    exp: now + ACCESS_TTL_SECONDS,
  }));
  const data = `${header}.${body}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(env.CLINICAL_AUTH_SECRET), enc.encode(data));
  return `${data}.${b64urlBytes(signature)}`;
}

function randomToken(bytes = 40) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return b64urlBytes(data);
}

async function sha256(value) {
  return b64urlBytes(await crypto.subtle.digest('SHA-256', enc.encode(String(value || ''))));
}

function isTarget(request, url) {
  return request.method === 'POST'
    && url.pathname === '/api/auth/token'
    && url.searchParams.get('grant_type') === 'refresh_token';
}

export async function handleAtomicAuthRefresh(request, env, url = new URL(request.url)) {
  if (!isTarget(request, url)) return null;
  if (!env.CLINICAL_DB) return json(503, { error: 'cloudflare_d1_required' });

  const input = await request.clone().json().catch(() => null);
  const refreshToken = String(input?.refresh_token || '');
  if (!refreshToken) return json(400, { message: 'Refresh token ausente.' });

  const db = env.CLINICAL_DB;
  const tokenHash = await sha256(refreshToken);
  const now = new Date().toISOString();
  const row = await db.prepare(`SELECT user_id FROM auth_refresh_sessions
    WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1`)
    .bind(tokenHash, now)
    .first();
  if (!row?.user_id) return json(401, { message: 'Sessão expirada. Entre novamente.' });

  const user = await runtimeUserById(env, row.user_id);
  if (!user) return json(401, { message: 'Sessão inválida.' });

  // Prepare the replacement before consuming the old token. Only the request that
  // atomically flips revoked_at from NULL is allowed to publish this replacement.
  const nextRefreshToken = randomToken();
  const nextRefreshHash = await sha256(nextRefreshToken);
  const accessToken = await signAccessToken(user, env);
  const nextExpiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString();

  const claimed = await db.prepare(`UPDATE auth_refresh_sessions
    SET revoked_at = ?, last_used_at = ?
    WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`)
    .bind(now, now, tokenHash, now)
    .run();
  if (Number(claimed?.meta?.changes || 0) !== 1) {
    return json(401, { message: 'Sessão já atualizada em outra aba.' });
  }

  try {
    await db.prepare(`INSERT INTO auth_refresh_sessions(token_hash,user_id,expires_at,created_at,last_used_at,revoked_at)
      VALUES(?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,NULL)`)
      .bind(nextRefreshHash, user.id, nextExpiresAt)
      .run();
  } catch (error) {
    console.error('atomic refresh replacement failed', error);
    return json(503, { message: 'Não foi possível atualizar a sessão. Entre novamente se o problema persistir.' });
  }

  return json(200, {
    access_token: accessToken,
    refresh_token: nextRefreshToken,
    token_type: 'bearer',
    expires_in: ACCESS_TTL_SECONDS,
    user,
  });
}
