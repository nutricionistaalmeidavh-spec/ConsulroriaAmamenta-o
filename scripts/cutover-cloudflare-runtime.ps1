param(
  [string]$D1Database = 'debora-lactacao-clinical',
  [string]$R2Bucket = 'debora-lactacao-clinical',
  [string]$HealthUrl = 'https://deboralactacao.com/api/cloudflare/health'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Require-Command([string]$Name) { if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Comando obrigatório não encontrado: $Name" } }

function Invoke-NativeCapture([string]$FilePath, [string[]]$Arguments) {
  $old = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = (& $FilePath @Arguments 2>&1 | Out-String)
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $old }
  [pscustomobject]@{ ExitCode = $code; Output = $output }
}

function Invoke-NativeChecked([string]$Label, [string]$FilePath, [string[]]$Arguments) {
  $result = Invoke-NativeCapture $FilePath $Arguments
  if ($result.ExitCode -ne 0) { throw "$Label falhou (exit $($result.ExitCode)).`n$($result.Output)" }
  if (-not [string]::IsNullOrWhiteSpace($result.Output)) { Write-Host $result.Output.TrimEnd() }
  $result
}

function Strip-Ansi([string]$Text) {
  return [regex]::Replace($Text, "`e\[[0-9;?]*[ -/]*[@-~]", '')
}

function ConvertFrom-LooseJson([string]$Text) {
  $clean = (Strip-Ansi $Text).Trim()
  try { return $clean | ConvertFrom-Json } catch {}
  $arrayStart = $clean.IndexOf('[')
  $objectStart = $clean.IndexOf('{')
  $start = -1
  if ($arrayStart -ge 0 -and $objectStart -ge 0) { $start = [Math]::Min($arrayStart, $objectStart) }
  elseif ($arrayStart -ge 0) { $start = $arrayStart }
  elseif ($objectStart -ge 0) { $start = $objectStart }
  if ($start -lt 0) { throw 'Saída JSON não encontrada.' }
  return $clean.Substring($start) | ConvertFrom-Json
}

# Windows PowerShell 5.1 can preserve a JSON array as a single Object[] value
# when it crosses function/pipeline boundaries. These helpers traverse the parsed
# value explicitly instead of depending on automatic PowerShell enumeration.
function Find-JsonItemByName([object]$Value, [string]$Name) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Array]) {
    foreach ($item in $Value) {
      $found = Find-JsonItemByName $item $Name
      if ($null -ne $found) { return $found }
    }
    return $null
  }
  $props = @($Value.PSObject.Properties.Name)
  if ($props -contains 'name' -and [string]$Value.name -eq $Name) { return $Value }
  foreach ($container in @('result','results','items','databases','buckets','secrets')) {
    if ($props -contains $container) {
      $found = Find-JsonItemByName $Value.$container $Name
      if ($null -ne $found) { return $found }
    }
  }
  return $null
}

function Find-JsonProperty([object]$Value, [string]$PropertyName) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Array]) {
    foreach ($item in $Value) {
      $found = Find-JsonProperty $item $PropertyName
      if ($null -ne $found) { return $found }
    }
    return $null
  }
  $props = @($Value.PSObject.Properties.Name)
  if ($props -contains $PropertyName) { return $Value.$PropertyName }
  foreach ($container in @('result','items','data')) {
    if ($props -contains $container) {
      $found = Find-JsonProperty $Value.$container $PropertyName
      if ($null -ne $found) { return $found }
    }
  }
  return $null
}

function First-JsonItem([object]$Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Array]) {
    if ($Value.Length -eq 0) { return $null }
    return $Value[0]
  }
  return $Value
}

function Ensure-CloudflareLogin([string]$NpxCmd) {
  $probe = Invoke-NativeCapture $NpxCmd @('--yes','wrangler@4','whoami')
  if ($probe.ExitCode -eq 0 -and $probe.Output -notmatch '(?i)not logged|not authenticated|login required') {
    Write-Host 'Cloudflare autenticado.' -ForegroundColor Green
    return
  }
  Step 'Autenticação Cloudflare'
  Write-Host 'O navegador será aberto para autorizar esta máquina.'
  & $NpxCmd --yes wrangler@4 login
  if ($LASTEXITCODE -ne 0) { throw 'Login do Cloudflare não foi concluído.' }
  $verify = Invoke-NativeCapture $NpxCmd @('--yes','wrangler@4','whoami')
  if ($verify.ExitCode -ne 0) { throw 'Cloudflare continua sem autenticação.' }
}

