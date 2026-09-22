param(
  [string]$SupabaseProjectRef = 'zxowxdfhtksevhnjmeyu',
  [string]$SupabaseUrl = 'https://zxowxdfhtksevhnjmeyu.supabase.co',
  [string]$DriveRoot = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }

function Invoke-NativeCapture([string]$FilePath, [string[]]$Arguments) {
  $old = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = (& $FilePath @Arguments 2>&1 | Out-String)
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $old }
  return [pscustomobject]@{ ExitCode = $exitCode; Output = $output }
}

function Invoke-NativeChecked([string]$Label, [string]$FilePath, [string[]]$Arguments) {
  $result = Invoke-NativeCapture $FilePath $Arguments
  if ($result.ExitCode -ne 0) { throw "$Label falhou (exit $($result.ExitCode)).`n$($result.Output)" }
  if (-not [string]::IsNullOrWhiteSpace($result.Output)) { Write-Host $result.Output.TrimEnd() }
  return $result
}

function Get-ObjectProperty($Object, [string]$Name) {
  if ($null -eq $Object) { return $null }
  if ($Object.PSObject.Properties.Name -contains $Name) { return $Object.$Name }
  return $null
}

function Resolve-DriveRoot {
  if (-not [string]::IsNullOrWhiteSpace($DriveRoot)) {
    if (-not (Test-Path $DriveRoot)) { throw "Drive não encontrado em: $DriveRoot" }
    return (Resolve-Path $DriveRoot).Path
  }
  foreach ($candidate in @('G:\Meu Drive','C:\VICTOR\Meu Drive')) {
    if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
  }
  throw 'Google Drive não encontrado em G:\Meu Drive nem C:\VICTOR\Meu Drive.'
}

function Ensure-SupabaseLogin([string]$NpxCmd) {
  $probe = Invoke-NativeCapture $NpxCmd @('--yes','supabase@2.111.0','projects','list','--output','json')
  if ($probe.ExitCode -eq 0) { return }
  Step 'Login do Supabase pelo próprio terminal'
  Write-Host 'O CLI vai mostrar um link/código. Abra o link no celular, autorize e volte ao Termius.' -ForegroundColor Yellow
  Invoke-NativeChecked 'supabase login' $NpxCmd @('--yes','supabase@2.111.0','login','--no-browser') | Out-Null
  $check = Invoke-NativeCapture $NpxCmd @('--yes','supabase@2.111.0','projects','list','--output','json')
  if ($check.ExitCode -ne 0) { throw 'Login do Supabase não foi concluído.' }
}

function Get-SupabaseServerKey([string]$NpxCmd, [string]$ProjectRef) {
  $result = Invoke-NativeCapture $NpxCmd @('--yes','supabase@2.111.0','projects','api-keys','--project-ref',$ProjectRef,'--output','json')
  if ($result.ExitCode -ne 0) { throw 'Não foi possível obter a chave server-side do Supabase.' }
  $parsed = $result.Output | ConvertFrom-Json
  $rows = @($parsed)
  if ($parsed -is [pscustomobject] -and $parsed.PSObject.Properties.Name -contains 'api_keys') { $rows = @($parsed.api_keys) }
  $row = $rows | Where-Object {
    $id = [string](Get-ObjectProperty $_ 'id')
    $name = [string](Get-ObjectProperty $_ 'name')
    $type = [string](Get-ObjectProperty $_ 'type')
    $key = [string](Get-ObjectProperty $_ 'api_key')
    -not [string]::IsNullOrWhiteSpace($key) -and $key -notmatch '(?i)redacted' -and
      ($id -eq 'service_role' -or $name -eq 'service_role' -or $type -eq 'service_role' -or $id -match 'secret|service' -or $name -match 'secret|service')
  } | Select-Object -First 1
  if (-not $row) { throw 'Chave server-side do Supabase não encontrada.' }
  return [string](Get-ObjectProperty $row 'api_key')
}

function New-SupabaseHeaders([string]$Key, [string]$Accept = 'application/json') {
  return @{ apikey = $Key; Authorization = "Bearer $Key"; Accept = $Accept }
}

