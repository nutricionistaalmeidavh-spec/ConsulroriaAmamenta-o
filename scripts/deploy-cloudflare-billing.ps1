param(
  [string]$D1Database = 'debora-lactacao-clinical',
  [string]$R2Bucket = 'debora-lactacao-clinical',
  [string]$HealthUrl = 'https://deboralactacao.com/api/cloudflare/health'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Exit([string]$Label) {
  if ($LASTEXITCODE -ne 0) { throw "$Label falhou com exit $LASTEXITCODE" }
}

function Invoke-GitText([string[]]$Arguments) {
  $old = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = (& $GitCmd @Arguments 2>&1 | Out-String)
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  if ($code -ne 0) { throw "git $($Arguments -join ' ') falhou (exit $code).`n$output" }
  return $output.Trim()
}

function Escape-SqlLiteral([string]$Value) {
  return $Value.Replace("'", "''")
}

function Invoke-D1Command([string]$Sql, [switch]$Json) {
  $args = @('--yes','wrangler@4','d1','execute',$D1Database,'--remote','--command',$Sql,'--yes')
  if ($Json) { $args += '--json' }
  $old = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = (& $NpxCmd @args 2>&1 | Out-String)
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  if ($code -ne 0) { throw "Comando D1 falhou (exit $code).`n$output" }
  return $output
}

function Get-Health([string]$Url, [string]$GitSha) {
  $separator = if ($Url.Contains('?')) { '&' } else { '?' }
  $probe = "$Url$separator`deploy_sha=$GitSha&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  return Invoke-RestMethod -Method Get -Uri $probe -Headers @{ 'cache-control' = 'no-cache'; 'pragma' = 'no-cache' }
}

function Assert-AntiStaleHeaders([string]$Origin, [string]$GitSha) {
  foreach ($path in @('/', '/app/', '/comercial/', '/sw.js')) {
    $probe = "$Origin$path?deploy_sha=$GitSha&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
    $response = Invoke-WebRequest -Method Get -Uri $probe -Headers @{ 'cache-control' = 'no-cache'; 'pragma' = 'no-cache' } -UseBasicParsing
    $cacheControl = [string]$response.Headers['Cache-Control']
    if ($cacheControl -notmatch '(?i)(^|,)\s*no-store(?:\s*,|$)') {
      throw "Header anti-stale inválido em $path: Cache-Control='$cacheControl'. Esperado no-store."
    }
    if ($path -eq '/sw.js') {
      $allowed = [string]$response.Headers['Service-Worker-Allowed']
      if ($allowed -ne '/') { throw "Service-Worker-Allowed inválido em /sw.js: '$allowed'." }
    }
  }
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BillingSchema = Join-Path $RepoRoot 'cloudflare\billing-schema.sql'
$BillingAuthSchema = Join-Path $RepoRoot 'cloudflare\billing-auth-schema.sql'
$Cutover = Join-Path $PSScriptRoot 'cutover-cloudflare-runtime.ps1'
$DeployVersionFile = Join-Path $RepoRoot 'worker\deploy-version.js'
$NpxCmd = (Get-Command npx.cmd -ErrorAction Stop).Source
$GitCmd = (Get-Command git -ErrorAction Stop).Source

foreach ($path in @($BillingSchema,$BillingAuthSchema,$Cutover,$DeployVersionFile)) {
  if (-not (Test-Path $path)) { throw "Arquivo obrigatório ausente: $path" }
}

Push-Location $RepoRoot
try {
  & $GitCmd fetch origin main --quiet
  Assert-Exit 'git fetch origin main'

  $CurrentBranch = Invoke-GitText @('rev-parse','--abbrev-ref','HEAD')
  $LocalSha = Invoke-GitText @('rev-parse','HEAD')
  $RemoteMainSha = Invoke-GitText @('rev-parse','origin/main')
  if ($CurrentBranch -ne 'main') {
    throw "Deploy bloqueado: branch atual '$CurrentBranch'. Produção aceita somente main."
  }
  if ($LocalSha -ne $RemoteMainSha) {
    throw "Deploy bloqueado: HEAD ($LocalSha) != origin/main ($RemoteMainSha). Atualize a main antes de publicar."
  }
  $dirty = Invoke-GitText @('status','--porcelain')
  if (-not [string]::IsNullOrWhiteSpace($dirty)) {
    throw "Deploy bloqueado: working tree contém alterações locais.`n$dirty"
  }
} finally {
  Pop-Location
}

$DeployLockKey = 'production_deploy_lock'
$DeployLockHolder = "$([Environment]::MachineName):$PID:$LocalSha"
$escapedHolder = Escape-SqlLiteral $DeployLockHolder
$LockAcquired = $false
$DeployVersionOriginal = [IO.File]::ReadAllText($DeployVersionFile)
$VersionMarker = '__DEPLOY_GIT_SHA__'

try {
  Write-Host "`n==> Adquirindo deploy lock global" -ForegroundColor Cyan
  $lockSql = "INSERT INTO runtime_state(state_key,state_value,updated_at) VALUES('$DeployLockKey','$escapedHolder',CURRENT_TIMESTAMP) ON CONFLICT(state_key) DO UPDATE SET state_value='$escapedHolder',updated_at=CURRENT_TIMESTAMP WHERE datetime(runtime_state.updated_at) <= datetime('now','-60 minutes'); SELECT state_value FROM runtime_state WHERE state_key='$DeployLockKey';"
  $lockOutput = Invoke-D1Command $lockSql -Json
  $holderMatch = [regex]::Match($lockOutput, '"state_value"\s*:\s*"([^"]+)"')
  $currentHolder = if ($holderMatch.Success) { $holderMatch.Groups[1].Value } else { '' }
  if ($currentHolder -ne $DeployLockHolder) {
    throw "Deploy lock já está ocupado por '$currentHolder'. Outro deploy de produção está em andamento."
  }
  $LockAcquired = $true

  if (-not $DeployVersionOriginal.Contains($VersionMarker)) {
    throw "Marcador $VersionMarker ausente de worker/deploy-version.js. Deploy abortado."
  }
  [IO.File]::WriteAllText(
    $DeployVersionFile,
    $DeployVersionOriginal.Replace($VersionMarker, $LocalSha),
    (New-Object Text.UTF8Encoding($false))
  )

  Write-Host "`n==> Aplicando schema comercial/Asaas no Cloudflare D1" -ForegroundColor Cyan
  & $NpxCmd --yes wrangler@4 d1 execute $D1Database --remote --file $BillingSchema --yes
  Assert-Exit 'billing-schema.sql'
  & $NpxCmd --yes wrangler@4 d1 execute $D1Database --remote --file $BillingAuthSchema --yes
  Assert-Exit 'billing-auth-schema.sql'

  Write-Host "`n==> Validando marcador do backend comercial" -ForegroundColor Cyan
  & $NpxCmd --yes wrangler@4 d1 execute $D1Database --remote --command "SELECT state_key,state_value FROM runtime_state WHERE state_key='billing_backend';" --yes
  Assert-Exit 'validação billing_backend'

  Write-Host "`n==> Revalidando main imediatamente antes da publicação" -ForegroundColor Cyan
  Push-Location $RepoRoot
  try {
    & $GitCmd fetch origin main --quiet
    Assert-Exit 'git fetch origin main pre-publish'
    $PrePublishLocalSha = Invoke-GitText @('rev-parse','HEAD')
    $PrePublishRemoteMainSha = Invoke-GitText @('rev-parse','origin/main')
    if ($PrePublishLocalSha -ne $LocalSha -or $PrePublishRemoteMainSha -ne $LocalSha) {
      throw "Deploy abortado: main mudou durante a execução (início=$LocalSha, HEAD=$PrePublishLocalSha, origin/main=$PrePublishRemoteMainSha)."
    }
  } finally {
    Pop-Location
  }

  Write-Host "`n==> Executando deploy protegido Cloudflare D1/R2" -ForegroundColor Cyan
  & powershell -NoProfile -ExecutionPolicy Bypass -File $Cutover -D1Database $D1Database -R2Bucket $R2Bucket -HealthUrl $HealthUrl
  Assert-Exit 'cutover Cloudflare'

  Write-Host "`n==> Confirmando SHA publicado" -ForegroundColor Cyan
  $health = Get-Health $HealthUrl $LocalSha
  if (-not $health.ok) { throw "Health de produção não está OK: $($health | ConvertTo-Json -Compress)" }
  if ([string]$health.gitSha -ne $LocalSha) {
    throw "Deploy rejeitado: produção reporta SHA '$($health.gitSha)', esperado '$LocalSha'."
  }

  $healthUri = [Uri]$HealthUrl
  $origin = "$($healthUri.Scheme)://$($healthUri.Authority)"
  Write-Host "`n==> Validando headers anti-stale em produção" -ForegroundColor Cyan
  Assert-AntiStaleHeaders $origin $LocalSha

  Write-Host "`nDEPLOY CLOUDFLARE + BILLING D1 CONCLUÍDO" -ForegroundColor Green
  Write-Host "SHA publicado e verificado: $LocalSha"
} finally {
  try {
    [IO.File]::WriteAllText($DeployVersionFile, $DeployVersionOriginal, (New-Object Text.UTF8Encoding($false)))
  } catch {
    Write-Warning "Não foi possível restaurar worker/deploy-version.js: $($_.Exception.Message)"
  }

  if ($LockAcquired) {
    try {
      $releaseSql = "DELETE FROM runtime_state WHERE state_key='$DeployLockKey' AND state_value='$escapedHolder';"
      Invoke-D1Command $releaseSql | Out-Null
      Write-Host 'Deploy lock liberado.' -ForegroundColor DarkGray
    } catch {
      Write-Warning "Falha ao liberar deploy lock; o lease expira automaticamente em 60 minutos: $($_.Exception.Message)"
    }
  }
}
