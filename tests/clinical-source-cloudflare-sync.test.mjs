import test from 'node:test';
import assert from 'node:assert/strict';
import { syncLegacyClinicalRows } from '../worker/cloudflare-auth-compat.js';

function fakeD1() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (!sql.includes('INSERT INTO supabase_records')) throw new Error(`unexpected SQL: ${sql}`);
              const [table, key, ownerId, recordJson] = args;
              rows.set(`${table}:${key}`, { table, key, ownerId, record: JSON.parse(recordJson) });
              return { success: true };
            },
          };
        },
      };
    },
  };
}

test('legacy clinical sync restores patient rows into D1 idempotently', async () => {
  const db = fakeD1();
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url, options = {}) => {
    requested.push({ url: String(url), authorization: options.headers?.authorization });
    if (String(url).includes('/rest/v1/mothers')) {
      return new Response(JSON.stringify([
        { id: 'mother-1', owner_id: 'user-1', name: 'Paciente preservada', created_at: '2026-08-29T23:43:44Z' },
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).includes('/rest/v1/babies')) {
      return new Response(JSON.stringify([
        { id: 'baby-1', mother_id: 'mother-1', name: 'Bebê preservado', created_at: '2026-08-29T23:44:00Z' },
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const env = { CLINICAL_DB: db };
    await syncLegacyClinicalRows(env, 'legacy-token', 'user-1');
    await syncLegacyClinicalRows(env, 'legacy-token', 'user-1');

    assert.equal(db.rows.size, 2, 'repeated sync must upsert instead of duplicating records');
    assert.equal(db.rows.get('mothers:mother-1')?.record?.name, 'Paciente preservada');
    assert.equal(db.rows.get('babies:baby-1')?.record?.mother_id, 'mother-1');
    assert.ok(requested.some((item) => item.url.includes('/rest/v1/mothers')));
    assert.ok(requested.some((item) => item.url.includes('/rest/v1/babies')));
    assert.ok(requested.every((item) => item.authorization === 'Bearer legacy-token'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