function Encode-PathSegments([string]$Value) {
  return (($Value -split '/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
}

function Fetch-Table([string]$Table, [string]$OwnerId, [string]$Key) {
  $uri = "$SupabaseUrl/rest/v1/$([Uri]::EscapeDataString($Table))?select=*&owner_id=eq.$([Uri]::EscapeDataString($OwnerId))"
  return @(Invoke-RestMethod -Method Get -Uri $uri -Headers (New-SupabaseHeaders $Key))
}

if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) { throw 'npx.cmd não encontrado.' }
$NpxCmd = (Get-Command npx.cmd -ErrorAction Stop).Source

$resolvedDrive = Resolve-DriveRoot
$backupBase = Join-Path $resolvedDrive '03 - Débora Lactação\Backups pacientes'
New-Item -ItemType Directory -Force -Path $backupBase | Out-Null
$timestamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$backupDir = Join-Path $backupBase "paciente-$timestamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

Step 'Autenticando no Supabase'
Ensure-SupabaseLogin $NpxCmd
$serverKey = Get-SupabaseServerKey $NpxCmd $SupabaseProjectRef

Step 'Localizando a conta clínica real sem gravar dados no Git'
$mothers = @(Invoke-RestMethod -Method Get -Uri "$SupabaseUrl/rest/v1/mothers?select=owner_id" -Headers (New-SupabaseHeaders $serverKey))
$ownerIds = @($mothers | ForEach-Object { [string]$_.owner_id } | Where-Object { $_ } | Sort-Object -Unique)
$usersPayload = Invoke-RestMethod -Method Get -Uri "$SupabaseUrl/auth/v1/admin/users?page=1&per_page=1000" -Headers (New-SupabaseHeaders $serverKey)
$users = @($usersPayload.users)
$realUsers = @($users | Where-Object {
  $id = [string](Get-ObjectProperty $_ 'id')
  $email = [string](Get-ObjectProperty $_ 'email')
  $ownerIds -contains $id -and $email -and $email -notmatch '(?i)\+demo@'
})
if ($realUsers.Count -ne 1) { throw "Não foi possível identificar de forma inequívoca a conta clínica real. Encontradas: $($realUsers.Count)." }
$ownerId = [string](Get-ObjectProperty $realUsers[0] 'id')
$ownerEmail = [string](Get-ObjectProperty $realUsers[0] 'email')

$tables = @(
  'mothers','babies','appointments','appointment_babies','clinical_encounters','clinical_encounter_babies',
  'clinical_encounter_addenda','clinical_note_revisions','weights','growth_measurements','followups','consents',
  'clinical_documents','clinical_media','media','financial_entries','care_packages','care_package_items',
  'care_package_sessions','care_package_item_usages'
)

Step 'Extraindo cadastro, bebê, prontuário e histórico relacionado'
$tableData = [ordered]@{}
$totalRows = 0
$storagePaths = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($table in $tables) {
  $rows = Fetch-Table $table $ownerId $serverKey
  $tableData[$table] = @($rows)
  $totalRows += $rows.Count
  Write-Host ("  {0}: {1}" -f $table,$rows.Count)
  foreach ($row in $rows) {
    foreach ($field in @('pdf_storage_path','storage_path')) {
      $value = [string](Get-ObjectProperty $row $field)
      if (-not [string]::IsNullOrWhiteSpace($value)) { [void]$storagePaths.Add($value.TrimStart('/')) }
    }
  }
}

Step 'Copiando anexos referenciados no prontuário para o Drive'
$storageRoot = Join-Path $backupDir 'storage'
New-Item -ItemType Directory -Force -Path $storageRoot | Out-Null
$buckets = @(Invoke-RestMethod -Method Get -Uri "$SupabaseUrl/storage/v1/bucket" -Headers (New-SupabaseHeaders $serverKey))
$storageManifest = New-Object System.Collections.ArrayList
foreach ($rawPath in $storagePaths) {
  $downloaded = $false
  foreach ($bucket in $buckets) {
    $bucketName = [string](Get-ObjectProperty $bucket 'name')
    if ([string]::IsNullOrWhiteSpace($bucketName)) { $bucketName = [string](Get-ObjectProperty $bucket 'id') }
    if ([string]::IsNullOrWhiteSpace($bucketName)) { continue }
    $candidatePaths = New-Object System.Collections.Generic.List[string]
    $candidatePaths.Add($rawPath)
    if ($rawPath.StartsWith("$bucketName/")) { $candidatePaths.Add($rawPath.Substring($bucketName.Length + 1)) }
    foreach ($objectPath in @($candidatePaths | Select-Object -Unique)) {
      $encodedBucket = [Uri]::EscapeDataString($bucketName)
      $encodedPath = Encode-PathSegments $objectPath
      $uri = "$SupabaseUrl/storage/v1/object/authenticated/$encodedBucket/$encodedPath"
      $relativeFile = Join-Path (Join-Path 'storage' $bucketName) ($objectPath -replace '/', [IO.Path]::DirectorySeparatorChar)
      $targetFile = Join-Path $backupDir $relativeFile
      New-Item -ItemType Directory -Force -Path (Split-Path $targetFile -Parent) | Out-Null
      try {
        $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $uri -Headers (New-SupabaseHeaders $serverKey '*/*') -OutFile $targetFile
        $mime = [string]$response.Headers['Content-Type']
        [void]$storageManifest.Add([ordered]@{
          bucket = $bucketName
          path = $objectPath
          relative_file = ($relativeFile -replace '\\','/')
          mime_type = $mime
          size_bytes = (Get-Item $targetFile).Length
        })
        $downloaded = $true
        break
      } catch {
        if (Test-Path $targetFile) { Remove-Item -Force $targetFile -ErrorAction SilentlyContinue }
      }
    }
    if ($downloaded) { break }
  }
  if (-not $downloaded) { Write-Host '  aviso: um anexo referenciado não pôde ser localizado no Storage.' -ForegroundColor Yellow }
}

$backup = [ordered]@{
  format = 'debora_patient_backup_v1'
  exported_at = (Get-Date).ToUniversalTime().ToString('o')
  source_project = $SupabaseProjectRef
  source_owner_id = $ownerId
  owner_email = $ownerEmail
  table_row_count = $totalRows
  tables = $tableData
  storage = @($storageManifest)
}
$jsonPath = Join-Path $backupDir 'patient-backup.json'
[IO.File]::WriteAllText($jsonPath, ($backup | ConvertTo-Json -Depth 100), (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText((Join-Path $backupDir 'README.txt'), "Backup clínico da paciente para restauração no Cloudflare.`r`nDados sensíveis: manter apenas em armazenamento privado.`r`n", (New-Object Text.UTF8Encoding($false)))

$serverKey = $null
[GC]::Collect()

Write-Host "`nBACKUP CONCLUÍDO" -ForegroundColor Green
Write-Host "Pasta: $backupDir"
Write-Host "Registros clínicos: $totalRows"
Write-Host "Arquivos copiados: $($storageManifest.Count)"
Write-Host 'Nenhum dado clínico foi salvo no Git.'
