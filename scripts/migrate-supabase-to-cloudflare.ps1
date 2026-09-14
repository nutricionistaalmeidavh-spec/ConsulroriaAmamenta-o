param(
  [switch]$Apply,
  [string]$SupabaseProjectRef = 'zxowxdfhtksevhnjmeyu',
  [string]$SupabaseUrl = 'https://zxowxdfhtksevhnjmeyu.supabase.co',
  [string]$D1Database = 'debora-lactacao-clinical',
  [string]$R2Bucket = 'debora-lactacao-clinical',
  [string]$BackupRoot = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'DeboraCloudflareBackup')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Step([string]$Text) {
  Write-Host "`n==> $Text" -ForegroundColor Cyan
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Comando obrigatório não encontrado: $Name"
  }
}

function Invoke-NativeCapture([string]$FilePath, [string[]]$Arguments) {
  $old = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = (& $FilePath @Arguments 2>&1 | Out-String)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  return [pscustomobject]@{ ExitCode = $exitCode; Output = $output }
}

function Invoke-NativeChecked([string]$Label, [string]$FilePath, [string[]]$Arguments) {
  $result = Invoke-NativeCapture $FilePath $Arguments
  if ($result.ExitCode -ne 0) {
    throw "$Label falhou (exit $($result.ExitCode)).`n$($result.Output)"
  }
  if (-not [string]::IsNullOrWhiteSpace($result.Output)) { Write-Host $result.Output.TrimEnd() }
  return $result
}

function ConvertTo-CompactJson($Value) {
  return ($Value | ConvertTo-Json -Depth 100 -Compress)
}

function Sql-Literal([AllowNull()]$Value) {
  if ($null -eq $Value) { return 'NULL' }
  $s = [string]$Value
  return "'" + $s.Replace("'", "''") + "'"
}

function Get-ObjectProperty($Object, [string]$Name) {
  if ($null -eq $Object) { return $null }
  if ($Object.PSObject.Properties.Name -contains $Name) { return $Object.$Name }
  return $null
}

function Get-Sha256Text([string]$Text) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  } finally { $sha.Dispose() }
}

function Get-Sha256File([string]$Path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose() }
  } finally { $sha.Dispose() }
}

