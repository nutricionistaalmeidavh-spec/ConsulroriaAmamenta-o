param(
  [string]$SupabaseProjectRef = 'zxowxdfhtksevhnjmeyu'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Step([string]$Text) {
  Write-Host "`n==> $Text" -ForegroundColor Cyan
}

function Assert-Exit([string]$Label) {
  if ($LASTEXITCODE -ne 0) { throw "$Label falhou (exit $LASTEXITCODE)." }
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Comando obrigatório não encontrado: $Name"
  }
}

Require-Command git
Require-Command node
Require-Command npm.cmd
Require-Command npx.cmd

$NpmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source
$NpxCmd = (Get-Command npx.cmd -ErrorAction Stop).Source

function Set-WranglerSecret([string]$Name, [string]$Value, [string]$Config, [switch]$UseLocalWrangler) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "Secret $Name está vazio." }
  if ($UseLocalWrangler) {
    $Value | & $script:NpxCmd wrangler versions secret put $Name --config $Config
  } else {
    $Value | & $script:NpxCmd --yes 'wrangler@4' versions secret put $Name --config $Config
  }
  Assert-Exit "Configuração versionada do secret $Name"
}

function Ensure-CloudflareLogin([switch]$UseLocalWrangler) {
  if ($UseLocalWrangler) {
    $output = (& $script:NpxCmd wrangler whoami 2>&1 | Out-String)
  } else {
    $output = (& $script:NpxCmd --yes 'wrangler@4' whoami 2>&1 | Out-String)
  }
  Write-Host $output.Trim()
  if ($LASTEXITCODE -ne 0 -or $output -match '(?i)not authenticated|not logged|login required') {
    Step 'Autenticação Cloudflare'
    if ($UseLocalWrangler) { & $script:NpxCmd wrangler login } else { & $script:NpxCmd --yes 'wrangler@4' login }
    Assert-Exit 'Login Cloudflare'
  }
}

function Ensure-SupabaseLogin {
  $null = & $script:NpxCmd --yes 'supabase@2.111.0' projects list --output json 2>$null
  if ($LASTEXITCODE -ne 0) {
    Step 'Autenticação Supabase'
    & $script:NpxCmd --yes 'supabase@2.111.0' login
    Assert-Exit 'Login Supabase'
  }
}

function Get-SupabaseServerKey([string]$ProjectRef) {
  $raw = (& $script:NpxCmd --yes 'supabase@2.111.0' projects api-keys --project-ref $ProjectRef --output json | Out-String)
  Assert-Exit 'Leitura das chaves do Supabase'
  $parsed = $raw | ConvertFrom-Json
  $rows = @($parsed)
  if ($parsed -is [pscustomobject] -and $parsed.PSObject.Properties.Name -contains 'api_keys') {
    $rows = @($parsed.api_keys)
  }

  $row = $rows | Where-Object {
    $id = if ($_.PSObject.Properties.Name -contains 'id') { [string]$_.id } else { '' }
    $name = if ($_.PSObject.Properties.Name -contains 'name') { [string]$_.name } else { '' }
    $type = if ($_.PSObject.Properties.Name -contains 'type') { [string]$_.type } else { '' }
    $apiKey = if ($_.PSObject.Properties.Name -contains 'api_key') { [string]$_.api_key } else { '' }
    ($id -eq 'service_role' -or $name -eq 'service_role' -or $type -eq 'service_role') -and -not [string]::IsNullOrWhiteSpace($apiKey)
  } | Select-Object -First 1

  if (-not $row) {
    $row = $rows | Where-Object {
      $id = if ($_.PSObject.Properties.Name -contains 'id') { [string]$_.id } else { '' }
      $name = if ($_.PSObject.Properties.Name -contains 'name') { [string]$_.name } else { '' }
      $apiKey = if ($_.PSObject.Properties.Name -contains 'api_key') { [string]$_.api_key } else { '' }
      -not [string]::IsNullOrWhiteSpace($apiKey) -and $apiKey -notmatch '(?i)redacted' -and ($id -match 'secret|service' -or $name -match 'secret|service')
    } | Select-Object -First 1
  }

  $key = if ($row -and $row.PSObject.Properties.Name -contains 'api_key') { [string]$row.api_key } else { '' }
  if ([string]::IsNullOrWhiteSpace($key) -or $key -match '(?i)redacted') {
    throw 'Não foi possível obter automaticamente uma chave server-side do Supabase. Nenhuma migration foi aplicada.'
  }
  return $key
}

$DeboraRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$CentralRoot = Join-Path $env:TEMP 'artisys-central-license-release'
$CentralWeb = Join-Path $CentralRoot 'apps\web'
$CentralRepo = 'https://github.com/nutricionistaalmeidavh-spec/OBRANAMAOCOMERCIAL.git'
$ExpectedMigration = Join-Path $DeboraRoot 'supabase\migrations\20260914210000_cloudflare_license_authority.sql'

if (-not (Test-Path $ExpectedMigration)) {
  throw "Migration final ausente: $ExpectedMigration"
}

Step 'Atualizando o repositório da Débora'
& git -C $DeboraRoot fetch origin main
Assert-Exit 'git fetch Débora'
$currentBranch = (& git -C $DeboraRoot rev-parse --abbrev-ref HEAD).Trim()
if ($currentBranch -ne 'main') {
  & git -C $DeboraRoot checkout main
  Assert-Exit 'checkout main Débora'
}
& git -C $DeboraRoot pull --ff-only origin main
Assert-Exit 'git pull Débora'

Step 'Preparando a Central Artisys em diretório temporário'
if (Test-Path (Join-Path $CentralRoot '.git')) {
  & git -C $CentralRoot fetch origin main
  Assert-Exit 'git fetch Central'
  & git -C $CentralRoot checkout main
  Assert-Exit 'checkout main Central'
  & git -C $CentralRoot reset --hard origin/main
  Assert-Exit 'reset Central'
} else {
  if (Test-Path $CentralRoot) { Remove-Item -Recurse -Force $CentralRoot }
  & git clone --depth 1 --branch main $CentralRepo $CentralRoot
  Assert-Exit 'clone Central'
}

$bytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$LicenseSecret = [Convert]::ToBase64String($bytes)

Step 'Validando e compilando a Central Artisys'
Push-Location $CentralWeb
try {
  & $NpmCmd ci --no-audit --no-fund
  Assert-Exit 'npm ci Central'
  & $NpxCmd vitest run backend/product-license-service.test.ts backend/debora-license-admin.test.ts src/owner-auth-contract.test.ts
  Assert-Exit 'testes de licenciamento da Central'
  & $NpmCmd run build
  Assert-Exit 'build Central'

  Ensure-CloudflareLogin -UseLocalWrangler
  Set-WranglerSecret -Name 'LICENSE_SERVICE_SECRET' -Value $LicenseSecret -Config 'wrangler.jsonc' -UseLocalWrangler

  Step 'Aplicando somente a migration 0008 de autoridade de licenças no D1'
  $LicenseMigration = Join-Path $CentralWeb 'cloudflare\migrations\0008_product_license_authority.sql'
  if (-not (Test-Path $LicenseMigration)) { throw "Migration D1 0008 ausente: $LicenseMigration" }
  & $NpxCmd wrangler d1 execute obra-na-mao-comercial --remote --file $LicenseMigration --yes --config wrangler.jsonc
  Assert-Exit 'migration D1 0008'

  Step 'Publicando a Central Artisys'
  & $NpxCmd wrangler deploy --config wrangler.jsonc
  Assert-Exit 'deploy Central'
} finally {
  Pop-Location
}

Step 'Confirmando a autoridade D1 publicada'
$probeHeaders = @{ 'x-artisys-license-secret' = $LicenseSecret; 'content-type' = 'application/json' }
$probeBody = @{ action='resolve'; productCode='debora-lactacao'; email='license-probe@artisys.invalid' } | ConvertTo-Json -Compress
$probe = Invoke-RestMethod -Method Post -Uri 'https://obra-na-mao-comercial.nutricionistaalmeidavh.workers.dev/api/internal/product-license' -Headers $probeHeaders -Body $probeBody
if ($probe.planCode -ne 'legacy_unmanaged' -or $probe.commercial -ne $false) {
  throw 'Probe da Central não confirmou o isolamento legacy_unmanaged.'
}

