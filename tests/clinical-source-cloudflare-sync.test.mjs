import test from 'node:test';
import assert from 'node:assert/strict';
import { syncLegacyClinicalRows } from '../worker/cloudflare-auth-compat.js';

function fakeD1() {
  const rows = new Map();
  const statements = [];
  return {
    rows,
    statements,
    prepare(sql) {
      statements.push(sql);
      return {
        bind(...args) {
          return {
            async run() {
              if (!sql.includes('INSERT INTO supabase_records')) throw new Error(`unexpected SQL: ${sql}`);
              const [table, key, ownerId, recordJson] = args;
              const mapKey = `${table}:${key}`;
              const existing = rows.get(mapKey);
              if (!existing) {
                rows.set(mapKey, { table, key, ownerId, record: JSON.parse(recordJson) });
              } else if (existing.ownerId == null && ownerId != null) {
                existing.ownerId = ownerId;
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
}

test('legacy clinical sync restores missing rows and repairs null ownership without overwriting canonical data', async () => {
  const db = fakeD1();
  db.rows.set('mothers:mother-1', {
    table: 'mothers',
    key: 'mother-1',
    ownerId: null,
    record: { id: 'mother-1', owner_id: 'user-1', name: 'Paciente preservada' },
  });

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

    assert.equal(db.rows.size, 2, 'repeated sync must not duplicate records');
    assert.equal(db.rows.get('mothers:mother-1')?.ownerId, 'user-1', 'null migrated owner must be repaired');
    assert.equal(db.rows.get('mothers:mother-1')?.record?.name, 'Paciente preservada');
    assert.equal(db.rows.get('babies:baby-1')?.record?.mother_id, 'mother-1');
    assert.ok(db.statements.some((sql) => /DO\s+UPDATE\s+SET\s+owner_id/i.test(sql)));
    assert.ok(requested.some((item) => item.url.includes('/rest/v1/mothers')));
    assert.ok(requested.some((item) => item.url.includes('/rest/v1/babies')));
    assert.ok(requested.every((item) => item.authorization === 'Bearer legacy-token'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
