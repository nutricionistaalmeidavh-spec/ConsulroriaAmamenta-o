import {
  CLOUDFLARE_PBKDF2_ITERATIONS,
  cloudflarePasswordHash,
} from './cloudflare-auth-compat.js';
import { isDirectManualDeboraGrant, reservePregrantedIdentity, resolvePregrantedAccess } from './signup-identity.js';
import { sendBestEffortTransactionalEmail, sendTransactionalEmail } from './transactional-email.js';

const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const enc = new TextEncoder();
const dec = new TextDecoder();
const PARTNER_ADMIN_PATHS = new Set([
  '/api/admin/partners',
  '/api/admin/partner-sales',
  '/api/admin/partner-commission',
]);

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

function internalPartnerAdmin(request, env) {
  let pathname = '';
  try { pathname = new URL(request.url).pathname; } catch {}
  if (!PARTNER_ADMIN_PATHS.has(pathname)) return null;
  const expected = String(env.DEBORA_PARTNER_ADMIN_SECRET || env.DEBORA_OBSERVABILITY_SECRET || '').trim();
  const provided = String(request.headers.get('x-debora-partner-admin-secret') || '').trim();
  if (!expected || !provided || !safeEqual(provided, expected)) return null;
  return {
    id: 'artisys-central',
    email: 'artisys-central@internal',
    phone: null,
    email_confirmed_at: null,
    phone_confirmed_at: null,
    created_at: null,
    updated_at: null,
    last_sign_in_at: null,
    user_metadata: { service_identity: 'artisys-central' },
    app_metadata: { partner_admin: true, service_identity: 'artisys-central' },
  };
}

export async function authenticateClinicalRequest(request, env) {
  const internal = internalPartnerAdmin(request, env);
  return internal || authenticateRuntimeToken(bearer(request), env);
}

