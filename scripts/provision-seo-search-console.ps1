[CmdletBinding()]
param(
  [string]$AllowedEmail = $env:ARTISYS_SEO_ALLOWED_EMAIL,
  [string]$RemoteName = 'artisys-qa-drive'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
  Write-Host "[Débora SEO] $Message"
}

if (-not $AllowedEmail) {
  $AllowedEmail = Read-Host 'E-mail do usuário do sistema autorizado a ver o painel SEO'
}
if (-not $AllowedEmail -or $AllowedEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
  throw 'Informe um e-mail válido em -AllowedEmail ou ARTISYS_SEO_ALLOWED_EMAIL.'
}

$tokenPath = Join-Path $env:LOCALAPPDATA 'ArtiSys\SEO\google-search-console-token.json'
if (-not (Test-Path $tokenPath)) {
  throw "Token do Search Console não encontrado em $tokenPath. Execute primeiro o OAuth do artisys-seo."
}
$token = Get-Content $tokenPath -Raw | ConvertFrom-Json
$refreshToken = [string]$token.refresh_token
if (-not $refreshToken) { throw 'O arquivo OAuth não contém refresh_token. Refaça a autorização.' }

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
    ARTISYS_SEO_ALLOWED_EMAILS = $AllowedEmail.Trim().ToLowerInvariant()
  }
  $json = $payload | ConvertTo-Json -Compress
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($tempFile, $json, $utf8NoBom)

  Write-Step 'Enviando secrets ao Cloudflare Worker sem exibir os valores.'
  Push-Location $repoRoot
  try {
    & $npx.Source wrangler secret bulk $tempFile --config $wranglerConfig
    if ($LASTEXITCODE -ne 0) { throw "wrangler secret bulk falhou com código $LASTEXITCODE." }
  } finally {
    Pop-Location
  }

  Write-Step 'Secrets do Search Console provisionados no Worker.'
  Write-Step 'A rota protegida é /api/seo/google/overview.'
} finally {
  if (Test-Path $tempFile) { Remove-Item $tempFile -Force }
}
