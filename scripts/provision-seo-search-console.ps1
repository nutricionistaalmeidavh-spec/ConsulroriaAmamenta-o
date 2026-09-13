[CmdletBinding()]
param(
  [string]$RemoteName = 'artisys-qa-drive',
  [string]$SearchConsoleSite = 'sc-domain:deboralactacao.com'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
  Write-Host "[Débora SEO] $Message"
}

function New-AdminToken {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$seoDir = Join-Path $env:LOCALAPPDATA 'ArtiSys\SEO'
if (-not (Test-Path $seoDir)) {
  New-Item -ItemType Directory -Path $seoDir -Force | Out-Null
}

$tokenPath = Join-Path $seoDir 'google-search-console-token.json'
if (-not (Test-Path $tokenPath)) {
  throw "Token do Search Console não encontrado em $tokenPath. Execute primeiro o OAuth do artisys-seo."
}
$token = Get-Content $tokenPath -Raw | ConvertFrom-Json
$refreshToken = [string]$token.refresh_token
if (-not $refreshToken) { throw 'O arquivo OAuth não contém refresh_token. Refaça a autorização.' }

$adminTokenPath = Join-Path $seoDir 'debora-seo-admin-token.txt'
$adminToken = ''
if (Test-Path $adminTokenPath) {
  $adminToken = (Get-Content $adminTokenPath -Raw).Trim()
}
if (-not $adminToken -or $adminToken.Length -lt 32) {
  $adminToken = New-AdminToken
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($adminTokenPath, $adminToken, $utf8NoBom)
  Write-Step 'Chave administrativa própria do SEO criada e salva localmente sem exibir o valor.'
} else {
  Write-Step 'Chave administrativa própria do SEO encontrada localmente.'
}

$rclone = Get-Command 'rclone.exe' -ErrorAction SilentlyContinue
if (-not $rclone) { $rclone = Get-Command 'rclone' -ErrorAction SilentlyContinue }
if (-not $rclone) { throw 'rclone não encontrado neste computador.' }

$rcloneJson = & $rclone.Source config dump
if ($LASTEXITCODE -ne 0 -or -not $rcloneJson) { throw 'Não foi possível ler a configuração do rclone.' }
$rcloneConfig = $rcloneJson | ConvertFrom-Json
$remote = $rcloneConfig.$RemoteName
if (-not $remote) { throw "Remote rclone '$RemoteName' não encontrado." }
$clientId = [string]$remote.client_id
$clientSecret = [string]$remote.client_secret
if (-not $clientId -or -not $clientSecret) {
  throw "O remote '$RemoteName' não possui client_id/client_secret próprios."
}

Write-Step 'Validando o refresh token no Google antes de alterar o Worker.'
$tokenResponse = Invoke-RestMethod -Method Post `
  -Uri 'https://oauth2.googleapis.com/token' `
  -ContentType 'application/x-www-form-urlencoded' `
  -Body @{
    client_id = $clientId
    client_secret = $clientSecret
    refresh_token = $refreshToken
    grant_type = 'refresh_token'
  }
$accessToken = [string]$tokenResponse.access_token
if (-not $accessToken) { throw 'O Google não retornou access_token. Refaça a autorização OAuth.' }

Write-Step "Confirmando acesso à propriedade $SearchConsoleSite."
$sitesResponse = Invoke-RestMethod -Method Get `
  -Uri 'https://www.googleapis.com/webmasters/v3/sites' `
  -Headers @{ Authorization = "Bearer $accessToken"; Accept = 'application/json' }
$siteEntries = @($sitesResponse.siteEntry)
$matchedSite = $siteEntries | Where-Object { [string]$_.siteUrl -eq $SearchConsoleSite } | Select-Object -First 1
if (-not $matchedSite) {
  $visible = @($siteEntries | ForEach-Object { [string]$_.siteUrl } | Where-Object { $_ }) -join ', '
  throw "OAuth válido, mas a conta autorizada não possui acesso a '$SearchConsoleSite'. Propriedades visíveis: $visible"
}
Write-Step "OAuth e Search Console confirmados ($($matchedSite.permissionLevel))."

$npx = Get-Command 'npx.cmd' -ErrorAction SilentlyContinue
if (-not $npx) { $npx = Get-Command 'npx' -ErrorAction SilentlyContinue }
if (-not $npx) { throw 'npx não encontrado. Instale/ative o Node.js antes de provisionar o Worker.' }

$repoRoot = Split-Path -Parent $PSScriptRoot
$wranglerConfig = Join-Path $repoRoot 'wrangler.jsonc'
if (-not (Test-Path $wranglerConfig)) { throw "wrangler.jsonc não encontrado em $repoRoot" }

$tempFile = Join-Path ([System.IO.Path]::GetTempPath()) ("artisys-seo-secrets-{0}.json" -f ([guid]::NewGuid().ToString('N')))
try {
  $payload = [ordered]@{
    ARTISYS_GOOGLE_CLIENT_ID = $clientId
    ARTISYS_GOOGLE_CLIENT_SECRET = $clientSecret
    ARTISYS_GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN = $refreshToken
    ARTISYS_SEO_ADMIN_TOKEN = $adminToken
  }
  $json = $payload | ConvertTo-Json -Compress
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($tempFile, $json, $utf8NoBom)

  Write-Step 'Enviando credenciais administrativas ao Cloudflare Worker sem exibir os valores.'
  Push-Location $repoRoot
  try {
    & $npx.Source wrangler secret bulk $tempFile --config $wranglerConfig
    if ($LASTEXITCODE -ne 0) { throw "wrangler secret bulk falhou com código $LASTEXITCODE." }
  } finally {
    Pop-Location
  }

  Write-Step 'Search Console provisionado no Worker.'
  Write-Step 'Nenhuma conta da Débora/Membra é necessária para administrar o SEO.'
  Write-Step "Chave administrativa local: $adminTokenPath"
  Write-Step 'A rota protegida é /api/seo/google/overview.'
} finally {
  if (Test-Path $tempFile) { Remove-Item $tempFile -Force }
}
