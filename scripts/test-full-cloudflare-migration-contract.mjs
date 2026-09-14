import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const scriptPath = path.join(root, 'scripts', 'migrate-supabase-to-cloudflare.ps1');
const schemaPath = path.join(root, 'cloudflare', 'full-migration-schema.sql');

assert.ok(fs.existsSync(scriptPath), 'migration script must exist');
assert.ok(fs.existsSync(schemaPath), 'D1 migration schema must exist');

const script = fs.readFileSync(scriptPath, 'utf8');
const schema = fs.readFileSync(schemaPath, 'utf8');

assert.match(script, /\[switch\]\$Apply/, 'migration must require explicit -Apply for remote writes');
assert.match(script, /Snapshot preservado em:/, 'migration must create a local snapshot first');
assert.match(script, /projects','api-keys','--project-ref'/, 'migration must obtain a server-side key without database password');
assert.match(script, /Get-SupabaseTables/, 'migration must discover exposed tables instead of hard-coding only known clinical tables');
assert.match(script, /Export-SupabaseUsers/, 'migration must preserve auth identity metadata');
assert.match(script, /Get-StorageFilesRecursive/, 'migration must traverse storage recursively');
assert.match(script, /r2','object','put'/, 'migration must copy storage bytes to R2');
assert.match(script, /d1','execute'/, 'migration must import records into D1');
assert.match(script, /Validação da migração falhou/, 'migration must fail closed on count mismatch');
assert.match(script, /O Supabase foi preservado/, 'migration must preserve Supabase after copy');

assert.doesNotMatch(script, /supabase@[^']*','db','push'/, 'full copy migrator must not mutate Supabase schema');
assert.doesNotMatch(script, /supabase@[^']*','link'/, 'full copy migrator must not require database linking/password');
assert.doesNotMatch(script, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM\s+auth\./i, 'migrator must not contain destructive Supabase SQL');

for (const table of ['migration_runs', 'source_tables', 'supabase_records', 'auth_users', 'storage_objects', 'migration_validation']) {
  assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must be idempotently created`);
}
assert.doesNotMatch(schema, /DROP\s+TABLE|TRUNCATE\s+TABLE/i, 'D1 schema must be non-destructive');
assert.match(schema, /password_reset_required INTEGER NOT NULL DEFAULT 1/, 'auth import must explicitly require password reset');

console.log('Full Cloudflare migration contract: OK');
