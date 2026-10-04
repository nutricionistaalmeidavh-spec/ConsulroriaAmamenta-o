import {
  CLOUDFLARE_PBKDF2_ITERATIONS,
  cloudflarePasswordHash,
} from './cloudflare-auth-compat.js';

function b64urlBytes(bytes) {
  let binary = '';
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const value of data) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(bytes = 18) {
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

function parseJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

export async function activateManualFirstAccessCredentials(env, {
  existing = null,
  pending = null,
  email,
  password,
  metadata = {},
} = {}) {
  if (!env.CLINICAL_DB) throw new Error('clinical_db_not_configured');
  const existingId = existing?.user_id || null;
  const pendingId = pending?.user_id || null;
  if (existingId && pendingId && existingId !== pendingId) return null;

  const userId = existingId || pendingId || crypto.randomUUID();
  const now = new Date().toISOString();
  const salt = randomToken(18);
  const hash = await cloudflarePasswordHash(password, salt, CLOUDFLARE_PBKDF2_ITERATIONS);
  const userMetadata = JSON.stringify({
    ...parseJson(existing?.user_metadata_json),
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
    signup_source: 'manual_license',
  });
  const appMetadata = JSON.stringify({
    ...parseJson(existing?.app_metadata_json),
    auth_backend: 'cloudflare-d1',
    commercial_account: true,
    manual_license: true,
    activation_source: 'manual_grant_first_access',
    mailbox_claim_required: false,
  });
  const db = env.CLINICAL_DB;

  await db.batch([
    db.prepare(`INSERT INTO auth_users(
      user_id,email,phone,email_confirmed_at,phone_confirmed_at,created_at,updated_at,last_sign_in_at,
      user_metadata_json,app_metadata_json,password_reset_required,migrated_at
    ) VALUES(?,?,NULL,?,NULL,?,?,NULL,?,?,0,?) ON CONFLICT DO NOTHING`)
      .bind(userId, email, now, now, now, userMetadata, appMetadata, now),
    db.prepare(`UPDATE auth_users SET
      email_confirmed_at=COALESCE(email_confirmed_at,?),updated_at=?,user_metadata_json=?,app_metadata_json=?,
      password_reset_required=0,migrated_at=COALESCE(migrated_at,?)
      WHERE user_id=? AND lower(email)=lower(?) AND password_reset_required=1
        AND NOT EXISTS (SELECT 1 FROM auth_credentials WHERE user_id=?)`)
      .bind(now, now, userMetadata, appMetadata, now, userId, email, userId),
    db.prepare(`INSERT INTO auth_credentials(
      user_id,password_salt,password_hash,password_iterations,password_algorithm,created_at,updated_at
    ) SELECT ?,?,?,?,'PBKDF2-SHA256',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
      WHERE EXISTS (
        SELECT 1 FROM auth_users WHERE user_id=? AND lower(email)=lower(?) AND password_reset_required=0
      ) AND NOT EXISTS (SELECT 1 FROM auth_credentials WHERE user_id=?)`)
      .bind(userId, salt, hash, CLOUDFLARE_PBKDF2_ITERATIONS, userId, email, userId),
    db.prepare('UPDATE auth_refresh_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL')
      .bind(now, userId),
    db.prepare('DELETE FROM auth_recovery_tokens WHERE user_id=?').bind(userId),
    db.prepare('DELETE FROM billing_signup_recovery_tokens WHERE user_id=?').bind(userId),
  ]);

  const row = await db.prepare('SELECT * FROM auth_users WHERE lower(email)=lower(?) LIMIT 1').bind(email).first();
  if (!row || row.user_id !== userId || Boolean(Number(row.password_reset_required || 0))) return null;
  const credential = await db.prepare('SELECT * FROM auth_credentials WHERE user_id=? LIMIT 1').bind(userId).first();
  if (!credential) return null;
  const actual = await cloudflarePasswordHash(password, credential.password_salt, Number(credential.password_iterations || CLOUDFLARE_PBKDF2_ITERATIONS));
  if (!safeEqual(actual, credential.password_hash)) return null;
  return { userId, row };
}
