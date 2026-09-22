param(
  [Parameter(Mandatory=$true)][string]$Email,
  [Parameter(Mandatory=$true)][string]$MotherId,
  [string]$D1Database = 'debora-lactacao-clinical'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$NpxCmd = (Get-Command npx.cmd -ErrorAction Stop).Source
function Sql-Literal([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
$emailSql = Sql-Literal $Email.Trim().ToLowerInvariant()
$motherSql = Sql-Literal $MotherId

# Read-only: never print passwords, hashes, tokens, medical notes or attachments.
$queries = @(
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('auth_users','auth_credentials','supabase_records','migration_runs','migration_validation');",
  "SELECT user_id,email_confirmed_at,last_sign_in_at,password_reset_required FROM auth_users WHERE lower(email)=$emailSql;",
  "SELECT c.user_id,c.password_iterations,c.password_algorithm,c.updated_at FROM auth_credentials c JOIN auth_users u ON u.user_id=c.user_id WHERE lower(u.email)=$emailSql;",
  "SELECT r.record_key,r.owner_id,json_extract(r.record_json,'$.owner_id') AS json_owner_id,CASE WHEN EXISTS(SELECT 1 FROM auth_users u WHERE lower(u.email)=$emailSql AND u.user_id=COALESCE(NULLIF(r.owner_id,''),json_extract(r.record_json,'$.owner_id'))) THEN 1 ELSE 0 END AS visible_to_account FROM supabase_records r WHERE r.table_name='mothers' AND (r.record_key=$motherSql OR json_extract(r.record_json,'$.id')=$motherSql);",
  "SELECT table_name,COUNT(*) AS records FROM supabase_records WHERE owner_id IN (SELECT user_id FROM auth_users WHERE lower(email)=$emailSql) GROUP BY table_name;",
  "SELECT run_id,status,source_snapshot_at,source_row_count,source_user_count,updated_at FROM migration_runs ORDER BY updated_at DESC LIMIT 3;",
  "SELECT run_id,scope,source_count,target_count,matches FROM migration_validation WHERE matches=0 LIMIT 20;"
)
foreach ($query in $queries) {
  & $NpxCmd --yes wrangler@4 d1 execute $D1Database --remote --command $query --json
  if ($LASTEXITCODE -ne 0) { throw 'Consulta de diagnóstico falhou. Nenhum dado foi alterado.' }
}
