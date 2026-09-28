import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';

// Real SQLite with the small async D1 surface used by runtime tests. No SQL mocks.
export function createSqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const path of ['cloudflare/full-migration-schema.sql', 'cloudflare/runtime-schema.sql',
    'cloudflare/migrations/0009-billing-recovery.sql', 'cloudflare/migrations/0010-billing-reconciliation.sql']) {
    const url = new URL(`../../${path}`, import.meta.url);
    if (existsSync(url)) sqlite.exec(readFileSync(url, 'utf8'));
  }
  function statement(sql, values = []) {
    return {
      bind(...args) { return statement(sql, args); },
      async first(column) { const row = sqlite.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ? { ...row } : null; },
      async all() { return { results: sqlite.prepare(sql).all(...values).map(row => ({ ...row })), success: true }; },
      async run() { const info = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; },
    };
  }
  return {
    prepare: statement,
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    exec(sql) { sqlite.exec(sql); },
    close() { sqlite.close(); },
  };
}
