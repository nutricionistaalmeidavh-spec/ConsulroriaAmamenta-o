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

function Set-WranglerSecret([string]$Name, [string]$Value, [string]$Config, [switch]$UseLocalWrangler) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "Secret $Name está vazio." }
  if ($UseLocalWrangler) {
    $Value | & npx wrangler secret put $Name --config $Config
  } else {
    $Value | & npx --yes 'wrangler@4' secret put $Name --config $Config
  }
  Assert-Exit "Configuração do secret $Name"
}

function Ensure-CloudflareLogin([string]$Config, [switch]$UseLocalWrangler) {
  if ($UseLocalWrangler) {
    $output = (& npx wrangler whoami --config $Config 2>&1 | Out-String)
  } else {
    $output = (& npx --yes 'wrangler@4' whoami --config $Config 2>&1 | Out-String)
  }
  Write-Host $output.Trim()
  if ($LASTEXITCODE -ne 0 -or $output -match '(?i)not authenticated|not logged|login required') {
    Step 'Autenticação Cloudflare'
    if ($UseLocalWrangler) { & npx wrangler login } else { & npx --yes 'wrangler@4' login }
    Assert-Exit 'Login Cloudflare'
  }
}

function Ensure-SupabaseLogin {
  $null = & npx --yes 'supabase@2.111.0' projects list --output json 2>$null
  if ($LASTEXITCODE -ne 0) {
    Step 'Autenticação Supabase'
    & npx --yes 'supabase@2.111.0' login
    Assert-Exit 'Login Supabase'
  }
}

function Get-SupabaseServerKey([string]$ProjectRef) {
  $raw = (& npx --yes 'supabase@2.111.0' projects api-keys --project-ref $ProjectRef --output json 2>&1 | Out-String)
  Assert-Exit 'Leitura das chaves do Supabase'
  $parsed = $raw | ConvertFrom-Json
  $rows = if ($null -ne $parsed.api_keys) { @($parsed.api_keys) } else { @($parsed) }
  $row = $rows | Where-Object {
    ($_.id -eq 'service_role' -or $_.name -eq 'service_role' -or $_.type -eq 'service_role') -and $_.api_key
  } | Select-Object -First 1
  if (-not $row) {
    $row = $rows | Where-Object {
      $_.api_key -and $_.api_key -notmatch '(?i)redacted' -and ($_.id -match 'secret|service' -or $_.name -match 'secret|service')
    } | Select-Object -First 1
  }
  $key = if ($row) { [string]$row.api_key } else { '' }
  if ([string]::IsNullOrWhiteSpace($key) -or $key -match '(?i)redacted') {
    throw 'Não foi possível obter automaticamente uma chave server-side do Supabase. Nenhuma migration foi aplicada.'
  }
  return $key
}

Require-Command git
Require-Command node
Require-Command npm
Require-Command npx

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
  & npm ci --no-audit --no-fund
  Assert-Exit 'npm ci Central'
  & npm test
  Assert-Exit 'testes Central'
  & npm run build
  Assert-Exit 'build Central'

  Ensure-CloudflareLogin -Config 'wrangler.jsonc' -UseLocalWrangler
  Set-WranglerSecret -Name 'LICENSE_SERVICE_SECRET' -Value $LicenseSecret -Config 'wrangler.jsonc' -UseLocalWrangler

  Step 'Aplicando migration D1 da Central'
  & npx wrangler d1 migrations apply obra-na-mao-comercial --remote --config wrangler.jsonc
  Assert-Exit 'migration D1'

  Step 'Publicando a Central Artisys'
  & npx wrangler deploy --config wrangler.jsonc
  Assert-Exit 'deploy Central'
} finally {
  Pop-Location
}

Step 'Confirmando a autoridade D1 publicada'
$probeHeaders = @{ 'x-artisys-license-secret' = $LicenseSecret; 'content-type' = 'application/json' }
$probeBody = @{ action='resolve'; productCode='debora-lactacao'; email='license-probe@artisys.invalid' } | ConvertTo-Json -Compress
$probe = Invoke-RestMethod -Method Post -Uri 'https://artisys.dev/api/internal/product-license' -Headers $probeHeaders -Body $probeBody
if ($probe.planCode -ne 'legacy_unmanaged' -or $probe.commercial -ne $false) {
  throw 'Probe da Central não confirmou o isolamento legacy_unmanaged.'
}

Step 'Autenticando no Supabase e obtendo chave server-side sem expô-la'
Ensure-SupabaseLogin
$SupabaseServerKey = Get-SupabaseServerKey -ProjectRef $SupabaseProjectRef

Step 'Validando e compilando a Débora'
Push-Location $DeboraRoot
try {
  & npm ci --no-audit --no-fund
  Assert-Exit 'npm ci Débora'
  & node scripts/test-cloudflare-license-authority.mjs
  Assert-Exit 'contrato Cloudflare/D1'
  & node scripts/materialize-clinical-source.mjs --verify
  Assert-Exit 'materialização clínica'
  & npm run test:seo
  Assert-Exit 'testes SEO'
  & npm run build
  Assert-Exit 'build Débora'

  Ensure-CloudflareLogin -Config 'wrangler.jsonc'
  Set-WranglerSecret -Name 'LICENSE_SERVICE_SECRET' -Value $LicenseSecret -Config 'wrangler.jsonc'
  Set-WranglerSecret -Name 'SUPABASE_SERVICE_ROLE_KEY' -Value $SupabaseServerKey -Config 'wrangler.jsonc'

  Step 'Publicando o Worker da Débora'
  & npx --yes 'wrangler@4' deploy --config wrangler.jsonc
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
    & npx --yes 'supabase@2.111.0' init
    Assert-Exit 'supabase init'
  }
  & npx --yes 'supabase@2.111.0' link --project-ref $SupabaseProjectRef
  Assert-Exit 'supabase link'
  & npx --yes 'supabase@2.111.0' migration fetch --linked
  Assert-Exit 'supabase migration fetch'

  if (-not (Test-Path 'supabase\migrations\20260914210000_cloudflare_license_authority.sql')) {
    throw 'A migration final desapareceu durante a sincronização do histórico; operação interrompida.'
  }

  Step 'Prévia da migration final do Supabase'
  & npx --yes 'supabase@2.111.0' db push --linked --dry-run
  Assert-Exit 'Supabase db push dry-run'

  Step 'Aplicando por último a migration final do Supabase'
  & npx --yes 'supabase@2.111.0' db push --linked
  Assert-Exit 'Supabase db push'

  & npx --yes 'supabase@2.111.0' migration list --linked
  Assert-Exit 'verificação das migrations Supabase'
} finally {
  Pop-Location
  $LicenseSecret = $null
  $SupabaseServerKey = $null
  [GC]::Collect()
}

Write-Host "`nPUBLICAÇÃO CONCLUÍDA" -ForegroundColor Green
Write-Host 'Central Artisys + D1 publicados; Débora publicada; migration final do Supabase aplicada por último.'
Write-Host 'Contas sem vínculo comercial continuam legacy_unmanaged. Pro 6 meses é liberado pelo painel CEO.'