Step 'Autenticando no Supabase e obtendo chave server-side sem expô-la'
Ensure-SupabaseLogin
$SupabaseServerKey = Get-SupabaseServerKey -ProjectRef $SupabaseProjectRef

Step 'Atualizando a Edge Function financeira que sincroniza o D1'
Push-Location $DeboraRoot
try {
  & $NpxCmd --yes 'supabase@2.111.0' functions deploy saas-billing-webhook --project-ref $SupabaseProjectRef --no-verify-jwt --use-api
  Assert-Exit 'deploy saas-billing-webhook'
} finally {
  Pop-Location
}

Step 'Validando e compilando a Débora'
Push-Location $DeboraRoot
try {
  & $NpmCmd ci --no-audit --no-fund
  Assert-Exit 'npm ci Débora'
  & node scripts/test-cloudflare-license-authority.mjs
  Assert-Exit 'contrato Cloudflare/D1'
  & node scripts/materialize-clinical-source.mjs --verify
  Assert-Exit 'materialização clínica'
  & $NpmCmd run build
  Assert-Exit 'build Débora'

  Ensure-CloudflareLogin
  Set-WranglerSecret -Name 'LICENSE_SERVICE_SECRET' -Value $LicenseSecret -Config 'wrangler.jsonc'
  Set-WranglerSecret -Name 'SUPABASE_SERVICE_ROLE_KEY' -Value $SupabaseServerKey -Config 'wrangler.jsonc'

  Step 'Publicando o Worker da Débora'
  & $NpxCmd --yes 'wrangler@4' deploy --config wrangler.jsonc
  Assert-Exit 'deploy Débora'
} finally {
  Pop-Location
}

Step 'Confirmando o Worker da Débora antes de tocar no enforcement do Supabase'
$health = Invoke-RestMethod -Method Get -Uri 'https://deboralactacao.com/api/asaas/health'
if ($health.service -ne 'commercial-asaas-api' -or $health.billingBridge -ne 'supabase_records_cloudflare_d1_access') {
  throw 'Worker da Débora não confirmou a versão com autoridade D1. Supabase foi preservado sem alterações finais.'
}

Step 'Alinhando o histórico oficial de migrations do Supabase'
Push-Location $DeboraRoot
try {
  if (-not (Test-Path 'supabase\config.toml')) {
    & $NpxCmd --yes 'supabase@2.111.0' init
    Assert-Exit 'supabase init'
  }
  & $NpxCmd --yes 'supabase@2.111.0' link --project-ref $SupabaseProjectRef
  Assert-Exit 'supabase link'
  & $NpxCmd --yes 'supabase@2.111.0' migration fetch --linked
  Assert-Exit 'supabase migration fetch'

  if (-not (Test-Path 'supabase\migrations\20260914210000_cloudflare_license_authority.sql')) {
    throw 'A migration final desapareceu durante a sincronização do histórico; operação interrompida.'
  }

  Step 'Prévia da migration final do Supabase'
  & $NpxCmd --yes 'supabase@2.111.0' db push --linked --dry-run
  Assert-Exit 'Supabase db push dry-run'

  Step 'Aplicando por último a migration final do Supabase'
  & $NpxCmd --yes 'supabase@2.111.0' db push --linked
  Assert-Exit 'Supabase db push'

  $migrationList = (& $NpxCmd --yes 'supabase@2.111.0' migration list --linked 2>&1 | Out-String)
  Assert-Exit 'verificação das migrations Supabase'
  Write-Host $migrationList
  if ($migrationList -notmatch '20260914210000') {
    throw 'A migration final não apareceu no histórico remoto após o push.'
  }
} finally {
  Pop-Location
  $LicenseSecret = $null
  $SupabaseServerKey = $null
  [GC]::Collect()
}

Write-Host "`nPUBLICAÇÃO CONCLUÍDA" -ForegroundColor Green
Write-Host 'Central Artisys + D1 publicados; Edge Function financeira atualizada; Débora publicada; migration final do Supabase aplicada por último.'
Write-Host 'Contas sem vínculo comercial continuam legacy_unmanaged. Pro 6 meses é liberado pelo painel CEO.'