function Get-D1([string]$NpxCmd, [string]$Name) {
  $result = Invoke-NativeChecked 'wrangler d1 list' $NpxCmd @('--yes','wrangler@4','d1','list','--json')
  $parsed = ConvertFrom-LooseJson $result.Output
  $found = Find-JsonItemByName $parsed $Name

  # Final fallback is intentionally based on the Wrangler JSON text itself. This
  # avoids a false negative if an older PowerShell build wraps JSON unexpectedly.
  if ($null -eq $found) {
    $clean = Strip-Ansi $result.Output
    $escapedName = [regex]::Escape($Name)
    $objectPattern = '(?s)\{(?=[^{}]*"name"\s*:\s*"' + $escapedName + '")[^{}]*"uuid"\s*:\s*"([^"]+)"[^{}]*\}'
    $match = [regex]::Match($clean, $objectPattern)
    if ($match.Success) {
      return [pscustomobject]@{ Name = $Name; Id = $match.Groups[1].Value }
    }
    throw "D1 '$Name' não encontrado. Rode primeiro a migração de dados com -Apply."
  }

  $id = if (@($found.PSObject.Properties.Name) -contains 'uuid') { [string]$found.uuid } elseif (@($found.PSObject.Properties.Name) -contains 'id') { [string]$found.id } else { '' }
  if ([string]::IsNullOrWhiteSpace($id)) { throw "Não foi possível identificar o UUID do D1 '$Name'." }
  [pscustomobject]@{ Name = $Name; Id = $id }
}

function Ensure-R2([string]$NpxCmd, [string]$Name) {
  $json = Invoke-NativeCapture $NpxCmd @('--yes','wrangler@4','r2','bucket','list','--json')
  $exists = $false
  if ($json.ExitCode -eq 0) {
    try {
      $parsed = ConvertFrom-LooseJson $json.Output
      $exists = $null -ne (Find-JsonItemByName $parsed $Name)
    } catch {}
  }
  if (-not $exists) {
    $text = Invoke-NativeChecked 'wrangler r2 bucket list' $NpxCmd @('--yes','wrangler@4','r2','bucket','list')
    $exists = $text.Output -match [regex]::Escape($Name)
  }
  if (-not $exists) { throw "R2 '$Name' não encontrado. Rode primeiro a migração de dados com -Apply." }
}

function D1-Scalar([string]$NpxCmd, [string]$Db, [string]$Sql, [string]$Field) {
  $result = Invoke-NativeChecked 'consulta D1' $NpxCmd @('--yes','wrangler@4','d1','execute',$Db,'--remote','--command',$Sql,'--json','--yes')
  $parsed = ConvertFrom-LooseJson $result.Output
  $resultsValue = Find-JsonProperty $parsed 'results'
  $row = First-JsonItem $resultsValue
  if ($null -eq $row) { return 0 }
  if (-not (@($row.PSObject.Properties.Name) -contains $Field)) { return 0 }
  return [int64]$row.$Field
}

function New-RandomSecret {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function Test-WorkerSecret([string]$NpxCmd, [string]$ConfigPath, [string]$Name) {
  $listed = Invoke-NativeCapture $NpxCmd @('--yes','wrangler@4','secret','list','--config',$ConfigPath,'--json')
  if ($listed.ExitCode -eq 0) {
    try {
      $parsed = ConvertFrom-LooseJson $listed.Output
      if ($null -ne (Find-JsonItemByName $parsed $Name)) { return $true }
    } catch {}
  }
  $fallback = Invoke-NativeCapture $NpxCmd @('--yes','wrangler@4','secret','list','--config',$ConfigPath)
  return $fallback.ExitCode -eq 0 -and $fallback.Output -match "(?m)^\s*$([regex]::Escape($Name))\s*$|\b$([regex]::Escape($Name))\b"
}

function Ensure-WorkerSecret([string]$NpxCmd, [string]$ConfigPath, [string]$Name) {
  if (Test-WorkerSecret $NpxCmd $ConfigPath $Name) {
    Write-Host "Secret $Name já existe; valor preservado." -ForegroundColor Green
    return
  }
  $secret = New-RandomSecret
  $old = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = ($secret | & $NpxCmd --yes wrangler@4 versions secret put $Name --config $ConfigPath 2>&1 | Out-String)
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $old; $secret = $null }
  if ($code -ne 0) { throw "Não foi possível configurar o secret $Name.`n$output" }
  Write-Host "Secret $Name criado sem exibir o valor." -ForegroundColor Green
}

