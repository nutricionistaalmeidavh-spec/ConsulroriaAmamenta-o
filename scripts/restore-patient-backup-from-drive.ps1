param(
  [string]$D1Database = 'debora-lactacao-clinical',
  [string]$R2Bucket = 'debora-lactacao-clinical',
  [string]$DriveRoot = '',
  [string]$BackupDir = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Sql-Literal([AllowNull()]$Value) { if ($null -eq $Value) { return 'NULL' }; return "'" + ([string]$Value).Replace("'", "''") + "'" }
function CompactJson($Value) { return ($Value | ConvertTo-Json -Depth 100 -Compress) }
function Get-Prop($Object,[string]$Name) { if ($null -eq $Object) { return $null }; if ($Object.PSObject.Properties.Name -contains $Name) { return $Object.$Name }; return $null }

function Invoke-NativeCapture([string]$FilePath, [string[]]$Arguments) {
  $old = $ErrorActionPreference
  try { $ErrorActionPreference = 'Continue'; $output = (& $FilePath @Arguments 2>&1 | Out-String); $exitCode = $LASTEXITCODE }
  finally { $ErrorActionPreference = $old }
  [pscustomobject]@{ ExitCode=$exitCode; Output=$output }
}
function Invoke-NativeChecked([string]$Label,[string]$FilePath,[string[]]$Arguments) {
  $r = Invoke-NativeCapture $FilePath $Arguments
  if ($r.ExitCode -ne 0) { throw "$Label falhou (exit $($r.ExitCode)).`n$($r.Output)" }
  if (-not [string]::IsNullOrWhiteSpace($r.Output)) { Write-Host $r.Output.TrimEnd() }
  $r
}
function Parse-D1Results([string]$Output) {
  $p = $Output | ConvertFrom-Json
  $b = @($p)
  if ($b.Count -eq 0) { return @() }
  if ($b[0].PSObject.Properties.Name -contains 'results') { return @($b[0].results) }
  @()
}
function Resolve-DriveRoot {
  if (-not [string]::IsNullOrWhiteSpace($DriveRoot)) { return (Resolve-Path $DriveRoot).Path }
  foreach ($candidate in @('G:\Meu Drive','C:\VICTOR\Meu Drive')) { if (Test-Path $candidate) { return (Resolve-Path $candidate).Path } }
  throw 'Google Drive não encontrado em G:\Meu Drive nem C:\VICTOR\Meu Drive.'
}
function Rewrite-Identity($Value,[string]$SourceId,[string]$TargetId) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [string]) {
    if ($Value -eq $SourceId) { return $TargetId }
    if ($Value.StartsWith("$SourceId/")) { return $TargetId + $Value.Substring($SourceId.Length) }
    return $Value
  }
  if ($Value -is [System.Collections.IDictionary]) {
    $h = [ordered]@{}
    foreach ($k in $Value.Keys) { $h[$k] = Rewrite-Identity $Value[$k] $SourceId $TargetId }
    return [pscustomobject]$h
  }
  if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [pscustomobject])) {
    $arr = @(); foreach ($item in $Value) { $arr += ,(Rewrite-Identity $item $SourceId $TargetId) }; return $arr
  }
  if ($Value -is [pscustomobject]) {
    $h = [ordered]@{}
    foreach ($p in $Value.PSObject.Properties) { $h[$p.Name] = Rewrite-Identity $p.Value $SourceId $TargetId }
    return [pscustomobject]$h
  }
  $Value
}
function Get-RecordKey([string]$Table,$Row) {
  $id = Get-Prop $Row 'id'
  if ($null -ne $id -and -not [string]::IsNullOrWhiteSpace([string]$id)) { return [string]$id }
  if ($Table -eq 'clinical_encounter_babies') { return "$([string](Get-Prop $Row 'encounter_id'))|$([string](Get-Prop $Row 'baby_id'))" }
  if ($Table -eq 'appointment_babies') { return "$([string](Get-Prop $Row 'appointment_id'))|$([string](Get-Prop $Row 'baby_id'))" }
  $json = CompactJson $Row
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $bytes=[Text.Encoding]::UTF8.GetBytes("$Table|$json"); return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) { throw 'npx.cmd não encontrado.' }
$NpxCmd=(Get-Command npx.cmd -ErrorAction Stop).Source
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$SchemaPath=Join-Path $RepoRoot 'cloudflare\full-migration-schema.sql'
if (-not (Test-Path $SchemaPath)) { throw "Schema ausente: $SchemaPath" }

if ([string]::IsNullOrWhiteSpace($BackupDir)) {
  $root=Resolve-DriveRoot
  $base=Join-Path $root '03 - Débora Lactação\Backups pacientes'
  if (-not (Test-Path $base)) { throw "Pasta de backups não encontrada: $base" }
  $latest=Get-ChildItem $base -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { throw 'Nenhum backup de paciente encontrado no Drive.' }
  $BackupDir=$latest.FullName
}
$BackupDir=(Resolve-Path $BackupDir).Path
$JsonPath=Join-Path $BackupDir 'patient-backup.json'
if (-not (Test-Path $JsonPath)) { throw "patient-backup.json ausente em $BackupDir" }
$backup=Get-Content $JsonPath -Raw | ConvertFrom-Json
if ([string](Get-Prop $backup 'format') -ne 'debora_patient_backup_v1') { throw 'Formato de backup não reconhecido.' }
$sourceOwner=[string](Get-Prop $backup 'source_owner_id')
$ownerEmail=[string](Get-Prop $backup 'owner_email')
if ([string]::IsNullOrWhiteSpace($sourceOwner) -or [string]::IsNullOrWhiteSpace($ownerEmail)) { throw 'Backup sem identidade de origem.' }