async function handlePasswordLogin(request, env) {
  const input = await request.json().catch(() => null);
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');
  if (!email || !password) return json(400, { message: 'Informe e-mail e senha.' });

  const row = await userRowByEmail(env, email);
  if (!row) return json(400, { message: 'E-mail ou senha inválidos.' });
  if (Boolean(Number(row.password_reset_required || 0))) {
    return json(403, {
      error: 'password_reset_required',
      message: 'Esta conta precisa definir uma senha no novo acesso. Use “Esqueci minha senha”.',
    });
  }
  if (!(await verifyLocalPassword(env, row.user_id, password))) {
    const credential = await requireDb(env)
      .prepare('SELECT * FROM auth_credentials WHERE user_id = ? LIMIT 1')
      .bind(row.user_id)
      .first();
    if (!credential) {
      return json(403, {
        error: 'password_reset_required',
        message: 'Esta conta precisa definir uma senha no novo acesso. Use “Esqueci minha senha”.',
      });
    }
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

async function completeManualFirstAccess(env, existing, password) {
  const database = requireDb(env);
  const now = new Date().toISOString();
  const salt = randomToken(18);
  const hash = await cloudflarePasswordHash(password, salt, CLOUDFLARE_PBKDF2_ITERATIONS);
  let appMetadata = {};
  try { appMetadata = JSON.parse(existing.app_metadata_json || '{}'); } catch {}
  appMetadata = {
    ...appMetadata,
    auth_backend: 'cloudflare-d1',
    commercial_account: true,
    mailbox_claim_required: false,
    manual_license_first_access: true,
  };
  const results = await database.batch([
    database.prepare(`INSERT INTO auth_credentials(
      user_id,password_salt,password_hash,password_iterations,password_algorithm,created_at,updated_at
    ) SELECT user_id,?,?,?,'PBKDF2-SHA256',?,? FROM auth_users
      WHERE user_id=? AND password_reset_required=1
      ON CONFLICT(user_id) DO UPDATE SET password_salt=excluded.password_salt,password_hash=excluded.password_hash,
      password_iterations=excluded.password_iterations,password_algorithm=excluded.password_algorithm,updated_at=excluded.updated_at`)
      .bind(salt,hash,CLOUDFLARE_PBKDF2_ITERATIONS,now,now,existing.user_id),
    database.prepare(`UPDATE auth_users SET password_reset_required=0,email_confirmed_at=COALESCE(email_confirmed_at,?),
      updated_at=?,app_metadata_json=? WHERE user_id=? AND password_reset_required=1`)
      .bind(now,now,JSON.stringify(appMetadata),existing.user_id),
  ]);
  if (!results[0].meta.changes || !results[1].meta.changes) return null;
  return runtimeUserById(env, existing.user_id);
}

async function handleSignup(request, env) {
  const input = await request.json().catch(() => null);
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 256) {
    return json(400, { message: 'Informe um e-mail válido e senha com pelo menos 8 caracteres.' });
  }

  const existing = await userRowByEmail(env, email);
  if (existing) {
    const needsReset = Boolean(Number(existing.password_reset_required || 0));
    if (!needsReset) return json(400, { message: 'Este e-mail já possui cadastro. Use Entrar.' });

    const pending = await requireDb(env).prepare('SELECT * FROM billing_pending_signups WHERE lower(email)=lower(?) LIMIT 1').bind(email).first();
    if (!pending?.payment_confirmed_at) {
      const access = await resolvePregrantedAccess(env, email);
      if (isDirectManualDeboraGrant(access)) {
        const user = await completeManualFirstAccess(env, existing, password);
        if (!user) return json(409, {error:'signup_credentials_changed',message:'O acesso foi alterado durante o cadastro. Tente novamente.'});
        await sendBestEffortTransactionalEmail(env, {
          kind: 'welcome', to: user.email, data: { appUrl: env.AUTH_RECOVERY_ORIGIN || 'https://app.deboralactacao.com' },
        });
        return json(200, await issueSession(env, user));
      }
    }
    return json(403, {
      error: 'password_reset_required',
      message: 'Conta importada. Use “Esqueci minha senha” para definir sua senha no novo acesso.',
    });
  }

  const pending = await requireDb(env).prepare('SELECT * FROM billing_pending_signups WHERE lower(email)=lower(?) LIMIT 1').bind(email).first();
  const userId = pending?.user_id || crypto.randomUUID();
  let resolvedAccess = null;
  let manualFirstAccess = false;

  // A payment-confirmed Asaas identity keeps the password chosen during checkout.
  // A manual six-month grant instead lets the user choose a password directly on
  // the first-access form, even if an older unpaid checkout exists for the e-mail.
  if (!pending?.payment_confirmed_at) {
    resolvedAccess = await resolvePregrantedAccess(env, email);
    manualFirstAccess = isDirectManualDeboraGrant(resolvedAccess);
    if (!manualFirstAccess && resolvedAccess) {
      const claim = await reservePregrantedIdentity(env, email, userId, resolvedAccess);
      if (claim) {
        const recoveryRequest = new Request(new URL('/api/auth/recovery', request.url), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        return handleRecovery(recoveryRequest, env);
      }
    }
  }
  if (pending && !manualFirstAccess) {
    const proof = await cloudflarePasswordHash(password, pending.password_salt, Number(pending.password_iterations || CLOUDFLARE_PBKDF2_ITERATIONS));
    if (!safeEqual(proof, pending.password_hash)) return json(400, {error:'signup_credentials_invalid',message:'Cadastro pendente. Informe a senha original ou use “Esqueci minha senha”.'});
  }
  const now = new Date().toISOString();
  const salt = randomToken(18);
  const hash = await cloudflarePasswordHash(password, salt, CLOUDFLARE_PBKDF2_ITERATIONS);
  const userMetadata = JSON.stringify(input?.data && typeof input.data === 'object' ? input.data : {});
  const appMetadata = JSON.stringify({
    auth_backend: 'cloudflare-d1',
    commercial_account: true,
    ...(manualFirstAccess ? { manual_license_first_access: true, license_source: resolvedAccess?.source || 'mercado_livre_manual' } : {}),
  });
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

  if (pending && !manualFirstAccess) {
    // Recheck the credential version inside the transaction: a recovery may
    // have changed it since the password proof above was evaluated.
    statements[0] = database.prepare(`INSERT INTO auth_users(
      user_id,email,phone,email_confirmed_at,phone_confirmed_at,created_at,updated_at,last_sign_in_at,
      user_metadata_json,app_metadata_json,password_reset_required,migrated_at
    ) SELECT user_id,email,NULL,NULL,NULL,?,?,NULL,?,?,0,? FROM billing_pending_signups
      WHERE user_id=? AND password_hash=?`)
      .bind(now,now,userMetadata,appMetadata,now,userId,pending.password_hash);
    statements[1] = database.prepare(`INSERT INTO auth_credentials(
      user_id,password_salt,password_hash,password_iterations,password_algorithm,created_at,updated_at
    ) SELECT p.user_id,p.password_salt,p.password_hash,p.password_iterations,'PBKDF2-SHA256',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
      FROM billing_pending_signups p JOIN auth_users u ON u.user_id=p.user_id
      WHERE p.user_id=? AND p.password_hash=?`)
      .bind(userId,pending.password_hash);
  }
  const created = await database.batch(statements);
  if (!created[0].meta.changes || !created[1].meta.changes) {
    return json(409, {error:'signup_credentials_changed',message:'A senha foi alterada. Tente novamente com sua nova senha.'});
  }

  const user = await runtimeUserById(env, userId);
  if (!user) return json(409, {error:'signup_credentials_changed',message:'A senha foi alterada. Tente novamente com sua nova senha.'});
  await sendBestEffortTransactionalEmail(env, {
    kind: 'welcome', to: user.email, data: { appUrl: env.AUTH_RECOVERY_ORIGIN || 'https://app.deboralactacao.com' },
  });
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

const RECOVERY_ACCEPTED = {
  message: 'Solicitação processada. Se a conta existir e a entrega estiver disponível, você receberá as instruções.',
};

async function handleRecovery(request, env) {
  let origin;
  try { origin = new URL(env.AUTH_RECOVERY_ORIGIN); } catch {}
  const deliveryConfigured = env.EMAIL?.send || env.AUTH_RECOVERY_DELIVERY?.fetch || env.TRANSACTIONAL_EMAIL_DELIVERY?.fetch
    || (String(env.RESEND_API_KEY || '').trim() && String(env.TRANSACTIONAL_EMAIL_FROM || '').trim());
  if (!deliveryConfigured || origin?.protocol !== 'https:') {
    return json(503, {
      error: 'recovery_delivery_unavailable',
      message: 'Recuperação por e-mail indisponível no momento. Entre em contato com o suporte.',
    });
  }
  const input = await request.json().catch(() => null);
  const email = String(input?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json(400, { message: 'Informe um e-mail válido.' });
  }
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const pending = await requireDb(env).prepare('SELECT * FROM billing_pending_signups WHERE lower(email)=lower(?) LIMIT 1').bind(email).first();
  const row = pending || await userRowByEmail(env, email);
  const recoveryTable = pending ? 'billing_signup_recovery_tokens' : 'auth_recovery_tokens';
  if (row) {
    const db = requireDb(env);
    const now = new Date().toISOString();
    const result = await db.prepare(`INSERT INTO ${recoveryTable}(token_hash,user_id,expires_at,created_at)
      VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
      token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=excluded.created_at
      WHERE ${recoveryTable}.created_at < ?`)
      .bind(
        tokenHash,
        row.user_id,
        new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        now,
        new Date(Date.now() - 60 * 1000).toISOString(),
      ).run();
    if (result.meta.changes) {
      const link = new URL('/comercial/index.html?recovery=1', origin.origin);
      link.hash = `recovery_token=${token}`;
      try {
        await sendTransactionalEmail(env, {
          kind: 'password_recovery', to: row.email, data: { recoveryUrl: link.href, expiresInSeconds: 1800 },
        });
      } catch {
        console.error('auth_recovery_delivery_failed');
        await db.prepare(`DELETE FROM ${recoveryTable} WHERE token_hash = ?`).bind(tokenHash).run();
        return json(503, {error:'recovery_delivery_unavailable',message:'Recuperação por e-mail indisponível no momento. Entre em contato com o suporte.'});
      }
    }
  }
  return json(202, RECOVERY_ACCEPTED);
}

async function handleResetPassword(request, env) {
  const input = await request.json().catch(() => null);
  const token = String(input?.token || '');
  const password = String(input?.password || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || password.length < 8 || password.length > 256) {
    return json(400, { message: 'Link inválido ou senha fora dos limites de 8 a 256 caracteres.' });
  }
  const db = requireDb(env);
  const tokenHash = await sha256(token);
  const salt = randomToken(18);
  const hash = await cloudflarePasswordHash(password, salt, CLOUDFLARE_PBKDF2_ITERATIONS);
  const now = new Date().toISOString();

  // Every write checks the token inside the same D1 transaction. Do not read/claim
  // it outside the batch: concurrent resets must not reuse a stale user_id, and a
  // failed credential write must leave the link available for retry.
  const results = await db.batch([
    db.prepare(`UPDATE billing_pending_signups SET password_salt=?,password_hash=?,password_iterations=?,signup_nonce_hash=?,updated_at=?
      WHERE user_id IN (SELECT user_id FROM billing_signup_recovery_tokens WHERE token_hash=? AND expires_at>?)`)
      .bind(salt,hash,CLOUDFLARE_PBKDF2_ITERATIONS,await sha256(randomToken(32)),now,tokenHash,now),
    db.prepare(`INSERT INTO auth_credentials(user_id,password_salt,password_hash,password_iterations,password_algorithm,created_at,updated_at)
      SELECT t.user_id,?,?,?,'PBKDF2-SHA256',?,? FROM billing_signup_recovery_tokens t
      JOIN auth_users u ON u.user_id=t.user_id WHERE t.token_hash=? AND t.expires_at>?
      ON CONFLICT(user_id) DO UPDATE SET password_salt=excluded.password_salt,password_hash=excluded.password_hash,
      password_iterations=excluded.password_iterations,password_algorithm=excluded.password_algorithm,updated_at=excluded.updated_at`)
      .bind(salt,hash,CLOUDFLARE_PBKDF2_ITERATIONS,now,now,tokenHash,now),
    db.prepare(`UPDATE auth_refresh_sessions SET revoked_at=? WHERE user_id IN
      (SELECT user_id FROM billing_signup_recovery_tokens WHERE token_hash=? AND expires_at>?)`).bind(now,tokenHash,now),
    db.prepare(`UPDATE auth_users SET password_reset_required=0,email_confirmed_at=?,updated_at=? WHERE user_id IN
      (SELECT user_id FROM billing_signup_recovery_tokens WHERE token_hash=? AND expires_at>?)`).bind(now,now,tokenHash,now),
    db.prepare(`INSERT INTO auth_credentials(user_id,password_salt,password_hash,password_iterations,password_algorithm,created_at,updated_at)
      SELECT user_id,?,?,?, 'PBKDF2-SHA256',?,? FROM auth_recovery_tokens
      WHERE token_hash = ? AND expires_at > ?
      ON CONFLICT(user_id) DO UPDATE SET password_salt=excluded.password_salt,password_hash=excluded.password_hash,
      password_iterations=excluded.password_iterations,password_algorithm=excluded.password_algorithm,updated_at=excluded.updated_at`)
      .bind(salt,hash,CLOUDFLARE_PBKDF2_ITERATIONS,now,now,tokenHash,now),
    db.prepare(`UPDATE auth_refresh_sessions SET revoked_at=? WHERE user_id IN
      (SELECT user_id FROM auth_recovery_tokens WHERE token_hash=? AND expires_at>?)`)
      .bind(now,tokenHash,now),
    db.prepare(`UPDATE auth_users SET password_reset_required=0,updated_at=?,email_confirmed_at=? WHERE user_id IN
      (SELECT user_id FROM auth_recovery_tokens WHERE token_hash=? AND expires_at>?)`)
      .bind(now,now,tokenHash,now),
    db.prepare('DELETE FROM auth_recovery_tokens WHERE token_hash=? AND expires_at>?')
      .bind(tokenHash,now),
    db.prepare('DELETE FROM billing_signup_recovery_tokens WHERE token_hash=? AND expires_at>?').bind(tokenHash,now),
  ]);
  if (!results[7].meta.changes && !results[8].meta.changes) {
    return json(400, { message: 'Link inválido ou expirado. Solicite uma nova recuperação.' });
  }
  return json(200, { message: 'Senha atualizada. Entre novamente com sua nova senha.' });
}

export async function handleCloudflareAuthRuntime(request, env, url = new URL(request.url)) {
  if (!url.pathname.startsWith('/api/auth/')) return null;
  if (!env.CLINICAL_DB) return json(503, { error: 'cloudflare_auth_required' });

  try {
    if (url.pathname === '/api/auth/recovery' && request.method === 'POST') return await handleRecovery(request, env);
    if (url.pathname === '/api/auth/reset-password' && request.method === 'POST') return await handleResetPassword(request, env);
    if (url.pathname === '/api/auth/token' && request.method === 'POST') {
      const grant = url.searchParams.get('grant_type') || '';
      if (grant === 'password') return await handlePasswordLogin(request, env);
      if (grant === 'refresh_token') return await handleRefresh(request, env);
      return json(400, { message: 'Grant type não suportado.' });
    }
    if (url.pathname === '/api/auth/signup' && request.method === 'POST') return await handleSignup(request, env);
    if (url.pathname === '/api/auth/user' && request.method === 'GET') {
      const user = await authenticateClinicalRequest(request, env);
      return user ? json(200, user) : json(401, { message: 'Sessão inválida.' });
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return await handleLogout(request, env);
    return json(404, { message: 'Auth endpoint não encontrado.' });
  } catch (error) {
    console.error('cloudflare auth runtime error', error);
    return json(503, { error: 'cloudflare_auth_unavailable' });
  }
}
