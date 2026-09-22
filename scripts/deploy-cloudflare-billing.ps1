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

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BillingSchema = Join-Path $RepoRoot 'cloudflare\billing-schema.sql'
$BillingAuthSchema = Join-Path $RepoRoot 'cloudflare\billing-auth-schema.sql'
$Cutover = Join-Path $PSScriptRoot 'cutover-cloudflare-runtime.ps1'
$NpxCmd = (Get-Command npx.cmd -ErrorAction Stop).Source

foreach ($path in @($BillingSchema,$BillingAuthSchema,$Cutover)) {
  if (-not (Test-Path $path)) { throw "Arquivo obrigatório ausente: $path" }
}

Write-Host "`n==> Aplicando schema comercial/Asaas no Cloudflare D1" -ForegroundColor Cyan
& $NpxCmd --yes wrangler@4 d1 execute $D1Database --remote --file $BillingSchema --yes
Assert-Exit 'billing-schema.sql'
& $NpxCmd --yes wrangler@4 d1 execute $D1Database --remote --file $BillingAuthSchema --yes
Assert-Exit 'billing-auth-schema.sql'

Write-Host "`n==> Validando marcador do backend comercial" -ForegroundColor Cyan
& $NpxCmd --yes wrangler@4 d1 execute $D1Database --remote --command "SELECT state_key,state_value FROM runtime_state WHERE state_key='billing_backend';" --yes
Assert-Exit 'validação billing_backend'

Write-Host "`n==> Executando deploy protegido Cloudflare D1/R2" -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File $Cutover -D1Database $D1Database -R2Bucket $R2Bucket -HealthUrl $HealthUrl
Assert-Exit 'cutover Cloudflare'

Write-Host "`nDEPLOY CLOUDFLARE + BILLING D1 CONCLUÍDO" -ForegroundColor Green