function New-GeneratedWrangler([string]$RepoRoot, [string]$D1Id, [string]$D1Name, [string]$BucketName) {
  $source = Join-Path $RepoRoot 'wrangler.jsonc'
  $generated = Join-Path $RepoRoot 'wrangler.cutover.generated.json'
  $raw = [IO.File]::ReadAllText($source)
  $withoutComments = [regex]::Replace($raw, '(?m)^\s*//.*\r?\n?', '')
  $cfg = $withoutComments | ConvertFrom-Json
  $d1 = [pscustomobject]@{ binding = 'CLINICAL_DB'; database_name = $D1Name; database_id = $D1Id }
  $r2 = [pscustomobject]@{ binding = 'CLINICAL_FILES'; bucket_name = $BucketName }
  $cfg | Add-Member -NotePropertyName d1_databases -NotePropertyValue @($d1) -Force
  $cfg | Add-Member -NotePropertyName r2_buckets -NotePropertyValue @($r2) -Force
  [IO.File]::WriteAllText($generated, ($cfg | ConvertTo-Json -Depth 30), (New-Object Text.UTF8Encoding($false)))
  return $generated
}

function Get-Health([string]$Url) {
  $last = $null
  for ($attempt = 1; $attempt -le 8; $attempt++) {
    try {
      $last = Invoke-RestMethod -Method Get -Uri $Url -Headers @{ 'cache-control' = 'no-cache' }
      if ($last) { return $last }
    } catch {
      if ($attempt -eq 8) { throw }
      Start-Sleep -Seconds 3
    }
  }
  return $last
}

Require-Command git
Require-Command node
Require-Command npm.cmd
Require-Command npx.cmd
$NpmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source
$NpxCmd = (Get-Command npx.cmd -ErrorAction Stop).Source
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RuntimeSchema = Join-Path $RepoRoot 'cloudflare\runtime-schema.sql'
$LicenseSyncScript = Join-Path $PSScriptRoot 'sync-license-authority-secret.ps1'
$GeneratedConfig = $null

if (-not (Test-Path $RuntimeSchema)) { throw "Schema runtime ausente: $RuntimeSchema" }
if (-not (Test-Path $LicenseSyncScript)) { throw "Sincronizador de licenciamento ausente: $LicenseSyncScript" }