Step 'Confirmando acesso ao Cloudflare'
Invoke-NativeChecked 'wrangler whoami' $NpxCmd @('--yes','wrangler@4','whoami') | Out-Null
Invoke-NativeChecked 'schema D1' $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--file',$SchemaPath,'--yes') | Out-Null

Step 'Localizando a conta atual da profissional no D1 pelo e-mail'
$emailSql=Sql-Literal $ownerEmail.ToLowerInvariant()
$q=Invoke-NativeChecked 'consulta auth_users' $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--command',"SELECT user_id FROM auth_users WHERE lower(email)=$emailSql LIMIT 1;",'--json','--yes')
$rows=Parse-D1Results $q.Output
if ($rows.Count -eq 0) { throw 'Conta da profissional não encontrada em auth_users no D1. Faça login uma vez no sistema e rode novamente.' }
$targetOwner=[string]$rows[0].user_id
if ([string]::IsNullOrWhiteSpace($targetOwner)) { throw 'user_id atual não pôde ser identificado.' }

Step 'Gerando restauração idempotente no D1'
$sqlPath=Join-Path $BackupDir 'restore-d1.sql'
$w=New-Object IO.StreamWriter($sqlPath,$false,(New-Object Text.UTF8Encoding($false)))
$total=0
try {
  foreach ($tableProp in $backup.tables.PSObject.Properties) {
    $table=$tableProp.Name
    foreach ($row in @($tableProp.Value)) {
      $mapped=Rewrite-Identity $row $sourceOwner $targetOwner
      if ($mapped.PSObject.Properties.Name -contains 'owner_id') { $mapped.owner_id=$targetOwner }
      $key=Get-RecordKey $table $mapped
      $created=Get-Prop $mapped 'created_at'; $updated=Get-Prop $mapped 'updated_at'; $json=CompactJson $mapped
      $w.WriteLine("INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at) VALUES ($(Sql-Literal $table),$(Sql-Literal $key),$(Sql-Literal $targetOwner),$(Sql-Literal $json),$(Sql-Literal $created),$(Sql-Literal $updated),CURRENT_TIMESTAMP) ON CONFLICT(table_name,record_key) DO UPDATE SET owner_id=excluded.owner_id,record_json=excluded.record_json,source_created_at=excluded.source_created_at,source_updated_at=excluded.source_updated_at,migrated_at=CURRENT_TIMESTAMP;")
      $total++
    }
  }
} finally { $w.Dispose() }
Invoke-NativeChecked 'restauração dos registros no D1' $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--file',$sqlPath,'--yes') | Out-Null

Step 'Restaurando anexos no R2'
$uploaded=0
foreach ($entry in @($backup.storage)) {
  $sourcePath=[string](Get-Prop $entry 'path')
  $mappedPath=[string](Rewrite-Identity $sourcePath $sourceOwner $targetOwner)
  $bucket=[string](Get-Prop $entry 'bucket')
  $relative=[string](Get-Prop $entry 'relative_file')
  $local=Join-Path $BackupDir ($relative -replace '/', [IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path $local)) { Write-Host '  aviso: arquivo ausente no backup local.' -ForegroundColor Yellow; continue }
  $r2Key="supabase/$bucket/$mappedPath"
  $args=@('--yes','wrangler@4','r2','object','put',"$R2Bucket/$r2Key",'--file',$local,'--remote','--force')
  $mime=[string](Get-Prop $entry 'mime_type'); if (-not [string]::IsNullOrWhiteSpace($mime)) { $args += @('--content-type',$mime) }
  Invoke-NativeChecked 'upload R2' $NpxCmd $args | Out-Null
  $size=(Get-Item $local).Length
  $metaSql="INSERT INTO storage_objects(source_bucket,source_path,r2_key,size_bytes,mime_type,source_created_at,source_updated_at,metadata_json,migrated_at) VALUES ($(Sql-Literal $bucket),$(Sql-Literal $mappedPath),$(Sql-Literal $r2Key),$size,$(Sql-Literal $mime),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'{}',CURRENT_TIMESTAMP) ON CONFLICT(source_bucket,source_path) DO UPDATE SET r2_key=excluded.r2_key,size_bytes=excluded.size_bytes,mime_type=excluded.mime_type,migrated_at=CURRENT_TIMESTAMP;"
  Invoke-NativeChecked 'índice R2' $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--command',$metaSql,'--yes') | Out-Null
  $uploaded++
}

Step 'Validando paciente restaurada'
$count=Invoke-NativeChecked 'validação D1' $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--command',"SELECT table_name,COUNT(*) AS n FROM supabase_records WHERE owner_id=$(Sql-Literal $targetOwner) GROUP BY table_name ORDER BY table_name;",'--json','--yes')
Write-Host $count.Output
Write-Host "`nRESTAURAÇÃO CONCLUÍDA" -ForegroundColor Green
Write-Host "Backup: $BackupDir"
Write-Host "Registros restaurados/atualizados: $total"
Write-Host "Arquivos enviados ao R2: $uploaded"
Write-Host 'Faça logout completo, recarregue o sistema e entre novamente.'
