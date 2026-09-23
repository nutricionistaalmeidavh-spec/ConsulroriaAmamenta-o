import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCloudflareAuthRuntime } from './cloudflare-auth-runtime.js';
import { CLOUDFLARE_PBKDF2_ITERATIONS, cloudflarePasswordHash } from './cloudflare-auth-compat.js';

class FakeStatement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) { return new FakeStatement(this.db, this.sql, args); }

  async first() {
    const sql = this.sql;
    const args = this.args;
    if (/SELECT \* FROM auth_users WHERE lower\(email\) = lower\(\?\) LIMIT 1/i.test(sql)) {
      const email = String(args[0] || '').toLowerCase();
      return [...this.db.users.values()].find((row) => String(row.email || '').toLowerCase() === email) || null;
    }
    if (/SELECT \* FROM auth_users WHERE user_id = \? LIMIT 1/i.test(sql)) {
      return this.db.users.get(String(args[0])) || null;
    }
    if (/SELECT \* FROM auth_credentials WHERE user_id = \? LIMIT 1/i.test(sql)) {
      return this.db.credentials.get(String(args[0])) || null;
    }
    if (/SELECT \* FROM auth_refresh_sessions/i.test(sql)) {
      return this.db.refreshSessions.get(String(args[0])) || null;
    }
    throw new Error(`unexpected first SQL: ${sql}`);
  }

  async run() {
    const sql = this.sql;
    const args = this.args;
    if (/UPDATE auth_users SET last_sign_in_at = \?, updated_at = \? WHERE user_id = \?/i.test(sql)) {
      const row = this.db.users.get(String(args[2]));
      if (row) {
        row.last_sign_in_at = args[0];
        row.updated_at = args[1];
      }
      return { success: true };
    }
    if (/INSERT INTO auth_refresh_sessions/i.test(sql)) {
      const [tokenHash, userId, expiresAt] = args;
      this.db.refreshSessions.set(String(tokenHash), {
        token_hash: String(tokenHash),
        user_id: String(userId),
        expires_at: expiresAt,
        revoked_at: null,
      });
      return { success: true };
    }
    if (/UPDATE auth_refresh_sessions SET revoked_at = \?, last_used_at = \? WHERE token_hash = \?/i.test(sql)) {
      const row = this.db.refreshSessions.get(String(args[2]));
      if (row) row.revoked_at = args[0];
      return { success: true };
    }
    if (/UPDATE auth_refresh_sessions SET revoked_at = \? WHERE user_id = \? AND revoked_at IS NULL/i.test(sql)) {
      for (const row of this.db.refreshSessions.values()) {
        if (String(row.user_id) === String(args[1]) && !row.revoked_at) row.revoked_at = args[0];
      }
      return { success: true };
    }
    throw new Error(`unexpected run SQL: ${sql}`);
  }
}

class FakeD1 {
  constructor() {
    this.users = new Map();
    this.credentials = new Map();
    this.refreshSessions = new Map();
  }
  prepare(sql) { return new FakeStatement(this, sql); }
}

async function fixture() {
  const db = new FakeD1();
  const userId = '11111111-1111-4111-8111-111111111111';
  const salt = Buffer.from('debora-d1-only-login-salt').toString('base64url');
  const password = 'senha-segura-123';
  const hash = await cloudflarePasswordHash(password, salt, CLOUDFLARE_PBKDF2_ITERATIONS);
  db.users.set(userId, {
    user_id: userId,
    email: 'profissional@example.com',
    phone: null,
    email_confirmed_at: '2026-09-22T00:00:00.000Z',
    phone_confirmed_at: null,
    created_at: '2026-09-22T00:00:00.000Z',
    updated_at: '2026-09-22T00:00:00.000Z',
    last_sign_in_at: null,
    user_metadata_json: '{}',
    app_metadata_json: '{}',
    password_reset_required: 0,
  });
  db.credentials.set(userId, {
    user_id: userId,
    password_salt: salt,
    password_hash: hash,
    password_iterations: CLOUDFLARE_PBKDF2_ITERATIONS,
    password_algorithm: 'PBKDF2-SHA256',
  });
  return { db, password, userId };
}

function loginRequest(email, password) {
  return new Request('https://deboralactacao.com/api/auth/token?grant_type=password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

test('password login authenticates exclusively against D1 without any network fallback', async () => {
  const { db, password, userId } = await fixture();
  const env = { CLINICAL_DB: db, CLINICAL_AUTH_SECRET: 'local-test-secret-with-enough-entropy' };
  const originalFetch = globalThis.fetch;
  let networkAttempts = 0;
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error('network must not be used by D1 auth');
  };

  try {
    const response = await handleCloudflareAuthRuntime(loginRequest('profissional@example.com', password), env);
    assert.equal(response.status, 200);
    const session = await response.json();
    assert.equal(session.user.id, userId);
    assert.equal(session.user.email, 'profissional@example.com');
    assert.equal(session.access_token.split('.').length, 3);
    assert.ok(session.refresh_token);
    assert.equal(networkAttempts, 0);
    assert.ok(db.users.get(userId)?.last_sign_in_at);
    assert.equal(db.refreshSessions.size, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unknown or invalid D1 credentials fail closed instead of trying another backend', async () => {
  const { db } = await fixture();
  const env = { CLINICAL_DB: db, CLINICAL_AUTH_SECRET: 'local-test-secret-with-enough-entropy' };
  const originalFetch = globalThis.fetch;
  let networkAttempts = 0;
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error('network must not be used by D1 auth');
  };

  try {
    const response = await handleCloudflareAuthRuntime(loginRequest('naoexiste@example.com', 'senha-qualquer-123'), env);
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.message, /E-mail ou senha inválidos/i);
    assert.equal(networkAttempts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unknown refresh token fails closed on D1 without legacy refresh fallback', async () => {
  const { db } = await fixture();
  const env = { CLINICAL_DB: db, CLINICAL_AUTH_SECRET: 'local-test-secret-with-enough-entropy' };
  const originalFetch = globalThis.fetch;
  let networkAttempts = 0;
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error('network must not be used by D1 auth');
  };

  try {
    const request = new Request('https://deboralactacao.com/api/auth/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'refresh-inexistente' }),
    });
    const response = await handleCloudflareAuthRuntime(request, env);
    assert.equal(response.status, 401);
    assert.equal(networkAttempts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