try {
  Step 'Validando pré-requisitos do corte'
  Ensure-CloudflareLogin $NpxCmd
  $d1 = Get-D1 $NpxCmd $D1Database
  Ensure-R2 $NpxCmd $R2Bucket
  $validated = D1-Scalar $NpxCmd $D1Database "SELECT COUNT(*) AS n FROM migration_runs WHERE status='validated';" 'n'
  $recordsBefore = D1-Scalar $NpxCmd $D1Database 'SELECT COUNT(*) AS n FROM supabase_records;' 'n'
  $usersBefore = D1-Scalar $NpxCmd $D1Database 'SELECT COUNT(*) AS n FROM auth_users;' 'n'
  if ($validated -lt 1 -or $recordsBefore -lt 1 -or $usersBefore -lt 1) {
    throw "A migração validada não foi encontrada no D1 (validated=$validated, records=$recordsBefore, users=$usersBefore)."
  }
  Write-Host "D1 validado: $recordsBefore registros e $usersBefore usuários." -ForegroundColor Green

  Step 'Aplicando schema de autenticação Cloudflare'
  Invoke-NativeChecked 'runtime schema' $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--file',$RuntimeSchema,'--yes') | Out-Null

  Step 'Instalando dependências e materializando runtime clínico'
  Push-Location $RepoRoot
  try {
    if (Test-Path (Join-Path $RepoRoot 'package-lock.json')) { & $NpmCmd ci --no-audit --no-fund } else { & $NpmCmd install --no-audit --no-fund }
    if ($LASTEXITCODE -ne 0) { throw 'Instalação npm falhou.' }
    & node scripts/materialize-clinical-source.mjs --write
    if ($LASTEXITCODE -ne 0) { throw 'Materialização clínica falhou.' }

    Step 'Executando gates locais do cutover'
    & node scripts/test-cloudflare-runtime.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Contrato do runtime Cloudflare falhou.' }
    & node --check worker/cloudflare-clinical-runtime.js
    if ($LASTEXITCODE -ne 0) { throw 'Sintaxe do runtime Cloudflare falhou.' }
    & node --check worker/domain-entry.js
    if ($LASTEXITCODE -ne 0) { throw 'Sintaxe do entrypoint Cloudflare falhou.' }
    & node scripts/test-cloudflare-license-authority.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Regressão no licenciamento comercial.' }

    Step 'Gerando configuração de deploy com bindings D1/R2'
    $GeneratedConfig = New-GeneratedWrangler $RepoRoot $d1.Id $D1Database $R2Bucket

    Step 'Configurando segredo de autenticação'
    Ensure-WorkerSecret $NpxCmd $GeneratedConfig 'CLINICAL_AUTH_SECRET'

    $licenseSynced = D1-Scalar $NpxCmd $D1Database "SELECT COUNT(*) AS n FROM runtime_state WHERE state_key='license_authority_synced' AND state_value='1';" 'n'
    if ($licenseSynced -lt 1) {
      Step 'Sincronizando painel admin com o Worker da Débora'
      & powershell -NoProfile -ExecutionPolicy Bypass -File $LicenseSyncScript -DeboraWranglerConfig $GeneratedConfig
      if ($LASTEXITCODE -ne 0) { throw 'Sincronização do segredo de licenciamento falhou.' }
      Invoke-NativeChecked 'marcação do licenciamento sincronizado' $NpxCmd @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--command',"INSERT INTO runtime_state(state_key,state_value,updated_at) VALUES('license_authority_synced','1',CURRENT_TIMESTAMP) ON CONFLICT(state_key) DO UPDATE SET state_value='1',updated_at=CURRENT_TIMESTAMP;",'--yes') | Out-Null
    } else {
      Write-Host 'Licenciamento Central ↔ Débora já sincronizado; segredo preservado.' -ForegroundColor Green
    }

    Step 'Gerando build de produção'
    & $NpmCmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build de produção falhou.' }

    Step 'Publicando cutover Cloudflare'
    Invoke-NativeChecked 'wrangler deploy' $NpxCmd @('--yes','wrangler@4','deploy','--config',$GeneratedConfig) | Out-Null
  } finally { Pop-Location }

  Step 'Validando produção'
  $health = Get-Health $HealthUrl
  if (-not $health.ok -or $health.backend -ne 'cloudflare-d1-r2' -or -not $health.d1 -or -not $health.r2 -or -not $health.authSecret) {
    throw "Health check do cutover não confirmou D1/R2/auth: $($health | ConvertTo-Json -Compress)"
  }
  if ([int64]$health.validatedMigrations -lt 1 -or [int64]$health.records -lt $recordsBefore -or [int64]$health.authUsers -lt $usersBefore) {
    throw "Contagens de produção divergentes: $($health | ConvertTo-Json -Compress)"
  }

  Write-Host "`nCUTOVER CLOUDFLARE CONCLUÍDO" -ForegroundColor Green
  Write-Host "Backend clínico: D1 $D1Database"
  Write-Host "Arquivos: R2 $R2Bucket"
  Write-Host "Usuários migrados: $($health.authUsers)"
  Write-Host "Registros disponíveis: $($health.records)"
  Write-Host 'Licenciamento: painel Artisys e D1 central sincronizados.'
  Write-Host 'Supabase clínico: preservado como rollback e ponte temporária para sessões/senhas antigas; novas leituras e gravações clínicas usam Cloudflare.'
  Write-Host 'Usuários existentes podem entrar com a senha atual; no primeiro login ela é migrada automaticamente para o D1.'
} finally {
  if ($GeneratedConfig -and (Test-Path $GeneratedConfig)) { Remove-Item -Force $GeneratedConfig -ErrorAction SilentlyContinue }
}