function Encode-PathSegments([string]$Value) {
  return (($Value -split '/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
}

function Ensure-SupabaseLogin([string]$NpxCmd) {
  $probe = Invoke-NativeCapture $NpxCmd @('--yes','supabase@2.111.0','projects','list','--output','json')
  if ($probe.ExitCode -eq 0) { return }
  Step 'Login do Supabase'
  Invoke-NativeChecked 'supabase login' $NpxCmd @('--yes','supabase@2.111.0','login') | Out-Null
}

function Ensure-CloudflareLogin([string]$NpxCmd) {
  $probe = Invoke-NativeCapture $NpxCmd @('--yes','wrangler@4','whoami')
  if ($probe.ExitCode -eq 0 -and $probe.Output -notmatch '(?i)not authenticated|not logged|login required') {
    Write-Host $probe.Output.TrimEnd()
    return
  }
  Step 'Login do Cloudflare'
  Invoke-NativeChecked 'wrangler login' $NpxCmd @('--yes','wrangler@4','login') | Out-Null
}

function Get-SupabaseServerKey([string]$NpxCmd, [string]$ProjectRef) {
  $result = Invoke-NativeCapture $NpxCmd @('--yes','supabase@2.111.0','projects','api-keys','--project-ref',$ProjectRef,'--output','json')
  if ($result.ExitCode -ne 0) {
    throw "Leitura das chaves do Supabase falhou (exit $($result.ExitCode))."
  }
  $parsed = $result.Output | ConvertFrom-Json
  $rows = @($parsed)
  if ($parsed -is [pscustomobject] -and $parsed.PSObject.Properties.Name -contains 'api_keys') { $rows = @($parsed.api_keys) }

  $row = $rows | Where-Object {
    $id = [string](Get-ObjectProperty $_ 'id')
    $name = [string](Get-ObjectProperty $_ 'name')
    $type = [string](Get-ObjectProperty $_ 'type')
    $key = [string](Get-ObjectProperty $_ 'api_key')
    -not [string]::IsNullOrWhiteSpace($key) -and
      $key -notmatch '(?i)redacted' -and
      ($id -eq 'service_role' -or $name -eq 'service_role' -or $type -eq 'service_role' -or $id -match 'secret|service' -or $name -match 'secret|service')
  } | Select-Object -First 1

  if (-not $row) { throw 'Não foi possível obter automaticamente uma chave server-side do Supabase.' }
  $key = [string](Get-ObjectProperty $row 'api_key')
  if ([string]::IsNullOrWhiteSpace($key) -or $key -match '(?i)redacted') { throw 'A chave server-side retornada pelo Supabase está indisponível.' }
  Write-Host 'Chave server-side obtida sem exibir o valor.'
  return $key
}

function New-SupabaseHeaders([string]$Key, [string]$Accept = 'application/json') {
  return @{ apikey = $Key; Authorization = "Bearer $Key"; Accept = $Accept }
}

function Get-SupabaseTables([string]$BaseUrl, [string]$Key) {
  $openApi = Invoke-RestMethod -Method Get -Uri "$BaseUrl/rest/v1/" -Headers (New-SupabaseHeaders $Key 'application/openapi+json')
  $tables = New-Object System.Collections.Generic.List[string]
  foreach ($prop in $openApi.paths.PSObject.Properties) {
    if ($prop.Name -match '^/([A-Za-z0-9_]+)$' -and $prop.Value.PSObject.Properties.Name -contains 'get') {
      $name = $Matches[1]
      if ($name -ne 'rpc' -and -not $tables.Contains($name)) { $tables.Add($name) }
    }
  }
  return @($tables | Sort-Object)
}

function Export-SupabaseTable([string]$BaseUrl, [string]$Key, [string]$Table, [string]$OutputPath) {
  $all = New-Object System.Collections.ArrayList
  $offset = 0
  $pageSize = 1000
  while ($true) {
    $headers = New-SupabaseHeaders $Key
    $headers['Range'] = "$offset-$($offset + $pageSize - 1)"
    $headers['Prefer'] = 'count=exact'
    $uri = "$BaseUrl/rest/v1/$([Uri]::EscapeDataString($Table))?select=*"
    $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $uri -Headers $headers
    $text = [string]$response.Content
    $rows = if ([string]::IsNullOrWhiteSpace($text)) { @() } else { @($text | ConvertFrom-Json) }
    foreach ($row in $rows) { [void]$all.Add($row) }
    if ($rows.Count -lt $pageSize) { break }
    $offset += $pageSize
  }
  $json = ConvertTo-CompactJson @($all)
  [IO.File]::WriteAllText($OutputPath, $json, (New-Object Text.UTF8Encoding($false)))
  return @($all)
}

function Export-SupabaseUsers([string]$BaseUrl, [string]$Key, [string]$OutputPath) {
  $all = New-Object System.Collections.ArrayList
  $page = 1
  $perPage = 1000
  while ($true) {
    $uri = "$BaseUrl/auth/v1/admin/users?page=$page&per_page=$perPage"
    $payload = Invoke-RestMethod -Method Get -Uri $uri -Headers (New-SupabaseHeaders $Key)
    $users = @($payload.users)
    foreach ($user in $users) { [void]$all.Add($user) }
    if ($users.Count -lt $perPage) { break }
    $page++
  }
  [IO.File]::WriteAllText($OutputPath, (ConvertTo-CompactJson @($all)), (New-Object Text.UTF8Encoding($false)))
  return @($all)
}

function Get-StorageBuckets([string]$BaseUrl, [string]$Key) {
  return @(Invoke-RestMethod -Method Get -Uri "$BaseUrl/storage/v1/bucket" -Headers (New-SupabaseHeaders $Key))
}

function Get-StorageFilesRecursive([string]$BaseUrl, [string]$Key, [string]$Bucket) {
  $files = New-Object System.Collections.ArrayList
  $visited = New-Object 'System.Collections.Generic.HashSet[string]'

  function Walk([string]$Prefix) {
    if (-not $visited.Add($Prefix)) { return }
    $offset = 0
    $limit = 100
    while ($true) {
      $body = ConvertTo-CompactJson @{ prefix = $Prefix; limit = $limit; offset = $offset; sortBy = @{ column = 'name'; order = 'asc' } }
      $rows = @(Invoke-RestMethod -Method Post -Uri "$BaseUrl/storage/v1/object/list/$([Uri]::EscapeDataString($Bucket))" -Headers ((New-SupabaseHeaders $Key) + @{ 'Content-Type' = 'application/json' }) -Body $body)
      foreach ($row in $rows) {
        $name = [string](Get-ObjectProperty $row 'name')
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        $path = if ([string]::IsNullOrWhiteSpace($Prefix)) { $name } else { "$Prefix/$name" }
        $id = Get-ObjectProperty $row 'id'
        if ($null -eq $id -or [string]::IsNullOrWhiteSpace([string]$id)) {
          Walk $path
        } else {
          [void]$files.Add([pscustomobject]@{ bucket = $Bucket; path = $path; source = $row })
        }
      }
      if ($rows.Count -lt $limit) { break }
      $offset += $limit
    }
  }

  Walk ''
  return @($files)
}

function Download-StorageFile([string]$BaseUrl, [string]$Key, $Entry, [string]$BlobDir) {
  $fingerprint = Get-Sha256Text ("$($Entry.bucket)|$($Entry.path)")
  $target = Join-Path $BlobDir $fingerprint
  if (-not (Test-Path $target)) {
    $bucket = [Uri]::EscapeDataString([string]$Entry.bucket)
    $objectPath = Encode-PathSegments ([string]$Entry.path)
    Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$BaseUrl/storage/v1/object/authenticated/$bucket/$objectPath" -Headers (New-SupabaseHeaders $Key '*/*') -OutFile $target
  }
  return $target
}

function Get-RecordKey([string]$Table, $Row) {
  $id = Get-ObjectProperty $Row 'id'
  if ($null -ne $id -and -not [string]::IsNullOrWhiteSpace([string]$id)) { return [string]$id }
  if ($Table -eq 'clinical_encounter_babies') {
    $a = [string](Get-ObjectProperty $Row 'encounter_id'); $b = [string](Get-ObjectProperty $Row 'baby_id')
    if ($a -or $b) { return "$a|$b" }
  }
  if ($Table -eq 'appointment_babies') {
    $a = [string](Get-ObjectProperty $Row 'appointment_id'); $b = [string](Get-ObjectProperty $Row 'baby_id')
    if ($a -or $b) { return "$a|$b" }
  }
  return Get-Sha256Text ("$Table|$(ConvertTo-CompactJson $Row)")
}

function Ensure-D1Database([string]$NpxCmd, [string]$DatabaseName) {
  $list = Invoke-NativeChecked 'wrangler d1 list' $NpxCmd @('--yes','wrangler@4','d1','list','--json')
  $rows = @($list.Output | ConvertFrom-Json)
  $found = $rows | Where-Object { [string](Get-ObjectProperty $_ 'name') -eq $DatabaseName } | Select-Object -First 1
  if (-not $found) {
    Invoke-NativeChecked 'criação do D1' $NpxCmd @('--yes','wrangler@4','d1','create',$DatabaseName) | Out-Null
  }
}

function Ensure-R2Bucket([string]$NpxCmd, [string]$BucketName) {
  $list = Invoke-NativeCapture $NpxCmd @('--yes','wrangler@4','r2','bucket','list','--json')
  $exists = $false
  if ($list.ExitCode -eq 0) {
    try {
      $rows = @($list.Output | ConvertFrom-Json)
      $exists = @($rows | Where-Object { [string](Get-ObjectProperty $_ 'name') -eq $BucketName }).Count -gt 0
    } catch { $exists = $list.Output -match [regex]::Escape($BucketName) }
  } else {
    $fallback = Invoke-NativeChecked 'wrangler r2 bucket list' $NpxCmd @('--yes','wrangler@4','r2','bucket','list')
    $exists = $fallback.Output -match [regex]::Escape($BucketName)
  }
  if (-not $exists) { Invoke-NativeChecked 'criação do bucket R2' $NpxCmd @('--yes','wrangler@4','r2','bucket','create',$BucketName) | Out-Null }
}

function Parse-D1Results([string]$Output) {
  $parsed = $Output | ConvertFrom-Json
  $batch = @($parsed)
  if ($batch.Count -eq 0) { return @() }
  $first = $batch[0]
  if ($first.PSObject.Properties.Name -contains 'results') { return @($first.results) }
  return @()
}

Require-Command node
Require-Command npx.cmd
$NpxCmd = (Get-Command npx.cmd -ErrorAction Stop).Source
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$SchemaPath = Join-Path $RepoRoot 'cloudflare\full-migration-schema.sql'
if (-not (Test-Path $SchemaPath)) { throw "Schema de migração ausente: $SchemaPath" }

Step 'Autenticando no Supabase sem exigir senha do Postgres'
Ensure-SupabaseLogin $NpxCmd
$SupabaseServerKey = Get-SupabaseServerKey $NpxCmd $SupabaseProjectRef

$runId = [Guid]::NewGuid().ToString('N')
$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$SnapshotDir = Join-Path $BackupRoot "$timestamp-$runId"
$TablesDir = Join-Path $SnapshotDir 'tables'
$BlobDir = Join-Path $SnapshotDir 'storage-blobs'
New-Item -ItemType Directory -Force -Path $TablesDir,$BlobDir | Out-Null

Step 'Descobrindo tabelas públicas expostas pelo Supabase'
$tables = Get-SupabaseTables $SupabaseUrl $SupabaseServerKey
if ($tables.Count -eq 0) { throw 'Nenhuma tabela pública foi descoberta pelo PostgREST.' }
Write-Host ("Tabelas encontradas: " + ($tables -join ', '))

Step 'Criando snapshot local completo antes de qualquer gravação no Cloudflare'
$tableSnapshots = @{}
$totalRows = 0
foreach ($table in $tables) {
  Write-Host "  - $table"
  $path = Join-Path $TablesDir "$table.json"
  $rows = Export-SupabaseTable $SupabaseUrl $SupabaseServerKey $table $path
  $tableSnapshots[$table] = @($rows)
  $totalRows += $rows.Count
}

$usersPath = Join-Path $SnapshotDir 'auth-users.json'
$users = Export-SupabaseUsers $SupabaseUrl $SupabaseServerKey $usersPath

$buckets = Get-StorageBuckets $SupabaseUrl $SupabaseServerKey
$storageEntries = New-Object System.Collections.ArrayList
foreach ($bucket in $buckets) {
  $bucketName = [string](Get-ObjectProperty $bucket 'name')
  if ([string]::IsNullOrWhiteSpace($bucketName)) { $bucketName = [string](Get-ObjectProperty $bucket 'id') }
  if ([string]::IsNullOrWhiteSpace($bucketName)) { continue }
  Write-Host "  - Storage: $bucketName"
  $entries = Get-StorageFilesRecursive $SupabaseUrl $SupabaseServerKey $bucketName
  foreach ($entry in $entries) {
    $localFile = Download-StorageFile $SupabaseUrl $SupabaseServerKey $entry $BlobDir
    $entry | Add-Member -NotePropertyName local_file -NotePropertyValue $localFile
    [void]$storageEntries.Add($entry)
  }
}

$storageManifestPath = Join-Path $SnapshotDir 'storage-manifest.json'
[IO.File]::WriteAllText($storageManifestPath, (ConvertTo-CompactJson @($storageEntries)), (New-Object Text.UTF8Encoding($false)))

$manifest = [ordered]@{
  run_id = $runId
  snapshot_at = (Get-Date).ToUniversalTime().ToString('o')
  supabase_project_ref = $SupabaseProjectRef
  supabase_url = $SupabaseUrl
  table_count = $tables.Count
  row_count = $totalRows
  user_count = $users.Count
  bucket_count = $buckets.Count
  storage_object_count = $storageEntries.Count
  tables = @($tables)
  mode = if ($Apply) { 'apply' } else { 'dry-run' }
}
$manifestPath = Join-Path $SnapshotDir 'manifest.json'
[IO.File]::WriteAllText($manifestPath, (ConvertTo-CompactJson $manifest), (New-Object Text.UTF8Encoding($false)))

Write-Host "Snapshot preservado em: $SnapshotDir" -ForegroundColor Green
Write-Host "Resumo: $($tables.Count) tabelas, $totalRows linhas, $($users.Count) usuários, $($storageEntries.Count) arquivos."

if (-not $Apply) {
  Write-Host "`nDRY-RUN CONCLUÍDO: nada foi gravado no Cloudflare." -ForegroundColor Yellow
  Write-Host "Para copiar o snapshot para D1/R2, execute novamente com -Apply."
  $SupabaseServerKey = $null
  exit 0
}

Step 'Autenticando no Cloudflare'
Ensure-CloudflareLogin $NpxCmd

Step 'Preparando D1 e R2 dedicados à Débora'
Ensure-D1Database $NpxCmd $D1Database
Ensure-R2Bucket $NpxCmd $R2Bucket
Invoke-NativeChecked 'aplicação do schema D1' $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--file',$SchemaPath,'--yes') | Out-Null

Step 'Gerando import idempotente para o D1'
$importSql = Join-Path $SnapshotDir 'import-d1.sql'
$writer = New-Object IO.StreamWriter($importSql, $false, (New-Object Text.UTF8Encoding($false)))
try {
  $snapshotAt = [string]$manifest.snapshot_at
  $writer.WriteLine("INSERT INTO migration_runs(run_id,source_project_ref,source_snapshot_at,status,source_table_count,source_row_count,source_user_count,source_object_count,notes_json,updated_at) VALUES ($(Sql-Literal $runId),$(Sql-Literal $SupabaseProjectRef),$(Sql-Literal $snapshotAt),'importing',$($tables.Count),$totalRows,$($users.Count),$($storageEntries.Count),'{}',CURRENT_TIMESTAMP) ON CONFLICT(run_id) DO UPDATE SET status='importing',updated_at=CURRENT_TIMESTAMP;")

  foreach ($table in $tables) {
    $filePath = Join-Path $TablesDir "$table.json"
    $hash = Get-Sha256File $filePath
    $rows = @($tableSnapshots[$table])
    $writer.WriteLine("INSERT INTO source_tables(table_name,row_count,snapshot_sha256,migrated_at) VALUES ($(Sql-Literal $table),$($rows.Count),$(Sql-Literal $hash),CURRENT_TIMESTAMP) ON CONFLICT(table_name) DO UPDATE SET row_count=excluded.row_count,snapshot_sha256=excluded.snapshot_sha256,migrated_at=CURRENT_TIMESTAMP;")
    foreach ($row in $rows) {
      $recordKey = Get-RecordKey $table $row
      $ownerId = Get-ObjectProperty $row 'owner_id'
      $createdAt = Get-ObjectProperty $row 'created_at'
      $updatedAt = Get-ObjectProperty $row 'updated_at'
      $recordJson = ConvertTo-CompactJson $row
      $writer.WriteLine("INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at) VALUES ($(Sql-Literal $table),$(Sql-Literal $recordKey),$(Sql-Literal $ownerId),$(Sql-Literal $recordJson),$(Sql-Literal $createdAt),$(Sql-Literal $updatedAt),CURRENT_TIMESTAMP) ON CONFLICT(table_name,record_key) DO UPDATE SET owner_id=excluded.owner_id,record_json=excluded.record_json,source_created_at=excluded.source_created_at,source_updated_at=excluded.source_updated_at,migrated_at=CURRENT_TIMESTAMP;")
    }
  }

  foreach ($user in $users) {
    $userId = Get-ObjectProperty $user 'id'
    if ([string]::IsNullOrWhiteSpace([string]$userId)) { continue }
    $writer.WriteLine("INSERT INTO auth_users(user_id,email,phone,email_confirmed_at,phone_confirmed_at,created_at,updated_at,last_sign_in_at,user_metadata_json,app_metadata_json,password_reset_required,migrated_at) VALUES ($(Sql-Literal $userId),$(Sql-Literal (Get-ObjectProperty $user 'email')),$(Sql-Literal (Get-ObjectProperty $user 'phone')),$(Sql-Literal (Get-ObjectProperty $user 'email_confirmed_at')),$(Sql-Literal (Get-ObjectProperty $user 'phone_confirmed_at')),$(Sql-Literal (Get-ObjectProperty $user 'created_at')),$(Sql-Literal (Get-ObjectProperty $user 'updated_at')),$(Sql-Literal (Get-ObjectProperty $user 'last_sign_in_at')),$(Sql-Literal (ConvertTo-CompactJson (Get-ObjectProperty $user 'user_metadata'))),$(Sql-Literal (ConvertTo-CompactJson (Get-ObjectProperty $user 'app_metadata'))),1,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,phone=excluded.phone,email_confirmed_at=excluded.email_confirmed_at,phone_confirmed_at=excluded.phone_confirmed_at,created_at=excluded.created_at,updated_at=excluded.updated_at,last_sign_in_at=excluded.last_sign_in_at,user_metadata_json=excluded.user_metadata_json,app_metadata_json=excluded.app_metadata_json,migrated_at=CURRENT_TIMESTAMP;")
  }

  foreach ($entry in @($storageEntries)) {
    $source = $entry.source
    $metadata = Get-ObjectProperty $source 'metadata'
    $size = Get-ObjectProperty $metadata 'size'
    if ($null -eq $size) { $size = (Get-Item $entry.local_file).Length }
    $mime = Get-ObjectProperty $metadata 'mimetype'
    if ($null -eq $mime) { $mime = Get-ObjectProperty $metadata 'contentType' }
    $r2Key = "supabase/$($entry.bucket)/$($entry.path)"
    $writer.WriteLine("INSERT INTO storage_objects(source_bucket,source_path,r2_key,size_bytes,mime_type,source_created_at,source_updated_at,metadata_json,migrated_at) VALUES ($(Sql-Literal $entry.bucket),$(Sql-Literal $entry.path),$(Sql-Literal $r2Key),$([int64]$size),$(Sql-Literal $mime),$(Sql-Literal (Get-ObjectProperty $source 'created_at')),$(Sql-Literal (Get-ObjectProperty $source 'updated_at')),$(Sql-Literal (ConvertTo-CompactJson $metadata)),CURRENT_TIMESTAMP) ON CONFLICT(source_bucket,source_path) DO UPDATE SET r2_key=excluded.r2_key,size_bytes=excluded.size_bytes,mime_type=excluded.mime_type,source_created_at=excluded.source_created_at,source_updated_at=excluded.source_updated_at,metadata_json=excluded.metadata_json,migrated_at=CURRENT_TIMESTAMP;")
  }
} finally { $writer.Dispose() }

Invoke-NativeChecked 'importação dos dados no D1' $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--file',$importSql,'--yes') | Out-Null

Step 'Copiando bytes do Supabase Storage para R2 privado'
$uploaded = 0
foreach ($entry in @($storageEntries)) {
  $source = $entry.source
  $metadata = Get-ObjectProperty $source 'metadata'
  $mime = [string](Get-ObjectProperty $metadata 'mimetype')
  if ([string]::IsNullOrWhiteSpace($mime)) { $mime = [string](Get-ObjectProperty $metadata 'contentType') }
  $r2Key = "supabase/$($entry.bucket)/$($entry.path)"
  $args = @('--yes','wrangler@4','r2','object','put',"$R2Bucket/$r2Key",'--file',[string]$entry.local_file,'--remote','--force')
  if (-not [string]::IsNullOrWhiteSpace($mime)) { $args += @('--content-type',$mime) }
  Invoke-NativeChecked "upload R2 $r2Key" $NpxCmd $args | Out-Null
  $uploaded++
}

Step 'Validando contagens no D1'
$countResult = Invoke-NativeChecked 'contagem por tabela no D1' $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--command','SELECT table_name, COUNT(*) AS row_count FROM supabase_records GROUP BY table_name ORDER BY table_name;','--json','--yes')
$targetTableRows = Parse-D1Results $countResult.Output
$targetCounts = @{}
foreach ($row in $targetTableRows) { $targetCounts[[string]$row.table_name] = [int]$row.row_count }
$failures = New-Object System.Collections.Generic.List[string]
foreach ($table in $tables) {
  $sourceCount = @($tableSnapshots[$table]).Count
  $targetCount = if ($targetCounts.ContainsKey($table)) { [int]$targetCounts[$table] } else { 0 }
  if ($sourceCount -ne $targetCount) { $failures.Add("$table: origem=$sourceCount destino=$targetCount") }
}

$authCountResult = Invoke-NativeChecked 'contagem de usuários no D1' $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--command','SELECT COUNT(*) AS row_count FROM auth_users;','--json','--yes')
$authRows = Parse-D1Results $authCountResult.Output
$targetUsers = if ($authRows.Count -gt 0) { [int]$authRows[0].row_count } else { 0 }
if ($targetUsers -ne $users.Count) { $failures.Add("auth_users: origem=$($users.Count) destino=$targetUsers") }

$storageCountResult = Invoke-NativeChecked 'contagem de objetos no D1' $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--command','SELECT COUNT(*) AS row_count FROM storage_objects;','--json','--yes')
$storageRows = Parse-D1Results $storageCountResult.Output
$targetObjects = if ($storageRows.Count -gt 0) { [int]$storageRows[0].row_count } else { 0 }
if ($targetObjects -ne $storageEntries.Count) { $failures.Add("storage_objects: origem=$($storageEntries.Count) destino=$targetObjects") }
if ($uploaded -ne $storageEntries.Count) { $failures.Add("R2 uploads: origem=$($storageEntries.Count) enviados=$uploaded") }

if ($failures.Count -gt 0) {
  $failureText = $failures -join '; '
  $safeFailure = Sql-Literal (ConvertTo-CompactJson @{ failures = @($failures) })
  Invoke-NativeCapture $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--command',"UPDATE migration_runs SET status='failed',notes_json=$safeFailure,updated_at=CURRENT_TIMESTAMP WHERE run_id=$(Sql-Literal $runId);",'--yes') | Out-Null
  throw "Validação da migração falhou: $failureText. O Supabase NÃO foi apagado nem desligado."
}

Invoke-NativeChecked 'marcação da migração como validada' $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--command',"UPDATE migration_runs SET status='validated',updated_at=CURRENT_TIMESTAMP WHERE run_id=$(Sql-Literal $runId);",'--yes') | Out-Null

$report = [ordered]@{
  run_id = $runId
  validated = $true
  d1_database = $D1Database
  r2_bucket = $R2Bucket
  source_table_count = $tables.Count
  source_row_count = $totalRows
  source_user_count = $users.Count
  source_object_count = $storageEntries.Count
  r2_uploaded_count = $uploaded
  supabase_preserved = $true
  auth_passwords_migrated = $false
  auth_note = 'Usuários foram copiados como identidade/metadados; senhas do Supabase não são exportáveis e exigem redefinição no cutover de autenticação.'
}
[IO.File]::WriteAllText((Join-Path $SnapshotDir 'migration-report.json'), (ConvertTo-CompactJson $report), (New-Object Text.UTF8Encoding($false)))

$SupabaseServerKey = $null
[GC]::Collect()

Write-Host "`nMIGRAÇÃO DE DADOS VALIDADA" -ForegroundColor Green
Write-Host "D1: $D1Database"
Write-Host "R2: $R2Bucket"
Write-Host "Backup local: $SnapshotDir"
Write-Host 'O Supabase foi preservado e continua sendo a origem ativa. Nenhum dado foi apagado.'
Write-Host 'Próximo corte necessário: trocar o runtime clínico/autenticação para D1/R2; usuários precisarão redefinir senha porque hashes do Supabase não são exportáveis.'
