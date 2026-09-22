import { DEMO_EMAIL, DEMO_USER_ID } from './demo-account-fixture.mjs';

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('invalid_sql_number');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function ensureFixtureIdentity(fixture) {
  if (!fixture?.user || fixture.user.id !== DEMO_USER_ID || String(fixture.user.email || '').toLowerCase() !== DEMO_EMAIL) {
    throw new Error('demo_fixture_identity_mismatch');
  }
  if (!Array.isArray(fixture.records) || !fixture.records.length) throw new Error('demo_fixture_records_missing');
  for (const item of fixture.records) {
    if (!/^[A-Za-z0-9_]+$/.test(String(item?.table || ''))) throw new Error('demo_fixture_table_invalid');
    if (!String(item?.key || '')) throw new Error('demo_fixture_key_missing');
    if (!item?.row || typeof item.row !== 'object') throw new Error('demo_fixture_row_missing');
    if (item.row.owner_id && item.row.owner_id !== DEMO_USER_ID) throw new Error('demo_fixture_owner_mismatch');
  }
}

export function validateDemoIdentityRows(input) {
  const rows = Array.isArray(input) ? input : [];
  if (!rows.length) return { exists: false, row: null };
  if (rows.length !== 1) throw new Error('demo_identity_collision');
  const row = rows[0] || {};
  if (String(row.user_id || '') !== DEMO_USER_ID || String(row.email || '').trim().toLowerCase() !== DEMO_EMAIL) {
    throw new Error('demo_identity_collision');
  }
  let metadata = {};
  try { metadata = JSON.parse(String(row.user_metadata_json || '{}')); } catch { throw new Error('demo_identity_metadata_invalid'); }
  if (metadata?.demo !== true) throw new Error('demo_identity_not_marked');
  return { exists: true, row };
}

export function buildIdentityProbeSql() {
  return `SELECT user_id,email,user_metadata_json FROM auth_users WHERE user_id = ${sqlLiteral(DEMO_USER_ID)} OR lower(email) = lower(${sqlLiteral(DEMO_EMAIL)}) ORDER BY user_id;`;
}

export function buildSeedSql({ fixture, credential } = {}) {
  ensureFixtureIdentity(fixture);
  if (!credential?.password_salt || !credential?.password_hash || !credential?.password_iterations || credential?.password_algorithm !== 'PBKDF2-SHA256') {
    throw new Error('demo_credential_invalid');
  }
  const generatedAt = fixture.generatedAt || new Date().toISOString();
  const userMetadata = JSON.stringify(fixture.user.user_metadata || {});
  const appMetadata = JSON.stringify(fixture.user.app_metadata || {});
  const lines = [];
  lines.push(`INSERT INTO auth_users(
  user_id,email,phone,email_confirmed_at,phone_confirmed_at,created_at,updated_at,last_sign_in_at,
  user_metadata_json,app_metadata_json,password_reset_required,migrated_at
) VALUES(
  ${sqlLiteral(DEMO_USER_ID)},${sqlLiteral(DEMO_EMAIL)},NULL,${sqlLiteral(generatedAt)},NULL,${sqlLiteral(generatedAt)},${sqlLiteral(generatedAt)},NULL,
  ${sqlLiteral(userMetadata)},${sqlLiteral(appMetadata)},0,${sqlLiteral(generatedAt)}
) ON CONFLICT(user_id) DO UPDATE SET
  email=excluded.email,email_confirmed_at=excluded.email_confirmed_at,updated_at=excluded.updated_at,
  user_metadata_json=excluded.user_metadata_json,app_metadata_json=excluded.app_metadata_json,
  password_reset_required=0,migrated_at=excluded.migrated_at;`);
  lines.push(`INSERT INTO auth_credentials(
  user_id,password_salt,password_hash,password_iterations,password_algorithm,created_at,updated_at
) VALUES(
  ${sqlLiteral(DEMO_USER_ID)},${sqlLiteral(credential.password_salt)},${sqlLiteral(credential.password_hash)},${sqlLiteral(credential.password_iterations)},${sqlLiteral(credential.password_algorithm)},${sqlLiteral(generatedAt)},${sqlLiteral(generatedAt)}
) ON CONFLICT(user_id) DO UPDATE SET
  password_salt=excluded.password_salt,password_hash=excluded.password_hash,
  password_iterations=excluded.password_iterations,password_algorithm=excluded.password_algorithm,updated_at=excluded.updated_at;`);

  for (const item of fixture.records) {
    const rowJson = JSON.stringify(item.row);
    lines.push(`INSERT INTO supabase_records(
  table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
) VALUES(
  ${sqlLiteral(item.table)},${sqlLiteral(item.key)},${sqlLiteral(DEMO_USER_ID)},${sqlLiteral(rowJson)},
  ${sqlLiteral(item.row.created_at || generatedAt)},${sqlLiteral(item.row.updated_at || generatedAt)},${sqlLiteral(generatedAt)}
) ON CONFLICT(table_name,record_key) DO UPDATE SET
  owner_id=excluded.owner_id,record_json=excluded.record_json,source_created_at=excluded.source_created_at,
  source_updated_at=excluded.source_updated_at,migrated_at=excluded.migrated_at;`);
  }
  return `${lines.join('\n\n')}\n`;
}

export function buildResetSql() {
  const lines = [];
  lines.push(`DELETE FROM auth_refresh_sessions WHERE user_id = ${sqlLiteral(DEMO_USER_ID)};`);
  lines.push(`DELETE FROM supabase_records WHERE owner_id = ${sqlLiteral(DEMO_USER_ID)};`);
  return `${lines.join('\n')}\n`;
}

export function buildResetAndSeedSql({ fixture, credential } = {}) {
  const reset = buildResetSql().trim();
  const seed = buildSeedSql({ fixture, credential }).trim();
  return `${reset}\n${seed}\n`;
}
